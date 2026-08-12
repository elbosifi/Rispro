import crypto from "node:crypto";
import fs from "fs/promises";
import path from "path";
import type { PoolClient } from "pg";
import { env } from "../config/env.js";
import { pool } from "../db/pool.js";
import { HttpError } from "../utils/http-error.js";
import { normalizePositiveInteger } from "../utils/normalize.js";
import { getTripoliToday } from "../utils/date.js";
import { logAuditEntry } from "./audit-service.js";
import { loadSettingsMap } from "./settings-service.js";
import {
  isUncPath,
  resolveStorageBasePath,
  resolveStoredPath,
  toStoredPath,
} from "./document-storage-path.js";
import type { UserId, OptionalUserId } from "../types/http.js";
import type { DbQueryResult } from "../types/db.js";
import { enqueueClinicalDocumentExportsForAppointmentAutomatically, isClinicalDocumentExportDocumentType } from "./clinical-document-export-queue-service.js";
import { sha256Buffer, sha256File } from "./backup-v3-checksums.js";

export interface DocumentUploadPayload {
  patientId?: UserId;
  appointmentId?: UserId;
  appointmentRefType?: string;
  documentType?: string;
  originalFilename?: string;
  mimeType?: string;
  fileContentBase64?: string;
  fileContentBuffer?: Buffer;
  fileSourcePath?: string;
  source?: string;
  scanSessionId?: UserId;
  pageCount?: number | null;
  scannerName?: string | null;
  workstationName?: string | null;
  appVersion?: string | null;
  idempotencyKey?: string | null;
  requestScanJobId?: number | null;
}

export interface DocumentRow {
  id: number;
  patient_id: number | null;
  appointment_id: number | null;
  v2_booking_id: number | null;
  document_type: string;
  original_filename: string;
  stored_path: string;
  mime_type: string;
  file_size: number;
  content_sha256?: string | null;
  storage_location_type: "network" | "local_fallback";
  source: "manual_upload" | "naps2_webscan" | "scanner_app" | "request_scan_automation" | "modality_scan_automation";
  scan_session_id?: number | null;
  page_count?: number | null;
  scanner_name?: string | null;
  workstation_name?: string | null;
  app_version?: string | null;
  last_move_attempt_at: string | null;
  last_move_error: string | null;
  created_at: string;
  request_scan_job_id?: number | null;
}

interface DocumentFilters {
  patientId?: UserId;
  appointmentId?: UserId;
  appointmentRefType?: string;
}

export interface DocumentsDeleteScope {
  mode: "all" | "appointment_date_range";
  dateFrom?: string;
  dateTo?: string;
}

export interface DocumentsDeleteResult {
  deletedCount: number;
  failedCount: number;
  failures: Array<{ documentId: number; reason: string }>;
}

export interface DocumentsMoveResult {
  movedCount: number;
  failedCount: number;
  skippedCount: number;
  failures: Array<{ documentId: number; reason: string }>;
}

interface StorageConfig {
  storagePath: string;
  authUsername: string;
  authPassword: string;
  authDomain: string;
  fallbackEnabled: boolean;
}

export const MAX_DOCUMENT_BYTES = 50 * 1024 * 1024;
const ALLOWED_MIME_TYPES = new Set(["application/pdf", "image/jpeg", "image/png"]);

function sanitizeFileName(fileName: unknown): string {
  const cleaned = String(fileName || "document")
    .replace(/[^a-zA-Z0-9._-]/g, "_")
    .replace(/_+/g, "_");

  return cleaned || "document";
}

function decodeBase64File(fileContentBase64: unknown): Buffer {
  const raw = String(fileContentBase64 || "").trim();

  if (!raw) {
    throw new HttpError(400, "fileContentBase64 is required.");
  }

  const normalized = raw.includes(",") ? raw.split(",").pop() : raw;
  return Buffer.from(normalized || "", "base64");
}

function resolveFileBuffer(payload: DocumentUploadPayload): Buffer {
  if (payload.fileContentBuffer) {
    return payload.fileContentBuffer;
  }
  return decodeBase64File(payload.fileContentBase64);
}

async function ensureRelatedRecords(patientId: number | null, appointmentId: number | null, executor: DocumentDatabaseExecutor = pool): Promise<void> {
  if (!patientId && !appointmentId) {
    throw new HttpError(400, "patientId or appointmentId is required.");
  }

  if (patientId) {
    const { rowCount } = await executor.query("select 1 from patients where id = $1 limit 1", [patientId]);
    if (Number(rowCount || 0) === 0) {
      throw new HttpError(404, "Patient not found.");
    }
  }
}

async function ensureAppointmentBelongsToPatient(reference: AppointmentReference, patientId: number | null, executor: DocumentDatabaseExecutor = pool): Promise<void> {
  if (!patientId) return;

  if (reference.legacyAppointmentId) {
    const { rowCount } = await executor.query(
      "select 1 from appointments where id = $1 and patient_id = $2 limit 1",
      [reference.legacyAppointmentId, patientId]
    );
    if (Number(rowCount || 0) === 0) {
      throw new HttpError(400, "Appointment does not belong to patient.");
    }
  }

  if (reference.v2BookingId) {
    const { rowCount } = await executor.query(
      "select 1 from appointments_v2.bookings where id = $1 and patient_id = $2 limit 1",
      [reference.v2BookingId, patientId]
    );
    if (Number(rowCount || 0) === 0) {
      throw new HttpError(400, "Appointment does not belong to patient.");
    }
  }
}

