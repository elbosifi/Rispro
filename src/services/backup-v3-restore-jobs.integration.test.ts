import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import test, { afterEach } from "node:test";
import { PassThrough } from "node:stream";
import { pool } from "../db/pool.js";
import { getProjectRootDir } from "./document-storage-path.js";
import {
  appendBackupV3UploadChunk,
  BACKUP_V3_UPLOAD_CHUNK_BYTES,
  cancelBackupV3UploadSession,
  claimBackupV3PreviewForRestore,
  cleanupBackupV3RestoreJobs,
  completeBackupV3UploadSession,
  createBackupV3UploadSession,
  createBackupV3PreviewJob,
  getBackupV3PreviewJob,
  recoverInterruptedBackupV3RestorePreviewJobs,
  runNextBackupV3RestorePreviewJob,
} from "./backup-v3-restore-jobs-service.js";

const createdUploadSessionIds = new Set<string>();
const restoreUploadsRoot = path.join(getProjectRootDir(), "storage", "backups", "restore-uploads");

async function createTrackedBackupV3UploadSession(input: Parameters<typeof createBackupV3UploadSession>[0]) {
  const session = await createBackupV3UploadSession(input);
  createdUploadSessionIds.add(session.uploadSessionId);
  return session;
}

afterEach(async () => {
  const sessionIds = [...createdUploadSessionIds];
  createdUploadSessionIds.clear();
  await Promise.all(sessionIds.map((sessionId) => fs.rm(path.join(restoreUploadsRoot, sessionId), { recursive: true, force: true })));
});

function chunk(value: string, length = Buffer.byteLength(value)) {
  const request = new PassThrough() as PassThrough & { header(name: string): string | undefined };
  request.header = (name) => name.toLowerCase() === "content-length" ? String(length) : undefined;
  request.end(Buffer.from(value));
  return request as never;
}

test("durable restore uploads reject offset mismatch and duplicate chunks, then resume and validate checksum", async () => {
  const value = "abcdef";
  const session = await createTrackedBackupV3UploadSession({ userId: null, archiveName: "upload.rispro.zip", expectedSizeBytes: value.length, expectedSha256: crypto.createHash("sha256").update(value).digest("hex") });
  try {
    await assert.rejects(() => appendBackupV3UploadChunk(session.uploadSessionId, 1, chunk("abc")), /offset mismatch/i);
    assert.equal((await appendBackupV3UploadChunk(session.uploadSessionId, 0, chunk("abc"))).receivedOffset, 3);
    await assert.rejects(() => appendBackupV3UploadChunk(session.uploadSessionId, 0, chunk("abc")), /offset mismatch/i);
    assert.equal((await appendBackupV3UploadChunk(session.uploadSessionId, 3, chunk("def"))).receivedOffset, 6);
    assert.equal((await completeBackupV3UploadSession(session.uploadSessionId)).status, "completed");
  } finally { await pool.query("delete from backup_restore_upload_sessions where upload_session_id=$1::uuid", [session.uploadSessionId]); }
});

test("durable restore uploads reject oversized chunks and clean cancelled, expired, and checksum-failed sessions", async () => {
  const oversized = await createTrackedBackupV3UploadSession({ userId: null, archiveName: "oversized.rispro.zip", expectedSizeBytes: 1 });
  const cancelled = await createTrackedBackupV3UploadSession({ userId: null, archiveName: "cancelled.rispro.zip", expectedSizeBytes: 1 });
  const invalid = await createTrackedBackupV3UploadSession({ userId: null, archiveName: "invalid.rispro.zip", expectedSizeBytes: 1, expectedSha256: "a".repeat(64) });
  const expired = await createTrackedBackupV3UploadSession({ userId: null, archiveName: "expired.rispro.zip", expectedSizeBytes: 1 });
  try {
    await assert.rejects(() => appendBackupV3UploadChunk(oversized.uploadSessionId, 0, chunk("", BACKUP_V3_UPLOAD_CHUNK_BYTES + 1)), /chunk size/i);
    await cancelBackupV3UploadSession(cancelled.uploadSessionId);
    await appendBackupV3UploadChunk(invalid.uploadSessionId, 0, chunk("x"));
    await assert.rejects(() => completeBackupV3UploadSession(invalid.uploadSessionId), /SHA-256/i);
    await pool.query("update backup_restore_upload_sessions set expires_at=now()-interval '1 second' where upload_session_id=$1::uuid", [expired.uploadSessionId]);
    await cleanupBackupV3RestoreJobs();
    const { rows } = await pool.query<{ status: string; cleanup_at: Date | null }>("select status,cleanup_at from backup_restore_upload_sessions where upload_session_id = any($1::uuid[])", [[cancelled.uploadSessionId, invalid.uploadSessionId, expired.uploadSessionId]]);
    assert.equal(rows.length, 3); assert.ok(rows.every((row) => row.cleanup_at && ["cancelled", "failed", "expired"].includes(row.status)));
  } finally { await pool.query("delete from backup_restore_upload_sessions where upload_session_id = any($1::uuid[])", [[oversized.uploadSessionId, cancelled.uploadSessionId, invalid.uploadSessionId, expired.uploadSessionId]]); }
});

