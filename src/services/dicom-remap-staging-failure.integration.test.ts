import test from "node:test";
import assert from "node:assert/strict";
import bcrypt from "bcryptjs";

if (!process.env.DATABASE_URL && process.env.TEST_DATABASE_URL) process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;

test("failDicomRemapStagingJob records a typed failure in PostgreSQL", async () => {
  const { pool } = await import("../db/pool.js");
  const { failDicomRemapStagingJob } = await import("./dicom-remap-service.js");
  const suffix = `${Date.now()}_${Math.floor(Math.random() * 100000)}`;
  const user = await pool.query<{ id: number }>(
    `insert into users (username, full_name, password_hash, role, is_active) values ($1, $2, $3, 'supervisor', true) returning id`,
    [`dicom_staging_failure_${suffix}`, `DICOM Staging Failure ${suffix}`, bcrypt.hashSync("test-pass", 10)]
  );
  const userId = Number(user.rows[0]!.id);
  let jobId = 0;

  try {
    const job = await pool.query<{ id: number }>(
      `insert into dicom_remap_jobs (created_by_user_id, status, processing_stage) values ($1, 'uploaded', 'staging') returning id`,
      [userId]
    );
    jobId = Number(job.rows[0]!.id);

    await failDicomRemapStagingJob(jobId, "DICOM_REMAP_STAGING_INTERRUPTED");

    const recorded = await pool.query<{
      status: string;
      processing_stage: string;
      processing_error_code: string;
      processing_error_details: { code?: string };
    }>(
      `select status, processing_stage, processing_error_code, processing_error_details from dicom_remap_jobs where id = $1`,
      [jobId]
    );
    assert.deepEqual(recorded.rows[0], {
      status: "failed",
      processing_stage: "failed",
      processing_error_code: "DICOM_REMAP_STAGING_INTERRUPTED",
      processing_error_details: { code: "DICOM_REMAP_STAGING_INTERRUPTED" },
    });
  } finally {
    if (jobId > 0) await pool.query(`delete from dicom_remap_jobs where id = $1`, [jobId]);
    await pool.query(`delete from users where id = $1`, [userId]);
    await pool.end();
  }
});
