import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import bcrypt from "bcryptjs";
import { pool } from "../db/pool.js";
import { HttpError } from "../utils/http-error.js";
import { exportCatalogWorkbook, importCatalogWorkbook } from "./settings-catalog-import-export-service.js";

async function ensureDbOrSkip(t: { skip: (message?: string) => void }): Promise<boolean> {
  try {
    await pool.query("select 1");
    return true;
  } catch {
    t.skip("PostgreSQL is not reachable at configured DATABASE_URL.");
    return false;
  }
}

async function ensureCatalogSchema(): Promise<void> {
  const sql = await readFile(
    "/Users/serajalsaifi/Nextcloud/RISpro/src/db/migrations/042_exam_type_codes_and_durations.sql",
    "utf8"
  );
  await pool.query(sql);
}

function uniqueSuffix(): string {
  return `${Date.now()}_${Math.floor(Math.random() * 100000)}`;
}

async function createSupervisorUser(suffix: string): Promise<number> {
  const passwordHash = bcrypt.hashSync("test-pass", 10);
  const result = await pool.query<{ id: number }>(
    `
      insert into users (username, full_name, password_hash, role, is_active)
      values ($1, $2, $3, 'supervisor', true)
      returning id
    `,
    [`catalog_super_${suffix}`, `Catalog Supervisor ${suffix}`, passwordHash]
  );
  return Number(result.rows[0]?.id);
}

async function cleanupUser(userId: number): Promise<void> {
  await pool.query(`delete from audit_log where changed_by_user_id = $1`, [userId]).catch(() => undefined);
  await pool.query(`delete from users where id = $1`, [userId]).catch(() => undefined);
}

async function cleanupCatalog(prefix: string): Promise<void> {
  await pool.query(`delete from exam_types where code like $1`, [`${prefix}%`]).catch(() => undefined);
  await pool.query(`delete from modalities where code like $1`, [`${prefix}%`]).catch(() => undefined);
}

async function buildWorkbookBase64(input: {
  modalities: Array<Record<string, unknown>>;
  examTypes: Array<Record<string, unknown>>;
}): Promise<string> {
  const XLSX = await import("xlsx");
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(
    workbook,
    XLSX.utils.json_to_sheet(input.modalities, {
      header: ["code", "name_en", "name_ar", "description_en", "description_ar", "daily_capacity", "active", "safety_warning_enabled", "safety_warning_en", "safety_warning_ar"]
    }),
    "Modalities"
  );
  XLSX.utils.book_append_sheet(
    workbook,
    XLSX.utils.json_to_sheet(input.examTypes, {
      header: ["modality_code", "code", "name_en", "name_ar", "description_en", "description_ar", "duration_minutes", "active"]
    }),
    "ExamTypes"
  );
  const buffer = XLSX.write(workbook, { type: "buffer", bookType: "xlsx" }) as Buffer;
  return buffer.toString("base64");
}

function baseModalityRow(code: string, overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    code,
    name_en: `${code} EN`,
    name_ar: `${code} AR`,
    description_en: `${code} description en`,
    description_ar: `${code} description ar`,
    daily_capacity: 7,
    active: true,
    safety_warning_enabled: true,
    safety_warning_en: `${code} safety en`,
    safety_warning_ar: `${code} safety ar`,
    ...overrides
  };
}

function baseExamTypeRow(modalityCode: string, code: string, overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    modality_code: modalityCode,
    code,
    name_en: `${code} EN`,
    name_ar: `${code} AR`,
    description_en: `${code} description en`,
    description_ar: `${code} description ar`,
    duration_minutes: 25,
    active: true,
    ...overrides
  };
}

