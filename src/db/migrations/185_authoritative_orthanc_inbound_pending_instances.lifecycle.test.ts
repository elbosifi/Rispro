import assert from "node:assert/strict";
import test from "node:test";
import { pool } from "../pool.js";

test("migration 185 adds transient inbound pending-instance state", async (t) => {
  try { await pool.query("select 1"); } catch { t.skip("PostgreSQL is not reachable at configured DATABASE_URL."); return; }
  assert.equal((await pool.query("select 1 from schema_migrations where filename='185_authoritative_orthanc_inbound_pending_instances.sql' ")).rowCount, 1);
  const columns = await pool.query<{ column_name: string }>("select column_name from information_schema.columns where table_name='authoritative_orthanc_inbound_pending_instances'");
  for (const column of ["change_sequence", "orthanc_instance_id", "change_date", "created_at"]) assert.ok(columns.rows.some((row) => row.column_name === column));
  assert.equal((await pool.query("select 1 from pg_indexes where tablename='authoritative_orthanc_inbound_pending_instances' and indexname='authoritative_orthanc_inbound_pending_instances_instance_id_idx'")).rowCount, 1);
});