type AppointmentReference = {
  legacyAppointmentId: number | null;
  v2BookingId: number | null;
};

type AppointmentRefType = "legacy_appointment" | "v2_booking" | "auto";

function normalizeAppointmentRefType(
  refType: unknown
): AppointmentRefType {
  const value = String(refType || "").trim().toLowerCase();
  if (value === "legacy_appointment") return "legacy_appointment";
  if (value === "v2_booking") return "v2_booking";
  return "auto";
}

async function findLegacyAppointmentId(appointmentId: number, executor: DocumentDatabaseExecutor = pool): Promise<number | null> {
  const { rowCount } = await executor.query("select 1 from appointments where id = $1 limit 1", [appointmentId]);
  return Number(rowCount || 0) > 0 ? appointmentId : null;
}

async function findV2BookingId(appointmentId: number, executor: DocumentDatabaseExecutor = pool): Promise<number | null> {
  const { rowCount } = await executor.query("select 1 from appointments_v2.bookings where id = $1 limit 1", [appointmentId]);
  return Number(rowCount || 0) > 0 ? appointmentId : null;
}

async function resolveAppointmentReference(
  appointmentId: number | null,
  refType: AppointmentRefType,
  executor: DocumentDatabaseExecutor = pool,
): Promise<AppointmentReference> {
  if (!appointmentId) {
    return { legacyAppointmentId: null, v2BookingId: null };
  }

  if (refType === "legacy_appointment") {
    const legacyAppointmentId = await findLegacyAppointmentId(appointmentId, executor);
    if (!legacyAppointmentId) throw new HttpError(404, "Appointment not found.");
    return { legacyAppointmentId, v2BookingId: null };
  }

  if (refType === "v2_booking") {
    const v2BookingId = await findV2BookingId(appointmentId, executor);
    if (!v2BookingId) throw new HttpError(404, "Appointment not found.");
    return { legacyAppointmentId: null, v2BookingId };
  }

  // Auto mode: prefer V2 for modern UI flows.
  const v2BookingId = await findV2BookingId(appointmentId, executor);
  if (v2BookingId) {
    return { legacyAppointmentId: null, v2BookingId };
  }
  const legacyAppointmentId = await findLegacyAppointmentId(appointmentId, executor);
  if (legacyAppointmentId) {
    return { legacyAppointmentId, v2BookingId: null };
  }
  throw new HttpError(404, "Appointment not found.");
}

function isTruthyFlag(raw: string): boolean {
  return ["true", "1", "yes", "enabled", "on"].includes(String(raw || "").trim().toLowerCase());
}

function normalizeDocumentSource(source: unknown): "manual_upload" | "naps2_webscan" | "scanner_app" | "request_scan_automation" | "modality_scan_automation" {
  const normalized = String(source || "").trim();
  if (normalized === "naps2_webscan") return "naps2_webscan";
  if (normalized === "scanner_app") return "scanner_app";
  if (normalized === "request_scan_automation") return "request_scan_automation";
  if (normalized === "modality_scan_automation") return "modality_scan_automation";
  return "manual_upload";
}

async function loadDocumentStorageConfig(): Promise<StorageConfig> {
  const settingsMap = await loadSettingsMap(["documents_and_uploads"]);
  const settings = settingsMap.documents_and_uploads || {};
  return {
    storagePath: String(settings.storage_path || "").trim(),
    authUsername: String(settings.storage_auth_username || "").trim(),
    authPassword: String(settings.storage_auth_password || ""),
    authDomain: String(settings.storage_auth_domain || "").trim(),
    fallbackEnabled: isTruthyFlag(String(settings.storage_fallback_enabled || "true")),
  };
}

function buildNetworkAuthUsername(config: StorageConfig): string {
  if (!config.authUsername) return "";
  if (!config.authDomain) return config.authUsername;
  return `${config.authDomain}\\${config.authUsername}`;
}

function ensureNetworkAuthIfNeeded(config: StorageConfig): void {
  const rawPath = String(config.storagePath || "");
  if (!rawPath || !isUncPath(rawPath)) return;
  if (!config.authUsername || !config.authPassword) {
    throw new HttpError(503, "Network storage path requires authentication credentials.");
  }
}

async function writeFileToStorageTarget(
  absoluteBasePath: string,
  originalFilename: string,
  source: { buffer?: Buffer; path?: string },
): Promise<{ absolutePath: string; relativePath: string }> {
  const dateFolder = getTripoliToday();
  const targetDirectory = path.join(absoluteBasePath, dateFolder);
  await fs.mkdir(targetDirectory, { recursive: true });
  const storedFileName = `${Date.now()}-${crypto.randomUUID()}-${originalFilename}`;
  const absoluteStoredPath = path.join(targetDirectory, storedFileName);
  if (source.path) await fs.copyFile(source.path, absoluteStoredPath);
  else await fs.writeFile(absoluteStoredPath, source.buffer!);
  return {
    absolutePath: absoluteStoredPath,
    relativePath: toStoredPath(absoluteStoredPath),
  };
}

