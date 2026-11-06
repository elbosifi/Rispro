import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { createServer, type Server } from 'node:http';
import { createHash, randomUUID } from 'node:crypto';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { pool } from '../../db/pool.js';
import { env } from '../../config/env.js';
import { createApp } from '../../app.js';
import { buildSupervisorReauthToken } from '../../services/auth-service.js';
import { MODULE_REGISTRY } from './module-registry.js';
import { resolveModuleAccess, updateModuleAccess } from './module-access-service.js';
import { requiredModulesForApi } from './module-access-middleware.js';
import { createViewerLaunchSession } from '../ohif-viewer/repository.js';
import { seedTestData, cleanupTestData, type TestData } from '../appointments-v2/tests/integration/helpers.js';
import { PERMISSIONS } from '../gamma-knife/gamma-knife-types.js';

const prefix = `modules_${randomUUID().replaceAll('-','').slice(0,12)}_`;
const password = 'Synthetic Module Account 2026!';
const accounts = new Map<string, { id: number; cookie: string; modules: string[] }>();
let fixture: TestData;
let server: Server;
let base: string;
let adminCookie: string;
let adminId: number;
let episodeId: number;
let documentId: number;
let contextId: string;
let launchToken: string;
let viewerSessionId: number;
let bookingId: number;
let supervisorCookie: string;

