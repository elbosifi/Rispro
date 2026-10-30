import type { PoolClient } from 'pg';
import { pool } from '../../db/pool.js';
import { HttpError } from '../../utils/http-error.js';
import { authoritativeOrthancArchiveKey,readAuthoritativeOrthancSettings,createAuthoritativeOrthancClient } from '../../services/authoritative-orthanc-service.js';
import { HISTORICAL_PACS_INDEX_FRESHNESS_MS } from '../../services/historical-pacs-index-service.js';
import { readSonicDicomReportSettings } from '../../services/sonicdicom-report-settings.js';
import { checkSonicDicomReportStatus } from '../../services/sonicdicom-report-service.js';
import { requireRosterDoctor } from '../doctor-portal/roster-service.js';
import type { Actor } from '../doctor-portal/reporting-board-service.js';
import { isValidDicomUid } from '../ohif-viewer/validation.js';
import { readReportingPolicy } from './reporting-policy.js';
import type { Identity } from './reporting-service.js';

type Db = Pick<PoolClient,'query'>;
export interface WorkspaceStudy {
  orthanc_study_id:string; study_instance_uid:string; patient_id:string; patient_name_raw:string;
  accession_number:string|null; study_description:string|null; study_date:string|null;
  modalities_in_study:string[]; series_count:number;
}
export const modality = (value:string) => value.toUpperCase()==='MRI'?'MR':value.toUpperCase();
export const supervisor = (me: Awaited<ReturnType<typeof requireRosterDoctor>>) => me.moduleCapabilities.includes('doctor_supervisor') || me.moduleCapabilities.includes('doctor_admin');
export async function reportingDoctor(actor:Actor) {
  const me=await requireRosterDoctor(actor);
  if(me.profile?.userActive===false || !me.allowedModalities.some(p=>p.active&&p.canReport)) throw new HttpError(403,'Active reporting and modality permissions are required.');
  return me;
}
export async function archiveStatus(db:Db=pool) {
  const archive=await readAuthoritativeOrthancSettings(),archiveKey=authoritativeOrthancArchiveKey(archive);
  const state=(await db.query('select source_archive_key,last_success_at,last_error,sync_run_status from historical_pacs_sync_state where singleton_key=true')).rows[0];
  const same=archive.enabled && state?.source_archive_key===archiveKey;
  const fresh=same && state.last_success_at && Date.now()-new Date(state.last_success_at).getTime()<=HISTORICAL_PACS_INDEX_FRESHNESS_MS && !state.last_error;
  return {archiveKey,available:Boolean(same),fresh:Boolean(fresh),lastSuccessAt:state?.last_success_at??null,
    status:!same?'unavailable':fresh?'ready':'stale',error:!same?'The catalogue has not been synchronized against the configured archive.':state.last_error??null};
}
export async function requireStudy(actor:Actor,key:string,db:Db=pool,write=false) {
  const me=await reportingDoctor(actor),policy=await readReportingPolicy(db),freshness=await archiveStatus(db);
  if(write&&!policy.enabled) throw new HttpError(409,'Doctor Workspace V2 is disabled. Existing reports remain readable.');
  if(!freshness.available) throw new HttpError(503,freshness.error || 'Archive catalogue unavailable.');
  const study=(await db.query<WorkspaceStudy>('select * from historical_pacs_studies where orthanc_study_id=$1',[key])).rows[0];
  if(!study) throw new HttpError(404,'Study not found in the configured archive.');
  const permissions=new Set(me.allowedModalities.filter(p=>p.active&&p.canReport).map(p=>modality(p.modalityCode||'')));
  const codes=study.modalities_in_study.map(modality).filter(c=>!['SR','PR','SEG','KO','DOC'].includes(c));
  if(!codes.length || codes.some(c=>!permissions.has(c))) throw new HttpError(403,'Reporting permission is required for every diagnostic modality in this study.');
  if(!isValidDicomUid(study.study_instance_uid)||!study.patient_id?.trim()) throw new HttpError(409,'Reconcile the missing Study Instance UID or DICOM Patient ID before reporting.');
  const duplicate=await db.query('select 1 from historical_pacs_studies where study_instance_uid=$1 and orthanc_study_id<>$2 limit 1',[study.study_instance_uid,key]);
  if(duplicate.rowCount) throw new HttpError(409,'Ambiguous Study Instance UID in the archive. Reconcile study identity.');
  if(write&&!freshness.fresh) throw new HttpError(409,'The archive index is stale. Synchronize it before changing reports.');
  const matches=(await db.query<{id:string;patient_id:string;patient_dicom_id:string;accession:string;assigned_doctor_id:string|null;status:string;requires_report:boolean;held:boolean}>(`
    select b.id,b.patient_id,b.status,b.requires_report,cta.assigned_doctor_id,
      ('V2-' || lpad(b.id::text,6,'0')) accession,
      coalesce((select value from patient_identifiers where patient_id=p.id and is_primary order by id limit 1),nullif(p.identifier_value,''),p.national_id) patient_dicom_id,
      (exists(select 1 from appointments_v2.complementary_recall_requests recall where recall.original_appointment_id=b.id and recall.status not in ('completed','cancelled','withdrawn') and recall.reporting_disposition='supplement_original_report') or exists(select 1 from doctor_portal.reporting_board_case_holds h where h.appointment_id=b.id and h.cleared_at is null)) held
    from appointments_v2.bookings b join patients p on p.id=b.patient_id
    left join doctor_portal.case_team_assignments cta on cta.appointment_id=b.id and cta.assignment_type='reporting' and cta.status='active'
    where b.study_instance_uid=$1 or exists(select 1 from study_source_resolutions s where s.appointment_id=b.id and s.study_instance_uid=$1 and s.source_kind='authoritative_orthanc')`,[study.study_instance_uid])).rows;
  if(matches.length>1 || matches.some(b=>b.patient_dicom_id!==study.patient_id || study.accession_number&&study.accession_number!==b.accession)) throw new HttpError(409,'Study/appointment identity is conflicting or ambiguous. Reconciliation is required.');
  const appointment=(matches[0] as typeof matches[number] | undefined)??null;
  if(!appointment&&study.accession_number&&(await db.query("select 1 from appointments_v2.bookings where ('V2-' || lpad(id::text,6,'0'))=$1 limit 1",[study.accession_number])).rowCount)throw new HttpError(409,'Accession refers to an examination without a verified matching study. Reconcile the Study Instance UID first.');
  if(write&&appointment&&(appointment.held||appointment.status!=='completed'||!appointment.requires_report)) throw new HttpError(409,'The linked examination is held, incomplete, or does not require a report.');
  return {me,policy,freshness,study,appointment,identity:studyIdentity(study)};
}
export function studyIdentity(s:WorkspaceStudy):Identity {
  return {patientName:s.patient_name_raw||'',patientIdentifier:s.patient_id,accession:s.accession_number||'',examination:s.study_description||s.modalities_in_study.join('/'),studyDate:s.study_date||''};
}
export async function verifyLiveStudy(s:WorkspaceStudy) {
  const remote=await (await createAuthoritativeOrthancClient()).getStudyForIndex(s.orthanc_study_id);
  if(!remote || remote.studyInstanceUid!==s.study_instance_uid || remote.patientId!==s.patient_id || (remote.accessionNumber||'')!==(s.accession_number||'')) throw new HttpError(409,'Archive patient/study identity changed. Reconcile and synchronize before reporting.');
}
export async function verifyExternalOwnership(s:WorkspaceStudy,appointmentId:number|null,db:Db) {
  const settings=await readSonicDicomReportSettings();
  if(settings.sonicDicomReportsEnabled) {
    // Zero is a lookup-only cache discriminator; no booking or patient is fabricated.
    const external=await checkSonicDicomReportStatus({bookingId:appointmentId??0,accessionNumber:s.accession_number||'',studyInstanceUid:s.study_instance_uid,requiresReport:true,status:'completed'},{useCache:false});
    if(!['no_report','study_not_found'].includes(external.state)) throw new HttpError(409,'External reporting owns this study or its status cannot be verified.');
  }
  if(appointmentId) {
    const ownership=await db.query(`select 1 from doctor_portal.reporting_board_manual_final_overrides where appointment_id=$1 and cleared_at is null
      union all select 1 from doctor_portal.reporting_board_sonicdicom_cache where appointment_id=$1 and (sonicdicom_latest_document_id is not null or
       (report_status not in ('no_report','study_not_found') and not ($2::boolean and report_status='unavailable' and source is null and last_attempt_at is null and last_success_at is null and failure_count=0 and last_error is null and status_changed_at is null and report_final_at is null and sonicdicom_finalized_by_account is null and finalized_by_doctor_id is null)))`,[appointmentId,!settings.sonicDicomReportsEnabled]);
    if(ownership.rowCount) throw new HttpError(409,'External reporting ownership or a manual final must be reconciled first.');
  }
}