export async function listDocuments(
  filters: DocumentFilters = {}
): Promise<DocumentRow[]> {
  const params: unknown[] = [];
  const conditions: string[] = [];
  const appointmentRefType = normalizeAppointmentRefType(filters.appointmentRefType);

  if (filters.patientId) {
    params.push(normalizePositiveInteger(filters.patientId, "patientId"));
    conditions.push(`d.patient_id = $${params.length}`);
  }

  if (filters.appointmentId) {
    params.push(normalizePositiveInteger(filters.appointmentId, "appointmentId"));
    const appointmentIdIndex = params.length;
    if (appointmentRefType === "legacy_appointment") {
      conditions.push(`d.appointment_id = $${appointmentIdIndex}`);
    } else if (appointmentRefType === "v2_booking") {
      conditions.push(`(d.v2_booking_id = $${appointmentIdIndex} or exists(select 1 from document_appointment_links link where link.document_id=d.id and link.appointment_id=$${appointmentIdIndex}))`);
    } else {
      conditions.push(`(d.appointment_id = $${appointmentIdIndex} or d.v2_booking_id = $${appointmentIdIndex} or exists(select 1 from document_appointment_links link where link.document_id=d.id and link.appointment_id=$${appointmentIdIndex}))`);
    }
  }

  const whereClause = conditions.length ? `where ${conditions.join(" and ")}` : "";
  const { rows } = await pool.query(
    `
      select
        d.id,
        d.patient_id,
        d.appointment_id,
        d.v2_booking_id,
        d.document_type,
        d.original_filename,
        d.stored_path,
        d.mime_type,
        d.file_size,
        d.storage_location_type,
        d.source,
        d.scan_session_id,
        d.page_count,
        d.scanner_name,
        d.workstation_name,
        d.app_version,
        d.last_move_attempt_at,
        d.last_move_error,
        d.created_at
      from documents d
      ${whereClause}
      order by d.created_at desc
      limit 50
    `,
    params
  );

  return rows as DocumentRow[];
}

export async function getDocumentById(documentId: UserId): Promise<DocumentRow> {
  const cleanDocumentId = normalizePositiveInteger(documentId, "documentId");
  const { rows } = await pool.query(
    `
      select
        id,
        patient_id,
        appointment_id,
        v2_booking_id,
        document_type,
        original_filename,
        stored_path,
        mime_type,
        file_size,
        storage_location_type,
        source,
        scan_session_id,
        page_count,
        scanner_name,
        workstation_name,
        app_version,
        last_move_attempt_at,
        last_move_error,
        created_at
      from documents
      where id = $1
      limit 1
    `,
    [cleanDocumentId]
  );

  const document = (rows as DocumentRow[])[0];

  if (!document) {
    throw new HttpError(404, "Document not found.");
  }

  return document;
}

export function getDocumentAbsolutePath(document: { stored_path?: string }): string {
  return resolveStoredPath(document.stored_path);
}

type DocumentDatabaseExecutor = { query: typeof pool.query };

type RequestScanFingerprintProfile = {
  documentType: "clinical_document" | "appointment_request";
  source: "modality_scan_automation" | "request_scan_automation";
  reuseAcrossAppointments: boolean;
};

function requestScanFingerprintProfile(payload: DocumentUploadPayload): RequestScanFingerprintProfile | null {
  const documentType = String(payload.documentType || "appointment_request").trim();
  const source = normalizeDocumentSource(payload.source);
  if (documentType === "clinical_document" && source === "modality_scan_automation") {
    return { documentType, source, reuseAcrossAppointments: true };
  }
  if (documentType === "appointment_request" && source === "request_scan_automation") {
    return { documentType, source, reuseAcrossAppointments: false };
  }
  return null;
}

async function findRequestScanDocumentDuplicate(
  queryable: DocumentDatabaseExecutor,
  profile: RequestScanFingerprintProfile,
  patientId: number,
  appointmentId: number | null,
  fingerprint: { sha256: string; byteSize: number },
): Promise<DocumentRow | null> {
  if (!profile.reuseAcrossAppointments && !appointmentId) return null;
  const appointmentPredicate = profile.reuseAcrossAppointments
    ? ""
    : "and (d.v2_booking_id=$6 or exists(select 1 from document_appointment_links link where link.document_id=d.id and link.appointment_id=$6))";
  const exact = await queryable.query<DocumentRow>(
    `select d.* from documents d
      where d.patient_id=$1 and d.document_type=$2 and d.source=$3
        and d.file_size=$4 and d.content_sha256=$5 ${appointmentPredicate}
      order by id asc limit 1`,
    profile.reuseAcrossAppointments
      ? [patientId, profile.documentType, profile.source, fingerprint.byteSize, fingerprint.sha256]
      : [patientId, profile.documentType, profile.source, fingerprint.byteSize, fingerprint.sha256, appointmentId],
  );
  if (exact.rows[0]) return exact.rows[0];

  if (!profile.reuseAcrossAppointments && !appointmentId) return null;
  const legacyAppointmentPredicate = profile.reuseAcrossAppointments
    ? ""
    : "and (d.v2_booking_id=$5 or exists(select 1 from document_appointment_links link where link.document_id=d.id and link.appointment_id=$5))";
  const legacy = await queryable.query<DocumentRow>(
    `select d.* from documents d
      where d.patient_id=$1 and d.document_type=$2 and d.source=$3
        and d.file_size=$4 and d.content_sha256 is null
        ${legacyAppointmentPredicate}
      order by d.id asc`,
    profile.reuseAcrossAppointments
      ? [patientId, profile.documentType, profile.source, fingerprint.byteSize]
      : [patientId, profile.documentType, profile.source, fingerprint.byteSize, appointmentId],
  );
  for (const candidate of legacy.rows) {
    const digest = await sha256File(getDocumentAbsolutePath(candidate)).catch(() => null);
    if (!digest || digest.byteSize !== Number(candidate.file_size)) continue;
    await queryable.query(
      "update documents set content_sha256=$2 where id=$1 and content_sha256 is null",
      [candidate.id, digest.sha256],
    );
    if (digest.sha256 === fingerprint.sha256 && digest.byteSize === fingerprint.byteSize) {
      return { ...candidate, content_sha256: digest.sha256 };
    }
  }
  return null;
}