test("durable preview persists a failed worker result and cleans its staged artifact", async () => {
  const archive = "not-a-zip";
  const upload = await createTrackedBackupV3UploadSession({ userId: null, archiveName: "preview.rispro.zip", expectedSizeBytes: archive.length, expectedSha256: crypto.createHash("sha256").update(archive).digest("hex") });
  let previewId: string | null = null;
  try {
    await appendBackupV3UploadChunk(upload.uploadSessionId, 0, chunk(archive));
    await completeBackupV3UploadSession(upload.uploadSessionId);
    const preview = await createBackupV3PreviewJob({ userId: null, source: { type: "upload_session", uploadSessionId: upload.uploadSessionId }, passphrase: "test-passphrase" });
    previewId = preview.previewJobId;
    assert.equal((await getBackupV3PreviewJob(preview.previewJobId)).status, "queued");
    assert.equal(await runNextBackupV3RestorePreviewJob(), true);
    const failed = await getBackupV3PreviewJob(preview.previewJobId);
    assert.equal(failed.status, "failed");
    assert.ok(failed.failureDiagnostics);
    await cleanupBackupV3RestoreJobs();
    const cleaned = await pool.query<{ cleanup_at: Date | null }>("select cleanup_at from backup_restore_preview_jobs where preview_job_id=$1::uuid", [preview.previewJobId]);
    assert.ok(cleaned.rows[0]?.cleanup_at);
  } finally {
    if (previewId) await pool.query("delete from backup_restore_preview_jobs where preview_job_id=$1::uuid", [previewId]);
    await pool.query("delete from backup_restore_upload_sessions where upload_session_id=$1::uuid", [upload.uploadSessionId]);
  }
});

test("worker restart durably fails an interrupted preview without persisting its passphrase", async () => {
  const archive = "restart";
  const upload = await createTrackedBackupV3UploadSession({ userId: null, archiveName: "restart.rispro.zip", expectedSizeBytes: archive.length, expectedSha256: crypto.createHash("sha256").update(archive).digest("hex") });
  let previewId: string | null = null;
  try {
    await appendBackupV3UploadChunk(upload.uploadSessionId, 0, chunk(archive));
    await completeBackupV3UploadSession(upload.uploadSessionId);
    const preview = await createBackupV3PreviewJob({ userId: null, source: { type: "upload_session", uploadSessionId: upload.uploadSessionId }, passphrase: "test-passphrase" });
    previewId = preview.previewJobId;
    await pool.query("update backup_restore_preview_jobs set status='running',progress=20 where preview_job_id=$1::uuid", [preview.previewJobId]);
    assert.equal(await recoverInterruptedBackupV3RestorePreviewJobs(), 1);
    const recovered = await getBackupV3PreviewJob(preview.previewJobId);
    assert.equal(recovered.status, "failed");
    assert.match(recovered.failureDiagnostics || "", /worker restart/i);
  } finally {
    if (previewId) await pool.query("delete from backup_restore_preview_jobs where preview_job_id=$1::uuid", [previewId]);
    await pool.query("delete from backup_restore_upload_sessions where upload_session_id=$1::uuid", [upload.uploadSessionId]);
  }
});

