import assert from 'node:assert/strict';
import {before,after,test} from 'node:test';
import {randomUUID} from 'node:crypto';
import {mkdtemp,rm,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import jwt from 'jsonwebtoken';
import sharp from 'sharp';
import {pool} from '../../db/pool.js';
import {env} from '../../config/env.js';
import {createApp} from '../../app.js';
import {DEFAULT_PAGE_VISIBILITY_MATRIX} from '../../services/page-visibility-settings-service.js';
import {receptionReportStatuses,receptionSignedReport} from './reception-report-service.js';
import {storeReportImage} from './report-image-storage-service.js';
import {EMPTY_SECTIONS} from './reporting-validation.js';

const prefix='reception_'+randomUUID().slice(0,8),bookings:number[]=[],reports:number[]=[],registries:string[]=[],users=new Map<string,number>();
let patient:number,otherPatient:number,modality:number,policySet:number,version:number,temporary:string,previousUploads:string,originalSettings:Record<string,unknown>[],server:import('node:http').Server,origin:string;
const sections={...EMPTY_SECTIONS,findings:'IMMUTABLE SIGNED FINDINGS',impression:'SIGNED IMPRESSION'};
before(async()=>{
  assert.equal((await pool.query('select current_database() db')).rows[0].db,'rispro_test');
  originalSettings=(await pool.query("select * from system_settings where (category='users_and_roles' and setting_key='page_visibility_by_role') or category in ('sonicdicom_reports','documents_and_uploads')")).rows;
  await pool.query("insert into system_settings(category,setting_key,setting_value) values('users_and_roles','page_visibility_by_role',$1) on conflict(category,setting_key) do update set setting_value=excluded.setting_value",[JSON.stringify({value:DEFAULT_PAGE_VISIBILITY_MATRIX})]);
  await pool.query("update system_settings set setting_value=setting_value||'{\"sonicDicomReportsEnabled\":false}'::jsonb where category='sonicdicom_reports' and setting_key='config'");
  for(const [key,value] of Object.entries({storage_path:'',storage_fallback_enabled:'true'}))await pool.query("insert into system_settings(category,setting_key,setting_value) values('documents_and_uploads',$1,$2) on conflict(category,setting_key) do update set setting_value=excluded.setting_value",[key,JSON.stringify({value})]);
  previousUploads=env.uploadsDir;temporary=await mkdtemp(join(tmpdir(),'rispro-reception-report-'));env.uploadsDir=temporary;
  for(const role of ['receptionist','supervisor','super_admin','doctor','administrative','modality_staff'])users.set(role,Number((await pool.query("insert into users(username,full_name,password_hash,role,is_active) values($1,$1,'disabled',$2,true) returning id",[prefix+'_'+role,role])).rows[0].id));
  patient=Number((await pool.query("insert into patients(arabic_full_name,english_full_name,normalized_arabic_name,identifier_type,identifier_value,age_years,sex) values($1,$1,$1,'other',$2,40,'O') returning id",[prefix,prefix+'-PATIENT'])).rows[0].id);
  otherPatient=Number((await pool.query("insert into patients(arabic_full_name,english_full_name,normalized_arabic_name,identifier_type,identifier_value,age_years,sex) values($1,$1,$1,'other',$2,40,'O') returning id",[prefix+'other',prefix+'-OTHER'])).rows[0].id);
  modality=Number((await pool.query("select id from modalities where code='CT' limit 1")).rows[0].id);
  policySet=Number((await pool.query('insert into appointments_v2.policy_sets(key,name) values($1,$1) returning id',[prefix])).rows[0].id);
  version=Number((await pool.query("insert into appointments_v2.policy_versions(policy_set_id,version_no,status,config_hash) values($1,1,'draft','synthetic') returning id",[policySet])).rows[0].id);
  server=createApp().listen(0,'127.0.0.1');await new Promise<void>(done=>server.once('listening',done));const address=server.address();assert.ok(address&&typeof address==='object');origin='http://127.0.0.1:'+address.port;
});
after(async()=>{
  if(server)await new Promise<void>(done=>{server.closeAllConnections();server.close(()=>done());});
  const db=await pool.connect();try{await db.query('begin');await db.query('set local session_replication_role=replica');
    for(const table of ['native_report_key_images','native_report_review_events','native_report_contributors','native_report_versions','native_report_study_links'])await db.query(`delete from ${table} where report_id=any($1::bigint[])`,[reports]);
    await db.query('delete from native_reporting_studies where id=any($1::uuid[])',[registries]);await db.query('delete from native_reports where id=any($1::bigint[])',[reports]);
    for(const table of ['doctor_portal.reporting_board_sonicdicom_cache','doctor_portal.reporting_board_manual_final_overrides','study_source_resolutions'])await db.query(`delete from ${table} where appointment_id=any($1::bigint[])`,[bookings]);
    await db.query('delete from appointments_v2.bookings where id=any($1::bigint[])',[bookings]);await db.query('delete from patients where id=any($1::bigint[])',[[patient,otherPatient]]);
    await db.query('delete from appointments_v2.policy_versions where id=$1',[version]);await db.query('delete from appointments_v2.policy_sets where id=$1',[policySet]);await db.query('delete from audit_log where changed_by_user_id=any($1::bigint[])',[[...users.values()]]);await db.query('delete from users where id=any($1::bigint[])',[[...users.values()]]);
    await db.query("delete from system_settings where (category='users_and_roles' and setting_key='page_visibility_by_role') or category in ('sonicdicom_reports','documents_and_uploads')");for(const row of originalSettings||[])await db.query('insert into system_settings(category,setting_key,setting_value,updated_by_user_id,updated_at) values($1,$2,$3,$4,$5)',[row.category,row.setting_key,row.setting_value,row.updated_by_user_id,row.updated_at]);
    await db.query('commit');
  }catch(error){await db.query('rollback');throw error;}finally{db.release();env.uploadsDir=previousUploads;await pool.end();if(temporary&&resolve(temporary).startsWith(resolve(tmpdir())+requireSeparator()))await rm(temporary,{recursive:true,force:true});}
});
function requireSeparator(){return process.platform==='win32'?'\\':'/';}
async function booking(uid='2.25.'+BigInt('0x'+randomUUID().replaceAll('-',''))) {
  const id=Number((await pool.query("insert into appointments_v2.bookings(patient_id,modality_id,booking_date,case_category,status,requires_report,policy_version_id,completed_at,study_instance_uid) values($1,$2,current_date,'non_oncology','completed',true,$3,now(),$4) returning id",[patient,modality,version,uid])).rows[0].id);bookings.push(id);return {id,uid,identity:{patientName:'SIGNED PATIENT NAME',patientIdentifier:prefix+'-PATIENT',accession:'V2-'+String(id).padStart(6,'0'),examination:'CT synthetic',studyDate:'20261106',modality:'CT'}};
}
type Booking=Awaited<ReturnType<typeof booking>>;
async function report(b:Booking,{final=true,type='primary',registry=true,image=false,pointPrimary=true,withInstitution=true,identity=b.identity,patientId=patient,appointmentId=b.id}:{final?:boolean;type?:string;registry?:boolean;image?:boolean;pointPrimary?:boolean;withInstitution?:boolean;identity?:Booking['identity'];patientId?:number;appointmentId?:number|null}={}) {
  const source={accessStrategy:'authoritative_orthanc',sourcePacsNodeId:null,archiveKey:prefix};
  const id=Number((await pool.query(`insert into native_reports(appointment_id,patient_id,primary_study_uid,imaging_source,identity,sections,author_user_id,author_name,is_primary,legacy_primary,report_type)
    values($1,$2,$3,$4,$5,$6,$7,'DRAFT AUTHOR',false,not exists(select 1 from native_reports where appointment_id=$1 and legacy_primary and deleted_at is null),$8) returning id`,[appointmentId,appointmentId==null?null:patientId,b.uid,source,identity,{...sections,findings:'MUTABLE CONTENT MUST NOT BE DELIVERED'},users.get('doctor'),type])).rows[0].id);reports.push(id);
  let registryId:string|undefined;if(registry){registryId=(await pool.query(`insert into native_reporting_studies(source_archive_key,study_instance_uid,orthanc_study_id,identity,modalities) values($1,$2,$3,$4,'{CT}') on conflict(source_archive_key,study_instance_uid) do update set primary_report_id=native_reporting_studies.primary_report_id returning id`,[prefix,b.uid,randomUUID(),identity])).rows[0].id;if(!registries.includes(registryId!))registries.push(registryId!);await pool.query('insert into native_report_study_links(report_id,study_id) values($1,$2)',[id,registryId]);}
  const keyImages=[];if(image){const bytes=await sharp({create:{width:64,height:64,channels:3,background:'#336699'}}).png().toBuffer(),stored=await storeReportImage(bytes),imageId=randomUUID();await pool.query('insert into native_report_key_images(id,report_id,stored_path,sha256,byte_size,width,height,provenance,caption,position,captured_by_user_id) values($1,$2,$3,$4,$5,64,64,$6,$7,0,$8)',[imageId,id,stored.storedPath,stored.sha256,bytes.length,{},'SIGNED CAPTION',users.get('doctor')]);keyImages.push({id:imageId,caption:'SIGNED CAPTION',provenance:{}});}
  if(final){const snapshot={identity,sections,keyImages,author:'SIGNED AUTHOR',finalizer:'SIGNED SENIOR',signedAt:'2026-11-06T12:00:00Z',...(withInstitution?{institution:{hospitalNameEn:'SIGNED INSTITUTION'}}:{})};await pool.query("update native_reports set status='final',is_primary=$2,finalized_by_user_id=$3,finalizer_name='ROW SIGNER',finalized_at=now(),signed_snapshot=$4,finalize_request_id=$5 where id=$1",[id,type==='primary',users.get('doctor'),snapshot,randomUUID()]);if(registryId&&type==='primary'&&pointPrimary)await pool.query('update native_reporting_studies set primary_report_id=$2 where id=$1',[registryId,id]);}
  return {id,keyImages};
}
const request=(path:string,role='receptionist')=>fetch(origin+path,{redirect:'manual',headers:role?{Cookie:env.cookieName+'='+jwt.sign({sub:users.get(role),role},env.jwtSecret)}:{}});
const base=(id:number)=>'/api/v2/read/appointments/'+id;

test('selects the registry primary and immutable snapshot despite other reports and retained external finals',async()=>{
  const b=await booking();await pool.query("insert into doctor_portal.reporting_board_sonicdicom_cache(appointment_id,report_status,last_success_at) values($1,'final',now())",[b.id]);
  const secondary=await report(b,{type:'second_opinion',image:true});const primary=await report(b,{image:true});await report(b,{final:false});
  await pool.query("insert into native_report_review_events(report_id,event_type,actor_user_id,actor_name,comment) values($1,'feedback',$2,'Reviewer','PRIVATE REVIEW FEEDBACK')",[primary.id,users.get('doctor')]);
  await pool.query("insert into native_report_versions(report_id,kind,snapshot,actor_user_id,actor_name) values($1,'addendum',$2,$3,'SIGNED ADDENDUM AUTHOR')",[primary.id,{text:'SIGNED ADDENDUM'},users.get('doctor')]);
  const status=(await receptionReportStatuses([b.id])).get(b.id)!;assert.equal(status.source,'rispro');assert.equal(status.reportId,primary.id);assert.equal(status.state,'final');
  const page=await request(base(b.id)+'/report');assert.equal(page.status,200);assert.match(page.headers.get('cache-control')!,/private, no-store/);const html=await page.text();assert.match(html,/IMMUTABLE SIGNED FINDINGS/);assert.match(html,/SIGNED INSTITUTION/);assert.match(html,/SIGNED SENIOR/);assert.doesNotMatch(html,/MUTABLE CONTENT|DRAFT AUTHOR|ROW SIGNER|PRIVATE REVIEW FEEDBACK/);assert.match(html,/SIGNED ADDENDUM/);
  const imagePath=base(b.id)+'/report/'+primary.id+'/images/'+primary.keyImages[0].id;assert.ok(html.includes(imagePath));assert.equal((await request(imagePath)).status,200);assert.equal((await request(base(b.id)+'/report/'+primary.id+'/images/'+randomUUID())).status,404);assert.equal((await request(base(b.id)+'/report/'+primary.id+'/images/'+secondary.keyImages[0].id)).status,404);
  const printed=await request(base(b.id)+'/report/print');assert.match(await printed.text(),/reception-report-print.js/);assert.equal((await request(base(b.id)+'/report/fonts/regular')).status,200);
  assert.equal((await pool.query("select count(*)::int count from audit_log where entity_type='native_report' and entity_id=$1 and action_type in ('native_report_reception_opened','native_report_reception_print_requested')",[primary.id])).rows[0].count,2);
  const details=await request('/api/v2/read/appointments/'+b.id);assert.equal(details.status,200);const body=await details.json();assert.equal(body.appointment.report_status_source,'rispro');assert.equal(Number(body.appointment.native_report_id),primary.id);
});
test('draft, in-review and secondary-only workflows never fall back to a stale external final',async()=>{
  const ids=[];for(const state of ['draft','review','secondary']){const b=await booking();ids.push(b.id);await pool.query("insert into doctor_portal.reporting_board_sonicdicom_cache(appointment_id,report_status) values($1,'final')",[b.id]);const r=await report(b,{final:state==='secondary',type:state==='secondary'?'second_opinion':'primary'});if(state==='review')await pool.query('update native_reports set review_requested_at=now() where id=$1',[r.id]);assert.equal((await request(base(b.id)+'/report')).status,404);}
  const statuses=await receptionReportStatuses(ids);assert.deepEqual(ids.map(id=>statuses.get(id)!.state),['draft','in_review','no_report']);assert.ok(ids.every(id=>statuses.get(id)!.source==='rispro'));
});
test('rejects patient, accession, study and duplicate-appointment association mismatches',async()=>{
  for(const mismatch of ['patient','identifier','accession','study','duplicate']){const b=await booking();await report(b,{identity:mismatch==='accession'?{...b.identity,accession:'WRONG'}:b.identity});if(mismatch==='patient')await pool.query('update appointments_v2.bookings set patient_id=$2 where id=$1',[b.id,otherPatient]);if(mismatch==='identifier')await pool.query("update patients set identifier_value='WRONG' where id=$1",[patient]);if(mismatch==='study')await pool.query("update appointments_v2.bookings set study_instance_uid='2.25.999' where id=$1",[b.id]);if(mismatch==='duplicate')await booking(b.uid);assert.notEqual((await receptionReportStatuses([b.id])).get(b.id)!.state,'final',mismatch);assert.equal((await request(base(b.id)+'/report')).status,404,mismatch);if(mismatch==='identifier')await pool.query('update patients set identifier_value=$2 where id=$1',[patient,prefix+'-PATIENT']);}
});
test('verified authoritative resolution works and conflicting resolution identity fails closed',async()=>{
  const b=await booking();await report(b);await pool.query('update appointments_v2.bookings set study_instance_uid=null where id=$1',[b.id]);await pool.query("insert into study_source_resolutions(appointment_id,accession_number,patient_id_value,study_instance_uid,source_kind,resolution_method) values($1,$2,$3,$4,'authoritative_orthanc','persisted_uid_verified')",[b.id,b.identity.accession,b.identity.patientIdentifier,b.uid]);assert.equal((await receptionReportStatuses([b.id])).get(b.id)!.state,'final');await pool.query("update study_source_resolutions set patient_id_value='WRONG' where appointment_id=$1",[b.id]);assert.equal((await request(base(b.id)+'/report')).status,404);
});
test('legacy signed primaries remain deliverable without inventing missing institutional identity',async()=>{const b=await booking();await report(b,{registry:false,withInstitution:false});const delivered=await receptionSignedReport(b.id);assert.equal(delivered.status,'final');assert.equal(delivered.institution,null);});
test('manual precedes external while active native workflows precede both',async()=>{const external=await booking(),manual=await booking();for(const b of [external,manual])await pool.query("insert into doctor_portal.reporting_board_sonicdicom_cache(appointment_id,report_status) values($1,'final')",[b.id]);await pool.query("insert into doctor_portal.reporting_board_manual_final_overrides(appointment_id,reason,created_by_user_id) values($1,'Synthetic manual final',$2)",[manual.id,users.get('supervisor')]);let statuses=await receptionReportStatuses([external.id,manual.id]);assert.equal(statuses.get(external.id)!.source,'sonicdicom');assert.equal(statuses.get(manual.id)!.source,'manual');await report(manual,{final:false});statuses=await receptionReportStatuses([manual.id]);assert.equal(statuses.get(manual.id)!.source,'rispro');assert.equal(statuses.get(manual.id)!.state,'draft');});
test('requires authenticated Reception roles and registrations permission for HTML, status and image access',async()=>{
  const b=await booking(),r=await report(b,{image:true}),paths=[base(b.id)+'/report',base(b.id)+'/report/print',base(b.id)+'/report-status',base(b.id)+'/report/'+r.id+'/images/'+r.keyImages[0].id];
  for(const path of paths){assert.equal((await request(path,'')).status,401);for(const role of ['doctor','administrative','modality_staff'])assert.equal((await request(path,role)).status,403,role);assert.equal((await request(path,'supervisor')).status,200);}
  await pool.query("update system_settings set setting_value=$1 where category='users_and_roles' and setting_key='page_visibility_by_role'",[JSON.stringify({value:{...DEFAULT_PAGE_VISIBILITY_MATRIX,registrations:['super_admin']}})]);
  for(const path of paths)assert.equal((await request(path)).status,403);
  await pool.query("update system_settings set setting_value=$1 where category='users_and_roles' and setting_key='page_visibility_by_role'",[JSON.stringify({value:DEFAULT_PAGE_VISIBILITY_MATRIX})]);
  await pool.query("update system_settings set setting_value=$1 where category='users_and_roles' and setting_key='page_visibility_by_role'",[JSON.stringify({value:{...DEFAULT_PAGE_VISIBILITY_MATRIX,print:['super_admin']}})]);
  assert.equal((await request(base(b.id)+'/report')).status,200);assert.equal((await request(base(b.id)+'/report/print')).status,403);assert.equal((await (await request(base(b.id)+'/report-status')).json()).canPrintReport,false);
  await pool.query("update system_settings set setting_value=$1 where category='users_and_roles' and setting_key='page_visibility_by_role'",[JSON.stringify({value:DEFAULT_PAGE_VISIBILITY_MATRIX})]);
  await pool.query('update users set is_active=false where id=$1',[users.get('receptionist')]);assert.equal((await request(base(b.id)+'/report')).status,401);await pool.query('update users set is_active=true where id=$1',[users.get('receptionist')]);
  assert.notEqual((await request('/api/native-reporting/reports/'+r.id)).status,200,'Doctor-only access is not broadened');
});

test('requires a registry primary pointer and supports precisely linked PACS-only finals',async()=>{
 const unpointed=await booking();await report(unpointed,{pointPrimary:false});assert.equal((await request(base(unpointed.id)+'/report')).status,404);
 const unlinked=await booking();await report(unlinked,{registry:false,appointmentId:null});assert.equal((await request(base(unlinked.id)+'/report')).status,404);
 const pacs=await booking();const final=await report(pacs,{appointmentId:null});assert.equal((await receptionSignedReport(pacs.id)).id,final.id);
 const page=await request('/api/v2/read/appointments?date='+new Date().toISOString().slice(0,10));assert.equal(page.status,200);const data=await page.json();const projected=data.appointments.find((row:{id:number})=>Number(row.id)===pacs.id);assert.equal(projected.report_status_source,'rispro');assert.equal(projected.can_view_native_report,true);
});

test('Chromium Reception delivery uses real authenticated services on desktop and mobile',{skip:process.env.RISPRO_RECEPTION_BROWSER!=='1'},async()=>{
  const {chromium,expect}=await import('@playwright/test');
  const b=await booking();await report(b,{image:true});
  const artifacts=await mkdtemp(join(tmpdir(),'rispro-reception-evidence-'));console.log('Reception browser evidence: '+artifacts);
  const browser=await chromium.launch({headless:true}),context=await browser.newContext({viewport:{width:1440,height:1000}});
  await context.addCookies([{name:env.cookieName,value:jwt.sign({sub:users.get('receptionist'),role:'receptionist'},env.jwtSecret),url:origin,httpOnly:true}]);
  await context.addInitScript(()=>{localStorage.setItem('rispro-language','en');window.print=()=>{(window as unknown as {receptionPrintCount:number}).receptionPrintCount=((window as unknown as {receptionPrintCount:number}).receptionPrintCount||0)+1;};});
  const page=await context.newPage(),errors:string[]=[];page.on('pageerror',error=>errors.push(error.message));
  try{
    await page.goto(origin+'/registrations?patientId='+patient);
    await page.getByRole('button',{name:'Completed',exact:true}).click();
    const row=page.getByText(b.identity.accession,{exact:true}).last().locator('xpath=ancestor::*[@role="button"][1]');await row.getByRole('button',{name:'Report',exact:true}).click();
    const modal=page.getByRole('dialog',{name:'Manage',exact:true});await expect(modal.getByText('Signed native primary report available.')).toBeVisible();await expect(modal.getByLabel('Report source')).toContainText('RISpro native');
    const opened=context.waitForEvent('page');await modal.getByRole('button',{name:'Open final report',exact:true}).click();const document=await opened;await document.waitForLoadState('load');await expect(document.getByText('IMMUTABLE SIGNED FINDINGS')).toBeVisible();await expect(document.locator('figure img')).toHaveJSProperty('naturalWidth',64);assert.equal(new URL(page.url()).pathname,'/registrations');await document.screenshot({path:join(artifacts,'signed-native-report.png')});await document.close();
    const printing=context.waitForEvent('page');await modal.getByRole('button',{name:'Print final report',exact:true}).click();const printed=await printing;await printed.waitForFunction(()=>(window as unknown as {receptionPrintCount:number}).receptionPrintCount===1);await printed.close();
    await page.screenshot({path:join(artifacts,'reception-desktop.png')});await page.setViewportSize({width:390,height:844});await expect(modal.getByRole('button',{name:'Open final report',exact:true})).toBeVisible();await expect(modal.getByRole('button',{name:'Print final report',exact:true})).toBeVisible();assert.ok(await modal.evaluate(element=>element.scrollWidth<=element.clientWidth+1));await page.screenshot({path:join(artifacts,'reception-mobile.png')});assert.deepEqual(errors,[]);await writeFile(join(artifacts,'result.json'),JSON.stringify({status:'PASS',services:'real built frontend, native reporting APIs, disposable PostgreSQL and PNG storage',printing:'browser print invocation observed; physical printer not exercised',desktop:true,mobile:true}));
  }catch(error){await page.screenshot({path:join(artifacts,'failure.png')});await writeFile(join(artifacts,'failure.txt'),await page.locator('body').innerText());throw error;}finally{await browser.close();}
});
