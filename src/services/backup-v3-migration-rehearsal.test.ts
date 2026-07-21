import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { pool } from "../db/pool.js";
import { createBackupV3MigrationRehearsal, runNextBackupV3MigrationRehearsal, validateBackupV3RehearsalDatabaseUrl } from "./backup-v3-migration-rehearsal-service.js";

test("rehearsal database URL must be dedicated and different from production", () => {
  assert.throws(
    () => validateBackupV3RehearsalDatabaseUrl("postgresql://rehearsal:secret@db.example:5432/rispro", "postgresql://app:secret@db.example:5432/rispro"),
    /dedicated rehearsal database/i,
  );
  assert.throws(
    () => validateBackupV3RehearsalDatabaseUrl("postgresql://rehearsal:secret@db.example:5432/rispro_rehearsal", "postgresql://app:secret@db.example:5432/rispro_rehearsal"),
    /must not be the production database/i,
  );
  assert.equal(
    validateBackupV3RehearsalDatabaseUrl("postgresql://rehearsal:secret@db.example:5432/rispro_rehearsal", "postgresql://app:secret@db.example:5432/rispro").pathname,
    "/rispro_rehearsal",
  );
});

test("rehearsal database URL validation rejects missing, malformed, and unsafe targets", () => {
  const previousRehearsalUrl = process.env.BACKUP_V3_REHEARSAL_DATABASE_URL;
  const previousDatabaseUrl = process.env.DATABASE_URL;
  try {
    delete process.env.BACKUP_V3_REHEARSAL_DATABASE_URL;
    delete process.env.DATABASE_URL;
    assert.throws(() => validateBackupV3RehearsalDatabaseUrl(), /requires BACKUP_V3_REHEARSAL_DATABASE_URL/i);
    assert.throws(() => validateBackupV3RehearsalDatabaseUrl("not-a-url"), /valid PostgreSQL URL/i);
    assert.throws(() => validateBackupV3RehearsalDatabaseUrl("mysql://rehearsal:secret@db.example:5432/rispro_rehearsal"), /dedicated rehearsal database/i);
    assert.throws(() => validateBackupV3RehearsalDatabaseUrl("postgresql://rehearsal:secret@db.example:5432/"), /dedicated rehearsal database/i);
    assert.throws(() => validateBackupV3RehearsalDatabaseUrl("postgresql://rehearsal:secret@db.example:5432/rispro"), /dedicated rehearsal database/i);
    assert.throws(() => validateBackupV3RehearsalDatabaseUrl("postgresql://rehearsal:secret@db.example:5432/rispro_rehearsal", "not-a-url"), /Production database configuration is invalid/i);
    assert.doesNotThrow(() => validateBackupV3RehearsalDatabaseUrl("postgresql://rehearsal:secret@db.example:5432/rispro_rehearsal"));
    assert.doesNotThrow(() => validateBackupV3RehearsalDatabaseUrl("postgresql://rehearsal:secret@db.example:5432/rispro_rehearsal", "postgresql://app:secret@other.example:5432/rispro"));
    assert.doesNotThrow(() => validateBackupV3RehearsalDatabaseUrl("postgresql://rehearsal:secret@db.example:5432/rispro_rehearsal", "postgresql://app:secret@db.example:5433/rispro_rehearsal"));
    assert.doesNotThrow(() => validateBackupV3RehearsalDatabaseUrl("postgresql://rehearsal:secret@db.example:5432/rispro_rehearsal", "postgresql://app:secret@db.example:5432/rispro_other"));
  } finally {
    if (previousRehearsalUrl === undefined) delete process.env.BACKUP_V3_REHEARSAL_DATABASE_URL; else process.env.BACKUP_V3_REHEARSAL_DATABASE_URL = previousRehearsalUrl;
    if (previousDatabaseUrl === undefined) delete process.env.DATABASE_URL; else process.env.DATABASE_URL = previousDatabaseUrl;
  }
});

