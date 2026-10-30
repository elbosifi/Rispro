import assert from 'node:assert/strict';
import {after,before,test} from 'node:test';
import {randomUUID} from 'node:crypto';
import {pool} from '../../db/pool.js';
import {DEFAULT_REPORTING_POLICY,readReportingPolicy,updateReportingPolicy} from './reporting-policy.js';
import {authoritativeOrthancArchiveKey,__setAuthoritativeOrthancSettingsForTests,__setAuthoritativeOrthancFetchForTests,__resetAuthoritativeOrthancForTests,type AuthoritativeOrthancSettings} from '../../services/authoritative-orthanc-service.js';
import {upsertHistoricalPacsStudies} from '../../services/historical-pacs-index-service.js';
import {listWorkspaceStudies} from './workspace-study-service.js';
import {createWorkspaceReport,getWorkspaceStudy,saveWorkspaceDraft,finalizeWorkspaceReport,reviewWorkspaceReport,deleteWorkspaceDraft,workspaceHistory,restoreWorkspaceRevision,getWorkspaceReport,addWorkspaceAddendum} from './workspace-report-service.js';
import {doctorDashboard,assignedWork} from './workspace-dashboard-service.js';
import type {Actor} from '../doctor-portal/reporting-board-service.js';
const prefix='wv2_'+Date.now(),settings:AuthoritativeOrthancSettings={enabled:true,baseUrl:'http://127.0.0.1:19481',username:'synthetic',password:'synthetic',timeoutSeconds:2,verifyTls:true,displayName:'Synthetic',autoExportClinicalDocuments:false,autoRouteEnabled:false,autoRouteDestinationKey:'',autoRouteDestinationKeys:[]};
let doctor:Actor,other:Actor,manager:Actor,noSign:Actor;
let originalPolicy:unknown,originalSonic:unknown,originalSync:Record<string,unknown>;
let verifiedDisposable=false;const bookingIds:number[]=[],patientIds:number[]=[],policySetIds:number[]=[];
const study=(i:number)=>({orthancStudyId:prefix+'_'+i,studyInstanceUid:'1.2.826.0.1.3680043.10.'+Date.now()+'.'+i,accessionNumber:prefix+'A'+i,patientId:prefix+'P'+i,patientName:'Synthetic Patient '+i,patientBirthDate:null,patientSex:null,studyDate:'20261029',studyDescription:'Synthetic CT '+i,modalitiesInStudy:['CT'],seriesCount:2,instanceCount:20});
const studies=Array.from({length:215},(_,i)=>study(i));
async function user(name:string,sign=true,supervise=false):Promise<Actor> {
  const id=(await pool.query("insert into users(username,password_hash,full_name,role,is_active) values($1,'synthetic-only',$1,$2,true) returning id",[prefix+name,supervise?'supervisor':'doctor'])).rows[0].id;
  const profile=(await pool.query("insert into doctor_portal.doctor_profiles(user_id,display_name,doctor_role,active,can_finalize_reports,can_assign_protocols,can_supervise) values($1,$2,'consultant',true,$3,true,$4) returning id",[id,prefix+name,sign,supervise])).rows[0].id;
  await pool.query("insert into doctor_portal.doctor_modality_permissions(doctor_id,modality_id,can_protocol,can_report,can_supervise,active) select $1,id,true,true,$2,true from modalities where code='CT'",[profile,supervise]);
  return {userId:id,appRole:supervise?'supervisor':'doctor'};
}
before(async()=>{
  const target=new URL(process.env.DATABASE_URL||'');assert.equal(target.hostname,'localhost');assert.equal(target.port,'5433');assert.equal(target.pathname,'/rispro_test');
  verifiedDisposable=true;
  originalPolicy=(await pool.query("select setting_value from system_settings where category='doctor_workspace' and setting_key='reporting_policy'")).rows[0]?.setting_value;
  originalSonic=(await pool.query("select setting_value from system_settings where category='sonicdicom_reports' and setting_key='sonicdicom_reports_enabled'")).rows[0]?.setting_value;
  originalSync=(await pool.query('select * from historical_pacs_sync_state')).rows[0];
  await pool.query("update system_settings set setting_value=$1 where category='doctor_workspace' and setting_key='reporting_policy'",[JSON.stringify({...DEFAULT_REPORTING_POLICY,enabled:true})]);
  await pool.query("insert into system_settings(category,setting_key,setting_value) values('sonicdicom_reports','sonicdicom_reports_enabled','{\"value\":\"disabled\"}') on conflict(category,setting_key) do update set setting_value=excluded.setting_value");
  __setAuthoritativeOrthancSettingsForTests(settings);
  __setAuthoritativeOrthancFetchForTests(async(input)=>{
    const id=new URL(String(input)).pathname.split('/')[2],s=studies.find(x=>x.orthancStudyId===id);
    if(!s)return new Response('{}',{status:404});
    return new Response(JSON.stringify({ID:id,MainDicomTags:{StudyInstanceUID:s.studyInstanceUid,AccessionNumber:s.accessionNumber,StudyDate:s.studyDate,StudyDescription:s.studyDescription,ModalitiesInStudy:'CT'},PatientMainDicomTags:{PatientID:s.patientId,PatientName:s.patientName},Series:['s1','s2']}));
  });
  await upsertHistoricalPacsStudies(studies);
  await pool.query('update historical_pacs_sync_state set source_archive_key=$1,last_success_at=now(),last_error=null',[authoritativeOrthancArchiveKey(settings)]);
  doctor=await user('doctor');other=await user('other');manager=await user('manager',true,true);noSign=await user('nosign',false);
});
after(async()=>{
  if(!verifiedDisposable){await pool.end();return;}
  __resetAuthoritativeOrthancForTests();
  await pool.query('delete from historical_pacs_studies where orthanc_study_id=any($1::text[])',[[...studies.map(s=>s.orthancStudyId),prefix+'_duplicate']]);
  // Retention remains enforced during every scenario. Exact synthetic fixture
  // teardown alone uses the disposable DB's existing replication-role pattern.
  const cleanup=await pool.connect();try{await cleanup.query('begin');await cleanup.query('set local session_replication_role=replica');
    const owned=(await cleanup.query('select n.id from native_reports n join native_report_study_links l on l.report_id=n.id join native_reporting_studies s on s.id=l.study_id where s.orthanc_study_id=any($1::text[])',[studies.map(s=>s.orthancStudyId)])).rows.map(r=>r.id);
    for(const table of ['native_report_review_events','native_report_contributors','native_report_versions','native_report_key_images','native_report_study_links'])await cleanup.query(`delete from ${table} where report_id=any($1::bigint[])`,[owned]);
    await cleanup.query('delete from native_reporting_studies where orthanc_study_id=any($1::text[])',[studies.map(s=>s.orthancStudyId)]);await cleanup.query('delete from native_reports where id=any($1::bigint[])',[owned]);
    await cleanup.query('delete from doctor_portal.case_team_assignments where appointment_id=any($1::bigint[])',[bookingIds]);await cleanup.query('delete from appointments_v2.bookings where id=any($1::bigint[])',[bookingIds]);await cleanup.query('delete from patients where id=any($1::bigint[])',[patientIds]);await cleanup.query('delete from appointments_v2.policy_versions where policy_set_id=any($1::bigint[])',[policySetIds]);await cleanup.query('delete from appointments_v2.policy_sets where id=any($1::bigint[])',[policySetIds]);await cleanup.query('commit');
  }catch(e){await cleanup.query('rollback');throw e;}finally{cleanup.release();}
  if(originalPolicy) await pool.query("update system_settings set setting_value=$1 where category='doctor_workspace' and setting_key='reporting_policy'",[JSON.stringify(originalPolicy)]);
  if(originalSonic) await pool.query("update system_settings set setting_value=$1 where category='sonicdicom_reports' and setting_key='sonicdicom_reports_enabled'",[JSON.stringify(originalSonic)]);
  if(originalSync) await pool.query('update historical_pacs_sync_state set source_archive_key=$1,last_success_at=$2,last_error=$3',[originalSync.source_archive_key,originalSync.last_success_at,originalSync.last_error]);
  await pool.end();
});
const content={clinicalHistory:'History',comparison:'None',technique:'CT',findings:'Normal findings',impression:'Normal impression'};
const create=(actor:Actor,i=0,mode='shared',reportType='primary')=>createWorkspaceReport(actor,studies[i].orthancStudyId,{mode,reportType,requestId:randomUUID()});
async function bookedStudy(i:number) {
  const s=studies[i],ct=(await pool.query("select id from modalities where code='CT'")).rows[0].id;
  const policySet=(await pool.query('insert into appointments_v2.policy_sets(key,name) values($1,$1) returning id',[prefix+'_'+i])).rows[0].id;policySetIds.push(Number(policySet));
  const version=(await pool.query("insert into appointments_v2.policy_versions(policy_set_id,version_no,status,config_hash) values($1,1,'draft','synthetic') returning id",[policySet])).rows[0].id;
  const patient=(await pool.query("insert into patients(arabic_full_name,english_full_name,normalized_arabic_name,identifier_type,identifier_value,age_years,sex) values($1,$1,$1,'other',$2,40,'O') returning id",[s.patientName,s.patientId])).rows[0].id;patientIds.push(Number(patient));
  const booking=(await pool.query("insert into appointments_v2.bookings(patient_id,modality_id,booking_date,case_category,status,requires_report,policy_version_id,study_instance_uid) values($1,$2,current_date,'non_oncology','completed',true,$3,$4) returning id",[patient,ct,version,s.studyInstanceUid])).rows[0].id;bookingIds.push(Number(booking));
  s.accessionNumber='V2-'+String(booking).padStart(6,'0');await upsertHistoricalPacsStudies([s]);
  return {s,ct,patient,booking};
}
test('catalogue pages 215+ studies, searches, filters, and includes unbooked studies without pixel retrieval',async()=>{
  const a=await listWorkspaceStudies(doctor,{q:prefix,limit:25});assert.equal(a.total,215);assert.equal(a.studies.length,25);assert.equal(a.freshness.status,'ready');
  const b=await listWorkspaceStudies(doctor,{q:studies[214].accessionNumber});assert.equal(b.total,1);assert.equal(b.studies[0].reporting_status,'no_report');assert.equal(b.studies[0].appointment_id,null);
  assert.equal((await listWorkspaceStudies(doctor,{q:prefix,offset:200,limit:25})).studies.length,15);
  assert.equal((await listWorkspaceStudies(doctor,{q:prefix,modality:'MR'})).total,0);
  assert.equal((await getWorkspaceStudy(doctor,studies[0].orthancStudyId)).reports.length,0);
});
test('shared and independent creation, sequential edits, optimistic conflicts, attribution and restoration',async()=>{
  const a=await create(doctor),independent=await create(other,0,'independent');assert.notEqual(a.id,independent.id);assert.equal(a.appointmentId,null);
  const saved=await saveWorkspaceDraft(doctor,a.id,{expectedRevision:a.revision,sections:content});
  const second=await saveWorkspaceDraft(other,a.id,{expectedRevision:saved.revision,sections:{...content,findings:'Second doctor edit'}});
  assert.equal(second.contributors.length,2);assert.equal(second.lastEditor,prefix+'other');
  await assert.rejects(()=>saveWorkspaceDraft(doctor,a.id,{expectedRevision:saved.revision,sections:content}),/Revision conflict/);
  await assert.rejects(()=>saveWorkspaceDraft(doctor,independent.id,{expectedRevision:independent.revision,sections:content}),/not editable/);
  const restored=await restoreWorkspaceRevision(doctor,a.id,{expectedRevision:second.revision,revision:2});assert.equal(restored.revision,4);assert.equal(restored.sections.findings,content.findings);
  const h=await workspaceHistory(doctor,a.id);assert.equal(h.versions.length,4);assert.equal(Number(h.versions[2].editorId),Number(other.userId));
});
test('optional review submission, feedback, return, withdrawal and protected deletion',async()=>{
  let r=await create(doctor,1);r=await saveWorkspaceDraft(doctor,r.id,{expectedRevision:r.revision,sections:content});
  r=await reviewWorkspaceReport(doctor,r.id,{expectedRevision:r.revision,action:'submit',comment:'Please review'});assert.equal(r.status,'in_review');
  await assert.rejects(()=>deleteWorkspaceDraft(doctor,r.id,{expectedRevision:r.revision,confirmed:true,reason:'test'}),/not permitted/);
  r=await reviewWorkspaceReport(other,r.id,{expectedRevision:r.revision,action:'feedback',comment:'Reviewed details'});
  r=await reviewWorkspaceReport(other,r.id,{expectedRevision:r.revision,action:'return',comment:'Revise'});assert.equal(r.status,'draft');
  assert.equal((await workspaceHistory(doctor,r.id)).reviews.length,3);
  r=await reviewWorkspaceReport(doctor,r.id,{expectedRevision:r.revision,action:'submit',comment:'Second review'});
  let policy=await readReportingPolicy();policy=await updateReportingPolicy(manager,{...policy,review:'none'});
  assert.equal((await getWorkspaceReport(doctor,r.id)).reviewEnabled,true);
  r=await reviewWorkspaceReport(doctor,r.id,{expectedRevision:r.revision,action:'withdraw',comment:'Review disabled'});assert.equal(r.status,'draft');
  await assert.rejects(()=>reviewWorkspaceReport(doctor,r.id,{expectedRevision:r.revision,action:'submit'}),/Unsupported review transition/);
  await updateReportingPolicy(manager,{...policy,review:'optional'});
});
test('direct finalization credits signer, preserves immutable primary and rejects simultaneous competing finals',async()=>{
  let a=await create(doctor,2),b=await create(other,2);
  a=await saveWorkspaceDraft(doctor,a.id,{expectedRevision:a.revision,sections:content});b=await saveWorkspaceDraft(other,b.id,{expectedRevision:b.revision,sections:content});
  await assert.rejects(()=>finalizeWorkspaceReport(noSign,a.id,{expectedRevision:a.revision,requestId:randomUUID(),confirmed:true,signerUserId:noSign.userId}),/Signing permission/);
  const outcomes=await Promise.allSettled([finalizeWorkspaceReport(other,a.id,{expectedRevision:a.revision,requestId:randomUUID(),confirmed:true,signerUserId:other.userId}),finalizeWorkspaceReport(doctor,b.id,{expectedRevision:b.revision,requestId:randomUUID(),confirmed:true,signerUserId:doctor.userId})]);
  assert.equal(outcomes.filter(x=>x.status==='fulfilled').length,1);assert.equal(outcomes.filter(x=>x.status==='rejected').length,1);
  const final=outcomes.find(x=>x.status==='fulfilled') as PromiseFulfilledResult<Awaited<ReturnType<typeof finalizeWorkspaceReport>>>;
  assert.equal(final.value.status,'final');assert.equal(final.value.isPrimary,true);
  await assert.rejects(()=>pool.query('update native_reports set sections=$2 where id=$1',[final.value.id,JSON.stringify(content)]),/immutable/);
  const extra=await create(doctor,2,'independent','second_opinion');const saved=await saveWorkspaceDraft(doctor,extra.id,{expectedRevision:extra.revision,sections:content});
  const signed=await finalizeWorkspaceReport(doctor,saved.id,{expectedRevision:saved.revision,requestId:randomUUID(),confirmed:true,signerUserId:doctor.userId});assert.equal(signed.isPrimary,false);
  const list=await listWorkspaceStudies(doctor,{q:studies[2].accessionNumber});assert.equal(list.studies[0].reporting_status,'final');assert.equal(list.studies[0].report_count,3);
  const added=await addWorkspaceAddendum(doctor,signed.id,{expectedRevision:signed.revision,requestId:randomUUID(),confirmed:true,text:'Traceable correction'});assert.equal(added.addenda.length,1);
});
test('an additional interpretation alone never marks a study primary-final or draft',async()=>{
  const before=await doctorDashboard(doctor,30);
  let r=await create(doctor,15,'independent','second_opinion');r=await saveWorkspaceDraft(doctor,r.id,{expectedRevision:r.revision,sections:content});
  const signed=await finalizeWorkspaceReport(doctor,r.id,{expectedRevision:r.revision,requestId:randomUUID(),confirmed:true,signerUserId:doctor.userId});assert.equal(signed.isPrimary,false);
  const catalogue=await listWorkspaceStudies(doctor,{q:studies[15].accessionNumber});assert.equal(catalogue.studies[0].reporting_status,'additional_reports');
  assert.equal((await listWorkspaceStudies(doctor,{q:studies[15].accessionNumber,status:'draft'})).total,0);
  assert.equal((await listWorkspaceStudies(doctor,{q:studies[15].accessionNumber,status:'final'})).total,0);
  assert.equal((await doctorDashboard(doctor,30)).departmentCompleted,before.departmentCompleted);
});

