import test from "node:test";
import assert from "node:assert/strict";
import bcrypt from "bcryptjs";
import { pool } from "../db/pool.js";
import { getPatientDirectory } from "./patient-service.js";

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
        `${sex}${suffix}${seed}`,
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