test("catalog export workbook generation includes both sheets and current rows", async (t) => {
  if (!(await ensureDbOrSkip(t))) return;
  await ensureCatalogSchema();

  const suffix = uniqueSuffix();
  const modalityCode = `CATEXP_${suffix}`;
  const examCode = `HEAD_${suffix}`;
  const inactiveExamCode = `OLD_${suffix}`;

  try {
    const modalityInsert = await pool.query<{ id: number }>(
      `
        insert into modalities (
          code, name_ar, name_en, daily_capacity, general_instruction_ar, general_instruction_en, is_active
        )
        values ($1, $2, $3, 9, 'ar note', 'en note', true)
        returning id
      `,
      [modalityCode, `AR ${suffix}`, `EN ${suffix}`]
    );
    const modalityId = Number(modalityInsert.rows[0]?.id);

    await pool.query(
      `
        insert into exam_types (
          modality_id, code, name_ar, name_en, specific_instruction_ar, specific_instruction_en, duration_minutes, is_active
        )
        values ($1, $2, $3, $4, 'scan ar', 'scan en', 30, true)
      `,
      [modalityId, examCode, `Exam AR ${suffix}`, `Exam EN ${suffix}`]
    );
    await pool.query(
      `
        insert into exam_types (
          modality_id, code, name_ar, name_en, specific_instruction_ar, specific_instruction_en, duration_minutes, is_active
        )
        values ($1, $2, $3, $4, 'old ar', 'old en', 15, false)
      `,
      [modalityId, inactiveExamCode, `Old Exam AR ${suffix}`, `Old Exam EN ${suffix}`]
    );

    const { buffer } = await exportCatalogWorkbook();
    const XLSX = await import("xlsx");
    const workbook = XLSX.read(buffer, { type: "buffer" });

    assert.ok(workbook.SheetNames.includes("Modalities"));
    assert.ok(workbook.SheetNames.includes("ExamTypes"));

    const modalityRows = XLSX.utils.sheet_to_json<Record<string, unknown>>(workbook.Sheets["Modalities"], { defval: "" });
    const examRows = XLSX.utils.sheet_to_json<Record<string, unknown>>(workbook.Sheets["ExamTypes"], { defval: "" });

    assert.ok(modalityRows.some((row) => row.code === modalityCode));
    assert.ok(examRows.some((row) => row.code === examCode && row.modality_code === modalityCode));
    assert.ok(!examRows.some((row) => row.code === inactiveExamCode), "Inactive exam types should not be exported");
  } finally {
    await cleanupCatalog("CATEXP_");
  }
});

test("catalog import fails when required sheets are missing", async (t) => {
  if (!(await ensureDbOrSkip(t))) return;
  await ensureCatalogSchema();

  const XLSX = await import("xlsx");
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet([baseModalityRow("ONLY_SHEET")]), "Modalities");
  const base64 = (XLSX.write(workbook, { type: "buffer", bookType: "xlsx" }) as Buffer).toString("base64");

  await assert.rejects(
    () => importCatalogWorkbook(base64, 1),
    (error: unknown) => {
      assert.ok(error instanceof HttpError);
      assert.equal(error.statusCode, 400);
      assert.match(error.message, /missing required sheets/i);
      return true;
    }
  );
});

test("catalog import fails when required columns are missing", async (t) => {
  if (!(await ensureDbOrSkip(t))) return;
  await ensureCatalogSchema();

  const base64 = await buildWorkbookBase64({
    modalities: [{ code: "MISS_COL", name_en: "Missing Arabic", active: true }],
    examTypes: [baseExamTypeRow("MISS_COL", "EXAM_ONE")]
  });

  await assert.rejects(
    () => importCatalogWorkbook(base64, 1),
    (error: unknown) => {
      assert.ok(error instanceof HttpError);
      assert.equal(error.statusCode, 400);
      const details = error.details as { errors?: Array<{ column?: string }> } | null;
      assert.ok(details?.errors?.some((item) => item.column === "name_ar"));
      return true;
    }
  );
});

test("catalog import fails on duplicate modality codes in workbook", async (t) => {
  if (!(await ensureDbOrSkip(t))) return;
  await ensureCatalogSchema();

  const base64 = await buildWorkbookBase64({
    modalities: [baseModalityRow("DUP_MOD"), baseModalityRow("DUP_MOD", { name_en: "Changed" })],
    examTypes: []
  });

  await assert.rejects(
    () => importCatalogWorkbook(base64, 1),
    (error: unknown) => {
      assert.ok(error instanceof HttpError);
      const details = error.details as { errors?: Array<{ message?: string }> } | null;
      assert.ok(details?.errors?.some((item) => String(item.message || "").includes("Duplicate modality code")));
      return true;
    }
  );
});