test('unrestricted independent signatures never acquire a second authoritative primary',async()=>{
  const policy=await readReportingPolicy();await updateReportingPolicy(manager,{...policy,additional:'unrestricted'});
  try {
    let a=await create(doctor,18,'independent'),b=await create(other,18,'independent');
    a=await saveWorkspaceDraft(doctor,a.id,{expectedRevision:a.revision,sections:content});b=await saveWorkspaceDraft(other,b.id,{expectedRevision:b.revision,sections:content});
    const results=await Promise.all([finalizeWorkspaceReport(doctor,a.id,{expectedRevision:a.revision,requestId:randomUUID(),confirmed:true,signerUserId:doctor.userId}),finalizeWorkspaceReport(other,b.id,{expectedRevision:b.revision,requestId:randomUUID(),confirmed:true,signerUserId:other.userId})]);
    assert.equal(results.filter(r=>r.isPrimary).length,1);
    assert.equal((await getWorkspaceStudy(doctor,studies[18].orthancStudyId)).primaryReportId,results.find(r=>r.isPrimary)!.id);
    assert.equal((await workspaceHistory(doctor,Number(a.id))).versions.filter(v=>v.kind==='final').length,1);
  }finally{await updateReportingPolicy(manager,{...await readReportingPolicy(),additional:policy.additional});}
});

