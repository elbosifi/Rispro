import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import jwt from "jsonwebtoken";
import { randomUUID } from "node:crypto";

process.env.DATABASE_URL ||= "postgresql://127.0.0.1/rispro_test";
process.env.JWT_SECRET ||= "test-secret";

function authCookie(cookieName: string, userId: number, role: string, username: string): string {
  return `${cookieName}=${jwt.sign({ sub: userId, role, username, fullName: `Orthanc ${role}` }, process.env.JWT_SECRET as string, { expiresIn: "1h" })}`;
}

test("Authoritative Orthanc Operations enforces the role matrix over HTTP", async () => {
  const [{ pool }, { createApp }, { env }] = await Promise.all([import("../db/pool.js"), import("../app.js"), import("../config/env.js")]);
  const suffix = randomUUID().replace(/-/g, "").slice(0, 10);
  const usernames: string[] = [];
  const created = { patientId: 0, examTypeId: 0, policySetId: 0, policyVersionId: 0, bookingId: 0, documentIds: [] as number[], exportIds: [] as number[] };
  const originalAuthoritative = await pool.query("select category, setting_key, setting_value, updated_by_user_id from system_settings where category='authoritative_orthanc'");
  const originalVisibility = await pool.query("select setting_value, updated_by_user_id from system_settings where category='users_and_roles' and setting_key='page_visibility_by_role'");
  const createUser = async (role: string) => {
    const username = `orth_ops_${role}_${suffix}`;
    usernames.push(username);
    const { rows } = await pool.query<{ id: string }>("insert into users(username,full_name,password_hash,role,is_active) values($1,$2,$3,$4,true) returning id::text id", [username, `Orthanc ${role}`, "$2a$10$ztv9Kx3klEC1wiHttYuwUeCN9KMI3yHuGjvRVEGFFVnbRu7YSfTyS", role]);
    const id = Number(rows[0]!.id);
    return authCookie(env.cookieName, id, role, username);
  };
  const [receptionist, doctor, modalityStaff, supervisor, superAdmin] = await Promise.all(["receptionist", "doctor", "modality_staff", "supervisor", "super_admin"].map(createUser));
  const modalityId = Number((await pool.query<{ id: number }>("select id from modalities where upper(code)='CT' order by id limit 1")).rows[0]?.id);
  assert.ok(modalityId);
  created.examTypeId = Number((await pool.query<{ id: number }>("insert into exam_types(modality_id,code,name_ar,name_en) values($1,$2,'فحص','Orthanc route test') returning id", [modalityId, `ORTH_ROUTE_${suffix}`])).rows[0]!.id);
  created.policySetId = Number((await pool.query<{ id: number }>("insert into appointments_v2.policy_sets(key,name) values($1,'Orthanc route test') returning id", [`orth_route_${suffix}`])).rows[0]!.id);
  created.policyVersionId = Number((await pool.query<{ id: number }>("insert into appointments_v2.policy_versions(policy_set_id,version_no,status,config_hash) values($1,1,'published',$2) returning id", [created.policySetId, `hash-${suffix}`])).rows[0]!.id);
  created.patientId = Number((await pool.query<{ id: number }>("insert into patients(mrn,identifier_type,identifier_value,arabic_full_name,english_full_name,normalized_arabic_name,age_years,sex,phone_1) values($1,'other',$2,'مريض اختبار','Route Patient','مريض اختبار',40,'O',$3) returning id", [`ROUTE-MRN-${suffix}`, `ROUTE-${suffix}`, `09${suffix.slice(0, 8)}`])).rows[0]!.id);
  const studyUid = `2.25.${Date.now()}${Math.floor(Math.random() * 1_000_000)}`;
  created.bookingId = Number((await pool.query<{ id: number }>("insert into appointments_v2.bookings(patient_id,modality_id,exam_type_id,booking_date,case_category,status,completed_at,policy_version_id,study_instance_uid) values($1,$2,$3,current_date,'non_oncology','completed',now(),$4,$5) returning id", [created.patientId, modalityId, created.examTypeId, created.policyVersionId, studyUid])).rows[0]!.id);
  const createRebuildAnchor = async (destinationKey: string, index: number) => {
    let anchorId = 0;
    for (const documentType of ["appointment_request", "clinical_document"]) {
      const documentId = Number((await pool.query<{ id: number }>("insert into documents(patient_id,document_type,source,original_filename,stored_path,mime_type,file_size,v2_booking_id) values($1,$2,'manual_upload',$3,$4,'image/png',3,$5) returning id", [created.patientId, documentType, `route-${index}-${documentType}.png`, `documents/export-test/route-${suffix}-${index}-${documentType}.png`, created.bookingId])).rows[0]!.id);
      created.documentIds.push(documentId);
      const exportId = Number((await pool.query<{ id: number }>("insert into clinical_document_exports(document_id,appointment_id,destination_key,status,representation_type,study_instance_uid,series_instance_uid,expected_page_count,exported_page_count,verified_page_count,exported_at,verified_at) values($1,$2,$3,'exported','secondary_capture',$4,$5,1,1,1,now(),now()) returning id", [documentId, created.bookingId, destinationKey, studyUid, `${studyUid}.${index}.${documentType === "appointment_request" ? 1 : 2}`])).rows[0]!.id);
      created.exportIds.push(exportId);
      if (!anchorId) anchorId = exportId;
    }
    return anchorId;
  };
  const supervisorRebuildAnchor = await createRebuildAnchor("orthanc_remote:ROUTE_SUPERVISOR", 1);
  const superAdminRebuildAnchor = await createRebuildAnchor("orthanc_remote:ROUTE_ADMIN", 2);
  await pool.query("delete from system_settings where category='authoritative_orthanc'");
  await pool.query(`insert into system_settings(category,setting_key,setting_value) values
    ('authoritative_orthanc','enabled','{"value":"disabled"}'::jsonb),
    ('authoritative_orthanc','auto_export_clinical_documents','{"value":"enabled"}'::jsonb),
    ('authoritative_orthanc','auto_route_enabled','{"value":"disabled"}'::jsonb),
    ('authoritative_orthanc','auto_route_destination_keys','{"value":"[]"}'::jsonb),
    ('authoritative_orthanc','base_url','{"value":""}'::jsonb),
    ('authoritative_orthanc','username','{"value":""}'::jsonb),
    ('authoritative_orthanc','password','{"value":""}'::jsonb),
    ('authoritative_orthanc','timeout_seconds','{"value":"5"}'::jsonb),
    ('authoritative_orthanc','verify_tls','{"value":"true"}'::jsonb),
    ('authoritative_orthanc','display_name','{"value":""}'::jsonb)`);
  const visibility = { "authoritative.orthanc": ["modality_staff", "supervisor", "super_admin"], settings: ["super_admin"] };
  await pool.query("insert into system_settings(category,setting_key,setting_value) values('users_and_roles','page_visibility_by_role',$1::jsonb) on conflict(category,setting_key) do update set setting_value=excluded.setting_value", [JSON.stringify({ value: visibility })]);

  const server = http.createServer(createApp());
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const address = server.address() as { port: number };
  const request = async (path: string, cookie?: string, method = "GET") => fetch(`http://127.0.0.1:${address.port}/api/integrations/authoritative-orthanc${path}`, { method, headers: cookie ? { Cookie: cookie } : undefined });
  try {
    assert.equal((await request("/operations/summary")).status, 401);
    assert.equal((await request("/operations/summary", receptionist)).status, 403);
    assert.equal((await request("/operations/summary", doctor)).status, 403);
    assert.equal((await request("/operations/summary", modalityStaff)).status, 200);
    assert.equal((await request("/operations/historical-pacs-index/status", modalityStaff)).status, 200);
    assert.equal((await request("/operations/historical-pacs-index/sync", modalityStaff, "POST")).status, 403);
    assert.equal((await request("/operations/historical-pacs-index/recover-and-full-reconcile", modalityStaff, "POST")).status, 403);
    const lockClient = await pool.connect();
    try {
      await lockClient.query(`select pg_advisory_lock(712364092)`);
      const alreadyRunning = await request("/operations/historical-pacs-index/sync", supervisor, "POST");
      assert.equal(alreadyRunning.status, 409);
      assert.equal((await alreadyRunning.json()).error.details.code, "historical_pacs_sync_already_running");
    } finally {
      await lockClient.query(`select pg_advisory_unlock(712364092)`);
      lockClient.release();
    }
    const waitForSyncLockRelease = async () => {
      for (let attempt = 0; attempt < 100; attempt += 1) {
        const probe = await pool.connect();
        try {
          const result = await probe.query<{ acquired: boolean }>(`select pg_try_advisory_lock(712364092) acquired`);
          if (result.rows[0]?.acquired) { await probe.query(`select pg_advisory_unlock(712364092)`); return; }
        } finally { probe.release(); }
        await new Promise((resolve) => setTimeout(resolve, 25));
      }
      assert.fail("Historical PACS synchronization lock was not released.");
    };
    assert.equal((await request("/operations/historical-pacs-index/sync", supervisor, "POST")).status, 202);
    await waitForSyncLockRelease();
    const forced = await request("/operations/historical-pacs-index/full-reconciliation", superAdmin, "POST");
    assert.equal(forced.status, 202);
    assert.equal((await forced.json()).mode, "full");
    await waitForSyncLockRelease();
    await pool.query(`update historical_pacs_sync_state set sync_run_status='running',sync_mode='full',sync_progress_at=now(),sync_processed=0,sync_total=31141,last_error=null where singleton_key=true`);
    const notStalled = await request("/operations/historical-pacs-index/recover-and-full-reconcile", supervisor, "POST");
    assert.equal(notStalled.status, 409);
    assert.equal((await notStalled.json()).error.details.code, "historical_pacs_sync_not_stalled");
    await pool.query(`update historical_pacs_sync_state set sync_progress_at=now()-interval '10 minutes' where singleton_key=true`);
    const recoveryLock = await pool.connect();
    try {
      await recoveryLock.query(`select pg_advisory_lock(712364092)`);
      const active = await request("/operations/historical-pacs-index/recover-and-full-reconcile", supervisor, "POST");
      assert.equal(active.status, 409);
      assert.equal((await active.json()).error.details.code, "historical_pacs_sync_recovery_active_run");
    } finally {
      await recoveryLock.query(`select pg_advisory_unlock(712364092)`);
      recoveryLock.release();
    }
    const supervisorRecovery = await request("/operations/historical-pacs-index/recover-and-full-reconcile", supervisor, "POST");
    assert.equal(supervisorRecovery.status, 202);
    await waitForSyncLockRelease();
    await pool.query(`update historical_pacs_sync_state set sync_run_status='running',sync_mode='full',sync_progress_at=now()-interval '10 minutes',sync_processed=0,sync_total=31141,last_error=null where singleton_key=true`);
    const superAdminRecovery = await request("/operations/historical-pacs-index/recover-and-full-reconcile", superAdmin, "POST");
    assert.equal(superAdminRecovery.status, 202);
    await waitForSyncLockRelease();
    assert.equal((await request("/operations/routes/test-all", modalityStaff, "POST")).status, 403);
    assert.equal((await request("/operations/routes/test-all", supervisor, "POST")).status, 409);
    assert.equal((await request("/operations/routes/synchronize", supervisor, "POST")).status, 403);
    const synchronized = await request("/operations/routes/synchronize", superAdmin, "POST");
    assert.equal(synchronized.status, 200);
    assert.deepEqual((await synchronized.json()).summary, { created: 0, updated: 0, unchanged: 0, removed: 0, warnings: [] });
    assert.equal((await request("/document-exports/reconcile", supervisor, "POST")).status, 403);
    assert.equal((await request("/document-exports/reconcile", superAdmin, "POST")).status, 410);
    assert.equal((await request(`/document-exports/${supervisorRebuildAnchor}/rebuild-secondary-capture`, modalityStaff, "POST")).status, 403);
    assert.equal((await request(`/document-exports/${supervisorRebuildAnchor}/rebuild-secondary-capture`, supervisor, "POST")).status, 202);
    assert.equal((await request(`/document-exports/${superAdminRebuildAnchor}/rebuild-secondary-capture`, superAdmin, "POST")).status, 202);
  } finally {
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    await pool.query("delete from system_settings where category='authoritative_orthanc'");
    for (const row of originalAuthoritative.rows) await pool.query("insert into system_settings(category,setting_key,setting_value,updated_by_user_id) values($1,$2,$3,$4)", [row.category, row.setting_key, row.setting_value, row.updated_by_user_id]);
    await pool.query("delete from system_settings where category='users_and_roles' and setting_key='page_visibility_by_role'");
    if (originalVisibility.rows[0]) await pool.query("insert into system_settings(category,setting_key,setting_value,updated_by_user_id) values('users_and_roles','page_visibility_by_role',$1,$2)", [originalVisibility.rows[0].setting_value, originalVisibility.rows[0].updated_by_user_id]);
    await pool.query("delete from audit_log where changed_by_user_id in (select id from users where username=any($1::text[]))", [usernames]);
    if (created.exportIds.length) await pool.query("delete from clinical_document_exports where id=any($1::bigint[])", [created.exportIds]);
    if (created.documentIds.length) await pool.query("delete from documents where id=any($1::bigint[])", [created.documentIds]);
    if (created.bookingId) await pool.query("delete from appointments_v2.bookings where id=$1", [created.bookingId]);
    if (created.patientId) await pool.query("delete from patients where id=$1", [created.patientId]);
    await pool.query("delete from users where username=any($1::text[])", [usernames]);
    if (created.examTypeId) await pool.query("delete from exam_types where id=$1", [created.examTypeId]);
    if (created.policyVersionId) await pool.query("delete from appointments_v2.policy_versions where id=$1", [created.policyVersionId]);
    if (created.policySetId) await pool.query("delete from appointments_v2.policy_sets where id=$1", [created.policySetId]);
  }
});
