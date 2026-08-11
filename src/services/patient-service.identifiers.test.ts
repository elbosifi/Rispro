import test from "node:test";
import assert from "node:assert/strict";
import bcrypt from "bcryptjs";
import { pool } from "../db/pool.js";
import { invalidateAllCache } from "../utils/cache.js";
import { normalizeArabicName, normalizeArabicNameCompact } from "../utils/normalize.js";
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
  identifierTypeCode: string;
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
  const identifierTypeCode = `test_${suffix}`;

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

  return { receptionistUserId, patientAId, patientBId, identifierTypeId, identifierTypeCode, cleanup };
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

async function readIdentifierRequiredRule(): Promise<string> {
  const { rows } = await pool.query<{ value: string | null }>(
    `
      select setting_value->>'value' as value
      from system_settings
      where category = 'patient_registration'
        and setting_key = 'national_id_required'
      limit 1
    `
  );
  return String(rows[0]?.value || "optional");
}

async function setIdentifierRequiredRule(value: string): Promise<void> {
  await pool.query(
    `
      insert into system_settings (category, setting_key, setting_value)
      values ('patient_registration', 'national_id_required', jsonb_build_object('value', $1::text))
      on conflict (category, setting_key)
      do update set setting_value = excluded.setting_value
    `,
    [value]
  );
  invalidateAllCache();
}

function minimalPatientPayload(suffix: string, patch: Partial<PatientPayload> = {}): PatientPayload {
  return {
    arabicFullName: `مريض اختبار ${suffix}`,
    englishFullName: `Test Patient ${suffix}`,
    identifierType: "national_id",
    identifierValue: "",
    category: "non_oncology",
    sex: "M",
    ageYears: 30,
    phone1: `09${String(Math.floor(Math.random() * 100000000)).padStart(8, "0")}`,
    address: "city",
    ...patch,
  };
}

// ---------------------------------------------------------------------------
// Test: required identifier setting applies to any primary identifier type
// ---------------------------------------------------------------------------
test("createPatient: required identifier setting rejects blank primary identifier with clear message", async (t) => {
  if (!(await ensureDbOrSkip(t))) return;
  const fx = await createFixture();
  const previousRule = await readIdentifierRequiredRule();
  try {
    await setIdentifierRequiredRule("required");
    await assert.rejects(
      () => createPatient(minimalPatientPayload(uniqueSuffix()), fx.receptionistUserId),
      /Primary identifier is required\. Enter a National ID, passport number, or other identifier before saving this patient\./
    );
  } finally {
    await setIdentifierRequiredRule(previousRule);
    await fx.cleanup();
  }
});

test("createPatient: rejects a not-allowed Arabic name word as a separate word", async (t) => {
  if (!(await ensureDbOrSkip(t))) return;
  const fx = await createFixture();
  const previousRule = await readIdentifierRequiredRule();
  try {
    await setIdentifierRequiredRule("optional");
    await pool.query(
      `
        insert into patient_not_allowed_name_words (arabic_text, normalized_arabic_text, is_active)
        values ('عبد', 'عبد', true)
        on conflict (normalized_arabic_text)
        do update set arabic_text = excluded.arabic_text, is_active = true
      `
    );

    await assert.rejects(
      () => createPatient(minimalPatientPayload(uniqueSuffix(), { arabicFullName: "محمد عبد الله" }), fx.receptionistUserId),
      /Arabic name contains a not-allowed word: عبد/
    );

    await assert.rejects(
      () => createPatient(minimalPatientPayload(uniqueSuffix(), { arabicFullName: "محمد علي عبد الله" }), fx.receptionistUserId),
      /Arabic name contains a not-allowed word: عبد/
    );
  } finally {
    await setIdentifierRequiredRule(previousRule);
    await fx.cleanup();
  }
});

