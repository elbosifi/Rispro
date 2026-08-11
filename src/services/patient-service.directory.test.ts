import test from "node:test";
import assert from "node:assert/strict";
import bcrypt from "bcryptjs";
import { pool } from "../db/pool.js";
import { invalidateAllCache } from "../utils/cache.js";
import { getPatientDirectory, searchPatients } from "./patient-service.js";
import { normalizeArabicName, normalizeArabicNameCompact } from "../utils/normalize.js";

function uniqueSuffix(): string {
  return `${Date.now()}_${Math.floor(Math.random() * 100000)}`;
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

test("patient directory sex filter matches both male/female and stored sex codes", async (t) => {
  if (!(await ensureDbOrSkip(t))) return;

  const suffix = uniqueSuffix();
  const passwordHash = bcrypt.hashSync("test-pass", 10);
  const user = await pool.query<{ id: number }>(
    `
      insert into users (username, full_name, password_hash, role, is_active)
      values ($1, $2, $3, 'receptionist', true)
      returning id
    `,
    [`test_dir_${suffix}`, `Directory Tester ${suffix}`, passwordHash],
  );
  const userId = Number(user.rows[0]?.id);

  const insertPatient = async (sex: "M" | "F", seed: string) => {
    const nationalId = `${sex}${String(Math.floor(Math.random() * 10_000_000_000)).padStart(10, "0")}${seed}`;
    const result = await pool.query<{ id: number }>(
      `
        insert into patients (
          national_id, identifier_type, identifier_value,
          arabic_full_name, english_full_name, normalized_arabic_name,
          age_years, estimated_date_of_birth, sex, phone_1, address,
          created_by_user_id, updated_by_user_id
        )
        values ($1::text, 'national_id', $1::text, $2, $3, $4, 30, '1996-01-01', $5, $6, 'city', $7, $7)
        returning id
      `,
      [
        nationalId,
        `${sex === "M" ? "Male" : "Female"} Arabic ${suffix} ${seed}`,
        `${sex === "M" ? "Male" : "Female"} English ${suffix} ${seed}`,
        `${sex === "M" ? "Male" : "Female"} Arabic ${suffix} ${seed}`,
        sex,
        `09${String(seed).padStart(8, "0").slice(-8)}`,
        userId,
      ],
    );
    return Number(result.rows[0]?.id);
  };

  const maleId = await insertPatient("M", "1");
  const femaleId = await insertPatient("F", "2");

  try {
    const maleDirectory = await getPatientDirectory({ search: suffix, sex: "male", page: 1, pageSize: 25 });
    assert.deepEqual(maleDirectory.patients.map((patient) => patient.id), [maleId]);

    const femaleDirectory = await getPatientDirectory({ search: suffix, sex: "female", page: 1, pageSize: 25 });
    assert.deepEqual(femaleDirectory.patients.map((patient) => patient.id), [femaleId]);
  } finally {
    await pool.query(`delete from patients where id = any($1::bigint[])`, [[maleId, femaleId]]).catch(() => undefined);
    await pool.query(`delete from audit_log where changed_by_user_id = $1`, [userId]).catch(() => undefined);
    await pool.query(`delete from users where id = $1`, [userId]).catch(() => undefined);
  }
});

test("patient directory maps next and last appointments into camelCase rows", async () => {
  const poolWithQuery = pool as unknown as {
    query: (sql: unknown, params?: unknown[]) => Promise<{ rows: unknown[] }>;
  };
  const originalQuery = poolWithQuery.query;

  poolWithQuery.query = async (sql: unknown) => {
    const normalizedSql = String(sql).replace(/\s+/g, " ").toLowerCase();

    if (normalizedSql.includes("select count(*)::bigint as total from patients p")) {
      return { rows: [{ total: "1" }] };
    }

    if (normalizedSql.includes("last_appointment") && normalizedSql.includes("next_appointment")) {
      return {
        rows: [
          {
            id: 77,
            mrn: "MRN-77",
            arabic_full_name: "Ù…Ø±ÙŠØ¶ Ù…Ø«Ø§Ù„",
            english_full_name: "Sample Patient",
            sex: "F",
            age_years: 29,
            demographics_estimated: false,
            phone_1: "0912345678",
            category: "oncology",
            last_appointment: {
              id: 101,
              date: "2026-04-20",
              status: "completed",
              modalityName: "CT",
            },
            next_appointment: {
              id: 102,
              date: "2026-04-30",
              status: "scheduled",
              modalityName: "MRI",
            },
            warnings: {
              missingPhone: false,
              missingDob: false,
              missingSex: false,
              missingName: false,
              noAppointment: false,
              possibleDuplicate: false,
              duplicateReasons: [],
            },
          },
        ],
      };
    }

    throw new Error(`Unexpected query: ${normalizedSql}`);
  };

  try {
    const directory = await getPatientDirectory({ page: 1, pageSize: 25 });

    assert.equal(directory.patients.length, 1);
    assert.deepEqual(directory.patients[0], {
      id: 77,
      mrn: "MRN-77",
      arabicFullName: "Ù…Ø±ÙŠØ¶ Ù…Ø«Ø§Ù„",
      englishFullName: "Sample Patient",
      sex: "F",
      ageYears: 29,
      demographicsEstimated: false,
      phone1: "0912345678",
      category: "oncology",
      lastAppointment: {
        id: 101,
        date: "2026-04-20",
        status: "completed",
        modalityName: "CT",
      },
      nextAppointment: {
        id: 102,
        date: "2026-04-30",
        status: "scheduled",
        modalityName: "MRI",
      },
      warnings: {
        missingPhone: false,
        missingDob: false,
        missingSex: false,
        missingName: false,
        noAppointment: false,
        possibleDuplicate: false,
        duplicateReasons: [],
      },
    });
  } finally {
    poolWithQuery.query = originalQuery;
  }
});

test("patient directory search orders by best match before recent sort", async (t) => {
  if (!(await ensureDbOrSkip(t))) return;

  const suffix = uniqueSuffix();
  const passwordHash = bcrypt.hashSync("test-pass", 10);
  const user = await pool.query<{ id: number }>(
    `
      insert into users (username, full_name, password_hash, role, is_active)
      values ($1, $2, $3, 'receptionist', true)
      returning id
    `,
    [`test_dir_rank_${suffix}`, `Directory Rank Tester ${suffix}`, passwordHash],
  );
  const userId = Number(user.rows[0]?.id);
  const createdIds: number[] = [];

  const insertPatient = async (arabicFullName: string, englishFullName: string) => {
    const result = await pool.query<{ id: number }>(
      `
        insert into patients (
          national_id, identifier_type, identifier_value,
          arabic_full_name, english_full_name, normalized_arabic_name, normalized_arabic_name_compact,
          age_years, estimated_date_of_birth, sex, phone_1, address,
          created_by_user_id, updated_by_user_id
        )
        values ($1::text, 'national_id', $1::text, $2, $3, $4, $5, 30, '1996-01-01', 'M', $6, 'city', $7, $7)
        returning id
      `,
      [
        String(Math.floor(Math.random() * 1000000000000)).padStart(12, "0"),
        arabicFullName,
        englishFullName,
        normalizeArabicName(arabicFullName),
        normalizeArabicNameCompact(arabicFullName),
        `09${String(Math.floor(Math.random() * 100000000)).padStart(8, "0")}`,
        userId,
      ],
    );
    const id = Number(result.rows[0]?.id);
    createdIds.push(id);
    return id;
  };

  try {
    const exactOlder = await insertPatient(`عبدالله ${suffix}`, `Exact Older ${suffix}`);
    const weakNewer = await insertPatient(`مريض عبدالله ${suffix}`, `Weak Newer ${suffix}`);

    assert.ok(weakNewer > exactOlder, "fixture requires weaker match to be newer");

    const directory = await getPatientDirectory({
      search: `عبد الله ${suffix}`,
      sortBy: "recent",
      page: 1,
      pageSize: 25,
    });
    const rankedIds = directory.patients.map((patient) => patient.id);

    assert.ok(rankedIds.indexOf(exactOlder) >= 0);
    assert.ok(rankedIds.indexOf(weakNewer) >= 0);
    assert.ok(rankedIds.indexOf(exactOlder) < rankedIds.indexOf(weakNewer));
  } finally {
    if (createdIds.length > 0) {
      await pool.query(`delete from patients where id = any($1::bigint[])`, [createdIds]).catch(() => undefined);
    }
    await pool.query(`delete from audit_log where changed_by_user_id = $1`, [userId]).catch(() => undefined);
    await pool.query(`delete from users where id = $1`, [userId]).catch(() => undefined);
  }
});

test("patient directory shares canonical identifier, Arabic, ordered, fuzzy, phonetic, and dictionary search semantics", async (t) => {
  if (!(await ensureDbOrSkip(t))) return;

  const suffix = uniqueSuffix();
  const digits = suffix.replace(/\D/g, "");
  const passwordHash = bcrypt.hashSync("test-pass", 10);
  const user = await pool.query<{ id: number }>(
    `
      insert into users (username, full_name, password_hash, role, is_active)
      values ($1, $2, $3, 'receptionist', true)
      returning id
    `,
    [`test_dir_parity_${suffix}`, `Directory Parity Tester ${suffix}`, passwordHash],
  );
  const userId = Number(user.rows[0]?.id);
  const createdIds: number[] = [];
  const dictionaryArabic = `قاموساختبار${digits}`;

  const insertPatient = async (
    arabicFullName: string,
    englishFullName: string,
    identifierValue?: string,
  ): Promise<number> => {
    const nationalId = `${String(Math.floor(Math.random() * 100_000_000_000)).padStart(11, "0")}${createdIds.length}`;
    const result = await pool.query<{ id: number }>(
      `
        insert into patients (
          national_id, identifier_type, identifier_value,
          arabic_full_name, english_full_name, normalized_arabic_name, normalized_arabic_name_compact,
          age_years, estimated_date_of_birth, sex, phone_1, address,
          created_by_user_id, updated_by_user_id
        )
        values ($1, $2, $3, $4, $5, $6, $7, 35, '1991-01-01', 'M', $8, 'city', $9, $9)
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
        `09${String(Math.floor(Math.random() * 100_000_000)).padStart(8, "0")}`,
        userId,
      ],
    );
    const id = Number(result.rows[0]?.id);
    createdIds.push(id);
    return id;
  };

  try {
    const compactArabic = await insertPatient(`عبدالله منصور الفيتوري ${digits}`, `Abdullah Mansour Fitouri ${digits}`);
    const dictionaryExact = await insertPatient(`مريض قاموس مطابق ${digits}`, "Yusuf Abdullah Hussain");
    const dictionaryPhonetic = await insertPatient(`مريض قاموس ${digits}`, "Yousef Abdallah Hussein");
    const exactIdentifier = await insertPatient(`مريض معرف ${digits}`, "Entirely Different Person", "Muhammad Aly Salim");
    const trigramVariant = await insertPatient(`مريض تقارب ${digits}`, "Muhammad Aly Saleem");
    const phoneticVariant = await insertPatient(`مريض صوتي ${digits}`, "Mohamed Ali Salem");
    const orderedTokens = await insertPatient(`مريض مرتب ${digits}`, `Kareem Nader Faraj Saleh ${digits}`);
    const exactMrnName = await insertPatient(`مريض ترتيب ${digits}`, `Nabil Kareem Faraj ${digits}`);
    const fuzzyMrnName = await insertPatient(`مريض ترتيب تقريبي ${digits}`, `Nabeel Karim Faraj ${digits}`);

    await pool.query(`update patients set mrn = $2 where id = $1`, [exactMrnName, `ZZZ-${digits}`]);
    await pool.query(`update patients set mrn = $2 where id = $1`, [fuzzyMrnName, `AAA-${digits}`]);
    await pool.query(
      `insert into name_dictionary (arabic_text, english_text, is_active) values ($1, $2, true)`,
      [dictionaryArabic, "Yusuf Abdullah Hussain"],
    );
    invalidateAllCache();

    const assertDirectoryAndCanonicalRecall = async (query: string, expectedId: number) => {
      const directory = await getPatientDirectory({ search: query, page: 1, pageSize: 100 });
      const canonicalIds = (await searchPatients(query)).map((patient) => Number(patient.id));
      assert.ok(directory.patients.some((patient) => patient.id === expectedId), `directory should recall ${expectedId} for ${query}`);
      assert.ok(canonicalIds.includes(expectedId), `canonical search should recall ${expectedId} for ${query}`);
      return directory;
    };

    await assertDirectoryAndCanonicalRecall("Muhammad Aly Salim", exactIdentifier);
    await assertDirectoryAndCanonicalRecall(`عبد الله منصور الفيتوري ${digits}`, compactArabic);
    const dictionaryDirectory = await assertDirectoryAndCanonicalRecall(dictionaryArabic, dictionaryExact);
    await assertDirectoryAndCanonicalRecall(dictionaryArabic, dictionaryPhonetic);
    const dictionaryIds = dictionaryDirectory.patients.map((patient) => patient.id);
    assert.ok(dictionaryIds.indexOf(dictionaryExact) < dictionaryIds.indexOf(dictionaryPhonetic), "dictionary exact text should outrank phonetic fallback");
    await assertDirectoryAndCanonicalRecall("Muhamad Aly Saleem", trigramVariant);
    await assertDirectoryAndCanonicalRecall("Muhammad Aly Salim", phoneticVariant);
    await assertDirectoryAndCanonicalRecall(`Nader Saleh ${digits}`, orderedTokens);

    const recent = await getPatientDirectory({ search: "Muhammad Aly Salim", sortBy: "recent", page: 1, pageSize: 100 });
    const recentIds = recent.patients.map((patient) => patient.id);
    assert.ok(exactIdentifier < trigramVariant && trigramVariant < phoneticVariant, "fixture requires fuzzy matches to be newer");
    assert.ok(recentIds.indexOf(exactIdentifier) < recentIds.indexOf(trigramVariant), "identifier relevance should outrank recent id");
    assert.ok(recentIds.indexOf(trigramVariant) < recentIds.indexOf(phoneticVariant), "trigram relevance should outrank phonetic fallback");
    assert.equal(recent.pagination.total, recent.patients.length, "the first full page should agree with the fuzzy/phonetic count");
    assert.ok(recent.pagination.total >= 3, "the total should include identifier, trigram, and phonetic matches");
    const paged = await getPatientDirectory({ search: "Muhammad Aly Salim", sortBy: "recent", page: 1, pageSize: 1 });
    assert.equal(paged.pagination.total, recent.pagination.total, "fuzzy/phonetic total should remain accurate with pagination");
    assert.equal(paged.pagination.totalPages, recent.pagination.total);

    const byMrn = await getPatientDirectory({ search: `Nabil Kareem Faraj ${digits}`, sortBy: "mrn", page: 1, pageSize: 100 });
    const mrnIds = byMrn.patients.map((patient) => patient.id);
    assert.ok(mrnIds.includes(exactMrnName));
    assert.ok(mrnIds.includes(fuzzyMrnName));
    assert.ok(mrnIds.indexOf(exactMrnName) < mrnIds.indexOf(fuzzyMrnName), "exact text relevance should outrank MRN order");
  } finally {
    await pool.query(`delete from name_dictionary where arabic_text = $1`, [dictionaryArabic]).catch(() => undefined);
    invalidateAllCache();
    if (createdIds.length > 0) {
      await pool.query(`delete from patient_identifiers where patient_id = any($1::bigint[])`, [createdIds]).catch(() => undefined);
      await pool.query(`delete from patients where id = any($1::bigint[])`, [createdIds]).catch(() => undefined);
    }
    await pool.query(`delete from audit_log where changed_by_user_id = $1`, [userId]).catch(() => undefined);
    await pool.query(`delete from users where id = $1`, [userId]).catch(() => undefined);
  }
});
