import test from "node:test";
import assert from "node:assert/strict";
import bcrypt from "bcryptjs";
import { pool } from "../db/pool.js";
import { mergePatients, updatePatient, type PatientPayload } from "./patient-service.js";

interface OrthancSettingRow {
  setting_key: string;
  setting_value: { value?: unknown } | null;
}

function uniqueSuffix(): string {
  return `${Date.now()}_${Math.floor(Math.random() * 100000)}`;
}

function uniqueNationalId(prefixDigit: string): string {
  const digits = `${Date.now()}${Math.floor(Math.random() * 100000).toString().padStart(5, "0")}`;
  return `${prefixDigit}${digits.slice(-11)}`;
}

async function ensureDbOrSkip(t: { skip: (message?: string) => void }): Promise<boolean> {
  try {
    await pool.query("select 1");
    return true;
  } catch {
    t.skip("PostgreSQL is not reachable at configured DATABASE_URL.");
    return false;
  }
}

async function readOrthancSettingsSnapshot(): Promise<OrthancSettingRow[]> {
  const { rows } = await pool.query<OrthancSettingRow>(
    `
      select setting_key, setting_value
      from system_settings
      where category = 'orthanc_mwl_sync'
      order by setting_key asc
    `
  );
  return rows;
}

async function applyOrthancSettingsForTests(): Promise<void> {
  const entries: Array<[string, string]> = [
    ["enabled", "true"],
    ["shadow_mode", "true"],
    ["base_url", "http://127.0.0.1:8042"],
    ["timeout_seconds", "10"],
    ["verify_tls", "false"],
    ["worklist_target", "RISPRO_MWL"],
  ];

  for (const [key, value] of entries) {
    await pool.query(
      `
        insert into system_settings (category, setting_key, setting_value)
        values ('orthanc_mwl_sync', $1, $2::jsonb)
        on conflict (category, setting_key)
        do update set setting_value = excluded.setting_value, updated_at = now()
      `,
      [key, JSON.stringify({ value })]
    );
  }
}

async function restoreOrthancSettingsSnapshot(snapshot: OrthancSettingRow[]): Promise<void> {
  await pool.query(`delete from system_settings where category = 'orthanc_mwl_sync'`);
  for (const row of snapshot) {
    await pool.query(
      `
        insert into system_settings (category, setting_key, setting_value)
        values ('orthanc_mwl_sync', $1, $2::jsonb)
      `,
      [row.setting_key, JSON.stringify(row.setting_value ?? {})]
    );
  }
}

async function waitForOutboxOperation(
  bookingId: number,
  operation: "upsert" | "delete",
  timeoutMs = 5000
): Promise<void> {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    const { rows } = await pool.query<{ cnt: string }>(
      `
        select count(*)::text as cnt
        from external_mwl_outbox
        where booking_id = $1
          and external_system = 'orthanc'
          and operation = $2
      `,
      [bookingId, operation]
    );
    if (Number(rows[0]?.cnt || 0) > 0) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`Timed out waiting for outbox operation ${operation} for booking ${bookingId}.`);
}

async function createCoreFixture() {
  const suffix = uniqueSuffix();
  const passwordHash = bcrypt.hashSync("test-pass", 10);

  const userRes = await pool.query<{ id: number }>(
    `
      insert into users (username, full_name, password_hash, role, is_active)
      values ($1, $2, $3, 'supervisor', true)
      returning id
    `,
    [`orthanc_sync_${suffix}`, `Orthanc Sync ${suffix}`, passwordHash]
  );
  const userId = Number(userRes.rows[0]?.id);

  const modalityRes = await pool.query<{ id: number }>(
    `
      insert into modalities (code, name_ar, name_en, daily_capacity, is_active)
      values ($1, $2, $3, 20, true)
      returning id
    `,
    [`ORTH${suffix.slice(-6)}`, `موداليتي ${suffix}`, `Modality ${suffix}`]
  );
  const modalityId = Number(modalityRes.rows[0]?.id);

  const policySetRes = await pool.query<{ id: number }>(
    `
      insert into appointments_v2.policy_sets (key, name, created_by_user_id)
      values ($1, $2, $3)
      returning id
    `,
    [`orthanc_policy_${suffix}`, `Orthanc Policy ${suffix}`, userId]
  );
  const policySetId = Number(policySetRes.rows[0]?.id);

  const policyVersionRes = await pool.query<{ id: number }>(
    `
      insert into appointments_v2.policy_versions (
        policy_set_id, version_no, status, config_hash, change_note, created_by_user_id
      )
      values ($1, 1, 'published', $2, 'orthanc sync test', $3)
      returning id
    `,
    [policySetId, `hash_${suffix}`, userId]
  );
  const policyVersionId = Number(policyVersionRes.rows[0]?.id);

  return { suffix, userId, modalityId, policySetId, policyVersionId };
}

