import test from "node:test";
import assert from "node:assert/strict";

if (!process.env.DATABASE_URL && process.env.TEST_DATABASE_URL) {
  process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
}

const skip = !process.env.DATABASE_URL ? "DATABASE_URL not set" : undefined;

test("DICOM remap async-send migration persists durable monitoring fields and indexes", { skip }, async () => {
  const { pool } = await import("../db/pool.js");
  const columns = await pool.query<{ column_name: string }>(
    `select column_name from information_schema.columns where table_schema = 'public' and table_name = 'dicom_remap_jobs' and column_name = any($1::text[])`,
    [[
      "orthanc_send_job_id", "send_attempt_count", "send_started_at", "send_completed_at",
      "send_last_checked_at", "send_last_heartbeat_at", "send_error_code", "send_error_details",
    ]]
  );
  assert.equal(columns.rowCount, 8);

  const indexes = await pool.query<{ indexname: string }>(
    `select indexname from pg_indexes where schemaname = 'public' and tablename = 'dicom_remap_jobs' and indexname = any($1::text[])`,
    [["dicom_remap_jobs_sending_monitor_idx", "dicom_remap_jobs_sending_missing_orthanc_job_idx"]]
  );
  assert.equal(indexes.rowCount, 2);
});
