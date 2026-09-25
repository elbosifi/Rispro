import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { pool } from "../pool.js";

test("migration 219 adds Teaching revision versions and tag-filter index idempotently", async () => {
  const client = await pool.connect();
  const migrationPath = path.join(path.dirname(fileURLToPath(import.meta.url)), "219_teaching_editorial_concurrency.sql");
  try {
    const column = await client.query<{ column_name: string; column_default: string; is_nullable: string }>(
      `select column_name, column_default, is_nullable from information_schema.columns
       where table_schema = 'teaching' and table_name = 'question_revisions' and column_name = 'version'`,
    );
    assert.equal(column.rowCount, 1);
    assert.equal(column.rows[0]?.is_nullable, "NO");
    assert.match(column.rows[0]?.column_default ?? "", /1/);

    const assetAltText = await client.query<{ is_nullable: string; column_default: string }>(
      `select is_nullable, column_default from information_schema.columns where table_schema = 'teaching'
       and table_name = 'question_revision_assets' and column_name = 'alt_text'`,
    );
    assert.equal(assetAltText.rowCount, 1);
    assert.equal(assetAltText.rows[0]?.is_nullable, "NO");

    const index = await client.query<{ indexdef: string }>(
      `select indexdef from pg_indexes where schemaname = 'teaching'
       and indexname = 'teaching_question_revision_tags_tag_revision_idx'`,
    );
    assert.equal(index.rowCount, 1);
    assert.match(index.rows[0]!.indexdef, /\(tag_id, question_revision_id\)/);

    await client.query("begin");
    await client.query(await readFile(migrationPath, "utf8"));
    const repeated = await client.query<{ count: number }>(
      `select count(*)::int as count from information_schema.columns where table_schema = 'teaching'
       and table_name = 'question_revisions' and column_name = 'version'`,
    );
    assert.equal(repeated.rows[0]?.count, 1);
  } finally {
    await client.query("rollback").catch(() => undefined);
    client.release();
  }
});
