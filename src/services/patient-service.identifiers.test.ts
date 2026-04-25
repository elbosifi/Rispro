import test from "node:test";
import assert from "node:assert/strict";
import bcrypt from "bcryptjs";
import { pool } from "../db/pool.js";
import { invalidateAllCache } from "../utils/cache.js";
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

function uniqueNationalId(prefixDigit: string): string {
  const digits = `${Date.now()}${Math.floor(Math.random() * 100000).toString().padStart(5, "0")}`;
  return `${prefixDigit}${digits.slice(-11)}`;
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

  // Ensure MRN identifier type exists for tests
  const mrnType = await pool.query<{ id: number }>(
    `
      insert into patient_identifier_types (code, label_ar, label_en, is_active)
      values ('mrn', 'رقم الملف', 'MRN', true)
      on conflict (code) do update set id = patient_identifier_types.id
      returning id
    `
  );

  // Create an extra identifier type (active)
  const idType = await pool.query<{ id: number }>(
    `
      insert into patient_identifier_types (code, label_ar, label_en, is_active)
      values ($1, $2, $3, true)
      returning id
    `,
    [`test_${suffix}`, `اختبار ${suffix}`, `Test ID ${suffix}`]
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
        values ($1::text, 'national_id', $1::text, $2, $3, $4, 30, '1996-01-01', 'M', $5, 'city', $6, $6)
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
  const patientAId = await mkPatient(uniqueNationalId("1"), [
    { typeCode: `test_${suffix}`, value: `SECONDARY-${suffix}`, isPrimary: false },
    { typeCode: `test_${suffix}`, value: `PASSPORT-${suffix}`, isPrimary: false }
  ]);

  // Patient B: no secondary identifiers
  const patientBId = await mkPatient(uniqueNationalId("2"));

  const cleanup = async () => {
    await pool.query(`delete from patient_identifiers where patient_id = any($1::bigint[])`, [[patientAId, patientBId]]);
    await pool.query(`delete from patients where id = any($1::bigint[])`, [[patientAId, patientBId]]);
    await pool.query(`delete from patient_identifier_types where id = $1`, [identifierTypeId]);
    await pool.query(`delete from audit_log where changed_by_user_id = $1`, [receptionistUserId]);
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
// Test: createPatient uses generated MRN as primary identifier when no identifier is provided
// ---------------------------------------------------------------------------
test("createPatient: uses generated MRN as primary identifier when no identifier is provided", async (t) => {
  if (!(await ensureDbOrSkip(t))) return;
  const suffix = uniqueSuffix();
  const receptionistHash = bcrypt.hashSync("test-pass", 10);

  const receptionist = await pool.query<{ id: number }>(
    `
      insert into users (username, full_name, password_hash, role, is_active)
      values ($1, $2, $3, 'receptionist', true)
      returning id
    `,
    [`test_rcpt_mrn_fallback_${suffix}`, `Receptionist ${suffix}`, receptionistHash]
  );
  const receptionistUserId = Number(receptionist.rows[0]?.id);

  try {
    // Set national_id_required to optional for this test
    await pool.query(
      `
        insert into system_settings (category, setting_key, setting_value)
        values ('patient_registration', 'national_id_required', '{"value":"optional"}'::jsonb)
        on conflict (category, setting_key) do update set setting_value = '{"value":"optional"}'::jsonb
      `
    );
    invalidateAllCache();

    const created = await createPatient(
      {
        arabicFullName: `مريض بدون معرف ${suffix}`,
        englishFullName: `No Identifier ${suffix}`,
        ageYears: 35,
        demographicsEstimated: false,
        sex: "M",
        phone1: "0912345678",
        address: "city"
        // No nationalId, identifierValue, or identifiers
      },
      receptionistUserId
    );

    assert.ok(created.mrn, "MRN should be generated");
    assert.equal(created.identifier_type, "mrn", "identifier_type should be mrn");
    assert.equal(created.identifier_value, created.mrn, "identifier_value should equal the generated MRN");
    assert.equal(created.national_id, null, "national_id should be null");

    // Verify patient_identifiers has exactly one primary row with MRN
    const piRow = await pool.query<{ type_code: string; value: string }>(
      `
        select pit.code as type_code, pi.value
        from patient_identifiers pi
        join patient_identifier_types pit on pit.id = pi.identifier_type_id
        where pi.patient_id = $1 and pi.is_primary = true
      `,
      [created.id]
    );
    assert.equal(piRow.rows.length, 1, "Should have exactly one primary identifier row");
    assert.equal(piRow.rows[0]?.type_code, "mrn", "Primary identifier type should be mrn");
    assert.equal(piRow.rows[0]?.value, created.mrn, "Primary identifier value should equal the generated MRN");

    // Verify getPatientById returns correct identifier info
    const fetched = await getPatientById(created.id);
    assert.equal(fetched.identifier_type, "mrn", "getPatientById should return identifier_type mrn");
    assert.equal(fetched.identifier_value, created.mrn, "getPatientById should return identifier_value equal to MRN");
  } finally {
    await pool.query(`delete from patient_identifiers where patient_id in (select id from patients where arabic_full_name = $1)`, [`مريض بدون معرف ${suffix}`]);
    await pool.query(`delete from patients where arabic_full_name = $1`, [`مريض بدون معرف ${suffix}`]);
    await pool.query(
      `
        update system_settings
        set setting_value = '{"value":"required_with_confirmation"}'::jsonb
        where category = 'patient_registration' and setting_key = 'national_id_required'
      `
    ).catch(() => undefined);
    invalidateAllCache();
    await pool.query(`delete from audit_log where changed_by_user_id = $1`, [receptionistUserId]);
    await pool.query(`delete from users where id = $1`, [receptionistUserId]);
  }
});

// ---------------------------------------------------------------------------
// Test: createPatient keeps national_id as primary when national ID is provided
// ---------------------------------------------------------------------------
test("createPatient: keeps national_id as primary when national ID is provided", async (t) => {
  if (!(await ensureDbOrSkip(t))) return;
  const suffix = uniqueSuffix();
  const receptionistHash = bcrypt.hashSync("test-pass", 10);

  const receptionist = await pool.query<{ id: number }>(
    `
      insert into users (username, full_name, password_hash, role, is_active)
      values ($1, $2, $3, 'receptionist', true)
      returning id
    `,
    [`test_rcpt_natid_${suffix}`, `Receptionist ${suffix}`, receptionistHash]
  );
  const receptionistUserId = Number(receptionist.rows[0]?.id);
  const nationalId = uniqueNationalId("1");

  try {
    const created = await createPatient(
      {
        nationalId,
        nationalIdConfirmation: nationalId,
        identifierType: "national_id",
        identifierValue: nationalId,
        arabicFullName: `مريض برقم وطني ${suffix}`,
        englishFullName: `With National ID ${suffix}`,
        ageYears: 40,
        demographicsEstimated: false,
        sex: "M",
        phone1: "0912345678",
        address: "city"
      },
      receptionistUserId
    );

    assert.ok(created.mrn, "MRN should be generated");
    assert.equal(created.identifier_type, "national_id", "identifier_type should be national_id");
    assert.equal(created.identifier_value, nationalId, "identifier_value should be the national ID");
    assert.equal(created.national_id, nationalId, "national_id column should match");

    // Verify patient_identifiers has national_id as primary
    const piRow = await pool.query<{ type_code: string; value: string }>(
      `
        select pit.code as type_code, pi.value
        from patient_identifiers pi
        join patient_identifier_types pit on pit.id = pi.identifier_type_id
        where pi.patient_id = $1 and pi.is_primary = true
      `,
      [created.id]
    );
    assert.equal(piRow.rows.length, 1, "Should have exactly one primary identifier row");
    assert.equal(piRow.rows[0]?.type_code, "national_id", "Primary identifier type should be national_id");
    assert.equal(piRow.rows[0]?.value, nationalId, "Primary identifier value should be the national ID");
  } finally {
    await pool.query(`delete from patient_identifiers where patient_id in (select id from patients where arabic_full_name = $1)`, [`مريض برقم وطني ${suffix}`]);
    await pool.query(`delete from patients where arabic_full_name = $1`, [`مريض برقم وطني ${suffix}`]);
    await pool.query(`delete from audit_log where changed_by_user_id = $1`, [receptionistUserId]);
    await pool.query(`delete from users where id = $1`, [receptionistUserId]);
  }
});

// ---------------------------------------------------------------------------
// Test: createPatient keeps selected passport primary over MRN when passport is provided
// ---------------------------------------------------------------------------
test("createPatient: keeps selected passport primary when passport is provided", async (t) => {
  if (!(await ensureDbOrSkip(t))) return;
  const suffix = uniqueSuffix();
  const receptionistHash = bcrypt.hashSync("test-pass", 10);

  const receptionist = await pool.query<{ id: number }>(
    `
      insert into users (username, full_name, password_hash, role, is_active)
      values ($1, $2, $3, 'receptionist', true)
      returning id
    `,
    [`test_rcpt_passport_${suffix}`, `Receptionist ${suffix}`, receptionistHash]
  );
  const receptionistUserId = Number(receptionist.rows[0]?.id);
  const passportValue = `P${suffix}`;

  try {
    const created = await createPatient(
      {
        identifierType: "passport",
        identifierValue: passportValue,
        arabicFullName: `مريض بجواز ${suffix}`,
        englishFullName: `With Passport ${suffix}`,
        ageYears: 30,
        demographicsEstimated: false,
        sex: "F",
        phone1: "0912345678",
        address: "city",
        identifiers: [
          { typeCode: "passport", value: passportValue, isPrimary: true }
        ]
      },
      receptionistUserId
    );

    assert.ok(created.mrn, "MRN should be generated");
    assert.equal(created.identifier_type, "passport", "identifier_type should be passport");
    assert.equal(created.identifier_value, passportValue, "identifier_value should be the passport");
    assert.equal(created.national_id, null, "national_id should be null");

    // Verify patient_identifiers has passport as primary
    const piRow = await pool.query<{ type_code: string; value: string }>(
      `
        select pit.code as type_code, pi.value
        from patient_identifiers pi
        join patient_identifier_types pit on pit.id = pi.identifier_type_id
        where pi.patient_id = $1 and pi.is_primary = true
      `,
      [created.id]
    );
    assert.equal(piRow.rows.length, 1, "Should have exactly one primary identifier row");
    assert.equal(piRow.rows[0]?.type_code, "passport", "Primary identifier type should be passport");
    assert.equal(piRow.rows[0]?.value, passportValue, "Primary identifier value should be the passport");
  } finally {
    await pool.query(`delete from patient_identifiers where patient_id in (select id from patients where arabic_full_name = $1)`, [`مريض بجواز ${suffix}`]);
    await pool.query(`delete from patients where arabic_full_name = $1`, [`مريض بجواز ${suffix}`]);
    await pool.query(`delete from audit_log where changed_by_user_id = $1`, [receptionistUserId]);
    await pool.query(`delete from users where id = $1`, [receptionistUserId]);
  }
});

// ---------------------------------------------------------------------------
// Test: searchPatients can find the patient by MRN when MRN was used as fallback primary
// ---------------------------------------------------------------------------
test("searchPatients: can find patient by MRN when MRN was used as fallback primary", async (t) => {
  if (!(await ensureDbOrSkip(t))) return;
  const suffix = uniqueSuffix();
  const receptionistHash = bcrypt.hashSync("test-pass", 10);

  const receptionist = await pool.query<{ id: number }>(
    `
      insert into users (username, full_name, password_hash, role, is_active)
      values ($1, $2, $3, 'receptionist', true)
      returning id
    `,
    [`test_rcpt_search_${suffix}`, `Receptionist ${suffix}`, receptionistHash]
  );
  const receptionistUserId = Number(receptionist.rows[0]?.id);

  try {
    await pool.query(
      `
        insert into system_settings (category, setting_key, setting_value)
        values ('patient_registration', 'national_id_required', '{"value":"optional"}'::jsonb)
        on conflict (category, setting_key) do update set setting_value = '{"value":"optional"}'::jsonb
      `
    );
    invalidateAllCache();

    const created = await createPatient(
      {
        arabicFullName: `مريض بحث ${suffix}`,
        englishFullName: `Search Test ${suffix}`,
        ageYears: 28,
        demographicsEstimated: false,
        sex: "M",
        phone1: "0912345678",
        address: "city"
      },
      receptionistUserId
    );

    assert.ok(created.mrn, "MRN should be generated for search test");

    // Search by the generated MRN
    const results = await searchPatients(created.mrn!);
    const found = results.find((r) => Number(r.id) === Number(created.id));
    assert.ok(found, `Should find patient by generated MRN ${created.mrn}`);
    assert.equal(found?.identifier_type, "mrn", "Found patient should have identifier_type mrn");
    assert.equal(found?.identifier_value, created.mrn, "Found patient should have identifier_value equal to MRN");
  } finally {
    await pool.query(`delete from patient_identifiers where patient_id in (select id from patients where arabic_full_name = $1)`, [`مريض بحث ${suffix}`]);
    await pool.query(`delete from patients where arabic_full_name = $1`, [`مريض بحث ${suffix}`]);
    await pool.query(
      `
        update system_settings
        set setting_value = '{"value":"required_with_confirmation"}'::jsonb
        where category = 'patient_registration' and setting_key = 'national_id_required'
      `
    ).catch(() => undefined);
    invalidateAllCache();
    await pool.query(`delete from audit_log where changed_by_user_id = $1`, [receptionistUserId]);
    await pool.query(`delete from users where id = $1`, [receptionistUserId]);
  }
});

// ---------------------------------------------------------------------------
// Test: createPatient with empty identifiers array uses MRN as fallback
// ---------------------------------------------------------------------------
test("createPatient: uses MRN as primary when identifiers array is empty", async (t) => {
  if (!(await ensureDbOrSkip(t))) return;
  const suffix = uniqueSuffix();
  const receptionistHash = bcrypt.hashSync("test-pass", 10);

  const receptionist = await pool.query<{ id: number }>(
    `
      insert into users (username, full_name, password_hash, role, is_active)
      values ($1, $2, $3, 'receptionist', true)
      returning id
    `,
    [`test_rcpt_empty_${suffix}`, `Receptionist ${suffix}`, receptionistHash]
  );
  const receptionistUserId = Number(receptionist.rows[0]?.id);

  try {
    await pool.query(
      `
        insert into system_settings (category, setting_key, setting_value)
        values ('patient_registration', 'national_id_required', '{"value":"optional"}'::jsonb)
        on conflict (category, setting_key) do update set setting_value = '{"value":"optional"}'::jsonb
      `
    );
    invalidateAllCache();

    const created = await createPatient(
      {
        arabicFullName: `مريض فارغ ${suffix}`,
        englishFullName: `Empty Identifiers ${suffix}`,
        ageYears: 50,
        demographicsEstimated: true,
        sex: "M",
        phone1: "0912345678",
        address: "city",
        identifiers: []
      },
      receptionistUserId
    );

    assert.ok(created.mrn, "MRN should be generated");
    assert.equal(created.identifier_type, "mrn", "identifier_type should be mrn");
    assert.equal(created.identifier_value, created.mrn, "identifier_value should equal MRN");
    assert.equal(created.national_id, null, "national_id should be null");

    const piRow = await pool.query<{ type_code: string; value: string }>(
      `
        select pit.code as type_code, pi.value
        from patient_identifiers pi
        join patient_identifier_types pit on pit.id = pi.identifier_type_id
        where pi.patient_id = $1 and pi.is_primary = true
      `,
      [created.id]
    );
    assert.equal(piRow.rows.length, 1, "Should have exactly one primary identifier");
    assert.equal(piRow.rows[0]?.type_code, "mrn", "Primary type should be mrn");
  } finally {
    await pool.query(`delete from patient_identifiers where patient_id in (select id from patients where arabic_full_name = $1)`, [`مريض فارغ ${suffix}`]);
    await pool.query(`delete from patients where arabic_full_name = $1`, [`مريض فارغ ${suffix}`]);
    await pool.query(
      `
        update system_settings
        set setting_value = '{"value":"required_with_confirmation"}'::jsonb
        where category = 'patient_registration' and setting_key = 'national_id_required'
      `
    ).catch(() => undefined);
    invalidateAllCache();
    await pool.query(`delete from audit_log where changed_by_user_id = $1`, [receptionistUserId]);
    await pool.query(`delete from users where id = $1`, [receptionistUserId]);
  }
});

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

test("searchPatients: ranks first-token matches before later-token matches for single token query", async (t) => {
  if (!(await ensureDbOrSkip(t))) return;
  const suffix = uniqueSuffix();
  const receptionistHash = bcrypt.hashSync("test-pass", 10);
  const receptionist = await pool.query<{ id: number }>(
    `
      insert into users (username, full_name, password_hash, role, is_active)
      values ($1, $2, $3, 'receptionist', true)
      returning id
    `,
    [`test_rcpt_rank_${suffix}`, `Receptionist ${suffix}`, receptionistHash]
  );
  const receptionistUserId = Number(receptionist.rows[0]?.id);
  const token = `muhammadrank${Math.floor(Math.random() * 100000)}`;
  const createdPatientIds: number[] = [];

  const insertPatient = async (englishFullName: string) => {
    const nationalId = uniqueNationalId("1");
    const inserted = await pool.query<{ id: number }>(
      `
        insert into patients (
          national_id, identifier_type, identifier_value,
          arabic_full_name, english_full_name, normalized_arabic_name,
          age_years, estimated_date_of_birth, sex, phone_1, address,
          created_by_user_id, updated_by_user_id
        )
        values ($1::text, 'national_id', $1::text, $2, $3, $2, 30, '1996-01-01', 'M', '0912345678', 'city', $4, $4)
        returning id
      `,
      [nationalId, `مريض ${suffix} ${englishFullName}`, englishFullName, receptionistUserId]
    );
    const id = Number(inserted.rows[0]?.id);
    createdPatientIds.push(id);
    return id;
  };

  try {
    const exactFirstA = await insertPatient(`${token} Ali Saleh`);
    const exactFirstB = await insertPatient(`${token} Omar`);
    const prefixFirst = await insertPatient(`${token}x Kareem`);
    const laterTokenA = await insertPatient(`Ali ${token} Saleh`);
    const laterTokenB = await insertPatient(`Omar bin ${token}`);

    const results = await searchPatients(token);
    const rankedIds = results.map((row) => Number(row.id));

    const idxExactFirstA = rankedIds.indexOf(exactFirstA);
    const idxExactFirstB = rankedIds.indexOf(exactFirstB);
    const idxPrefixFirst = rankedIds.indexOf(prefixFirst);
    const idxLaterA = rankedIds.indexOf(laterTokenA);
    const idxLaterB = rankedIds.indexOf(laterTokenB);

    assert.ok(idxExactFirstA >= 0, "Exact first-token match A should appear");
    assert.ok(idxExactFirstB >= 0, "Exact first-token match B should appear");
    assert.ok(idxPrefixFirst >= 0, "Prefix first-token match should appear");
    assert.ok(idxLaterA >= 0, "Later-token match A should appear");
    assert.ok(idxLaterB >= 0, "Later-token match B should appear");

    assert.ok(idxExactFirstA < idxLaterA, "Exact first-token match should rank before later-token match");
    assert.ok(idxExactFirstB < idxLaterB, "Exact first-token match should rank before later-token match");
    assert.ok(idxExactFirstA < idxPrefixFirst, "Exact first-token match should rank before prefix first-token match");
    assert.ok(idxExactFirstB < idxPrefixFirst, "Exact first-token match should rank before prefix first-token match");
  } finally {
    if (createdPatientIds.length > 0) {
      await pool.query(`delete from patient_identifiers where patient_id = any($1::bigint[])`, [createdPatientIds]).catch(() => undefined);
      await pool.query(`delete from patients where id = any($1::bigint[])`, [createdPatientIds]).catch(() => undefined);
    }
    await pool.query(`delete from audit_log where changed_by_user_id = $1`, [receptionistUserId]).catch(() => undefined);
    await pool.query(`delete from users where id = $1`, [receptionistUserId]).catch(() => undefined);
  }
});

test("createPatient: persists demographics_estimated flag", async (t) => {
  if (!(await ensureDbOrSkip(t))) return;
  const suffix = uniqueSuffix();
  const receptionistHash = bcrypt.hashSync("test-pass", 10);

  const receptionist = await pool.query<{ id: number }>(
    `
      insert into users (username, full_name, password_hash, role, is_active)
      values ($1, $2, $3, 'receptionist', true)
      returning id
    `,
    [`test_rcpt_est_${suffix}`, `Receptionist ${suffix}`, receptionistHash]
  );
  const receptionistUserId = Number(receptionist.rows[0]?.id);
  const nationalId = uniqueNationalId("1");

  try {
    const created = await createPatient(
      {
        nationalId,
        nationalIdConfirmation: nationalId,
        identifierType: "national_id",
        identifierValue: nationalId,
        category: "oncology",
        arabicFullName: `مريض تقديري ${suffix}`,
        englishFullName: `Estimated ${suffix}`,
        ageYears: 40,
        demographicsEstimated: true,
        sex: "M",
        phone1: "0912345678",
        address: "city"
      },
      receptionistUserId
    );

    assert.equal(created.demographics_estimated, true, "create should persist demographics_estimated");
    assert.equal(created.category, "oncology", "create should persist patient category");
    const fetched = await getPatientById(created.id);
    assert.equal(fetched.demographics_estimated, true, "read should include demographics_estimated");
    assert.equal(fetched.category, "oncology", "read should include patient category");

    const searchResults = await searchPatients(nationalId);
    const found = searchResults.find((row) => Number(row.id) === Number(created.id));
    assert.ok(found, "search should include created patient");
    assert.equal(found?.demographics_estimated, true, "search should include demographics_estimated");
    assert.equal(found?.category, "oncology", "search should include patient category");
  } finally {
    await pool.query(`delete from patients where national_id = $1`, [nationalId]);
    await pool.query(`delete from audit_log where changed_by_user_id = $1`, [receptionistUserId]);
    await pool.query(`delete from users where id = $1`, [receptionistUserId]);
  }
});

test("createPatient: applies configured MRN prefix", async (t) => {
  if (!(await ensureDbOrSkip(t))) return;
  const suffix = uniqueSuffix();
  const receptionistHash = bcrypt.hashSync("test-pass", 10);
  const mrnPrefix = `PRE-${suffix}-`;

  const receptionist = await pool.query<{ id: number }>(
    `
      insert into users (username, full_name, password_hash, role, is_active)
      values ($1, $2, $3, 'receptionist', true)
      returning id
    `,
    [`test_rcpt_mrn_${suffix}`, `Receptionist ${suffix}`, receptionistHash]
  );
  const receptionistUserId = Number(receptionist.rows[0]?.id);
  const nationalId = uniqueNationalId("1");

  try {
    await pool.query(
      `
        update system_settings
        set setting_value = jsonb_build_object('value', $1::text),
            updated_by_user_id = $2
        where category = 'patient_registration' and setting_key = 'mrn_prefix'
      `,
      [mrnPrefix, receptionistUserId]
    );
    invalidateAllCache();

    const created = await createPatient(
      {
        nationalId,
        nationalIdConfirmation: nationalId,
        identifierType: "national_id",
        identifierValue: nationalId,
        arabicFullName: `مريض بادئة ${suffix}`,
        englishFullName: `Prefix ${suffix}`,
        ageYears: 31,
        demographicsEstimated: false,
        sex: "M",
        phone1: "0912345678",
        address: "city"
      },
      receptionistUserId
    );

    assert.ok(created.mrn?.startsWith(mrnPrefix), `Expected MRN to start with ${mrnPrefix}`);
    const fetched = await getPatientById(created.id);
    assert.equal(fetched.mrn?.startsWith(mrnPrefix), true, "Fetched patient MRN should keep the prefix");
  } finally {
    await pool.query(
      `
        update system_settings
        set setting_value = jsonb_build_object('value', ''),
            updated_by_user_id = null
        where category = 'patient_registration' and setting_key = 'mrn_prefix'
      `
    ).catch(() => undefined);
    invalidateAllCache();
    await pool.query(`delete from patients where national_id = $1`, [nationalId]);
    await pool.query(`delete from audit_log where changed_by_user_id = $1`, [receptionistUserId]);
    await pool.query(`delete from users where id = $1`, [receptionistUserId]);
  }
});

test("createPatient: selected primary identifier is reflected in patient identifier_type/value", async (t) => {
  if (!(await ensureDbOrSkip(t))) return;
  const suffix = uniqueSuffix();
  const receptionistHash = bcrypt.hashSync("test-pass", 10);

  const receptionist = await pool.query<{ id: number }>(
    `
      insert into users (username, full_name, password_hash, role, is_active)
      values ($1, $2, $3, 'receptionist', true)
      returning id
    `,
    [`test_rcpt_primary_${suffix}`, `Receptionist ${suffix}`, receptionistHash]
  );
  const receptionistUserId = Number(receptionist.rows[0]?.id);

  const idType = await pool.query<{ id: number }>(
    `
      insert into patient_identifier_types (code, label_ar, label_en, is_active)
      values ($1, $2, $3, true)
      returning id
    `,
    [`test_primary_${suffix}`, `اختبار أساسي ${suffix}`, `Primary Test ${suffix}`]
  );
  const identifierTypeId = Number(idType.rows[0]?.id);

  const nationalId = uniqueNationalId("1");
  const primaryPassport = `P-${suffix}`;

  try {
    const created = await createPatient(
      {
        nationalId,
        nationalIdConfirmation: nationalId,
        identifierType: "national_id",
        identifierValue: nationalId,
        arabicFullName: `مريض أساسي ${suffix}`,
        englishFullName: `Primary ${suffix}`,
        ageYears: 34,
        demographicsEstimated: false,
        sex: "M",
        phone1: "0912345678",
        address: "city",
        identifiers: [
          { typeCode: "national_id", value: nationalId, isPrimary: false },
          { typeCode: "passport", value: primaryPassport, isPrimary: true },
        ],
      },
      receptionistUserId
    );

    const topLevel = await pool.query<{ identifier_type: string; identifier_value: string | null; national_id: string | null }>(
      `
        select identifier_type, identifier_value, national_id
        from patients
        where id = $1
      `,
      [created.id]
    );
    assert.equal(topLevel.rows[0]?.identifier_type, "passport");
    assert.equal(topLevel.rows[0]?.identifier_value, primaryPassport);
    assert.equal(topLevel.rows[0]?.national_id, null);

    const primaryRow = await pool.query<{ type_code: string; value: string }>(
      `
        select pit.code as type_code, pi.value
        from patient_identifiers pi
        join patient_identifier_types pit on pit.id = pi.identifier_type_id
        where pi.patient_id = $1 and pi.is_primary = true
        limit 1
      `,
      [created.id]
    );
    assert.equal(primaryRow.rows[0]?.type_code, "passport");
    assert.equal(primaryRow.rows[0]?.value, primaryPassport);
  } finally {
    await pool.query(`delete from patient_identifiers where patient_id in (select id from patients where arabic_full_name = $1)`, [`مريض أساسي ${suffix}`]);
    await pool.query(`delete from patients where arabic_full_name = $1`, [`مريض أساسي ${suffix}`]);
    await pool.query(`delete from patient_identifier_types where id = $1`, [identifierTypeId]);
    await pool.query(`delete from audit_log where changed_by_user_id = $1`, [receptionistUserId]);
    await pool.query(`delete from users where id = $1`, [receptionistUserId]);
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
    const targetIdentifierValue = `TARGET-${uniqueSuffix()}`;
    // Give patient B an extra unique secondary identifier before merge
    await pool.query(
      `
        insert into patient_identifiers (patient_id, identifier_type_id, value, normalized_value, is_primary, created_by_user_id, updated_by_user_id)
        values ($1, $2, $3, $4, false, $5, $5)
      `,
      [fx.patientBId, fx.identifierTypeId, targetIdentifierValue, targetIdentifierValue.toLowerCase(), fx.receptionistUserId]
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
      insert into patient_identifier_types (code, label_ar, label_en, is_active)
      values ($1, $2, $3, false)
      returning id
    `,
    [`inactive_${suffix}`, `معرّف غير نشط ${suffix}`, `Inactive Type ${suffix}`]
  );
  const inactiveTypeId = Number(inactiveType.rows[0]?.id);

  // Create a patient with the inactive identifier type
  const natId = uniqueNationalId("2");
  const patientResult = await pool.query<{ id: number }>(
    `
      insert into patients (
        national_id, identifier_type, identifier_value,
        arabic_full_name, english_full_name, normalized_arabic_name,
        age_years, estimated_date_of_birth, sex, phone_1, address,
        created_by_user_id, updated_by_user_id
      )
      values ($1::text, 'national_id', $1::text, $2, $3, $4, 25, '2001-01-01', 'F', '0912345678', 'city', $5, $5)
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
      category: "non_oncology",
      arabicFullName: `مريض محدث ${suffix}`,
      englishFullName: `Updated Patient ${suffix}`,
      ageYears: 26,
      demographicsEstimated: true,
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
    assert.equal(updated.demographics_estimated, true, "demographics_estimated should persist true");
    assert.equal(updated.category, "non_oncology", "category should persist on update");

    const toggled = await updatePatient(
      patientId,
      {
        ...payload,
        demographicsEstimated: false,
        category: "oncology"
      },
      receptionistUserId
    );
    assert.equal(toggled.demographics_estimated, false, "demographics_estimated should be editable later");
    assert.equal(toggled.category, "oncology", "category should be editable later");

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
    await pool.query(`delete from audit_log where changed_by_user_id = $1`, [receptionistUserId]);
    await pool.query(`delete from users where id = $1`, [receptionistUserId]);
  }
});