function isValidIsoDate(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(value);
}

function buildDeleteScopeWhere(scope: DocumentsDeleteScope, params: unknown[]): string {
  if (scope.mode === "all") {
    return "";
  }

  const dateFrom = String(scope.dateFrom || "").trim();
  const dateTo = String(scope.dateTo || "").trim();
  if (!isValidIsoDate(dateFrom) || !isValidIsoDate(dateTo)) {
    throw new HttpError(400, "dateFrom/dateTo must be in YYYY-MM-DD format.");
  }
  if (dateFrom > dateTo) {
    throw new HttpError(400, "dateFrom must be before or equal to dateTo.");
  }

  params.push(dateFrom);
  const fromIndex = params.length;
  params.push(dateTo);
  const toIndex = params.length;
  return `where coalesce(a.appointment_date, b.booking_date) between $${fromIndex}::date and $${toIndex}::date`;
}

async function selectDocumentsForScope(scope: DocumentsDeleteScope): Promise<DocumentRow[]> {
  const params: unknown[] = [];
  const whereClause = buildDeleteScopeWhere(scope, params);
  const { rows } = await pool.query(
    `
      select
        d.id,
        d.patient_id,
        d.appointment_id,
        d.v2_booking_id,
        d.document_type,
        d.original_filename,
        d.stored_path,
        d.mime_type,
        d.file_size,
        d.storage_location_type,
        d.source,
        d.scan_session_id,
        d.page_count,
        d.scanner_name,
        d.workstation_name,
        d.app_version,
        d.last_move_attempt_at,
        d.last_move_error,
        d.created_at
      from documents d
      left join appointments a on a.id = d.appointment_id
      left join appointments_v2.bookings b on b.id = d.v2_booking_id
      ${whereClause}
      order by d.id asc
    `,
    params
  );
  return rows as DocumentRow[];
}

async function safeUnlink(absolutePath: string): Promise<{ ok: boolean; reason?: string }> {
  try {
    await fs.unlink(absolutePath);
    return { ok: true };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown file delete error";
    if (message.includes("ENOENT")) {
      return { ok: true };
    }
    return { ok: false, reason: message };
  }
}

type StoredDocumentFile = {
  absolutePath: string;
  storedPath: string;
  storageLocationType: "network" | "local_fallback";
  fallbackReason: string | null;
  storageConfig: StorageConfig;
};

type DocumentPersistenceOptions = {
  storedFile?: StoredDocumentFile;
  deferPostCommit?: boolean;
};

async function stageDocumentFile(storageConfig: StorageConfig, originalFilename: string, source: { buffer?: Buffer; path?: string }): Promise<StoredDocumentFile & { stagedPath: string }> {
  const stage = async (basePath: string, storageLocationType: "network" | "local_fallback", fallbackReason: string | null) => {
    const stagingDirectory = path.join(basePath, ".rispro-document-staging");
    await fs.mkdir(stagingDirectory, { recursive: true });
    const stagedPath = path.join(stagingDirectory, `${crypto.randomUUID()}-${originalFilename}`);
    try {
      if (source.path) await fs.copyFile(source.path, stagedPath); else await fs.writeFile(stagedPath, source.buffer!);
    } catch (error) {
      await safeUnlink(stagedPath);
      throw error;
    }
    return { stagedPath, absolutePath: "", storedPath: "", storageLocationType, fallbackReason, storageConfig };
  };
  if (storageConfig.storagePath) {
    try {
      ensureNetworkAuthIfNeeded(storageConfig);
      return await stage(resolveStorageBasePath(storageConfig.storagePath), "network", null);
    } catch (error) {
      if (!storageConfig.fallbackEnabled) throw new HttpError(503, error instanceof Error ? error.message : "Preferred storage is unavailable and fallback is disabled.");
      const fallbackReason = error instanceof Error ? error.message : "Network storage write failed.";
      return stage(resolveStorageBasePath(env.uploadsDir), "local_fallback", fallbackReason);
    }
  }
  if (!storageConfig.fallbackEnabled) throw new HttpError(503, "Preferred storage is unavailable and fallback is disabled.");
  return stage(resolveStorageBasePath(env.uploadsDir), "local_fallback", null);
}

async function promoteStagedDocumentFile(staged: StoredDocumentFile & { stagedPath: string }, originalFilename: string): Promise<StoredDocumentFile> {
  const targetDirectory = path.join(path.dirname(path.dirname(staged.stagedPath)), getTripoliToday());
  await fs.mkdir(targetDirectory, { recursive: true });
  const absolutePath = path.join(targetDirectory, `${Date.now()}-${crypto.randomUUID()}-${originalFilename}`);
  await fs.rename(staged.stagedPath, absolutePath);
  return { ...staged, absolutePath, storedPath: toStoredPath(absolutePath) };
}