test('database rejects additional primary flags and duplicate legacy primary finals without changing signed rows',async()=>{
  const primary=(await pool.query("select n.* from native_reports n join native_report_study_links l on l.report_id=n.id join native_reporting_studies s on s.id=l.study_id where s.orthanc_study_id=$1 and n.status='final' and n.is_primary",[studies[2].orthancStudyId])).rows[0];
  const insert=`insert into native_reports(primary_study_uid,imaging_source,identity,status,sections,author_user_id,author_name,report_type,is_primary,finalized_by_user_id,finalized_at,signed_snapshot)
    values($1,$2,$3,'final',$4,$5,'Synthetic',$6,true,$5,now(),'{}')`;
  await assert.rejects(()=>pool.query(insert,[primary.primary_study_uid,JSON.stringify(primary.imaging_source),JSON.stringify(primary.identity),JSON.stringify(content),doctor.userId,'second_opinion']),/additional interpretation/);
  await assert.rejects(()=>pool.query(insert,[primary.primary_study_uid,JSON.stringify({accessStrategy:'authoritative_orthanc',sourcePacsNodeId:null}),JSON.stringify(primary.identity),JSON.stringify(content),doctor.userId,'primary']),/primary final already exists/);
  assert.deepEqual((await pool.query('select * from native_reports where id=$1',[primary.id])).rows[0],primary);
});