test("createPatient: allows joined spelling when blocked word is not separate", async (t) => {
  if (!(await ensureDbOrSkip(t))) return;
  const fx = await createFixture();
  const previousRule = await readIdentifierRequiredRule();
  let createdPatientId: number | null = null;
  try {
    await setIdentifierRequiredRule("optional");
    await pool.query(
      `
        insert into patient_not_allowed_name_words (arabic_text, normalized_arabic_text, is_active)
        values ('عبد', 'عبد', true)
        on conflict (normalized_arabic_text)
        do update set arabic_text = excluded.arabic_text, is_active = true
      `
    );

    const patient = await createPatient(
      minimalPatientPayload(uniqueSuffix(), { arabicFullName: "محمد عبدالله علي" }),
      fx.receptionistUserId
    );
    createdPatientId = Number(patient.id);

    assert.equal(patient.arabic_full_name, "محمد عبدالله علي");
  } finally {
    if (createdPatientId) {
      await pool.query(`delete from patients where id = $1`, [createdPatientId]);
    }
    await setIdentifierRequiredRule(previousRule);
    await fx.cleanup();
  }
});

test("createPatient: required identifier setting accepts non-national primary identifier", async (t) => {
  if (!(await ensureDbOrSkip(t))) return;
  const fx = await createFixture();
  const createdIds: number[] = [];
  const previousRule = await readIdentifierRequiredRule();
  try {
    await setIdentifierRequiredRule("required");
    const suffix = uniqueSuffix();
    const created = await createPatient(
      minimalPatientPayload(suffix, {
        identifierType: fx.identifierTypeCode,
        identifierValue: `PASS-${suffix}`,
        nationalId: undefined,
        identifiers: [{ typeCode: fx.identifierTypeCode, value: `PASS-${suffix}`, isPrimary: true }],
      }),
      fx.receptionistUserId
    );
    createdIds.push(Number(created.id));
    assert.equal(created.identifier_value, `PASS-${suffix}`);

    const fetched = await getPatientById(Number(created.id));
    assert.equal(fetched.identifier_type, fx.identifierTypeCode);
    assert.equal(fetched.identifier_value, `PASS-${suffix}`);
    assert.equal(fetched.identifiers?.find((identifier) => identifier.is_primary)?.type_code, fx.identifierTypeCode);
    assert.equal(fetched.identifiers?.find((identifier) => identifier.is_primary)?.value, `PASS-${suffix}`);

    const legacyColumns = await pool.query<{ identifier_type: string; identifier_value: string | null; national_id: string | null }>(
      `
        select identifier_type, identifier_value, national_id
        from patients
        where id = $1
      `,
      [created.id]
    );
    assert.equal(legacyColumns.rows[0]?.identifier_type, "other");
    assert.equal(legacyColumns.rows[0]?.identifier_value, `PASS-${suffix}`);
    assert.equal(legacyColumns.rows[0]?.national_id, null);
  } finally {
    await setIdentifierRequiredRule(previousRule);
    if (createdIds.length > 0) {
      await pool.query(`delete from patient_identifiers where patient_id = any($1::bigint[])`, [createdIds]);
      await pool.query(`delete from patients where id = any($1::bigint[])`, [createdIds]);
    }
    await fx.cleanup();
  }
});

