import assert from 'node:assert/strict';
import {after,before,test} from 'node:test';
import express from 'express';
import cookieParser from 'cookie-parser';
import jwt from 'jsonwebtoken';
import {readFile,unlink} from 'node:fs/promises';
import {resolve} from 'node:path';
import sharp from 'sharp';
import {storeReportImage,readReportImage} from './report-image-storage-service.js';
import {nativeReportingRouter} from './reporting-routes.js';
import {errorHandler} from '../../middleware/error-handler.js';
import {randomUUID} from 'node:crypto';
import {pool} from '../../db/pool.js';
import {DEFAULT_REPORTING_POLICY,readReportingPolicy,updateReportingPolicy} from './reporting-policy.js';
import {authoritativeOrthancArchiveKey,__setAuthoritativeOrthancSettingsForTests,__setAuthoritativeOrthancFetchForTests,__resetAuthoritativeOrthancForTests,type AuthoritativeOrthancSettings} from '../../services/authoritative-orthanc-service.js';
import {upsertHistoricalPacsStudies,runHistoricalPacsSyncCycle} from '../../services/historical-pacs-index-service.js';
import {listWorkspaceStudies,archiveStatus} from './workspace-study-service.js';
import {createWorkspaceReport,getWorkspaceStudy,saveWorkspaceDraft,finalizeWorkspaceReport,reviewWorkspaceReport,deleteWorkspaceDraft,workspaceHistory,restoreWorkspaceRevision,getWorkspaceReport,addWorkspaceAddendum} from './workspace-report-service.js';
import {doctorDashboard,assignedWork} from './workspace-dashboard-service.js';
import {getDoctorReportingAppointments} from '../doctor-portal/cases-service.js';
import {launchWorkspaceStudyImages,authorizeWorkspaceViewer} from './workspace-viewer-service.js';
import {env} from '../../config/env.js';
import {findViewerContext,consumeViewerLaunchToken} from '../ohif-viewer/repository.js';
import {hashLaunchToken} from '../ohif-viewer/validation.js';
import type {Actor} from '../doctor-portal/reporting-board-service.js';
import {listReportingBoardCasesByAppointmentIds,listReportingBoardCaseCandidates} from '../doctor-portal/reporting-board-repository.js';
import {DEFAULT_SONICDICOM_REPORT_SETTINGS} from '../../services/sonicdicom-report-settings.js';
import {refreshWorkspaceSonicStudies,workspaceSonicSourceKey,enqueueWorkspaceSonicStudies} from '../../services/workspace-sonicdicom-cache-service.js';
const prefix='wv2_'+Date.now(),settings:AuthoritativeOrthancSettings={enabled:true,baseUrl:'http://127.0.0.1:19481',username:'synthetic',password:'synthetic',timeoutSeconds:2,verifyTls:true,displayName:'Synthetic',autoExportClinicalDocuments:false,autoRouteEnabled:false,autoRouteDestinationKey:'',autoRouteDestinationKeys:[]};
let doctor:Actor,other:Actor,manager:Actor,noSign:Actor,upstreamUnavailable=false;
let originalPolicy:unknown,originalSonic:unknown,originalSonicConfig:unknown,originalSync:Record<string,unknown>;
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
  originalSonicConfig=(await pool.query("select setting_value from system_settings where category='sonicdicom_reports' and setting_key='config'")).rows[0]?.setting_value;
  await pool.query("insert into system_settings(category,setting_key,setting_value) values('sonicdicom_reports','config',$1) on conflict(category,setting_key) do update set setting_value=excluded.setting_value",[JSON.stringify(DEFAULT_SONICDICOM_REPORT_SETTINGS)]);
  originalSync=(await pool.query('select * from historical_pacs_sync_state')).rows[0];
  await pool.query("update system_settings set setting_value=$1 where category='doctor_workspace' and setting_key='reporting_policy'",[JSON.stringify({...DEFAULT_REPORTING_POLICY,enabled:true})]);
  await pool.query("insert into system_settings(category,setting_key,setting_value) values('sonicdicom_reports','sonicdicom_reports_enabled','{\"value\":\"disabled\"}') on conflict(category,setting_key) do update set setting_value=excluded.setting_value");
  __setAuthoritativeOrthancSettingsForTests(settings);
  __setAuthoritativeOrthancFetchForTests(async(input)=>{
    if(upstreamUnavailable)throw new Error('Synthetic Orthanc connectivity outage');
    const id=new URL(String(input)).pathname.split('/')[2],s=studies.find(x=>x.orthancStudyId===id);
    if(!s)return new Response('{}',{status:404});
    return new Response(JSON.stringify({ID:id,MainDicomTags:{StudyInstanceUID:s.studyInstanceUid,AccessionNumber:s.accessionNumber,StudyDate:s.studyDate,StudyDescription:s.studyDescription,ModalitiesInStudy:s.modalitiesInStudy.join('\\')},PatientMainDicomTags:{PatientID:s.patientId,PatientName:s.patientName},Series:['s1','s2']}));
  });
  await upsertHistoricalPacsStudies(studies);
  await pool.query('update historical_pacs_sync_state set source_archive_key=$1,last_success_at=now(),last_error=null',[authoritativeOrthancArchiveKey(settings)]);
  doctor=await user('doctor');other=await user('other');manager=await user('manager',true,true);noSign=await user('nosign',false);
});
after(async()=>{
  if(!verifiedDisposable){await pool.end();return;}
  __resetAuthoritativeOrthancForTests();
  await pool.query('delete from doctor_portal.workspace_sonicdicom_cache where orthanc_study_id=any($1::text[])',[studies.map(s=>s.orthancStudyId)]);
  await pool.query('delete from historical_pacs_studies where orthanc_study_id=any($1::text[])',[[...studies.map(s=>s.orthancStudyId),prefix+'_duplicate']]);
  // Retention remains enforced during every scenario. Exact synthetic fixture
  // teardown alone uses the disposable DB's existing replication-role pattern.
  const cleanup=await pool.connect();try{await cleanup.query('begin');await cleanup.query('set local session_replication_role=replica');
    const owned=(await cleanup.query('select n.id from native_reports n join native_report_study_links l on l.report_id=n.id join native_reporting_studies s on s.id=l.study_id where s.orthanc_study_id=any($1::text[])',[studies.map(s=>s.orthancStudyId)])).rows.map(r=>r.id);
    for(const table of ['native_report_review_events','native_report_contributors','native_report_versions','native_report_key_images','native_report_study_links'])await cleanup.query(`delete from ${table} where report_id=any($1::bigint[])`,[owned]);
    await cleanup.query('delete from viewer_launch_sessions where reporting_study_key in (select id from native_reporting_studies where orthanc_study_id=any($1::text[]))',[studies.map(s=>s.orthancStudyId)]);
    await cleanup.query('delete from native_reporting_studies where orthanc_study_id=any($1::text[])',[studies.map(s=>s.orthancStudyId)]);await cleanup.query('delete from native_reports where id=any($1::bigint[])',[owned]);
    await cleanup.query('delete from doctor_portal.case_team_assignments where appointment_id=any($1::bigint[])',[bookingIds]);await cleanup.query('delete from appointments_v2.bookings where id=any($1::bigint[])',[bookingIds]);await cleanup.query('delete from patients where id=any($1::bigint[])',[patientIds]);await cleanup.query('delete from appointments_v2.policy_versions where policy_set_id=any($1::bigint[])',[policySetIds]);await cleanup.query('delete from appointments_v2.policy_sets where id=any($1::bigint[])',[policySetIds]);await cleanup.query('commit');
  }catch(e){await cleanup.query('rollback');throw e;}finally{cleanup.release();}
  if(originalPolicy) await pool.query("update system_settings set setting_value=$1 where category='doctor_workspace' and setting_key='reporting_policy'",[JSON.stringify(originalPolicy)]);
  if(originalSonic) await pool.query("update system_settings set setting_value=$1 where category='sonicdicom_reports' and setting_key='sonicdicom_reports_enabled'",[JSON.stringify(originalSonic)]);
  if(originalSonicConfig)await pool.query("update system_settings set setting_value=$1 where category='sonicdicom_reports' and setting_key='config'",[JSON.stringify(originalSonicConfig)]);
  else await pool.query("delete from system_settings where category='sonicdicom_reports' and setting_key='config'");
  if(originalSync) {
    const columns=Object.keys(originalSync).filter(k=>k!=='singleton_key');assert.ok(columns.every(k=>/^[a-z_]+$/.test(k)));
    await pool.query(`update historical_pacs_sync_state set (${columns.join(',')})=(select ${columns.join(',')} from jsonb_populate_record(null::historical_pacs_sync_state,$1)) where singleton_key=true`,[JSON.stringify(originalSync)]);
  }
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
  await assert.rejects(()=>deleteWorkspaceDraft(manager,a.id,{expectedRevision:removed.revision,confirmed:true,reason:'Recovery requested'},true),/replacement report/i);
  await deleteWorkspaceDraft(doctor,fresh.id,{expectedRevision:fresh.revision,confirmed:true,reason:'Replacement withdrawn'});
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
test('reporting appointments retain unlinked cases, verify associations and preserve doctor/modality scope',async()=>{
  const linked=await bookedStudy(20),unlinked=await bookedStudy(21);
  const doctorId=(await pool.query('select id from doctor_portal.doctor_profiles where user_id=$1',[doctor.userId])).rows[0].id;
  for(const b of [linked,unlinked])await pool.query("insert into doctor_portal.case_team_assignments(appointment_id,assigned_doctor_id,modality_id,assignment_type,status) values($1,$2,$3,'reporting','active')",[b.booking,doctorId,b.ct]);
  await pool.query('update appointments_v2.bookings set study_instance_uid=null where id=$1',[unlinked.booking]);
  await pool.query('delete from historical_pacs_studies where orthanc_study_id=$1',[unlinked.s.orthancStudyId]);
  const archiveKey=authoritativeOrthancArchiveKey(settings);
  const page=await getDoctorReportingAppointments(doctor,{q:linked.s.accessionNumber},archiveKey);
  assert.equal(page.total,1);assert.equal(page.appointments[0].studyKey,linked.s.orthancStudyId);assert.equal(page.appointments[0].reportingStatus,'no_report');
  const missing=await getDoctorReportingAppointments(doctor,{q:unlinked.s.accessionNumber},archiveKey);
  assert.equal(missing.total,1);assert.equal(missing.appointments[0].studyKey,null);assert.equal(missing.appointments[0].reportingStatus,null);
  assert.equal((await listWorkspaceStudies(doctor,{q:unlinked.s.accessionNumber})).total,0);
  assert.equal((await getDoctorReportingAppointments(other,{q:linked.s.accessionNumber},archiveKey)).total,0);
  assert.equal((await getDoctorReportingAppointments(manager,{q:linked.s.accessionNumber},archiveKey)).total,1);
  assert.equal((await getDoctorReportingAppointments(doctor,{q:linked.s.accessionNumber,modality:'MR'},archiveKey)).total,0);
  assert.equal((await getDoctorReportingAppointments(doctor,{q:linked.s.accessionNumber},null)).appointments[0].studyKey,null);
  const r=await create(doctor,20);assert.equal((await getDoctorReportingAppointments(doctor,{q:linked.s.accessionNumber,status:'draft'},archiveKey)).total,1);
  await deleteWorkspaceDraft(doctor,r.id,{expectedRevision:r.revision,confirmed:true,reason:'Synthetic deletion'});
  assert.equal((await getDoctorReportingAppointments(doctor,{q:linked.s.accessionNumber,status:'draft'},archiveKey)).total,0);
  await pool.query('update historical_pacs_studies set patient_id=$2 where orthanc_study_id=$1',[linked.s.orthancStudyId,'DIFFERENT']);
  assert.equal((await getDoctorReportingAppointments(doctor,{q:linked.s.accessionNumber},archiveKey)).appointments[0].studyKey,null);
  await upsertHistoricalPacsStudies([linked.s]);
});

test('study-only image launch reuses authorized OHIF sessions without reports or bookings and fails closed',async()=>{
  const oldEnabled=env.ohifEnabled,originalFetch=globalThis.fetch,config=(await pool.query('select * from ohif_viewer_settings where singleton_key=true')).rows[0];
  const key=studies[22].orthancStudyId,count=async()=>Number((await pool.query('select count(*) n from native_reports')).rows[0].n),before=await count();
  try {
    env.ohifEnabled=true;
    await pool.query("update ohif_viewer_settings set enabled=true,access_strategy='authoritative_orthanc',allow_prior_studies=false,open_mode='new_tab' where singleton_key=true");
    const launch=await launchWorkspaceStudyImages(doctor,key);assert.equal(launch.status,'ready');assert.equal(launch.openMode,'new_tab');assert.match(launch.launchUrl,/^\/api\/ohif\/launch\//);
    const sessionRow=(await pool.query('select * from viewer_launch_sessions where user_id=$1 and study_instance_uid=$2 order by id desc limit 1',[doctor.userId,studies[22].studyInstanceUid])).rows[0];
    assert.equal(sessionRow.reporting_report_id,null);assert.equal(sessionRow.appointment_id,null);assert.deepEqual(sessionRow.permitted_study_uids,[studies[22].studyInstanceUid]);
    await consumeViewerLaunchToken(hashLaunchToken(decodeURIComponent(launch.launchUrl.split('/').pop()!)),doctor.userId,hashLaunchToken('synthetic-session'),new Date(Date.now()+600_000));
    const session=await findViewerContext(sessionRow.report_context_id,doctor.userId);assert.ok(session);await authorizeWorkspaceViewer(doctor,session);
    assert.equal(await count(),before);
    await pool.query('update historical_pacs_studies set modalities_in_study=$2 where orthanc_study_id=$1',[key,['MR']]);
    await assert.rejects(()=>launchWorkspaceStudyImages(doctor,key),/permission/);await assert.rejects(()=>authorizeWorkspaceViewer(doctor,session),/permission/);
    await upsertHistoricalPacsStudies([studies[22]]);
    studies[22].modalitiesInStudy=['MR'];await assert.rejects(()=>launchWorkspaceStudyImages(doctor,key),/live study/);studies[22].modalitiesInStudy=['CT'];
    const patient=studies[22].patientId;studies[22].patientId='DIFFERENT';await assert.rejects(()=>launchWorkspaceStudyImages(doctor,key),/identity changed/);studies[22].patientId=patient;
    await pool.query("update ohif_viewer_settings set enabled=false where singleton_key=true");await assert.rejects(()=>launchWorkspaceStudyImages(doctor,studies[23].orthancStudyId),/Enable/);
    assert.equal((await pool.query('select 1 from native_reporting_studies where orthanc_study_id=$1',[studies[23].orthancStudyId])).rowCount,0);
    await pool.query("update ohif_viewer_settings set enabled=true,open_mode='same_tab' where singleton_key=true");assert.equal((await launchWorkspaceStudyImages(doctor,key)).openMode,'same_tab');
    // Reuse the existing patient/issuer selection and restrict priors to this
    // doctor's modalities, without another catalogue or any report creation.
    await pool.query('update ohif_viewer_settings set allow_prior_studies=true where singleton_key=true');
    globalThis.fetch=async()=>new Response(JSON.stringify([
      {StudyInstanceUID:studies[22].studyInstanceUid,PatientID:studies[22].patientId,ModalitiesInStudy:['CT'],StudyDate:'20261029'},
      {StudyInstanceUID:studies[23].studyInstanceUid,PatientID:studies[22].patientId,ModalitiesInStudy:['CT'],StudyDate:'20261028'},
      {StudyInstanceUID:studies[24].studyInstanceUid,PatientID:studies[22].patientId,ModalitiesInStudy:['MR'],StudyDate:'20261028'},
      {StudyInstanceUID:studies[25].studyInstanceUid,PatientID:'OTHER-PATIENT',ModalitiesInStudy:['CT'],StudyDate:'20261028'},
    ]));
    await launchWorkspaceStudyImages(doctor,key);
    assert.deepEqual((await pool.query('select permitted_study_uids from viewer_launch_sessions where user_id=$1 and study_instance_uid=$2 order by id desc limit 1',[doctor.userId,studies[22].studyInstanceUid])).rows[0].permitted_study_uids,[studies[22].studyInstanceUid,studies[23].studyInstanceUid]);
    await pool.query("update historical_pacs_sync_state set source_archive_key='other-archive'");await assert.rejects(()=>launchWorkspaceStudyImages(doctor,key),/synchronized/);await assert.rejects(()=>authorizeWorkspaceViewer(doctor,session),/synchronized/);
    assert.equal(await count(),before);
  } finally {
    env.ohifEnabled=oldEnabled;globalThis.fetch=originalFetch;studies[22].modalitiesInStudy=['CT'];
    await pool.query('update ohif_viewer_settings set enabled=$1,access_strategy=$2,allow_prior_studies=$3,open_mode=$4 where singleton_key=true',[config.enabled,config.access_strategy,config.allow_prior_studies,config.open_mode]);
    await pool.query('update historical_pacs_sync_state set source_archive_key=$1,last_success_at=now(),last_error=null',[authoritativeOrthancArchiveKey(settings)]);
  }
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
  await pool.query('update historical_pacs_sync_state set source_archive_key=$1,last_success_at=now(),last_error=null',[authoritativeOrthancArchiveKey(settings)]);
});

test('review aggregation separates designated, open, submitted and shared contributions without double counting',async()=>{
  const reviewer=await user('reviewcounts'),reviewerId=(await pool.query('select id from doctor_portal.doctor_profiles where user_id=$1',[reviewer.userId])).rows[0].id;
  const initial=await doctorDashboard(reviewer,7);
  let designated=await create(doctor,26),open=await create(doctor,27),own=await create(reviewer,28);
  designated=await saveWorkspaceDraft(reviewer,designated.id,{expectedRevision:designated.revision,sections:content});
  designated=await reviewWorkspaceReport(doctor,designated.id,{expectedRevision:designated.revision,action:'submit',preferredReviewerId:Number(reviewerId)});
  open=await reviewWorkspaceReport(doctor,open.id,{expectedRevision:open.revision,action:'submit'});
  own=await reviewWorkspaceReport(reviewer,own.id,{expectedRevision:own.revision,action:'submit'});
  const current=await doctorDashboard(reviewer,7);
  assert.equal(current.workload.awaiting_review,initial.workload.awaiting_review+1);
  assert.equal(current.workload.open_review,initial.workload.open_review+1);
  assert.equal(current.workload.submitted,1);assert.equal(current.workload.shared,2);assert.equal(current.workload.drafts,2);
  const policy=await readReportingPolicy();await updateReportingPolicy(manager,{...policy,reviewEligibility:'designated'});
  try {
    const restricted=await doctorDashboard(reviewer,7);assert.equal(restricted.workload.open_review,0);assert.equal(restricted.workload.awaiting_review,1);
    await assert.rejects(()=>reviewWorkspaceReport(other,designated.id,{expectedRevision:designated.revision,action:'feedback',comment:'Not designated'}),/not eligible/);
    await assert.rejects(()=>finalizeWorkspaceReport(other,designated.id,{expectedRevision:designated.revision,requestId:randomUUID(),confirmed:true,signerUserId:other.userId}),/Signing permission/);
    await assert.rejects(()=>reviewWorkspaceReport(other,designated.id,{expectedRevision:designated.revision,action:'withdraw'}),/not eligible/);
  }finally{await updateReportingPolicy(manager,{...await readReportingPolicy(),reviewEligibility:policy.reviewEligibility});}
  own=await reviewWorkspaceReport(reviewer,own.id,{expectedRevision:own.revision,action:'withdraw'});
  await deleteWorkspaceDraft(reviewer,own.id,{expectedRevision:own.revision,confirmed:true,reason:'Synthetic withdrawn draft'});
  assert.equal((await doctorDashboard(reviewer,7)).workload.drafts,1);
});

test('simultaneous saves keep exactly one revision, its editor, immutable history and independent content',async()=>{
  const shared=await create(doctor,29),independent=await create(other,29,'independent');
  const original=(await workspaceHistory(doctor,shared.id)).versions[0];
  const results=await Promise.allSettled([
    saveWorkspaceDraft(doctor,shared.id,{expectedRevision:1,sections:{...content,findings:'Doctor A'}}),
    saveWorkspaceDraft(other,shared.id,{expectedRevision:1,sections:{...content,findings:'Doctor B'}}),
  ]);
  assert.equal(results.filter(r=>r.status==='fulfilled').length,1);
  assert.match((results.find(r=>r.status==='rejected') as PromiseRejectedResult).reason.message,/Revision conflict/);
  const winner=(results.find(r=>r.status==='fulfilled') as PromiseFulfilledResult<Awaited<ReturnType<typeof saveWorkspaceDraft>>>).value;
  assert.deepEqual((await getWorkspaceReport(doctor,shared.id)).sections,winner.sections);
  const history=await workspaceHistory(doctor,shared.id);assert.equal(history.versions.length,2);assert.deepEqual(history.versions[0],original);
  assert.equal(history.versions[1].author,winner.lastEditor);assert.ok(history.versions[1].createdAt);
  assert.deepEqual((await getWorkspaceReport(doctor,independent.id)).sections,independent.sections);
  await assert.rejects(()=>pool.query("update native_report_versions set actor_name='Changed' where report_id=$1",[shared.id]),/append only/);
});

test('legacy recovery rejects replacement drafts and finals without transferring appointment authority',async()=>{
  await bookedStudy(30);
  const old=await create(doctor,30,'independent');
  const removed=await deleteWorkspaceDraft(doctor,old.id,{expectedRevision:old.revision,confirmed:true,reason:'Synthetic removal'});
  // Also exercise drafts deleted by the older implementation, which cleared this flag.
  await pool.query('update native_reports set legacy_primary=false where id=$1',[old.id]);
  await assert.rejects(()=>deleteWorkspaceDraft(doctor,old.id,{expectedRevision:removed.revision,confirmed:true,reason:'Unauthorized recovery'},true),/not permitted/);
  const replacement=await create(other,30,'independent');
  const prior=(await pool.query('select * from native_reports where id=any($1::bigint[]) order by id',[[old.id,replacement.id]])).rows;
  await assert.rejects(()=>deleteWorkspaceDraft(manager,old.id,{expectedRevision:removed.revision,confirmed:true,reason:'Recovery'},true),/replacement report/i);
  assert.deepEqual((await pool.query('select * from native_reports where id=any($1::bigint[]) order by id',[[old.id,replacement.id]])).rows,prior);
  await deleteWorkspaceDraft(other,replacement.id,{expectedRevision:replacement.revision,confirmed:true,reason:'Withdraw replacement'});
  const recovered=await deleteWorkspaceDraft(manager,old.id,{expectedRevision:removed.revision,confirmed:true,reason:'Approved recovery'},true);
  assert.equal(recovered.id,old.id);assert.equal(recovered.revision,removed.revision+1);
  assert.equal((await pool.query('select legacy_primary from native_reports where id=$1',[old.id])).rows[0].legacy_primary,true);
  const removedAgain=await deleteWorkspaceDraft(manager,recovered.id,{expectedRevision:recovered.revision,confirmed:true,reason:'Synthetic removal'});
  let final=await create(other,30,'independent');final=await saveWorkspaceDraft(other,final.id,{expectedRevision:final.revision,sections:content});
  final=await finalizeWorkspaceReport(other,final.id,{expectedRevision:final.revision,confirmed:true,requestId:randomUUID(),signerUserId:other.userId});
  await assert.rejects(()=>deleteWorkspaceDraft(manager,old.id,{expectedRevision:removedAgain.revision,confirmed:true,reason:'Recovery beside final'},true),/replacement report/i);
  await assert.rejects(()=>deleteWorkspaceDraft(manager,final.id,{expectedRevision:final.revision,confirmed:true,reason:'Signed deletion'}),/not permitted/);
  await assert.rejects(()=>restoreWorkspaceRevision(manager,final.id,{expectedRevision:final.revision,revision:2}),/not permitted/);
});

test('signing rejects a live modality change even with an otherwise fresh catalogue',async()=>{
  let draft=await create(doctor,31);draft=await saveWorkspaceDraft(doctor,draft.id,{expectedRevision:draft.revision,sections:content});
  studies[31].modalitiesInStudy=['MR'];
  try {await assert.rejects(()=>finalizeWorkspaceReport(doctor,draft.id,{expectedRevision:draft.revision,confirmed:true,requestId:randomUUID(),signerUserId:doctor.userId}),/live study modalities changed/);}
  finally{studies[31].modalitiesInStudy=['CT'];}
  assert.equal((await getWorkspaceReport(doctor,draft.id)).status,'draft');
  const uid=studies[31].studyInstanceUid;studies[31].studyInstanceUid=uid+'.99';await upsertHistoricalPacsStudies([studies[31]]);
  try{await assert.rejects(()=>getWorkspaceReport(doctor,draft.id),/Study Instance UID conflicts/);}
  finally{studies[31].studyInstanceUid=uid;await upsertHistoricalPacsStudies([studies[31]]);}
});

test('personal native and external activity uses diagnostic modality, real signer and Tripoli calendar boundaries',async()=>{
  const signer=await user('activity'),signerId=(await pool.query('select id from doctor_portal.doctor_profiles where user_id=$1',[signer.userId])).rows[0].id;
  await pool.query("insert into doctor_portal.doctor_modality_permissions(doctor_id,modality_id,can_report,active) select $1,id,true,true from modalities where code='MR'",[signerId]);
  const dates=(await pool.query(`select ((now() at time zone 'Africa/Tripoli')::date::timestamp at time zone 'Africa/Tripoli') start`)).rows[0];
  const midnight=new Date(dates.start).getTime();
  const times=[midnight,midnight-1,midnight-6*86400000,midnight-6*86400000-1,midnight-29*86400000,midnight-29*86400000-1,midnight+86400000];
  for(let i=0;i<times.length;i++) {
    const s=studies[32+i];s.modalitiesInStudy=['SR','MRI'];await upsertHistoricalPacsStudies([s]);
    await getWorkspaceStudy(signer,s.orthancStudyId);
    const record=(await pool.query('select id from native_reporting_studies where orthanc_study_id=$1',[s.orthancStudyId])).rows[0];
    const r=(await pool.query(`insert into native_reports(primary_study_uid,imaging_source,identity,status,sections,author_user_id,author_name,report_type,is_primary,legacy_primary,finalized_by_user_id,finalized_by_doctor_id,finalized_at,signed_snapshot)
      select study_instance_uid,jsonb_build_object('accessStrategy','authoritative_orthanc','sourcePacsNodeId',null,'archiveKey',source_archive_key),identity,'final',$2,$3,'Original author','second_opinion',false,false,$4,$5,$6,'{}' from native_reporting_studies where id=$1 returning id`,[record.id,JSON.stringify(content),doctor.userId,signer.userId,signerId,new Date(times[i])])).rows[0];
    await pool.query('insert into native_report_study_links(report_id,study_id) values($1,$2)',[r.id,record.id]);
  }
  const external=await bookedStudy(39);
  await pool.query("insert into doctor_portal.reporting_board_sonicdicom_cache(appointment_id,report_status,finalized_by_doctor_id,report_final_at) values($1,'final',$2,$3)",[external.booking,signerId,new Date(midnight)]);
  for(const [days,expected] of [[1,1],[7,3],[30,5]]) {
    const dashboard=await doctorDashboard(signer,days);assert.equal(dashboard.totalFinalized,expected);assert.equal(dashboard.additionalFinalized,expected);
    assert.deepEqual(dashboard.activity,[{modality:'MR',total:expected,additional:expected}]);
    assert.equal(dashboard.externalFinalized,1);assert.deepEqual(dashboard.externalActivity,[{modality:'CT',total:1}]);
  }
  assert.equal((await doctorDashboard(doctor,1)).activity.some(r=>r.modality==='SR'),false);
});

test('assigned examination recognizes an existing unbooked final and ignores another independent draft',async()=>{
  let final=await create(doctor,40);final=await saveWorkspaceDraft(doctor,final.id,{expectedRevision:final.revision,sections:content});
  final=await finalizeWorkspaceReport(other,final.id,{expectedRevision:final.revision,confirmed:true,requestId:randomUUID(),signerUserId:other.userId});
  await create(doctor,40,'independent','second_opinion');
  // A subsequently linked examination must use study authority, not only report.appointment_id.
  const s=studies[40],accession=s.accessionNumber,{booking,ct}=await bookedStudy(40);
  s.accessionNumber=accession;await upsertHistoricalPacsStudies([s]);
  const doctorId=(await pool.query('select id from doctor_portal.doctor_profiles where user_id=$1',[doctor.userId])).rows[0].id;
  await pool.query("insert into doctor_portal.case_team_assignments(appointment_id,assigned_doctor_id,modality_id,assignment_type,status) values($1,$2,$3,'reporting','active')",[booking,doctorId,ct]);
  assert.equal((await assignedWork(doctor,{status:'final',q:s.patientName})).cases.some(c=>Number(c.appointmentId)===Number(booking)),true);
  assert.equal((await assignedWork(doctor,{status:'pending',q:s.patientName})).cases.some(c=>Number(c.appointmentId)===Number(booking)),false);
});

test('authenticated routes keep stale browsing and signed print available, reject mutations, then recover after sync',async()=>{
  let draft=await create(doctor,41);draft=await saveWorkspaceDraft(doctor,draft.id,{expectedRevision:draft.revision,sections:content});
  let signed=await create(doctor,42);signed=await saveWorkspaceDraft(doctor,signed.id,{expectedRevision:signed.revision,sections:content});
  signed=await finalizeWorkspaceReport(doctor,signed.id,{expectedRevision:signed.revision,confirmed:true,requestId:randomUUID(),signerUserId:doctor.userId});
  const original=(await pool.query('select * from native_reports where id=$1',[signed.id])).rows[0];
  const app=express();app.use(express.json(),cookieParser());app.use('/api/native-reporting',nativeReportingRouter);app.use(errorHandler);
  const server=app.listen(0,'127.0.0.1');await new Promise<void>(r=>server.once('listening',r));
  const origin='http://127.0.0.1:'+(server.address() as {port:number}).port;
  const request=(path:string,actor:Actor|null=doctor,method='GET',body?:unknown)=>fetch(origin+'/api/native-reporting'+path,{method,headers:{'Content-Type':'application/json',...(actor?{cookie:env.cookieName+'='+jwt.sign({sub:Number(actor.userId),role:actor.appRole},env.jwtSecret,{expiresIn:'5m'})}:{})},body:body?JSON.stringify(body):undefined});
  try {
    const failed=await runHistoricalPacsSyncCycle(async()=>{throw new Error('Synthetic synchronization outage');});assert.equal(failed.mode,'failed');
    const catalogue=await request('/workspace/studies?q='+prefix);assert.equal(catalogue.status,200);const list=await catalogue.json();assert.equal(list.freshness.status,'stale');assert.ok(list.studies.length>0);assert.ok(list.freshness.lastSuccessAt);
    const preserved=await request('/reports/'+signed.id);assert.equal(preserved.status,200);assert.equal((await preserved.json()).canEdit,false);
    const print=await request('/reports/'+signed.id+'/print');assert.equal(print.status,200);assert.match(await print.text(),/Normal impression/);
    assert.equal((await request('/reports/'+signed.id+'/print',null)).status,401);
    assert.equal((await request('/reports/'+draft.id+'/draft',doctor,'PUT',{expectedRevision:draft.revision,sections:content})).status,409);
    assert.equal((await request('/reports/'+draft.id+'/finalize',doctor,'POST',{expectedRevision:draft.revision,confirmed:true,requestId:randomUUID(),signerUserId:doctor.userId})).status,409);
    // Missing index rows use the immutable registry for preserved report reads only.
    await pool.query('delete from historical_pacs_studies where orthanc_study_id=$1',[studies[42].orthancStudyId]);
    assert.equal((await request('/reports/'+signed.id+'/print')).status,200);await upsertHistoricalPacsStudies([studies[42]]);
    await pool.query('update historical_pacs_sync_state set last_full_sync_at=now(),last_change_sequence=0');
    const recovered=await runHistoricalPacsSyncCycle(async()=>{
      assert.equal((await archiveStatus()).fresh,false,'Retry startup must not mark a failed catalogue fresh before successful synchronization');
      return {getChanges:async()=>({changes:[],lastSequence:0,done:true}),listStudiesForIndexPage:async()=>{throw new Error('Unexpected full sync');},getStudyForIndex:async()=>null};
    });assert.equal(recovered.mode,'incremental');
    assert.equal((await getWorkspaceReport(doctor,draft.id)).canEdit,true);
    assert.equal((await request('/reports/'+draft.id+'/draft',doctor,'PUT',{expectedRevision:draft.revision,sections:{...content,findings:'After sync recovery'}})).status,200);
    const rev=(await getWorkspaceReport(doctor,draft.id)).revision;
    const policy=await readReportingPolicy();await updateReportingPolicy(manager,{...policy,review:'mandatory',mandatoryReviewRoles:['consultant']});
    try {
      assert.equal((await request('/reports/'+draft.id+'/finalize',doctor,'POST',{expectedRevision:rev,confirmed:true,requestId:randomUUID(),signerUserId:doctor.userId,reviewed:true,reviewRequired:false})).status,403,'Direct API fields cannot bypass mandatory review');
    }finally{await updateReportingPolicy(manager,{...await readReportingPolicy(),review:policy.review,mandatoryReviewRoles:policy.mandatoryReviewRoles});}
    upstreamUnavailable=true;
    const unverified=await request('/reports/'+draft.id+'/finalize',doctor,'POST',{expectedRevision:rev,confirmed:true,requestId:randomUUID(),signerUserId:doctor.userId});
    assert.equal(unverified.status,503);assert.match(await unverified.text(),/Live archive verification is unavailable/);
    assert.equal((await request('/reports/'+signed.id+'/print')).status,200);upstreamUnavailable=false;
    assert.equal((await request('/reports/'+draft.id+'/finalize',noSign,'POST',{expectedRevision:rev,confirmed:true,requestId:randomUUID(),signerUserId:noSign.userId})).status,403);
    await pool.query('update doctor_portal.doctor_modality_permissions set can_report=false where doctor_id in (select id from doctor_portal.doctor_profiles where user_id=$1)',[noSign.userId]);
    for(const path of ['/workspace/studies/'+studies[41].orthancStudyId,'/reports/'+signed.id,'/reports/'+signed.id+'/history','/reports/'+signed.id+'/print'])assert.equal((await request(path,noSign)).status,403,path);
    for(const [path,method,body] of [
      ['/workspace/studies/'+studies[41].orthancStudyId+'/reports','POST',{mode:'shared',requestId:randomUUID()}],
      ['/reports/'+draft.id+'/draft','PUT',{expectedRevision:rev,sections:content}],
      ...['review','finalize','delete','recover','restore-revision','addenda','images-launch'].map(action=>['/reports/'+draft.id+'/'+action,'POST',{expectedRevision:rev,action:'submit',revision:1,confirmed:true,requestId:randomUUID(),signerUserId:noSign.userId,text:'Unauthorized',reason:'Unauthorized'}] as const),
    ] as const)assert.equal((await request(path,noSign,method,body)).status,403,path);
    assert.deepEqual((await pool.query('select * from native_reports where id=$1',[signed.id])).rows[0],original);
  }finally{upstreamUnavailable=false;await new Promise<void>((resolve,reject)=>server.close(e=>e?reject(e):resolve()));await pool.query('update historical_pacs_sync_state set source_archive_key=$1,last_success_at=now(),last_error=null',[authoritativeOrthancArchiveKey(settings)]);}
});

test('Reporting Board attributes native and SonicDICOM finals independently of assignment and gives native fields precedence',async()=>{
  const assigned=(await pool.query('select id from doctor_portal.doctor_profiles where user_id=$1',[doctor.userId])).rows[0].id;
  const signer=(await pool.query('select id from doctor_portal.doctor_profiles where user_id=$1',[other.userId])).rows[0].id;
  const before=await doctorDashboard(other,1),ids:number[]=[];
  for(const [i,native,external] of [[43,false,true],[44,true,false],[45,true,true]] as const) {
    const {booking,ct,s}=await bookedStudy(i);ids.push(Number(booking));
    await pool.query("insert into doctor_portal.case_team_assignments(appointment_id,assigned_doctor_id,modality_id,assignment_type,status) values($1,$2,$3,'reporting','active')",[booking,assigned,ct]);
    if(external)await pool.query("insert into doctor_portal.reporting_board_sonicdicom_cache(appointment_id,report_status,finalized_by_doctor_id,report_final_at,sonicdicom_finalized_by_account) values($1,'final',$2,now(),'synthetic-external')",[booking,native?assigned:signer]);
    if(native) {
      const identity={patientName:s.patientName,patientIdentifier:s.patientId,accession:s.accessionNumber,examination:s.studyDescription,studyDate:s.studyDate};
      await pool.query(`insert into native_reports(appointment_id,patient_id,primary_study_uid,imaging_source,identity,status,sections,author_user_id,author_name,finalized_by_user_id,finalized_by_doctor_id,finalizer_name,finalized_at,signed_snapshot)
        select b.id,b.patient_id,$2,$3,$4,'final',$5,$6,'Synthetic author',$7,$8,$9,now(),$10 from appointments_v2.bookings b where b.id=$1`,[booking,s.studyInstanceUid,JSON.stringify({accessStrategy:'authoritative_orthanc',sourcePacsNodeId:null,archiveKey:authoritativeOrthancArchiveKey(settings)}),JSON.stringify(identity),JSON.stringify(content),doctor.userId,other.userId,signer,prefix+'other',JSON.stringify({identity,sections:content,keyImages:[]})]);
      await getWorkspaceStudy(other,s.orthancStudyId);
    }
    const rows=await listReportingBoardCasesByAppointmentIds([Number(booking)]);assert.equal(rows.length,1);
    assert.equal(rows[0].assignedDoctorId,Number(assigned));assert.equal(rows[0].finalizedByDoctorId,Number(signer));assert.equal(rows[0].assignmentMatch,'mismatch');assert.equal(rows[0].reportStatus,'final');
    assert.equal(rows[0].finalizedByDoctorName,prefix+'other');
    for(const [finalizedByDoctorId,assignmentMatch,expected] of [[Number(signer),'mismatch',1],[Number(assigned),'matched',0]] as const)assert.equal((await listReportingBoardCaseCandidates({appointmentId:Number(booking),limit:10,offset:0,reportStatus:'all',finalizedByDoctorId,assignmentMatch})).length,expected);
  }
  const after=await doctorDashboard(other,1);assert.equal(after.totalFinalized,before.totalFinalized+2);assert.equal(after.externalFinalized,before.externalFinalized+1);
  assert.equal(after.departmentCompleted,before.departmentCompleted+3,'Native and external finals on one examination count once');
  assert.equal((await assignedWork(doctor,{status:'pending'})).cases.some(c=>ids.includes(Number(c.appointmentId))),false);
});

test('draft deletion and recovery retain captured bytes, image identity and immutable earlier revisions',async()=>{
  const originalUploads=env.uploadsDir,keys=['storage_path','storage_fallback_enabled'];
  const storage=(await pool.query("select setting_key,setting_value from system_settings where category='documents_and_uploads' and setting_key=any($1::text[])",[keys])).rows;
  const root=resolve('test-results',prefix+'-assets');env.uploadsDir=root;let absolutePath:string|undefined;
  try {
    for(const [key,value] of [['storage_path',root],['storage_fallback_enabled','false']])await pool.query("insert into system_settings(category,setting_key,setting_value) values('documents_and_uploads',$1,$2) on conflict(category,setting_key) do update set setting_value=excluded.setting_value",[key,JSON.stringify({value})]);
    let report=await create(doctor,46,'independent');const png=await sharp({create:{width:32,height:32,channels:3,background:'white'}}).png().toBuffer();
    const stored=await storeReportImage(png);absolutePath=stored.absolutePath;
    const image=(await pool.query(`insert into native_report_key_images(id,report_id,stored_path,sha256,byte_size,width,height,provenance,position,captured_by_user_id)
      values($1,$2,$3,$4,$5,32,32,'{}',1,$6) returning *`,[randomUUID(),report.id,stored.storedPath,stored.sha256,png.length,doctor.userId])).rows[0];
    report=await saveWorkspaceDraft(doctor,report.id,{expectedRevision:report.revision,sections:content});
    const before=await workspaceHistory(doctor,report.id);
    report=await deleteWorkspaceDraft(doctor,report.id,{expectedRevision:report.revision,confirmed:true,reason:'Retain synthetic assets'});
    assert.deepEqual(await readReportImage(image),png);assert.deepEqual(await readFile(absolutePath),png);
    report=await deleteWorkspaceDraft(manager,report.id,{expectedRevision:report.revision,confirmed:true,reason:'Authorized recovery'},true);
    report=await restoreWorkspaceRevision(doctor,report.id,{expectedRevision:report.revision,revision:2});
    assert.equal(report.revision,5);assert.equal(report.keyImages[0].id,image.id);
    assert.deepEqual((await workspaceHistory(doctor,report.id)).versions.slice(0,2),before.versions);
    assert.deepEqual((await pool.query('select * from native_report_key_images where id=$1',[image.id])).rows[0],image);
    assert.deepEqual(await readReportImage(image),png);
  }finally{
    env.uploadsDir=originalUploads;
    await pool.query("delete from system_settings where category='documents_and_uploads' and setting_key=any($1::text[])",[keys]);
    for(const row of storage)await pool.query("insert into system_settings(category,setting_key,setting_value) values('documents_and_uploads',$1,$2)",[row.setting_key,JSON.stringify(row.setting_value)]);
    if(absolutePath)await unlink(absolutePath);
  }
});

test('recovery does not take reporting ownership back from a later external report',async()=>{
  const {booking}=await bookedStudy(47);const draft=await create(doctor,47,'independent');
  const removed=await deleteWorkspaceDraft(doctor,draft.id,{expectedRevision:draft.revision,confirmed:true,reason:'Synthetic removal'});
  await pool.query("insert into doctor_portal.reporting_board_sonicdicom_cache(appointment_id,report_status,last_success_at,sonicdicom_latest_document_id) values($1,'final',now(),'synthetic-later-document')",[booking]);
  await assert.rejects(()=>deleteWorkspaceDraft(manager,removed.id,{expectedRevision:removed.revision,confirmed:true,reason:'Recovery'},true),/External reporting ownership/);
  assert.ok((await getWorkspaceReport(manager,removed.id)).deletedAt);
  assert.equal((await pool.query('select report_status from doctor_portal.reporting_board_sonicdicom_cache where appointment_id=$1',[booking])).rows[0].report_status,'final');
});

test('PACS dates and 50-row defaults cover the complete archive with invalid dates last',async()=>{
  const dates=['19900101','20261030','20261030','not-a-date','20260230',''];
  for(let i=0;i<dates.length;i++)await pool.query('update historical_pacs_studies set study_date=$2 where orthanc_study_id=$1',[studies[60+i].orthancStudyId,dates[i]]);
  const first=await listWorkspaceStudies(doctor,{q:prefix});assert.equal(first.limit,50);assert.equal(first.studies.length,50);assert.ok(first.total>=200);
  assert.deepEqual(first.studies.slice(0,2).map(r=>r.orthanc_study_id),[studies[61].orthancStudyId,studies[62].orthancStudyId].sort());
  const all=[];for(let offset=0;offset<first.total;offset+=50)all.push(...(await listWorkspaceStudies(doctor,{q:prefix,offset})).studies);
  assert.equal(new Set(all.map(r=>r.orthanc_study_id)).size,first.total);assert.equal(all.at(-4)!.study_date,'19900101');
  assert.deepEqual(new Set(all.slice(-3).map(r=>r.study_date)),new Set(['not-a-date','20260230','']));
  assert.equal((await listWorkspaceStudies(doctor,{q:studies[60].patientId})).total,1);
});

test('PACS-only external status is source-bound, batched, retained on failure and refreshed incrementally',async()=>{
  const settings={...DEFAULT_SONICDICOM_REPORT_SETTINGS,sonicDicomReportsEnabled:true,sonicDicomSqlEnabled:true,sonicDicomSqlServer:'127.0.0.1',sonicDicomSqlUsername:'synthetic',sonicDicomSqlTimeoutMs:100};
  const setConfig=(value:unknown)=>pool.query("update system_settings set setting_value=$1 where category='sonicdicom_reports' and setting_key='config'",[JSON.stringify(value)]);
  await setConfig(settings);
  const keys=studies.slice(70,74).map(s=>s.orthancStudyId),uids=studies.slice(70,74).map(s=>s.studyInstanceUid),archiveKey=authoritativeOrthancArchiveKey({baseUrl:'http://127.0.0.1:19481'}),sourceKey=workspaceSonicSourceKey(settings);
  try {
    const departmentBefore=(await doctorDashboard(doctor,1)).departmentCompleted;
    assert.equal((await listWorkspaceStudies(doctor,{q:studies[70].patientId})).studies[0].external_reporting_status,'not_checked');
    await enqueueWorkspaceSonicStudies(archiveKey,sourceKey,keys);
    let calls=0;
    const lookup:Parameters<typeof refreshWorkspaceSonicStudies>[2]=async ids=>{calls++;assert.ok(ids.length<=50);assert.ok(ids.every(id=>uids.includes(id)));return new Map(ids.map((id,i)=>[id,{state:(['final','draft','no_report','study_not_found'] as const)[uids.indexOf(id)],canViewReport:i===0,source:'sonicdicom' as const,reportFinalAt:null}]));};
    const tick=await refreshWorkspaceSonicStudies(50,pool,lookup);assert.equal(tick.successful,4);assert.equal(calls,1);
    assert.equal((await doctorDashboard(doctor,1)).departmentCompleted,departmentBefore+1,'PACS-only external finals contribute one completed examination');
    for(const [i,status] of ['external_final','external_draft','external_no_report','external_not_found'].entries())assert.equal((await listWorkspaceStudies(doctor,{q:studies[70+i].patientId})).studies[0].external_reporting_status,status);
    assert.equal((await listWorkspaceStudies(doctor,{q:studies[70].patientId,status:'external_final'})).total,1);
    assert.equal((await refreshWorkspaceSonicStudies(50,pool,lookup)).candidates,0,'Unchanged catalogue requests must not reset next_check_at');
    await pool.query('update doctor_portal.workspace_sonicdicom_cache set next_check_at=now() where study_instance_uid=$1',[uids[0]]);
    const failed=await refreshWorkspaceSonicStudies(50,pool,async()=>new Map());assert.equal(failed.failed,1);
    const retained=(await listWorkspaceStudies(doctor,{q:studies[70].patientId})).studies[0];assert.equal(retained.external_reporting_status,'external_unavailable');assert.equal(retained.external_last_known_status,'final');assert.ok(retained.external_checked_at);
    const stored=(await pool.query('select * from doctor_portal.workspace_sonicdicom_cache where archive_key=$1 and sonic_source_key=$2 and study_instance_uid=$3',[archiveKey,sourceKey,uids[0]])).rows[0];assert.ok(new Date(stored.next_check_at)>new Date(stored.last_attempt_at));
    await setConfig({...settings,sonicDicomSqlServer:'different-synthetic-source'});assert.equal((await listWorkspaceStudies(doctor,{q:studies[70].patientId})).studies[0].external_reporting_status,'not_checked');
    await setConfig({...settings,sonicDicomReportsEnabled:false});assert.equal((await listWorkspaceStudies(doctor,{q:studies[72].patientId})).studies[0].external_reporting_status,'external_disabled');
    assert.equal((await refreshWorkspaceSonicStudies(50,pool,lookup)).candidates,0);
    await assert.rejects(()=>create(doctor,70),/External reporting ownership/);
    await assert.rejects(()=>create(doctor,71),/External reporting ownership/);
    await pool.query('update historical_pacs_studies set series_count=series_count+1 where orthanc_study_id=$1',[keys[1]]);
    await setConfig(settings);await listWorkspaceStudies(doctor,{q:studies[71].patientId});
    assert.equal((await listWorkspaceStudies(doctor,{q:studies[71].patientId})).studies[0].external_reporting_status,'external_unavailable');
    await setConfig({...settings,sonicDicomReportsEnabled:false});await assert.rejects(()=>create(doctor,71),/External reporting ownership/);
    await setConfig(settings);
    const bookingCount=(await pool.query('select count(*)::int n from appointments_v2.bookings')).rows[0].n;
    const {backfillWorkspaceExternalStatus}=await import('./workspace-study-service.js');
    await assert.rejects(()=>backfillWorkspaceExternalStatus(doctor,{limit:3}),/Supervisor/);
    const backfill=await backfillWorkspaceExternalStatus(manager,{limit:3});assert.equal(backfill.examined,3);assert.ok(backfill.nextCursor);assert.equal((await pool.query('select count(*)::int n from appointments_v2.bookings')).rows[0].n,bookingCount);
    // The display cache cannot authorize creation, even when it retained no-report.
    await assert.rejects(()=>create(doctor,72),/External reporting owns/);
  }finally{await setConfig(DEFAULT_SONICDICOM_REPORT_SETTINGS);}
});
