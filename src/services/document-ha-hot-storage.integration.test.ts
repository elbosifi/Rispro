import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { after, before, test } from "node:test";
import { env } from "../config/env.js";
import { pool } from "../db/pool.js";
import { sha256Buffer } from "./backup-v3-checksums.js";
import {
  getDocumentAbsolutePath,
  readDocumentContent,
  uploadDocument,
  uploadDocumentIdempotently,
  type DocumentRow,
} from "./document-service.js";
import { upsertSettings } from "./settings-service.js";
import {
  isDocumentEligibleForHaHotStorage,
  normalizeDocumentHaRetentionHours,
  runDocumentHaStorageReconciliation,
} from "./document-ha-hot-storage-service.js";

const originalUploadsDir = env.uploadsDir;
const tempUploadsDir = path.join(os.tmpdir(), `rispro-document-ha-${crypto.randomUUID()}`);
const createdDocumentIds: number[] = [];
const createdBookingIds: number[] = [];
const createdPatientIds: number[] = [];
const createdPolicyVersionIds: number[] = [];
const createdPolicySetIds: number[] = [];
const createdExamTypeIds: number[] = [];
const createdModalityIds: number[] = [];
const createdUserIds: number[] = [];
const settingsBefore = new Map<string, unknown | null>();
let fixture: { bookingId: number; patientId: number; userId: number } | null = null;
let sequence = 0;

const settingKeys = ["storage_path", "storage_fallback_enabled", "ha_hot_storage_enabled", "ha_hot_storage_retention_hours"];

async function setDocumentSetting(key: string, value: unknown): Promise<void> {
  await pool.query(
    `insert into system_settings(category, setting_key, setting_value)
     values('documents_and_uploads', $1, $2::jsonb)
     on conflict(category, setting_key) do update set setting_value=excluded.setting_value, updated_at=now()`,
    [key, JSON.stringify({ value: String(value) })],
  );
}

async function markDue(documentId: number): Promise<void> {
  await pool.query("update document_ha_blobs set created_at=now()-interval '2 hours', retention_due_at=now()-interval '1 minute' where document_id=$1", [documentId]);
}

async function createFixture(): Promise<{ bookingId: number; patientId: number; userId: number }> {
  sequence += 1;
  const marker = `${Date.now()}_${sequence}_${crypto.randomUUID().slice(0, 8)}`;
  const user = await pool.query<{ id: number }>(
    "insert into users(username,full_name,password_hash,role,is_active) values($1,$2,'test','supervisor',true) returning id",
    [`document_ha_${marker}`, `Document HA ${marker}`],
  );
  const userId = Number(user.rows[0]!.id);
  createdUserIds.push(userId);
  const patient = await pool.query<{ id: number }>(
    `insert into patients(national_id,identifier_type,identifier_value,arabic_full_name,english_full_name,normalized_arabic_name,age_years,estimated_date_of_birth,sex,phone_1,address,created_by_user_id,updated_by_user_id)
     values($1,'national_id',$2,$3,$4,$5,35,'1991-01-01','M','0912345678','Test',$6,$6) returning id`,
    [
      `9${marker.replace(/\D/g, "").slice(-11).padStart(11, "0")}`,
      `9${marker.replace(/\D/g, "").slice(-11).padStart(11, "0")}`,
      `Ø·Ù„Ø¨ ${marker}`,
      `Document HA ${marker}`,
      `Ø·Ù„Ø¨${marker}`,
      userId,
    ],
  );
  const patientId = Number(patient.rows[0]!.id);
  createdPatientIds.push(patientId);
  const modality = await pool.query<{ id: number }>(
    "insert into modalities(code,name_ar,name_en,daily_capacity,is_active) values($1,$2,$3,20,true) returning id",
    [`DHA${marker.slice(-8)}`, `Ù…ÙˆØ¯ ${marker}`, `Document HA modality ${marker}`],
  );
  const modalityId = Number(modality.rows[0]!.id);
  createdModalityIds.push(modalityId);
  const exam = await pool.query<{ id: number }>(
    "insert into exam_types(modality_id,code,name_ar,name_en,is_active) values($1,$2,$3,$4,true) returning id",
    [modalityId, `document_ha_exam_${marker}`, `ÙØ­Øµ ${marker}`, `Document HA exam ${marker}`],
  );
  const examTypeId = Number(exam.rows[0]!.id);
  createdExamTypeIds.push(examTypeId);
  const policySet = await pool.query<{ id: number }>(
    "insert into appointments_v2.policy_sets(key,name,created_by_user_id) values($1,$2,$3) returning id",
    [`document_ha_policy_${marker}`, `Document HA policy ${marker}`, userId],
  );
  const policySetId = Number(policySet.rows[0]!.id);
  createdPolicySetIds.push(policySetId);
  const policyVersion = await pool.query<{ id: number }>(
    "insert into appointments_v2.policy_versions(policy_set_id,version_no,status,config_hash,change_note,created_by_user_id) values($1,1,'published',$2,'document HA test',$3) returning id",
    [policySetId, `document_ha_${marker}`, userId],
  );
  const policyVersionId = Number(policyVersion.rows[0]!.id);
  createdPolicyVersionIds.push(policyVersionId);
  const booking = await pool.query<{ id: number }>(
    `insert into appointments_v2.bookings(patient_id,modality_id,exam_type_id,reporting_priority_id,booking_date,booking_time,case_category,status,notes,policy_version_id,created_by_user_id,updated_by_user_id)
     values($1,$2,$3,null,current_date,'09:00:00','non_oncology','scheduled','document HA test',$4,$5,$5) returning id`,
    [patientId, modalityId, examTypeId, policyVersionId, userId],
  );
  const bookingId = Number(booking.rows[0]!.id);
  createdBookingIds.push(bookingId);
  return { bookingId, patientId, userId };
}