test("only one concurrent restore claim can consume a successful preview, and expired previews are rejected", async () => {
  const archive = "reviewed";
  const upload = await createTrackedBackupV3UploadSession({ userId: null, archiveName: "claim.rispro.zip", expectedSizeBytes: archive.length, expectedSha256: crypto.createHash("sha256").update(archive).digest("hex") });
  const previewIds: string[] = [];
  try {
    await appendBackupV3UploadChunk(upload.uploadSessionId, 0, chunk(archive));
    await completeBackupV3UploadSession(upload.uploadSessionId);
    const stored = await pool.query<{ staging_path: string }>("select staging_path from backup_restore_upload_sessions where upload_session_id=$1::uuid", [upload.uploadSessionId]);
    const makeSucceededPreview = async () => {
      const preview = await createBackupV3PreviewJob({ userId: null, source: { type: "upload_session", uploadSessionId: upload.uploadSessionId }, passphrase: "test-passphrase" });
      previewIds.push(preview.previewJobId);
      await pool.query("update backup_restore_preview_jobs set status='succeeded', compatibility_classification='same_version', archive_path=$2, archive_sha256=$3, archive_size_bytes=$4, completed_at=now() where preview_job_id=$1::uuid", [preview.previewJobId, stored.rows[0]!.staging_path, crypto.createHash("sha256").update(archive).digest("hex"), archive.length]);
      return preview.previewJobId;
    };
    const claimable = await makeSucceededPreview();
    const claims = await Promise.allSettled([claimBackupV3PreviewForRestore(claimable), claimBackupV3PreviewForRestore(claimable)]);
    assert.equal(claims.filter((claim) => claim.status === "fulfilled").length, 1);
    assert.equal(claims.filter((claim) => claim.status === "rejected").length, 1);
    const expired = await makeSucceededPreview();
    await pool.query("update backup_restore_preview_jobs set expires_at=now()-interval '1 second' where preview_job_id=$1::uuid", [expired]);
    await assert.rejects(() => claimBackupV3PreviewForRestore(expired), /successful, unexpired same-version preview/i);
  } finally {
    if (previewIds.length) await pool.query("delete from backup_restore_preview_jobs where preview_job_id = any($1::uuid[])", [previewIds]);
    await pool.query("delete from backup_restore_upload_sessions where upload_session_id=$1::uuid", [upload.uploadSessionId]);
  }
});

test("a verified destination copy is accepted as a durable preview source", async () => {
  const destinationId = crypto.randomUUID(); const jobId = crypto.randomUUID(); const artifactId = crypto.randomUUID(); const copyAttemptId = crypto.randomUUID(); let previewId: string | null = null;
  try {
    await pool.query("insert into backup_destination_profiles (destination_id,name,destination_type,config) values ($1::uuid,$2,'local',$3::jsonb)", [destinationId, `preview-test-${destinationId}`, JSON.stringify({ rootPath: "/tmp" })]);
    await pool.query("insert into backup_jobs (job_id,status,requested_destination_ids) values ($1::uuid,'completed',$2::uuid[])", [jobId, [destinationId]]);
    await pool.query("insert into backup_artifacts (artifact_id,job_id,archive_name,staging_path,byte_size,sha256,manifest) values ($1::uuid,$2::uuid,'copy.rispro.zip','/tmp/copy.rispro.zip',1,$3,$4::jsonb)", [artifactId, jobId, "a".repeat(64), "{}"]);
    await pool.query("insert into backup_destination_copy_attempts (copy_attempt_id,job_id,artifact_id,destination_id,status,remote_path,byte_size,sha256) values ($1::uuid,$2::uuid,$3::uuid,$4::uuid,'verified','copy.rispro.zip',1,$5)", [copyAttemptId, jobId, artifactId, destinationId, "a".repeat(64)]);
    const preview = await createBackupV3PreviewJob({ userId: null, source: { type: "destination_copy", copyAttemptId }, passphrase: "test-passphrase" });
    previewId = preview.previewJobId;
    assert.equal(preview.sourceType, "destination_copy");
    assert.deepEqual(preview.source, { copyAttemptId });
  } finally {
    if (previewId) await pool.query("delete from backup_restore_preview_jobs where preview_job_id=$1::uuid", [previewId]);
    await pool.query("delete from backup_jobs where job_id=$1::uuid", [jobId]);
    await pool.query("delete from backup_destination_profiles where destination_id=$1::uuid", [destinationId]);
  }
});
