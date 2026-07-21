import crypto from "node:crypto";
import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import { pipeline } from "node:stream/promises";
import type { Request } from "express";
import { pool } from "../db/pool.js";
import { HttpError } from "../utils/http-error.js";
import { getProjectRootDir } from "./document-storage-path.js";
import { sha256File } from "./backup-v3-checksums.js";
import { previewBackupV3RestoreFromArchive, type BackupV3RestorePreview } from "./backup-v3-preview-service.js";
import { retrieveBackupV3FromLocalDestination } from "./backup-v3-local-destination.js";
import { retrieveBackupV3FromSmbDestination } from "./backup-v3-smb-destination.js";
import { retrieveBackupV3FromSftpDestination } from "./backup-v3-sftp-destination.js";
import { retrieveBackupV3FromWebDavDestination } from "./backup-v3-webdav-destination.js";
import { getBackupDestinationCredentials } from "./backup-v3-control-center-service.js";
import type { NullableUserId } from "../types/http.js";
import { classifyBackupV3MigrationHistory } from "./backup-v3-historical-compatibility.js";

const MAX_ARCHIVE_BYTES = 4 * 1024 * 1024 * 1024;
export const BACKUP_V3_UPLOAD_CHUNK_BYTES = 8 * 1024 * 1024;
const SESSION_TTL_MS = 24 * 60 * 60 * 1000;
const PREVIEW_TTL_MS = 2 * 60 * 60 * 1000;
const previewPassphrases = new Map<string, string>();

type Source = { type: "artifact"; artifactId: string } | { type: "destination_copy"; copyAttemptId: string } | { type: "upload_session"; uploadSessionId: string };
type UploadRow = { upload_session_id: string; status: string; archive_name: string; staging_path: string; expected_size_bytes: string; expected_sha256: string | null; received_offset: string; expires_at: Date; failure_message: string | null; created_at: Date; completed_at: Date | null };
type PreviewRow = { preview_job_id: string; source_type: Source["type"]; artifact_id: string | null; copy_attempt_id: string | null; upload_session_id: string | null; status: string; progress: number; archive_path: string | null; archive_sha256: string | null; archive_size_bytes: string | null; manifest_summary: BackupV3RestorePreview["manifest"] & { counts?: BackupV3RestorePreview["counts"] }; warnings: string[]; errors: string[]; passphrase_valid: boolean | null; failure_diagnostics: string | null; compatibility_classification?: string | null; compatibility_message?: string | null; created_at: Date; expires_at: Date; completed_at: Date | null; consumed_at: Date | null };

function stagingRoot(kind: "uploads" | "previews") { return path.join(getProjectRootDir(), "storage", "backups", `restore-${kind}`); }
function safeName(value: unknown) { const name = path.basename(String(value || "backup.rispro.zip")); if (!/^[A-Za-z0-9._-]+\.rispro\.zip$/.test(name)) throw new HttpError(400, "Backup filename must end in .rispro.zip and contain only safe filename characters."); return name; }
function safeSha(value: unknown) { if (value == null || value === "") return null; const sha = String(value).toLowerCase(); if (!/^[a-f0-9]{64}$/.test(sha)) throw new HttpError(400, "Expected SHA-256 must be a 64-character hexadecimal digest."); return sha; }
function expectedSize(value: unknown) { const size = Number(value); if (!Number.isSafeInteger(size) || size <= 0 || size > MAX_ARCHIVE_BYTES) throw new HttpError(400, "Expected archive size is invalid or exceeds the restore limit."); return size; }
async function privateDir(dir: string) { await fsp.mkdir(dir, { recursive: true, mode: 0o700 }); await fsp.chmod(dir, 0o700); }
function publicUpload(row: UploadRow) { return { uploadSessionId: row.upload_session_id, status: row.status, archiveName: row.archive_name, expectedSizeBytes: Number(row.expected_size_bytes), expectedSha256: row.expected_sha256, receivedOffset: Number(row.received_offset), expiresAt: row.expires_at, createdAt: row.created_at, completedAt: row.completed_at, failureMessage: row.failure_message }; }
function publicPreview(row: PreviewRow) { return { previewJobId: row.preview_job_id, sourceType: row.source_type, source: row.source_type === "artifact" ? { artifactId: row.artifact_id } : row.source_type === "destination_copy" ? { copyAttemptId: row.copy_attempt_id } : { uploadSessionId: row.upload_session_id }, status: row.status, progress: row.progress, archiveSha256: row.archive_sha256, archiveSizeBytes: row.archive_size_bytes == null ? null : Number(row.archive_size_bytes), manifest: row.manifest_summary?.formatVersion ? row.manifest_summary : null, counts: row.manifest_summary?.counts || null, warnings: row.warnings || [], errors: row.errors || [], compatibilityClassification: row.compatibility_classification || null, compatibilityMessage: row.compatibility_message || null, passphraseValid: row.passphrase_valid, failureDiagnostics: row.failure_diagnostics, createdAt: row.created_at, expiresAt: row.expires_at, completedAt: row.completed_at, consumedAt: row.consumed_at }; }

