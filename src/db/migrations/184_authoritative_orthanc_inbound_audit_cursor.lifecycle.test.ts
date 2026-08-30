import assert from "node:assert/strict";
import test from "node:test";
import { pool } from "../pool.js";

test("migration 184 adds Orthanc audit source fields and an independent cursor", async (t) => {
  try { await pool.query("select 1"); } catch { t.skip("PostgreSQL is not reachable at configured DATABASE_URL."); return; }
  assert.equal((await pool.query("select 1 from schema_migrations where filename='184_authoritative_orthanc_inbound_audit_cursor.sql'")).rowCount, 1);
  const columns = await pool.query<{ column_name: string }>("select column_name from information_schema.columns where table_name='dicom_transfer_events'");
  for (const column of ["orthanc_change_sequence", "orthanc_resource_id"]) assert.ok(columns.rows.some((row) => row.column_name === column));
  assert.equal((await pool.query("select 1 from pg_indexes where tablename='dicom_transfer_events' and indexname='dicom_transfer_events_orthanc_change_sequence_idx'")).rowCount, 1);
  const state = await pool.query<{ singleton_key: boolean }>("select singleton_key from authoritative_orthanc_inbound_audit_state");
  assert.deepEqual(state.rows.map((row) => row.singleton_key), [true]);
});
