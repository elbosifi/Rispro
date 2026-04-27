import test from "node:test";
import assert from "node:assert/strict";
import bcrypt from "bcryptjs";
import { pool } from "../db/pool.js";
import { HttpError } from "../utils/http-error.js";
import { createExamType, deleteExamType, updateExamType } from "./catalog-service.js";

async function ensureDbOrSkip(t: { skip: (message?: string) => void }): Promise<boolean> {
  try {
    await pool.query("select 1");
    return true;
  } catch {
    t.skip("PostgreSQL is not reachable at configured DATABASE_URL.");
    return false;
  }
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
    [`catalog_exam_super_${suffix}`, `Catalog Exam Supervisor ${suffix}`, passwordHash]
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

async function createModalityForTest(code: string): Promise<number> {
  const result = await pool.query<{ id: number }>(
    `
      insert into modalities (
        code,
        name_ar,
        name_en,
        daily_capacity,
        general_instruction_ar,
        general_instruction_en,
        is_active
      )
      values ($1, $2, $3, 5, 'test ar', 'test en', true)
      returning id
    `,
    [code, `${code} AR`, `${code} EN`]
  );
  return Number(result.rows[0]?.id);
}

test("catalog exam type update reactivates an inactive exam type and keeps 404 for missing rows", async (t) => {
  if (!(await ensureDbOrSkip(t))) return;

  const suffix = uniqueSuffix();
  const prefix = `REACT_${suffix}`;
  const userId = await createSupervisorUser(suffix);

  try {
    const modalityId = await createModalityForTest(`${prefix}_MOD`);

    const created = await createExamType(
      {
        modalityId,
        code: `${prefix}_EXAM`,
        nameAr: `${prefix} exam ar`,
        nameEn: `${prefix} exam en`,
        specificInstructionAr: "initial ar",
        specificInstructionEn: "initial en",
        durationMinutes: 20
      },
      userId
    );
    assert.equal(created.is_active, true);

    const deactivated = await deleteExamType(created.id, userId);
    assert.equal(deactivated.is_active, false);

    const reactivated = await updateExamType(
      created.id,
      {
        modalityId,
        code: `${prefix}_EXAM`,
        nameAr: `${prefix} exam ar updated`,
        nameEn: `${prefix} exam en updated`,
        specificInstructionAr: "reactivated ar",
        specificInstructionEn: "reactivated en",
        durationMinutes: 45
      },
      userId
    );

    assert.equal(reactivated.id, created.id);
    assert.equal(reactivated.is_active, true);
    assert.equal(reactivated.name_en, `${prefix} exam en updated`);
    assert.equal(reactivated.duration_minutes, 45);

    const persisted = await pool.query<{ is_active: boolean }>(
      `select is_active from exam_types where id = $1 limit 1`,
      [created.id]
    );
    assert.equal(persisted.rows[0]?.is_active, true);

    const audit = await pool.query<{ action_type: string; old_values: { is_active?: boolean } | null; new_values: { is_active?: boolean } | null }>(
      `
        select action_type, old_values, new_values
        from audit_log
        where entity_type = 'exam_type'
          and entity_id = $1
          and changed_by_user_id = $2
        order by id desc
        limit 1
      `,
      [created.id, userId]
    );
    assert.equal(audit.rows[0]?.action_type, "update");
    assert.equal(audit.rows[0]?.old_values?.is_active, false);
    assert.equal(audit.rows[0]?.new_values?.is_active, true);

    await assert.rejects(
      () =>
        updateExamType(
          999999999,
          {
            modalityId,
            code: `${prefix}_MISSING`,
            nameAr: "missing ar",
            nameEn: "missing en",
            durationMinutes: 10
          },
          userId
        ),
      (error: unknown) => {
        assert.ok(error instanceof HttpError);
        assert.equal(error.statusCode, 404);
        assert.equal(error.message, "Exam type not found.");
        return true;
      }
    );
  } finally {
    await cleanupCatalog(prefix);
    await cleanupUser(userId);
  }
});