async function call(cookie: string, path: string, method = 'GET', body?: unknown) {
  const response = await fetch(base + path, { method, redirect: 'manual', headers: { cookie, ...(body === undefined ? {} : { 'content-type':'application/json' }) }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  return response;
}
async function signIn(name: string) {
  const response = await call('', '/api/auth/login', 'POST', { username: prefix + name, password });
  assert.equal(response.status, 200, await response.clone().text());
  return response.headers.get('set-cookie')!.split(';',1)[0]!;
}

describe('module admission on createApp real routing, sessions and services', { concurrency: false }, () => {
  before(async () => {
    assert.match((await pool.query('select current_database() as name')).rows[0].name, /test|e2e/);
    fixture = await seedTestData('appointments_v2', prefix);
    const hash = await bcrypt.hash(password, 4);
    adminId = Number((await pool.query(`insert into users(username,password_hash,full_name,role,gamma_knife_permissions) values($1,$2,'Synthetic Module Administrator','super_admin',$3::text[]) returning id`, [prefix+'admin', hash, PERMISSIONS])).rows[0].id);
    server = createServer(createApp());
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
    base = `http://127.0.0.1:${(server.address() as { port:number }).port}`;
    adminCookie = await signIn('admin');
    adminCookie += `; ${env.reauthCookieName}=${buildSupervisorReauthToken({ id:adminId, username:prefix+'admin', role:'super_admin', auth_version:0 })}`;
    for (const [name, role, modules] of [
      ['neurosurgeon','doctor',['gamma-knife']], ['reception','receptionist',['core']],
      ['radiologist','doctor',['doctor']], ['coordinator','administrative',['core','gamma-knife']],
      ['radio_gk','doctor',['doctor','gamma-knife']], ['learner','doctor',['teaching']],
      ['multiple','doctor',['core','doctor','gamma-knife','teaching']],
    ] as const) {
      const id = Number((await pool.query(`insert into users(username,password_hash,full_name,role,gamma_knife_permissions) values($1,$2,$3,$4,$5::text[]) returning id`, [prefix+name, hash, `Synthetic ${name}`, role, ['access','referral','clinical']])).rows[0].id);
      if (role === 'doctor') await pool.query("insert into doctor_portal.doctor_profiles(user_id,display_name,doctor_role,active) values($1,'Synthetic Doctor','consultant',true)", [id]);
      const updated = await call(adminCookie, `/api/users/${id}/module-access`, 'PUT', { mode:'restricted', grants: modules, defaultModule: modules[0] });
      assert.equal(updated.status, 200, await updated.text());
      accounts.set(name, { id, cookie: await signIn(name), modules:[...modules] });
    }
    const supervisorId = Number((await pool.query("insert into users(username,password_hash,full_name,role) values($1,$2,'Synthetic Supervisor','supervisor') returning id",[prefix+'guard',hash])).rows[0].id);
    supervisorCookie=await signIn('guard');
    supervisorCookie+=`; ${env.reauthCookieName}=${buildSupervisorReauthToken({id:supervisorId,username:prefix+'guard',role:'supervisor',auth_version:0})}`;
    accounts.set('guard',{id:supervisorId,cookie:supervisorCookie,modules:[]});
    const created = await call(adminCookie, '/api/gamma-knife/episodes', 'POST', { patientId:fixture.patientId, diagnosis:'Synthetic module authorization', diagnosisCategory:'Other' });
    assert.equal(created.status,201,await created.clone().text());
    episodeId = (await created.json() as { episode:{ id:number } }).episode.id;
    const content = Buffer.from('%PDF-1.4 synthetic module document');
    documentId = Number((await pool.query(`insert into documents(patient_id,document_type,original_filename,stored_path,mime_type,file_size,content_sha256,storage_location_type,source) values($1,'gamma_knife','Synthetic.pdf',$2,'application/pdf',$3,$4,'local_fallback','manual_upload') returning id`, [fixture.patientId, prefix+'missing.pdf', content.length, createHash('sha256').update(content).digest('hex')])).rows[0].id);
    await pool.query("insert into document_ha_blobs(document_id,content,byte_size,content_sha256,retention_due_at) values($1,$2,$3,$4,now()+interval '48 hours')", [documentId,content,content.length,createHash('sha256').update(content).digest('hex')]);
    await pool.query("insert into gamma_knife_documents(document_id,episode_id,category,created_by) values($1,$2,'investigation',$3)",[documentId,episodeId,adminId]);
  });

  after(async () => {
    if (server) await new Promise<void>((resolve,reject) => server.close(e => e ? reject(e) : resolve()));
    if (viewerSessionId) await pool.query('delete from viewer_launch_sessions where id=$1',[viewerSessionId]);
    if (bookingId) await pool.query('delete from scan_sessions where v2_booking_id=$1',[bookingId]);
    if (bookingId) await pool.query('delete from appointments_v2.bookings where id=$1',[bookingId]);
    if (episodeId) {
      await pool.query('delete from gamma_knife_documents where episode_id=$1',[episodeId]);
      await pool.query('delete from gamma_knife_readiness_items where episode_id=$1',[episodeId]);
      await pool.query('delete from gamma_knife_history where episode_id=$1',[episodeId]);
      await pool.query('delete from gamma_knife_episodes where id=$1',[episodeId]);
    }
    if (documentId) await pool.query('delete from documents where id=$1',[documentId]);
    const ids = [...accounts.values()].map(a => a.id);
    if (adminId) ids.push(adminId);
    for (const id of ids) {
      await pool.query("delete from teaching.user_permissions where identity_issuer='rispro' and identity_subject=$1",[String(id)]);
      await pool.query("delete from teaching.user_profiles where identity_issuer='rispro' and identity_subject=$1",[String(id)]);
    }
    await pool.query('delete from doctor_portal.reporting_board_saved_views where target_doctor_id in (select id from doctor_portal.doctor_profiles where user_id=any($1::bigint[]))',[ids]);
    await pool.query('delete from doctor_portal.doctor_profiles where user_id=any($1::bigint[])',[ids]);
    await pool.query('delete from audit_log where changed_by_user_id=any($1::bigint[])',[ids]);
    await pool.query('delete from user_module_grants where user_id=any($1::bigint[])',[ids]);
    await pool.query('delete from users where id=any($1::bigint[])',[ids]);
    if (fixture) await cleanupTestData(prefix);
    await pool.end();
  });

  it('keeps Reporting Board, mobile summary, and public appointment API boundaries correctly classified', async () => {
    const coreOnly = await resolveModuleAccess(accounts.get('reception')!.id);
    const doctorAndGammaKnife = await resolveModuleAccess(accounts.get('radio_gk')!.id);
    assert.equal(requiredModulesForApi('GET','/reporting/saved-views/public',coreOnly),'shared');
    assert.equal(requiredModulesForApi('POST','/reporting/saved-views/public',coreOnly),'shared');
    assert.equal(requiredModulesForApi('GET','/mobile/operations-summary',coreOnly),'shared');
    assert.equal(requiredModulesForApi('POST','/public/appointments/123/cancel',coreOnly),'shared');
    assert.deepEqual(requiredModulesForApi('GET','/doctor/reporting-board',coreOnly),['doctor']);
    assert.equal(coreOnly.modules.some(module => module.id === 'doctor' && module.effective),false);
    assert.deepEqual(requiredModulesForApi('GET','/doctor/reporting-board',doctorAndGammaKnife),['doctor']);
    assert.equal(doctorAndGammaKnife.modules.some(module => module.id === 'doctor' && module.effective),true);
  });

  for (const name of ['neurosurgeon','reception','radiologist','coordinator','radio_gk','learner','multiple']) {
    it(`${name}: exact effective modules, direct routes, shared security and dictation`, async () => {
      const account = accounts.get(name)!;
      const session = await call(account.cookie, '/api/auth/me');
      assert.equal(session.status,200);
      const access = (await session.json() as { user:{ moduleAccess: Awaited<ReturnType<typeof resolveModuleAccess>> } }).user.moduleAccess;
      assert.deepEqual(access.modules.filter(m => m.effective).map(m => m.id).sort(), [...account.modules].sort());
      assert.deepEqual(requiredModulesForApi('POST','/medgemma/generate',access),['doctor'],'Doctor clinical inference must not require a Core grant');
      for (const [id,path] of [['core','/api/patients?q=synthetic'],['doctor','/api/doctor/me'],['gamma-knife','/api/gamma-knife/episodes'],['teaching','/api/teaching/me']]) {
        const allowed = account.modules.includes(id) || (id==='doctor' && account.modules.includes('core'));
        const res = await call(account.cookie,path);
        assert.equal(res.status,allowed && !(name==='coordinator' && id==='core') ? 200 : 403, `${name} ${path}: ${await res.text()}`);
      }
      assert.equal((await call(account.cookie,'/api/action-pin/status')).status,200);
      assert.equal((await call(account.cookie,'/api/action-pin/idle-lock','POST',{})).status,200);
      assert.equal((await call(account.cookie,'/api/medical-dictation/health')).status,account.modules.some(id => id!=='teaching') ? 200 : 403);
      const badAudio = await call(account.cookie,'/api/medical-dictation/transcribe','POST',{});
      assert.equal(badAudio.status,account.modules.some(id => id!=='teaching') ? 400 : 403);
      assert.equal((await call(account.cookie,'/api/action-pin/admin/users')).status,403);
      assert.equal((await call(account.cookie,'/api/medical-dictation/settings')).status,403);
      const workstationAllowed = name !== 'learner' && name !== 'coordinator';
      assert.equal((await call(account.cookie,'/api/printing/runtime-config')).status,workstationAllowed ? 200 : 403);
      assert.equal((await call(account.cookie,'/api/scanner-bootstrap/settings')).status,workstationAllowed ? 200 : 403);
      if (!account.modules.includes('core')) {
        for (const path of ['/api/users','/api/settings','/api/scan-sessions','/api/pacs','/api/documents','/api/integrations/status','/api/unknown-future-api','/api/gamma-knife-escape','/api/auth/unknown']) assert.equal((await call(account.cookie,path)).status,403,path);
        assert.equal((await call(account.cookie,`/api/users/${account.id}/module-access`,'PUT',{mode:'legacy',grants:[],defaultModule:null})).status,403);
        assert.equal((await call(account.cookie,'/api/printing/registration-list/pdf','POST',{})).status,403,'shared workstation support must not expose the printing namespace');
      }
    });
  }

  it('unrestricted super administrator retains administrative access without receiving clinical permissions from a grant', async () => {
    const access = await resolveModuleAccess(adminId);
    assert.equal(access.mode,'legacy');
    assert.equal(access.modules.filter(m => m.effective).length,4);
    assert.equal((await call(adminCookie,'/api/users')).status,200);
    assert.equal((await call(adminCookie,`/api/users/${adminId}/module-access`,'PUT',{mode:'restricted',grants:['core'],defaultModule:'core'})).status,403);
    const receptionist = accounts.get('reception')!;
    assert.equal((await call(adminCookie,`/api/users/${receptionist.id}/module-access`,'PUT',{mode:'restricted',grants:['doctor'],defaultModule:'doctor'})).status,409);
  });

  it('rejects malformed signed user identities without a database error', async () => {
    assert.equal((await call(`${env.cookieName}=${jwt.sign({sub:'not-a-user',role:'doctor'},env.jwtSecret)}`,'/api/auth/me')).status,401);
  });

  it('prevents self-granted administrative/clinical authority and protects the last usable Doctor profile', async () => {
    const supervisor=accounts.get('guard')!;
    assert.equal((await call(supervisor.cookie,`/api/users/${supervisor.id}/module-access`,'PUT',{mode:'legacy',grants:[],defaultModule:'core'})).status,403);
    assert.equal((await call(supervisor.cookie,`/api/users/${adminId}/module-access`,'PUT',{mode:'restricted',grants:['core'],defaultModule:'core'})).status,403);
    const configuration=await (await call(adminCookie,'/api/gamma-knife/settings')).json() as {config:unknown};
    assert.equal((await call(supervisor.cookie,'/api/gamma-knife/settings','PUT',{config:configuration.config,users:[{id:supervisor.id,permissions:['access','clinical']}]})).status,403);
    assert.equal((await call(supervisor.cookie,'/api/doctor/profiles','POST',{userId:supervisor.id,displayName:'Synthetic Supervisor',doctorRole:'consultant',active:true,canFinalizeReports:true,canAssignProtocols:true,canSupervise:true})).status,403);
    const radiologist=accounts.get('radiologist')!;
    const profile=(await pool.query('select id from doctor_portal.doctor_profiles where user_id=$1',[radiologist.id])).rows[0];
    assert.equal((await call(adminCookie,`/api/doctor/profiles/${profile.id}`,'PATCH',{active:false})).status,409);
    assert.equal((await call(radiologist.cookie,'/api/doctor/me')).status,200,'rejected deactivation must roll back the authorization version');
  });

  it('denies guessed document IDs, metadata and generic document URLs without documents permission', async () => {
    const account = accounts.get('neurosurgeon')!;
    const response = await call(account.cookie,`/api/gamma-knife/episodes/${episodeId}`);
    assert.deepEqual((await response.json() as { documents:unknown[] }).documents,[]);
    for (const id of [documentId,documentId+999999]) assert.equal((await call(account.cookie,`/api/gamma-knife/episodes/${episodeId}/documents/${id}`)).status,403);
    assert.equal((await call(account.cookie,`/api/documents/${documentId}/view`)).status,403);
    const content = await call(adminCookie,`/api/gamma-knife/episodes/${episodeId}/documents/${documentId}`);
    assert.equal(content.status,200,await content.clone().text());
    assert.match(await content.text(),/synthetic module document/);
    assert.equal((await call(accounts.get('reception')!.cookie,`/api/documents/${documentId}/view`)).status,404);
    assert.equal((await call(account.cookie,`/api/public/gamma-knife/documents/${documentId}`)).status,404,'patient QR still requires its own valid protected token');
  });

  it('effective-access administration applies module boundaries to role/profile permissions and audits changes', async () => {
    const account = accounts.get('neurosurgeon')!;
    const response = await call(adminCookie,`/api/users/${account.id}/effective-access`);
    const { access } = await response.json() as { access:{ doctorPortal:{ profile:{ effective:boolean } }; navigationVisibility:{ pages:{visible:boolean}[] } } };
    assert.equal(access.doctorPortal.profile.effective,false);
    assert.ok(access.navigationVisibility.pages.every(p => !p.visible));
    const audit = await call(adminCookie,`/api/users/${account.id}/security-activity`);
    assert.match(await audit.text(),/update_module_access/);
    assert.equal((await call(adminCookie,`/api/users/${account.id}/module-access`,'PUT',{mode:'restricted',grants:[],defaultModule:null})).status,409);
    assert.equal((await call(adminCookie,`/api/users/${account.id}/module-access`,'PUT',{mode:'restricted',grants:['laboratory'],defaultModule:'laboratory'})).status,400);
  });

  it('a future registered but unavailable module grants no clinical or existing module authority', async () => {
    const account = accounts.get('learner')!;
    const access = await resolveModuleAccess(account.id,pool,[...MODULE_REGISTRY,{id:'laboratory',nameEn:'Laboratory',nameAr:'المختبر',landingPath:'/laboratory',frontendPrefixes:['/laboratory'],apiPrefixes:['/laboratory'],available:false,dictation:false,capability:'explicit',legacyAccess:false}]);
    assert.equal(access.modules.find(m => m.id==='laboratory')!.effective,false);
    assert.equal((await call(account.cookie,'/api/laboratory/patients')).status,403);
    const future={id:'laboratory',nameEn:'Laboratory',nameAr:'المختبر',landingPath:'/laboratory',frontendPrefixes:['/laboratory'],apiPrefixes:['/laboratory'],available:true,dictation:false,capability:'explicit' as const,legacyAccess:false};
    const legacy=await resolveModuleAccess(accounts.get('guard')!.id,pool,[...MODULE_REGISTRY,future]);
    assert.equal(legacy.modules.find(m=>m.id==='laboratory')!.effective,false,'ordinary legacy users never inherit a newly registered module');
    assert.deepEqual(requiredModulesForApi('GET','/laboratory/patients',legacy),['laboratory']);
  });

  it('blocks removal of the last clinical capability and requires an explicit deactivation to leave no modules', async () => {
    const account = accounts.get('neurosurgeon')!;
    const configuration = await (await call(adminCookie,'/api/gamma-knife/settings')).json() as {config:unknown};
    const revoked = await call(adminCookie,'/api/gamma-knife/settings','PUT',{config:configuration.config,users:[{id:account.id,permissions:[]}]});
    assert.equal(revoked.status,409);
    assert.equal((await call(account.cookie,'/api/gamma-knife/episodes')).status,200,'failed access change rolls back auth version and capability');
    assert.equal((await call(adminCookie,`/api/users/${account.id}/active`,'PUT',{isActive:false})).status,200);
    assert.equal((await call(adminCookie,`/api/users/${account.id}/module-access`,'PUT',{mode:'restricted',grants:[],defaultModule:null})).status,200);
    assert.equal((await call(adminCookie,`/api/users/${account.id}/active`,'PUT',{isActive:true})).status,409,'activation must not leave an unusable account');
    assert.equal((await call(adminCookie,`/api/users/${account.id}/module-access`,'PUT',{mode:'restricted',grants:['gamma-knife'],defaultModule:'gamma-knife'})).status,200);
    assert.equal((await call(adminCookie,`/api/users/${account.id}/active`,'PUT',{isActive:true})).status,200);
    account.cookie=await signIn('neurosurgeon');
  });

  it('revokes existing proxy cookies, native paths, launch tokens, contexts and recovery on module removal', async () => {
    const account = accounts.get('radiologist')!;
    launchToken = 'x'.repeat(48);
    bookingId = Number((await pool.query(`insert into appointments_v2.bookings(patient_id,modality_id,exam_type_id,booking_date,booking_time,case_category,requires_report,status,policy_version_id,capacity_resolution_mode,uses_special_quota,is_walk_in,created_by_user_id)
      values($1,$2,$3,'2045-05-12','09:00','non_oncology',true,'scheduled',$4,'standard',false,false,$5) returning id`, [fixture.patientId,fixture.modalityId,fixture.examTypeId,fixture.policyVersionId,adminId])).rows[0].id);
    viewerSessionId = await createViewerLaunchSession({userId:account.id,appointmentId:bookingId,sourcePacsNodeId:null,accessStrategy:'authoritative_orthanc',currentStudyUid:'1.2.3',permittedStudyUids:['1.2.3'],tokenHash:createHash('sha256').update(launchToken).digest('hex'),expiresAt:new Date(Date.now()+3600000),patientId:fixture.patientId});
    const stored = (await pool.query('update viewer_launch_sessions set used_at=now(),viewer_session_token_hash=$2 where id=$1 returning report_context_id',[viewerSessionId,createHash('sha256').update('issued-cookie').digest('hex')])).rows[0];
    contextId = stored.report_context_id;
    // Invalid study requests are still denied by the original viewer/record guards before revocation.
    assert.equal((await call(account.cookie+`; ${env.ohifSessionCookieName}=issued-cookie`,'/ohif-dicomweb/context/'+contextId+'/studies/9.9.9')).status,403);
    await updateModuleAccess(account.id,{mode:'restricted',grants:['teaching'],defaultModule:'teaching'},{userId:adminId,role:'super_admin'});
    assert.equal((await call(account.cookie,'/api/auth/me')).status,401,'old login cookie must be revoked');
    account.cookie = await signIn('radiologist');
    for (const path of ['/ohif-dicomweb/studies/1.2.3',`/ohif-dicomweb/context/${contextId}/studies/1.2.3`,`/api/ohif/contexts/${contextId}/studies`,`/api/ohif/launch/${launchToken}`,'/api/ohif/native/authorize']) {
      const denied=await call(account.cookie+`; ${env.ohifSessionCookieName}=issued-cookie`,path);
      assert.equal(denied.status,403,path);
      assert.equal((await denied.json() as {error:{details:{code:string}}}).error.details.code,'MODULE_ACCESS_DENIED','denial must come from live module policy, including when native delivery is disabled');
    }
    assert.equal((await call(account.cookie,`/api/ohif/contexts/${contextId}/renew`,'POST',{})).status,403);
    assert.ok((await pool.query('select revoked_at from viewer_launch_sessions where id=$1',[viewerSessionId])).rows[0].revoked_at);
    const viewerLogin = await call('', '/api/auth/login','POST',{username:prefix+'radiologist',password,viewerContextId:contextId});
    assert.equal(viewerLogin.status,403);
  });

  it('rechecks scanner companion tokens after the requesting user loses Core access', async () => {
    const account=accounts.get('multiple')!;
    const issued=await call(account.cookie,'/api/scan-sessions','POST',{appointmentId:bookingId,patientId:fixture.patientId,appointmentRefType:'v2_booking',documentType:'appointment_request'});
    assert.equal(issued.status,201,await issued.clone().text());
    const token=new URL((await issued.json() as {launchUrl:string}).launchUrl).searchParams.get('token')!;
    const tokenRead=() => fetch(base+'/api/scan-sessions/context',{headers:{'X-RISpro-Scan-Token':token}});
    assert.equal((await tokenRead()).status,200);
    await updateModuleAccess(account.id,{mode:'restricted',grants:['doctor','gamma-knife'],defaultModule:'doctor'},{userId:adminId,role:'super_admin'});
    assert.equal((await tokenRead()).status,403);
  });
});