test("createPatient: optional identifier setting allows blank identifier", async (t) => {
  if (!(await ensureDbOrSkip(t))) return;
  const fx = await createFixture();
  const createdIds: number[] = [];
  const previousRule = await readIdentifierRequiredRule();
  try {
    await setIdentifierRequiredRule("optional");
    const created = await createPatient(minimalPatientPayload(uniqueSuffix()), fx.receptionistUserId);
    createdIds.push(Number(created.id));
    assert.equal(created.identifier_value, null);
  } finally {
    await setIdentifierRequiredRule(previousRule);
    if (createdIds.length > 0) {
      await pool.query(`delete from patient_identifiers where patient_id = any($1::bigint[])`, [createdIds]);
      await pool.query(`delete from patients where id = any($1::bigint[])`, [createdIds]);
    }
    await fx.cleanup();
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

test("searchPatients: matches multi-word names in order and prefers first-token matches", async (t) => {
  if (!(await ensureDbOrSkip(t))) return;
  const suffix = uniqueSuffix();
  const receptionistHash = bcrypt.hashSync("test-pass", 10);
  const receptionist = await pool.query<{ id: number }>(
    `
      insert into users (username, full_name, password_hash, role, is_active)
      values ($1, $2, $3, 'receptionist', true)
      returning id
    `,
    [`test_rcpt_multi_${suffix}`, `Receptionist ${suffix}`, receptionistHash]
  );
  const receptionistUserId = Number(receptionist.rows[0]?.id);
  const createdPatientIds: number[] = [];

  const insertPatient = async (englishFullName: string, arabicFullName: string) => {
    const nationalId = uniqueNationalId("3");
    const inserted = await pool.query<{ id: number }>(
      `
        insert into patients (
          national_id, identifier_type, identifier_value,
          arabic_full_name, english_full_name, normalized_arabic_name,
          age_years, estimated_date_of_birth, sex, phone_1, address,
          created_by_user_id, updated_by_user_id
        )
        values ($1::text, 'national_id', $1::text, $2, $3, $4, 31, '1995-01-01', 'F', '0912345678', 'city', $5, $5)
        returning id
      `,
      [nationalId, arabicFullName, englishFullName, arabicFullName, receptionistUserId]
    );
    const id = Number(inserted.rows[0]?.id);
    createdPatientIds.push(id);
    return id;
  };

  try {
    const exactFirstToken = await insertPatient("Ali Saleh Ahmed", "Ù…Ø±ÙŠØ¶ Ø¹Ù„ÙŠ ØµØ§Ù„Ø­ Ø£Ø­Ù…Ø¯");
    const orderedLaterTokens = await insertPatient("Mohammed Ali Ahmed Saleh", "Ù…Ø±ÙŠØ¶ Ù…Ø­Ù…Ø¯ Ø¹Ù„ÙŠ Ø£Ø­Ù…Ø¯ ØµØ§Ù„Ø­");

    const results = await searchPatients("Ali Saleh");
    const rankedIds = results.map((row) => Number(row.id));

    const idxExact = rankedIds.indexOf(exactFirstToken);
    const idxOrderedLater = rankedIds.indexOf(orderedLaterTokens);

    assert.ok(idxExact >= 0, "First-token match should appear");
    assert.ok(idxOrderedLater >= 0, "Ordered later-token match should appear");
    assert.ok(idxExact < idxOrderedLater, "First-token match should rank before later-token match");
  } finally {
    if (createdPatientIds.length > 0) {
      await pool.query(`delete from patient_identifiers where patient_id = any($1::bigint[])`, [createdPatientIds]).catch(() => undefined);
      await pool.query(`delete from patients where id = any($1::bigint[])`, [createdPatientIds]).catch(() => undefined);
    }
    await pool.query(`delete from audit_log where changed_by_user_id = $1`, [receptionistUserId]).catch(() => undefined);
    await pool.query(`delete from users where id = $1`, [receptionistUserId]).catch(() => undefined);
  }
});

test("searchPatients: ranks adjacent first-second name tokens before later ordered matches", async (t) => {
  if (!(await ensureDbOrSkip(t))) return;
  const suffix = uniqueSuffix();
  const receptionistHash = bcrypt.hashSync("test-pass", 10);
  const receptionist = await pool.query<{ id: number }>(
    `
      insert into users (username, full_name, password_hash, role, is_active)
      values ($1, $2, $3, 'receptionist', true)
      returning id
    `,
    [`test_rcpt_name_order_${suffix}`, `Receptionist ${suffix}`, receptionistHash]
  );
  const receptionistUserId = Number(receptionist.rows[0]?.id);
  const createdPatientIds: number[] = [];

  const insertPatient = async (englishFullName: string) => {
    const nationalId = uniqueNationalId("4");
    const inserted = await pool.query<{ id: number }>(
      `
        insert into patients (
          national_id, identifier_type, identifier_value,
          arabic_full_name, english_full_name, normalized_arabic_name,
          age_years, estimated_date_of_birth, sex, phone_1, address,
          created_by_user_id, updated_by_user_id
        )
        values ($1::text, 'national_id', $1::text, $2, $3, $2, 32, '1994-01-01', 'M', '0912345678', 'city', $4, $4)
        returning id
      `,
      [nationalId, `مريض ${suffix} ${englishFullName}`, englishFullName, receptionistUserId]
    );
    const id = Number(inserted.rows[0]?.id);
    createdPatientIds.push(id);
    return id;
  };

  try {
    const firstSecondThird = await insertPatient("Ali Saleh Ahmed");
    const firstThirdSecond = await insertPatient("Ali Ahmed Saleh");
    const laterOrdered = await insertPatient("Mohammed Ali Saleh Ahmed");

    const results = await searchPatients("Ali Saleh");
    const rankedIds = results.map((row) => Number(row.id));

    const idxFirstSecondThird = rankedIds.indexOf(firstSecondThird);
    const idxFirstThirdSecond = rankedIds.indexOf(firstThirdSecond);
    const idxLaterOrdered = rankedIds.indexOf(laterOrdered);

    assert.ok(idxFirstSecondThird >= 0, "First-second-third name should appear");
    assert.ok(idxFirstThirdSecond >= 0, "First-third-second name should appear");
    assert.ok(idxLaterOrdered >= 0, "Later ordered name should appear");
    assert.ok(idxFirstSecondThird < idxFirstThirdSecond, "First-second-third should rank before first-third-second");
    assert.ok(idxFirstSecondThird < idxLaterOrdered, "First-second-third should rank before later ordered match");
  } finally {
    if (createdPatientIds.length > 0) {
      await pool.query(`delete from patient_identifiers where patient_id = any($1::bigint[])`, [createdPatientIds]).catch(() => undefined);
      await pool.query(`delete from patients where id = any($1::bigint[])`, [createdPatientIds]).catch(() => undefined);
    }
    await pool.query(`delete from audit_log where changed_by_user_id = $1`, [receptionistUserId]).catch(() => undefined);
    await pool.query(`delete from users where id = $1`, [receptionistUserId]).catch(() => undefined);
  }
});

test("searchPatients: matches Arabic compound names with or without spaces", async (t) => {
  if (!(await ensureDbOrSkip(t))) return;
  const suffix = uniqueSuffix();
  const receptionistHash = bcrypt.hashSync("test-pass", 10);
  const receptionist = await pool.query<{ id: number }>(
    `
      insert into users (username, full_name, password_hash, role, is_active)
      values ($1, $2, $3, 'receptionist', true)
      returning id
    `,
    [`test_rcpt_ar_compound_${suffix}`, `Receptionist ${suffix}`, receptionistHash]
  );
  const receptionistUserId = Number(receptionist.rows[0]?.id);
  const createdPatientIds: number[] = [];

  const insertPatient = async (arabicFullName: string, englishFullName: string) => {
    const nationalId = uniqueNationalId("5");
    const inserted = await pool.query<{ id: number }>(
      `
        insert into patients (
          national_id, identifier_type, identifier_value,
          arabic_full_name, english_full_name, normalized_arabic_name, normalized_arabic_name_compact,
          age_years, estimated_date_of_birth, sex, phone_1, address,
          created_by_user_id, updated_by_user_id
        )
        values ($1::text, 'national_id', $1::text, $2, $3, $4, $5, 30, '1996-01-01', 'M', '0912345678', 'city', $6, $6)
        returning id
      `,
      [
        nationalId,
        arabicFullName,
        englishFullName,
        normalizeArabicName(arabicFullName),
        normalizeArabicNameCompact(arabicFullName),
        receptionistUserId,
      ]
    );
    const id = Number(inserted.rows[0]?.id);
    createdPatientIds.push(id);
    return id;
  };

  try {
    const abdullahCompact = await insertPatient(`عبدالله ${suffix}`, `Abdullah ${suffix}`);
    const abdullahSpaced = await insertPatient(`عبد الله ${suffix}`, `Abd Allah ${suffix}`);
    const abdulrahmanCompact = await insertPatient(`عبدالرحمن ${suffix}`, `Abdulrahman ${suffix}`);
    const nuruddinCompact = await insertPatient(`نورالدين ${suffix}`, `Nuruddin ${suffix}`);
    const normalArabic = await insertPatient(`محمد علي ${suffix}`, `Mohamed Ali ${suffix}`);
    const identifierQuery = `أبو بكر ${suffix}`;
    const compactNameMatch = await insertPatient(`ابوبكر ${suffix}`, `Abu Bakr ${suffix}`);
    const identifierMatch = await insertPatient(`مريض مختلف ${suffix}`, `Different Patient ${suffix}`);
    await pool.query(
      `
        update patients
        set identifier_type = 'other',
            identifier_value = $2
        where id = $1
      `,
      [identifierMatch, identifierQuery]
    );

    assert.equal((await searchPatients(`عبد الله ${suffix}`)).find((row) => Number(row.id) === abdullahCompact)?.arabic_full_name, `عبدالله ${suffix}`);
    assert.equal((await searchPatients(`عبدالله ${suffix}`)).find((row) => Number(row.id) === abdullahSpaced)?.arabic_full_name, `عبد الله ${suffix}`);
    assert.ok((await searchPatients(`عبد الرحمن ${suffix}`)).some((row) => Number(row.id) === abdulrahmanCompact));
    assert.ok((await searchPatients(`نور الدين ${suffix}`)).some((row) => Number(row.id) === nuruddinCompact));
    assert.ok((await searchPatients(`محمد ${suffix}`)).some((row) => Number(row.id) === normalArabic));
    assert.ok((await searchPatients(`Mohamed Ali ${suffix}`)).some((row) => Number(row.id) === normalArabic));
    const rankedIds = (await searchPatients(identifierQuery)).map((row) => Number(row.id));
    assert.ok(rankedIds.indexOf(identifierMatch) >= 0);
    assert.ok(rankedIds.indexOf(compactNameMatch) >= 0);
    assert.ok(rankedIds.indexOf(identifierMatch) < rankedIds.indexOf(compactNameMatch));
  } finally {
    if (createdPatientIds.length > 0) {
      await pool.query(`delete from patient_identifiers where patient_id = any($1::bigint[])`, [createdPatientIds]).catch(() => undefined);
      await pool.query(`delete from patients where id = any($1::bigint[])`, [createdPatientIds]).catch(() => undefined);
    }
    await pool.query(`delete from audit_log where changed_by_user_id = $1`, [receptionistUserId]).catch(() => undefined);
    await pool.query(`delete from users where id = $1`, [receptionistUserId]).catch(() => undefined);
  }
});

test("searchPatients: adds bounded trigram, dictionary, and token-wise Double Metaphone recall", async (t) => {
  if (!(await ensureDbOrSkip(t))) return;
  const suffix = uniqueSuffix();
  const receptionistHash = bcrypt.hashSync("test-pass", 10);
  const receptionist = await pool.query<{ id: number }>(
    `
      insert into users (username, full_name, password_hash, role, is_active)
      values ($1, $2, $3, 'receptionist', true)
      returning id
    `,
    [`test_rcpt_fuzzy_${suffix}`, `Receptionist ${suffix}`, receptionistHash]
  );
  const receptionistUserId = Number(receptionist.rows[0]?.id);
  const createdPatientIds: number[] = [];
  const dictionaryArabic = `قاموساختبار${suffix.replace(/\D/g, "")}`;

  const insertPatient = async (englishFullName: string, identifierValue?: string) => {
    const nationalId = uniqueNationalId("6");
    const arabicFullName = `مريض بحث ${createdPatientIds.length + 1}`;
    const inserted = await pool.query<{ id: number }>(
      `
        insert into patients (
          national_id, identifier_type, identifier_value,
          arabic_full_name, english_full_name, normalized_arabic_name, normalized_arabic_name_compact,
          age_years, estimated_date_of_birth, sex, phone_1, address,
          created_by_user_id, updated_by_user_id
        )
        values ($1::text, $2, $3, $4, $5, $6, $7, 30, '1996-01-01', 'M', '0912345678', 'city', $8, $8)
        returning id
      `,
      [
        nationalId,
        identifierValue ? "other" : "national_id",
        identifierValue || nationalId,
        arabicFullName,
        englishFullName,
        normalizeArabicName(arabicFullName),
        normalizeArabicNameCompact(arabicFullName),
        receptionistUserId,
      ]
    );
    const id = Number(inserted.rows[0]?.id);
    createdPatientIds.push(id);
    return id;
  };

  try {
    const phoneticVariant = await insertPatient("Mohamed Ali Salem");
    const highTrigramVariant = await insertPatient("Muhammad Aly Saleem");
    const secondVariantFamily = await insertPatient("Yousef Abdallah Hussein");
    const differentRemainingTokens = await insertPatient("Mohamed Faraj Bashir");
    const sameCodeDifferentName = await insertPatient("Robert Nader Tarek");
    const unsafeShortMatch = await insertPatient("Li Omar Salem");
    const exactIdentifier = await insertPatient("Entirely Different Person", "Muhammad Aly Salim");

    await pool.query(
      `insert into name_dictionary (arabic_text, english_text, is_active) values ($1, $2, true)`,
      [dictionaryArabic, "Muhammad Aly Salim"]
    );
    invalidateAllCache();

    const firstFamilyResults = await searchPatients("Muhammad Aly Salim");
    const firstFamilyIds = firstFamilyResults.map((row) => Number(row.id));
    assert.ok(firstFamilyIds.includes(phoneticVariant), "Mohamed/Ali/Salem should match Muhammad/Aly/Salim token-wise");
    assert.ok(firstFamilyIds.includes(highTrigramVariant), "The closer trigram variant should be returned");
    assert.ok(firstFamilyIds.indexOf(highTrigramVariant) < firstFamilyIds.indexOf(phoneticVariant), "Trigram similarity should rank above phonetic fallback");
    assert.ok(firstFamilyIds.indexOf(exactIdentifier) < firstFamilyIds.indexOf(highTrigramVariant), "Exact identifier should rank above fuzzy names");
    assert.equal(firstFamilyIds.includes(differentRemainingTokens), false, "One phonetic first-name agreement must not admit different remaining tokens");

    const secondFamilyIds = (await searchPatients("Yusuf Abdullah Hussain")).map((row) => Number(row.id));
    assert.ok(secondFamilyIds.includes(secondVariantFamily), "Yousef/Abdallah/Hussein should match Yusuf/Abdullah/Hussain");

    const dictionaryIds = (await searchPatients(dictionaryArabic)).map((row) => Number(row.id));
    assert.ok(dictionaryIds.includes(phoneticVariant), "Arabic dictionary output should participate in English phonetic matching");

    const unrelatedSameCodeIds = (await searchPatients("Rupert Salem Kareem")).map((row) => Number(row.id));
    assert.equal(unrelatedSameCodeIds.includes(sameCodeDifferentName), false, "A same-code first token with unrelated remaining tokens must not match");

    const shortNameIds = (await searchPatients("Lee")).map((row) => Number(row.id));
    assert.equal(shortNameIds.includes(unsafeShortMatch), false, "Short phonetic names without enough spelling similarity must not match");
  } finally {
    await pool.query(`delete from name_dictionary where arabic_text = $1`, [dictionaryArabic]).catch(() => undefined);
    invalidateAllCache();
    if (createdPatientIds.length > 0) {
      await pool.query(`delete from patient_identifiers where patient_id = any($1::bigint[])`, [createdPatientIds]).catch(() => undefined);
      await pool.query(`delete from patients where id = any($1::bigint[])`, [createdPatientIds]).catch(() => undefined);
    }
    await pool.query(`delete from audit_log where changed_by_user_id = $1`, [receptionistUserId]).catch(() => undefined);
    await pool.query(`delete from users where id = $1`, [receptionistUserId]).catch(() => undefined);
  }
});

test("searchPatients: recovers a misspelled single token anywhere in an English name without weakening safeguards", async (t) => {
  if (!(await ensureDbOrSkip(t))) return;
  const suffix = uniqueSuffix();
  const digits = suffix.replace(/\D/g, "");
  const receptionistHash = bcrypt.hashSync("test-pass", 10);
  const receptionist = await pool.query<{ id: number }>(
    `
      insert into users (username, full_name, password_hash, role, is_active)
      values ($1, $2, $3, 'receptionist', true)
      returning id
    `,
    [`test_rcpt_word_fuzzy_${suffix}`, `Receptionist ${suffix}`, receptionistHash]
  );
  const receptionistUserId = Number(receptionist.rows[0]?.id);
  const createdPatientIds: number[] = [];
  const dictionaryArabic = `بوراوياختبار${digits}`;

  const insertPatient = async (englishFullName: string, identifierValue?: string) => {
    const nationalId = uniqueNationalId("7");
    const arabicFullName = `مريض بحث ${createdPatientIds.length + 1} ${digits}`;
    const inserted = await pool.query<{ id: number }>(
      `
        insert into patients (
          national_id, identifier_type, identifier_value,
          arabic_full_name, english_full_name, normalized_arabic_name, normalized_arabic_name_compact,
          age_years, estimated_date_of_birth, sex, phone_1, address,
          created_by_user_id, updated_by_user_id
        )
        values ($1::text, $2, $3, $4, $5, $6, $7, 30, '1996-01-01', 'M', '0912345678', 'city', $8, $8)
        returning id
      `,
      [
        nationalId,
        identifierValue ? "other" : "national_id",
        identifierValue || nationalId,
        arabicFullName,
        englishFullName,
        normalizeArabicName(arabicFullName),
        normalizeArabicNameCompact(arabicFullName),
        receptionistUserId,
      ]
    );
    const id = Number(inserted.rows[0]?.id);
    createdPatientIds.push(id);
    return id;
  };

  try {
    const surnameToken = await insertPatient("Mohamed Salem Borawi");
    const middleToken = await insertPatient("Kareem Borawi Faraj");
    const misspelledName = await insertPatient("Mohamed Salem Burawi");
    const senussi = await insertPatient("Kareem Senussi Faraj");
    const yousef = await insertPatient("Nader Yousef Omar");
    const hussein = await insertPatient("Omar Hussein Saleh");
    const salem = await insertPatient("Faraj Salem Nader");
    const abdallah = await insertPatient("Nader Abdallah Mansour");
    const vaguelySimilar = await insertPatient("Omar Hassan Saleh");
    const unsafeShortMatch = await insertPatient("Li Omar Salem");
    const exactIdentifier = await insertPatient("Entirely Different Person", "Burawi");

    await pool.query(
      `insert into name_dictionary (arabic_text, english_text, is_active) values ($1, 'Burawi', true)`,
      [dictionaryArabic]
    );
    invalidateAllCache();

    const misspelledIds = (await searchPatients("Burawi")).map((row) => Number(row.id));
    assert.ok(misspelledIds.includes(surnameToken), "Burawi should find Borawi as a non-first surname token");
    assert.ok(misspelledIds.includes(middleToken), "Burawi should find Borawi as a middle token");
    assert.ok(misspelledIds.indexOf(exactIdentifier) < misspelledIds.indexOf(surnameToken), "Exact identifier must outrank fuzzy names");

    const exactIds = (await searchPatients("Borawi")).map((row) => Number(row.id));
    assert.ok(exactIds.includes(surnameToken), "Exact Borawi token should be found");
    assert.ok(exactIds.indexOf(surnameToken) < exactIds.indexOf(misspelledName), "Exact Borawi spelling should outrank Burawi");

    for (const [query, expectedId] of [
      ["Sanusi", senussi],
      ["Yusuf", yousef],
      ["Hussain", hussein],
      ["Salim", salem],
      ["Abdullah", abdallah],
    ] as const) {
      assert.ok((await searchPatients(query)).some((row) => Number(row.id) === expectedId), `${query} should find its spelling variant anywhere in the name`);
    }

    const hussainIds = (await searchPatients("Hussain")).map((row) => Number(row.id));
    assert.ok(hussainIds.indexOf(hussein) < hussainIds.indexOf(vaguelySimilar), "A strong word match must outrank a weak same-code surname");
    assert.equal((await searchPatients("Lee")).some((row) => Number(row.id) === unsafeShortMatch), false, "Short names still require stronger spelling support");
    assert.ok((await searchPatients(dictionaryArabic)).some((row) => Number(row.id) === surnameToken), "A fully translated one-token dictionary query should use whole-word fuzzy matching");
  } finally {
    await pool.query(`delete from name_dictionary where arabic_text = $1`, [dictionaryArabic]).catch(() => undefined);
    invalidateAllCache();
    if (createdPatientIds.length > 0) {
      await pool.query(`delete from patient_identifiers where patient_id = any($1::bigint[])`, [createdPatientIds]).catch(() => undefined);
      await pool.query(`delete from patients where id = any($1::bigint[])`, [createdPatientIds]).catch(() => undefined);
    }
    await pool.query(`delete from audit_log where changed_by_user_id = $1`, [receptionistUserId]).catch(() => undefined);
    await pool.query(`delete from users where id = $1`, [receptionistUserId]).catch(() => undefined);
  }
});

test("searchPatients: ranks Arabic single-token strict-word matches above weaker cross-script signals", async (t) => {
  if (!(await ensureDbOrSkip(t))) return;
  const suffix = uniqueSuffix();
  const digits = suffix.replace(/\D/g, "");
  const receptionistHash = bcrypt.hashSync("test-pass", 10);
  const receptionist = await pool.query<{ id: number }>(
    `
      insert into users (username, full_name, password_hash, role, is_active)
      values ($1, $2, $3, 'receptionist', true)
      returning id
    `,
    [`test_rcpt_ar_word_fuzzy_${suffix}`, `Receptionist ${suffix}`, receptionistHash]
  );
  const receptionistUserId = Number(receptionist.rows[0]?.id);
  const createdPatientIds: number[] = [];
  let dictionaryInserted = false;

  const insertPatient = async (arabicFullName: string, englishFullName: string) => {
    const nationalId = uniqueNationalId("8");
    const inserted = await pool.query<{ id: number }>(
      `
        insert into patients (
          national_id, identifier_type, identifier_value,
          arabic_full_name, english_full_name, normalized_arabic_name, normalized_arabic_name_compact,
          age_years, estimated_date_of_birth, sex, phone_1, address,
          created_by_user_id, updated_by_user_id
        )
        values ($1::text, 'national_id', $1::text, $2, $3, $4, $5, 30, '1996-01-01', 'M', '0912345678', 'city', $6, $6)
        returning id
      `,
      [
        nationalId,
        arabicFullName,
        englishFullName,
        normalizeArabicName(arabicFullName),
        normalizeArabicNameCompact(arabicFullName),
        receptionistUserId,
      ]
    );
    const id = Number(inserted.rows[0]?.id);
    createdPatientIds.push(id);
    return id;
  };

  try {
    const arabicWordMatch = await insertPatient(`محمد خالد السنوسي ${digits}`, "Entirely Different Person");
    const crossScriptMatch = await insertPatient(`مريض مختلف تماما ${digits}`, "Mohamed Khalid Salem");

    await pool.query(
      `insert into name_dictionary (arabic_text, english_text, is_active) values ('حالد', 'Khaled', true)`
    );
    dictionaryInserted = true;
    invalidateAllCache();

    const rankedIds = (await searchPatients("حالد")).map((row) => Number(row.id));
    assert.ok(rankedIds.includes(arabicWordMatch), "حالد should find خالد as a non-first normalized Arabic token");
    assert.ok(rankedIds.includes(crossScriptMatch), "The fixture should include a weaker dictionary-generated English fuzzy candidate");
    assert.ok(rankedIds.indexOf(arabicWordMatch) < rankedIds.indexOf(crossScriptMatch), "Same-script Arabic strict-word similarity should rank above weaker cross-script similarity");
  } finally {
    if (dictionaryInserted) {
      await pool.query(`delete from name_dictionary where arabic_text = 'حالد'`).catch(() => undefined);
    }
    invalidateAllCache();
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
