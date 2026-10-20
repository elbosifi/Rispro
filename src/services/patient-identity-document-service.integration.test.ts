import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test, { type TestContext } from "node:test";
import { env } from "../config/env.js";
import { pool } from "../db/pool.js";
import { HttpError } from "../utils/http-error.js";
import { mergePatients, updatePatient } from "./patient-service.js";
import { applyNameDictionaryToPatients } from "./name-dictionary-service.js";
import {
  getPatientIdentityDocumentState,
  getVerifiedPatientIds,
  revokePatientIdentityDocumentVerification,
  verifyPatientIdentityDocument,
} from "./patient-identity-document-service.js";
import { getDocumentAbsolutePath, uploadDocument } from "./document-service.js";

const originalUploadsDir = env.uploadsDir;
const tempUploadsDir = path.join(os.tmpdir(), `rispro-patient-identity-${crypto.randomUUID()}`);
const createdPatientIds: number[] = [];
const createdDocumentIds: number[] = [];
const createdDictionaryIds: number[] = [];
const createdUserIds: number[] = [];
let databaseAvailable = false;
let previousHaSetting: unknown | null = null;

async function skipWithoutDatabase(t: TestContext): Promise<boolean> {
  if (databaseAvailable) return false;
  t.skip("PostgreSQL is not reachable at the configured disposable test database.");
  return true;
}

async function createUser(role: "receptionist" | "supervisor" | "super_admin" | "doctor" = "supervisor"): Promise<number> {
  const marker = crypto.randomUUID();
  const result = await pool.query<{ id: number }>(
    "insert into users(username,full_name,password_hash,role,is_active) values($1,$2,'test',$3,true) returning id",
    [`patient_identity_${marker}`, `Patient Identity ${marker}`, role],
  );
  const id = Number(result.rows[0]!.id);
  createdUserIds.push(id);
  return id;
}

async function createFixturePatient(userId: number, suffix = crypto.randomUUID().slice(0, 8)): Promise<{ id: number; nationalId: string; arabicFullName: string; englishFullName: string }> {
  const nationalId = `9${suffix.replace(/\D/g, "").padEnd(11, "0").slice(0, 11)}`;
  const arabicFullName = `مريض ${suffix}`;
  const englishFullName = `Patient ${suffix}`;
  const result = await pool.query<{ id: number }>(
    `
      insert into patients(
        mrn,national_id,identifier_type,identifier_value,arabic_full_name,english_full_name,
        normalized_arabic_name,normalized_arabic_name_compact,age_years,estimated_date_of_birth,
        sex,phone_1,address,created_by_user_id,updated_by_user_id
      ) values($1,$2,'national_id',$3,$4,$5,$6,$6,35,'1991-01-01','M','0912345678','benghazi',$7,$7)
      returning id
    `,
    [`PID-${suffix}`, nationalId, nationalId, arabicFullName, englishFullName, arabicFullName, userId],
  );
  const id = Number(result.rows[0]!.id);
  createdPatientIds.push(id);
  return { id, nationalId, arabicFullName, englishFullName };
}

async function uploadIdentity(patientId: number, userId: number, filename = `identity-${crypto.randomUUID()}.pdf`) {
  const document = await uploadDocument({
    patientId,
    documentType: "patient_identity_document",
    originalFilename: filename,
    mimeType: "application/pdf",
    source: "manual_upload",
    fileContentBase64: Buffer.from(`identity-${crypto.randomUUID()}`).toString("base64"),
  }, userId);
  createdDocumentIds.push(document.id);
  return document;
}

function patientUpdatePayload(patient: { arabicFullName?: string; englishFullName?: string; nationalId: string; phone1?: string; address?: string }) {
  return {
    nationalId: patient.nationalId,
    nationalIdConfirmation: patient.nationalId,
    identifierType: "national_id",
    identifierValue: patient.nationalId,
    arabicFullName: patient.arabicFullName || "مريض هوية",
    englishFullName: patient.englishFullName || "Identity Patient",
    ageYears: 35,
    estimatedDateOfBirth: "1991-01-01",
    sex: "M",
    phone1: patient.phone1 || "0912345678",
    phone2: "",
    address: patient.address || "benghazi",
    demographicsEstimated: false,
  };
}

test.before(async () => {
  try {
    await pool.query("select 1");
    databaseAvailable = true;
    await fs.mkdir(tempUploadsDir, { recursive: true });
    env.uploadsDir = tempUploadsDir;
    previousHaSetting = (await pool.query<{ setting_value: unknown }>(
      "select setting_value from system_settings where category='documents_and_uploads' and setting_key='ha_hot_storage_enabled'",
    )).rows[0]?.setting_value ?? null;
    await pool.query(
      `insert into system_settings(category,setting_key,setting_value)
       values('documents_and_uploads','ha_hot_storage_enabled','{"value":"false"}'::jsonb)
       on conflict(category,setting_key) do update set setting_value=excluded.setting_value,updated_at=now()`,
    );
  } catch {
    databaseAvailable = false;
  }
});

