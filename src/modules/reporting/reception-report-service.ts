import type { PoolClient } from 'pg';
import {pool} from '../../db/pool.js';
import {HttpError} from '../../utils/http-error.js';
import type {ReportRow} from './reporting-service.js';
import type {NativeReportPrintData} from '../../services/generated-print-html-service.js';

type Db=Pick<PoolClient,'query'>;
export interface ReceptionReportStatus {
  state:'final'|'draft'|'in_review'|'no_report'|'study_not_found'|'unavailable';
  source:'rispro'|'manual'|'sonicdicom'|null;
  reportId:number|null; canViewReport:boolean; checkedAt:string|null;
}
type ProjectionRow={id:string;status:string;requires_report:boolean;study_instance_uid:string|null;accession:string;booking_date:string;modality_code:string;native_active:boolean;native_review:boolean;native_draft:boolean;final_count:number;report_id:string|null;legacy_status:ReceptionReportStatus['state']|null;manual_final:boolean;checked_at:Date|null;signed_snapshot:ReportRow['signed_snapshot']};

// One bounded query for an entire appointment page. Accession alone never links
// a report. An active native workflow suppresses all retained legacy statuses,
// including when its association requires reconciliation.
async function project(ids:number[],includeSnapshot=false,db:Db=pool) {
  if(!ids.length)return [];
  return (await db.query<ProjectionRow>(`
    with booking as (
      select b.id,b.patient_id,b.status,b.requires_report,b.study_instance_uid,b.booking_date,m.code modality_code,
        ('V2-'||lpad(b.id::text,6,'0')) accession,
        coalesce((select value from patient_identifiers where patient_id=p.id and is_primary order by id limit 1),nullif(p.identifier_value,''),p.national_id) patient_identifier,
        coalesce(b.study_instance_uid,case when cardinality(r.uids)=1 then r.uids[1] end) verified_uid,
        not exists(select 1 from unnest(r.uids) uid where b.study_instance_uid is not null and uid<>b.study_instance_uid) and coalesce(cardinality(r.uids),0)<=1 and coalesce(r.identity_valid,true) resolution_consistent
      from appointments_v2.bookings b join patients p on p.id=b.patient_id join modalities m on m.id=b.modality_id
      left join lateral (select array_agg(distinct study_instance_uid) uids,
        bool_and(accession_number=('V2-'||lpad(b.id::text,6,'0')) and (patient_id_value is null or patient_id_value=coalesce((select value from patient_identifiers where patient_id=p.id and is_primary order by id limit 1),nullif(p.identifier_value,''),p.national_id))) identity_valid
        from study_source_resolutions where appointment_id=b.id and source_kind='authoritative_orthanc') r on true
      where b.id=any($1::bigint[])
    ), candidate as (
      select b.id,n.id report_id,n.status,n.report_type,n.review_requested_at,
        n.is_primary and n.report_type='primary' and n.status='final' and b.status<>'voided' and n.signed_snapshot is not null and n.finalized_at is not null and n.finalized_by_user_id is not null
        and jsonb_typeof(n.signed_snapshot->'sections')='object' and jsonb_typeof(n.signed_snapshot->'keyImages')='array'
        and (n.appointment_id=b.id and n.patient_id=b.patient_id or n.appointment_id is null and n.patient_id is null)
        and b.resolution_consistent and n.primary_study_uid=b.verified_uid
        and n.identity->>'patientIdentifier'=b.patient_identifier and n.identity->>'accession'=b.accession
        and n.signed_snapshot->'identity'->>'patientIdentifier'=b.patient_identifier and n.signed_snapshot->'identity'->>'accession'=b.accession
        and not exists(select 1 from appointments_v2.bookings other where other.id<>b.id and other.study_instance_uid=b.verified_uid)
        and not exists(select 1 from study_source_resolutions other where other.appointment_id<>b.id and other.source_kind='authoritative_orthanc' and other.study_instance_uid=b.verified_uid)
        and (
          l.report_id is not null and s.primary_report_id=n.id and s.study_instance_uid=n.primary_study_uid
            and s.source_archive_key=n.imaging_source->>'archiveKey' and n.imaging_source->>'accessStrategy'='authoritative_orthanc'
            and s.identity->>'patientIdentifier'=b.patient_identifier and s.identity->>'accession'=b.accession and (case when b.modality_code='MRI' then 'MR' else b.modality_code end)=any(s.modalities)
          or l.report_id is null and n.legacy_primary and n.appointment_id=b.id and n.patient_id=b.patient_id and not exists(select 1 from native_reporting_studies registered where registered.study_instance_uid=n.primary_study_uid and (n.imaging_source->>'archiveKey' is null or registered.source_archive_key=n.imaging_source->>'archiveKey'))
        ) authoritative
      from booking b join native_reports n on n.deleted_at is null and
        (n.appointment_id=b.id or n.appointment_id is null and n.primary_study_uid=b.verified_uid)
      left join native_report_study_links l on l.report_id=n.id left join native_reporting_studies s on s.id=l.study_id
    ), summary as (
      select id,true native_active,bool_or(status='draft' and report_type='primary' and review_requested_at is not null) native_review,
        bool_or(status='draft' and report_type='primary') native_draft,
        count(*) filter(where authoritative)::int final_count,min(report_id) filter(where authoritative) report_id
      from candidate group by id
    )
    select b.*,coalesce(summary.native_active,false) native_active,coalesce(summary.native_review,false) native_review,coalesce(summary.native_draft,false) native_draft,
      coalesce(summary.final_count,0) final_count,summary.report_id,cache.report_status legacy_status,cache.last_success_at checked_at,
      (manual.id is not null) manual_final,case when $2::boolean then chosen.signed_snapshot end signed_snapshot
    from booking b left join summary using(id) left join native_reports chosen on chosen.id=summary.report_id and summary.final_count=1
    left join doctor_portal.reporting_board_sonicdicom_cache cache on cache.appointment_id=b.id
    left join doctor_portal.reporting_board_manual_final_overrides manual on manual.appointment_id=b.id and manual.cleared_at is null
  `,[ids,includeSnapshot])).rows;
}
function status(row:ProjectionRow):ReceptionReportStatus {
  // Native > manual > SonicDICOM. Invalid/ambiguous native finals fail closed.
  const state=row.native_active?row.final_count===1?'final':row.final_count>1?'unavailable':row.native_review?'in_review':row.native_draft?'draft':'no_report':row.manual_final?'final':row.legacy_status||'no_report';
  return {state,source:row.native_active?'rispro':row.manual_final?'manual':row.legacy_status?'sonicdicom':null,reportId:row.final_count===1?Number(row.report_id):null,
    canViewReport:state==='final'&&row.native_active,checkedAt:row.native_active?null:row.checked_at?.toISOString()??null};
}
export async function receptionReportStatuses(ids:number[]) {
  return new Map((await project(ids)).map(row=>[Number(row.id),status(row)]));
}
export async function receptionReportContext(id:number) {
  const row=(await project([id]))[0];
  if(!row)throw new HttpError(404,'Appointment not found.');
  return {status:status(row),lookup:{bookingId:id,accessionNumber:row.accession,studyInstanceUid:row.study_instance_uid,requiresReport:row.requires_report,status:row.status,bookingDate:String(row.booking_date),modalityCode:row.modality_code}};
}
export async function receptionSignedReport(id:number):Promise<NativeReportPrintData> {
  const row=(await project([id],true))[0],snapshot=row?.signed_snapshot;
  if(!row||status(row).source!=='rispro'||status(row).state!=='final'||!snapshot)throw new HttpError(404,'No verified signed primary native report is available for this appointment.');
  const addenda=(await pool.query(`select snapshot->>'text' text,actor_name author,created_at as "signedAt" from native_report_versions where report_id=$1 and kind='addendum' order by id`,[row.report_id])).rows;
  return {id:Number(row.report_id),appointmentId:id,status:'final',identity:snapshot.identity,institution:snapshot.institution??null,sections:snapshot.sections,keyImages:snapshot.keyImages,
    author:snapshot.author,finalizer:snapshot.finalizer,finalizedAt:snapshot.signedAt,addenda};
}