export async function createBackupV3UploadSession(input: { userId: NullableUserId; archiveName: unknown; expectedSizeBytes: unknown; expectedSha256?: unknown }) {
  const archiveName = safeName(input.archiveName); const size = expectedSize(input.expectedSizeBytes); const id = crypto.randomUUID();
  const dir = path.join(stagingRoot("uploads"), id); await privateDir(dir); const archivePath = path.join(dir, archiveName);
  try { await fsp.writeFile(archivePath, Buffer.alloc(0), { flag: "wx", mode: 0o600 }); await fsp.chmod(archivePath, 0o600); }
  catch (error) { await fsp.rm(dir, { recursive: true, force: true }); throw error; }
  const { rows } = await pool.query<UploadRow>("insert into backup_restore_upload_sessions (upload_session_id,created_by_user_id,status,archive_name,staging_path,expected_size_bytes,expected_sha256,expires_at) values ($1::uuid,$2,'active',$3,$4,$5,$6,$7) returning *", [id, input.userId, archiveName, archivePath, size, safeSha(input.expectedSha256), new Date(Date.now() + SESSION_TTL_MS)]);
  return publicUpload(rows[0]!);
}

export async function getBackupV3UploadSession(id: string) { const { rows } = await pool.query<UploadRow>("select * from backup_restore_upload_sessions where upload_session_id=$1::uuid", [id]); if (!rows[0]) throw new HttpError(404, "Restore upload session was not found."); return publicUpload(rows[0]); }

/** Holds the row lock while streaming one bounded chunk, making retries and concurrent requests deterministic. */
export async function appendBackupV3UploadChunk(id: string, offsetValue: unknown, req: Request) {
  const offset = Number(offsetValue); const contentLength = Number(req.header("content-length"));
  if (!Number.isSafeInteger(offset) || offset < 0) throw new HttpError(400, "X-Upload-Offset must be a non-negative integer.");
  if (!Number.isSafeInteger(contentLength) || contentLength <= 0 || contentLength > BACKUP_V3_UPLOAD_CHUNK_BYTES) throw new HttpError(413, "Upload chunk size is invalid or exceeds the configured limit.");
  const client = await pool.connect(); let row: UploadRow | undefined; let originalOffset = 0;
  try {
    await client.query("begin"); const selected = await client.query<UploadRow>("select * from backup_restore_upload_sessions where upload_session_id=$1::uuid for update", [id]); row = selected.rows[0];
    if (!row) throw new HttpError(404, "Restore upload session was not found."); if (row.status !== "active" || row.expires_at <= new Date()) throw new HttpError(409, "Restore upload session is not active.");
    originalOffset = Number(row.received_offset); if (offset !== originalOffset) throw new HttpError(409, `Upload offset mismatch. Resume at ${originalOffset}.`);
    if (offset + contentLength > Number(row.expected_size_bytes)) throw new HttpError(413, "Upload exceeds the declared archive size.");
    let received = 0;
    const output = fs.createWriteStream(row.staging_path, { flags: "r+", start: offset, mode: 0o600 });
    req.on("data", (chunk: Buffer) => { received += chunk.length; if (received > contentLength || received > BACKUP_V3_UPLOAD_CHUNK_BYTES) req.destroy(new HttpError(413, "Upload chunk exceeds the configured limit.")); });
    await pipeline(req, output);
    if (received !== contentLength) throw new HttpError(400, "Upload chunk length does not match Content-Length.");
    const updated = await client.query<UploadRow>("update backup_restore_upload_sessions set received_offset=$2 where upload_session_id=$1::uuid returning *", [id, offset + received]); await client.query("commit"); return publicUpload(updated.rows[0]!);
  } catch (error) {
    await client.query("rollback").catch(() => undefined); if (row) await fsp.truncate(row.staging_path, originalOffset).catch(() => undefined); throw error;
  } finally { client.release(); }
}

