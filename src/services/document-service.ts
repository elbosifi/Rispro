import fs from "fs/promises";
import path from "path";
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

export interface DocumentUploadPayload {
  patientId?: UserId;
  appointmentId?: UserId;
  appointmentRefType?: string;
  documentType?: string;
  originalFilename?: string;
  mimeType?: string;
  fileContentBase64?: string;
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
  storage_location_type: "network" | "local_fallback";
  last_move_attempt_at: string | null;
  last_move_error: string | null;
  created_at: string;
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

async function ensureRelatedRecords(patientId: number | null, appointmentId: number | null): Promise<void> {
  if (!patientId && !appointmentId) {
    throw new HttpError(400, "patientId or appointmentId is required.");
  }

  if (patientId) {
    const { rowCount } = await pool.query("select 1 from patients where id = $1 limit 1", [patientId]);
    if (Number(rowCount || 0) === 0) {
      throw new HttpError(404, "Patient not found.");
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

async function findLegacyAppointmentId(appointmentId: number): Promise<number | null> {
  const { rowCount } = await pool.query("select 1 from appointments where id = $1 limit 1", [appointmentId]);
  return Number(rowCount || 0) > 0 ? appointmentId : null;
}

async function findV2BookingId(appointmentId: number): Promise<number | null> {
  const { rowCount } = await pool.query("select 1 from appointments_v2.bookings where id = $1 limit 1", [appointmentId]);
  return Number(rowCount || 0) > 0 ? appointmentId : null;
}

async function resolveAppointmentReference(
  appointmentId: number | null,
  refType: AppointmentRefType
): Promise<AppointmentReference> {
  if (!appointmentId) {
    return { legacyAppointmentId: null, v2BookingId: null };
  }

  if (refType === "legacy_appointment") {
    const legacyAppointmentId = await findLegacyAppointmentId(appointmentId);
    if (!legacyAppointmentId) throw new HttpError(404, "Appointment not found.");
    return { legacyAppointmentId, v2BookingId: null };
  }

  if (refType === "v2_booking") {
    const v2BookingId = await findV2BookingId(appointmentId);
    if (!v2BookingId) throw new HttpError(404, "Appointment not found.");
    return { legacyAppointmentId: null, v2BookingId };
  }

  // Auto mode: prefer V2 for modern UI flows.
  const v2BookingId = await findV2BookingId(appointmentId);
  if (v2BookingId) {
    return { legacyAppointmentId: null, v2BookingId };
  }
  const legacyAppointmentId = await findLegacyAppointmentId(appointmentId);
  if (legacyAppointmentId) {
    return { legacyAppointmentId, v2BookingId: null };
  }
  throw new HttpError(404, "Appointment not found.");
}

function isTruthyFlag(raw: string): boolean {
  return ["true", "1", "yes", "enabled", "on"].includes(String(raw || "").trim().toLowerCase());
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
  fileBuffer: Buffer
): Promise<{ absolutePath: string; relativePath: string }> {
  const dateFolder = getTripoliToday();
  const targetDirectory = path.join(absoluteBasePath, dateFolder);
  await fs.mkdir(targetDirectory, { recursive: true });
  const storedFileName = `${Date.now()}-${originalFilename}`;
  const absoluteStoredPath = path.join(targetDirectory, storedFileName);
  await fs.writeFile(absoluteStoredPath, fileBuffer);
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
    conditions.push(`patient_id = $${params.length}`);
  }

  if (filters.appointmentId) {
    params.push(normalizePositiveInteger(filters.appointmentId, "appointmentId"));
    const appointmentIdIndex = params.length;
    if (appointmentRefType === "legacy_appointment") {
      conditions.push(`appointment_id = $${appointmentIdIndex}`);
    } else if (appointmentRefType === "v2_booking") {
      conditions.push(`v2_booking_id = $${appointmentIdIndex}`);
    } else {
      conditions.push(`(appointment_id = $${appointmentIdIndex} or v2_booking_id = $${appointmentIdIndex})`);
    }
  }

  const whereClause = conditions.length ? `where ${conditions.join(" and ")}` : "";
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
        last_move_attempt_at,
        last_move_error,
        created_at
      from documents
      ${whereClause}
      order by created_at desc
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

export async function uploadDocument(
  payload: DocumentUploadPayload,
  currentUserId: OptionalUserId
): Promise<DocumentRow> {
  const patientId = normalizePositiveInteger(payload.patientId, "patientId", { required: false });
  const appointmentId = normalizePositiveInteger(payload.appointmentId, "appointmentId", { required: false });
  const appointmentRefType = normalizeAppointmentRefType(payload.appointmentRefType);
  const documentType = String(payload.documentType || "referral_request").trim();
  const originalFilename = sanitizeFileName(payload.originalFilename || "document.bin");
  const mimeType = String(payload.mimeType || "application/octet-stream").trim();
  const fileBuffer = decodeBase64File(payload.fileContentBase64);

  if (fileBuffer.length === 0) {
    throw new HttpError(400, "Uploaded file is empty.");
  }

  await ensureRelatedRecords(patientId, appointmentId);
  const appointmentReference = await resolveAppointmentReference(appointmentId, appointmentRefType);

  const storageConfig = await loadDocumentStorageConfig();
  let storedPath = "";
  let storageLocationType: "network" | "local_fallback" = "local_fallback";
  let fallbackReason: string | null = null;

  if (storageConfig.storagePath) {
    try {
      ensureNetworkAuthIfNeeded(storageConfig);
      const preferredBasePath = resolveStorageBasePath(storageConfig.storagePath);
      const written = await writeFileToStorageTarget(preferredBasePath, originalFilename, fileBuffer);
      storedPath = written.relativePath;
      storageLocationType = "network";
    } catch (error) {
      fallbackReason = error instanceof Error ? error.message : "Network storage write failed.";
    }
  }

  if (!storedPath) {
    if (!storageConfig.fallbackEnabled) {
      throw new HttpError(503, fallbackReason || "Preferred storage is unavailable and fallback is disabled.");
    }
    const fallbackBasePath = resolveStorageBasePath(env.uploadsDir);
    const written = await writeFileToStorageTarget(fallbackBasePath, originalFilename, fileBuffer);
    storedPath = written.relativePath;
    storageLocationType = "local_fallback";
  }

  const { rows } = (await pool.query(
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
        storage_location_type,
        last_move_error,
        uploaded_by_user_id
      )
      values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
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
        storage_location_type,
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
      fileBuffer.length,
      storageLocationType,
      fallbackReason,
      currentUserId,
    ]
  )) as DbQueryResult<DocumentRow>;
  const savedDocument = rows[0];

  if (!savedDocument) {
    throw new HttpError(500, "Failed to save document.");
  }

  await logAuditEntry({
    entityType: "document",
    entityId: savedDocument.id,
    actionType: "upload",
    oldValues: null,
    newValues: {
      ...savedDocument,
      storageAuthUsername:
        storageLocationType === "network" ? buildNetworkAuthUsername(storageConfig) : "",
      fallbackReason,
    },
    changedByUserId: currentUserId
  });

  return savedDocument;
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
