import test from "node:test";
import assert from "node:assert/strict";
import bcrypt from "bcryptjs";
import { pool } from "../db/pool.js";
import {
  searchPatients,
  createPatient,
  updatePatient,
  deletePatient,
  mergePatients,
  getPatientById,
  type PatientPayload,
  type MergePatientsPayload
} from "./patient-service.js";
import type { OptionalUserId } from "../types/http.js";

interface FixtureContext {
  receptionistUserId: number;
  patientAId: number;
  patientBId: number;
  identifierTypeId: number;
  cleanup: () => Promise<void>;
}

function uniqueSuffix(): string {
  return `${Date.now()}_${Math.floor(Math.random() * 100000)}`;
}

async function createFixture(): Promise<FixtureContext> {
  const suffix = uniqueSuffix();
  const receptionistHash = bcrypt.hashSync("test-pass", 10);

  const receptionist = await pool.query<{ id: number }>(
    `
      insert into users (username, full_name, password_hash, role, is_active)
      values ($1, $2, $3, 'receptionist', true)
      returning id
    `,
    [`test_rcpt_${suffix}`, `Receptionist ${suffix}`, receptionistHash]
  );
  const receptionistUserId = Number(receptionist.rows[0]?.id);

  // Create an extra identifier type (active)
  const idType = await pool.query<{ id: number }>(
    `
      insert into patient_identifier_types (code, label, is_active)
      values ($1, $2, true)
      returning id
    `,
    [`test_${suffix}`, `Test ID ${suffix}`]
  );
  const identifierTypeId = Number(idType.rows[0]?.id);

  const mkPatient = async (seed: string, identifiers?: { typeCode: string; value: string; isPrimary: boolean }[]) => {
    const result = await pool.query<{ id: number }>(
      `
        insert into patients (
          national_id, identifier_type, identifier_value,
          arabic_full_name, english_full_name, normalized_arabic_name,
          age_years, estimated_date_of_birth, sex, phone_1, address,
          created_by_user_id, updated_by_user_id
        )
        values ($1, 'national_id', $1, $2, $3, $4, 30, '1996-01-01', 'M', $5, 'city', $6, $6)
        returning id
      `,
      [seed, `مريض ${seed}`, `Patient ${seed}`, `مريض${seed}`, `09${seed.slice(-8)}`, receptionistUserId]
    );
    const pid = Number(result.rows[0]?.id);
    if (identifiers && identifiers.length > 0) {
      for (const id of identifiers) {
        await pool.query(
          `
            insert into patient_identifiers (patient_id, identifier_type_id, value, normalized_value, is_primary, created_by_user_id, updated_by_user_id)
            values ($1, $2, $3, $4, $5, $6, $6)
          `,
          [pid, identifierTypeId, id.value, id.value.toLowerCase(), id.isPrimary, receptionistUserId]
        );
      }
    }
    return pid;
  };

  // Patient A: national_id + secondary identifiers
  const patientAId = await mkPatient(`1${suffix.padStart(11, "0").slice(-11)}`, [
    { typeCode: `test_${suffix}`, value: `SECONDARY-${suffix}`, isPrimary: false },
    { typeCode: `test_${suffix}`, value: `PASSPORT-${suffix}`, isPrimary: false }
  ]);

  // Patient B: no secondary identifiers
  const patientBId = await mkPatient(`2${suffix.padStart(11, "0").slice(-11)}`);

  const cleanup = async () => {
    await pool.query(`delete from patient_identifiers where patient_id = any($1::bigint[])`, [[patientAId, patientBId]]);
    await pool.query(`delete from patients where id = any($1::bigint[])`, [[patientAId, patientBId]]);
    await pool.query(`delete from patient_identifier_types where id = $1`, [identifierTypeId]);
    await pool.query(`delete from users where id = $1`, [receptionistUserId]);
  };

  return { receptionistUserId, patientAId, patientBId, identifierTypeId, cleanup };
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

// ---------------------------------------------------------------------------
// Test: search finds patients by secondary identifier
// ---------------------------------------------------------------------------
test("searchPatients: finds patient by secondary identifier value", async (t) => {
  if (!(await ensureDbOrSkip(t))) return;
  const fx = await createFixture();
  try {
    // Search by the SECONDARY value — should find patient A
    const results = await searchPatients("SECONDARY");
    assert.ok(results.length > 0, "Should find at least one patient");
    const found = results.find((r) => Number(r.id) === fx.patientAId);
    assert.ok(found, "Should find patient A by secondary identifier");
  } finally {
    await fx.cleanup();
  }
});

// ---------------------------------------------------------------------------
// Test: search finds normalized identifier variants
// ---------------------------------------------------------------------------
test("searchPatients: finds patient by normalized identifier variant", async (t) => {
  if (!(await ensureDbOrSkip(t))) return;
  const fx = await createFixture();
  try {
    // The stored normalized_value is lowercase; searching with uppercase should still match
    const results = await searchPatients("PASSPORT");
    assert.ok(results.length > 0, "Should find at least one patient");
    const found = results.find((r) => Number(r.id) === fx.patientAId);
    assert.ok(found, "Should find patient A by normalized identifier variant");
  } finally {
    await fx.cleanup();
  }
});

// ---------------------------------------------------------------------------
// Test: deleting a patient with multiple identifiers succeeds cleanly
// ---------------------------------------------------------------------------
test("deletePatient: cleans up multiple identifiers", async (t) => {
  if (!(await ensureDbOrSkip(t))) return;
  const fx = await createFixture();
  try {
    // Verify patient A has identifiers
    const beforeIdentifiers = await pool.query(
      `select count(*)::int as cnt from patient_identifiers where patient_id = $1`,
      [fx.patientAId]
    );
    assert.ok(Number(beforeIdentifiers.rows[0]?.cnt) >= 2, "Patient A should have at least 2 identifiers");

    await deletePatient(fx.patientAId, fx.receptionistUserId);

    const afterIdentifiers = await pool.query(
      `select count(*)::int as cnt from patient_identifiers where patient_id = $1`,
      [fx.patientAId]
    );
    assert.equal(Number(afterIdentifiers.rows[0]?.cnt), 0, "All identifiers should be deleted");

    const afterPatient = await pool.query(
      `select count(*)::int as cnt from patients where id = $1`,
      [fx.patientAId]
    );
    assert.equal(Number(afterPatient.rows[0]?.cnt), 0, "Patient should be deleted");
  } finally {
    await fx.cleanup();
  }
});

// ---------------------------------------------------------------------------
// Test: merge preserves identifiers
// ---------------------------------------------------------------------------
test("mergePatients: preserves source identifiers on target", async (t) => {
  if (!(await ensureDbOrSkip(t))) return;
  const fx = await createFixture();
  try {
    // Verify patient A has secondary identifiers
    const srcIdentifiers = await pool.query<{ value: string }>(
      `select value from patient_identifiers where patient_id = $1`,
      [fx.patientAId]
    );
    assert.ok(srcIdentifiers.rows.length >= 2, "Source should have at least 2 identifiers");

    const targetIdentifiersBefore = await pool.query(
      `select count(*)::int as cnt from patient_identifiers where patient_id = $1`,
      [fx.patientBId]
    );

    await mergePatients(
      { targetPatientId: fx.patientBId, sourcePatientId: fx.patientAId, confirmationText: "MERGE" },
      fx.receptionistUserId
    );

    // Source patient should be gone
    const srcExists = await pool.query(
      `select count(*)::int as cnt from patients where id = $1`,
      [fx.patientAId]
    );
    assert.equal(Number(srcExists.rows[0]?.cnt), 0, "Source patient should be deleted");

    // Target should now have more identifiers
    const targetIdentifiersAfter = await pool.query(
      `select count(*)::int as cnt from patient_identifiers where patient_id = $1`,
      [fx.patientBId]
    );
    const cntAfter = Number(targetIdentifiersAfter.rows[0]?.cnt);
    const cntBefore = Number(targetIdentifiersBefore.rows[0]?.cnt);
    assert.ok(cntAfter > cntBefore, "Target should have more identifiers after merge");

    // Verify secondary values are present on target
    const values = await pool.query<{ value: string }>(
      `select value from patient_identifiers where patient_id = $1`,
      [fx.patientBId]
    );
    const valueSet = new Set(values.rows.map((r) => r.value));
    for (const row of srcIdentifiers.rows) {
      assert.ok(valueSet.has(row.value), `Target should have identifier value: ${row.value}`);
    }
  } finally {
    await fx.cleanup();
  }
});

// ---------------------------------------------------------------------------
// Test: merge does not create duplicate identifier rows
// ---------------------------------------------------------------------------
test("mergePatients: does not create duplicate identifier rows", async (t) => {
  if (!(await ensureDbOrSkip(t))) return;
  const fx = await createFixture();
  try {
    // Give patient B the same secondary identifier as patient A
    await pool.query(
      `
        insert into patient_identifiers (patient_id, identifier_type_id, value, normalized_value, is_primary, created_by_user_id, updated_by_user_id)
        select $1, identifier_type_id, value, normalized_value, false, created_by_user_id, updated_by_user_id
        from patient_identifiers where patient_id = $2 limit 1
      `,
      [fx.patientBId, fx.patientAId]
    );

    await mergePatients(
      { targetPatientId: fx.patientBId, sourcePatientId: fx.patientAId, confirmationText: "MERGE" },
      fx.receptionistUserId
    );

    // Check no duplicates on target
    const dupes = await pool.query<{ cnt: number }>(
      `
        select count(*)::int - count(distinct (identifier_type_id, value))::int as cnt
        from patient_identifiers
        where patient_id = $1
      `,
      [fx.patientBId]
    );
    assert.equal(Number(dupes.rows[0]?.cnt), 0, "Should have no duplicate identifier rows on target");
  } finally {
    await fx.cleanup();
  }
});

// ---------------------------------------------------------------------------
// Test: merged target ends with exactly one primary identifier
// ---------------------------------------------------------------------------
test("mergePatients: target has exactly one primary identifier", async (t) => {
  if (!(await ensureDbOrSkip(t))) return;
  const fx = await createFixture();
  try {
    await mergePatients(
      { targetPatientId: fx.patientBId, sourcePatientId: fx.patientAId, confirmationText: "MERGE" },
      fx.receptionistUserId
    );

    const primaryCount = await pool.query<{ cnt: number }>(
      `select count(*)::int as cnt from patient_identifiers where patient_id = $1 and is_primary = true`,
      [fx.patientBId]
    );
    assert.equal(Number(primaryCount.rows[0]?.cnt), 1, "Target should have exactly one primary identifier");
  } finally {
    await fx.cleanup();
  }
});

// ---------------------------------------------------------------------------
// Test: editing a patient with an inactive identifier type still works
// ---------------------------------------------------------------------------
test("updatePatient: works with inactive identifier type", async (t) => {
  if (!(await ensureDbOrSkip(t))) return;
  const suffix = uniqueSuffix();
  const receptionistHash = bcrypt.hashSync("test-pass", 10);

  const receptionist = await pool.query<{ id: number }>(
    `
      insert into users (username, full_name, password_hash, role, is_active)
      values ($1, $2, $3, 'receptionist', true)
      returning id
    `,
    [`test_rcpt2_${suffix}`, `Receptionist ${suffix}`, receptionistHash]
  );
  const receptionistUserId = Number(receptionist.rows[0]?.id);

  // Create an INACTIVE identifier type
  const inactiveType = await pool.query<{ id: number }>(
    `
      insert into patient_identifier_types (code, label, is_active)
      values ($1, $2, false)
      returning id
    `,
    [`inactive_${suffix}`, `Inactive Type ${suffix}`]
  );
  const inactiveTypeId = Number(inactiveType.rows[0]?.id);

  // Create a patient with the inactive identifier type
  const natId = `9${suffix.padStart(11, "0").slice(-11)}`;
  const patientResult = await pool.query<{ id: number }>(
    `
      insert into patients (
        national_id, identifier_type, identifier_value,
        arabic_full_name, english_full_name, normalized_arabic_name,
        age_years, estimated_date_of_birth, sex, phone_1, address,
        created_by_user_id, updated_by_user_id
      )
      values ($1, 'national_id', $1, $2, $3, $4, 25, '2001-01-01', 'F', '0912345678', 'city', $5, $5)
      returning id
    `,
    [natId, `مريض قديم ${suffix}`, `Old Patient ${suffix}`, `مريض${suffix}`, receptionistUserId]
  );
  const patientId = Number(patientResult.rows[0]?.id);

  // Add the inactive identifier
  await pool.query(
    `
      insert into patient_identifiers (patient_id, identifier_type_id, value, normalized_value, is_primary, created_by_user_id, updated_by_user_id)
      values ($1, $2, $3, $4, false, $5, $5)
    `,
    [patientId, inactiveTypeId, `INACT-${suffix}`, `inact-${suffix}`, receptionistUserId]
  );

  try {
    // Update the patient — this should NOT fail because the inactive type is still valid
    const payload: PatientPayload = {
      nationalId: natId,
      nationalIdConfirmation: natId,
      identifierType: "national_id",
      identifierValue: natId,
      arabicFullName: `مريض محدث ${suffix}`,
      englishFullName: `Updated Patient ${suffix}`,
      ageYears: 26,
      sex: "F",
      phone1: "0912345678",
      address: "updated city",
      identifiers: [
        { typeCode: "national_id", value: natId, isPrimary: true },
        { typeCode: `inactive_${suffix}`, value: `INACT-${suffix}`, isPrimary: false }
      ]
    };

    const updated = await updatePatient(patientId, payload, receptionistUserId);
    assert.equal(updated.arabic_full_name, `مريض محدث ${suffix}`);

    // Verify the inactive identifier is still present
    const identifiersAfter = await pool.query(
      `select count(*)::int as cnt from patient_identifiers where patient_id = $1`,
      [patientId]
    );
    assert.ok(Number(identifiersAfter.rows[0]?.cnt) >= 2, "Inactive identifier should be preserved after update");
  } finally {
    await pool.query(`delete from patient_identifiers where patient_id = $1`, [patientId]);
    await pool.query(`delete from patients where id = $1`, [patientId]);
    await pool.query(`delete from patient_identifier_types where id = $1`, [inactiveTypeId]);
    await pool.query(`delete from users where id = $1`, [receptionistUserId]);
  }
});