test.after(async () => {
  if (databaseAvailable) {
    await pool.query("delete from documents where id=any($1::bigint[])", [createdDocumentIds]).catch(() => undefined);
    await pool.query("delete from name_dictionary where id=any($1::bigint[])", [createdDictionaryIds]).catch(() => undefined);
    await pool.query("delete from audit_log where changed_by_user_id=any($1::bigint[])", [createdUserIds]).catch(() => undefined);
    await pool.query("delete from patients where id=any($1::bigint[])", [createdPatientIds]).catch(() => undefined);
    await pool.query("delete from users where id=any($1::bigint[])", [createdUserIds]).catch(() => undefined);
    if (previousHaSetting == null) {
      await pool.query("delete from system_settings where category='documents_and_uploads' and setting_key='ha_hot_storage_enabled'").catch(() => undefined);
    } else {
      await pool.query(
        "update system_settings set setting_value=$1::jsonb,updated_at=now() where category='documents_and_uploads' and setting_key='ha_hot_storage_enabled'",
        [JSON.stringify(previousHaSetting)],
      ).catch(() => undefined);
    }
  }
  env.uploadsDir = originalUploadsDir;
  await fs.rm(tempUploadsDir, { recursive: true, force: true });
});

test("patient identity documents upload as pending patient-only documents", async (t) => {
  if (await skipWithoutDatabase(t)) return;
  const userId = await createUser("receptionist");
  const patient = await createFixturePatient(userId);
  const document = await uploadIdentity(patient.id, userId);
  const row = (await pool.query<{ patient_id: number; appointment_id: number | null; v2_booking_id: number | null; incident_id: number | null }>(
    "select patient_id,appointment_id,v2_booking_id,incident_id from documents where id=$1",
    [document.id],
  )).rows[0]!;
  assert.equal(Number(row.patient_id), patient.id);
  assert.equal(row.appointment_id, null);
  assert.equal(row.v2_booking_id, null);
  assert.equal(row.incident_id, null);
  assert.equal((await getPatientIdentityDocumentState(patient.id)).status, "pending");
});

test("identity verification requires the matching latest document", async (t) => {
  if (await skipWithoutDatabase(t)) return;
  const userId = await createUser();
  const firstPatient = await createFixturePatient(userId);
  const otherPatient = await createFixturePatient(userId);
  const document = await uploadIdentity(firstPatient.id, userId);
  const otherDocument = await uploadIdentity(otherPatient.id, userId);
  const verified = await verifyPatientIdentityDocument(firstPatient.id, document.id, userId);
  assert.equal(verified.status, "verified");
  await assert.rejects(
    () => verifyPatientIdentityDocument(firstPatient.id, otherDocument.id, userId),
    (error: unknown) => error instanceof HttpError && error.statusCode === 409,
  );
});

test("verification rejects an older document after replacement", async (t) => {
  if (await skipWithoutDatabase(t)) return;
  const userId = await createUser();
  const patient = await createFixturePatient(userId);
  const older = await uploadIdentity(patient.id, userId, "older.pdf");
  const newer = await uploadIdentity(patient.id, userId, "newer.pdf");
  await assert.rejects(
    () => verifyPatientIdentityDocument(patient.id, older.id, userId),
    (error: unknown) => error instanceof HttpError && error.statusCode === 409,
  );
  assert.equal((await verifyPatientIdentityDocument(patient.id, newer.id, userId)).status, "verified");
});

test("verification rejects an unavailable file", async (t) => {
  if (await skipWithoutDatabase(t)) return;
  const userId = await createUser();
  const patient = await createFixturePatient(userId);
  const document = await uploadIdentity(patient.id, userId);
  await fs.unlink(getDocumentAbsolutePath(document));
  await assert.rejects(
    () => verifyPatientIdentityDocument(patient.id, document.id, userId),
    (error: unknown) => error instanceof HttpError && error.statusCode === 422,
  );
});

test("replacement resets verification while retaining document history", async (t) => {
  if (await skipWithoutDatabase(t)) return;
  const userId = await createUser();
  const patient = await createFixturePatient(userId);
  const original = await uploadIdentity(patient.id, userId);
  await verifyPatientIdentityDocument(patient.id, original.id, userId);
  const replacement = await uploadIdentity(patient.id, userId);
  const state = await getPatientIdentityDocumentState(patient.id);
  assert.equal(state.status, "pending");
  assert.equal(state.document?.id, Number(replacement.id));
  assert.equal((await pool.query("select 1 from documents where id=$1", [original.id])).rowCount, 1);
});

