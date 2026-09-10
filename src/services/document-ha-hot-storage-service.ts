import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { env } from "../config/env.js";
import { pool } from "../db/pool.js";
import { getTripoliToday } from "../utils/date.js";
import { logAuditEntry } from "./audit-service.js";
import { sha256Buffer, sha256File } from "./backup-v3-checksums.js";
import {
  ensureNetworkAuthIfNeeded,
  isTruthyDocumentStorageFlag,
  loadDocumentStorageConfig,
  type DocumentStorageConfig,
} from "./document-storage-config.js";
import {
  resolveStorageBasePath,
  resolveStoredPath,
  sanitizeDocumentFileName,
  toStoredPath,
} from "./document-storage-path.js";
import { loadSettingsMap } from "./settings-service.js";

const DEFAULT_RETENTION_HOURS = 48;
export const MIN_DOCUMENT_HA_RETENTION_HOURS = 24;
export const MAX_DOCUMENT_HA_RETENTION_HOURS = 168;
const DEFAULT_RECONCILIATION_BATCH_SIZE = 50;
const DOCUMENT_HA_LEASE_MINUTES = 60;

type AppointmentId = number | string | null | undefined;

export interface DocumentHaEligibilityInput {
  documentType: unknown;
  source: unknown;
  legacyAppointmentId?: AppointmentId;
  v2BookingId?: AppointmentId;
  incidentId?: AppointmentId;
}

export function isDocumentEligibleForHaHotStorage(input: DocumentHaEligibilityInput): boolean {
  if (input.incidentId != null || (input.legacyAppointmentId == null && input.v2BookingId == null)) return false;

  const documentType = String(input.documentType || "").trim();
  const source = String(input.source || "").trim();
  if (documentType === "appointment_request") {
    return new Set(["manual_upload", "naps2_webscan", "scanner_app", "request_scan_automation"]).has(source);
  }
  if (documentType === "clinical_document") {
    return new Set(["manual_upload", "naps2_webscan", "scanner_app", "modality_scan_automation"]).has(source);
  }
  return false;
}

export function normalizeDocumentHaRetentionHours(raw: unknown): number {
  const parsed = Number(String(raw ?? "").trim());
  if (!Number.isFinite(parsed) || !Number.isInteger(parsed)) return DEFAULT_RETENTION_HOURS;
  return Math.min(MAX_DOCUMENT_HA_RETENTION_HOURS, Math.max(MIN_DOCUMENT_HA_RETENTION_HOURS, parsed));
}

export interface DocumentHaHotStorageSettings {
  enabled: boolean;
  retentionHours: number;
}

export async function loadDocumentHaHotStorageSettings(): Promise<DocumentHaHotStorageSettings> {
  const settingsMap = await loadSettingsMap(["documents_and_uploads"]);
  const settings = settingsMap.documents_and_uploads || {};
  return {
    enabled: isTruthyDocumentStorageFlag(settings.ha_hot_storage_enabled ?? "true"),
    retentionHours: normalizeDocumentHaRetentionHours(settings.ha_hot_storage_retention_hours ?? DEFAULT_RETENTION_HOURS),
  };
}

type DocumentHaDatabaseExecutor = { query: typeof pool.query };

export async function persistDocumentHaBlob(
  executor: DocumentHaDatabaseExecutor,
  documentId: number,
  content: Buffer,
  retentionHours: number,
): Promise<{ byteSize: number; contentSha256: string }> {
  const digest = sha256Buffer(content);
  const safeRetentionHours = normalizeDocumentHaRetentionHours(retentionHours);
  try {
    const result = await executor.query(
      `
        insert into document_ha_blobs(document_id, content, byte_size, content_sha256, retention_due_at)
        values($1, $2, $3, $4, now() + ($5::int * interval '1 hour'))
        on conflict(document_id) do nothing
      `,
      [documentId, content, content.length, digest, safeRetentionHours],
    );
    logDocumentHaEvent("document_ha_blob_created", {
      documentId,
      byteSize: content.length,
      contentSha256: digest,
      retentionHours: safeRetentionHours,
      created: Number(result.rowCount || 0) === 1,
    });
    return { byteSize: content.length, contentSha256: digest };
  } catch (error) {
    logDocumentHaEvent("document_ha_blob_create_failed", {
      documentId,
      byteSize: content.length,
      contentSha256: digest,
      error: sanitizeHaError(error),
    });
    throw error;
  }
}