export async function completeBackupV3UploadSession(id: string) {
  const client = await pool.connect(); let validationFailed = false; try { await client.query("begin"); const { rows } = await client.query<UploadRow>("select * from backup_restore_upload_sessions where upload_session_id=$1::uuid for update", [id]); const row = rows[0]; if (!row) throw new HttpError(404, "Restore upload session was not found.");
    if (row.status !== "active") throw new HttpError(409, "Restore upload session is not active."); if (Number(row.received_offset) !== Number(row.expected_size_bytes)) throw new HttpError(409, `Upload is incomplete. Resume at ${row.received_offset}.`);
    const digest = await sha256File(row.staging_path); const invalid = digest.byteSize !== Number(row.expected_size_bytes) || (row.expected_sha256 && digest.sha256 !== row.expected_sha256.toLowerCase());
    if (invalid) { await client.query("update backup_restore_upload_sessions set status='failed',failure_message=$2 where upload_session_id=$1::uuid", [id, "Final archive size or SHA-256 did not match the declared upload."]); await client.query("commit"); validationFailed = true; }
    if (validationFailed) throw new HttpError(400, "Final archive size or SHA-256 did not match the declared upload.");
    const complete = await client.query<UploadRow>("update backup_restore_upload_sessions set status='completed',completed_at=now() where upload_session_id=$1::uuid returning *", [id]); await client.query("commit"); return publicUpload(complete.rows[0]!);
  } catch (error) { await client.query("rollback").catch(() => undefined); throw error; } finally { client.release(); } }

export async function cancelBackupV3UploadSession(id: string) { const { rows } = await pool.query<UploadRow>("update backup_restore_upload_sessions set status='cancelled',cancelled_at=now() where upload_session_id=$1::uuid and status in ('active','completed') returning *", [id]); if (!rows[0]) throw new HttpError(409, "Restore upload session cannot be cancelled."); await fsp.rm(path.dirname(rows[0].staging_path), { recursive: true, force: true }); await pool.query("update backup_restore_upload_sessions set cleanup_at=now() where upload_session_id=$1::uuid", [id]); return publicUpload(rows[0]); }

export async function createBackupV3PreviewJob(input: { userId: NullableUserId; source: Source; passphrase: unknown }) {
  const passphrase = String(input.passphrase || ""); if (passphrase.length < 8) throw new HttpError(400, "Backup passphrase must be at least 8 characters."); const id = crypto.randomUUID();
  if (input.source.type === "artifact") { const found = await pool.query("select 1 from backup_artifacts where artifact_id=$1::uuid", [input.source.artifactId]); if (!found.rowCount) throw new HttpError(404, "Backup artifact was not found."); }
  if (input.source.type === "destination_copy") { const found = await pool.query("select 1 from backup_destination_copy_attempts where copy_attempt_id=$1::uuid and status='verified'", [input.source.copyAttemptId]); if (!found.rowCount) throw new HttpError(409, "Select a verified destination copy."); }
  if (input.source.type === "upload_session") { const found = await pool.query("select 1 from backup_restore_upload_sessions where upload_session_id=$1::uuid and status='completed' and expires_at > now()", [input.source.uploadSessionId]); if (!found.rowCount) throw new HttpError(409, "Complete an active external upload before previewing it."); }
  const params = input.source.type === "artifact" ? [id, input.userId, input.source.artifactId, null, null] : input.source.type === "destination_copy" ? [id, input.userId, null, input.source.copyAttemptId, null] : [id, input.userId, null, null, input.source.uploadSessionId];
  const { rows } = await pool.query<PreviewRow>("insert into backup_restore_preview_jobs (preview_job_id,created_by_user_id,source_type,artifact_id,copy_attempt_id,upload_session_id,status,expires_at) values ($1::uuid,$2,$3,$4::uuid,$5::uuid,$6::uuid,'queued',$7) returning *", [...params.slice(0, 2), input.source.type, ...params.slice(2), new Date(Date.now() + PREVIEW_TTL_MS)]);
  previewPassphrases.set(id, passphrase); return publicPreview(rows[0]!);
}

export async function getBackupV3PreviewJob(id: string) { const { rows } = await pool.query<PreviewRow>("select * from backup_restore_preview_jobs where preview_job_id=$1::uuid", [id]); if (!rows[0]) throw new HttpError(404, "Restore preview job was not found."); return publicPreview(rows[0]); }