test("updatePatient enqueues Orthanc upsert for active V2 booking", async (t) => {
  if (!(await ensureDbOrSkip(t))) return;

  const orthancSnapshot = await readOrthancSettingsSnapshot();
  const { suffix, userId, modalityId, policySetId, policyVersionId } = await createCoreFixture();
  let patientId = 0;
  let bookingId = 0;

  try {
    await applyOrthancSettingsForTests();

    const nationalId = uniqueNationalId("3");
    const patientRes = await pool.query<{ id: number }>(
      `
        insert into patients (
          national_id, identifier_type, identifier_value, arabic_full_name, english_full_name,
          normalized_arabic_name, age_years, estimated_date_of_birth, sex, phone_1, address,
          created_by_user_id, updated_by_user_id
        )
        values ($1, 'national_id', $1, $2, $3, $4, 35, '1991-01-01', 'M', '0912345678', 'City', $5, $5)
        returning id
      `,
      [nationalId, `مريض ${suffix}`, `Patient ${suffix}`, `مريض${suffix}`, userId]
    );
    patientId = Number(patientRes.rows[0]?.id);

    const bookingRes = await pool.query<{ id: number }>(
      `
        insert into appointments_v2.bookings (
          patient_id, modality_id, exam_type_id, reporting_priority_id, booking_date, booking_time,
          case_category, status, notes, policy_version_id, created_by_user_id, updated_by_user_id
        )
        values ($1, $2, null, null, current_date, '09:00:00', 'non_oncology', 'scheduled', 'sync test', $3, $4, $4)
        returning id
      `,
      [patientId, modalityId, policyVersionId, userId]
    );
    bookingId = Number(bookingRes.rows[0]?.id);

    await pool.query(`delete from external_mwl_outbox where booking_id = $1 and external_system = 'orthanc'`, [bookingId]);
    await pool.query(`delete from external_mwl_sync where booking_id = $1 and external_system = 'orthanc'`, [bookingId]);

    const payload: PatientPayload = {
      nationalId,
      nationalIdConfirmation: nationalId,
      identifierType: "national_id",
      identifierValue: nationalId,
      arabicFullName: `مريض محدث ${suffix}`,
      englishFullName: `Updated ${suffix}`,
      ageYears: 36,
      demographicsEstimated: false,
      sex: "M",
      phone1: "0912345678",
      address: "Updated City",
      identifiers: [{ typeCode: "national_id", value: nationalId, isPrimary: true }],
    };

    await updatePatient(patientId, payload, userId);
    await waitForOutboxOperation(bookingId, "upsert");

    const outboxRes = await pool.query<{ operation: string }>(
      `
        select operation
        from external_mwl_outbox
        where booking_id = $1
          and external_system = 'orthanc'
        order by id desc
        limit 1
      `,
      [bookingId]
    );
    assert.equal(outboxRes.rows[0]?.operation, "upsert");
  } finally {
    await restoreOrthancSettingsSnapshot(orthancSnapshot);
    if (bookingId > 0) {
      await pool.query(`delete from external_mwl_outbox where booking_id = $1`, [bookingId]);
      await pool.query(`delete from external_mwl_sync where booking_id = $1`, [bookingId]);
      await pool.query(`delete from appointments_v2.bookings where id = $1`, [bookingId]);
    }
    if (patientId > 0) {
      await pool.query(`delete from patient_identifiers where patient_id = $1`, [patientId]);
      await pool.query(`delete from patients where id = $1`, [patientId]);
    }
    await pool.query(`delete from appointments_v2.policy_versions where id = $1`, [policyVersionId]);
    await pool.query(`delete from appointments_v2.policy_sets where id = $1`, [policySetId]);
    await pool.query(`delete from modalities where id = $1`, [modalityId]);
    await pool.query(`delete from audit_log where changed_by_user_id = $1`, [userId]);
    await pool.query(`delete from users where id = $1`, [userId]);
  }
});