test("catalog import fails on duplicate exam type keys within a modality", async (t) => {
  if (!(await ensureDbOrSkip(t))) return;
  await ensureCatalogSchema();

  const base64 = await buildWorkbookBase64({
    modalities: [baseModalityRow("DUP_EXAM_MOD")],
    examTypes: [baseExamTypeRow("DUP_EXAM_MOD", "XRAY"), baseExamTypeRow("DUP_EXAM_MOD", "XRAY", { name_en: "XRAY copy" })]
  });

  await assert.rejects(
    () => importCatalogWorkbook(base64, 1),
    (error: unknown) => {
      assert.ok(error instanceof HttpError);
      const details = error.details as { errors?: Array<{ message?: string }> } | null;
      assert.ok(details?.errors?.some((item) => String(item.message || "").includes("Duplicate exam type code")));
      return true;
    }
  );
});

test("catalog import fails on invalid modality references in exam types", async (t) => {
  if (!(await ensureDbOrSkip(t))) return;
  await ensureCatalogSchema();

  const base64 = await buildWorkbookBase64({
    modalities: [baseModalityRow("KNOWN_MOD_REF")],
    examTypes: [baseExamTypeRow("UNKNOWN_MOD_REF", "ET_ONE")]
  });

  await assert.rejects(
    () => importCatalogWorkbook(base64, 1),
    (error: unknown) => {
      assert.ok(error instanceof HttpError);
      const details = error.details as { errors?: Array<{ column?: string; message?: string }> } | null;
      assert.ok(details?.errors?.some((item) => item.column === "modality_code" && String(item.message || "").includes("Unknown modality_code")));
      return true;
    }
  );
});

test("catalog import creates new modality and exam type from workbook", async (t) => {
  if (!(await ensureDbOrSkip(t))) return;
  await ensureCatalogSchema();

  const suffix = uniqueSuffix();
  const prefix = `CATNEW_${suffix}`;
  const userId = await createSupervisorUser(suffix);

  try {
    const base64 = await buildWorkbookBase64({
      modalities: [baseModalityRow(`${prefix}_MOD`, { daily_capacity: 11 })],
      examTypes: [baseExamTypeRow(`${prefix}_MOD`, `${prefix}_EXAM`, { duration_minutes: 40 })]
    });

    const summary = await importCatalogWorkbook(base64, userId);
    assert.equal(summary.modalitiesCreated, 1);
    assert.equal(summary.examTypesCreated, 1);

    const modality = await pool.query<{ code: string; daily_capacity: number }>(
      `select code, daily_capacity from modalities where code = $1 limit 1`,
      [`${prefix}_MOD`]
    );
    assert.equal(modality.rows[0]?.code, `${prefix}_MOD`);
    assert.equal(Number(modality.rows[0]?.daily_capacity), 11);

    const exam = await pool.query<{ code: string; duration_minutes: number | null }>(
      `
        select et.code, et.duration_minutes
        from exam_types et
        join modalities m on m.id = et.modality_id
        where m.code = $1 and et.code = $2
        limit 1
      `,
      [`${prefix}_MOD`, `${prefix}_EXAM`]
    );
    assert.equal(exam.rows[0]?.code, `${prefix}_EXAM`);
    assert.equal(Number(exam.rows[0]?.duration_minutes), 40);
  } finally {
    await cleanupCatalog(`CATNEW_${suffix}`);
    await cleanupUser(userId);
  }
});