/** A restarted worker cannot recover the operator passphrase, which is never persisted. */
export async function recoverInterruptedBackupV3RestorePreviewJobs() {
  const message = "Restore preview was interrupted by a worker restart; create a new preview job and provide the passphrase again.";
  const result = await pool.query("update backup_restore_preview_jobs set status='failed',progress=100,errors=$1::jsonb,failure_diagnostics=$2,completed_at=now() where status='running'", [JSON.stringify([message]), message]);
  return result.rowCount || 0;
}

async function materializePreviewSource(job: PreviewRow, jobDir: string): Promise<string> {
  await privateDir(jobDir); const target = path.join(jobDir, "archive.rispro.zip");
  if (job.source_type === "artifact") { const { rows } = await pool.query<{ staging_path: string }>("select staging_path from backup_artifacts where artifact_id=$1::uuid", [job.artifact_id]); if (!rows[0]) throw new Error("Backup artifact is no longer available."); await fsp.copyFile(rows[0].staging_path, target, fs.constants.COPYFILE_EXCL); await fsp.chmod(target, 0o600); return target; }
  if (job.source_type === "upload_session") { const { rows } = await pool.query<{ staging_path: string }>("select staging_path from backup_restore_upload_sessions where upload_session_id=$1::uuid and status='completed'", [job.upload_session_id]); if (!rows[0]) throw new Error("Completed upload session is no longer available."); await fsp.copyFile(rows[0].staging_path, target, fs.constants.COPYFILE_EXCL); await fsp.chmod(target, 0o600); return target; }
  const { rows } = await pool.query<{ archive_name: string; remote_path: string; byte_size: string; sha256: string; destination_type: string; config: Record<string, unknown>; destination_id: string }>("select artifact.archive_name,copy.remote_path,copy.byte_size::text,copy.sha256,profile.destination_type,profile.config,profile.destination_id from backup_destination_copy_attempts copy join backup_artifacts artifact on artifact.artifact_id=copy.artifact_id join backup_destination_profiles profile on profile.destination_id=copy.destination_id where copy.copy_attempt_id=$1::uuid and copy.status='verified'", [job.copy_attempt_id]); const source = rows[0]; if (!source || !source.remote_path || !source.byte_size || !source.sha256) throw new Error("Verified destination copy is no longer available.");
  const input = { remotePath: source.remote_path, archiveName: source.archive_name, expectedSha256: source.sha256, expectedByteSize: Number(source.byte_size), maximumByteSize: MAX_ARCHIVE_BYTES, stagingDir: jobDir };
  const retrieved = source.destination_type === "local" ? await retrieveBackupV3FromLocalDestination({ ...input, rootPath: String(source.config.rootPath || "") }) : source.destination_type === "nextcloud" ? await retrieveBackupV3FromWebDavDestination({ ...input, config: source.config, credentials: { appPassword: String((await getBackupDestinationCredentials(source.destination_id)).appPassword || "") } }) : source.destination_type === "sftp" ? await retrieveBackupV3FromSftpDestination({ ...input, config: source.config, credentials: await getBackupDestinationCredentials(source.destination_id) }) : source.destination_type === "smb" ? await retrieveBackupV3FromSmbDestination({ ...input, config: source.config, credentials: { username: String((await getBackupDestinationCredentials(source.destination_id)).username || ""), password: String((await getBackupDestinationCredentials(source.destination_id)).password || "") } }) : await Promise.reject(new Error("Destination type cannot be retrieved for restore preview."));
  if (retrieved.stagingPath !== target) { await fsp.rename(retrieved.stagingPath, target); } return target;
}