test("name dictionary changes revoke verified identity without deleting document", async (t) => {
  if (await skipWithoutDatabase(t)) return;
  const userId = await createUser();
  const patient = await createFixturePatient(userId);
  const document = await uploadIdentity(patient.id, userId);
  await verifyPatientIdentityDocument(patient.id, document.id, userId);

  const dictionaryEntry = await pool.query<{ id: number }>(
    `
      insert into name_dictionary (arabic_text, english_text, is_active)
      values ($1, $2, true)
      returning id
    `,
    [patient.arabicFullName, `Dictionary Changed ${crypto.randomUUID().slice(0, 8)}`],
  );
  createdDictionaryIds.push(Number(dictionaryEntry.rows[0]!.id));

  await applyNameDictionaryToPatients(userId);

  const updatedPatient = await pool.query<{ english_full_name: string }>(
    "select english_full_name from patients where id=$1",
    [patient.id],
  );
  assert.notEqual(updatedPatient.rows[0]?.english_full_name, patient.englishFullName);
  assert.equal((await getPatientIdentityDocumentState(patient.id)).status, "pending");
  assert.equal((await pool.query("select 1 from documents where id=$1", [document.id])).rowCount, 1);

  const auditQuery = `
    select id
    from audit_log
    where entity_type = 'patient_identity_document'
      and entity_id = $1
      and action_type = 'identity_verification_revoked_after_name_dictionary_update'
      and changed_by_user_id = $2
  `;
  const firstAudit = await pool.query(auditQuery, [document.id, userId]);
  assert.equal(firstAudit.rowCount, 1);

  await applyNameDictionaryToPatients(userId);
  const secondAudit = await pool.query(auditQuery, [document.id, userId]);
  assert.equal(secondAudit.rowCount, 1);
});

test("revocation clears verification without deleting the file", async (t) => {
  if (await skipWithoutDatabase(t)) return;
  const userId = await createUser();
  const patient = await createFixturePatient(userId);
  const document = await uploadIdentity(patient.id, userId);
  await verifyPatientIdentityDocument(patient.id, document.id, userId);
  const revoked = await revokePatientIdentityDocumentVerification(patient.id, userId);
  assert.equal(revoked.status, "pending");
  assert.equal((await pool.query("select 1 from documents where id=$1", [document.id])).rowCount, 1);
});

test("critical patient identity changes revoke verification", async (t) => {
  if (await skipWithoutDatabase(t)) return;
  const userId = await createUser();
  const patient = await createFixturePatient(userId);
  const document = await uploadIdentity(patient.id, userId);
  await verifyPatientIdentityDocument(patient.id, document.id, userId);
  await updatePatient(patient.id, patientUpdatePayload({ nationalId: patient.nationalId, arabicFullName: "مريض هوية جديد" }), userId);
  assert.equal((await getPatientIdentityDocumentState(patient.id)).status, "pending");
});

test("phone and address changes do not revoke verification", async (t) => {
  if (await skipWithoutDatabase(t)) return;
  const userId = await createUser();
  const patient = await createFixturePatient(userId);
  const document = await uploadIdentity(patient.id, userId);
  await verifyPatientIdentityDocument(patient.id, document.id, userId);
  await updatePatient(patient.id, patientUpdatePayload({
    nationalId: patient.nationalId,
    arabicFullName: patient.arabicFullName,
    englishFullName: patient.englishFullName,
    phone1: "0922222222",
    address: "tripoli",
  }), userId);
  assert.equal((await getPatientIdentityDocumentState(patient.id)).status, "verified");
});

test("patient merge moves documents and resets verification for both records", async (t) => {
  if (await skipWithoutDatabase(t)) return;
  const userId = await createUser();
  const target = await createFixturePatient(userId);
  const source = await createFixturePatient(userId);
  const targetDocument = await uploadIdentity(target.id, userId);
  const sourceDocument = await uploadIdentity(source.id, userId);
  await verifyPatientIdentityDocument(target.id, targetDocument.id, userId);
  await verifyPatientIdentityDocument(source.id, sourceDocument.id, userId);
  await mergePatients({ targetPatientId: target.id, sourcePatientId: source.id, confirmationText: "MERGE" }, userId);
  const merged = await pool.query<{ count: number; verified: number }>(
    `select count(*)::int as count, count(*) filter(where identity_verified_at is not null)::int as verified
     from documents where patient_id=$1 and document_type='patient_identity_document'`,
    [target.id],
  );
  assert.equal(Number(merged.rows[0]?.count), 2);
  assert.equal(Number(merged.rows[0]?.verified), 0);
});

test("bulk lookup returns verified patient ids without per-patient queries", async (t) => {
  if (await skipWithoutDatabase(t)) return;
  const userId = await createUser();
  const first = await createFixturePatient(userId);
  const second = await createFixturePatient(userId);
  const document = await uploadIdentity(first.id, userId);
  await verifyPatientIdentityDocument(first.id, document.id, userId);
  assert.deepEqual(await getVerifiedPatientIds([first.id, second.id]), new Set([first.id]));
  assert.deepEqual(await getVerifiedPatientIds([]), new Set());
});