test('cached external ownership still blocks native creation when the external integration is disabled',async()=>{
  const {booking}=await bookedStudy(17);
  await pool.query("insert into doctor_portal.reporting_board_sonicdicom_cache(appointment_id,report_status,last_attempt_at) values($1,'draft',now())",[booking]);
  const row=(await listWorkspaceStudies(doctor,{q:studies[17].accessionNumber})).studies[0];
  assert.equal(row.reporting_status,'no_report');assert.equal(row.external_reporting_status,'external_draft');
  await assert.rejects(()=>create(doctor,17),/External reporting ownership/);
});

test('single-author soft deletion, recreation and supervisor recovery retain versions',async()=>{
  const a=await create(doctor,3,'independent');const removed=await deleteWorkspaceDraft(doctor,a.id,{expectedRevision:a.revision,confirmed:true,reason:'Wrong template'});assert.ok(removed.deletedAt);
  await assert.rejects(()=>getWorkspaceReport(doctor,a.id),/not found/);
  const fresh=await create(doctor,3,'independent');assert.notEqual(fresh.id,a.id);
  const restored=await deleteWorkspaceDraft(manager,a.id,{expectedRevision:removed.revision,confirmed:true,reason:'Recovery requested'},true);assert.equal(restored.deletedAt,null);
  const shared=await create(doctor,4);const edited=await saveWorkspaceDraft(other,shared.id,{expectedRevision:shared.revision,sections:content});
  await assert.rejects(()=>deleteWorkspaceDraft(doctor,edited.id,{expectedRevision:edited.revision,confirmed:true,reason:'test'}),/supervisor/);
  assert.equal((await deleteWorkspaceDraft(manager,edited.id,{expectedRevision:edited.revision,confirmed:true,reason:'Supervisor approved'})).deletedAt!==null,true);
});
test('runtime policies enforce creation, collaboration, signing and feature rollback',async()=>{
  let p=await readReportingPolicy();p=await updateReportingPolicy(manager,{...p,creation:'assigned'});
  await assert.rejects(()=>create(doctor,5),/assignment/);
  p=await updateReportingPolicy(manager,{...p,creation:'accessible',collaboration:'shared'});await assert.rejects(()=>create(doctor,5,'independent'),/collaboration/);
  p=await updateReportingPolicy(manager,{...p,collaboration:'both',enabled:false});await assert.rejects(()=>create(doctor,5),/disabled/);
  const existing=(await pool.query('select n.id from native_reports n join native_report_study_links l on l.report_id=n.id join native_reporting_studies s on s.id=l.study_id where s.orthanc_study_id=$1 and n.status=\'final\' limit 1',[studies[2].orthancStudyId])).rows[0];
  assert.equal((await getWorkspaceReport(doctor,Number(existing.id))).status,'final');
  p=await updateReportingPolicy(manager,{...p,enabled:true,signing:'review'});
  const completed=await getWorkspaceReport(doctor,Number(existing.id));
  assert.equal((await addWorkspaceAddendum(doctor,completed.id,{expectedRevision:completed.revision,requestId:randomUUID(),confirmed:true,text:'Correction after policy update'})).addenda.length>=1,true);
  await updateReportingPolicy(manager,{...p,signing:'permission'});
});
test('dashboard and assigned worklist use backend aggregation and signer attribution',async()=>{
  const dashboard=await doctorDashboard(doctor,30);assert.ok(dashboard.totalFinalized>=1);assert.equal(dashboard.workload.assigned,0);assert.ok(dashboard.departmentCompleted>=1);
  assert.equal((await assignedWork(doctor,{})).total,0);
});
test('mandatory review follows the creator role, including when another consultant signs',async()=>{
  let p=await readReportingPolicy();p=await updateReportingPolicy(manager,{...p,review:'mandatory',mandatoryReviewRoles:['resident']});
  await pool.query("update doctor_portal.doctor_profiles set doctor_role='resident' where user_id=$1",[doctor.userId]);
  let r=await create(doctor,9);r=await saveWorkspaceDraft(doctor,r.id,{expectedRevision:r.revision,sections:content});
  await assert.rejects(()=>finalizeWorkspaceReport(other,r.id,{expectedRevision:r.revision,requestId:randomUUID(),confirmed:true,signerUserId:other.userId}),/Signing permission/);
  r=await reviewWorkspaceReport(doctor,r.id,{expectedRevision:r.revision,action:'submit',comment:'Training review'});
  await assert.rejects(()=>finalizeWorkspaceReport(doctor,r.id,{expectedRevision:r.revision,requestId:randomUUID(),confirmed:true,signerUserId:doctor.userId}),/Signing permission/);
  const requestId=randomUUID(),expected=r.revision;
  const signed=await finalizeWorkspaceReport(other,r.id,{expectedRevision:expected,requestId,confirmed:true,signerUserId:other.userId});
  const retry=await finalizeWorkspaceReport(other,r.id,{expectedRevision:expected,requestId,confirmed:true,signerUserId:other.userId});assert.equal(retry.revision,signed.revision);
  await assert.rejects(()=>pool.query('update native_reporting_studies set primary_report_id=null where primary_report_id=$1',[signed.id]),/cannot be replaced/);
  await assert.rejects(()=>pool.query('delete from native_report_study_links where report_id=$1',[signed.id]),/immutable/);
  await pool.query("update doctor_portal.doctor_profiles set doctor_role='consultant' where user_id=$1",[doctor.userId]);
  await updateReportingPolicy(manager,{...p,review:'optional'});
});
test('template prompts cannot be signed; reports remain readable during catalogue outages',async()=>{
  const r=await createWorkspaceReport(doctor,studies[10].orthancStudyId,{mode:'independent',reportType:'primary',template:'structured',requestId:randomUUID()});
  await assert.rejects(()=>finalizeWorkspaceReport(doctor,r.id,{expectedRevision:r.revision,requestId:randomUUID(),confirmed:true,signerUserId:doctor.userId}),/template prompts/);
  await pool.query('update historical_pacs_sync_state set source_archive_key=null');
  const preserved=await getWorkspaceReport(doctor,r.id);assert.equal(preserved.id,r.id);assert.equal(preserved.canEdit,false);
  await pool.query('update historical_pacs_sync_state set source_archive_key=$1,last_success_at=now(),last_error=null',[authoritativeOrthancArchiveKey(settings)]);
});
test('verified assigned examinations use authoritative study finality and credit the actual signer',async()=>{
  const {s,ct,booking}=await bookedStudy(13);
  const doctorId=(await pool.query('select id from doctor_portal.doctor_profiles where user_id=$1',[doctor.userId])).rows[0].id;
  await pool.query("insert into doctor_portal.case_team_assignments(appointment_id,assigned_doctor_id,modality_id,assignment_type,status) values($1,$2,$3,'reporting','active')",[booking,doctorId,ct]);
  const before=await doctorDashboard(doctor,30);assert.equal(before.workload.pending,1);
  const work=await assignedWork(doctor,{status:'pending'});assert.equal(work.total,1);assert.equal(work.cases[0].patientId,s.patientId);assert.equal(work.cases[0].studyKey,s.orthancStudyId);
  let peer=await create(doctor,13,'shared','peer_review');peer=await saveWorkspaceDraft(doctor,peer.id,{expectedRevision:peer.revision,sections:content});peer=await reviewWorkspaceReport(doctor,peer.id,{expectedRevision:peer.revision,action:'submit'});
  await finalizeWorkspaceReport(other,peer.id,{expectedRevision:peer.revision,requestId:randomUUID(),confirmed:true,signerUserId:other.userId});
  assert.equal((await doctorDashboard(doctor,30)).departmentCompleted,before.departmentCompleted);assert.equal((await assignedWork(doctor,{status:'in_review'})).total,0);assert.equal((await assignedWork(doctor,{status:'pending'})).total,1);
  let r=await create(doctor,13);assert.equal(r.appointmentId,Number(booking));r=await saveWorkspaceDraft(doctor,r.id,{expectedRevision:r.revision,sections:content});
  await finalizeWorkspaceReport(other,r.id,{expectedRevision:r.revision,requestId:randomUUID(),confirmed:true,signerUserId:other.userId});
  const after=await doctorDashboard(doctor,30);assert.equal(after.workload.pending,0);assert.equal(after.totalFinalized,before.totalFinalized);assert.equal(after.departmentCompleted,before.departmentCompleted+1);assert.equal((await assignedWork(doctor,{status:'final'})).total,1);
  let additional=await create(doctor,13,'independent','second_opinion');additional=await saveWorkspaceDraft(doctor,additional.id,{expectedRevision:additional.revision,sections:content});await finalizeWorkspaceReport(doctor,additional.id,{expectedRevision:additional.revision,requestId:randomUUID(),confirmed:true,signerUserId:doctor.userId});
  assert.equal((await doctorDashboard(doctor,30)).departmentCompleted,after.departmentCompleted);
  const duplicateAccession=studies[14];duplicateAccession.accessionNumber=s.accessionNumber;await upsertHistoricalPacsStudies([duplicateAccession]);await assert.rejects(()=>create(doctor,14),/without a verified matching study/);
});

