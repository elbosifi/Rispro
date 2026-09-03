import assert from "node:assert/strict";
import test from "node:test";
import { pool } from "../pool.js";

test("migration 194 creates outbound audit state and SENT job/study uniqueness protection", async (t) => {
  try { await pool.query("select 1"); } catch { t.skip("PostgreSQL is not reachable at configured DATABASE_URL."); return; }
  assert.equal((await pool.query("select 1 from schema_migrations where filename='194_authoritative_orthanc_outbound_audit.sql'")).rowCount, 1);
  const columns = await pool.query<{ column_name: string }>("select column_name from information_schema.columns where table_name='authoritative_orthanc_outbound_audit_state'");
  for (const column of ["singleton_key", "initialized_at", "last_success_at", "last_error", "updated_at"]) assert.ok(columns.rows.some((row) => row.column_name === column));
  const index = await pool.query<{ indexdef: string; indisunique: boolean }>(
    "select pg_get_indexdef(indexrelid) as indexdef, indisunique from pg_index join pg_class on pg_class.oid=indexrelid where relname='dicom_transfer_events_sent_job_study_idx'",
  );
  assert.equal(index.rows[0]?.indisunique, true);
  assert.match(index.rows[0]?.indexdef || "", /orthanc_job_id.*study_instance_uid/i);
  assert.match(index.rows[0]?.indexdef || "", /direction.*SENT.*orthanc_job_id.*is not null/i);
});
