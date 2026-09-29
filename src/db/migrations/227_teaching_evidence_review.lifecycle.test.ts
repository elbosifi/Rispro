import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { pool } from "../pool.js";

test("migration 227 adds immutable-by-default Teaching evidence review fields", async () => {
  const client = await pool.connect();
  const migrationPath = path.join(path.dirname(fileURLToPath(import.meta.url)), "227_teaching_evidence_review.sql");
  try {
    const columns = await client.query<{ column_name: string; is_nullable: string; column_default: string | null }>(
      `select column_name, is_nullable, column_default from information_schema.columns
       where table_schema = 'teaching' and table_name = 'question_revisions'
         and column_name in ('evidence_status', 'evidence_checked_at', 'evidence_summary', 'evidence_update')`,
    );
    const byName = new Map(columns.rows.map((row) => [row.column_name, row]));
    assert.equal(byName.get("evidence_status")?.is_nullable, "NO");
    assert.match(byName.get("evidence_status")?.column_default ?? "", /not_verified/);
    assert.equal(byName.get("evidence_summary")?.is_nullable, "NO");
    assert.equal(byName.get("evidence_checked_at")?.is_nullable, "YES");
    assert.equal(byName.get("evidence_update")?.is_nullable, "YES");
    const constraints = await client.query<{ definition: string }>(
      `select pg_get_constraintdef(oid) as definition from pg_constraint
       where conrelid = 'teaching.question_revisions'::regclass and conname = 'teaching_question_revisions_evidence_status_check'`,
    );
    assert.match(constraints.rows[0]?.definition ?? "", /confirmed.*updated.*uncertain.*not_verified/i);
    await client.query("begin");
    await client.query(await readFile(migrationPath, "utf8"));
  } finally {
    await client.query("rollback").catch(() => undefined);
    client.release();
  }
});
