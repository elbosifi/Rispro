import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { pool } from "../pool.js";

test("migration 222 adds versioned Teaching validation summaries idempotently", async () => {
  const client = await pool.connect();
  const migrationPath = path.join(path.dirname(fileURLToPath(import.meta.url)), "222_teaching_question_validation_summaries.sql");
  try {
    const columns = await client.query<{ column_name: string; is_nullable: string }>(
      `select column_name, is_nullable from information_schema.columns
       where table_schema = 'teaching' and table_name = 'question_validation_summaries'`,
    );
    const names = new Set(columns.rows.map((row) => row.column_name));
    for (const name of ["question_revision_id", "revision_version", "classification", "errors_json", "warnings_json", "validated_by_identity_subject", "validated_at"]) {
      assert.ok(names.has(name), `missing ${name}`);
    }
    assert.equal(columns.rows.find((row) => row.column_name === "revision_version")?.is_nullable, "NO");

    const index = await client.query<{ indexdef: string }>(
      `select indexdef from pg_indexes where schemaname = 'teaching'
       and indexname = 'teaching_question_validation_classification_idx'`,
    );
    assert.equal(index.rowCount, 1);
    assert.match(index.rows[0]!.indexdef, /\(classification, validated_at DESC\)/i);

    await client.query("begin");
    await client.query(await readFile(migrationPath, "utf8"));
    const repeated = await client.query<{ count: number }>(
      `select count(*)::int as count from information_schema.tables
       where table_schema = 'teaching' and table_name = 'question_validation_summaries'`,
    );
    assert.equal(repeated.rows[0]?.count, 1);
  } finally {
    await client.query("rollback").catch(() => undefined);
    client.release();
  }
});
