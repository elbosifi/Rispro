import assert from "node:assert/strict";
import test from "node:test";
import { pool } from "../../db/pool.js";

async function ready(t: { skip(message: string): void }): Promise<boolean> {
  try { await pool.query("select 1"); return true; } catch { t.skip("PostgreSQL is not reachable at configured DATABASE_URL."); return false; }
}

test("migration 149 creates durable export fields, statuses, and idempotency key", async (t) => {
  if (!(await ready(t))) return;
  const columns = await pool.query<{ column_name: string }>("select column_name from information_schema.columns where table_name='clinical_document_exports' and column_name=any($1::text[])", [["document_id", "appointment_id", "destination_key", "status", "attempt_count", "next_retry_at", "last_attempt_at", "orthanc_study_id", "orthanc_series_id", "orthanc_instance_id", "study_instance_uid", "series_instance_uid", "sop_instance_uid", "exported_at", "verified_at", "export_lease_owner", "export_lease_expires_at"]]);
  assert.equal(columns.rows.length, 17);
  const unique = await pool.query("select 1 from pg_indexes where indexname='clinical_document_exports_document_appointment_destination_key'");
  assert.equal(unique.rowCount, 1);
  await assert.rejects(() => pool.query("insert into clinical_document_exports(document_id,appointment_id,status) values(-1,-1,'not-a-status')"));
});

