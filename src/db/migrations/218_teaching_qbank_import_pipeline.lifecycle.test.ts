import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { pool } from "../pool.js";

test("migration 218 adds Teaching import batches and revision lineage idempotently", async () => {
  const client = await pool.connect();
  const migrationPath = path.join(path.dirname(fileURLToPath(import.meta.url)), "218_teaching_qbank_import_pipeline.sql");
  try {
    const batch = await client.query<{ column_name: string }>(
      `select column_name from information_schema.columns where table_schema = 'teaching' and table_name = 'import_batches'`,
    );
    assert.ok(batch.rows.some((row) => row.column_name === "uploaded_by_identity_subject"));
    assert.ok(batch.rows.some((row) => row.column_name === "validation_summary_json"));
    assert.ok(batch.rows.some((row) => row.column_name === "payload_json"));

    const revision = await client.query<{ column_name: string }>(
      `select column_name from information_schema.columns where table_schema = 'teaching' and table_name = 'question_revisions'`,
    );
    assert.ok(revision.rows.some((row) => row.column_name === "import_batch_id"));

    const indexes = await client.query<{ indexname: string; indexdef: string }>(
      `select indexname, indexdef from pg_indexes where schemaname = 'teaching'
       and indexname = 'teaching_questions_external_id_global_idx'`,
    );
    assert.equal(indexes.rowCount, 1);
    assert.match(indexes.rows[0]!.indexdef, /UNIQUE.*\(external_id\)/i);

    const constraints = await client.query<{ definition: string }>(
      `select pg_get_constraintdef(item.oid) as definition from pg_constraint item
       join pg_class relation on relation.oid = item.conrelid
       join pg_namespace namespace on namespace.oid = relation.relnamespace
       where namespace.nspname = 'teaching' and relation.relname = 'import_batches' and item.contype = 'c'`,
    );
    assert.ok(constraints.rows.some((row) => row.definition.includes("'confirmed'")));
    assert.ok(constraints.rows.some((row) => row.definition.includes("'expired'")));

    const sourceTitle = await client.query<{ is_nullable: string }>(
      `select is_nullable from information_schema.columns where table_schema = 'teaching' and table_name = 'sources' and column_name = 'title'`,
    );
    assert.equal(sourceTitle.rows[0]?.is_nullable, "YES");

    await client.query("begin");
    await client.query(await readFile(migrationPath, "utf8"));
    const repeated = await client.query<{ count: number }>(
      `select count(*)::int as count from information_schema.tables where table_schema = 'teaching' and table_name = 'import_batches'`,
    );
    assert.equal(repeated.rows[0]?.count, 1);
  } finally {
    await client.query("rollback").catch(() => undefined);
    client.release();
  }
});