async function finalizeDocumentUpload(savedDocument: DocumentRow, storedFile: StoredDocumentFile, currentUserId: OptionalUserId): Promise<void> {
  try {
    await logAuditEntry({ entityType: "document", entityId: savedDocument.id, actionType: "upload", oldValues: null, newValues: { ...savedDocument, storageAuthUsername: storedFile.storageLocationType === "network" ? buildNetworkAuthUsername(storedFile.storageConfig) : "", fallbackReason: storedFile.fallbackReason }, changedByUserId: currentUserId });
  } catch (error) {
    console.warn(JSON.stringify({ type: "document_upload_audit_failed", documentId: savedDocument.id, error: error instanceof Error ? error.message : String(error) }));
  }
  if (isClinicalDocumentExportDocumentType(savedDocument.document_type) && savedDocument.v2_booking_id) {
    await enqueueClinicalDocumentExportsForAppointmentAutomatically(Number(savedDocument.v2_booking_id), currentUserId).catch((error) => console.warn(JSON.stringify({ type: "clinical_document_export_queue_failed", documentId: savedDocument.id, error: error instanceof Error ? error.message : String(error) })));
  }
}

export async function uploadDocument(
  payload: DocumentUploadPayload,
  currentUserId: OptionalUserId,
  executor: DocumentDatabaseExecutor = pool,
  options: DocumentPersistenceOptions = {},
): Promise<DocumentRow> {
  const patientId = normalizePositiveInteger(payload.patientId, "patientId", { required: false });
  const appointmentId = normalizePositiveInteger(payload.appointmentId, "appointmentId", { required: false });
  const appointmentRefType = normalizeAppointmentRefType(payload.appointmentRefType);
  const documentType = String(payload.documentType || "appointment_request").trim();
  const originalFilename = sanitizeFileName(payload.originalFilename || "document.bin");
  const mimeType = String(payload.mimeType || "application/octet-stream").trim().toLowerCase();
  const source = normalizeDocumentSource(payload.source);
  const suppliedSources = [payload.fileContentBuffer != null, payload.fileContentBase64 != null, payload.fileSourcePath != null].filter(Boolean).length;
  if (suppliedSources !== 1) throw new HttpError(400, "Exactly one document file source is required.");
  const fileSourcePath = payload.fileSourcePath ? path.resolve(payload.fileSourcePath) : null;
  const fileBuffer = fileSourcePath ? null : resolveFileBuffer(payload);
  const fileStat = fileSourcePath ? await fs.stat(fileSourcePath).catch(() => null) : null;
  if (fileSourcePath && !fileStat?.isFile()) throw new HttpError(400, "Document file source must be a regular file.");
  const fileSize = fileStat?.size ?? fileBuffer!.length;
  const scanSessionId = normalizePositiveInteger(payload.scanSessionId, "scanSessionId", { required: false });
  const pageCount = payload.pageCount == null ? null : Number(payload.pageCount);
  const scannerName = String(payload.scannerName || "").trim() || null;
  const workstationName = String(payload.workstationName || "").trim() || null;
  const appVersion = String(payload.appVersion || "").trim() || null;
  const idempotencyKey = String(payload.idempotencyKey || "").trim() || null;
  const requestScanJobId = normalizePositiveInteger(payload.requestScanJobId, "requestScanJobId", { required: false });
  if (idempotencyKey && !/^request-scan:(?:v2-booking:\d+:appointment-request|job:\d+:(?:appointment-request|clinical-document))$/.test(idempotencyKey)) throw new HttpError(400, "Invalid document idempotency key.");
  if (fileSize === 0) {
    throw new HttpError(400, "Uploaded file is empty.");
  }
  if (fileSize > MAX_DOCUMENT_BYTES) {
    throw new HttpError(413, "Uploaded document exceeds the 50 MB limit.");
  }
  if (!ALLOWED_MIME_TYPES.has(mimeType)) {
    throw new HttpError(400, "Document type must be PDF, JPEG, or PNG.");
  }
  const fingerprintProfile = requestScanFingerprintProfile(payload);
  const contentFingerprint = fingerprintProfile
    ? await requestScanContentFingerprint(fileSourcePath, fileBuffer)
    : null;
  if (contentFingerprint && contentFingerprint.byteSize !== fileSize) {
    throw new HttpError(400, "Document file size changed while calculating its fingerprint.");
  }

  await ensureRelatedRecords(patientId, appointmentId, executor);
  const appointmentReference = await resolveAppointmentReference(appointmentId, appointmentRefType, executor);
  await ensureAppointmentBelongsToPatient(appointmentReference, patientId, executor);

  const storageConfig = options.storedFile?.storageConfig ?? await loadDocumentStorageConfig();
  let storedPath = options.storedFile?.storedPath ?? ""; let absoluteStoredPath = options.storedFile?.absolutePath ?? "";
  let storageLocationType: "network" | "local_fallback" = options.storedFile?.storageLocationType ?? "local_fallback";
  let fallbackReason: string | null = options.storedFile?.fallbackReason ?? null;

  if (!options.storedFile && storageConfig.storagePath) {
    try {
      ensureNetworkAuthIfNeeded(storageConfig);
      const preferredBasePath = resolveStorageBasePath(storageConfig.storagePath);
      const written = await writeFileToStorageTarget(preferredBasePath, originalFilename, { buffer: fileBuffer ?? undefined, path: fileSourcePath ?? undefined });
      storedPath = written.relativePath;
      absoluteStoredPath = written.absolutePath;
      storageLocationType = "network";
    } catch (error) {
      fallbackReason = error instanceof Error ? error.message : "Network storage write failed.";
    }
  }

  if (!options.storedFile && !storedPath) {
    if (!storageConfig.fallbackEnabled) {
      throw new HttpError(503, fallbackReason || "Preferred storage is unavailable and fallback is disabled.");
    }
    const fallbackBasePath = resolveStorageBasePath(env.uploadsDir);
    const written = await writeFileToStorageTarget(fallbackBasePath, originalFilename, { buffer: fileBuffer ?? undefined, path: fileSourcePath ?? undefined });
    storedPath = written.relativePath;
    absoluteStoredPath = written.absolutePath;
    storageLocationType = "local_fallback";
  }

  let rows: DocumentRow[];
  try {
    const insertResult = (await executor.query(
    `
      insert into documents (
        patient_id,
        appointment_id,
        v2_booking_id,
        document_type,
        original_filename,
        stored_path,
        mime_type,
        file_size,
        content_sha256,
        storage_location_type,
        last_move_error,
        uploaded_by_user_id,
        source,
        scan_session_id,
        page_count,
        scanner_name,
        workstation_name,
        app_version,
        idempotency_key,
        request_scan_job_id
      )
      values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20)
      returning
        id,
        patient_id,
        appointment_id,
        v2_booking_id,
        document_type,
        original_filename,
        stored_path,
        mime_type,
        file_size,
        content_sha256,
        storage_location_type,
        source,
        scan_session_id,
        page_count,
        scanner_name,
        workstation_name,
        app_version,
        last_move_attempt_at,
        last_move_error,
        created_at
    `,
    [
      patientId,
      appointmentReference.legacyAppointmentId,
      appointmentReference.v2BookingId,
      documentType,
      originalFilename,
      storedPath,
      mimeType,
      fileSize,
      contentFingerprint?.sha256 ?? null,
      storageLocationType,
      fallbackReason,
      currentUserId,
      source,
      scanSessionId,
      Number.isFinite(pageCount) && Number(pageCount) > 0 ? Math.floor(Number(pageCount)) : null,
      scannerName,
      workstationName,
      appVersion,
      idempotencyKey,
      requestScanJobId,
    ]
    )) as DbQueryResult<DocumentRow>;
    rows = insertResult.rows;
  } catch (error) {
    const cleanup = absoluteStoredPath ? await safeUnlink(absoluteStoredPath) : { ok: true };
    if (!cleanup.ok) console.error("Document upload database write failed and orphan-file cleanup also failed.");
    throw error;
  }
  const savedDocument = rows[0];

  if (!savedDocument) {
    throw new HttpError(500, "Failed to save document.");
  }

  if (!options.deferPostCommit) await finalizeDocumentUpload(savedDocument, { absolutePath: absoluteStoredPath, storedPath, storageLocationType, fallbackReason, storageConfig }, currentUserId);

  return savedDocument;
}