test("migration rehearsal rejects same-version previews before queueing", async () => {
  const previewJobId = crypto.randomUUID();
  const uploadSessionId = crypto.randomUUID();
  try {
    await pool.query("insert into backup_restore_upload_sessions (upload_session_id,status,archive_name,staging_path,expected_size_bytes,received_offset,expires_at) values ($1::uuid,'completed','fixture.rispro.zip','/tmp/unused',1,1,now()+interval '1 hour')", [uploadSessionId]);
    await pool.query("insert into backup_restore_preview_jobs (preview_job_id,source_type,upload_session_id,status,compatibility_classification,archive_path,expires_at) values ($1::uuid,'upload_session',$2::uuid,'succeeded','same_version','/tmp/unused',now()+interval '1 hour')", [previewJobId, uploadSessionId]);
    await assert.rejects(() => createBackupV3MigrationRehearsal(previewJobId), /successful older-supported preview/i);
  } finally {
    await pool.query("delete from backup_restore_preview_jobs where preview_job_id=$1::uuid", [previewJobId]);
    await pool.query("delete from backup_restore_upload_sessions where upload_session_id=$1::uuid", [uploadSessionId]);
  }
});

test("failed rehearsal persists failure and removes its isolated database", async () => {
  const previewJobId = crypto.randomUUID();
  const uploadSessionId = crypto.randomUUID();
  const rehearsalId = crypto.randomUUID();
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "rispro-backup-v3-rehearsal-"));
  const archivePath = path.join(tempDir, "archive.rispro.zip");
  await fs.mkdir(path.join(tempDir, "staged"));
  await fs.writeFile(path.join(tempDir, "staged", "manifest.json"), JSON.stringify({ database: { migrationHistory: ["001_initial.sql"] }, postgresDump: { archivePath: "database/postgresql.dump", format: "custom" } }));
  await fs.writeFile(path.join(tempDir, "staged", "database.postgresql.dump"), "not-a-pg-dump");
  const previousRehearsalUrl = process.env.BACKUP_V3_REHEARSAL_DATABASE_URL;
  const testRehearsalUrl = new URL(process.env.DATABASE_URL || "postgresql://localhost:5432/rispro_test");
  testRehearsalUrl.pathname = "/rispro_rehearsal_template";
  process.env.BACKUP_V3_REHEARSAL_DATABASE_URL = testRehearsalUrl.toString();
  try {
    await pool.query("insert into backup_restore_upload_sessions (upload_session_id,status,archive_name,staging_path,expected_size_bytes,received_offset,expires_at) values ($1::uuid,'completed','fixture.rispro.zip',$2,1,1,now()+interval '1 hour')", [uploadSessionId, archivePath]);
    await pool.query("insert into backup_restore_preview_jobs (preview_job_id,source_type,upload_session_id,status,compatibility_classification,archive_path,expires_at) values ($1::uuid,'upload_session',$2::uuid,'succeeded','older_supported',$3,now()+interval '1 hour')", [previewJobId, uploadSessionId, archivePath]);
    await pool.query("insert into backup_restore_migration_rehearsals (rehearsal_id,preview_job_id,status,compatibility_classification) values ($1::uuid,$2::uuid,'queued','older_supported')", [rehearsalId, previewJobId]);
    assert.equal(await runNextBackupV3MigrationRehearsal(), true);
    const result = await pool.query<{ status: string; cleanup_status: string; errors: string[] }>("select status,cleanup_status,errors from backup_restore_migration_rehearsals where rehearsal_id=$1::uuid", [rehearsalId]);
    assert.equal(result.rows[0]?.status, "failed");
    assert.equal(result.rows[0]?.cleanup_status, "completed");
    assert.match(JSON.stringify(result.rows[0]?.errors), /pg_restore|rehearsal/i);
    const leftovers = await pool.query<{ datname: string }>("select datname from pg_database where datname like 'rispro_rehearsal_%'");
    assert.deepEqual(leftovers.rows, []);
  } finally {
    if (previousRehearsalUrl === undefined) delete process.env.BACKUP_V3_REHEARSAL_DATABASE_URL; else process.env.BACKUP_V3_REHEARSAL_DATABASE_URL = previousRehearsalUrl;
    await pool.query("delete from backup_restore_migration_rehearsals where rehearsal_id=$1::uuid", [rehearsalId]);
    await pool.query("delete from backup_restore_preview_jobs where preview_job_id=$1::uuid", [previewJobId]);
    await pool.query("delete from backup_restore_upload_sessions where upload_session_id=$1::uuid", [uploadSessionId]);
    await fs.rm(tempDir, { recursive: true, force: true });
  }
});
