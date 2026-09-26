import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { fileURLToPath } from "node:url";

test("migration 221 creates isolated Teaching study-cycle history idempotently", async (t) => {
  const [{ pool }, migrationSql] = await Promise.all([
    import("../pool.js"),
    readFile(fileURLToPath(new URL("./221_teaching_study_cycles_analytics.sql", import.meta.url)), "utf8"),
  ]);

  try {
    await pool.query("select 1 from schema_migrations where filename = '221_teaching_study_cycles_analytics.sql'");
  } catch {
    t.skip("The disposable PostgreSQL database has not run migration 221 yet.");
    return;
  }

  const client = await pool.connect();
  try {
    await client.query("begin");
    await client.query(migrationSql);
    await client.query(migrationSql);

    const columns = await client.query<{ column_name: string; is_nullable: string }>(
      `select column_name, is_nullable from information_schema.columns
       where table_schema = 'teaching' and table_name = 'study_cycles' order by ordinal_position`,
    );
    assert.ok(columns.rows.some((row) => row.column_name === "scope_type" && row.is_nullable === "NO"));
    assert.ok(columns.rows.some((row) => row.column_name === "started_at" && row.is_nullable === "NO"));
    assert.ok(columns.rows.some((row) => row.column_name === "ended_at" && row.is_nullable === "YES"));
    assert.ok(columns.rows.some((row) => row.column_name === "eligible_question_count"));
    const indexes = await client.query<{ indexname: string }>(
      `select indexname from pg_indexes where schemaname = 'teaching' and indexname = any($1::text[]) order by indexname`,
      [["teaching_study_cycles_active_scope_idx", "teaching_study_cycles_request_key_idx", "teaching_study_cycles_event_scope_idx", "teaching_study_cycles_sequence_idx", "teaching_study_cycles_scope_history_idx"]],
    );
    assert.equal(indexes.rowCount, 5);

    const publicTable = await client.query("select 1 from information_schema.tables where table_schema = 'public' and table_name = 'study_cycles'");
    assert.equal(publicTable.rowCount, 0);
    const sql = migrationSql.toLowerCase();
    assert.doesNotMatch(sql, /\b(public\.)?(patients|appointments|bookings|reports|documents|studies|dicom_devices)\b/);

    await client.query("rollback");
    await client.query("begin");
    await client.query(migrationSql);
    const present = await client.query("select 1 from information_schema.tables where table_schema = 'teaching' and table_name = 'study_cycles'");
    assert.equal(present.rowCount, 1);
  } finally {
    await client.query("rollback").catch(() => undefined);
    client.release();
  }
});