async function requestScanContentFingerprint(fileSourcePath: string | null, fileBuffer: Buffer | null): Promise<{ sha256: string; byteSize: number }> {
  if (fileSourcePath) {
    const digest = await sha256File(fileSourcePath);
    return { sha256: digest.sha256, byteSize: digest.byteSize };
  }
  const buffer = fileBuffer!;
  return { sha256: sha256Buffer(buffer), byteSize: buffer.length };
}

export async function findDocumentByIdempotencyKey(idempotencyKey: string): Promise<DocumentRow | null> {
  const result = await pool.query<DocumentRow>("select * from documents where idempotency_key=$1 limit 1", [idempotencyKey]);
  return result.rows[0] ?? null;
}

export async function uploadDocumentIdempotently(payload: DocumentUploadPayload, currentUserId: OptionalUserId, idempotencyKey: string): Promise<{ document: DocumentRow; created: boolean }> {
  const fingerprintProfile = requestScanFingerprintProfile(payload);
  if (fingerprintProfile) {
    const patientId = normalizePositiveInteger(payload.patientId, "patientId");
    const appointmentId = normalizePositiveInteger(payload.appointmentId, "appointmentId", { required: false });
    const fileSourcePath = payload.fileSourcePath ? path.resolve(payload.fileSourcePath) : null;
    const fileBuffer = fileSourcePath ? null : resolveFileBuffer(payload);
    const fingerprint = await requestScanContentFingerprint(fileSourcePath, fileBuffer);
    const fileSource = { buffer: fileBuffer ?? undefined, path: fileSourcePath ?? undefined };
    const findByIdempotencyKey = (executor: DocumentDatabaseExecutor) => executor.query<DocumentRow>("select * from documents where idempotency_key=$1 limit 1", [idempotencyKey]);
    const inspect = async (): Promise<DocumentRow | null> => {
      const client = await pool.connect();
      try {
        await client.query("begin");
        const existing = await findByIdempotencyKey(client);
        if (existing.rows[0]) { await client.query("commit"); return existing.rows[0]; }
        await client.query("select pg_advisory_xact_lock(hashtextextended($1, 0))", [`request-scan-document:${fingerprintProfile.source}:${patientId}:${fingerprint.byteSize}:${fingerprint.sha256}`]);
        const duplicate = await findRequestScanDocumentDuplicate(client, fingerprintProfile, patientId!, appointmentId, fingerprint);
        await client.query("commit");
        return duplicate;
      } catch (error) {
        await client.query("rollback").catch(() => undefined);
        throw error;
      } finally { client.release(); }
    };
    const winner = await inspect();
    if (winner) return { document: winner, created: false };
    const originalFilename = sanitizeFileName(payload.originalFilename || "document.bin");
    const staged = await stageDocumentFile(await loadDocumentStorageConfig(), originalFilename, fileSource);
    let storedFile: StoredDocumentFile | null = null;
    let client: PoolClient | null = null;
    let clientReleased = false;
    let committed = false;
    try {
      client = await pool.connect();
      await client.query("begin");
      const existing = await findByIdempotencyKey(client);
      if (existing.rows[0]) {
        await client.query("commit");
        await safeUnlink(staged.stagedPath);
        return { document: existing.rows[0], created: false };
      }
      await client.query("select pg_advisory_xact_lock(hashtextextended($1, 0))", [`request-scan-document:${fingerprintProfile.source}:${patientId}:${fingerprint.byteSize}:${fingerprint.sha256}`]);
      const duplicate = await findRequestScanDocumentDuplicate(client, fingerprintProfile, patientId!, appointmentId, fingerprint);
      if (duplicate) {
        await client.query("commit");
        await safeUnlink(staged.stagedPath);
        return { document: duplicate, created: false };
      }
      storedFile = await promoteStagedDocumentFile(staged, originalFilename);
      const created = await uploadDocument({ ...payload, idempotencyKey }, currentUserId, client, { storedFile, deferPostCommit: true });
      await client.query("commit");
      committed = true;
      client.release();
      clientReleased = true;
      await finalizeDocumentUpload(created, storedFile, currentUserId);
      return { document: created, created: true };
    } catch (error) {
      if (!committed) {
        await client?.query("rollback").catch(() => undefined);
        await safeUnlink(storedFile?.absolutePath || staged.stagedPath);
      }
      throw error;
    } finally {
      if (client && !clientReleased) client.release();
    }
  }
  const existing = await pool.query<DocumentRow>("select * from documents where idempotency_key=$1", [idempotencyKey]);
  if (existing.rows[0]) return { document: existing.rows[0], created: false };
  try { return { document: await uploadDocument({ ...payload, idempotencyKey }, currentUserId), created: true }; }
  catch (error) {
    if ((error as { code?: string }).code !== "23505") throw error;
    const winner = await pool.query<DocumentRow>("select * from documents where idempotency_key=$1", [idempotencyKey]);
    if (!winner.rows[0]) throw error;
    return { document: winner.rows[0], created: false };
  }
}