test('adopting an existing legacy final preserves its exact signed row, snapshot and history',async()=>{
  const {s,patient,booking}=await bookedStudy(16);
  const identity={patientName:s.patientName,patientIdentifier:s.patientId,accession:s.accessionNumber,examination:s.studyDescription,studyDate:s.studyDate};
  const snapshot={identity,sections:content,keyImages:[],author:prefix+'doctor',finalizer:prefix+'other',signedAt:new Date().toISOString()};
  const legacy=(await pool.query(`insert into native_reports(appointment_id,patient_id,primary_study_uid,imaging_source,identity,status,sections,author_user_id,author_name,finalized_by_user_id,finalizer_name,finalized_at,signed_snapshot,finalize_request_id)
    values($1,$2,$3,$4,$5,'final',$6,$7,$8,$9,$10,$11,$12,$13) returning *`,[booking,patient,s.studyInstanceUid,JSON.stringify({accessStrategy:'authoritative_orthanc',sourcePacsNodeId:null}),JSON.stringify(identity),JSON.stringify(content),doctor.userId,prefix+'doctor',other.userId,prefix+'other',snapshot.signedAt,JSON.stringify(snapshot),randomUUID()])).rows[0];
  await pool.query("insert into native_report_versions(report_id,revision,kind,snapshot,actor_user_id,actor_name) values($1,1,'final',$2,$3,$4)",[legacy.id,JSON.stringify(snapshot),other.userId,prefix+'other']);
  const selected=await getWorkspaceStudy(doctor,s.orthancStudyId);assert.equal(selected.primaryReportId,Number(legacy.id));assert.equal(selected.reports.length,1);
  assert.deepEqual((await pool.query('select * from native_reports where id=$1',[legacy.id])).rows[0],legacy);
  assert.deepEqual((await workspaceHistory(doctor,Number(legacy.id))).versions[0].snapshot,snapshot);
  assert.equal((await create(doctor,16,'independent','second_opinion')).isPrimary,false);
  assert.deepEqual((await pool.query('select * from native_reports where id=$1',[legacy.id])).rows[0],legacy);
});
test('changed patient identity, ambiguous UID, stale catalogue and archive switches fail closed',async()=>{
  const existing=await create(doctor,12);const original=studies[12].patientId;
  studies[12].patientId='RECONCILED-DIFFERENT-ID';await upsertHistoricalPacsStudies([studies[12]]);
  assert.equal((await getWorkspaceReport(doctor,existing.id)).canEdit,false);
  await assert.rejects(()=>saveWorkspaceDraft(doctor,existing.id,{expectedRevision:existing.revision,sections:content}),/identity changed/);
  studies[12].patientId=original;await upsertHistoricalPacsStudies([studies[12]]);
  const s=studies[6],old=s.patientId;s.patientId='DIFFERENT';await assert.rejects(()=>create(doctor,6),/identity changed/);s.patientId=old;
  await upsertHistoricalPacsStudies([{...studies[7],orthancStudyId:prefix+'_duplicate'}]);await assert.rejects(()=>create(doctor,7),/Ambiguous/);
  await pool.query("update historical_pacs_sync_state set last_success_at=now()-interval '1 hour'");await assert.rejects(()=>create(doctor,8),/stale/);
  await pool.query('update historical_pacs_sync_state set last_success_at=now(),source_archive_key=$1',['other-archive']);const list=await listWorkspaceStudies(doctor,{q:prefix});assert.equal(list.freshness.status,'unavailable');assert.equal(list.studies.length,0);
});