test("mergePatients enqueues Orthanc upsert for active source bookings only", async (t) => {
  if (!(await ensureDbOrSkip(t))) return;

  const orthancSnapshot = await readOrthancSettingsSnapshot();
  const { suffix, userId, modalityId, policySetId, policyVersionId } = await createCoreFixture();
  let sourcePatientId = 0;
  let targetPatientId = 0;
  let sourceActiveBookingId = 0;
  let targetCancelledBookingId = 0;

  try {
    await applyOrthancSettingsForTests();

    const sourceNationalId = uniqueNationalId("4");
    const targetNationalId = uniqueNationalId("5");

    const sourceRes = await pool.query<{ id: number }>(
      `
        insert into patients (
          national_id, identifier_type, identifier_value, arabic_full_name, english_full_name,
          normalized_arabic_name, age_years, estimated_date_of_birth, sex, phone_1, address,
          created_by_user_id, updated_by_user_id
        )
        values ($1, 'national_id', $1, $2, $3, $4, 40, '1986-01-01', 'F', '0923456789', 'City', $5, $5)
        returning id
      `,
      [sourceNationalId, `مصدر ${suffix}`, `Source ${suffix}`, `مصدر${suffix}`, userId]
    );
    sourcePatientId = Number(sourceRes.rows[0]?.id);

    const targetRes = await pool.query<{ id: number }>(
      `
        insert into patients (
          national_id, identifier_type, identifier_value, arabic_full_name, english_full_name,
          normalized_arabic_name, age_years, estimated_date_of_birth, sex, phone_1, address,
          created_by_user_id, updated_by_user_id
        )
        values ($1, 'national_id', $1, $2, $3, $4, 41, '1985-01-01', 'M', '0934567890', 'City', $5, $5)
        returning id
      `,
      [targetNationalId, `هدف ${suffix}`, `Target ${suffix}`, `هدف${suffix}`, userId]
    );
    targetPatientId = Number(targetRes.rows[0]?.id);

    const sourceBookingRes = await pool.query<{ id: number }>(
      `
        insert into appointments_v2.bookings (
          patient_id, modality_id, exam_type_id, reporting_priority_id, booking_date, booking_time,
          case_category, status, notes, policy_version_id, created_by_user_id, updated_by_user_id
        )
        values ($1, $2, null, null, current_date, '10:30:00', 'non_oncology', 'arrived', 'merge-source-active', $3, $4, $4)
        returning id
      `,
      [sourcePatientId, modalityId, policyVersionId, userId]
    );
    sourceActiveBookingId = Number(sourceBookingRes.rows[0]?.id);

    const targetBookingRes = await pool.query<{ id: number }>(
      `
        insert into appointments_v2.bookings (
          patient_id, modality_id, exam_type_id, reporting_priority_id, booking_date, booking_time,
          case_category, status, notes, policy_version_id, created_by_user_id, updated_by_user_id
        )
        values ($1, $2, null, null, current_date, '11:00:00', 'non_oncology', 'cancelled', 'merge-target-cancelled', $3, $4, $4)
        returning id
      `,
      [targetPatientId, modalityId, policyVersionId, userId]
    );
    targetCancelledBookingId = Number(targetBookingRes.rows[0]?.id);

    await pool.query(
      `delete from external_mwl_outbox where booking_id = any($1::bigint[]) and external_system = 'orthanc'`,
      [[sourceActiveBookingId, targetCancelledBookingId]]
    );
    await pool.query(
      `delete from external_mwl_sync where booking_id = any($1::bigint[]) and external_system = 'orthanc'`,
      [[sourceActiveBookingId, targetCancelledBookingId]]
    );

    await mergePatients(
      {
        targetPatientId,
        sourcePatientId,
        confirmationText: "MERGE",
      },
      userId
    );

    await waitForOutboxOperation(sourceActiveBookingId, "upsert");

    const mergedBookingRes = await pool.query<{ patient_id: number }>(
      `select patient_id from appointments_v2.bookings where id = $1`,
      [sourceActiveBookingId]
    );
    assert.equal(Number(mergedBookingRes.rows[0]?.patient_id), targetPatientId);

    const cancelledOutboxRes = await pool.query<{ cnt: string }>(
      `
        select count(*)::text as cnt
        from external_mwl_outbox
        where booking_id = $1
          and external_system = 'orthanc'
      `,
      [targetCancelledBookingId]
    );
    assert.equal(Number(cancelledOutboxRes.rows[0]?.cnt || 0), 0, "Cancelled target booking should not be enqueued.");
  } finally {
    await restoreOrthancSettingsSnapshot(orthancSnapshot);
    const bookingIds = [sourceActiveBookingId, targetCancelledBookingId].filter((id) => id > 0);
    if (bookingIds.length > 0) {
      await pool.query(`delete from external_mwl_outbox where booking_id = any($1::bigint[])`, [bookingIds]);
      await pool.query(`delete from external_mwl_sync where booking_id = any($1::bigint[])`, [bookingIds]);
    }
    if (sourceActiveBookingId > 0) {
      await pool.query(`delete from appointments_v2.bookings where id = $1`, [sourceActiveBookingId]);
    }
    if (targetCancelledBookingId > 0) {
      await pool.query(`delete from appointments_v2.bookings where id = $1`, [targetCancelledBookingId]);
    }
    if (targetPatientId > 0) {
      await pool.query(`delete from patient_identifiers where patient_id = $1`, [targetPatientId]);
      await pool.query(`delete from patients where id = $1`, [targetPatientId]);
    }
    if (sourcePatientId > 0) {
      await pool.query(`delete from patient_identifiers where patient_id = $1`, [sourcePatientId]);
      await pool.query(`delete from patients where id = $1`, [sourcePatientId]);
    }
    await pool.query(`delete from appointments_v2.policy_versions where id = $1`, [policyVersionId]);
    await pool.query(`delete from appointments_v2.policy_sets where id = $1`, [policySetId]);
    await pool.query(`delete from modalities where id = $1`, [modalityId]);
    await pool.query(`delete from audit_log where changed_by_user_id = $1`, [userId]);
    await pool.query(`delete from users where id = $1`, [userId]);
  }
});
