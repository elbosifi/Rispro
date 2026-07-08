import test from "node:test";
import assert from "node:assert/strict";
import bcrypt from "bcryptjs";
import { pool } from "../db/pool.js";
import {
  createImportBatchFromParsedRows,
  listImportBatch,
  listImportRows,
  confirmBatchMigration
} from "./patient-import-service.js";

function uniqueSuffix(): string {
  return `${Date.now()}_${Math.floor(Math.random() * 100000)}`;
}

function uniqueNationalId(prefixDigit: string): string {
  const year = 1980 + Math.floor(Math.random() * 30);
  const tail = Math.floor(Math.random() * 10000000).toString().padStart(7, "0");
  return `${prefixDigit}${year}${tail}`;
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

async function seedImportTestDictionary(): Promise<void> {
  await pool.query(
    `
      insert into name_dictionary (arabic_text, english_text, is_active)
      values
        ('محمد', 'Mohamed', true),
        ('علي', 'Ali', true),
        ('مكرر', 'Duplicate', true),
        ('مريض', 'Patient', true),
        ('ترحيل', 'Migration', true),
        ('سباق', 'Race', true)
      on conflict (arabic_text)
      do update set english_text = excluded.english_text, is_active = true
    `
  );
}

test("patient import staging: creates valid/invalid/duplicate rows and derives demographics", async (t) => {
  if (!(await ensureDbOrSkip(t))) return;

  const suffix = uniqueSuffix();
  const passwordHash = bcrypt.hashSync("test-pass", 10);
  const userRes = await pool.query<{ id: number }>(
    `
      insert into users (username, full_name, password_hash, role, is_active)
      values ($1, $2, $3, 'supervisor', true)
      returning id
    `,
    [`imp_super_${suffix}`, `Import Supervisor ${suffix}`, passwordHash]
  );
  const userId = Number(userRes.rows[0]?.id);

  const duplicateNationalId = uniqueNationalId("1");
  const freshNationalId = uniqueNationalId("2");

  await seedImportTestDictionary();

  const duplicatePatientRes = await pool.query<{ id: number }>(
    `
      insert into patients (
        national_id,
        identifier_type,
        identifier_value,
        arabic_full_name,
        english_full_name,
        normalized_arabic_name,
        age_years,
        estimated_date_of_birth,
        sex,
        phone_1,
        address,
        created_by_user_id,
        updated_by_user_id
      )
      values ($1, 'national_id', $2, $3, $4, $5, 30, '1996-01-01', 'M', '0912345678', 'city', $6, $6)
      returning id
    `,
    [duplicateNationalId, duplicateNationalId, `مريض مكرر ${suffix}`, `Duplicate ${suffix}`, `مريض${suffix}`, userId]
  );
  const duplicatePatientId = Number(duplicatePatientRes.rows[0]?.id);

  let batchId = 0;

  try {
    const result = await createImportBatchFromParsedRows(
      {
        sourceFilename: `import-${suffix}.xlsx`,
        sourceSheetName: "Sheet1",
        patientCategory: "non_oncology",
        mapping: {
          arabic_full_name: "Arabic Name",
          national_id: "National ID",
          phone: "Phone"
        },
        rows: [
          {
            rowNumber: 2,
            values: {
              "Arabic Name": "محمد علي",
              "National ID": freshNationalId,
              "Phone": "0911111111"
            }
          },
          {
            rowNumber: 3,
            values: {
              "Arabic Name": "غير صالح",
              "National ID": "123",
              "Phone": "0911111111"
            }
          },
          {
            rowNumber: 4,
            values: {
              "Arabic Name": "مكرر",
              "National ID": duplicateNationalId,
              "Phone": "0912222222"
            }
          }
        ]
      },
      userId
    );

    batchId = Number(result.batch.id);

    const batch = await listImportBatch(batchId);
    assert.equal(Number(batch.total_rows), 3);
    assert.equal(Number(batch.valid_rows), 1);
    assert.equal(Number(batch.invalid_rows), 1);
    assert.equal(Number(batch.duplicate_rows), 1);
    assert.equal(batch.patient_category, "non_oncology");

    const rows = await listImportRows(batchId);
    assert.equal(rows.length, 3);

    const validRow = rows.find((row) => row.row_number === 2);
    assert.ok(validRow);
    assert.equal(validRow?.validation_status, "valid");
    assert.equal(validRow?.national_id, freshNationalId);
    assert.equal(validRow?.derived_sex, "F");
    assert.equal(validRow?.derived_birth_date, `${freshNationalId.slice(1, 5)}-01-01`);
    assert.equal(typeof validRow?.english_full_name, "string");

    const invalidRow = rows.find((row) => row.row_number === 3);
    assert.ok(invalidRow);
    assert.equal(invalidRow?.validation_status, "invalid");

    const duplicateRow = rows.find((row) => row.row_number === 4);
    assert.ok(duplicateRow);
    assert.equal(duplicateRow?.validation_status, "duplicate");
    assert.equal(Number(duplicateRow?.matched_existing_patient_id), duplicatePatientId);
  } finally {
    if (batchId > 0) {
      await pool.query(`delete from patient_import_staging_rows where batch_id = $1`, [batchId]);
      await pool.query(`delete from patient_import_batches where id = $1`, [batchId]);
    }
    await pool.query(`delete from patient_identifiers where patient_id = $1`, [duplicatePatientId]).catch(() => undefined);
    await pool.query(`delete from patients where id = $1`, [duplicatePatientId]).catch(() => undefined);
    await pool.query(`delete from audit_log where changed_by_user_id = $1`, [userId]).catch(() => undefined);
    await pool.query(`delete from users where id = $1`, [userId]).catch(() => undefined);
  }
});

test("patient import confirm: migrates selected valid rows and skips race duplicates", async (t) => {
  if (!(await ensureDbOrSkip(t))) return;

  const suffix = uniqueSuffix();
  const passwordHash = bcrypt.hashSync("test-pass", 10);
  const userRes = await pool.query<{ id: number }>(
    `
      insert into users (username, full_name, password_hash, role, is_active)
      values ($1, $2, $3, 'supervisor', true)
      returning id
    `,
    [`imp_super2_${suffix}`, `Import Supervisor 2 ${suffix}`, passwordHash]
  );
  const userId = Number(userRes.rows[0]?.id);

  const migrateNationalId = uniqueNationalId("1");
  const raceNationalId = uniqueNationalId("2");

  let batchId = 0;
  let racePatientId = 0;

  try {
    await seedImportTestDictionary();

    const staged = await createImportBatchFromParsedRows(
      {
        sourceFilename: `import-confirm-${suffix}.xlsx`,
        sourceSheetName: "Sheet1",
        patientCategory: "oncology",
        mapping: {
          arabic_full_name: "Arabic Name",
          national_id: "National ID",
          phone: "Phone"
        },
        rows: [
          {
            rowNumber: 2,
            values: {
              "Arabic Name": "مريض ترحيل",
              "National ID": migrateNationalId,
              "Phone": "0913333333"
            }
          },
          {
            rowNumber: 3,
            values: {
              "Arabic Name": "مريض سباق",
              "National ID": raceNationalId,
              "Phone": "0914444444"
            }
          }
        ]
      },
      userId
    );

    batchId = Number(staged.batch.id);

    const raceInsert = await pool.query<{ id: number }>(
      `
        insert into patients (
          national_id,
          identifier_type,
          identifier_value,
          arabic_full_name,
          english_full_name,
          normalized_arabic_name,
          age_years,
          estimated_date_of_birth,
          sex,
          phone_1,
          address,
          created_by_user_id,
          updated_by_user_id
        )
        values ($1, 'national_id', $2, $3, $4, $5, 30, '1996-01-01', 'M', '0919999999', 'city', $6, $6)
        returning id
      `,
      [raceNationalId, raceNationalId, `Race Patient ${suffix}`, `Race ${suffix}`, `race${suffix}`, userId]
    );
    racePatientId = Number(raceInsert.rows[0]?.id);

    const result = await confirmBatchMigration(batchId, userId);
    assert.equal(result.migrated, 1);
    assert.equal(result.skipped, 1);

    const migratedPatient = await pool.query<{ id: number; category: string | null }>(
      `select id, category from patients where national_id = $1 limit 1`,
      [migrateNationalId]
    );
    assert.ok(migratedPatient.rows[0]?.id);
    assert.equal(migratedPatient.rows[0]?.category, "oncology");

    const rows = await listImportRows(batchId);
    const migratedRow = rows.find((row) => row.national_id === migrateNationalId);
    const skippedRow = rows.find((row) => row.national_id === raceNationalId);

    assert.equal(migratedRow?.validation_status, "migrated");
    assert.ok(migratedRow?.migrated_patient_id);

    assert.equal(skippedRow?.validation_status, "skipped");
    assert.equal(skippedRow?.validation_message, "already_exists_at_migration_time");

    const batch = await listImportBatch(batchId);
    assert.equal(batch.status, "migrated");
    assert.equal(Number(batch.migrated_rows), 1);
    assert.equal(batch.patient_category, "oncology");
  } finally {
    if (batchId > 0) {
      const rows = await listImportRows(batchId).catch(() => []);
      const migratedIds = rows
        .map((row) => Number(row.migrated_patient_id || 0))
        .filter((id) => Number.isInteger(id) && id > 0);
      if (migratedIds.length > 0) {
        await pool.query(`delete from patient_identifiers where patient_id = any($1::bigint[])`, [migratedIds]).catch(() => undefined);
        await pool.query(`delete from patients where id = any($1::bigint[])`, [migratedIds]).catch(() => undefined);
      }
      await pool.query(`delete from patient_import_staging_rows where batch_id = $1`, [batchId]).catch(() => undefined);
      await pool.query(`delete from patient_import_batches where id = $1`, [batchId]).catch(() => undefined);
    }

    if (racePatientId > 0) {
      await pool.query(`delete from patient_identifiers where patient_id = $1`, [racePatientId]).catch(() => undefined);
      await pool.query(`delete from patients where id = $1`, [racePatientId]).catch(() => undefined);
    }

    await pool.query(`delete from audit_log where changed_by_user_id = $1`, [userId]).catch(() => undefined);
    await pool.query(`delete from users where id = $1`, [userId]).catch(() => undefined);
  }
});
