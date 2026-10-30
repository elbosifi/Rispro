import type { PoolClient } from 'pg';
import { pool } from '../../db/pool.js';
import { HttpError } from '../../utils/http-error.js';
import { logAuditEntry } from '../../services/audit-service.js';
import { readReportImage } from './report-image-storage-service.js';
import type { Actor } from '../doctor-portal/reporting-board-service.js';
import { EMPTY_SECTIONS,sections,revision,uuid } from './reporting-validation.js';
import { transaction,response,history,audit,images,type ReportRow,type ReportResponseCache } from './reporting-service.js';
import { reportingDoctor,requireStudy,supervisor,verifyLiveStudy,verifyExternalOwnership,archiveStatus,modality } from './workspace-study-service.js';
import {readReportingPolicy} from './reporting-policy.js';
import {templateSections} from './reporting-templates.js';

type Access=Awaited<ReturnType<typeof requireStudy>>;
interface StudyRecord {id:string;primary_report_id:string|null;orthanc_study_id:string;source_archive_key:string;study_instance_uid:string;modalities:string[];identity:ReportRow['identity']}
function assertCreation(a:Access) {
  const assigned=a.appointment&&Number(a.appointment.assigned_doctor_id)===a.me.profile!.id;
  if(a.policy.creation==='assigned'&&!assigned || a.policy.creation==='assigned_permission'&&!assigned&&!supervisor(a.me)) throw new HttpError(403,'Reporting policy requires assignment or supervisor permission.');
}
export async function workspaceStudyRegistry(db:PoolClient,a:Access,adoptLegacy=true) {
  const record=(await db.query<StudyRecord>(`insert into native_reporting_studies(source_archive_key,study_instance_uid,orthanc_study_id,identity,modalities)
    values($1,$2,$3,$4,$5) on conflict(source_archive_key,study_instance_uid) do update set study_instance_uid=excluded.study_instance_uid returning *`,
  [a.freshness.archiveKey,a.study.study_instance_uid,a.study.orthanc_study_id,JSON.stringify(a.identity),a.study.modalities_in_study])).rows[0];
  if(record.orthanc_study_id!==a.study.orthanc_study_id || record.identity.patientIdentifier!==a.identity.patientIdentifier || record.identity.accession!==a.identity.accession) throw new HttpError(409,'Stored report identity conflicts with the archive. Reconciliation is required.');
  if(adoptLegacy&&a.appointment) {
    await db.query('select id from appointments_v2.bookings where id=$1 for update',[a.appointment.id]);
    // Only verified exact-UID, same-patient authoritative-archive legacy records can be linked.
    const legacy=(await db.query<ReportRow>(`select * from native_reports n where appointment_id=$1 and primary_study_uid=$2 and imaging_source->>'accessStrategy'='authoritative_orthanc'
      and not exists(select 1 from native_report_study_links l where l.report_id=n.id) order by id`,[a.appointment.id,a.study.study_instance_uid])).rows;
    for(const report of legacy) {
      if(report.imaging_source.sourcePacsNodeId!==null || Number(report.patient_id)!==Number(a.appointment.patient_id)) throw new HttpError(409,'Legacy report source or patient requires reconciliation.');
      await verifyLiveStudy(a.study);
      await db.query('insert into native_report_study_links(report_id,study_id) values($1,$2)',[report.id,record.id]);
      if(report.status==='final'&&report.is_primary&&report.report_type==='primary') {
        if(record.primary_report_id&&Number(record.primary_report_id)!==Number(report.id)) throw new HttpError(409,'Multiple existing primary signatures require reconciliation.');
        await db.query('update native_reporting_studies set primary_report_id=$2 where id=$1',[record.id,report.id]);record.primary_report_id=report.id;
      }
    }
  }
  return record;
}
const registry=workspaceStudyRegistry;
function canReview(a:Access,report:ReportRow) {
  return a.policy.reviewEligibility!=='designated' || supervisor(a.me) || Number(report.preferred_reviewer_id)===a.me.profile!.id;
}
export function canEditWorkspaceReport(a:Access,report:ReportRow) {
  if(report.status==='final'||report.deleted_at||!a.policy.enabled||!a.freshness.fresh) return false;
  const shared=report.collaboration_mode==='shared'&&a.policy.collaboration!=='independent';
  if(Number(report.author_user_id)!==Number(a.me.profile!.userId)&&!shared) return false;
  return !report.review_requested_at || canReview(a,report);
}
const canEdit=canEditWorkspaceReport;
function canSign(a:Access,report:ReportRow) {
  const qualified=a.policy.signing==='qualified'||a.me.canFinalizeReports;
  if(!qualified||!a.policy.enabled||report.deleted_at||!a.freshness.fresh) return false;
  // A signed addendum corrects an immutable final; draft review transitions cannot
  // be applied retroactively to that already completed signature.
  if(report.status==='final')return true;
  const reviewRequired=a.policy.signing==='review'||a.policy.review==='mandatory'&&a.policy.mandatoryReviewRoles.includes(report.author_doctor_role||a.me.doctorRole||'');
  if(reviewRequired&&(!report.review_requested_at||Number(report.review_requested_by)===Number(a.me.profile!.userId))) return false;
  return !report.review_requested_at||canReview(a,report);
}
function canDelete(a:Access,report:ReportRow,contributors:number) {
  if(!a.policy.enabled||report.status!=='draft'||report.review_requested_at||report.deleted_at||a.policy.deletion==='disabled') return false;
  return supervisor(a.me)||a.policy.deletion==='creator'&&Number(report.author_user_id)===Number(a.me.profile!.userId)&&contributors<=1;
}
interface ViewCache extends ReportResponseCache {role?:string;contributors:{userId:string;name:string;firstContributedAt:Date}[]}
async function view(db:Pick<PoolClient,'query'>,report:ReportRow,a:Access,studyKey:string,loaded?:ViewCache) {
  report.author_doctor_role=loaded?loaded.role:(await db.query('select doctor_role from doctor_portal.doctor_profiles where user_id=$1',[report.author_user_id])).rows[0]?.doctor_role;
  const contributors=loaded?.contributors??(await db.query('select user_id as "userId",display_name as name,first_contributed_at as "firstContributedAt" from native_report_contributors where report_id=$1 order by first_contributed_at,user_id',[report.id])).rows;
  return {...await response(db,report,loaded),studyKey,status:report.status==='draft'&&report.review_requested_at?'in_review':report.status,
    creatorId:Number(report.author_user_id),reportType:report.report_type,mode:report.collaboration_mode,isPrimary:report.status==='final'&&report.is_primary&&report.report_type==='primary',
    contributors,lastEditor:report.last_editor_name||report.author_name,createdAt:report.created_at,deletedAt:report.deleted_at,
    reviewRequestedBy:report.review_requested_by,reviewRequestedAt:report.review_requested_at,preferredReviewerId:report.preferred_reviewer_id,
    reviewEnabled:a.policy.enabled&&(a.policy.review!=='none'||Boolean(report.review_requested_at)),blockedReason:a.freshness.fresh?null:'Archive verification is unavailable or stale. The preserved report is read-only.',
    canEdit:canEdit(a,report),canFinalize:canSign(a,report),canReview:canReview(a,report),canDelete:canDelete(a,report,contributors.length)&&a.freshness.fresh,canRecover:supervisor(a.me)&&Boolean(report.deleted_at)&&a.policy.enabled&&a.freshness.fresh,canRestoreRevision:a.policy.restoreRevisions&&canEdit(a,report)&&!report.review_requested_at};
}
export const workspaceReportResponse=view;
export async function getWorkspaceStudy(actor:Actor,key:string) {
  const a=await requireStudy(actor,key);
  return transaction(async db=>{
    const record=await registry(db,a);
    const rows=(await db.query<ReportRow>(`select n.* from native_reports n join native_report_study_links l on l.report_id=n.id where l.study_id=$1 and (n.deleted_at is null or $2::boolean) order by n.created_at,n.id`,[record.id,supervisor(a.me)])).rows;
    // Load attribution and illustrations in batches; report selection must not issue N+1 queries.
    const ids=rows.map(r=>r.id),cache=new Map<string,ViewCache>(ids.map(id=>[String(id),{contributors:[],images:[],addenda:[]}]));
    if(ids.length) {
      for(const c of (await db.query(`select n.id as report_id,p.doctor_role,c.user_id,c.display_name,c.first_contributed_at from native_reports n
        left join doctor_portal.doctor_profiles p on p.user_id=n.author_user_id left join native_report_contributors c on c.report_id=n.id where n.id=any($1::bigint[]) order by c.first_contributed_at,c.user_id`,[ids])).rows) {
        const item=cache.get(String(c.report_id))!;item.role=c.doctor_role;if(c.user_id!=null)item.contributors.push({userId:c.user_id,name:c.display_name,firstContributedAt:c.first_contributed_at});
      }
      for(const image of (await db.query('select * from native_report_key_images where report_id=any($1::bigint[]) and removed=false order by position,id',[ids])).rows)cache.get(String(image.report_id))!.images.push(image);
      for(const addendum of (await db.query("select report_id,id,actor_name as author,created_at as \"signedAt\",snapshot->>'text' as text from native_report_versions where report_id=any($1::bigint[]) and kind='addendum' order by id",[ids])).rows)cache.get(String(addendum.report_id))!.addenda.push(addendum);
    }
    const reports=[];for(const row of rows) reports.push(await view(db,row,a,key,cache.get(String(row.id))));
    let blockedReason:string|null=null;
    try{assertCreation(a);if(!a.freshness.fresh)blockedReason='Archive index is stale. Synchronize before changing reports.';}catch(e){blockedReason=(e as Error).message;}
    if(record.primary_report_id&&a.policy.additional==='addenda')blockedReason='A primary final exists. Current policy allows signed addenda only.';
    else if(record.primary_report_id&&a.policy.additional==='typed'&&!a.policy.allowedTypes.some(t=>t!=='primary'))blockedReason='No additional report types are enabled. Use a permitted signed addendum.';
    await logAuditEntry({entityType:'reporting_study',entityId:null,actionType:'reporting_study_read',newValues:{studyId:record.id},changedByUserId:actor.userId},db);
    return {studyKey:key,identity:a.identity,studyUid:a.study.study_instance_uid,reports,policy:a.policy,freshness:a.freshness,blockedReason,canCreate:a.policy.enabled&&!blockedReason,primaryReportId:record.primary_report_id==null?null:Number(record.primary_report_id)};
  });
}
export async function createWorkspaceReport(actor:Actor,key:string,body:Record<string,unknown>) {
  const a=await requireStudy(actor,key,pool,true);assertCreation(a);await verifyLiveStudy(a.study);
  return transaction(async db=>{
    await readReportingPolicy(db,'share');
    const current=await requireStudy(actor,key,db,true);assertCreation(current);
    const record=await registry(db,current);await verifyExternalOwnership(current.study,current.appointment?Number(current.appointment.id):null,db);
    const mode=String(body.mode),type=String(body.reportType||'primary');
    if(!['shared','independent'].includes(mode)||current.policy.collaboration!=='both'&&current.policy.collaboration!==mode) throw new HttpError(403,'This collaboration mode is not permitted.');
    if(!current.policy.allowedTypes.includes(type)) throw new HttpError(403,'This report type is not permitted.');
    if(record.primary_report_id&&(current.policy.additional==='addenda'||current.policy.additional==='typed'&&type==='primary')) throw new HttpError(409,'A primary final exists. Choose an allowed additional report type or add a signed addendum.');
    const requestId=uuid(body.requestId);
    // Retry-safe creation without changing the report identifier or clinical content.
    const prior=(await db.query('select v.report_id,v.actor_user_id,l.study_id from native_report_versions v join native_report_study_links l on l.report_id=v.report_id where v.request_id=$1',[requestId])).rows[0];
    if(prior) {
      if(prior.study_id!==record.id||Number(prior.actor_user_id)!==Number(actor.userId))throw new HttpError(409,'Creation request identifier already used.');
      const row=(await db.query<ReportRow>('select * from native_reports where id=$1',[prior.report_id])).rows[0];return view(db,row,current,key);
    }
    const report=(await db.query<ReportRow>(`insert into native_reports(appointment_id,patient_id,primary_study_uid,imaging_source,identity,sections,author_user_id,author_name,legacy_primary,report_type,collaboration_mode,is_primary,policy_version)
      values($1,$2,$3,$4,$5,$6,$7,$8,not exists(select 1 from native_reports where appointment_id=$1 and legacy_primary and deleted_at is null),$9,$10,false,$11) returning *`,
    [current.appointment?.id??null,current.appointment?.patient_id??null,current.study.study_instance_uid,
      JSON.stringify({accessStrategy:'authoritative_orthanc',sourcePacsNodeId:null,archiveKey:current.freshness.archiveKey}),JSON.stringify(current.identity),JSON.stringify(templateSections(body.template)),actor.userId,current.me.profile!.displayName,type,mode,current.policy.version])).rows[0];
    await db.query('insert into native_report_study_links(report_id,study_id) values($1,$2)',[report.id,record.id]);
    await db.query('insert into native_report_contributors(report_id,user_id,display_name) values($1,$2,$3)',[report.id,actor.userId,current.me.profile!.displayName]);
    await history(db,report,actor,current.me.profile!.displayName,'draft',requestId);
    await logAuditEntry({entityType:'native_report',entityId:report.id,actionType:'native_report_created_v2',newValues:{requestId,revision:1,studyId:record.id,policyVersion:current.policy.version},changedByUserId:actor.userId},db);
    return view(db,report,current,key);
  });
}
export async function getWorkspaceReport(actor:Actor,id:number) {
  const me=await reportingDoctor(actor);
  const record=(await pool.query<StudyRecord>('select s.* from native_reporting_studies s join native_report_study_links l on l.study_id=s.id where l.report_id=$1',[id])).rows[0];
  if(!record) throw new HttpError(404,'Report study association not found. Open the verified study first.');
  let a:Access;
  try{a=await requireStudy(actor,record.orthanc_study_id);}catch(e){
    if(!(e instanceof HttpError)||![404,503].includes(e.statusCode))throw e;
    const freshness=await archiveStatus(),policy=await readReportingPolicy();
    const allowed=new Set(me.allowedModalities.filter(p=>p.active&&p.canReport).map(p=>modality(p.modalityCode||'')));
    const diagnostic=record.modalities.map(modality).filter(m=>!['SR','PR','SEG','KO','DOC'].includes(m));
    if(!diagnostic.length||diagnostic.some(m=>!allowed.has(m)))throw new HttpError(403,'Modality access was revoked.');
    a={me,policy,freshness:{...freshness,fresh:false},appointment:null,identity:record.identity,study:{orthanc_study_id:record.orthanc_study_id,study_instance_uid:record.study_instance_uid,patient_id:record.identity.patientIdentifier,patient_name_raw:record.identity.patientName,accession_number:record.identity.accession,study_description:record.identity.examination,study_date:record.identity.studyDate,modalities_in_study:record.modalities,series_count:0}};
  }
  if(a.freshness.archiveKey!==record.source_archive_key) throw new HttpError(409,'Report belongs to a different archive. Reconcile the source before opening.');
  const identityChanged=record.identity.patientIdentifier!==a.identity.patientIdentifier||record.identity.accession!==a.identity.accession;
  if(identityChanged)a={...a,freshness:{...a.freshness,fresh:false}};
  const report=(await pool.query<ReportRow>('select * from native_reports where id=$1',[id])).rows[0];
  if(!report||report.deleted_at&&!supervisor(a.me)) throw new HttpError(404,'Report not found.');
  await logAuditEntry({entityType:'native_report',entityId:id,actionType:'native_report_read',newValues:{revision:report.revision},changedByUserId:actor.userId});
  const result=await view(pool,report,a,record.orthanc_study_id);
  return {...result,blockedReason:identityChanged?'Patient/study identity changed. Reconciliation is required; preserved report content is read-only.':result.blockedReason};
}
export async function withWorkspaceReport<T>(actor:Actor,id:number,expected:unknown,work:(db:PoolClient,report:ReportRow,a:Access,study:StudyRecord)=>Promise<T>,retryRequestId?:string) {
  const expectedRevision=revision(expected);
  const link=(await pool.query<StudyRecord>('select s.* from native_reporting_studies s join native_report_study_links l on l.study_id=s.id where l.report_id=$1',[id])).rows[0];
  if(!link) throw new HttpError(404,'Report not found.');
  return transaction(async db=>{
    await readReportingPolicy(db,'share');
    const study=(await db.query<StudyRecord>('select * from native_reporting_studies where id=$1 for update',[link.id])).rows[0];
    const a=await requireStudy(actor,study.orthanc_study_id,db,true);
    if(study.source_archive_key!==a.freshness.archiveKey) throw new HttpError(409,'Archive source changed. Reconcile reporting identity.');
    if(study.identity.patientIdentifier!==a.identity.patientIdentifier||study.identity.accession!==a.identity.accession)throw new HttpError(409,'Verified patient/study identity changed. Reconciliation is required.');
    if(a.appointment) await db.query('select id from appointments_v2.bookings where id=$1 for update',[a.appointment.id]);
    const report=(await db.query<ReportRow>('select * from native_reports where id=$1 for update',[id])).rows[0];
    report.author_doctor_role=(await db.query('select doctor_role from doctor_portal.doctor_profiles where user_id=$1',[report.author_user_id])).rows[0]?.doctor_role;
    const retry=retryRequestId&&(report.finalize_request_id===retryRequestId||(await db.query('select 1 from native_report_key_images where report_id=$1 and id=$2',[id,retryRequestId])).rowCount);
    if(report.revision!==expectedRevision&&!retry) throw new HttpError(409,'Revision conflict. Your unsaved text is retained. Compare with the saved revision and reconcile before retrying.');
    if(report.primary_study_uid!==a.study.study_instance_uid||report.identity.patientIdentifier!==a.identity.patientIdentifier&&report.appointment_id==null || 'archiveKey' in report.imaging_source&&report.imaging_source.archiveKey!==study.source_archive_key) throw new HttpError(409,'Report patient/study identity changed.');
    return work(db,report,a,study);
  });
}
async function saveVersion(db:PoolClient,actor:Actor,report:ReportRow,a:Access,content:ReturnType<typeof sections>) {
  const saved=(await db.query<ReportRow>('update native_reports set sections=$2,revision=revision+1,last_editor_user_id=$3,last_editor_name=$4,updated_at=now() where id=$1 returning *',[report.id,JSON.stringify(content),actor.userId,a.me.profile!.displayName])).rows[0];
  await db.query('insert into native_report_contributors(report_id,user_id,display_name) values($1,$2,$3) on conflict do nothing',[report.id,actor.userId,a.me.profile!.displayName]);
  await history(db,saved,actor,a.me.profile!.displayName,'draft');return saved;
}
export async function saveWorkspaceDraft(actor:Actor,id:number,body:Record<string,unknown>) {
  const content=sections(body.sections);
  return withWorkspaceReport(actor,id,body.expectedRevision,async(db,report,a,study)=>{
    if(!canEdit(a,report)) throw new HttpError(403,'This report is not editable by you under the current collaboration/review policy.');
    if(JSON.stringify(content)===JSON.stringify(sections(report.sections))) return view(db,report,a,study.orthanc_study_id);
    const saved=await saveVersion(db,actor,report,a,content);await audit(db,actor,report.id,'native_report_saved',saved.revision);
    return view(db,saved,a,study.orthanc_study_id);
  });
}
export async function finalizeWorkspaceReport(actor:Actor,id:number,body:Record<string,unknown>) {
  const requestId=uuid(body.requestId);
  return withWorkspaceReport(actor,id,body.expectedRevision,async(db,report,a,study)=>{
    if(!canSign(a,report)) throw new HttpError(403,'Signing permission or an eligible independent review is required.');
    if(report.status==='final') {
      if(report.finalize_request_id===requestId) return view(db,report,a,study.orthanc_study_id);
      throw new HttpError(409,'Report is already signed.');
    }
    if(body.confirmed!==true||Number(body.signerUserId)!==Number(actor.userId)) throw new HttpError(400,'Confirm the patient/study and your signing identity.');
    if(!report.sections.findings.trim()||!report.sections.impression.trim()) throw new HttpError(400,'Findings and Impression are required.');
    if(Object.values(report.sections).some(text=>/\{\{(?:technique|findings|impression)\}\}/.test(text)))throw new HttpError(400,'Replace all template prompts before signing.');
    if(!a.policy.allowedTypes.includes(report.report_type))throw new HttpError(403,'This report type is no longer permitted by current policy.');
    await verifyLiveStudy(a.study);await verifyExternalOwnership(a.study,a.appointment?Number(a.appointment.id):null,db);
    const primary=!study.primary_report_id&&report.report_type==='primary';
    if(study.primary_report_id&&report.report_type==='primary'&&a.policy.additional!=='unrestricted') throw new HttpError(409,'An authoritative primary final already exists. Retain this draft and use a permitted additional interpretation.');
    if(!primary&&a.policy.additional==='addenda') throw new HttpError(403,'Only signed addenda are allowed by current policy.');
    const selected=await images(db,report.id);for(const image of selected) await readReportImage(image);
    const publicReport=await response(db,report),signedAt=new Date().toISOString();
    const snapshot={identity:report.identity,sections:report.sections,keyImages:publicReport.keyImages,author:report.author_name,finalizer:a.me.profile!.displayName,signedAt,policyVersion:a.policy.version,signerUserId:actor.userId,reportType:report.report_type};
    const saved=(await db.query<ReportRow>(`update native_reports set status='final',revision=revision+1,is_primary=$2,finalized_by_user_id=$3,finalized_by_doctor_id=$4,
      finalizer_name=$5,finalized_at=$6,signed_snapshot=$7,finalize_request_id=$8,policy_version=$9,reviewed_by=case when review_requested_at is not null then $3 else reviewed_by end,updated_at=now() where id=$1 returning *`,
    [id,primary,actor.userId,a.me.profile!.id,a.me.profile!.displayName,signedAt,JSON.stringify(snapshot),requestId,a.policy.version])).rows[0];
    if(primary) await db.query('update native_reporting_studies set primary_report_id=$2 where id=$1 and primary_report_id is null',[study.id,id]);
    await history(db,saved,actor,a.me.profile!.displayName,'final');await audit(db,actor,report.id,'native_report_finalized',saved.revision);
    return view(db,saved,a,study.orthanc_study_id);
  },requestId);
}
export async function reviewWorkspaceReport(actor:Actor,id:number,body:Record<string,unknown>) {
  return withWorkspaceReport(actor,id,body.expectedRevision,async(db,report,a,study)=>{
    const action=String(body.action),comment=String(body.comment||'').trim();
    if(action==='feedback'&&!comment)throw new HttpError(400,'Review feedback cannot be empty.');
    if(report.status!=='draft'||report.deleted_at||a.policy.review==='none'&&action==='submit'||!['submit','return','withdraw','feedback'].includes(action)||comment.length>10000) throw new HttpError(409,'Unsupported review transition.');
    if(action==='submit'&&(!canEdit(a,report)||report.review_requested_at)) throw new HttpError(403,'Only an editable active draft can be submitted.');
    if(action!=='submit'&&(!report.review_requested_at||action==='withdraw'&&Number(report.review_requested_by)!==Number(actor.userId)&&!supervisor(a.me)||action!=='withdraw'&&!canReview(a,report))) throw new HttpError(403,'You are not eligible to perform this review action.');
    const preferred=body.preferredReviewerId==null?null:Number(body.preferredReviewerId);
    if(preferred!==null&&(!Number.isSafeInteger(preferred)||preferred<1))throw new HttpError(400,'Invalid preferred reviewer.');
    if(preferred!==null) {
      const reviewer=(await db.query(`select d.id from doctor_portal.doctor_profiles d join users u on u.id=d.user_id where d.id=$1 and d.active and u.is_active and u.role in ('doctor','supervisor','super_admin')
        and not exists(select 1 from unnest($2::text[]) as diagnostic(code) where diagnostic.code not in ('SR','PR','SEG','KO','DOC') and not exists(select 1 from doctor_portal.doctor_modality_permissions p join modalities m on m.id=p.modality_id where p.doctor_id=d.id and p.active and p.can_report and m.code=(case when diagnostic.code='MRI' then 'MR' else diagnostic.code end)))`,[preferred,a.study.modalities_in_study])).rows[0];
      if(!reviewer) throw new HttpError(400,'Preferred reviewer must be an active qualified reporting doctor.');
    }
    await db.query('insert into native_report_review_events(report_id,event_type,actor_user_id,actor_name,comment,preferred_reviewer_id) values($1,$2,$3,$4,$5,$6)',[id,action,actor.userId,a.me.profile!.displayName,comment,preferred]);
    const saved=(await db.query<ReportRow>(`update native_reports set revision=revision+1,updated_at=now(),
      review_requested_at=case when $2='submit' then now() when $2 in ('return','withdraw') then null else review_requested_at end,
      review_requested_by=case when $2='submit' then $3 else review_requested_by end,
      preferred_reviewer_id=case when $2='submit' then $4 else preferred_reviewer_id end where id=$1 returning *`,[id,action,actor.userId,preferred])).rows[0];
    await history(db,saved,actor,a.me.profile!.displayName,'draft');await audit(db,actor,report.id,'native_report_review_'+action,saved.revision);
    return view(db,saved,a,study.orthanc_study_id);
  });
}
export async function deleteWorkspaceDraft(actor:Actor,id:number,body:Record<string,unknown>,recover=false) {
  return withWorkspaceReport(actor,id,body.expectedRevision,async(db,report,a,study)=>{
    const count=(await db.query('select count(*)::int count from native_report_contributors where report_id=$1',[id])).rows[0].count;
    if(recover?!supervisor(a.me)||!report.deleted_at||report.status!=='draft':!canDelete(a,report,count)) throw new HttpError(403,'Draft deletion/recovery is not permitted. Withdraw review first; shared contributions require a supervisor.');
    const reason=String(body.reason||'').trim();if(body.confirmed!==true||!reason||reason.length>2000) throw new HttpError(400,'Confirm and provide a deletion/recovery reason.');
    const saved=(await db.query<ReportRow>(`update native_reports set revision=revision+1,deleted_at=case when $2::boolean then null else now() end,deleted_by=case when $2::boolean then null else $3::bigint end,deletion_reason=case when $2::boolean then null else $4::text end,legacy_primary=false,updated_at=now() where id=$1 returning *`,[id,recover,actor.userId,reason])).rows[0];
    await history(db,saved,actor,a.me.profile!.displayName,'draft');
    await logAuditEntry({entityType:'native_report',entityId:id,actionType:recover?'native_report_recovered':'native_report_deleted',newValues:{reason,revision:saved.revision},changedByUserId:actor.userId},db);
    return view(db,saved,a,study.orthanc_study_id);
  });
}
export async function workspaceHistory(actor:Actor,id:number) {
  await getWorkspaceReport(actor,id);
  return {versions:(await pool.query('select id,revision,kind,snapshot,actor_user_id as "editorId",actor_name as author,created_at as "createdAt" from native_report_versions where report_id=$1 order by id',[id])).rows,
    reviews:(await pool.query('select * from native_report_review_events where report_id=$1 order by id',[id])).rows};
}
export async function workspaceReviewers(actor:Actor,id:number) {
  const report=await getWorkspaceReport(actor,id);
  const study=(await pool.query('select s.modalities from native_reporting_studies s join native_report_study_links l on l.study_id=s.id where l.report_id=$1',[report.id])).rows[0];
  return (await pool.query(`select d.id,d.display_name as name from doctor_portal.doctor_profiles d join users u on u.id=d.user_id where d.active and u.is_active and u.role in ('doctor','supervisor','super_admin')
    and not exists(select 1 from unnest($1::text[]) as diagnostic(code) where diagnostic.code not in ('SR','PR','SEG','KO','DOC') and not exists(select 1 from doctor_portal.doctor_modality_permissions p join modalities m on m.id=p.modality_id where p.doctor_id=d.id and p.active and p.can_report and m.code=(case when diagnostic.code='MRI' then 'MR' else diagnostic.code end))) order by d.display_name,d.id`,[study.modalities])).rows;
}
export async function restoreWorkspaceRevision(actor:Actor,id:number,body:Record<string,unknown>) {
  return withWorkspaceReport(actor,id,body.expectedRevision,async(db,report,a,study)=>{
    if(!a.policy.restoreRevisions||!canEdit(a,report)||report.review_requested_at) throw new HttpError(403,'Active-draft revision restoration is disabled or not permitted.');
    const old=(await db.query('select snapshot from native_report_versions where report_id=$1 and revision=$2 and kind=\'draft\'',[id,revision(body.revision)])).rows[0];
    if(!old) throw new HttpError(404,'Draft revision not found.');
    const selected=old.snapshot.keyImages as {id:string;caption:string}[];
    if(Array.isArray(selected)) {
      const retained=(await db.query('select * from native_report_key_images where report_id=$1',[id])).rows;
      for(const item of selected) {const image=retained.find(i=>i.id===item.id);if(!image)throw new HttpError(409,'A preserved key-image asset cannot be reconciled.');await readReportImage(image);}
      await db.query('update native_report_key_images set removed=true where report_id=$1',[id]);
      for(let position=0;position<selected.length;position++)await db.query('update native_report_key_images set removed=false,position=$3,caption=$4 where report_id=$1 and id=$2',[id,selected[position].id,position+1,selected[position].caption]);
    }
    const saved=await saveVersion(db,actor,report,a,sections(old.snapshot.sections));await audit(db,actor,report.id,'native_report_revision_restored',saved.revision);
    return view(db,saved,a,study.orthanc_study_id);
  });
}
export async function addWorkspaceAddendum(actor:Actor,id:number,body:Record<string,unknown>) {
  const requestId=uuid(body.requestId),text=String(body.text||'').trim();
  return withWorkspaceReport(actor,id,body.expectedRevision,async(db,report,a,study)=>{
    if(!canSign(a,report)||report.status!=='final') throw new HttpError(403,'A signed report and current signing permission are required.');
    if(body.confirmed!==true||!text||text.length>100000) throw new HttpError(400,'Confirm the signed addendum text.');
    await verifyLiveStudy(a.study);
    const prior=(await db.query('select report_id,snapshot from native_report_versions where request_id=$1',[requestId])).rows[0];
    if(prior&&(Number(prior.report_id)!==id||prior.snapshot.text!==text)) throw new HttpError(409,'Addendum request identifier already used.');
    if(!prior) {await db.query("insert into native_report_versions(report_id,kind,snapshot,actor_user_id,actor_name,request_id) values($1,'addendum',$2,$3,$4,$5)",[id,JSON.stringify({text,policyVersion:a.policy.version}),actor.userId,a.me.profile!.displayName,requestId]);await audit(db,actor,report.id,'native_report_addendum_signed',report.revision);}
    return view(db,report,a,study.orthanc_study_id);
  });
}
