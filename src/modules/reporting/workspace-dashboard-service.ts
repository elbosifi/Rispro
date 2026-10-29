import { pool } from '../../db/pool.js';
import { HttpError } from '../../utils/http-error.js';
import type { Actor } from '../doctor-portal/reporting-board-service.js';
import { reportingDoctor,archiveStatus,modality } from './workspace-study-service.js';
import { readReportingPolicy } from './reporting-policy.js';
import { getNextPublishedDutyForDoctor } from '../doctor-portal/roster-service.js';

// Shared SQL for counts and the assigned examination list, including unindexed examinations.
const ASSIGNED=`from doctor_portal.case_team_assignments cta
  join appointments_v2.bookings b on b.id=cta.appointment_id
  join patients p on p.id=b.patient_id join modalities m on m.id=b.modality_id
  left join exam_types et on et.id=b.exam_type_id left join reporting_priorities rp on rp.id=b.reporting_priority_id
  left join doctor_portal.reporting_board_sonicdicom_cache cache on cache.appointment_id=b.id
  left join lateral(select n.* from native_reports n where n.appointment_id=b.id and n.deleted_at is null and (n.status='draft' or n.is_primary) order by (n.status='final' and n.is_primary) desc,n.review_requested_at desc nulls last,n.legacy_primary desc,n.id limit 1) nr on true
  left join lateral(select h.orthanc_study_id from historical_pacs_studies h where h.study_instance_uid=b.study_instance_uid or exists(select 1 from study_source_resolutions sr where sr.appointment_id=b.id and sr.study_instance_uid=h.study_instance_uid and sr.source_kind='authoritative_orthanc') order by h.orthanc_study_id limit 1) idx on true
  where cta.assigned_doctor_id=$1 and cta.assignment_type='reporting' and cta.status='active'
  and m.id=any($2::bigint[])`;