async function uploadFixture(overrides: Partial<Parameters<typeof uploadDocument>[0]> = {}): Promise<DocumentRow> {
  assert.ok(fixture);
  const content = Buffer.from(`document-ha-${crypto.randomUUID()}`);
  const document = await uploadDocument({
    patientId: fixture.patientId,
    appointmentId: fixture.bookingId,
    appointmentRefType: "v2_booking",
    documentType: "appointment_request",
    originalFilename: `document-${sequence}.pdf`,
    mimeType: "application/pdf",
    source: "manual_upload",
    fileContentBuffer: content,
    ...overrides,
  }, fixture.userId);
  createdDocumentIds.push(document.id);
  return document;
}

before(async () => {
  await fs.mkdir(tempUploadsDir, { recursive: true });
  env.uploadsDir = tempUploadsDir;
  for (const key of settingKeys) {
    const result = await pool.query<{ setting_value: unknown }>("select setting_value from system_settings where category='documents_and_uploads' and setting_key=$1", [key]);
    settingsBefore.set(key, result.rows[0]?.setting_value ?? null);
  }
  await setDocumentSetting("storage_path", "");
  await setDocumentSetting("storage_fallback_enabled", "true");
  await setDocumentSetting("ha_hot_storage_enabled", "true");
  await setDocumentSetting("ha_hot_storage_retention_hours", "48");
  fixture = await createFixture();
});

after(async () => {
  await pool.query("delete from documents where id=any($1::bigint[])", [createdDocumentIds]).catch(() => undefined);
  if (createdBookingIds.length) await pool.query("delete from appointments_v2.bookings where id=any($1::bigint[])", [createdBookingIds]).catch(() => undefined);
  if (createdPatientIds.length) await pool.query("delete from patients where id=any($1::bigint[])", [createdPatientIds]).catch(() => undefined);
  if (createdPolicyVersionIds.length) await pool.query("delete from appointments_v2.policy_versions where id=any($1::bigint[])", [createdPolicyVersionIds]).catch(() => undefined);
  if (createdPolicySetIds.length) await pool.query("delete from appointments_v2.policy_sets where id=any($1::bigint[])", [createdPolicySetIds]).catch(() => undefined);
  if (createdExamTypeIds.length) await pool.query("delete from exam_types where id=any($1::bigint[])", [createdExamTypeIds]).catch(() => undefined);
  if (createdModalityIds.length) await pool.query("delete from modalities where id=any($1::bigint[])", [createdModalityIds]).catch(() => undefined);
  if (createdUserIds.length) await pool.query("delete from users where id=any($1::bigint[])", [createdUserIds]).catch(() => undefined);
  for (const key of settingKeys) {
    const previous = settingsBefore.get(key);
    if (previous == null) await pool.query("delete from system_settings where category='documents_and_uploads' and setting_key=$1", [key]);
    else await pool.query("update system_settings set setting_value=$2::jsonb,updated_at=now() where category='documents_and_uploads' and setting_key=$1", [key, JSON.stringify(previous)]);
  }
  env.uploadsDir = originalUploadsDir;
  await fs.rm(tempUploadsDir, { recursive: true, force: true });
});