async function claimPreviewJob() { const client = await pool.connect(); try { await client.query("begin"); const { rows } = await client.query<PreviewRow>("with candidate as (select preview_job_id from backup_restore_preview_jobs where status='queued' and expires_at > now() order by created_at for update skip locked limit 1) update backup_restore_preview_jobs job set status='running',progress=5 from candidate where job.preview_job_id=candidate.preview_job_id returning job.*"); await client.query("commit"); return rows[0]; } catch (error) { await client.query("rollback").catch(() => undefined); throw error; } finally { client.release(); } }
export async function runNextBackupV3RestorePreviewJob(): Promise<boolean> { const job = await claimPreviewJob(); if (!job) return false; const jobDir = path.join(stagingRoot("previews"), job.preview_job_id); try { await pool.query("update backup_restore_preview_jobs set progress=20 where preview_job_id=$1::uuid", [job.preview_job_id]); const archivePath = await materializePreviewSource(job, jobDir); const digest = await sha256File(archivePath); await pool.query("update backup_restore_preview_jobs set archive_path=$2,archive_sha256=$3,archive_size_bytes=$4,progress=50 where preview_job_id=$1::uuid", [job.preview_job_id, archivePath, digest.sha256, digest.byteSize]); const passphrase = previewPassphrases.get(job.preview_job_id); if (!passphrase) throw new Error("Preview passphrase is unavailable after restart; create a new preview job."); const preview = await previewBackupV3RestoreFromArchive(archivePath, path.join(jobDir, "staged"), passphrase); previewPassphrases.delete(job.preview_job_id); const fullManifest = JSON.parse(await fsp.readFile(path.join(jobDir, "staged", "manifest.json"), "utf8")); const currentHistory = (await fsp.readdir(path.join(getProjectRootDir(), "src", "db", "migrations"))).filter((file) => file.endsWith(".sql")).sort(); const compatibility = classifyBackupV3MigrationHistory(fullManifest, currentHistory); const errors = [...preview.errors, ...(compatibility.classification === "newer_than_runtime" || compatibility.classification === "unsupported_history" ? [compatibility.message] : [])]; await pool.query("update backup_restore_preview_jobs set status=$2,progress=100,manifest_summary=$3::jsonb,warnings=$4::jsonb,errors=$5::jsonb,compatibility_classification=$6,compatibility_message=$7,passphrase_valid=true,completed_at=now() where preview_job_id=$1::uuid", [job.preview_job_id, preview.ok && !errors.length ? "succeeded" : "failed", JSON.stringify({ ...preview.manifest, counts: preview.counts }), JSON.stringify(preview.warnings), JSON.stringify(errors), compatibility.classification, compatibility.message]); return true;
  } catch (error) { previewPassphrases.delete(job.preview_job_id); const message = error instanceof Error ? error.message : "Restore preview failed."; await pool.query("update backup_restore_preview_jobs set status='failed',progress=100,passphrase_valid=$2,errors=$3::jsonb,failure_diagnostics=$4,completed_at=now() where preview_job_id=$1::uuid", [job.preview_job_id, /passphrase|decrypt/i.test(message) ? false : null, JSON.stringify([message]), message]); return true; } }

export async function claimBackupV3PreviewForRestore(id: string) { const client = await pool.connect(); try { await client.query("begin"); const { rows } = await client.query<PreviewRow>("select * from backup_restore_preview_jobs where preview_job_id=$1::uuid for update", [id]); const job = rows[0]; if (!job) throw new HttpError(404, "Restore preview job was not found."); if (job.status !== "succeeded" || job.compatibility_classification !== "same_version" || job.expires_at <= new Date() || !job.archive_path || !job.archive_sha256 || job.archive_size_bytes == null) throw new HttpError(409, "Direct production restore requires a successful, unexpired same-version preview."); await client.query("update backup_restore_preview_jobs set status='consumed',consumed_at=now() where preview_job_id=$1::uuid", [id]); await client.query("commit"); return { archivePath: job.archive_path, archiveSha256: job.archive_sha256, archiveSizeBytes: Number(job.archive_size_bytes), stagingDir: path.join(path.dirname(job.archive_path), "staged") }; } catch (error) { await client.query("rollback").catch(() => undefined); throw error; } finally { client.release(); } }

export async function cleanupBackupV3RestoreJobs() {
  await pool.query("update backup_restore_upload_sessions set status='expired' where status in ('active','completed') and expires_at <= now()");
  await pool.query("update backup_restore_preview_jobs set status='expired' where status in ('queued','running','succeeded','failed') and expires_at <= now()");
  const uploads = await pool.query<{ upload_session_id: string; staging_path: string }>("select upload_session_id,staging_path from backup_restore_upload_sessions where cleanup_at is null and status in ('cancelled','failed','expired')");
  const previews = await pool.query<{ preview_job_id: string; archive_path: string | null }>("select preview_job_id,archive_path from backup_restore_preview_jobs where cleanup_at is null and status in ('failed','expired')");
  for (const row of uploads.rows) { await fsp.rm(path.dirname(row.staging_path), { recursive: true, force: true }); await pool.query("update backup_restore_upload_sessions set cleanup_at=now() where upload_session_id=$1::uuid", [row.upload_session_id]); }
  for (const row of previews.rows) { if (row.archive_path) await fsp.rm(path.dirname(row.archive_path), { recursive: true, force: true }); await pool.query("update backup_restore_preview_jobs set cleanup_at=now() where preview_job_id=$1::uuid", [row.preview_job_id]); }
  return { uploads: uploads.rowCount || 0, previews: previews.rowCount || 0 };
}
