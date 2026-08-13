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
      "dicom_integrity_version", "dicom_integrity_verified_at", "orthanc_recovery_status",
      "orthanc_recovery_attempt_count", "orthanc_recovery_source_study_id", "orthanc_recovery_started_at",
      "orthanc_recovery_completed_at", "orthanc_recovery_error_code", "orthanc_recovery_error_details",
      "orthanc_recovery_expires_at",
    ]]
  );
  assert.equal(columns.rowCount, 18);

  const indexes = await pool.query<{ indexname: string }>(
    `select indexname from pg_indexes where schemaname = 'public' and tablename = 'dicom_remap_jobs' and indexname = any($1::text[])`,
    [["dicom_remap_jobs_sending_monitor_idx", "dicom_remap_jobs_sending_missing_orthanc_job_idx"]]
  );
  assert.equal(indexes.rowCount, 2);
});

test("a failed job resends idempotently while another same-user job is processing", { skip }, async () => {
  const { pool } = await import("../db/pool.js");
  const { resendDicomRemapJobToPacs, __dicomRemapTestables } = await import("./dicom-remap-service.js");
  const suffix = `${Date.now()}_${Math.random().toString(16).slice(2)}`;
  const user = await pool.query<{ id: number }>(`insert into users (username, full_name, password_hash, role, is_active) values ($1, $2, 'test-hash', 'supervisor', true) returning id`, [`dicom_resend_${suffix}`, `DICOM Resend ${suffix}`]);
  const userId = Number(user.rows[0]!.id);
  let storeCalls = 0;
  try {
    const failed = await pool.query<{ id: number }>(`insert into dicom_remap_jobs (created_by_user_id, status, processing_stage, source_orthanc_study_id, modified_orthanc_study_id, destination_pacs_key, error_message, send_error_code, send_error_details, send_attempt_count, dicom_integrity_version, dicom_integrity_verified_at) values ($1, 'failed', 'failed', 'source-a', 'modified-a', 'PACS_TEST', 'Original send failure', 'ORTHANC_SEND_JOB_FAILED', '{"original":true}'::jsonb, 2, 1, now()) returning id`, [userId]);
    const other = await pool.query<{ id: number }>(`insert into dicom_remap_jobs (created_by_user_id, status, processing_stage, processing_lease_owner, processing_lease_expires_at) values ($1, 'processing', 'rewriting', 'other-worker', now() + interval '10 minutes') returning id`, [userId]);
    __dicomRemapTestables.setAuditLoggerForTests(async () => ({} as never));
    __dicomRemapTestables.setOrthancFetchForTests(async (requestPath, options = {}) => {
      if (options.method === "GET" && requestPath === "/studies/modified-a") return { status: 200, ok: true, text: "{}", json: { ID: "modified-a" } };
      if (options.method === "POST" && requestPath === "/modalities/PACS_TEST/store") {
        storeCalls += 1;
        return { status: 202, ok: true, text: "{}", json: { ID: "orthanc-resend-a" } };
      }
      throw new Error(`Unexpected Orthanc request: ${requestPath}`);
    });

    const first = await resendDicomRemapJobToPacs({ jobId: Number(failed.rows[0]!.id), currentUserId: userId });
    const repeated = await resendDicomRemapJobToPacs({ jobId: Number(failed.rows[0]!.id), currentUserId: userId });
    assert.equal(first.job.orthanc_send_job_id, "orthanc-resend-a");
    assert.equal(repeated.job.orthanc_send_job_id, "orthanc-resend-a");
    assert.equal(storeCalls, 1);
    const untouched = await pool.query<{ status: string; processing_lease_owner: string }>(`select status, processing_lease_owner from dicom_remap_jobs where id = $1`, [other.rows[0]!.id]);
    assert.deepEqual(untouched.rows[0], { status: "processing", processing_lease_owner: "other-worker" });
  } finally {
    __dicomRemapTestables.resetTestOverrides();
    await pool.query(`delete from dicom_remap_jobs where created_by_user_id = $1`, [userId]);
    await pool.query(`delete from users where id = $1`, [userId]);
  }
});