test("HA eligibility accepts the eight intended type/source combinations and excludes unrelated documents", () => {
  const expected = [
    ["appointment_request", "manual_upload"],
    ["appointment_request", "naps2_webscan"],
    ["appointment_request", "scanner_app"],
    ["appointment_request", "request_scan_automation"],
    ["clinical_document", "manual_upload"],
    ["clinical_document", "naps2_webscan"],
    ["clinical_document", "scanner_app"],
    ["clinical_document", "modality_scan_automation"],
  ] as const;
  for (const [documentType, source] of expected) {
    assert.equal(isDocumentEligibleForHaHotStorage({ documentType, source, v2BookingId: 10 }), true, `${documentType}/${source}`);
  }
  for (const input of [
    { documentType: "incident_attachment", source: "manual_upload", v2BookingId: 10, incidentId: 4 },
    { documentType: "comparison_request", source: "manual_upload", v2BookingId: null },
    { documentType: "report", source: "manual_upload", v2BookingId: 10 },
    { documentType: "appointment_request", source: "complementary_recall_system", v2BookingId: 10 },
    { documentType: "clinical_document", source: "modality_scan_automation", v2BookingId: null },
    { documentType: "clinical_document", source: "manual_upload", v2BookingId: 10, incidentId: 4 },
  ]) {
    assert.equal(isDocumentEligibleForHaHotStorage(input), false);
  }
  assert.equal(normalizeDocumentHaRetentionHours(12), 24);
  assert.equal(normalizeDocumentHaRetentionHours(48), 48);
  assert.equal(normalizeDocumentHaRetentionHours(999), 168);
});

test("HA retention settings reject values outside the safe bounded range", async () => {
  const currentFixture = fixture;
  assert.ok(currentFixture);
  await assert.rejects(
    () => upsertSettings("documents_and_uploads", [{ key: "ha_hot_storage_retention_hours", value: "23" }], currentFixture.userId),
    (error: unknown) => error instanceof Error && error.message.includes("between 24 and 168"),
  );
  await assert.rejects(
    () => upsertSettings("documents_and_uploads", [{ key: "ha_hot_storage_retention_hours", value: "169" }], currentFixture.userId),
    (error: unknown) => error instanceof Error && error.message.includes("between 24 and 168"),
  );
});

test("eligible upload stores an atomic HA copy, is idempotent, falls back for reads, and releases healthy retention", async () => {
  assert.ok(fixture);
  const document = await uploadFixture();
  const blob = await pool.query<{ content: Buffer; byte_size: number; content_sha256: string }>("select content,byte_size,content_sha256 from document_ha_blobs where document_id=$1", [document.id]);
  assert.equal(blob.rowCount, 1);
  assert.equal(Number(blob.rows[0]!.byte_size), blob.rows[0]!.content.length);
  assert.equal(blob.rows[0]!.content_sha256, sha256Buffer(blob.rows[0]!.content));
  assert.equal(document.content_sha256, blob.rows[0]!.content_sha256);

  const canonicalPath = getDocumentAbsolutePath(document);
  await fs.unlink(canonicalPath);
  assert.deepEqual(await readDocumentContent(document), blob.rows[0]!.content);

  await fs.writeFile(canonicalPath, blob.rows[0]!.content).catch(async () => {
    await fs.mkdir(path.dirname(canonicalPath), { recursive: true });
    await fs.writeFile(canonicalPath, blob.rows[0]!.content);
  });
  await markDue(document.id);
  const healthy = await runDocumentHaStorageReconciliation({ batchSize: 50, workerId: `healthy-${crypto.randomUUID()}` });
  assert.equal(healthy.released, 1);
  assert.equal((await pool.query("select 1 from document_ha_blobs where document_id=$1", [document.id])).rowCount, 0);
  assert.equal((await fs.stat(canonicalPath)).isFile(), true);

  const content = Buffer.from(`idempotent-${crypto.randomUUID()}`);
  const payload = {
    patientId: fixture.patientId,
    appointmentId: fixture.bookingId,
    appointmentRefType: "v2_booking",
    documentType: "appointment_request",
    originalFilename: "idempotent.pdf",
    mimeType: "application/pdf",
    source: "request_scan_automation",
    fileContentBuffer: content,
  } as const;
  const key = `request-scan:job:${Date.now()}:appointment-request`;
  const first = await uploadDocumentIdempotently(payload, fixture.userId, key);
  if (first.created) createdDocumentIds.push(first.document.id);
  const second = await uploadDocumentIdempotently(payload, fixture.userId, key);
  assert.equal(first.created, true);
  assert.equal(second.created, false);
  assert.equal(second.document.id, first.document.id);
  assert.equal((await pool.query("select 1 from document_ha_blobs where document_id=$1", [first.document.id])).rowCount, 1);
});

