import assert from "node:assert/strict";
import test from "node:test";
import { pool } from "../pool.js";

test("migration 183 creates the durable DICOM transfer event model", async (t) => {
  try { await pool.query("select 1"); } catch { t.skip("PostgreSQL is not reachable at configured DATABASE_URL."); return; }
  assert.equal((await pool.query("select 1 from schema_migrations where filename='183_dicom_transfer_events.sql'")).rowCount, 1);
  const columns = await pool.query<{ column_name: string }>("select column_name from information_schema.columns where table_name='dicom_transfer_events'");
  for (const column of ["direction", "status", "study_instance_uid", "source_aet", "source_ip", "destination_aet", "instance_count", "first_seen_at", "last_seen_at", "completed_at", "created_at", "updated_at"]) assert.ok(columns.rows.some((row) => row.column_name === column));
  const indexes = await pool.query<{ indexname: string }>("select indexname from pg_indexes where tablename='dicom_transfer_events'");
  for (const index of ["dicom_transfer_events_newest_idx", "dicom_transfer_events_accession_number_idx", "dicom_transfer_events_study_instance_uid_idx", "dicom_transfer_events_direction_status_time_idx"]) assert.ok(indexes.rows.some((row) => row.indexname === index));
});
