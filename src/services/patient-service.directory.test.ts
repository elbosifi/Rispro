import test from "node:test";
import assert from "node:assert/strict";
import bcrypt from "bcryptjs";
import { pool } from "../db/pool.js";
import { getPatientDirectory } from "./patient-service.js";
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
        `${sex === "M" ? "Male" : "Female"} Arabic ${seed}`,
        `${sex === "M" ? "Male" : "Female"} English ${seed}`,
        `${sex === "M" ? "Male" : "Female"} Arabic ${seed}`,
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
    const maleDirectory = await getPatientDirectory({ sex: "male", page: 1, pageSize: 25 });
    assert.equal(maleDirectory.patients.length, 1);
    assert.equal(maleDirectory.patients[0]?.id, maleId);

    const femaleDirectory = await getPatientDirectory({ sex: "female", page: 1, pageSize: 25 });
    assert.equal(femaleDirectory.patients.length, 1);
    assert.equal(femaleDirectory.patients[0]?.id, femaleId);
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