test("catalog import updates existing modality and exam type from workbook", async (t) => {
  if (!(await ensureDbOrSkip(t))) return;
  await ensureCatalogSchema();

  const suffix = uniqueSuffix();
  const prefix = `CATUPD_${suffix}`;
  const userId = await createSupervisorUser(suffix);

  try {
    const modalityInsert = await pool.query<{ id: number }>(
      `
        insert into modalities (
          code, name_ar, name_en, daily_capacity, general_instruction_ar, general_instruction_en, is_active
        )
        values ($1, 'old ar', 'old en', 3, 'old ar desc', 'old en desc', true)
        returning id
      `,
      [`${prefix}_MOD`]
    );
    const modalityId = Number(modalityInsert.rows[0]?.id);

    await pool.query(
      `
        insert into exam_types (
          modality_id, code, name_ar, name_en, specific_instruction_ar, specific_instruction_en, duration_minutes, is_active
        )
        values ($1, $2, 'old exam ar', 'old exam en', 'old inst ar', 'old inst en', 15, true)
      `,
      [modalityId, `${prefix}_EXAM`]
    );

    const base64 = await buildWorkbookBase64({
      modalities: [
        baseModalityRow(`${prefix}_MOD`, {
          name_en: "updated modality en",
          name_ar: "updated modality ar",
          description_en: "updated desc en",
          description_ar: "updated desc ar",
          daily_capacity: 13,
          active: false
        })
      ],
      examTypes: [
        baseExamTypeRow(`${prefix}_MOD`, `${prefix}_EXAM`, {
          name_en: "updated exam en",
          name_ar: "updated exam ar",
          description_en: "updated exam desc en",
          description_ar: "updated exam desc ar",
          duration_minutes: 55,
          active: false
        })
      ]
    });

    const summary = await importCatalogWorkbook(base64, userId);
    assert.equal(summary.modalitiesUpdated, 1);
    assert.equal(summary.examTypesUpdated, 1);

    const modality = await pool.query<{ name_en: string; daily_capacity: number; is_active: boolean }>(
      `select name_en, daily_capacity, is_active from modalities where code = $1 limit 1`,
      [`${prefix}_MOD`]
    );
    assert.equal(modality.rows[0]?.name_en, "updated modality en");
    assert.equal(Number(modality.rows[0]?.daily_capacity), 13);
    assert.equal(modality.rows[0]?.is_active, false);

    const exam = await pool.query<{ name_en: string; duration_minutes: number | null; is_active: boolean }>(
      `
        select et.name_en, et.duration_minutes, et.is_active
        from exam_types et
        join modalities m on m.id = et.modality_id
        where m.code = $1 and et.code = $2
        limit 1
      `,
      [`${prefix}_MOD`, `${prefix}_EXAM`]
    );
    assert.equal(exam.rows[0]?.name_en, "updated exam en");
    assert.equal(Number(exam.rows[0]?.duration_minutes), 55);
    assert.equal(exam.rows[0]?.is_active, false);
  } finally {
    await cleanupCatalog(`CATUPD_${suffix}`);
    await cleanupUser(userId);
  }
});

test("catalog import rolls back all writes on validation failure", async (t) => {
  if (!(await ensureDbOrSkip(t))) return;
  await ensureCatalogSchema();

  const suffix = uniqueSuffix();
  const prefix = `CATRB_${suffix}`;
  const userId = await createSupervisorUser(suffix);

  try {
    const base64 = await buildWorkbookBase64({
      modalities: [baseModalityRow(`${prefix}_MOD`)],
      examTypes: [baseExamTypeRow(`${prefix}_UNKNOWN`, `${prefix}_EXAM`)]
    });

    await assert.rejects(() => importCatalogWorkbook(base64, userId), HttpError);

    const modality = await pool.query<{ count: string }>(
      `select count(*)::text as count from modalities where code = $1`,
      [`${prefix}_MOD`]
    );
    const exam = await pool.query<{ count: string }>(
      `select count(*)::text as count from exam_types where code = $1`,
      [`${prefix}_EXAM`]
    );

    assert.equal(Number(modality.rows[0]?.count || 0), 0);
    assert.equal(Number(exam.rows[0]?.count || 0), 0);
  } finally {
    await cleanupCatalog(`CATRB_${suffix}`);
    await cleanupUser(userId);
  }
});