export async function upsertDocumentAppointmentLinks(documentId: number, appointmentIds: number[]): Promise<void> {
  const ids = [...new Set(appointmentIds.map((value) => normalizePositiveInteger(value, "appointmentId")).filter((value): value is number => value != null))].sort((a, b) => a - b);
  if (!ids.length) throw new HttpError(400, "At least one appointment link is required.");
  const client = await pool.connect();
  try {
    await client.query("begin");
    const insertedAppointmentIds: number[] = [];
    for (const appointmentId of ids) {
      const inserted = await client.query<{ appointment_id: number }>(
        "insert into document_appointment_links(document_id,appointment_id) values($1,$2) on conflict do nothing returning appointment_id",
        [documentId, appointmentId],
      );
      if (inserted.rows[0]) insertedAppointmentIds.push(Number(inserted.rows[0].appointment_id));
    }
    await client.query("commit");
    const { rows } = await pool.query<{ source: string; document_type: string }>("select source, document_type from documents where id=$1", [documentId]);
    if (isClinicalDocumentExportDocumentType(rows[0]?.document_type)) {
      for (const appointmentId of insertedAppointmentIds) {
        await enqueueClinicalDocumentExportsForAppointmentAutomatically(appointmentId).catch((error) => {
          console.warn(JSON.stringify({ type: "clinical_document_export_link_queue_failed", documentId, appointmentId, error: error instanceof Error ? error.message : String(error) }));
        });
      }
    }
  } catch (error) {
    await client.query("rollback");
    throw error;
  } finally {
    client.release();
  }
}

export async function deleteDocumentById(
  documentId: UserId,
  currentUserId: OptionalUserId
): Promise<{ deleted: boolean; documentId: number }> {
  const document = await getDocumentById(documentId);
  const absolutePath = getDocumentAbsolutePath(document);
  const unlinkResult = await safeUnlink(absolutePath);
  if (!unlinkResult.ok) {
    throw new HttpError(500, `Failed to delete file from storage: ${unlinkResult.reason}`);
  }

  await pool.query(`delete from documents where id = $1`, [document.id]);
  await logAuditEntry({
    entityType: "document",
    entityId: document.id,
    actionType: "delete",
    oldValues: document,
    newValues: null,
    changedByUserId: currentUserId,
  });

  return { deleted: true, documentId: document.id };
}