export interface DocumentContentRecord {
  id: number;
  stored_path: string;
  file_size?: number | string | null;
  content_sha256?: string | null;
}

function errorCode(error: unknown): string | null {
  if (error && typeof error === "object" && "code" in error) {
    const code = String((error as { code?: unknown }).code || "").trim();
    return code || null;
  }
  return null;
}

function sanitizeHaError(error: unknown): string {
  const raw = error instanceof Error ? error.message : String(error ?? "Unknown storage error");
  return raw
    .replace(/(?:[A-Za-z]:[\\/]|\\\\|\/)[^\r\n"'<>|?*]*/g, "storage path")
    .replace(/[\r\n\t]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 300) || "Unknown storage error";
}

function storageErrorClassification(error: unknown): string {
  return errorCode(error) || (error instanceof Error && error.name ? error.name : "storage_error");
}

function logDocumentHaEvent(event: string, fields: Record<string, unknown> = {}): void {
  console.info(JSON.stringify({ type: event, ...fields }));
}

function isPathWithin(root: string, candidate: string): boolean {
  const relative = path.relative(path.normalize(root), path.normalize(candidate));
  return relative === "" || (relative !== ".." && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative));
}

function approvedStorageRoots(config: DocumentStorageConfig): string[] {
  const roots = [resolveStorageBasePath(env.uploadsDir)];
  if (config.storagePath) {
    try {
      roots.push(resolveStorageBasePath(config.storagePath));
    } catch {
      // An invalid configured network path cannot make an existing file valid.
    }
  }
  return [...new Set(roots.map((root) => path.normalize(root)))];
}

type HaBlobIntegrity = {
  valid: boolean;
  reason?: string;
};

function verifyHaBlobIntegrity(content: Buffer, byteSize: number, contentSha256: string): HaBlobIntegrity {
  if (!Number.isSafeInteger(byteSize) || byteSize <= 0) return { valid: false, reason: "invalid_byte_size" };
  if (content.length !== byteSize) return { valid: false, reason: "byte_size_mismatch" };
  if (!/^[0-9a-f]{64}$/.test(contentSha256)) return { valid: false, reason: "invalid_sha256" };
  return sha256Buffer(content) === contentSha256 ? { valid: true } : { valid: false, reason: "sha256_mismatch" };
}

export async function readDocumentContent(document: DocumentContentRecord): Promise<Buffer> {
  let primaryError: unknown;
  try {
    return await fs.readFile(resolveStoredPath(document.stored_path));
  } catch (error) {
    primaryError = error;
    logDocumentHaEvent("document_ha_primary_read_failed", {
      documentId: document.id,
      storageError: storageErrorClassification(error),
      error: sanitizeHaError(error),
    });
  }

  const result = await pool.query<{ content: Buffer; byte_size: number | string; content_sha256: string }>(
    "select content, byte_size, content_sha256 from document_ha_blobs where document_id=$1 limit 1",
    [document.id],
  );
  const row = result.rows[0];
  if (!row) throw primaryError;

  const content = Buffer.isBuffer(row.content) ? row.content : Buffer.from(row.content as unknown as Uint8Array);
  const integrity = verifyHaBlobIntegrity(content, Number(row.byte_size), row.content_sha256);
  if (!integrity.valid || (document.file_size != null && Number(document.file_size) !== content.length) || (document.content_sha256 && document.content_sha256 !== row.content_sha256)) {
    logDocumentHaEvent("document_ha_blob_fallback_invalid", {
      documentId: document.id,
      byteSize: content.length,
      contentSha256: row.content_sha256,
      reason: integrity.reason || "document_metadata_mismatch",
    });
    throw primaryError;
  }

  logDocumentHaEvent("document_ha_blob_fallback_read", {
    documentId: document.id,
    byteSize: content.length,
    contentSha256: row.content_sha256,
  });
  return content;
}

type DocumentHaWorkRow = {
  document_id: number;
  content: Buffer;
  byte_size: number | string;
  content_sha256: string;
  created_at: string;
  retention_due_at: string;
  stored_path: string;
  storage_location_type: "network" | "local_fallback";
  file_size: number | string | null;
  document_content_sha256: string | null;
  original_filename: string;
};

export interface DocumentHaReconciliationSummary {
  checked: number;
  released: number;
  repaired: number;
  failed: number;
}

export interface DocumentHaReconciliationTestHooks {
  beforeDocumentMetadataUpdate?: (input: { documentId: number; recoveryPath: string }) => Promise<void>;
}

let documentHaReconciliationTestHooks: DocumentHaReconciliationTestHooks = {};

export function __setDocumentHaReconciliationHooksForTests(hooks: DocumentHaReconciliationTestHooks | null): void {
  documentHaReconciliationTestHooks = hooks || {};
}

async function claimNextDocumentHaBlob(workerId: string, excludedDocumentIds: number[] = []): Promise<DocumentHaWorkRow | null> {
  const claim = await pool.query<{ document_id: number }>(
    `
      with candidate as (
        select document_id
        from document_ha_blobs
        where retention_due_at <= now()
          and (reconciliation_lease_expires_at is null or reconciliation_lease_expires_at <= now())
          and document_id <> all($3::bigint[])
        order by retention_due_at asc, document_id asc
        for update skip locked
        limit 1
      )
      update document_ha_blobs blob
      set reconciliation_lease_owner=$1,
          reconciliation_lease_expires_at=now() + ($2::int * interval '1 minute')
      from candidate
      where blob.document_id=candidate.document_id
      returning blob.document_id
    `,
    [workerId, DOCUMENT_HA_LEASE_MINUTES, excludedDocumentIds],
  );
  const documentId = claim.rows[0]?.document_id;
  if (!documentId) return null;

  const work = await pool.query<DocumentHaWorkRow>(
    `
      select
        blob.document_id,
        blob.content,
        blob.byte_size,
        blob.content_sha256,
        blob.created_at,
        blob.retention_due_at,
        d.stored_path,
        d.storage_location_type,
        d.file_size,
        d.content_sha256 as document_content_sha256,
        d.original_filename
      from document_ha_blobs blob
      join documents d on d.id=blob.document_id
      where blob.document_id=$1 and blob.reconciliation_lease_owner=$2
      limit 1
    `,
    [documentId, workerId],
  );
  return work.rows[0] || null;
}

async function clearDocumentHaLease(documentId: number, workerId: string): Promise<void> {
  await pool.query(
    "update document_ha_blobs set reconciliation_lease_owner=null, reconciliation_lease_expires_at=null where document_id=$1 and reconciliation_lease_owner=$2",
    [documentId, workerId],
  );
}

type StoredFileVerification = {
  valid: boolean;
  absolutePath: string | null;
  reason?: string;
};

async function verifyStoredDocumentFile(work: DocumentHaWorkRow, config: DocumentStorageConfig, storedPath = work.stored_path, fileSize = Number(work.file_size), contentSha256 = work.document_content_sha256): Promise<StoredFileVerification> {
  const expectedSize = Number(work.byte_size);
  const expectedSha256 = work.content_sha256;
  if (fileSize !== expectedSize) return { valid: false, absolutePath: null, reason: "document_metadata_size_mismatch" };
  if (contentSha256 && contentSha256 !== expectedSha256) return { valid: false, absolutePath: null, reason: "document_metadata_sha256_mismatch" };

  let absolutePath: string;
  try {
    absolutePath = resolveStoredPath(storedPath);
  } catch (error) {
    return { valid: false, absolutePath: null, reason: storageErrorClassification(error) };
  }
  if (!approvedStorageRoots(config).some((root) => isPathWithin(root, absolutePath))) {
    return { valid: false, absolutePath, reason: "storage_path_not_approved" };
  }

  try {
    const stat = await fs.stat(absolutePath);
    if (!stat.isFile()) return { valid: false, absolutePath, reason: "stored_path_not_regular_file" };
    if (stat.size !== expectedSize) return { valid: false, absolutePath, reason: "stored_file_size_mismatch" };
    const digest = await sha256File(absolutePath);
    if (digest.byteSize !== expectedSize) return { valid: false, absolutePath, reason: "stored_file_size_mismatch" };
    if (digest.sha256 !== expectedSha256) return { valid: false, absolutePath, reason: "stored_file_sha256_mismatch" };
    return { valid: true, absolutePath };
  } catch (error) {
    return { valid: false, absolutePath, reason: storageErrorClassification(error) };
  }
}

async function verifyFileBytes(filePath: string, expectedSize: number, expectedSha256: string): Promise<void> {
  const stat = await fs.stat(filePath);
  if (!stat.isFile() || stat.size !== expectedSize) throw new Error("Recovered document size verification failed.");
  const digest = await sha256File(filePath);
  if (digest.byteSize !== expectedSize || digest.sha256 !== expectedSha256) throw new Error("Recovered document SHA-256 verification failed.");
}

async function writeVerifiedRecoveryFile(basePath: string, originalFilename: string, content: Buffer, expectedSize: number, expectedSha256: string): Promise<{ absolutePath: string; storedPath: string }> {
  const normalizedBasePath = resolveStorageBasePath(basePath);
  const stagingDirectory = path.join(normalizedBasePath, ".rispro-document-staging");
  const targetDirectory = path.join(normalizedBasePath, getTripoliToday());
  const safeFilename = sanitizeDocumentFileName(originalFilename || "document.bin");
  const stagingPath = path.join(stagingDirectory, `${crypto.randomUUID()}-${safeFilename}`);
  const absolutePath = path.join(targetDirectory, `${Date.now()}-${crypto.randomUUID()}-${safeFilename}`);
  await fs.mkdir(stagingDirectory, { recursive: true });
  try {
    await fs.writeFile(stagingPath, content, { flag: "wx" });
    await verifyFileBytes(stagingPath, expectedSize, expectedSha256);
    await fs.mkdir(targetDirectory, { recursive: true });
    await fs.rename(stagingPath, absolutePath);
    await verifyFileBytes(absolutePath, expectedSize, expectedSha256);
    return { absolutePath, storedPath: toStoredPath(absolutePath) };
  } catch (error) {
    await fs.unlink(stagingPath).catch(() => undefined);
    await fs.unlink(absolutePath).catch(() => undefined);
    throw error;
  }
}

async function removeRecoveredFile(absolutePath: string): Promise<void> {
  await fs.unlink(absolutePath).catch((error) => {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  });
}

async function repairDocumentFromHaBlob(work: DocumentHaWorkRow, config: DocumentStorageConfig, content: Buffer): Promise<{ absolutePath: string; storedPath: string; storageLocationType: "network" | "local_fallback" }> {
  const expectedSize = Number(work.byte_size);
  const expectedSha256 = work.content_sha256;
  const failures: string[] = [];

  if (config.storagePath) {
    try {
      ensureNetworkAuthIfNeeded(config);
      const restored = await writeVerifiedRecoveryFile(resolveStorageBasePath(config.storagePath), work.original_filename, content, expectedSize, expectedSha256);
      return { ...restored, storageLocationType: "network" };
    } catch (error) {
      failures.push(`network: ${sanitizeHaError(error)}`);
      logDocumentHaEvent("document_ha_repair_network_failed", { documentId: work.document_id, storageError: storageErrorClassification(error), error: sanitizeHaError(error) });
    }
  }

  if (config.fallbackEnabled) {
    logDocumentHaEvent("document_ha_repair_local_fallback", { documentId: work.document_id, storageLocationType: "local_fallback" });
    try {
      const restored = await writeVerifiedRecoveryFile(resolveStorageBasePath(env.uploadsDir), work.original_filename, content, expectedSize, expectedSha256);
      return { ...restored, storageLocationType: "local_fallback" };
    } catch (error) {
      failures.push(`local_fallback: ${sanitizeHaError(error)}`);
    }
  }

  throw new Error(failures.join("; ") || "No approved document storage destination is available.");
}

async function recordDocumentHaFailure(work: DocumentHaWorkRow, workerId: string, error: unknown): Promise<void> {
  const message = sanitizeHaError(error);
  await pool.query("update documents set last_move_attempt_at=now(), last_move_error=$2 where id=$1", [work.document_id, message]).catch(() => undefined);
  await clearDocumentHaLease(work.document_id, workerId).catch(() => undefined);
  logDocumentHaEvent("document_ha_repair_failed", {
    documentId: work.document_id,
    byteSize: Number(work.byte_size),
    contentSha256: work.content_sha256,
    error: message,
  });
  logDocumentHaEvent("document_ha_blob_retained_for_recovery", {
    documentId: work.document_id,
    byteSize: Number(work.byte_size),
    contentSha256: work.content_sha256,
    error: message,
  });
}

async function releaseDocumentHaBlob(work: DocumentHaWorkRow, workerId: string): Promise<boolean> {
  const deleted = await pool.query(
    "delete from document_ha_blobs where document_id=$1 and reconciliation_lease_owner=$2",
    [work.document_id, workerId],
  );
  if (Number(deleted.rowCount || 0) !== 1) return false;
  logDocumentHaEvent("document_ha_blob_released", {
    documentId: work.document_id,
    byteSize: Number(work.byte_size),
    contentSha256: work.content_sha256,
  });
  return true;
}

async function reconcileClaimedDocumentHaBlob(work: DocumentHaWorkRow, workerId: string): Promise<"released" | "repaired" | "failed"> {
  logDocumentHaEvent("document_ha_retention_verify_started", {
    documentId: work.document_id,
    byteSize: Number(work.byte_size),
    contentSha256: work.content_sha256,
    retentionDueAt: work.retention_due_at,
  });

  const content = Buffer.isBuffer(work.content) ? work.content : Buffer.from(work.content as unknown as Uint8Array);
  const blobIntegrity = verifyHaBlobIntegrity(content, Number(work.byte_size), work.content_sha256);
  if (!blobIntegrity.valid) {
    await recordDocumentHaFailure(work, workerId, new Error(`HA blob integrity check failed: ${blobIntegrity.reason}.`));
    return "failed";
  }

  const config = await loadDocumentStorageConfig();
  const current = await verifyStoredDocumentFile(work, config);
  if (current.valid) {
    const released = await releaseDocumentHaBlob(work, workerId);
    if (released) {
      logDocumentHaEvent("document_ha_retention_verified", { documentId: work.document_id, released: true, storageLocationType: work.storage_location_type });
      return "released";
    }
    return "failed";
  }

  logDocumentHaEvent("document_ha_repair_started", {
    documentId: work.document_id,
    byteSize: Number(work.byte_size),
    contentSha256: work.content_sha256,
    reason: current.reason || "stored_file_invalid",
  });
  try {
    const restored = await repairDocumentFromHaBlob(work, config, content);
    const expectedSize = Number(work.byte_size);
    await verifyFileBytes(restored.absolutePath, expectedSize, work.content_sha256);
    const metadata = {
      id: work.document_id,
      stored_path: restored.storedPath,
      file_size: expectedSize,
      content_sha256: work.content_sha256,
    };
    await documentHaReconciliationTestHooks.beforeDocumentMetadataUpdate?.({
      documentId: work.document_id,
      recoveryPath: restored.absolutePath,
    });
    const metadataUpdate = await pool.query<{ id: number }>(
      `
        update documents
        set stored_path=$2,
            storage_location_type=$3,
            file_size=$4,
            content_sha256=$5,
            last_move_attempt_at=now(),
            last_move_error=null
        where id=$1
        returning id
      `,
      [work.document_id, restored.storedPath, restored.storageLocationType, expectedSize, work.content_sha256],
    );
    if (Number(metadataUpdate.rowCount || 0) !== 1) {
      await removeRecoveredFile(restored.absolutePath);
      await releaseDocumentHaBlob(work, workerId).catch(() => undefined);
      logDocumentHaEvent("document_ha_document_deleted_during_repair", {
        documentId: work.document_id,
        recoveryPath: restored.storedPath,
        recoveryFileRemoved: true,
      });
      return "released";
    }
    const finalVerification = await verifyStoredDocumentFile({ ...work, ...metadata, storage_location_type: restored.storageLocationType }, config, restored.storedPath, expectedSize, work.content_sha256);
    if (!finalVerification.valid) throw new Error(`Final recovered document verification failed: ${finalVerification.reason || "unknown"}.`);
    const released = await releaseDocumentHaBlob(work, workerId);
    if (!released) return "failed";
    logDocumentHaEvent("document_ha_repair_succeeded", {
      documentId: work.document_id,
      byteSize: expectedSize,
      contentSha256: work.content_sha256,
      storageLocationType: restored.storageLocationType,
    });
    logDocumentHaEvent("document_ha_retention_verified", { documentId: work.document_id, released: true, repaired: true, storageLocationType: restored.storageLocationType });
    await logAuditEntry({
      entityType: "document",
      entityId: work.document_id,
      actionType: "document_storage_repaired_from_ha",
      oldValues: { storageLocationType: work.storage_location_type },
      newValues: { documentId: work.document_id, newStorageLocationType: restored.storageLocationType, byteSize: expectedSize, contentSha256: work.content_sha256, repairTimestamp: new Date().toISOString() },
      changedByUserId: null,
    }).catch((error) => logDocumentHaEvent("document_ha_repair_audit_failed", { documentId: work.document_id, error: sanitizeHaError(error) }));
    return "repaired";
  } catch (error) {
    await recordDocumentHaFailure(work, workerId, error);
    return "failed";
  }
}

export async function runDocumentHaStorageReconciliation(options: { batchSize?: number; workerId?: string } = {}): Promise<DocumentHaReconciliationSummary> {
  const batchSize = Math.max(1, Math.min(DEFAULT_RECONCILIATION_BATCH_SIZE, Math.floor(options.batchSize ?? DEFAULT_RECONCILIATION_BATCH_SIZE)));
  const workerId = options.workerId || `document-ha-${crypto.randomUUID()}`;
  const summary: DocumentHaReconciliationSummary = { checked: 0, released: 0, repaired: 0, failed: 0 };
  const processedDocumentIds = new Set<number>();
  for (let index = 0; index < batchSize; index += 1) {
    const work = await claimNextDocumentHaBlob(workerId, [...processedDocumentIds]);
    if (!work) break;
    processedDocumentIds.add(work.document_id);
    summary.checked += 1;
    try {
      const outcome = await reconcileClaimedDocumentHaBlob(work, workerId);
      if (outcome === "released") summary.released += 1;
      else if (outcome === "repaired") summary.repaired += 1;
      else summary.failed += 1;
    } catch (error) {
      summary.failed += 1;
      await recordDocumentHaFailure(work, workerId, error);
    }
  }
  return summary;
}

export interface DocumentHaHotStorageWorker {
  stop(): Promise<void>;
}

let workerInterval: NodeJS.Timeout | null = null;
let workerRunning = false;
let workerStopped = false;

export async function startDocumentHaHotStorageWorker(options: { intervalMs?: number; batchSize?: number } = {}): Promise<DocumentHaHotStorageWorker> {
  if (workerInterval) return { stop: async () => undefined };
  const intervalMs = Math.max(5_000, options.intervalMs ?? 60 * 60 * 1000);
  workerStopped = false;
  const run = () => {
    if (workerRunning || workerStopped) return;
    workerRunning = true;
    void runDocumentHaStorageReconciliation({ batchSize: options.batchSize })
      .then((summary) => logDocumentHaEvent("document_ha_reconciliation_completed", { ...summary }))
      .catch((error) => logDocumentHaEvent("document_ha_reconciliation_failed", { error: sanitizeHaError(error) }))
      .finally(() => { workerRunning = false; });
  };
  logDocumentHaEvent("document_ha_reconciliation_worker_started", { intervalMs, batchSize: options.batchSize ?? DEFAULT_RECONCILIATION_BATCH_SIZE });
  run();
  workerInterval = setInterval(run, intervalMs);
  workerInterval.unref();
  return {
    async stop() {
      workerStopped = true;
      if (workerInterval) {
        clearInterval(workerInterval);
        workerInterval = null;
      }
      while (workerRunning) await new Promise((resolve) => setTimeout(resolve, 100));
    },
  };
}