test("reconciliation repairs through local fallback and retains HA bytes when every destination fails", async () => {
  const repaired = await uploadFixture();
  const repairedPath = getDocumentAbsolutePath(repaired);
  await fs.unlink(repairedPath);
  const blockedPath = path.join(tempUploadsDir, "blocked-storage-file");
  await fs.writeFile(blockedPath, "not a directory");
  await setDocumentSetting("storage_path", blockedPath);
  await setDocumentSetting("storage_fallback_enabled", "true");
  await markDue(repaired.id);
  const repairedSummary = await runDocumentHaStorageReconciliation({ batchSize: 50, workerId: `repair-${crypto.randomUUID()}` });
  assert.equal(repairedSummary.repaired, 1);
  const repairedRow = (await pool.query<{ stored_path: string; storage_location_type: string }>("select stored_path,storage_location_type from documents where id=$1", [repaired.id])).rows[0]!;
  assert.equal(repairedRow.storage_location_type, "local_fallback");
  assert.equal((await fs.stat(getDocumentAbsolutePath({ stored_path: repairedRow.stored_path }))).isFile(), true);
  assert.equal((await pool.query("select 1 from document_ha_blobs where document_id=$1", [repaired.id])).rowCount, 0);

  const retained = await uploadFixture();
  await fs.unlink(getDocumentAbsolutePath(retained));
  await setDocumentSetting("storage_fallback_enabled", "false");
  await markDue(retained.id);
  const failedSummary = await runDocumentHaStorageReconciliation({ batchSize: 50, workerId: `failed-${crypto.randomUUID()}` });
  assert.equal(failedSummary.failed, 1);
  assert.equal((await pool.query("select 1 from document_ha_blobs where document_id=$1", [retained.id])).rowCount, 1);
  assert.ok((await pool.query<{ last_move_error: string | null }>("select last_move_error from documents where id=$1", [retained.id])).rows[0]!.last_move_error);
  await setDocumentSetting("storage_path", "");
  await setDocumentSetting("storage_fallback_enabled", "true");
  await markDue(retained.id);
  const retrySummary = await runDocumentHaStorageReconciliation({ batchSize: 50, workerId: `retry-${crypto.randomUUID()}` });
  assert.equal(retrySummary.repaired, 1);
  assert.equal((await pool.query("select 1 from document_ha_blobs where document_id=$1", [retained.id])).rowCount, 0);
});

test("reconciliation is bounded and claims due blobs without double-processing concurrent workers", async () => {
  const content = Buffer.from("bounded-ha");
  const digest = sha256Buffer(content);
  const pathForRows = path.join(tempUploadsDir, "bounded.pdf");
  await fs.writeFile(pathForRows, content);
  const ids: number[] = [];
  for (let index = 0; index < 51; index += 1) {
    const document = await pool.query<{ id: number }>(
      `insert into documents(document_type,original_filename,stored_path,mime_type,file_size,content_sha256,storage_location_type,source)
       values('appointment_request',$1,$2,'application/pdf',$3,$4,'local_fallback','manual_upload') returning id`,
      [`bounded-${index}.pdf`, pathForRows, content.length, digest],
    );
    const id = Number(document.rows[0]!.id);
    ids.push(id);
    createdDocumentIds.push(id);
    await pool.query(
      `insert into document_ha_blobs(document_id,content,byte_size,content_sha256,created_at,retention_due_at)
       values($1,$2,$3,$4,now()-interval '2 hours',now()-interval '1 minute')`,
      [id, content, content.length, digest],
    );
  }
  const [first, second] = await Promise.all([
    runDocumentHaStorageReconciliation({ batchSize: 50, workerId: `bounded-a-${crypto.randomUUID()}` }),
    runDocumentHaStorageReconciliation({ batchSize: 50, workerId: `bounded-b-${crypto.randomUUID()}` }),
  ]);
  assert.ok(first.checked <= 50);
  assert.ok(second.checked <= 50);
  assert.equal(first.checked + second.checked, 51);
  assert.equal((await pool.query("select count(*)::int as count from document_ha_blobs where document_id=any($1::bigint[])", [ids])).rows[0]!.count, 0);
});