export async function deleteDocumentsByScope(
  scope: DocumentsDeleteScope,
  currentUserId: OptionalUserId
): Promise<DocumentsDeleteResult> {
  const documents = await selectDocumentsForScope(scope);
  const failures: Array<{ documentId: number; reason: string }> = [];
  const deletedIds: number[] = [];

  for (const document of documents) {
    const absolutePath = getDocumentAbsolutePath(document);
    const unlinkResult = await safeUnlink(absolutePath);
    if (!unlinkResult.ok) {
      failures.push({ documentId: document.id, reason: unlinkResult.reason || "File delete failed." });
      continue;
    }
    deletedIds.push(document.id);
  }

  if (deletedIds.length > 0) {
    await pool.query(`delete from documents where id = any($1::bigint[])`, [deletedIds]);
  }

  await logAuditEntry({
    entityType: "document",
    entityId: null,
    actionType: "bulk_delete",
    oldValues: null,
    newValues: {
      scope,
      deletedCount: deletedIds.length,
      failedCount: failures.length,
      failures,
    },
    changedByUserId: currentUserId,
  });

  return {
    deletedCount: deletedIds.length,
    failedCount: failures.length,
    failures,
  };
}

export async function moveDocumentsToConfiguredStorage(
  scope: DocumentsDeleteScope,
  currentUserId: OptionalUserId
): Promise<DocumentsMoveResult> {
  const storageConfig = await loadDocumentStorageConfig();
  if (!storageConfig.storagePath) {
    throw new HttpError(400, "Configured storage path is empty.");
  }
  ensureNetworkAuthIfNeeded(storageConfig);

  const targetBasePath = resolveStorageBasePath(storageConfig.storagePath);
  const scopedDocuments = await selectDocumentsForScope(scope);
  const failures: Array<{ documentId: number; reason: string }> = [];
  let movedCount = 0;
  let skippedCount = 0;

  for (const document of scopedDocuments) {
    if (document.storage_location_type !== "local_fallback") {
      skippedCount += 1;
      continue;
    }

    const sourceAbsolutePath = getDocumentAbsolutePath(document);
    let sourceStat;
    try {
      sourceStat = await fs.stat(sourceAbsolutePath);
    } catch (error) {
      failures.push({
        documentId: document.id,
        reason: error instanceof Error ? error.message : "Source file missing.",
      });
      await pool.query(
        `update documents set last_move_attempt_at = now(), last_move_error = $2 where id = $1`,
        [document.id, "Source file missing."]
      );
      continue;
    }

    const targetDateFolder = getTripoliToday();
    const targetDirectory = path.join(targetBasePath, targetDateFolder);
    const targetAbsolutePath = path.join(targetDirectory, `${Date.now()}-${document.original_filename}`);
    const targetStoredPath = toStoredPath(targetAbsolutePath);

    try {
      await fs.mkdir(targetDirectory, { recursive: true });
      await fs.copyFile(sourceAbsolutePath, targetAbsolutePath);
      const copiedStat = await fs.stat(targetAbsolutePath);
      if (copiedStat.size !== sourceStat.size) {
        throw new Error("Copied file size does not match source.");
      }

      await fs.unlink(sourceAbsolutePath);
      await pool.query(
        `
          update documents
          set
            stored_path = $2,
            storage_location_type = 'network',
            last_move_attempt_at = now(),
            last_move_error = null
          where id = $1
        `,
        [document.id, targetStoredPath]
      );
      movedCount += 1;
    } catch (error) {
      const reason = error instanceof Error ? error.message : "Move failed.";
      failures.push({ documentId: document.id, reason });
      await pool.query(
        `update documents set last_move_attempt_at = now(), last_move_error = $2 where id = $1`,
        [document.id, reason]
      );
    }
  }

  await logAuditEntry({
    entityType: "document",
    entityId: null,
    actionType: "move_storage",
    oldValues: null,
    newValues: {
      scope,
      movedCount,
      skippedCount,
      failedCount: failures.length,
      failures,
      storageAuthUsername: buildNetworkAuthUsername(storageConfig),
      targetPath: storageConfig.storagePath,
    },
    changedByUserId: currentUserId,
  });

  return {
    movedCount,
    skippedCount,
    failedCount: failures.length,
    failures,
  };
}

export async function testConfiguredStorageConnectivity(): Promise<{
  ok: boolean;
  path: string;
  authUsername: string;
  message: string;
}> {
  const config = await loadDocumentStorageConfig();
  if (!config.storagePath) {
    return {
      ok: false,
      path: "",
      authUsername: "",
      message: "Configured storage path is empty.",
    };
  }
  ensureNetworkAuthIfNeeded(config);

  const basePath = resolveStorageBasePath(config.storagePath);
  const pingDir = path.join(basePath, "__healthcheck");
  const pingFile = path.join(pingDir, `rispro-${Date.now()}.tmp`);
  try {
    await fs.mkdir(pingDir, { recursive: true });
    await fs.writeFile(pingFile, "ok");
    await fs.unlink(pingFile);
    return {
      ok: true,
      path: config.storagePath,
      authUsername: buildNetworkAuthUsername(config),
      message: "Storage path is reachable.",
    };
  } catch (error) {
    return {
      ok: false,
      path: config.storagePath,
      authUsername: buildNetworkAuthUsername(config),
      message: error instanceof Error ? error.message : "Storage check failed.",
    };
  }
}