export async function listWorkspaceStudies(actor:Actor,input:Record<string,unknown>,assignedOnly=false) {
  const me=await reportingDoctor(actor),policy=await readReportingPolicy(),freshness=await archiveStatus();
  if(!policy.enabled) throw new HttpError(404,'Doctor Workspace V2 is disabled.');
  if(!freshness.available) return {studies:[],total:0,limit:25,offset:0,freshness,modalities:[]};
  const codes=[...new Set(me.allowedModalities.filter(p=>p.active&&p.canReport).map(p=>modality(p.modalityCode||'')))];
  const limit=Math.min(100,Math.max(1,Math.trunc(Number(input.limit)||25))),offset=Math.max(0,Math.trunc(Number(input.offset)||0));
  const values:unknown[]=[codes,freshness.archiveKey,actor.userId,me.profile!.id];
  const where=[`$4::bigint > 0`,`s.modalities_in_study && $1::text[]`,`not exists(select 1 from unnest(s.modalities_in_study) m where m not in ('SR','PR','SEG','KO','DOC') and (case when m='MRI' then 'MR' else m end)<>all($1::text[]))`];
  const param=(v:unknown)=>{values.push(v);return '$'+values.length;};
  if(input.q) where.push(`(coalesce(s.patient_name_raw,'') || ' ' || coalesce(s.patient_id,'') || ' ' || coalesce(s.accession_number,'') || ' ' || coalesce(s.study_description,'') || ' ' || coalesce(s.study_instance_uid,'')) ilike ${param('%'+String(input.q).slice(0,200)+'%')}`);
  if(input.modality) where.push(`${param(modality(String(input.modality)))}=any(s.modalities_in_study)`);
  for(const [key,operator] of [['from','>='],['to','<=']] as const) if(input[key]) {
    const date=String(input[key]).replaceAll('-','');if(!/^\d{8}$/.test(date)) throw new HttpError(400,'Invalid study date.');
    where.push(`replace(s.study_date,'-','') ${operator} ${param(date)}`);
  }
  // Count/filter only the data needed by the selected filter. Attribution JSON
  // and appointment display data are hydrated after the materialized page limit.
  const registryJoin=` left join native_reporting_studies st on st.source_archive_key=$2 and st.study_instance_uid=s.study_instance_uid`;
  const reportFrom=`from native_reports n left join native_report_study_links l on l.report_id=n.id where n.deleted_at is null and n.primary_study_uid=s.study_instance_uid
    and n.imaging_source->>'accessStrategy'='authoritative_orthanc' and coalesce(n.imaging_source->>'archiveKey',$2)=$2 and (l.study_id=st.id or l.report_id is null)`;
  const mine=`(n.author_user_id=$3 or exists(select 1 from native_report_contributors c where c.report_id=n.id and c.user_id=$3))`;
  const reportJoin=(display:boolean)=>` left join lateral(select count(*)::int report_count,
    bool_or(n.status='final' and n.is_primary and n.report_type='primary' and (l.report_id is null or st.primary_report_id=n.id)) primary_final,
    bool_or(n.status='draft' and n.report_type='primary') active_draft,
    bool_or(n.review_requested_at is not null and n.status='draft' and n.report_type='primary') in_review,
    bool_or(${mine}) mine,bool_or(n.status='draft' and ${mine}) my_draft
    ${display?`,
      jsonb_agg(jsonb_build_object('id',n.id,'author',n.author_name,'signer',n.finalizer_name,'status',case when n.status='draft' and n.review_requested_at is not null then 'in_review' else n.status end) order by n.id) reports`:''}
    ${reportFrom}) r on true`;
  // Two indexed UID lookups replace scanning bookings with OR / EXISTS for each
  // archive row. UNION removes a booking found through both verified paths.
  const appointmentJoin=` left join lateral(select b.id appointment_id,cta.assigned_doctor_id,cta.assigned_at,d.display_name assigned_doctor,rp.name_en priority,
    case when mf.id is not null or cache.report_status='final' then 'external_final'
      when cache.report_status='draft' then 'external_draft'
      when cache.report_status in ('no_report','study_not_found') then 'no_report' else 'unknown' end external_reporting_status
    from (select id from appointments_v2.bookings where study_instance_uid=s.study_instance_uid
      union select appointment_id from study_source_resolutions where study_instance_uid=s.study_instance_uid and source_kind='authoritative_orthanc'
      order by id limit 1) matched join appointments_v2.bookings b on b.id=matched.id
    left join doctor_portal.case_team_assignments cta on cta.appointment_id=b.id and cta.assignment_type='reporting' and cta.status='active'
    left join doctor_portal.doctor_profiles d on d.id=cta.assigned_doctor_id left join reporting_priorities rp on rp.id=b.reporting_priority_id
    left join doctor_portal.reporting_board_sonicdicom_cache cache on cache.appointment_id=b.id
    left join doctor_portal.reporting_board_manual_final_overrides mf on mf.appointment_id=b.id and mf.cleared_at is null) a on true`;
  const nativeStatus=`case when r.primary_final then 'final' when r.in_review then 'in_review' when r.active_draft then 'draft'
    when r.report_count>0 then 'additional_reports' else 'no_report' end`;
  const filter=String(input.status||'all');
  let filterJoins='';
  if(assignedOnly){filterJoins+=appointmentJoin;where.push('a.assigned_doctor_id=$4');}
  if(['unknown','external_draft','external_final'].includes(filter)) {
    if(!assignedOnly)filterJoins+=appointmentJoin;
    where.push(`coalesce(a.external_reporting_status,'unknown')=${param(filter)}`);
  } else if(filter==='my_reports'||filter==='my_drafts') {
    filterJoins+=registryJoin+' '+reportJoin(false);
    where.push(filter==='my_drafts'?'coalesce(r.my_draft,false)':'coalesce(r.mine,false)');
  } else if(filter!=='all'&&filter!=='assigned') {
    filterJoins+=registryJoin+' '+reportJoin(false);
    where.push(`(${nativeStatus})=${param(filter)}`);
  }
  const order=({date:'study_date',patient:'patient_name_raw',accession:'accession_number',modality:'modalities_in_study'} as Record<string,string>)[String(input.sort)]||'study_date';
  const direction=input.direction==='asc'?'asc':'desc';
  // Keep $2/$3 typed even when no reporting joins are required by the count.
  const filtered=`from historical_pacs_studies s ${filterJoins} where $2::text is not null and $3::bigint>0 and ${where.join(' and ')}`;
  const count=(await pool.query(`select count(*)::int total ${filtered}`,values)).rows[0].total;
  const page=`select s.* ${filtered} order by s.${order} ${direction} nulls last,s.orthanc_study_id limit ${param(limit)} offset ${param(offset)}`;
  const rows=(await pool.query(`with page as materialized (${page})
    select s.*,st.id registry_id,a.appointment_id,a.assigned_doctor_id,a.assigned_at,a.assigned_doctor,a.priority,
      coalesce(r.report_count,0) report_count,coalesce(r.reports,'[]'::jsonb) reports,r.mine,r.my_draft,
      (${nativeStatus}) reporting_status,coalesce(a.external_reporting_status,'unknown') external_reporting_status
    from page s ${registryJoin} ${reportJoin(true)} ${appointmentJoin}
    order by s.${order} ${direction} nulls last,s.orthanc_study_id`,values)).rows;
  return {studies:rows,total:count,limit,offset,freshness,modalities:codes};
}