const FINAL=`(nr.status='final' and nr.is_primary or cache.report_status='final' or exists(select 1 from doctor_portal.reporting_board_manual_final_overrides mf where mf.appointment_id=b.id and mf.cleared_at is null))`;
const STATUS=`case when ${FINAL} then 'final' when nr.review_requested_at is not null then 'in_review' when nr.status='draft' then 'draft' else 'pending' end`;
export async function assignedWork(actor:Actor,input:Record<string,unknown>) {
  const me=await reportingDoctor(actor),policy=await readReportingPolicy();
  if(!policy.enabled) throw new HttpError(404,'Doctor Workspace V2 is disabled.');
  const args:unknown[]=[me.profile!.id,me.allowedModalities.filter(p=>p.active&&p.canReport).map(p=>p.modalityId)];
  let filter='';const status=String(input.status||'pending');
  if(status==='pending') filter+=` and not coalesce(${FINAL},false)`;
  else if(['draft','in_review','final'].includes(status)) {args.push(status);filter+=` and (${STATUS})=$${args.length}`;}
  if(input.q) {args.push('%'+String(input.q).slice(0,200)+'%');filter+=` and (p.english_full_name ilike $${args.length} or p.mrn ilike $${args.length} or ('V2-' || lpad(b.id::text,6,'0')) ilike $${args.length})`;}
  const total=(await pool.query(`select count(distinct b.id)::int total ${ASSIGNED}${filter}`,args)).rows[0].total;
  const limit=Math.min(100,Math.max(1,Math.trunc(Number(input.limit)||25))),offset=Math.max(0,Math.trunc(Number(input.offset)||0));
  args.push(limit,offset);
  const cases=(await pool.query(`select b.id as "appointmentId",p.english_full_name as "patientName",coalesce((select pi.value from patient_identifiers pi where pi.patient_id=p.id and pi.is_primary order by pi.id limit 1),nullif(p.identifier_value,''),nullif(p.national_id,''),p.mrn) as "patientId",('V2-' || lpad(b.id::text,6,'0')) as accession,
    coalesce(et.name_en,m.name_en) examination,m.code modality,b.booking_date::text as "studyDate",cta.assigned_at as "assignedAt",rp.name_en priority,
    (${STATUS}) status,idx.orthanc_study_id as "studyKey",nr.id as "reportId" ${ASSIGNED}${filter}
    order by rp.sort_order nulls last,b.booking_date,b.id limit $${args.length-1} offset $${args.length}`,args)).rows;
  return {cases,total,limit,offset};
}
export async function doctorDashboard(actor:Actor,range:unknown) {
  const me=await reportingDoctor(actor),policy=await readReportingPolicy();
  if(!policy.enabled) throw new HttpError(404,'Doctor Workspace V2 is disabled.');
  const days=[1,7,30].includes(Number(range))?Number(range):7;
  const permissionIds=me.allowedModalities.filter(p=>p.active&&p.canReport).map(p=>p.modalityId);
  const permissionCodes=me.allowedModalities.filter(p=>p.active&&p.canReport).map(p=>modality(p.modalityCode||''));
  const source=await archiveStatus();
  const workload=(await pool.query(`select count(distinct b.id)::int assigned,count(distinct b.id) filter(where not coalesce(${FINAL},false))::int pending ${ASSIGNED}`,[me.profile!.id,me.allowedModalities.filter(p=>p.active&&p.canReport).map(p=>p.modalityId)])).rows[0];
  const drafts=(await pool.query(`select
    count(*) filter(where n.status='draft' and (n.author_user_id=$1 or c.user_id is not null))::int drafts,
    count(*) filter(where n.status='draft' and n.collaboration_mode='shared' and c.user_id is not null)::int shared,
    count(*) filter(where n.status='draft' and n.review_requested_at is not null and (n.preferred_reviewer_id=$2 or $3::boolean))::int awaiting_review,
    count(*) filter(where n.status='draft' and n.review_requested_at is not null and n.review_requested_by=$1)::int submitted
    from native_reports n left join native_report_contributors c on c.report_id=n.id and c.user_id=$1
    left join native_report_study_links l on l.report_id=n.id left join native_reporting_studies s on s.id=l.study_id
    left join appointments_v2.bookings b on b.id=n.appointment_id
    where n.deleted_at is null and (b.modality_id=any($4::bigint[]) or (s.source_archive_key=$6 and not exists(select 1 from unnest(s.modalities) diagnostic(code) where diagnostic.code not in ('SR','PR','SEG','KO','DOC') and (case when diagnostic.code='MRI' then 'MR' else diagnostic.code end)<>all($5::text[]))))`,[actor.userId,me.profile!.id,policy.reviewEligibility!=='designated'||me.canSupervise,permissionIds,permissionCodes,source.archiveKey])).rows[0];
  const activity=(await pool.query(`select case when coalesce(nullif(s.modalities[1],''),m.code,'Other')='MRI' then 'MR' else coalesce(nullif(s.modalities[1],''),m.code,'Other') end modality,count(*)::int total
    from native_reports n left join native_report_study_links l on l.report_id=n.id left join native_reporting_studies s on s.id=l.study_id
    left join appointments_v2.bookings b on b.id=n.appointment_id left join modalities m on m.id=b.modality_id
    where n.status='final' and n.finalized_by_user_id=$1 and n.finalized_at >= ((now() at time zone 'Africa/Tripoli')::date-($2::int-1))::timestamp at time zone 'Africa/Tripoli'
    group by 1 order by 1`,[actor.userId,days])).rows;
  const completed=(await pool.query(`select count(*)::int total from (
    select coalesce(s.source_archive_key,n.imaging_source->>'archiveKey',case when n.imaging_source->>'accessStrategy'='authoritative_orthanc' then $1 else n.imaging_source::text end) source,n.primary_study_uid uid
    from native_reports n left join native_report_study_links l on l.report_id=n.id left join native_reporting_studies s on s.id=l.study_id where n.status='final' and n.is_primary
    union select $1,coalesce(nullif(b.study_instance_uid,''),sr.study_instance_uid) from appointments_v2.bookings b
      left join study_source_resolutions sr on sr.appointment_id=b.id and sr.source_kind='authoritative_orthanc'
      left join doctor_portal.reporting_board_sonicdicom_cache cache on cache.appointment_id=b.id
      where coalesce(nullif(b.study_instance_uid,''),sr.study_instance_uid) is not null and (cache.report_status='final' or exists(select 1 from doctor_portal.reporting_board_manual_final_overrides mf where mf.appointment_id=b.id and mf.cleared_at is null))
    ) finals`,[source.archiveKey])).rows[0].total;
  const pending=await assignedWork(actor,{limit:6,status:'pending'});
  const nextDuty=await getNextPublishedDutyForDoctor(actor);
  return {workload:{...workload,...drafts},activity,days,totalFinalized:activity.reduce((sum,r)=>sum+Number(r.total),0),departmentCompleted:completed,pending:pending.cases,nextDuty};
}
