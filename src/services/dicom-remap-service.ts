import { Buffer } from "node:buffer";
import { createHash, randomUUID } from "node:crypto";
import { createReadStream, createWriteStream } from "node:fs";
import { mkdir, open, readFile, readdir, rename, rm, stat, writeFile } from "node:fs/promises";
import { Readable, type Writable } from "node:stream";
import os from "node:os";
import path from "node:path";
import dcmjs from "dcmjs";
import archiver from "archiver";
import { pool } from "../db/pool.js";
import { env } from "../config/env.js";
import { HttpError } from "../utils/http-error.js";
import { normalizeOptionalText, normalizePositiveInteger } from "../utils/normalize.js";
import { logAuditEntry } from "./audit-service.js";
import { resolveOrthancSettings } from "./orthanc-settings-resolver.js";
import { listOrthancRemoteModalities } from "./orthanc-pacs-service.js";
import { getPatientById } from "./patient-service.js";
import type { OptionalUserId, UserId } from "../types/http.js";
import type { DicomRemapJobStatus, DicomRemapOrthancRecoveryStage, DicomRemapOrthancRecoveryStatus, DicomRemapUploadFileInput } from "../modules/dicom-remap/types.js";
export type { DicomRemapJobStatus, DicomRemapOrthancRecoveryStage, DicomRemapOrthancRecoveryStatus, DicomRemapUploadFileInput } from "../modules/dicom-remap/types.js";
import { validateExplicitConfirm } from "../modules/dicom-remap/validation.js";
export { validateDicomRemapUploadFilesInput, validateExplicitConfirm } from "../modules/dicom-remap/validation.js";

type DicomRemapQuery = typeof pool.query;
type DicomRemapAuditLogger = typeof logAuditEntry;
type OrthancFetch = typeof orthancFetch;
type RemapSleep = (ms: number) => Promise<void>;
type DicomRemapPatientLoader = typeof getPatientById;
type DicomRemapModalityLister = typeof listOrthancRemoteModalities;
const { DicomMessage, DicomMetaDictionary, datasetToBuffer } = dcmjs.data;

export interface DicomRemapStagedUploadFile {
  fileName: string;
  mimeType?: string;
  path: string;
  size: number;
  internalId?: string;
}

interface DicomRemapUploadProcessingResult {
  job: DicomRemapJobRow;
  summary: OrthancPatientSummary;
  skippedFilesCount: number;
}

interface OrthancStudyDeleteResult {
  studyId: string;
  status: "deleted" | "already_missing" | "failed";
  orthancStatus?: number;
  message?: string;
}

interface OrthancResetSummary {
  studiesAttempted: number;
  studiesDeleted: number;
  studiesAlreadyMissing: number;
  failures: OrthancStudyDeleteResult[];
}

interface OrthancStudyMatchMetadata {
  studyId: string;
  accessionNumber: string;
  studyDate: string;
  modality: string;
  patientId: string;
}

export interface DicomRemapJobRow {
  id: number;
  created_by_user_id: number;
  created_by_user_name?: string | null;
  created_by_username?: string | null;
  comparison_request_id?: number | null;
  status: DicomRemapJobStatus;
  source_orthanc_study_id: string | null;
  modified_orthanc_study_id: string | null;
  rispro_patient_id: number | null;
  destination_pacs_key: string | null;
  original_patient_id: string | null;
  original_patient_name: string | null;
  original_patient_sex: string | null;
  original_patient_birth_date: string | null;
  replacement_patient_id: string | null;
  replacement_patient_name: string | null;
  replacement_patient_sex: string | null;
  replacement_patient_birth_date: string | null;
  send_result: unknown;
  orthanc_send_job_id: string | null;
  send_attempt_count: number;
  send_started_at: string | null;
  send_completed_at: string | null;
  send_last_checked_at: string | null;
  send_last_heartbeat_at: string | null;
  send_error_code: string | null;
  send_error_details: unknown;
  processing_stage?: string | null;
  staged_storage_key?: string | null;
  staged_manifest_version?: number | null;
  staged_file_count?: number | null;
  staged_total_bytes?: number | null;
  processed_file_count?: number | null;
  processing_skipped_file_count?: number | null;
  processing_attempt_count?: number | null;
  processing_started_at?: string | null;
  processing_completed_at?: string | null;
  processing_last_checked_at?: string | null;
  processing_last_heartbeat_at?: string | null;
  processing_lease_owner?: string | null;
  processing_lease_expires_at?: string | null;
  processing_error_code?: string | null;
  processing_error_details?: unknown;
  staging_cleanup_completed_at?: string | null;
  source_recovery_available?: boolean;
  dicom_integrity_version?: number | null;
  dicom_integrity_verified_at?: string | null;
  orthanc_recovery_status?: DicomRemapOrthancRecoveryStatus | null;
  orthanc_recovery_attempt_count?: number | null;
  orthanc_recovery_source_study_id?: string | null;
  orthanc_recovery_started_at?: string | null;
  orthanc_recovery_completed_at?: string | null;
  orthanc_recovery_error_code?: string | null;
  orthanc_recovery_error_details?: unknown;
  orthanc_recovery_expires_at?: string | null;
  orthanc_recovery_stage?: DicomRemapOrthancRecoveryStage | null;
  orthanc_recovery_lease_owner?: string | null;
  orthanc_recovery_lease_expires_at?: string | null;
  orthanc_recovery_last_heartbeat_at?: string | null;
  selected_study_instance_uid?: string | null;
  provisional_source_identity?: DicomRemapProvisionalSourceIdentity | null;
  processing_selection_counts?: DicomRemapSelectionCounts | null;
  error_message: string | null;
  cancellation_reason: string | null;
  created_at: string;
  updated_at: string;
}

export interface DicomRemapProvisionalSourceIdentity {
  studyInstanceUid: string;
  patientId: string;
  patientName: string;
  patientBirthDate: string;
  patientSex: string;
  modality: string;
  studyDate: string;
}

export interface DicomRemapSelectionCounts {
  totalStagedFiles: number;
  validDicomFiles: number;
  selectedStudyFiles: number;
  excludedOtherStudyFiles: number;
  excludedStudyCount: number;
  skippedOrUnparsedFiles: number;
  acceptedUniqueInstances?: number;
  processedInstances?: number;
  alreadyStoredInstances?: number;
  failedSelectedStudyFiles?: number;
  unassignedLikelyDicomFiles?: number;
  partial?: boolean;
  completenessUncertain?: boolean;
  completeSeriesLossCount?: number;
  failedMultiframeObjectCount?: number;
  failureSample?: Array<{ fileLabel: string; category: DicomRemapFileOutcomeCategory }>;
  seriesOutcomes?: Array<{
    seriesInstanceUid: string;
    acceptedUniqueInstances: number;
    failedInstances: number;
    zeroAcceptedAfterFailures: boolean;
  }>;
  acknowledgement?: { acknowledgedAt: string; acknowledgedByUserId: number };
}

export type DicomRemapFileOutcomeCategory =
  | "processed"
  | "already_stored"
  | "skipped_non_dicom"
  | "skipped_other_study"
  | "skipped_unparseable"
  | "skipped_missing_identity"
  | "unassigned_likely_dicom"
  | "upload_failed_retryable"
  | "upload_failed_permanent";

interface DicomRemapFileOutcome {
  fileLabel: string;
  category: DicomRemapFileOutcomeCategory;
  retryCount: number;
  httpStatus?: number;
  responseShape?: string;
  orthancInstanceId?: string;
  orthancStudyId?: string;
  replacementSeriesInstanceUid?: string;
  replacementSopInstanceUid?: string;
  numberOfFrames?: number;
}

interface OrthancFetchResult {
  status: number;
  ok: boolean;
  text: string;
  json: unknown;
}

interface OrthancPatientSummary {
  patientId: string;
  patientName: string;
  patientSex: string;
  patientBirthDate: string;
}

interface OrthancStudySummary extends OrthancPatientSummary {
  studyInstanceUid: string;
}

interface DicomUidRemapPlan {
  studyInstanceUid: string;
  seriesInstanceUidByOriginal: Map<string, string>;
}

export interface DicomRemapPreviewFileMetadata {
  fileName?: unknown;
  filePath?: unknown;
  fileSize?: unknown;
}

export interface DicomRemapPreviewStagedFile extends DicomRemapStagedUploadFile {
  previewIndex: number;
  originalFileName: string;
  originalFilePath: string;
  originalFileSize: number;
}

interface DicomRemapPreviewEntry {
  previewIndex: number;
  fileName: string;
  filePath: string;
  fileSize: number;
  studyInstanceUid: string;
  seriesInstanceUid: string;
  sopInstanceUid: string;
  studyDate: string;
  studyDescription: string;
  modality: string;
  patientId: string;
  patientName: string;
  patientBirthDate: string;
  patientSex: string;
}

interface DicomRemapPreviewStudySummary {
  studyInstanceUid: string;
  studyDate: string;
  studyDescription: string;
  modality: string;
  patientId: string;
  patientName: string;
  patientBirthDate: string;
  patientSex: string;
  seriesCount: number;
  fileCount: number;
  totalBytes: number;
  files: DicomRemapPreviewEntry[];
}

interface OrthancStudyModifyPreflight {
  sourceStudyId: string;
  studyResponse: OrthancFetchResult;
  instanceCount: number | null;
  isStable: boolean | null;
  lastUpdate: string;
  seriesCount: number | null;
  parentPatientId: string;
  patientStudyIds: string[];
  orthancVersion?: string;
  databaseServerIdentifier?: string;
}

interface OrthancUploadResponseIdentifiers {
  parentStudyIds: string[];
  instanceIds: string[];
}

interface ConfirmComparison {
  original: OrthancPatientSummary;
  replacement: OrthancPatientSummary;
}

const DICOM_IDENTITY_MAX_LENGTH = 64;
const DICOM_CONTROL_CHAR_PATTERN = /[\x00-\x1F\x7F]/;
const DICOM_REMAP_UPLOAD_CONCURRENCY = 2;
const DICOM_REMAP_TEMP_PREFIX = "rispro-dicom-remap-";
export const DICOM_REMAP_PREVIEW_HEADER_BYTES = 512 * 1024;
const DICOM_REMAP_STAGING_MANIFEST_VERSION = 1;
const DICOM_REMAP_SELECTED_STUDY_MANIFEST_VERSION = 2;
const DICOM_REMAP_UID_PLAN_VERSION = 3;
export const DICOM_REMAP_INTEGRITY_VERSION = 1;
const DICOM_REMAP_UPLOAD_MAX_RETRIES = 2;
const DICOM_REMAP_FAILURE_SAMPLE_LIMIT = 20;
function readDicomRemapPositiveLimit(value: unknown, fallback: number): number {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : fallback;
}
export const DICOM_REMAP_STAGING_MAX_FILES = readDicomRemapPositiveLimit(process.env.DICOM_REMAP_STAGING_MAX_FILES, 10_000);
export const DICOM_REMAP_STAGING_MAX_TOTAL_BYTES = readDicomRemapPositiveLimit(process.env.DICOM_REMAP_STAGING_MAX_TOTAL_BYTES, 20 * 1024 * 1024 * 1024);
const DICOM_REMAP_ORTHANC_RECOVERY_RETENTION_HOURS = readDicomRemapPositiveLimit(process.env.DICOM_REMAP_ORTHANC_RECOVERY_RETENTION_HOURS, 168);
const DICOM_REMAP_ORTHANC_RECOVERY_LEASE_SECONDS = readDicomRemapPositiveLimit(process.env.DICOM_REMAP_ORTHANC_RECOVERY_LEASE_SECONDS, 180);
const ACTIVE_JOB_STATUSES: DicomRemapJobStatus[] = ["uploaded", "processing", "awaiting_confirmation", "remapped", "sending"];
const CANCELLABLE_JOB_STATUSES: DicomRemapJobStatus[] = ["awaiting_confirmation"];
const TERMINAL_JOB_STATUSES: DicomRemapJobStatus[] = ["sent", "failed", "cancelled"];
const REMAP_ORTHANC_OPERATION_TIMEOUT_SECONDS = 60;
const DICOM_REMAP_ORTHANC_STABILITY_TIMEOUT_SECONDS = readDicomRemapPositiveLimit(process.env.DICOM_REMAP_ORTHANC_STABILITY_TIMEOUT_SECONDS, 90);
const DICOM_REMAP_ORTHANC_STABILITY_POLL_MS = 1_000;
const DICOM_REMAP_ORTHANC_LEASE_RENEWAL_INTERVAL_SECONDS = 10;
const DICOM_REMAP_ORTHANC_SOP_READ_CONCURRENCY = 8;
let queryDicomRemapDb: DicomRemapQuery = pool.query.bind(pool);
let logDicomRemapAuditEntry: DicomRemapAuditLogger = logAuditEntry;
let fetchOrthancForRemap: OrthancFetch;
let sleepForDicomRemap: RemapSleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
let getPatientForDicomRemap: DicomRemapPatientLoader = getPatientById;
let listModalitiesForDicomRemap: DicomRemapModalityLister = listOrthancRemoteModalities;
let orthancBulkModifyAvailableForTests: boolean | null = null;
let afterRemappedInstanceUploadForTests: ((details: { jobId: number; fileIndex: number; studyId: string; body: Buffer }) => void | Promise<void>) | null = null;
let afterOrthancRecoverySourceUploadForTests: ((details: { jobId: number; fileIndex: number; studyId: string; body: Buffer }) => void | Promise<void>) | null = null;
let afterOrthancRecoveryModifyForTests: ((details: { jobId: number; sourceStudyId: string; modifiedStudyId: string }) => void | Promise<void>) | null = null;
let beforeDicomRemapProcessingCompletionForTests: (() => void | Promise<void>) | null = null;
let mutateStagedRewriteBeforeIntegrityForTests: ((output: Buffer) => Buffer) | null = null;
let failDicomSerializationForTests = false;

function joinUrl(baseUrl: string, suffix: string): string {
  const cleanBase = baseUrl.endsWith("/") ? baseUrl.slice(0, -1) : baseUrl;
  const cleanSuffix = suffix.startsWith("/") ? suffix : `/${suffix}`;
  return `${cleanBase}${cleanSuffix}`;
}

function sanitizeFileName(value: unknown): string {
  return String(value || "dicom.dcm").trim().replace(/[^a-zA-Z0-9._-]/g, "_");
}

function isSkippableDicomRemapFolderEntry(fileName: string): boolean {
  const clean = String(fileName || "").trim();
  const upper = clean.toUpperCase();
  const lower = clean.toLowerCase();
  if (upper === "DICOMDIR" || upper === "AUTORUN.INF") {
    return true;
  }
  return [
    ".exe",
    ".dll",
    ".bat",
    ".cmd",
    ".jar",
    ".jnlp",
    ".class",
    ".cab",
    ".zip",
    ".ini",
    ".html",
    ".htm",
    ".xml",
    ".log",
    ".txt",
    ".jpg",
    ".jpeg",
    ".png",
    ".gif",
    ".bmp",
    ".ico",
    ".pdf",
    ".db",
    ".pro",
  ].some((extension) => lower.endsWith(extension));
}

function isDicomRemapActiveStatus(status: DicomRemapJobStatus): boolean {
  return ACTIVE_JOB_STATUSES.includes(status);
}

function isDicomRemapTerminalStatus(status: DicomRemapJobStatus): boolean {
  return TERMINAL_JOB_STATUSES.includes(status);
}

function isDicomRemapCancellableStatus(status: DicomRemapJobStatus): boolean {
  return CANCELLABLE_JOB_STATUSES.includes(status);
}

function decodeBase64(value: unknown): Buffer {
  const raw = String(value || "").trim();
  if (!raw) {
    throw new HttpError(400, "fileContentBase64 is required.");
  }
  const normalized = raw.includes(",") ? raw.split(",").pop() || "" : raw;
  const decoded = Buffer.from(normalized, "base64");
  if (!decoded.length) {
    throw new HttpError(400, "Uploaded file is empty.");
  }
  return decoded;
}

function isLikelyDicomFile(fileName: string, mimeType: string): boolean {
  const lowerName = fileName.toLowerCase();
  const lowerMime = mimeType.toLowerCase();

  if (
    lowerMime.includes("dicom") ||
    lowerName.endsWith(".dcm") ||
    lowerName.endsWith(".dicom") ||
    lowerName.endsWith(".ima")
  ) {
    return true;
  }

  // Allow unknown/opaque binaries and let Orthanc perform the authoritative
  // DICOM validation. Block only clearly non-DICOM document/image types.
  if (
    lowerMime.startsWith("image/") ||
    lowerMime.startsWith("text/") ||
    lowerMime === "application/pdf" ||
    lowerName.endsWith(".pdf") ||
    lowerName.endsWith(".txt") ||
    lowerName.endsWith(".csv") ||
    lowerName.endsWith(".json") ||
    lowerName.endsWith(".jpg") ||
    lowerName.endsWith(".jpeg") ||
    lowerName.endsWith(".png") ||
    lowerName.endsWith(".gif") ||
    lowerName.endsWith(".webp")
  ) {
    return false;
  }

  return true;
}

function extractTagCandidate(tags: Record<string, unknown>, keys: string[]): string {
  for (const key of keys) {
    const value = tags[key];
    if (value == null) continue;
    const clean = String(value).trim();
    if (clean) return clean;
  }
  return "";
}

function normalizePatientSex(value: string): string {
  const upper = String(value || "").trim().toUpperCase();
  if (upper === "M" || upper === "F" || upper === "O") {
    return upper;
  }
  if (upper === "MALE") return "M";
  if (upper === "FEMALE") return "F";
  return "";
}

function normalizeDicomBirthDate(value: string): string {
  const clean = String(value || "").trim();
  if (!clean) return "";
  if (/^\d{8}$/.test(clean)) return clean;
  if (/^\d{4}-\d{2}-\d{2}$/.test(clean)) {
    return clean.replaceAll("-", "");
  }
  return "";
}

function normalizeDicomUid(value: string): string {
  return String(value || "").replace(/\0/g, "").trim();
}

function normalizeSelectedStudyInstanceUid(value: unknown): string {
  const clean = normalizeDicomUid(String(value || ""));
  if (!clean || clean.length > 64 || !/^[0-9]+(?:\.[0-9]+)+$/.test(clean)) {
    throw new HttpError(400, "A valid selected Study Instance UID is required.");
  }
  return clean;
}

function normalizeDicomPatientName(value: string): string {
  const clean = String(value || "").trim();
  if (!clean) return "";
  if (clean.includes("^")) return clean;
  return clean.replace(/\s+/g, "^");
}

function normalizeProvisionalSourceIdentity(
  value: unknown,
  selectedStudyInstanceUid: string
): DicomRemapProvisionalSourceIdentity {
  const record = value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
  const read = (key: keyof DicomRemapProvisionalSourceIdentity, maxLength = 256): string => {
    const clean = String(record[key] || "").replace(/\0/g, "").trim();
    if (clean.length > maxLength || DICOM_CONTROL_CHAR_PATTERN.test(clean)) {
      throw new HttpError(400, "Provisional source identity is invalid.");
    }
    return clean;
  };
  const snapshotUid = normalizeSelectedStudyInstanceUid(record.studyInstanceUid);
  if (snapshotUid !== selectedStudyInstanceUid) {
    throw new HttpError(400, "Provisional source identity does not match the selected study.");
  }
  return {
    studyInstanceUid: snapshotUid,
    patientId: read("patientId"),
    patientName: read("patientName"),
    patientBirthDate: read("patientBirthDate", 32),
    patientSex: read("patientSex", 16),
    modality: read("modality", 64),
    studyDate: read("studyDate", 32),
  };
}

function readDicomStringValue(value: unknown): string {
  if (value == null) return "";
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    return String(value).trim();
  }
  if (Array.isArray(value)) {
    for (const item of value) {
      const candidate = readDicomStringValue(item);
      if (candidate) return candidate;
    }
    return "";
  }
  if (typeof value === "object") {
    const record = value as Record<string, unknown>;
    return readDicomStringValue(record.Alphabetic ?? record.Value ?? "");
  }
  return "";
}

function readDicomPreviewString(buffer: Buffer, offset: number, length: number): string {
  return buffer
    .subarray(offset, Math.min(buffer.length, offset + Math.max(0, length)))
    .toString("latin1")
    .replace(/\0/g, "")
    .trim();
}

function readDicomPreviewUint16(buffer: Buffer, offset: number): number | null {
  if (offset + 2 > buffer.length) return null;
  return buffer.readUInt16LE(offset);
}

function readDicomPreviewUint32(buffer: Buffer, offset: number): number | null {
  if (offset + 4 > buffer.length) return null;
  return buffer.readUInt32LE(offset);
}

function dicomPreviewTagKey(group: number, element: number): string {
  return `${group.toString(16).padStart(4, "0")}${element.toString(16).padStart(4, "0")}`;
}

const DICOM_PREVIEW_LONG_VR = new Set(["OB", "OD", "OF", "OL", "OW", "SQ", "UC", "UR", "UT", "UN"]);
const DICOM_PREVIEW_TARGET_TAGS = new Set([
  "00020010",
  "00080018",
  "00080020",
  "00080060",
  "00081030",
  "00100010",
  "00100020",
  "0020000d",
  "0020000e",
]);

function parseDicomPreviewElements(buffer: Buffer, startOffset: number, explicitVr: boolean): Record<string, string> {
  const tags: Record<string, string> = {};
  let offset = startOffset;

  while (offset + 8 <= buffer.length) {
    const group = readDicomPreviewUint16(buffer, offset);
    const element = readDicomPreviewUint16(buffer, offset + 2);
    if (group == null || element == null) break;
    const key = dicomPreviewTagKey(group, element);
    if (key === "7fe00010") break;

    let valueOffset = offset + 8;
    let valueLength: number | null = null;
    if (explicitVr) {
      const vr = buffer.subarray(offset + 4, offset + 6).toString("latin1");
      if (DICOM_PREVIEW_LONG_VR.has(vr)) {
        valueLength = readDicomPreviewUint32(buffer, offset + 8);
        valueOffset = offset + 12;
      } else {
        valueLength = readDicomPreviewUint16(buffer, offset + 6);
        valueOffset = offset + 8;
      }
    } else {
      valueLength = readDicomPreviewUint32(buffer, offset + 4);
      valueOffset = offset + 8;
    }

    if (valueLength == null || valueLength === 0xffffffff || valueLength < 0) break;
    const nextOffset = valueOffset + valueLength + (valueLength % 2);
    if (valueOffset > buffer.length) break;

    if (DICOM_PREVIEW_TARGET_TAGS.has(key)) {
      const value = readDicomPreviewString(buffer, valueOffset, valueLength);
      if (value) tags[key] = value;
      if (tags["0020000d"] && tags["00100010"] && tags["00100020"] && tags["00080020"] && tags["00080060"]) {
        break;
      }
    }

    if (nextOffset <= offset) break;
    offset = nextOffset;
  }

  return tags;
}

function parseDicomPreviewTags(buffer: Buffer): Record<string, string> {
  const hasPreamble = buffer.length >= 132 && buffer.subarray(128, 132).toString("latin1") === "DICM";
  const datasetStart = hasPreamble ? 132 : 0;
  const metaTags = hasPreamble ? parseDicomPreviewElements(buffer, datasetStart, true) : {};
  const transferSyntax = metaTags["00020010"] || "";
  const explicitVr = transferSyntax !== "1.2.840.10008.1.2";

  if (!hasPreamble) {
    const explicitTags = parseDicomPreviewElements(buffer, 0, true);
    if (explicitTags["0020000d"]) return explicitTags;
    return parseDicomPreviewElements(buffer, 0, false);
  }

  let offset = datasetStart;
  while (offset + 8 <= buffer.length) {
    const group = readDicomPreviewUint16(buffer, offset);
    if (group == null || group !== 0x0002) break;
    const vr = buffer.subarray(offset + 4, offset + 6).toString("latin1");
    const isLongVr = DICOM_PREVIEW_LONG_VR.has(vr);
    const length = isLongVr ? readDicomPreviewUint32(buffer, offset + 8) : readDicomPreviewUint16(buffer, offset + 6);
    const valueOffset = isLongVr ? offset + 12 : offset + 8;
    if (length == null || length === 0xffffffff) break;
    offset = valueOffset + length + (length % 2);
  }

  return parseDicomPreviewElements(buffer, offset, explicitVr);
}

function assertNoDicomControlChars(value: string, fieldName: string): void {
  if (DICOM_CONTROL_CHAR_PATTERN.test(value)) {
    throw new HttpError(400, `${fieldName} contains invalid control characters.`);
  }
}

function dicomByteLength(value: string): number {
  return Buffer.byteLength(value, "utf8");
}

function normalizeDicomPatientIdForReplace(value: string): string {
  const clean = String(value || "").trim();
  assertNoDicomControlChars(clean, "PatientID");
  if (dicomByteLength(clean) > DICOM_IDENTITY_MAX_LENGTH) {
    throw new HttpError(400, "PatientID is too long for DICOM");
  }
  return clean;
}

function normalizeDicomPatientNameForReplace(value: string): string {
  assertNoDicomControlChars(String(value || ""), "PatientName");
  const normalized = normalizeDicomPatientName(value);
  if (dicomByteLength(normalized) > DICOM_IDENTITY_MAX_LENGTH) {
    throw new HttpError(400, "PatientName is too long for DICOM");
  }
  const groups = normalized.split("=");
  for (const group of groups) {
    if (dicomByteLength(group) > DICOM_IDENTITY_MAX_LENGTH) {
      throw new HttpError(400, "PatientName is too long for DICOM");
    }
  }
  return normalized;
}

function validateOrthancReplacementIdentity(replacement: OrthancPatientSummary): OrthancPatientSummary {
  return {
    patientId: normalizeDicomPatientIdForReplace(replacement.patientId),
    patientName: normalizeDicomPatientNameForReplace(replacement.patientName),
    patientSex: normalizePatientSex(replacement.patientSex),
    patientBirthDate: normalizeDicomBirthDate(replacement.patientBirthDate),
  };
}

function parseOrthancResourceId(payload: unknown): string {
  if (!payload || typeof payload !== "object") {
    return "";
  }
  const record = payload as Record<string, unknown>;
  const candidates = [record.ID, record.Id, record.id, record.ParentStudy, record.Parent];
  for (const candidate of candidates) {
    const clean = String(candidate || "").trim();
    if (clean) return clean;
  }
  return "";
}

function parseOrthancModifiedStudyId(payload: unknown): string {
  const seen = new Set<unknown>();

  function visit(value: unknown): string {
    if (!value || typeof value !== "object" || seen.has(value)) {
      return "";
    }
    seen.add(value);

    if (Array.isArray(value)) {
      for (const item of value) {
        const cleanItem = typeof item === "string" ? item.trim() : "";
        if (cleanItem) return cleanItem;
        const nested = visit(item);
        if (nested) return nested;
      }
      return "";
    }

    const record = value as Record<string, unknown>;
    const direct = parseOrthancResourceId(record);
    if (direct) return direct;

    const studyIdFromPath = extractOrthancIdFromPath(record.Path, "studies");
    if (studyIdFromPath) return studyIdFromPath;

    const resourceCollections = [
      record.Resources,
      record.resources,
      record.Studies,
      record.studies,
      record.ModifiedResources,
      record.modifiedResources,
    ];
    for (const collection of resourceCollections) {
      const nested = visit(collection);
      if (nested) return nested;
    }

    for (const nestedValue of Object.values(record)) {
      const nested = visit(nestedValue);
      if (nested) return nested;
    }

    return "";
  }

  return visit(payload);
}

/** Orthanc returns asynchronous job identifiers in slightly different envelopes by version. */
function parseOrthancSendJobId(payload: unknown): string {
  const seen = new Set<unknown>();
  function visit(value: unknown): string {
    if (!value || typeof value !== "object" || seen.has(value)) return "";
    seen.add(value);
    if (Array.isArray(value)) {
      for (const item of value) {
        const found = visit(item);
        if (found) return found;
      }
      return "";
    }
    const record = value as Record<string, unknown>;
    for (const candidate of [record.ID, record.Id, record.id, record.JobId, record.JobID, record.jobId]) {
      const clean = String(candidate || "").trim();
      if (clean) return clean;
    }
    const path = String(record.Path || record.path || record.URI || record.Uri || record.uri || "").trim();
    const match = path.match(/(?:^|\/)jobs\/([^/?#]+)/i);
    if (match?.[1]) return decodeURIComponent(match[1]);
    for (const nested of [record.Job, record.job, record.Jobs, record.jobs, record.Result, record.result]) {
      const found = visit(nested);
      if (found) return found;
    }
    return "";
  }
  return visit(payload);
}

function pushUnique(values: string[], value: unknown): void {
  const clean = String(value || "").trim();
  if (clean && !values.includes(clean)) {
    values.push(clean);
  }
}

function extractOrthancIdFromPath(path: unknown, resourceName: "instances" | "studies"): string {
  const clean = String(path || "").trim();
  if (!clean) return "";
  const match = clean.match(new RegExp(`(?:^|/)${resourceName}/([^/?#]+)`, "i"));
  if (!match?.[1]) return "";
  try {
    return decodeURIComponent(match[1]);
  } catch {
    return match[1];
  }
}

function parseOrthancUploadResponse(payload: unknown): OrthancUploadResponseIdentifiers {
  const identifiers: OrthancUploadResponseIdentifiers = {
    parentStudyIds: [],
    instanceIds: [],
  };
  const seen = new Set<unknown>();

  function visit(value: unknown): void {
    if (!value || typeof value !== "object" || seen.has(value)) {
      return;
    }
    seen.add(value);

    if (Array.isArray(value)) {
      for (const item of value) visit(item);
      return;
    }

    const record = value as Record<string, unknown>;
    pushUnique(identifiers.parentStudyIds, record.ParentStudy);
    pushUnique(identifiers.parentStudyIds, record.parentStudy);
    pushUnique(identifiers.parentStudyIds, record.Parent);

    const studyIdFromPath = extractOrthancIdFromPath(record.Path, "studies");
    pushUnique(identifiers.parentStudyIds, studyIdFromPath);

    const instanceIdFromPath = extractOrthancIdFromPath(record.Path, "instances");
    pushUnique(identifiers.instanceIds, instanceIdFromPath);

    const instanceId = record.ID ?? record.Id ?? record.id;
    pushUnique(identifiers.instanceIds, instanceId);

    for (const nested of Object.values(record)) {
      visit(nested);
    }
  }

  visit(payload);
  return identifiers;
}

function describeOrthancPayloadShape(payload: unknown): string {
  if (payload == null) {
    return String(payload);
  }
  if (Array.isArray(payload)) {
    const firstShape = payload.length ? describeOrthancPayloadShape(payload[0]) : "empty";
    return `array(length=${payload.length}, first=${firstShape})`;
  }
  if (typeof payload !== "object") {
    return typeof payload;
  }

  const record = payload as Record<string, unknown>;
  const keys = Object.keys(record).slice(0, 12).join(",");
  return `object(keys=${keys || "none"})`;
}

function sanitizeOrthancResponseSnippet(text: unknown, maxLength = 500): string {
  void maxLength;
  return String(text || "").trim() ? "[redacted]" : "";
}

const ORTHANC_SAFE_ERROR_FIELDS = ["Message", "Details", "OrthancError", "OrthancStatus", "HttpStatus", "Method", "Uri"] as const;

function sanitizeOrthancErrorString(value: unknown, maxLength = 320): string | null {
  if (typeof value !== "string") return null;
  const normalized = value.replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim();
  if (!normalized || /authorization|cookie|set-cookie|bearer\s|password|token/i.test(normalized)) return null;
  // Orthanc error bodies can include local paths. Do not persist such text.
  if (/[A-Za-z]:[\\/]|(?:^|\s)\/(?:[^\s]*)/.test(normalized)) return null;
  return normalized.slice(0, maxLength);
}

function sanitizeOrthancErrorResponse(payload: unknown): Record<string, string | number> {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return {};
  const raw = payload as Record<string, unknown>;
  const safe: Record<string, string | number> = {};
  for (const field of ORTHANC_SAFE_ERROR_FIELDS) {
    const value = raw[field];
    if (["OrthancStatus", "HttpStatus"].includes(field)) {
      const numeric = Number(value);
      if (Number.isInteger(numeric) && numeric >= 0 && numeric <= 999) safe[field] = numeric;
      continue;
    }
    if (field === "Method") {
      const method = typeof value === "string" ? value.trim().toUpperCase() : "";
      if (/^(GET|POST|PUT|DELETE|PATCH)$/.test(method)) safe[field] = method;
      continue;
    }
    if (field === "Uri") {
      const uri = typeof value === "string" ? value.trim() : "";
      if (/^\/[A-Za-z0-9_./-]*$/.test(uri) && !uri.includes("..")) safe[field] = uri.slice(0, 320);
      continue;
    }
    const sanitized = sanitizeOrthancErrorString(value);
    if (sanitized) safe[field] = sanitized;
  }
  return safe;
}

function formatOrthancUploadFailureMessage(_fileName: string, fileIndex: number, response: OrthancFetchResult): string {
  const message = sanitizeOrthancErrorResponse(response.json).Message;
  const detail = typeof message === "string" ? ` — ${message}` : "";
  return `Orthanc rejected File ${fileIndex} (HTTP ${response.status}${detail}).`;
}

function isOrthancInvalidDicomUploadRejection(response: OrthancFetchResult): boolean {
  if (response.status !== 400) {
    return false;
  }

  if (response.json && typeof response.json === "object") {
    const record = response.json as Record<string, unknown>;
    if (Number(record.OrthancStatus) === 15) {
      return true;
    }
  }

  const combinedBody = `${response.text || ""} ${response.json ? JSON.stringify(response.json) : ""}`;
  return /bad file format|cannot parse an invalid dicom file/i.test(combinedBody);
}

async function uploadDicomContentToOrthanc({
  body,
  fileName,
  fileIndex,
  tolerateInvalidDicom = false,
}: {
  body: Buffer | Readable;
  fileName: string;
  fileIndex: number;
  tolerateInvalidDicom?: boolean;
}): Promise<string | null> {
  const uploadResponse = await fetchOrthancForRemap("/instances", {
    method: "POST",
    body,
    contentType: "application/dicom",
    timeoutSeconds: REMAP_ORTHANC_OPERATION_TIMEOUT_SECONDS,
  });

  if (!uploadResponse.ok) {
    if (tolerateInvalidDicom && isOrthancInvalidDicomUploadRejection(uploadResponse)) {
      return null;
    }

    const message = formatOrthancUploadFailureMessage(fileName, fileIndex, uploadResponse);
    console.error("Orthanc DICOM remap upload failed.", {
      fileLabel: `File ${fileIndex}`,
      fileIndex,
      orthancStatus: uploadResponse.status,
      orthancResponseShape: describeOrthancPayloadShape(uploadResponse.json),
    });

    throw new HttpError(
      400,
      message,
      {
        fileLabel: `File ${fileIndex}`,
        fileIndex,
        orthancStatus: uploadResponse.status,
        orthancResponseShape: describeOrthancPayloadShape(uploadResponse.json),
        orthancError: sanitizeOrthancErrorResponse(uploadResponse.json),
      }
    );
  }

  return resolveStudyIdFromOrthancUploadResponse(uploadResponse);
}

function isOrthancTimeoutError(error: unknown): boolean {
  return error instanceof HttpError && error.statusCode === 504;
}

function hasSameReplacementIdentity(
  summary: OrthancPatientSummary,
  replacement: OrthancPatientSummary
): boolean {
  return (
    summary.patientId === replacement.patientId &&
    normalizeDicomPatientName(summary.patientName) === normalizeDicomPatientName(replacement.patientName) &&
    normalizePatientSex(summary.patientSex) === normalizePatientSex(replacement.patientSex) &&
    normalizeDicomBirthDate(summary.patientBirthDate) === normalizeDicomBirthDate(replacement.patientBirthDate)
  );
}

function hasExpectedRemappedPatientId(summary: OrthancPatientSummary, expectedPatientId: string): boolean {
  return summary.patientId === expectedPatientId;
}

function readNaturalizedStudySummary(dataset: Record<string, unknown>): OrthancStudySummary {
  return {
    studyInstanceUid: readDicomStringValue(dataset.StudyInstanceUID),
    patientId: readDicomStringValue(dataset.PatientID),
    patientName: normalizeDicomPatientName(readDicomStringValue(dataset.PatientName)),
    patientSex: normalizePatientSex(readDicomStringValue(dataset.PatientSex)),
    patientBirthDate: normalizeDicomBirthDate(readDicomStringValue(dataset.PatientBirthDate)),
  };
}

function createDicomUid(): string {
  const hex = randomUUID().replaceAll("-", "");
  return `2.25.${BigInt(`0x${hex}`).toString(10)}`;
}

function getOrCreateSeriesInstanceUid(
  originalSeriesInstanceUid: string,
  plan: DicomUidRemapPlan
): string {
  const key = originalSeriesInstanceUid || "__missing_series_uid__";
  const existing = plan.seriesInstanceUidByOriginal.get(key);
  if (existing) {
    return existing;
  }
  const created = createDicomUid();
  plan.seriesInstanceUidByOriginal.set(key, created);
  return created;
}

const DICOM_FILE_META_TRANSFER_SYNTAX_TAG = "00020010";
const DICOM_FILE_META_MEDIA_STORAGE_SOP_INSTANCE_TAG = "00020003";
const DICOM_PIXEL_DATA_TAG = "7FE00010";
const DICOM_PIXEL_INTEGRITY_FIELDS = [
  "SOPClassUID",
  "Rows",
  "Columns",
  "SamplesPerPixel",
  "PhotometricInterpretation",
  "BitsAllocated",
  "BitsStored",
  "HighBit",
  "PixelRepresentation",
] as const;

type DicomElement = { vr?: unknown; Value?: unknown; _rawValue?: unknown };

function cloneDicomElementValue(value: unknown): unknown {
  if (value instanceof ArrayBuffer) return value.slice(0);
  if (ArrayBuffer.isView(value)) {
    return value.buffer.slice(value.byteOffset, value.byteOffset + value.byteLength);
  }
  if (Array.isArray(value)) return value.map(cloneDicomElementValue);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>).map(([key, nested]) => [key, cloneDicomElementValue(nested)]));
  }
  return value;
}

function cloneDicomFileMetaForWriter(meta: Record<string, unknown>): Record<string, unknown> {
  const cloned = Object.fromEntries(Object.entries(meta).map(([tag, element]) => [tag, cloneDicomElementValue(element)]));
  const transferSyntaxElement = cloned[DICOM_FILE_META_TRANSFER_SYNTAX_TAG];
  if (!transferSyntaxElement || typeof transferSyntaxElement !== "object") {
    throw new HttpError(400, "DICOM file meta is missing TransferSyntaxUID.", { code: "DICOM_REMAP_DICOM_REWRITE_FAILED" });
  }
  // dcmjs datasetToBuffer reads this named property as a structured element.
  cloned.TransferSyntaxUID = transferSyntaxElement;
  const mediaStorageSopElement = cloned[DICOM_FILE_META_MEDIA_STORAGE_SOP_INSTANCE_TAG];
  if (mediaStorageSopElement && typeof mediaStorageSopElement === "object") {
    cloned.MediaStorageSOPInstanceUID = mediaStorageSopElement;
  }
  return cloned;
}

function updateStructuredMediaStorageSopInstanceUid(meta: Record<string, unknown>, sopInstanceUid: string): void {
  const current = meta[DICOM_FILE_META_MEDIA_STORAGE_SOP_INSTANCE_TAG];
  const element: DicomElement = current && typeof current === "object"
    ? current as DicomElement
    : { vr: "UI", Value: [] };
  element.Value = [sopInstanceUid];
  if ("_rawValue" in element) element._rawValue = [sopInstanceUid];
  meta[DICOM_FILE_META_MEDIA_STORAGE_SOP_INSTANCE_TAG] = element;
  meta.MediaStorageSOPInstanceUID = element;
}

function readStructuredDicomElementString(element: unknown): string {
  if (!element || typeof element !== "object") return "";
  return readDicomStringValue((element as DicomElement).Value);
}

function isEncapsulatedTransferSyntax(transferSyntaxUid: string): boolean {
  return transferSyntaxUid.startsWith("1.2.840.10008.1.2.4.") || transferSyntaxUid === "1.2.840.10008.1.2.5";
}

function hashDicomPixelPayload(buffers: Buffer[]): { sha256: string; byteLength: number } {
  const hash = createHash("sha256");
  let byteLength = 0;
  for (const buffer of buffers) {
    hash.update(buffer);
    byteLength += buffer.length;
  }
  return { sha256: hash.digest("hex"), byteLength };
}

function readPhysicalPixelData(buffer: Buffer, transferSyntax: string): {
  actualPixelRepresentation: "absent" | "encapsulated" | "native" | "unknown";
  pixelValueLengthMode: "absent" | "undefined" | "finite" | "unknown";
  fragmentCount: number;
  payloadBuffers: Buffer[];
} {
  if (transferSyntax === "1.2.840.10008.1.2.1.99") {
    return { actualPixelRepresentation: "unknown", pixelValueLengthMode: "unknown", fragmentCount: 0, payloadBuffers: [] };
  }
  const bigEndian = transferSyntax === "1.2.840.10008.1.2.2";
  const implicit = transferSyntax === "1.2.840.10008.1.2";
  const tag = bigEndian ? Buffer.from([0x7f, 0xe0, 0x00, 0x10]) : Buffer.from([0xe0, 0x7f, 0x10, 0x00]);
  let offset = buffer.indexOf(tag);
  while (offset >= 0) {
    const headerLength = implicit ? 8 : 12;
    if (offset + headerLength <= buffer.length) {
      const vr = implicit ? "" : buffer.toString("ascii", offset + 4, offset + 6);
      if (implicit || ["OB", "OW", "OF", "OD", "OL", "OV", "UN"].includes(vr)) {
        const valueLength = bigEndian ? buffer.readUInt32BE(offset + headerLength - 4) : buffer.readUInt32LE(offset + headerLength - 4);
        const valueOffset = offset + headerLength;
        if (valueLength !== 0xffffffff && valueOffset + valueLength <= buffer.length) {
          return { actualPixelRepresentation: "native", pixelValueLengthMode: "finite", fragmentCount: 0, payloadBuffers: [buffer.subarray(valueOffset, valueOffset + valueLength)] };
        }
        if (valueLength === 0xffffffff && !bigEndian) {
          const fragments: Buffer[] = [];
          let cursor = valueOffset;
          let itemIndex = 0;
          while (cursor + 8 <= buffer.length) {
            const group = buffer.readUInt16LE(cursor);
            const element = buffer.readUInt16LE(cursor + 2);
            const itemLength = buffer.readUInt32LE(cursor + 4);
            cursor += 8;
            if (group !== 0xfffe) break;
            if (element === 0xe0dd) {
              return { actualPixelRepresentation: "encapsulated", pixelValueLengthMode: "undefined", fragmentCount: fragments.length, payloadBuffers: fragments };
            }
            if (element !== 0xe000 || itemLength === 0xffffffff || cursor + itemLength > buffer.length) break;
            if (itemIndex > 0) fragments.push(buffer.subarray(cursor, cursor + itemLength));
            itemIndex += 1;
            cursor += itemLength;
          }
          return { actualPixelRepresentation: "unknown", pixelValueLengthMode: "undefined", fragmentCount: fragments.length, payloadBuffers: fragments };
        }
      }
    }
    offset = buffer.indexOf(tag, offset + 1);
  }
  return { actualPixelRepresentation: "absent", pixelValueLengthMode: "absent", fragmentCount: 0, payloadBuffers: [] };
}

type OrthancRecoveryPreparedDicom = {
  body: Buffer;
  structurallyRepaired: boolean;
  pixelPayloadSha256?: string;
  pixelPayloadLength?: number;
  fragmentCount?: number;
};

type ExplicitLittleEndianElement = { group: number; element: number; vr: string; valueOffset: number; valueLength: number; nextOffset: number };

function readExplicitLittleEndianElement(buffer: Buffer, offset: number): ExplicitLittleEndianElement | null {
  if (offset + 8 > buffer.length) return null;
  const group = buffer.readUInt16LE(offset);
  const element = buffer.readUInt16LE(offset + 2);
  const vr = buffer.toString("ascii", offset + 4, offset + 6);
  const longVr = ["OB", "OD", "OF", "OL", "OV", "OW", "SQ", "UC", "UN", "UR", "UT"].includes(vr);
  const headerLength = longVr ? 12 : 8;
  if (offset + headerLength > buffer.length) return null;
  const valueLength = longVr ? buffer.readUInt32LE(offset + 8) : buffer.readUInt16LE(offset + 6);
  if (valueLength === 0xffffffff || offset + headerLength + valueLength > buffer.length) return null;
  return { group, element, vr, valueOffset: offset + headerLength, valueLength, nextOffset: offset + headerLength + valueLength };
}

function readDicomRecoveryFileMeta(buffer: Buffer): { transferSyntax: string; datasetOffset: number } | null {
  if (buffer.length < 144 || buffer.toString("ascii", 128, 132) !== "DICM") return null;
  let offset = 132;
  let transferSyntax = "";
  while (offset < buffer.length) {
    const element = readExplicitLittleEndianElement(buffer, offset);
    if (!element || element.group !== 0x0002) break;
    if (element.element === 0x0010 && element.vr === "UI") transferSyntax = buffer.toString("ascii", element.valueOffset, element.nextOffset).replace(/\0+$/g, "").trim();
    offset = element.nextOffset;
  }
  return transferSyntax ? { transferSyntax, datasetOffset: offset } : null;
}

function inspectMissingPixelSequenceDelimiter(buffer: Buffer): { state: "not_applicable" | "already_terminated" | "repairable"; transferSyntax?: string; fragmentCount?: number; pixelPayloadSha256?: string; pixelPayloadLength?: number } {
  const fileMeta = readDicomRecoveryFileMeta(buffer);
  if (!fileMeta || !fileMeta.transferSyntax.startsWith("1.2.840.10008.1.2.4.")) return { state: "not_applicable" };
  let offset = fileMeta.datasetOffset;
  let pixelOffset = -1;
  while (offset < buffer.length) {
    if (offset + 8 > buffer.length) return { state: "not_applicable" };
    const group = buffer.readUInt16LE(offset);
    const element = buffer.readUInt16LE(offset + 2);
    const vr = buffer.toString("ascii", offset + 4, offset + 6);
    const longVr = ["OB", "OD", "OF", "OL", "OV", "OW", "SQ", "UC", "UN", "UR", "UT"].includes(vr);
    const headerLength = longVr ? 12 : 8;
    if (offset + headerLength > buffer.length) return { state: "not_applicable" };
    const valueLength = longVr ? buffer.readUInt32LE(offset + 8) : buffer.readUInt16LE(offset + 6);
    if (group === 0x7fe0 && element === 0x0010) {
      if (valueLength !== 0xffffffff || !longVr) return { state: "not_applicable" };
      pixelOffset = offset + headerLength;
      break;
    }
    // A preceding undefined-length value cannot be skipped safely by this deliberately narrow parser.
    if (valueLength === 0xffffffff || offset + headerLength + valueLength > buffer.length) return { state: "not_applicable" };
    offset += headerLength + valueLength;
  }
  if (pixelOffset < 0 || pixelOffset + 8 > buffer.length) return { state: "not_applicable" };
  let cursor = pixelOffset;
  const botGroup = buffer.readUInt16LE(cursor);
  const botElement = buffer.readUInt16LE(cursor + 2);
  const botLength = buffer.readUInt32LE(cursor + 4);
  if (botGroup !== 0xfffe || botElement !== 0xe000 || botLength === 0xffffffff || botLength % 4 !== 0 || cursor + 8 + botLength > buffer.length) return { state: "not_applicable" };
  cursor += 8 + botLength;
  const payloads: Buffer[] = [];
  let fragmentCount = 0;
  while (cursor < buffer.length) {
    if (cursor + 8 > buffer.length) return { state: "not_applicable" };
    const group = buffer.readUInt16LE(cursor);
    const element = buffer.readUInt16LE(cursor + 2);
    const length = buffer.readUInt32LE(cursor + 4);
    cursor += 8;
    if (group !== 0xfffe) return { state: "not_applicable" };
    if (element === 0xe0dd) {
      if (length !== 0 || cursor !== buffer.length) return { state: "not_applicable" };
      const payload = hashDicomPixelPayload(payloads);
      return { state: "already_terminated", transferSyntax: fileMeta.transferSyntax, fragmentCount, pixelPayloadSha256: payload.sha256, pixelPayloadLength: payload.byteLength };
    }
    if (element !== 0xe000 || length === 0xffffffff || length % 2 !== 0 || cursor + length > buffer.length) return { state: "not_applicable" };
    payloads.push(buffer.subarray(cursor, cursor + length));
    fragmentCount += 1;
    cursor += length;
  }
  if (!fragmentCount) return { state: "not_applicable" };
  const last = payloads[payloads.length - 1]!;
  const endsWithEoi = last.length >= 2 && last.subarray(last.length - 2).equals(Buffer.from([0xff, 0xd9]));
  const endsWithPaddedEoi = last.length >= 3 && last.subarray(last.length - 3).equals(Buffer.from([0xff, 0xd9, 0x00]));
  if (!endsWithEoi && !endsWithPaddedEoi) return { state: "not_applicable" };
  const payload = hashDicomPixelPayload(payloads);
  return { state: "repairable", transferSyntax: fileMeta.transferSyntax, fragmentCount, pixelPayloadSha256: payload.sha256, pixelPayloadLength: payload.byteLength };
}

function prepareDicomForOrthancRecoveryUpload(originalBody: Buffer): OrthancRecoveryPreparedDicom {
  const inspected = inspectMissingPixelSequenceDelimiter(originalBody);
  if (inspected.state !== "repairable") return { body: originalBody, structurallyRepaired: false };
  const delimiter = Buffer.from([0xfe, 0xff, 0xdd, 0xe0, 0x00, 0x00, 0x00, 0x00]);
  const repairedBody = Buffer.concat([originalBody, delimiter]);
  const repaired = inspectMissingPixelSequenceDelimiter(repairedBody);
  if (
    repairedBody.length !== originalBody.length + delimiter.length ||
    !repairedBody.subarray(0, originalBody.length).equals(originalBody) ||
    repaired.state !== "already_terminated" ||
    repaired.transferSyntax !== inspected.transferSyntax ||
    repaired.fragmentCount !== inspected.fragmentCount ||
    repaired.pixelPayloadLength !== inspected.pixelPayloadLength ||
    repaired.pixelPayloadSha256 !== inspected.pixelPayloadSha256
  ) {
    throw new HttpError(409, "DICOM recovery source repair did not preserve the original object.", { code: "DICOM_REMAP_ORTHANC_SOURCE_REPAIR_FAILED" });
  }
  // The byte-identical prefix proves every DICOM identity and image-defining attribute is unchanged.
  return {
    body: repairedBody,
    structurallyRepaired: true,
    pixelPayloadSha256: inspected.pixelPayloadSha256,
    pixelPayloadLength: inspected.pixelPayloadLength,
    fragmentCount: inspected.fragmentCount,
  };
}

function inspectDicomPixelIntegrity(buffer: Buffer): {
  transferSyntax: string;
  declaredTransferSyntax: string;
  declaredTransferSyntaxIsEncapsulated: boolean;
  dataset: Record<string, unknown>;
  pixelRepresentation: "absent" | "encapsulated" | "native";
  actualPixelRepresentation: "absent" | "encapsulated" | "native" | "unknown";
  pixelValueLengthMode: "absent" | "undefined" | "finite" | "unknown";
  fragmentCount: number;
  pixelSha256: string;
  pixelLength: number;
} {
  const dicom = DicomMessage.readFile(buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength)) as { dict: Record<string, unknown>; meta: Record<string, unknown> };
  const transferSyntax = readStructuredDicomElementString(dicom.meta[DICOM_FILE_META_TRANSFER_SYNTAX_TAG]);
  const dataset = DicomMetaDictionary.naturalizeDataset(dicom.dict) as Record<string, unknown>;
  const detected = readPhysicalPixelData(buffer, transferSyntax);
  const physical = dicom.dict[DICOM_PIXEL_DATA_TAG] && detected.actualPixelRepresentation === "absent"
    ? { ...detected, actualPixelRepresentation: "unknown" as const, pixelValueLengthMode: "unknown" as const }
    : detected;
  const payload = hashDicomPixelPayload(physical.payloadBuffers);
  const pixelRepresentation = physical.actualPixelRepresentation === "unknown" ? "absent" : physical.actualPixelRepresentation;
  return { transferSyntax, declaredTransferSyntax: transferSyntax, declaredTransferSyntaxIsEncapsulated: isEncapsulatedTransferSyntax(transferSyntax), dataset, pixelRepresentation, ...physical, pixelSha256: payload.sha256, pixelLength: payload.byteLength };
}

function throwDicomPixelIntegrityFailure(
  failedInvariant: string,
  source: ReturnType<typeof inspectDicomPixelIntegrity>,
  output: ReturnType<typeof inspectDicomPixelIntegrity> | null,
): never {
  throw new HttpError(409, "Rewritten DICOM failed pixel integrity validation and was not uploaded.", {
    code: "DICOM_REMAP_PIXEL_INTEGRITY_FAILED",
    sourceTransferSyntax: source.transferSyntax,
    outputTransferSyntax: output?.transferSyntax || "unreadable",
    sourcePixelLength: source.pixelLength,
    outputPixelLength: output?.pixelLength ?? 0,
    failedInvariant,
  });
}

function assertRewrittenDicomPixelIntegrity(sourceBuffer: Buffer, outputBuffer: Buffer): void {
  const source = inspectDicomPixelIntegrity(sourceBuffer);
  let output: ReturnType<typeof inspectDicomPixelIntegrity>;
  try {
    output = inspectDicomPixelIntegrity(outputBuffer);
  } catch {
    throwDicomPixelIntegrityFailure("outputReadable", source, null);
  }
  const sourceExpected = source.declaredTransferSyntaxIsEncapsulated ? "encapsulated" : "native";
  const outputExpected = output.declaredTransferSyntaxIsEncapsulated ? "encapsulated" : "native";
  if (source.actualPixelRepresentation !== "absent" && source.actualPixelRepresentation !== sourceExpected) throwDicomPixelIntegrityFailure("PixelDataEncoding", source, output);
  if (output.actualPixelRepresentation !== "absent" && output.actualPixelRepresentation !== outputExpected) throwDicomPixelIntegrityFailure("PixelDataEncoding", source, output);
  if (source.transferSyntax !== output.transferSyntax) throwDicomPixelIntegrityFailure("TransferSyntaxUID", source, output);
  for (const field of DICOM_PIXEL_INTEGRITY_FIELDS) {
    if (readDicomStringValue(source.dataset[field]) !== readDicomStringValue(output.dataset[field])) {
      throwDicomPixelIntegrityFailure(field, source, output);
    }
  }
  if ((source.dataset.NumberOfFrames != null || output.dataset.NumberOfFrames != null) && readDicomStringValue(source.dataset.NumberOfFrames) !== readDicomStringValue(output.dataset.NumberOfFrames)) {
    throwDicomPixelIntegrityFailure("NumberOfFrames", source, output);
  }
  if (source.actualPixelRepresentation !== output.actualPixelRepresentation) throwDicomPixelIntegrityFailure("PixelDataRepresentation", source, output);
  if (source.pixelValueLengthMode !== output.pixelValueLengthMode) throwDicomPixelIntegrityFailure("PixelDataValueLength", source, output);
  if (source.pixelLength !== output.pixelLength) throwDicomPixelIntegrityFailure("PixelDataLength", source, output);
  if (source.pixelSha256 !== output.pixelSha256) throwDicomPixelIntegrityFailure("PixelDataPayload", source, output);
}

function serializeDicomDatasetForRewrite(dataset: Record<string, unknown>): Buffer {
  try {
    if (failDicomSerializationForTests) throw new Error("Synthetic dcmjs serialization failure");
    return Buffer.from(datasetToBuffer(dataset));
  } catch {
    throw new HttpError(409, "DICOM metadata serialization failed before Orthanc upload.", { code: "DICOM_REMAP_DICOM_REWRITE_FAILED" });
  }
}

async function rewriteDicomFileForRemap(
  stagedFile: DicomRemapStagedUploadFile,
  replacement: OrthancPatientSummary,
  uidPlan?: DicomUidRemapPlan,
): Promise<{ body: Buffer; originalSummary: OrthancStudySummary; replacementSopInstanceUid: string | null }> {
  const raw = await readFile(stagedFile.path);
  let dicomFile: { dict: Record<string, unknown>; meta: Record<string, unknown> };

  try {
    dicomFile = DicomMessage.readFile(raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.byteLength)) as {
      dict: Record<string, unknown>;
      meta: Record<string, unknown>;
    };
  } catch (error) {
    throw new HttpError(
      400,
      "RISPro could not rewrite one DICOM file before upload. Please reset current upload and retry.",
      {
        code: "DICOM_REMAP_DICOM_PARSE_FAILED",
      }
    );
  }

  const dataset = DicomMetaDictionary.naturalizeDataset(dicomFile.dict) as Record<string, unknown>;
  dataset._meta = cloneDicomFileMetaForWriter(dicomFile.meta);

  const originalSummary = readNaturalizedStudySummary(dataset);
  const originalSeriesInstanceUid = readDicomStringValue(dataset.SeriesInstanceUID);
  dataset.PatientID = replacement.patientId;
  let replacementSopInstanceUid: string | null = null;
  if (uidPlan) {
    dataset.StudyInstanceUID = uidPlan.studyInstanceUid;
    dataset.SeriesInstanceUID = getOrCreateSeriesInstanceUid(originalSeriesInstanceUid, uidPlan);
    const newSopInstanceUid = createDicomUid();
    replacementSopInstanceUid = newSopInstanceUid;
    dataset.SOPInstanceUID = newSopInstanceUid;
    if (dataset._meta && typeof dataset._meta === "object") {
      updateStructuredMediaStorageSopInstanceUid(dataset._meta as Record<string, unknown>, newSopInstanceUid);
    }
  }

  const body = serializeDicomDatasetForRewrite(dataset);
  assertRewrittenDicomPixelIntegrity(raw, body);

  return {
    body,
    originalSummary,
    replacementSopInstanceUid,
  };
}

function isDicomRewriteParseError(error: unknown): boolean {
  return error instanceof HttpError &&
    error.statusCode === 400 &&
    error.message.startsWith("RISPro could not rewrite ");
}

function readOrthancStudySeriesCount(payload: unknown): number | null {
  if (!payload || typeof payload !== "object") {
    return null;
  }
  const series = (payload as Record<string, unknown>).Series;
  return Array.isArray(series) ? series.length : null;
}

function readOrthancStudyIsStable(payload: unknown): boolean | null {
  if (!payload || typeof payload !== "object") {
    return null;
  }
  const value = (payload as Record<string, unknown>).IsStable;
  return typeof value === "boolean" ? value : null;
}

function readOrthancStudyLastUpdate(payload: unknown): string {
  if (!payload || typeof payload !== "object") {
    return "";
  }
  return String((payload as Record<string, unknown>).LastUpdate || "").trim();
}

function formatOrthancStudyDiagnostics(preflight: OrthancStudyModifyPreflight, response?: OrthancFetchResult): string {
  const parts = [
    `sourceStudyId=${preflight.sourceStudyId}`,
    `isStable=${preflight.isStable ?? "unknown"}`,
    `lastUpdate=${preflight.lastUpdate || "unknown"}`,
    `series=${preflight.seriesCount ?? "unknown"}`,
    `instances=${preflight.instanceCount ?? "unknown"}`,
  ];

  if (preflight.orthancVersion) {
    parts.push(`orthancVersion=${preflight.orthancVersion}`);
  }
  if (preflight.databaseServerIdentifier) {
    parts.push(`databaseServerIdentifier=${preflight.databaseServerIdentifier}`);
  }
  if (response) {
    parts.push(`status=${response.status}`);
    parts.push(`body=${sanitizeOrthancResponseSnippet(response.text)}`);
    parts.push(`shape=${describeOrthancPayloadShape(response.json)}`);
  }

  return parts.join(", ");
}

async function readParentStudyIdForInstance(instanceId: string): Promise<string> {
  const response = await orthancFetch(`/instances/${encodeURIComponent(instanceId)}`, { method: "GET" });
  if (!response.ok || !response.json || typeof response.json !== "object") {
    throw new HttpError(502, `Unable to resolve Orthanc instance parent study (status=${response.status}).`);
  }

  const parsed = parseOrthancUploadResponse(response.json);
  const parentStudyId = parsed.parentStudyIds[0];
  if (!parentStudyId) {
    throw new HttpError(502, `Orthanc instance response did not include parent study ID (status=${response.status}, shape=${describeOrthancPayloadShape(response.json)}).`);
  }
  return parentStudyId;
}

function readStudyInstanceCountFromPayload(payload: unknown): number | null {
  if (!payload || typeof payload !== "object") {
    return null;
  }

  const record = payload as Record<string, unknown>;
  const directCandidates = [
    record.CountInstances,
    record.InstancesCount,
    record.Count,
    record.Instances,
  ];
  for (const candidate of directCandidates) {
    if (Array.isArray(candidate)) return candidate.length;
    const count = Number(candidate);
    if (Number.isInteger(count) && count >= 0) return count;
  }

  const statistics = record.Statistics && typeof record.Statistics === "object"
    ? record.Statistics as Record<string, unknown>
    : null;
  if (statistics) {
    return readStudyInstanceCountFromPayload(statistics);
  }

  return null;
}

async function readStudyInstanceCountBeforeModify(sourceStudyId: string, studyPayload?: unknown): Promise<number | null> {
  const statisticsResponse = await fetchOrthancForRemap(`/studies/${encodeURIComponent(sourceStudyId)}/statistics`, { method: "GET" });
  if (statisticsResponse.ok) {
    const count = readStudyInstanceCountFromPayload(statisticsResponse.json);
    if (count != null) return count;
  }

  return readStudyInstanceCountFromPayload(studyPayload);
}

function readOrthancPatientStudyIds(payload: unknown): string[] {
  if (!payload || typeof payload !== "object") {
    return [];
  }
  const studies = (payload as Record<string, unknown>).Studies;
  if (!Array.isArray(studies)) {
    return [];
  }

  return studies
    .map((item) => String(item || "").trim())
    .filter((item) => !!item);
}

async function readPatientStudyIds(patientId: string): Promise<string[]> {
  if (!patientId) {
    return [];
  }
  const response = await fetchOrthancForRemap(`/patients/${encodeURIComponent(patientId)}`, { method: "GET" });
  if (!response.ok) {
    return [];
  }
  return readOrthancPatientStudyIds(response.json);
}

function readOrthancJobs(payload: unknown): Array<Record<string, unknown>> {
  if (Array.isArray(payload)) {
    return payload.filter((item) => !!item && typeof item === "object") as Array<Record<string, unknown>>;
  }
  if (payload && typeof payload === "object") {
    const jobs = (payload as Record<string, unknown>).Jobs;
    if (Array.isArray(jobs)) {
      return jobs.filter((item) => !!item && typeof item === "object") as Array<Record<string, unknown>>;
    }
  }
  return [];
}

function findStringLike(value: unknown, needle: string): boolean {
  const cleanNeedle = String(needle || "").trim();
  if (!cleanNeedle) return false;
  const seen = new Set<unknown>();

  function visit(entry: unknown): boolean {
    if (entry == null || seen.has(entry)) return false;
    if (typeof entry === "string") {
      return entry.includes(cleanNeedle);
    }
    if (typeof entry !== "object") {
      return String(entry).includes(cleanNeedle);
    }

    seen.add(entry);
    if (Array.isArray(entry)) {
      for (const item of entry) {
        if (visit(item)) return true;
      }
      return false;
    }

    for (const value of Object.values(entry as Record<string, unknown>)) {
      if (visit(value)) return true;
    }
    return false;
  }

  return visit(value);
}

async function verifyModifiedStudyAfterTimeout(
  preflight: OrthancStudyModifyPreflight,
  replacement: OrthancPatientSummary,
  options: { requireExactModifiedFromProvenance?: boolean } = {},
): Promise<string | null> {
  if (!preflight.parentPatientId) {
    return null;
  }

  const afterStudyIds = await readPatientStudyIds(preflight.parentPatientId);
  const beforeSet = new Set(preflight.patientStudyIds);
  const candidates = afterStudyIds.filter((studyId) => !beforeSet.has(studyId) && studyId !== preflight.sourceStudyId);

  const exactProvenanceCandidates: string[] = [];
  for (const candidateId of candidates) {
    try {
      const summary = await readStudySummary(candidateId);
      if (hasExpectedRemappedPatientId(summary, replacement.patientId)) {
        if (!options.requireExactModifiedFromProvenance) return candidateId;
        const provenance = await readOrthancModifiedFromStudyId(candidateId);
        if (provenance.available && provenance.sourceStudyId === preflight.sourceStudyId) {
          exactProvenanceCandidates.push(candidateId);
        }
      }
    } catch {
      continue;
    }
  }

  if (exactProvenanceCandidates.length > 1) {
    throw new HttpError(409, "Multiple exact Orthanc recovery children were found after an ambiguous modify.", {
      code: "DICOM_REMAP_ORTHANC_RECOVERY_MULTIPLE_MODIFIED_CHILDREN",
      actualCount: exactProvenanceCandidates.length,
    });
  }
  if (exactProvenanceCandidates.length === 1) return exactProvenanceCandidates[0]!;

  return null;
}

async function verifySendCompletionAfterTimeout(studyId: string, modalityKey: string): Promise<unknown | null> {
  const probes: Array<{ path: string; options?: { method: string; timeoutSeconds: number } }> = [
    { path: "/jobs?expand", options: { method: "GET", timeoutSeconds: REMAP_ORTHANC_OPERATION_TIMEOUT_SECONDS } },
    { path: "/jobs", options: { method: "GET", timeoutSeconds: REMAP_ORTHANC_OPERATION_TIMEOUT_SECONDS } },
  ];

  for (const probe of probes) {
    const response = await fetchOrthancForRemap(probe.path, probe.options);
    if (!response.ok) {
      continue;
    }

    const jobs = readOrthancJobs(response.json);
    for (const job of jobs) {
      const state = String(job.State || job.Status || "").toLowerCase();
      if (!["success", "succeeded", "done"].includes(state)) {
        continue;
      }
      if (findStringLike(job, studyId) && findStringLike(job, modalityKey)) {
        return {
          verifiedAfterTimeout: true,
          source: probe.path,
          state,
          studyId,
          modalityKey,
        };
      }
    }
  }

  return null;
}

async function readOrthancSystemDiagnostics(): Promise<Pick<OrthancStudyModifyPreflight, "orthancVersion" | "databaseServerIdentifier">> {
  const response = await fetchOrthancForRemap("/system", { method: "GET" });
  if (!response.ok || !response.json || typeof response.json !== "object") {
    return {};
  }

  const record = response.json as Record<string, unknown>;
  return {
    orthancVersion: String(record.Version || "").trim() || undefined,
    databaseServerIdentifier: String(record.DatabaseServerIdentifier || "").trim() || undefined,
  };
}

async function resolveStudyIdFromOrthancUploadResponse(
  uploadResponse: OrthancFetchResult,
  parentStudyReader: (instanceId: string) => Promise<string> = readParentStudyIdForInstance
): Promise<string> {
  const parsed = parseOrthancUploadResponse(uploadResponse.json);
  const explicitStudyId = parsed.parentStudyIds[0];
  if (explicitStudyId) {
    return explicitStudyId;
  }

  const instanceId = parsed.instanceIds[0];
  if (instanceId) {
    return parentStudyReader(instanceId);
  }

  throw new HttpError(
    502,
    `Orthanc upload response did not include a resolvable study or instance ID (status=${uploadResponse.status}, shape=${describeOrthancPayloadShape(uploadResponse.json)}).`
  );
}

function assertJobStatus(current: DicomRemapJobStatus, expected: DicomRemapJobStatus, message: string): void {
  if (current !== expected) {
    throw new HttpError(409, message);
  }
}

async function orthancFetch(
  path: string,
  options: {
    method?: string;
    body?: unknown;
    timeoutSeconds?: number;
    contentType?: string;
  } = {}
): Promise<OrthancFetchResult> {
  const settings = await resolveOrthancSettings();
  const baseUrl = normalizeOptionalText(settings.baseUrl);
  if (!baseUrl) {
    throw new HttpError(500, "Orthanc base URL is not configured.");
  }

  const timeoutMs = Math.max(1, options.timeoutSeconds || settings.timeoutSeconds || 10) * 1000;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const headers: Record<string, string> = {
      Accept: "application/json",
    };

    if (settings.username) {
      const basic = Buffer.from(`${settings.username}:${settings.password}`).toString("base64");
      headers.Authorization = `Basic ${basic}`;
    }

    if (options.contentType) {
      headers["Content-Type"] = options.contentType;
    } else if (options.body !== undefined) {
      headers["Content-Type"] = "application/json";
    }

    const requestInit: RequestInit & { dispatcher?: unknown; duplex?: "half" } = {
      method: options.method || "GET",
      headers,
      signal: controller.signal,
    };

    if (options.body !== undefined) {
      requestInit.body = typeof options.body === "string"
        ? options.body
        : Buffer.isBuffer(options.body)
          ? new Uint8Array(options.body)
          : options.body instanceof Readable
            ? options.body as unknown as BodyInit
          : JSON.stringify(options.body);
      if (options.body instanceof Readable) {
        requestInit.duplex = "half";
      }
    }

    const response = await fetch(joinUrl(baseUrl, path), requestInit);
    const text = await response.text();
    let json: unknown = null;
    try {
      json = text ? JSON.parse(text) : null;
    } catch {
      json = null;
    }

    return {
      status: response.status,
      ok: response.ok,
      text,
      json,
    };
  } catch (error) {
    if ((error as Error).name === "AbortError") {
      throw new HttpError(504, "Orthanc request timed out.", { code: "ORTHANC_TIMEOUT" });
    }
    const networkCode = String((error as { cause?: { code?: unknown }; code?: unknown }).cause?.code || (error as { code?: unknown }).code || "").toUpperCase();
    const immediate = ["ECONNREFUSED", "ENOTFOUND", "EAI_AGAIN"].includes(networkCode);
    throw new HttpError(502, "Orthanc request failed.", {
      code: immediate ? "ORTHANC_INFRASTRUCTURE_UNAVAILABLE" : "ORTHANC_NETWORK_TRANSIENT",
      ...(networkCode ? { networkCode } : {}),
    });
  } finally {
    clearTimeout(timeout);
  }
}

fetchOrthancForRemap = orthancFetch;

async function readSingleResumableDicomRemapDraft(userId: UserId): Promise<DicomRemapJobRow | null> {
  const { rows } = await queryDicomRemapDb<DicomRemapJobRow>(
    `
      select *
      from dicom_remap_jobs
      where created_by_user_id = $1
        and status = 'awaiting_confirmation'
        and processing_stage = 'awaiting_confirmation'
        and staged_manifest_version = $2
        and staged_storage_key is not null
      order by created_at desc
      limit 2
    `,
    [userId, DICOM_REMAP_SELECTED_STUDY_MANIFEST_VERSION]
  );
  return rows.length === 1 ? rows[0]! : null;
}

async function readOrthancStudyExists(studyId: string): Promise<boolean> {
  const response = await fetchOrthancForRemap(`/studies/${encodeURIComponent(studyId)}`, { method: "GET" });
  if (response.ok) {
    return true;
  }
  if (response.status === 404) {
    return false;
  }
  throw new HttpError(
    502,
    `Unable to verify Orthanc source study before DICOM remap (status=${response.status}, body=${sanitizeOrthancResponseSnippet(response.text)}, shape=${describeOrthancPayloadShape(response.json)}).`
  );
}

function summarizeOrthancStudyDeletes(results: OrthancStudyDeleteResult[]): OrthancResetSummary {
  return {
    studiesAttempted: results.length,
    studiesDeleted: results.filter((result) => result.status === "deleted").length,
    studiesAlreadyMissing: results.filter((result) => result.status === "already_missing").length,
    failures: results.filter((result) => result.status === "failed"),
  };
}

async function deleteOrthancStudyIfExists(studyId: string): Promise<OrthancStudyDeleteResult> {
  const cleanStudyId = String(studyId || "").trim();
  if (!cleanStudyId) {
    return { studyId: cleanStudyId, status: "already_missing", message: "empty_study_id" };
  }

  try {
    const response = await fetchOrthancForRemap(`/studies/${encodeURIComponent(cleanStudyId)}`, {
      method: "DELETE",
      timeoutSeconds: REMAP_ORTHANC_OPERATION_TIMEOUT_SECONDS,
    });

    if (response.ok) {
      return { studyId: cleanStudyId, status: "deleted", orthancStatus: response.status };
    }
    if (response.status === 404) {
      return { studyId: cleanStudyId, status: "already_missing", orthancStatus: response.status };
    }
    return {
      studyId: cleanStudyId,
      status: "failed",
      orthancStatus: response.status,
      message: sanitizeOrthancResponseSnippet(response.text),
    };
  } catch (error) {
    return {
      studyId: cleanStudyId,
      status: "failed",
      message: error instanceof Error ? error.message : "Orthanc study delete failed.",
    };
  }
}

function uniqueStudyIdsFromJobs(jobs: DicomRemapJobRow[]): string[] {
  const ids = new Set<string>();
  for (const job of jobs) {
    for (const studyId of [job.source_orthanc_study_id, job.modified_orthanc_study_id]) {
      const clean = String(studyId || "").trim();
      if (clean) ids.add(clean);
    }
  }
  return Array.from(ids);
}

function readStringTag(tags: Record<string, unknown>, key: string): string {
  return String(tags[key] || "").trim();
}

async function readOrthancStudyMatchMetadata(studyId: string): Promise<OrthancStudyMatchMetadata | null> {
  const studyResponse = await fetchOrthancForRemap(`/studies/${encodeURIComponent(studyId)}`, { method: "GET" });
  if (!studyResponse.ok || !studyResponse.json || typeof studyResponse.json !== "object") {
    return null;
  }

  const studyPayload = studyResponse.json as Record<string, unknown>;
  const mainTags = (studyPayload.MainDicomTags && typeof studyPayload.MainDicomTags === "object")
    ? studyPayload.MainDicomTags as Record<string, unknown>
    : {};
  const patientMainTags = (studyPayload.PatientMainDicomTags && typeof studyPayload.PatientMainDicomTags === "object")
    ? studyPayload.PatientMainDicomTags as Record<string, unknown>
    : {};
  const seriesIds = Array.isArray(studyPayload.Series)
    ? studyPayload.Series.map((value) => String(value || "").trim()).filter((value) => !!value)
    : [];

  let modality = "";
  if (seriesIds.length > 0) {
    const seriesResponse = await fetchOrthancForRemap(`/series/${encodeURIComponent(seriesIds[0])}`, { method: "GET" });
    if (seriesResponse.ok && seriesResponse.json && typeof seriesResponse.json === "object") {
      const seriesPayload = seriesResponse.json as Record<string, unknown>;
      const seriesMainTags = (seriesPayload.MainDicomTags && typeof seriesPayload.MainDicomTags === "object")
        ? seriesPayload.MainDicomTags as Record<string, unknown>
        : {};
      modality = readStringTag(seriesMainTags, "Modality");
    }
  }

  return {
    studyId,
    accessionNumber: readStringTag(mainTags, "AccessionNumber"),
    studyDate: readStringTag(mainTags, "StudyDate"),
    modality,
    patientId: readStringTag(patientMainTags, "PatientID"),
  };
}

async function findMissingModifiedStudyIdsForJob(job: DicomRemapJobRow, alreadyKnownStudyIds: Set<string>): Promise<string[]> {
  if (job.modified_orthanc_study_id || !job.source_orthanc_study_id || !job.replacement_patient_id) {
    return [];
  }

  const sourceStudyId = String(job.source_orthanc_study_id || "").trim();
  if (!sourceStudyId) {
    return [];
  }

  const sourceMetadata = await readOrthancStudyMatchMetadata(sourceStudyId);
  if (!sourceMetadata || !sourceMetadata.accessionNumber || !sourceMetadata.studyDate) {
    return [];
  }

  const studiesResponse = await fetchOrthancForRemap("/studies", { method: "GET" });
  if (!studiesResponse.ok || !Array.isArray(studiesResponse.json)) {
    return [];
  }

  const discovered: string[] = [];
  const replacementPatientId = String(job.replacement_patient_id || "").trim();
  for (const candidateRawId of studiesResponse.json) {
    const candidateId = String(candidateRawId || "").trim();
    if (!candidateId || candidateId === sourceStudyId || alreadyKnownStudyIds.has(candidateId)) {
      continue;
    }

    const candidateMetadata = await readOrthancStudyMatchMetadata(candidateId);
    if (!candidateMetadata) {
      continue;
    }

    if (candidateMetadata.accessionNumber !== sourceMetadata.accessionNumber) {
      continue;
    }
    if (candidateMetadata.studyDate !== sourceMetadata.studyDate) {
      continue;
    }
    if (sourceMetadata.modality && candidateMetadata.modality && candidateMetadata.modality !== sourceMetadata.modality) {
      continue;
    }
    if (candidateMetadata.patientId !== replacementPatientId) {
      continue;
    }

    discovered.push(candidateId);
    alreadyKnownStudyIds.add(candidateId);
  }

  return discovered;
}

async function markJobFailed(jobId: number, message: string): Promise<void> {
  await queryDicomRemapDb(
    `
      update dicom_remap_jobs
      set status = 'failed',
          error_message = $2,
          updated_at = now()
      where id = $1
    `,
    [jobId, message]
  );
}

async function markStaleActiveJobFailedIfSourceMissing(job: DicomRemapJobRow): Promise<boolean> {
  if (!job.source_orthanc_study_id) {
    return false;
  }
  const exists = await readOrthancStudyExists(job.source_orthanc_study_id);
  if (exists) {
    return false;
  }
  await markJobFailed(job.id, "Source study no longer exists in Orthanc. Please start a new upload.");
  return true;
}

async function assertJobSourceStudyExists(job: DicomRemapJobRow): Promise<void> {
  if (!job.source_orthanc_study_id) {
    throw new HttpError(409, "Uploaded Orthanc study ID is missing for this job.");
  }
  if (await readOrthancStudyExists(job.source_orthanc_study_id)) {
    return;
  }
  const message = "Source study no longer exists in Orthanc. Please start a new upload.";
  await markJobFailed(job.id, message);
  throw new HttpError(409, message, { jobId: job.id });
}

async function readStudySummary(studyId: string): Promise<OrthancStudySummary> {
  const response = await fetchOrthancForRemap(`/studies/${encodeURIComponent(studyId)}`, { method: "GET" });
  if (!response.ok || !response.json || typeof response.json !== "object") {
    throw new HttpError(502, `Unable to read Orthanc study summary (status=${response.status}).`);
  }
  const payload = response.json as Record<string, unknown>;
  const mainTags = payload.MainDicomTags && typeof payload.MainDicomTags === "object"
    ? payload.MainDicomTags as Record<string, unknown>
    : {};
  const patientMainTags = payload.PatientMainDicomTags && typeof payload.PatientMainDicomTags === "object"
    ? payload.PatientMainDicomTags as Record<string, unknown>
    : {};
  const mergedTags = { ...patientMainTags, ...mainTags };

  return {
    studyInstanceUid: extractTagCandidate(mergedTags, ["StudyInstanceUID"]),
    patientId: extractTagCandidate(mergedTags, ["PatientID"]),
    patientName: extractTagCandidate(mergedTags, ["PatientName"]),
    patientSex: normalizePatientSex(extractTagCandidate(mergedTags, ["PatientSex"])),
    patientBirthDate: normalizeDicomBirthDate(extractTagCandidate(mergedTags, ["PatientBirthDate"])),
  };
}

async function readOrthancStudyBeforeModify(sourceStudyId: string): Promise<OrthancStudyModifyPreflight> {
  const studyResponse = await fetchOrthancForRemap(`/studies/${encodeURIComponent(sourceStudyId)}`, { method: "GET" });
  const instanceCount = await readStudyInstanceCountBeforeModify(sourceStudyId, studyResponse.json);
  const system = await readOrthancSystemDiagnostics();

  if (studyResponse.ok && studyResponse.json && typeof studyResponse.json === "object") {
    const payload = studyResponse.json as Record<string, unknown>;
    const parentPatientId = String(payload.ParentPatient || "").trim();
    const patientStudyIds = await readPatientStudyIds(parentPatientId);
    return {
      sourceStudyId,
      studyResponse,
      instanceCount,
      isStable: readOrthancStudyIsStable(studyResponse.json),
      lastUpdate: readOrthancStudyLastUpdate(studyResponse.json),
      seriesCount: readOrthancStudySeriesCount(studyResponse.json),
      parentPatientId,
      patientStudyIds,
      ...system,
    };
  }

  const maybeInstanceResponse = await fetchOrthancForRemap(`/instances/${encodeURIComponent(sourceStudyId)}`, { method: "GET" });
  if (maybeInstanceResponse.ok) {
    throw new HttpError(
      502,
      `DICOM remap source ID is an Orthanc instance ID, not a study ID (sourceStudyId=${sourceStudyId}, studyStatus=${studyResponse.status}, instanceStatus=${maybeInstanceResponse.status}).`
    );
  }

  throw new HttpError(
    502,
    `DICOM remap source study no longer exists in Orthanc (${formatOrthancStudyDiagnostics({
      sourceStudyId,
      studyResponse,
      instanceCount,
      isStable: readOrthancStudyIsStable(studyResponse.json),
      lastUpdate: readOrthancStudyLastUpdate(studyResponse.json),
      seriesCount: readOrthancStudySeriesCount(studyResponse.json),
      parentPatientId: "",
      patientStudyIds: [],
      ...system,
    }, studyResponse)}).`
  );
}

async function waitForOrthancStudyStable(sourceStudyId: string, timeoutMs = 60_000): Promise<OrthancStudyModifyPreflight> {
  const startedAt = Date.now();
  let lastPreflight: OrthancStudyModifyPreflight | null = null;

  while (Date.now() - startedAt <= timeoutMs) {
    const preflight = await readOrthancStudyBeforeModify(sourceStudyId);
    lastPreflight = preflight;
    if (preflight.isStable !== false) {
      return preflight;
    }
    await sleepForDicomRemap(1_000);
  }

  throw new HttpError(
    502,
    `Timed out waiting for Orthanc study to become stable before DICOM remap modify (${lastPreflight
      ? formatOrthancStudyDiagnostics(lastPreflight)
      : `sourceStudyId=${sourceStudyId}`}).`
  );
}

function isOrthancStudyStabilityTimeout(error: unknown): boolean {
  return error instanceof HttpError
    && error.statusCode === 502
    && /Timed out waiting for Orthanc study to become stable before DICOM remap modify/i.test(error.message);
}

function buildOrthancModifyTechnicalDetails(
  preflight: OrthancStudyModifyPreflight,
  response: OrthancFetchResult | null,
  extra: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    sourceStudyId: preflight.sourceStudyId,
    isStable: preflight.isStable,
    lastUpdate: preflight.lastUpdate,
    seriesCount: preflight.seriesCount,
    instanceCount: preflight.instanceCount,
    orthancVersion: preflight.orthancVersion,
    databaseServerIdentifier: preflight.databaseServerIdentifier,
    status: response?.status ?? null,
    body: response ? sanitizeOrthancResponseSnippet(response.text) : null,
    shape: response ? describeOrthancPayloadShape(response.json) : null,
    ...extra,
  };
}

async function isOrthancBulkModifyRouteAvailable(): Promise<boolean> {
  if (orthancBulkModifyAvailableForTests != null) {
    return orthancBulkModifyAvailableForTests;
  }

  try {
    const response = await fetchOrthancForRemap("/tools/bulk-modify", {
      method: "OPTIONS",
      timeoutSeconds: REMAP_ORTHANC_OPERATION_TIMEOUT_SECONDS,
    });
    return response.status !== 404;
  } catch {
    return false;
  }
}

function formatReplacementFromPatient(patient: Awaited<ReturnType<typeof getPatientById>>): OrthancPatientSummary {
  const patientId = String(
    patient.identifier_value ||
    patient.national_id ||
    patient.mrn ||
    patient.id
  ).trim();
  const patientName = normalizeDicomPatientName(
    String(patient.english_full_name || patient.arabic_full_name || "").trim()
  );
  const patientSex = normalizePatientSex(String(patient.sex || ""));
  const patientBirthDate = normalizeDicomBirthDate(String(patient.estimated_date_of_birth || ""));

  return {
    patientId: normalizeDicomPatientIdForReplace(patientId),
    patientName,
    patientSex,
    patientBirthDate,
  };
}

async function tryBulkModifiedStudyCopy(
  sourceStudyId: string,
  modifyPayload: {
    Replace: {
      PatientID: string;
    };
    KeepSource: boolean;
    Force: boolean;
  },
  preflight: OrthancStudyModifyPreflight,
  studyModifyResponse: OrthancFetchResult
): Promise<string> {
  const bulkPayload = {
    ...modifyPayload,
    Level: "Study",
    Resources: [sourceStudyId],
  };
  const bulkResponse = await fetchOrthancForRemap("/tools/bulk-modify", {
    method: "POST",
    body: bulkPayload,
  });

  if (bulkResponse.ok) {
    const modifiedStudyId = parseOrthancModifiedStudyId(bulkResponse.json);
    if (modifiedStudyId) {
      return modifiedStudyId;
    }

    throw new HttpError(
      502,
      `Orthanc bulk modify response did not include modified study ID (${formatOrthancStudyDiagnostics(preflight, bulkResponse)}).`
    );
  }

  console.error("Orthanc bulk modify fallback failed.", {
    sourceStudyId,
    studyPreflightStatus: preflight.studyResponse.status,
    instanceCount: preflight.instanceCount,
    isStable: preflight.isStable,
    lastUpdate: preflight.lastUpdate,
    seriesCount: preflight.seriesCount,
    orthancVersion: preflight.orthancVersion,
    databaseServerIdentifier: preflight.databaseServerIdentifier,
    studyModifyStatus: studyModifyResponse.status,
    studyModifyResponseBody: sanitizeOrthancResponseSnippet(studyModifyResponse.text),
    studyModifyResponseShape: describeOrthancPayloadShape(studyModifyResponse.json),
    bulkModifyStatus: bulkResponse.status,
    bulkModifyResponseBody: sanitizeOrthancResponseSnippet(bulkResponse.text),
    bulkModifyResponseShape: describeOrthancPayloadShape(bulkResponse.json),
    bulkModifyPayloadShape: describeOrthancPayloadShape(bulkPayload),
  });

  throw new HttpError(
    502,
    "Orthanc could not modify this uploaded study. Please reset current upload and retry.",
    buildOrthancModifyTechnicalDetails(preflight, studyModifyResponse, {
      bulkModifyStatus: bulkResponse.status,
      bulkModifyBody: sanitizeOrthancResponseSnippet(bulkResponse.text),
      bulkModifyShape: describeOrthancPayloadShape(bulkResponse.json),
      bulkModifyRouteAvailable: true,
    })
  );
}

async function createModifiedStudyCopy(
  sourceStudyId: string,
  replacement: OrthancPatientSummary,
  options: { stabilityTimeoutMs?: number; requireExactModifiedFromProvenance?: boolean } = {},
): Promise<string> {
  const validatedPatientId = normalizeDicomPatientIdForReplace(replacement.patientId);
  let preflight: OrthancStudyModifyPreflight;
  let stabilityTimedOut = false;
  try {
    preflight = await waitForOrthancStudyStable(sourceStudyId, options.stabilityTimeoutMs);
  } catch (error) {
    if (!isOrthancStudyStabilityTimeout(error)) {
      throw error;
    }
    preflight = await readOrthancStudyBeforeModify(sourceStudyId);
    stabilityTimedOut = true;
    console.warn("Orthanc study stability wait timed out; attempting modify anyway.", {
      sourceStudyId,
      instanceCount: preflight.instanceCount,
      isStable: preflight.isStable,
      lastUpdate: preflight.lastUpdate,
      seriesCount: preflight.seriesCount,
      orthancVersion: preflight.orthancVersion,
      databaseServerIdentifier: preflight.databaseServerIdentifier,
    });
  }
  const modifyPayload = {
    Replace: {
      PatientID: validatedPatientId,
    },
    KeepSource: true,
    Force: true,
  };
  if ((preflight.instanceCount ?? 0) <= 0) {
    throw new HttpError(
      409,
      "Uploaded Orthanc study has no instances. Please reset and upload again.",
      buildOrthancModifyTechnicalDetails(preflight, null)
    );
  }
  const backoffMs = [500, 1_000, 2_000, 4_000];
  let response: OrthancFetchResult | null = null;

  for (let attempt = 0; attempt <= backoffMs.length; attempt += 1) {
    try {
      response = await fetchOrthancForRemap(`/studies/${encodeURIComponent(sourceStudyId)}/modify`, {
        method: "POST",
        body: modifyPayload,
        timeoutSeconds: REMAP_ORTHANC_OPERATION_TIMEOUT_SECONDS,
      });
    } catch (error) {
      if (!isOrthancTimeoutError(error)) {
        throw error;
      }
      const verifiedStudyId = await verifyModifiedStudyAfterTimeout(preflight, { ...replacement, patientId: validatedPatientId }, options);
      if (verifiedStudyId) {
        return verifiedStudyId;
      }
      if (options.requireExactModifiedFromProvenance) {
        throw new HttpError(502, "Orthanc study modify timed out and exact recovery provenance could not be confirmed.", {
          code: "DICOM_REMAP_ORTHANC_RECOVERY_PROVENANCE_UNVERIFIED",
        });
      }
      throw new HttpError(
        502,
        `Orthanc study modify timed out and verification could not confirm modified study creation (${formatOrthancStudyDiagnostics(preflight)}).`
      );
    }

    if (response.ok || response.status !== 404 || attempt === backoffMs.length) {
      break;
    }

    const retryPreflight = await readOrthancStudyBeforeModify(sourceStudyId);
    if (!retryPreflight.studyResponse.ok) {
      break;
    }
    preflight = retryPreflight;
    await sleepForDicomRemap(backoffMs[attempt] || 0);
  }

  if (!response) {
    throw new HttpError(502, `Orthanc study modify did not return a response (${formatOrthancStudyDiagnostics(preflight)}).`);
  }

  if (!response.ok) {
    const responseSnippet = sanitizeOrthancResponseSnippet(response.text);
    const responseShape = describeOrthancPayloadShape(response.json);
    const requestPayloadShape = describeOrthancPayloadShape(modifyPayload);
    console.error("Orthanc study modify failed.", {
      sourceStudyId,
      studyPreflightStatus: preflight.studyResponse.status,
      instanceCount: preflight.instanceCount,
      isStable: preflight.isStable,
      lastUpdate: preflight.lastUpdate,
      seriesCount: preflight.seriesCount,
      orthancVersion: preflight.orthancVersion,
      databaseServerIdentifier: preflight.databaseServerIdentifier,
      modifyStatus: response.status,
      modifyResponseBody: responseSnippet,
      modifyResponseShape: responseShape,
      modifyPayloadShape: requestPayloadShape,
      stabilityTimedOut,
    });

    if (response.status === 404) {
      const sourceStillExists = await readOrthancStudyExists(sourceStudyId);
      if (!sourceStillExists) {
        throw new HttpError(
          409,
          "Source study no longer exists in Orthanc. Please reset and upload again.",
          buildOrthancModifyTechnicalDetails(preflight, response, {
            sourceStudyStillExists: false,
            bulkModifyRouteAvailable: false,
          })
        );
      }

      const bulkModifyRouteAvailable = await isOrthancBulkModifyRouteAvailable();
      if (bulkModifyRouteAvailable) {
        return tryBulkModifiedStudyCopy(sourceStudyId, modifyPayload, preflight, response);
      }

      throw new HttpError(
        409,
        "Orthanc could not modify this uploaded study. Please reset current upload and retry.",
        buildOrthancModifyTechnicalDetails(preflight, response, {
          sourceStudyStillExists: true,
          bulkModifyRouteAvailable: false,
        })
      );
    }

    throw new HttpError(
      502,
      "Orthanc could not modify this uploaded study. Please reset current upload and retry.",
      buildOrthancModifyTechnicalDetails(preflight, response, {
        bulkModifyRouteAvailable: false,
      })
    );
  }

  const modifiedStudyId = parseOrthancResourceId(response.json);
  if (!modifiedStudyId) {
    throw new HttpError(
      502,
      `Orthanc modify response did not include modified study ID (sourceStudyId=${sourceStudyId}, status=${response.status}, body=${sanitizeOrthancResponseSnippet(response.text)}, shape=${describeOrthancPayloadShape(response.json)}).`
    );
  }
  return modifiedStudyId;
}

async function enqueueOrthancAsyncStore(studyId: string, modalityKey: string): Promise<{ orthancJobId: string; response: OrthancFetchResult }> {
  const response = await fetchOrthancForRemap(`/modalities/${encodeURIComponent(modalityKey)}/store`, {
    method: "POST",
    body: { Resources: [studyId], Synchronous: false },
    timeoutSeconds: REMAP_ORTHANC_OPERATION_TIMEOUT_SECONDS,
  });
  if (!response.ok && response.status !== 202) {
    const unsupported = response.status === 404 || response.status === 405 || response.status === 501;
    throw new HttpError(
      502,
      unsupported
        ? "Configured Orthanc does not support the required asynchronous C-STORE contract."
        : "Orthanc rejected asynchronous PACS send enqueue.",
      { code: "ORTHANC_SEND_ENQUEUE_FAILED", orthancStatus: response.status, modalityKey, responseShape: describeOrthancPayloadShape(response.json) }
    );
  }
  const orthancJobId = parseOrthancSendJobId(response.json) || parseOrthancSendJobId({ Path: response.text });
  if (!orthancJobId) {
    throw new HttpError(502, "Orthanc accepted PACS send but did not return a resolvable job ID.", {
      code: "ORTHANC_SEND_JOB_ID_MISSING",
      modalityKey,
      responseShape: describeOrthancPayloadShape(response.json),
    });
  }
  return { orthancJobId, response };
}

function isAmbiguousOrthancEnqueueError(error: unknown): boolean {
  if (!(error instanceof HttpError)) return true;
  const code = String((error.details as { code?: unknown } | null)?.code || "");
  // A response from Orthanc is definitive. A transport exception from orthancFetch is not.
  return !code || code === "ORTHANC_SEND_JOB_ID_MISSING" || code === "ORTHANC_SEND_ENQUEUE_PERSIST_FAILED";
}

function isDestinationVerificationRequired(code: string | null | undefined): boolean {
  return [
    "ORTHANC_SEND_ENQUEUE_AMBIGUOUS",
    "ORTHANC_SEND_MONITOR_UNREACHABLE",
    "ORTHANC_SEND_MONITOR_NETWORK_FAILURE",
    "ORTHANC_SEND_STATE_UNKNOWN",
    "ORTHANC_SEND_JOB_NOT_FOUND",
  ].includes(String(code || ""));
}

function resolveSendStudyIdForJob(job: DicomRemapJobRow): string {
  return String(job.modified_orthanc_study_id || job.source_orthanc_study_id || "").trim();
}

function hasCurrentDicomIntegrityVerification(job: DicomRemapJobRow): boolean {
  return Number(job.dicom_integrity_version) === DICOM_REMAP_INTEGRITY_VERSION && Boolean(job.dicom_integrity_verified_at);
}

function hasUnexpiredOrthancRecovery(job: DicomRemapJobRow): boolean {
  if (!job.staged_storage_key || job.staging_cleanup_completed_at) return false;
  if (!["available", "failed", "processing"].includes(String(job.orthanc_recovery_status || ""))) return false;
  const expiresAt = Date.parse(String(job.orthanc_recovery_expires_at || ""));
  return Number.isFinite(expiresAt) && expiresAt > Date.now();
}

function normalizeOrthancModalityKey(value: unknown, fieldName = "destinationPacsKey"): string {
  const key = normalizeOptionalText(value);
  if (!key) {
    throw new HttpError(400, `${fieldName} is required.`);
  }
  if (key === "local") {
    throw new HttpError(400, "Local Orthanc index cannot be used as a send destination.");
  }
  if (!/^[A-Za-z0-9_.:-]{1,128}$/.test(key)) {
    throw new HttpError(400, `${fieldName} must be an Orthanc remote modality key.`);
  }
  return key;
}

async function sendExistingDicomRemapJobToDestination({
  job,
  currentUserId,
  auditActionType,
  auditMetadata = {},
}: {
  job: DicomRemapJobRow;
  currentUserId: UserId;
  auditActionType: string;
  auditMetadata?: Record<string, unknown>;
}): Promise<{ job: DicomRemapJobRow }> {
  const sendStudyId = resolveSendStudyIdForJob(job);
  if (!sendStudyId || !job.destination_pacs_key) {
    throw new HttpError(409, "Job does not have a remapped study or destination set.");
  }

  // A persisted Orthanc job is the durable idempotency boundary for repeated clicks.
  if (job.status === "sending" && job.orthanc_send_job_id) {
    return { job };
  }
  if (job.status === "sending") {
    throw new HttpError(409, "PACS send enqueue is still being recovered; do not retry automatically.", {
      code: "ORTHANC_SEND_ENQUEUE_AMBIGUOUS",
      status: job.status,
    });
  }
  if (!hasCurrentDicomIntegrityVerification(job)) {
    const recoveryAvailable = hasUnexpiredOrthancRecovery(job);
    throw new HttpError(409, recoveryAvailable
      ? "This remapped study predates the current DICOM integrity verification. Use Retry with Orthanc from the preserved source files."
      : "This remapped study is not verified by the current DICOM integrity gate. Re-upload the original study.", {
      code: recoveryAvailable ? "DICOM_REMAP_ORTHANC_RECOVERY_REQUIRED" : "DICOM_REMAP_REUPLOAD_REQUIRED",
      currentIntegrityVersion: DICOM_REMAP_INTEGRITY_VERSION,
      recoveryAvailable,
    });
  }

  const exists = await readOrthancStudyExists(sendStudyId);
  if (!exists) {
    throw new HttpError(409, "Remapped study no longer exists in Orthanc. Please upload again.");
  }

  const modalityKey = normalizeOrthancModalityKey(job.destination_pacs_key);

  const sendClaim = await queryDicomRemapDb<DicomRemapJobRow>(
    `
      update dicom_remap_jobs
      set status = 'sending',
          orthanc_send_job_id = null,
          send_started_at = now(),
          send_completed_at = null,
          send_last_checked_at = null,
          send_last_heartbeat_at = now(),
          updated_at = now()
      where id = $1
        and status = any($2::text[])
      returning *
    `,
    [job.id, ["remapped", "failed", "sent"]]
  );
  const sendingJob = sendClaim.rows[0] || null;
  if (!sendingJob) {
    const currentJob = await loadAccessibleDicomRemapJob(job.id);
    if (currentJob.status === "sending" && currentJob.orthanc_send_job_id) return { job: currentJob };
    throw new HttpError(409, "Job is not ready for PACS send.", { status: currentJob.status });
  }

  try {
    const enqueued = await enqueueOrthancAsyncStore(sendStudyId, modalityKey);
    const result = await queryDicomRemapDb<DicomRemapJobRow>(
      `
        update dicom_remap_jobs
        set orthanc_send_job_id = $2,
            send_attempt_count = coalesce(send_attempt_count, 0) + 1,
            error_message = null,
            send_error_code = null,
            send_error_details = null,
            updated_at = now()
        where id = $1 and status = 'sending' and orthanc_send_job_id is null
        returning *
      `,
      [job.id, enqueued.orthancJobId]
    );
    const finalJob = result.rows[0];
    if (!finalJob) {
      throw new HttpError(500, "PACS send was accepted but RISpro could not persist the Orthanc job ID. Do not retry automatically.", {
        code: "ORTHANC_SEND_ENQUEUE_PERSIST_FAILED",
      });
    }

    await logDicomRemapAuditEntry({
      entityType: "dicom_remap_job",
      entityId: finalJob.id,
      actionType: auditActionType,
      oldValues: { status: job.status },
      newValues: {
        status: finalJob.status,
        destinationPacsKey: finalJob.destination_pacs_key,
        orthancJobId: finalJob.orthanc_send_job_id,
        attemptNumber: finalJob.send_attempt_count,
        ...auditMetadata,
      },
      changedByUserId: currentUserId,
    });

    return { job: finalJob };
  } catch (error) {
    if (isAmbiguousOrthancEnqueueError(error)) {
      const message = "RISpro could not confirm whether Orthanc accepted the PACS transfer. Check the destination PACS before resending to avoid a duplicate study.";
      const details = error instanceof HttpError ? error.details : undefined;
      const result = await queryDicomRemapDb<DicomRemapJobRow>(
        `
          update dicom_remap_jobs
          set status = 'sending', error_message = $2, send_error_code = 'ORTHANC_SEND_ENQUEUE_AMBIGUOUS',
              send_error_details = $3::jsonb, send_last_checked_at = now(), updated_at = now()
          where id = $1 and status = 'sending' and orthanc_send_job_id is null
          returning *
        `,
        [job.id, message, JSON.stringify({ code: "ORTHANC_SEND_ENQUEUE_AMBIGUOUS", modalityKey, reason: error instanceof Error ? sanitizeOrthancSendDiagnosticText(error.message) : "transport_interrupted", details: details ? { shape: describeOrthancPayloadShape(details) } : null })]
      );
      const ambiguousJob = result.rows[0];
      if (!ambiguousJob) throw error;
      await logDicomRemapAuditEntry({
        entityType: "dicom_remap_job", entityId: ambiguousJob.id, actionType: "pacs_send_enqueue_ambiguous",
        oldValues: { status: sendingJob.status },
        newValues: { status: "sending", failureCode: "ORTHANC_SEND_ENQUEUE_AMBIGUOUS", attemptNumber: sendingJob.send_attempt_count },
        changedByUserId: currentUserId,
      });
      return { job: ambiguousJob };
    }
    const details = error instanceof HttpError ? error.details : undefined;
    const code = String((details as { code?: unknown } | undefined)?.code || "ORTHANC_SEND_ENQUEUE_FAILED");
    await queryDicomRemapDb<DicomRemapJobRow>(
      `
        update dicom_remap_jobs
        set status = 'failed',
            orthanc_send_job_id = $2,
            error_message = $3,
            send_error_code = $4,
            send_error_details = $5::jsonb,
            updated_at = now()
        where id = $1 and status = 'sending' and orthanc_send_job_id is null
      `,
      [job.id, job.orthanc_send_job_id, job.error_message, job.send_error_code, JSON.stringify(job.send_error_details)]
    );

    await logDicomRemapAuditEntry({
      entityType: "dicom_remap_job",
      entityId: job.id,
      actionType: "pacs_send_failed",
      oldValues: { status: sendingJob.status },
      newValues: { status: "failed", failureCode: code, attemptNumber: sendingJob.send_attempt_count },
      changedByUserId: currentUserId,
    });

    throw error;
  }
}

function sanitizeOrthancSendDiagnosticText(value: unknown): string {
  return sanitizeOrthancResponseSnippet(value, 500)
    .replace(/\b(patient(?:name|id)?|mrn|national[_ -]?id|accession(?:number)?)\s*[:=]\s*[^,;\n]+/gi, "$1=[redacted]");
}

function readOrthancJobText(record: Record<string, unknown>, keys: string[]): string | null {
  for (const key of keys) {
    const value = record[key];
    if (value == null) continue;
    const clean = sanitizeOrthancSendDiagnosticText(value);
    if (clean) return clean;
  }
  return null;
}

function sanitizeOrthancSendJobResult(payload: unknown, job: DicomRemapJobRow): Record<string, unknown> {
  const record = payload && typeof payload === "object" ? payload as Record<string, unknown> : {};
  return {
    orthancJobState: readOrthancJobText(record, ["State", "state", "Status", "status"]),
    orthancJobType: readOrthancJobText(record, ["Type", "type"]),
    orthancErrorCode: readOrthancJobText(record, ["ErrorCode", "errorCode", "Code", "code"]),
    orthancErrorDescription: readOrthancJobText(record, ["ErrorDescription", "errorDescription", "Error", "error", "Description", "description"]),
    dimseStatus: readOrthancJobText(record, ["DIMSEStatus", "DimseStatus", "dimseStatus", "DICOMStatus"]),
    destinationPacsKey: job.destination_pacs_key,
    attemptNumber: job.send_attempt_count,
    orthancJobId: job.orthanc_send_job_id,
  };
}

function classifyOrthancSendFailure(details: Record<string, unknown>): string {
  const dimseStatus = String(details.dimseStatus ?? "").trim().toLowerCase();
  const errorText = [details.orthancErrorCode, details.orthancErrorDescription]
    .map((value) => String(value ?? "").trim().toLowerCase())
    .filter(Boolean)
    .join(" ");
  if (dimseStatus || /association\s+(?:rejected|failed)|(?:c-?store|store)\s+(?:rejected|refused|failure)|dicom\s+status|0xa[0-9a-f]{3}/i.test(errorText)) return "PACS_DIMSE_REJECTED";
  if (/network|connect(?:ion)?|timeout|timed out|refused|unreachable|host down|no route/.test(errorText)) return "PACS_NETWORK_FAILURE";
  return "ORTHANC_SEND_JOB_FAILED";
}

async function cleanupSentDicomRemapStaging(job: DicomRemapJobRow): Promise<void> {
  if (!job.staged_storage_key || job.staging_cleanup_completed_at) return;
  await cleanupDicomRemapStagingStorage(job.staged_storage_key);
  const cleaned = await queryDicomRemapDb<DicomRemapJobRow>(
    `update dicom_remap_jobs set staging_cleanup_completed_at = now(), updated_at = now() where id = $1 and status = 'sent' and staging_cleanup_completed_at is null returning *`,
    [job.id]
  );
  if (cleaned.rows[0]) {
    await logDicomRemapAuditEntry({ entityType: "dicom_remap_job", entityId: job.id, actionType: "dicom_remap_staging_cleaned", oldValues: null, newValues: { sendStatus: "sent" }, changedByUserId: null });
  }
}

function orthancJobState(payload: unknown): string {
  if (!payload || typeof payload !== "object") return "";
  const record = payload as Record<string, unknown>;
  return String(record.State ?? record.state ?? record.Status ?? record.status ?? "").trim().toLowerCase();
}

export async function listDicomRemapSendMonitoringJobs(limit = 25): Promise<DicomRemapJobRow[]> {
  const { rows } = await queryDicomRemapDb<DicomRemapJobRow>(
    `select * from dicom_remap_jobs where status = 'sending' and orthanc_send_job_id is not null order by send_last_checked_at nulls first, send_started_at asc nulls first limit $1`,
    [Math.min(Math.max(limit, 1), 100)]
  );
  return rows;
}

export async function failStaleDicomRemapSendEnqueues(staleMinutes = 10): Promise<number> {
  const { rows } = await queryDicomRemapDb<DicomRemapJobRow>(
    `
      update dicom_remap_jobs
      set status = 'failed', send_completed_at = now(), send_error_code = 'ORTHANC_SEND_ENQUEUE_AMBIGUOUS',
          send_error_details = jsonb_build_object('code', 'ORTHANC_SEND_ENQUEUE_AMBIGUOUS'),
          error_message = 'PACS send enqueue did not persist an Orthanc job ID. Explicit resend is required.', updated_at = now()
      where status = 'sending' and orthanc_send_job_id is null
        and send_started_at < now() - ($1::text || ' minutes')::interval
      returning *
    `,
    [Math.max(1, staleMinutes)]
  );
  for (const job of rows) {
    await logDicomRemapAuditEntry({
      entityType: "dicom_remap_job", entityId: job.id, actionType: "pacs_send_failed",
      oldValues: { status: "sending" }, newValues: { status: "failed", failureCode: "ORTHANC_SEND_ENQUEUE_AMBIGUOUS" }, changedByUserId: null,
    });
  }
  return rows.length;
}

export async function monitorDicomRemapSendJob(job: DicomRemapJobRow): Promise<DicomRemapJobRow | null> {
  if (job.status !== "sending" || !job.orthanc_send_job_id) return null;
  const persistNonterminalMonitorDiagnostic = async (code: string, message: string, details: Record<string, unknown>, heartbeat = false): Promise<void> => {
    await queryDicomRemapDb(
      `
        update dicom_remap_jobs
        set send_last_checked_at = now(),
            send_last_heartbeat_at = case when $5 then now() else send_last_heartbeat_at end,
            send_error_code = $2,
            send_error_details = $3::jsonb,
            error_message = $4,
            updated_at = now()
        where id = $1 and status = 'sending' and orthanc_send_job_id = $6
      `,
      [job.id, code, JSON.stringify({ code, ...details }), message, heartbeat, job.orthanc_send_job_id]
    );
  };

  let response: OrthancFetchResult;
  try {
    response = await fetchOrthancForRemap(`/jobs/${encodeURIComponent(job.orthanc_send_job_id)}`, {
      timeoutSeconds: REMAP_ORTHANC_OPERATION_TIMEOUT_SECONDS,
    });
  } catch (error) {
    const isTimeout = error instanceof HttpError && error.statusCode === 504;
    const code = isTimeout ? "ORTHANC_SEND_MONITOR_TIMEOUT" : "ORTHANC_SEND_MONITOR_NETWORK_FAILURE";
    await persistNonterminalMonitorDiagnostic(
      code,
      isTimeout ? "RISpro is checking the Orthanc send job, but the monitor request timed out. It will retry automatically." : "RISpro is checking the Orthanc send job, but Orthanc is unreachable. It will retry automatically.",
      { orthancJobId: job.orthanc_send_job_id, attemptNumber: job.send_attempt_count, error: sanitizeOrthancSendDiagnosticText(error instanceof Error ? error.message : "network_failure") }
    );
    return null;
  }
  if (response.status === 404) {
    const result = await queryDicomRemapDb<DicomRemapJobRow>(
      `update dicom_remap_jobs set status = 'failed', send_completed_at = now(), send_last_checked_at = now(), send_error_code = 'ORTHANC_SEND_JOB_NOT_FOUND', send_error_details = $2::jsonb, error_message = 'Orthanc no longer has the persisted PACS send job. Explicit resend is required.', updated_at = now() where id = $1 and status = 'sending' and orthanc_send_job_id = $3 returning *`,
      [job.id, JSON.stringify({ code: "ORTHANC_SEND_JOB_NOT_FOUND", orthancJobId: job.orthanc_send_job_id, destinationPacsKey: job.destination_pacs_key, attemptNumber: job.send_attempt_count }), job.orthanc_send_job_id]
    );
    const failed = result.rows[0] || null;
    if (failed) await logDicomRemapAuditEntry({ entityType: "dicom_remap_job", entityId: failed.id, actionType: "pacs_send_failed", oldValues: { status: "sending" }, newValues: { status: "failed", failureCode: failed.send_error_code, orthancJobId: failed.orthanc_send_job_id }, changedByUserId: null });
    return failed;
  }
  if (!response.ok) {
    const code = response.status === 401 || response.status === 403
      ? "ORTHANC_SEND_MONITOR_AUTH_FAILED"
      : "ORTHANC_SEND_MONITOR_ORTHANC_ERROR";
    await persistNonterminalMonitorDiagnostic(
      code,
      response.status === 401 || response.status === 403
        ? "Orthanc credentials or configuration require attention before RISpro can monitor this PACS send."
        : "Orthanc returned an error while RISpro monitored this PACS send. Monitoring will retry automatically.",
      { orthancStatus: response.status, responseShape: describeOrthancPayloadShape(response.json), orthancJobId: job.orthanc_send_job_id, attemptNumber: job.send_attempt_count }
    );
    return null;
  }
  const state = orthancJobState(response.json);
  const details = sanitizeOrthancSendJobResult(response.json, job);
  if (["success", "completed", "done"].includes(state)) {
    const result = await queryDicomRemapDb<DicomRemapJobRow>(`update dicom_remap_jobs set status = 'sent', send_completed_at = now(), send_last_checked_at = now(), send_result = $2::jsonb, send_error_code = null, send_error_details = null, error_message = null, updated_at = now() where id = $1 and status = 'sending' and orthanc_send_job_id = $3 returning *`, [job.id, JSON.stringify(details), job.orthanc_send_job_id]);
    const sent = result.rows[0] || null;
    if (sent) {
      await logDicomRemapAuditEntry({ entityType: "dicom_remap_job", entityId: sent.id, actionType: "pacs_send_completed", oldValues: { status: "sending" }, newValues: { status: "sent", orthancJobId: sent.orthanc_send_job_id, attemptNumber: sent.send_attempt_count }, changedByUserId: null });
      await cleanupSentDicomRemapStaging(sent).catch(() => undefined);
    }
    return sent;
  }
  if (["failure", "failed", "error", "canceled", "cancelled"].includes(state)) {
    const code = classifyOrthancSendFailure(details);
    const result = await queryDicomRemapDb<DicomRemapJobRow>(`update dicom_remap_jobs set status = 'failed', send_completed_at = now(), send_last_checked_at = now(), send_error_code = $2, send_error_details = $3::jsonb, error_message = 'Orthanc PACS send job failed. Review the sanitized send diagnostics and resend explicitly if appropriate.', updated_at = now() where id = $1 and status = 'sending' and orthanc_send_job_id = $4 returning *`, [job.id, code, JSON.stringify(details), job.orthanc_send_job_id]);
    const failed = result.rows[0] || null;
    if (failed) await logDicomRemapAuditEntry({ entityType: "dicom_remap_job", entityId: failed.id, actionType: "pacs_send_failed", oldValues: { status: "sending" }, newValues: { status: "failed", failureCode: code, orthancJobId: failed.orthanc_send_job_id }, changedByUserId: null });
    return failed;
  }
  if (["pending", "running", "retry", "paused"].includes(state)) {
    const paused = state === "paused";
    await persistNonterminalMonitorDiagnostic(
      paused ? "ORTHANC_SEND_PAUSED" : "ORTHANC_SEND_ACTIVE",
      paused ? "Orthanc PACS send job is paused and needs operator attention." : "",
      details,
      true
    );
    return null;
  }
  await persistNonterminalMonitorDiagnostic(
    "ORTHANC_SEND_STATE_UNKNOWN",
    "Orthanc returned an unrecognized PACS send job state. Check Orthanc and the destination PACS before any resend.",
    { ...details, responseShape: describeOrthancPayloadShape(response.json) }
  );
  return null;
}

async function loadAccessibleDicomRemapJob(jobId: number | string): Promise<DicomRemapJobRow> {
  const cleanJobId = normalizePositiveInteger(jobId, "jobId");
  const { rows } = await queryDicomRemapDb<DicomRemapJobRow>(
    `
      select *
      from dicom_remap_jobs
      where id = $1
      limit 1
    `,
    [cleanJobId]
  );

  const job = rows[0];
  if (!job) {
    throw new HttpError(404, "DICOM remap job not found.");
  }
  return job;
}

export async function assertDicomRemapJobComparisonAccess(
  jobId: number | string,
  currentUserId: UserId,
  comparisonRequestIdInput: number | string
): Promise<void> {
  const comparisonRequestId = normalizePositiveInteger(comparisonRequestIdInput, "comparisonRequestId");
  if (!comparisonRequestId) throw new HttpError(400, "comparisonRequestId is required.");
  const job = await loadAccessibleDicomRemapJob(jobId);
  if (Number(job.comparison_request_id || 0) !== comparisonRequestId) {
    throw new HttpError(403, "DICOM remap job does not belong to this comparison request.");
  }
}

async function createEmptyDicomRemapUploadJob(
  currentUserId: UserId,
  comparisonRequestIdInput?: number | string | null
): Promise<DicomRemapJobRow> {
  const comparisonRequestId = normalizePositiveInteger(comparisonRequestIdInput, "comparisonRequestId", { required: false });
  if (comparisonRequestId) {
    const comparison = await queryDicomRemapDb<{ patient_id: number; status: string }>(
      "select patient_id, status from comparison_requests where id = $1 limit 1",
      [comparisonRequestId]
    );
    const request = comparison.rows[0];
    if (!request) throw new HttpError(404, "Comparison request not found.");
    if (request.status !== "pending_upload_confirmation") {
      throw new HttpError(409, "Only pending comparison requests can start a comparison remap.");
    }
  }
  const createResult = await queryDicomRemapDb<DicomRemapJobRow>(
      `
        insert into dicom_remap_jobs (
          created_by_user_id,
          status,
          comparison_request_id
        )
        select $1, 'uploaded', $2::bigint
        where $2::bigint is null
           or exists (
             select 1 from comparison_requests
             where id = $2::bigint and status = 'pending_upload_confirmation'
           )
        returning *
      `,
      [currentUserId, comparisonRequestId]
    );

  const job = createResult.rows[0];
  if (!job) {
    if (comparisonRequestId) {
      throw new HttpError(409, "Comparison request is no longer pending preparation.");
    }
    throw new HttpError(500, "Failed to create DICOM remap job.");
  }
  return job;
}

async function assertDicomRemapComparisonPatient(job: DicomRemapJobRow, patientId: number): Promise<void> {
  if (!job.comparison_request_id) return;
  const result = await queryDicomRemapDb<{ patient_id: number }>(
    "select patient_id from comparison_requests where id = $1 limit 1",
    [job.comparison_request_id]
  );
  const comparisonPatientId = Number(result.rows[0]?.patient_id || 0);
  if (!comparisonPatientId) throw new HttpError(409, "Linked comparison request is unavailable.");
  if (comparisonPatientId !== patientId) {
    throw new HttpError(400, "Comparison remap patient must match the comparison request patient.", {
      code: "DICOM_REMAP_COMPARISON_PATIENT_MISMATCH",
      comparisonRequestId: job.comparison_request_id,
    });
  }
}

async function finalizeDicomRemapUploadJob({
  job,
  studyIds,
  selectedStudyInstanceUID,
  skippedFilesCount,
  uploadedFileCount,
  currentUserId,
}: {
  job: DicomRemapJobRow;
  studyIds: Set<string>;
  selectedStudyInstanceUID?: string | null;
  skippedFilesCount: number;
  uploadedFileCount: number;
  currentUserId: UserId;
}): Promise<DicomRemapUploadProcessingResult> {
  if (uploadedFileCount === 0) {
    throw new HttpError(400, "No uploadable DICOM instance files were found.");
  }

  if (studyIds.size !== 1) {
    throw new HttpError(400, `Uploaded files must belong to exactly one study; detected ${studyIds.size} studies.`);
  }

  const sourceStudyId = Array.from(studyIds)[0];
  const summary = await readStudySummary(sourceStudyId);
  const expectedStudyInstanceUID = String(selectedStudyInstanceUID || "").trim();
  if (expectedStudyInstanceUID && summary.studyInstanceUid && summary.studyInstanceUid !== expectedStudyInstanceUID) {
    throw new HttpError(
      400,
      "Uploaded study does not match selected study. Please rescan and retry."
    );
  }

  const updateResult = await queryDicomRemapDb<DicomRemapJobRow>(
    `
      update dicom_remap_jobs
      set
        source_orthanc_study_id = $2,
        original_patient_id = $3,
        original_patient_name = $4,
        original_patient_sex = $5,
        original_patient_birth_date = $6,
        error_message = null,
        updated_at = now()
      where id = $1
      returning *
    `,
    [
      job.id,
      sourceStudyId,
      summary.patientId,
      summary.patientName,
      summary.patientSex,
      summary.patientBirthDate,
    ]
  );

  const updatedJob = updateResult.rows[0];
  if (!updatedJob) {
    throw new HttpError(500, "Failed to update upload job.");
  }

  await logDicomRemapAuditEntry({
    entityType: "dicom_remap_job",
    entityId: updatedJob.id,
    actionType: "upload",
    oldValues: null,
    newValues: {
      sourceOrthancStudyId: updatedJob.source_orthanc_study_id,
      originalPatient: summary,
      skippedFilesCount,
      uploadedFileCount,
    },
    changedByUserId: currentUserId,
  });

  return { job: updatedJob, summary, skippedFilesCount };
}

async function failDicomRemapUploadJob(jobId: number, error: unknown): Promise<void> {
  const message = error instanceof Error ? error.message : "DICOM upload failed.";
  await markJobFailed(jobId, message);
}

export async function cleanupDicomRemapUploadTempDir(path: string): Promise<void> {
  if (!path) {
    return;
  }
  await rm(path, { recursive: true, force: true });
}

export async function cleanupStaleDicomRemapUploadTempDirs(maxAgeMs = 24 * 60 * 60 * 1000): Promise<void> {
  const tmpRoot = os.tmpdir();
  const entries = await readdir(tmpRoot, { withFileTypes: true });
  const cutoff = Date.now() - maxAgeMs;

  await Promise.all(entries.map(async (entry) => {
    if (!entry.isDirectory() || !entry.name.startsWith(DICOM_REMAP_TEMP_PREFIX)) {
      return;
    }
    const fullPath = path.join(tmpRoot, entry.name);
    const info = await stat(fullPath).catch(() => null);
    if (!info || info.mtimeMs > cutoff) {
      return;
    }
    await cleanupDicomRemapUploadTempDir(fullPath);
  }));
}

export interface DicomRemapStagingContext {
  job: DicomRemapJobRow;
  storageKey: string;
  directory: string;
}

export interface DicomRemapStagedManifestFile {
  id: string;
  relativePath: string;
  displayName: string;
  mimeType: string;
  byteSize: number;
  sha256: string;
}

interface DicomRemapStagingManifest {
  version: number;
  selectedStudyInstanceUID?: string | null;
  provisionalSelectedStudyInstanceUID?: string | null;
  provisionalSourceIdentity?: DicomRemapProvisionalSourceIdentity | null;
  uploadMode: "single_study_folder_unverified" | "staged_folder_selected_study" | null;
  fileCount: number;
  totalBytes: number;
  files: DicomRemapStagedManifestFile[];
}

interface PersistedDicomUidPlan {
  version: number;
  studyInstanceUid: string;
  seriesInstanceUidByOriginal: Record<string, string>;
  sopInstanceUidByFileId: Record<string, string>;
  selectionCounts?: DicomRemapSelectionCounts;
  fileOutcomes?: Record<string, DicomRemapFileOutcome>;
  originalSeriesInstanceUidByFileId?: Record<string, string>;
  numberOfFramesByFileId?: Record<string, number>;
}

function dicomRemapFileLabel(index: number): string {
  return `File ${index + 1}`;
}

function isAcceptedDicomRemapOutcome(outcome: DicomRemapFileOutcome | undefined): boolean {
  return outcome?.category === "processed" || outcome?.category === "already_stored";
}

function dicomRemapStagingRoot(): string {
  const configured = String(env.dicomRemapStagingDir || "").trim();
  if (!configured) throw new HttpError(500, "DICOM remap staging storage is not configured.");
  return path.resolve(configured);
}

function resolveDicomRemapStagingPath(storageKey: string): string {
  const root = dicomRemapStagingRoot();
  const candidate = path.resolve(root, storageKey);
  if (candidate !== root && !candidate.startsWith(`${root}${path.sep}`)) {
    throw new HttpError(500, "DICOM remap staging storage key is invalid.");
  }
  return candidate;
}

async function writePrivateJson(target: string, value: unknown): Promise<void> {
  const temporary = `${target}.${randomUUID()}.part`;
  await writeFile(temporary, `${JSON.stringify(value)}\n`, { encoding: "utf8", mode: 0o600, flag: "wx" });
  await rename(temporary, target);
}

export async function createDicomRemapStagingContext(
  currentUserId: UserId,
  comparisonRequestId?: number | string | null
): Promise<DicomRemapStagingContext> {
  const job = await createEmptyDicomRemapUploadJob(currentUserId, comparisonRequestId);
  const storageKey = `jobs/${job.id}-${randomUUID()}`;
  const directory = resolveDicomRemapStagingPath(storageKey);
  try {
    await mkdir(path.join(directory, "files"), { recursive: true, mode: 0o700 });
    const result = await queryDicomRemapDb<DicomRemapJobRow>(
      `update dicom_remap_jobs set staged_storage_key = $2, processing_stage = 'staging', updated_at = now() where id = $1 returning *`,
      [job.id, storageKey]
    );
    const stagedJob = result.rows[0];
    if (!stagedJob) throw new HttpError(500, "Failed to initialize DICOM remap staging.");
    return { job: stagedJob, storageKey, directory };
  } catch (error) {
    await rm(directory, { recursive: true, force: true }).catch(() => undefined);
    await failDicomRemapStagingJob(job.id, "DICOM_REMAP_STAGING_WRITE_FAILED");
    throw error;
  }
}

export async function writeDicomRemapStagedFile({
  context,
  fileIndex,
  fileName,
  mimeType,
  stream,
}: {
  context: DicomRemapStagingContext;
  fileIndex: number;
  fileName: string;
  mimeType?: string;
  stream: NodeJS.ReadableStream;
}): Promise<DicomRemapStagedManifestFile> {
  if (fileIndex >= DICOM_REMAP_STAGING_MAX_FILES) {
    throw new HttpError(413, "Too many files in DICOM upload.", { code: "DICOM_REMAP_STAGING_FILE_LIMIT" });
  }
  const id = `${fileIndex.toString().padStart(6, "0")}-${randomUUID()}`;
  const relativePath = `files/${id}.dcm`;
  const target = resolveDicomRemapStagingPath(path.posix.join(context.storageKey, relativePath));
  const temporary = `${target}.part`;
  const hash = createHash("sha256");
  let byteSize = 0;
  await new Promise<void>((resolve, reject) => {
    const output = createWriteStream(temporary, { flags: "wx", mode: 0o600 });
    const fail = (error: unknown) => {
      (stream as NodeJS.ReadableStream & { destroy(error?: Error): void }).destroy(error instanceof Error ? error : new Error("DICOM remap staging write failed."));
      output.destroy(error instanceof Error ? error : new Error("DICOM remap staging write failed."));
      reject(error);
    };
    stream.on("data", (chunk: Buffer) => {
      byteSize += chunk.length;
      if (byteSize > DICOM_REMAP_STAGING_MAX_TOTAL_BYTES) {
        fail(new HttpError(413, "DICOM upload file exceeds the configured limit.", { code: "DICOM_REMAP_STAGING_SIZE_LIMIT" }));
        return;
      }
      hash.update(chunk);
    });
    stream.on("error", fail);
    output.on("error", fail);
    output.on("finish", resolve);
    stream.pipe(output);
  }).catch(async (error) => {
    await rm(temporary, { force: true }).catch(() => undefined);
    throw error;
  });
  await rename(temporary, target);
  return {
    id,
    relativePath,
    displayName: sanitizeFileName(fileName),
    mimeType: String(mimeType || "application/octet-stream").trim(),
    byteSize,
    sha256: hash.digest("hex"),
  };
}

export async function finalizeDicomRemapStagingJob({
  context,
  files,
  selectedStudyInstanceUID,
  uploadMode,
  risproPatientId,
  destinationPacsKey,
  confirm,
}: {
  context: DicomRemapStagingContext;
  files: DicomRemapStagedManifestFile[];
  selectedStudyInstanceUID: string | null;
  uploadMode: string | null;
  risproPatientId: string | null;
  destinationPacsKey: string | null;
  confirm: string | null;
}): Promise<{ job: DicomRemapJobRow }> {
  if (!validateExplicitConfirm(confirm)) throw new HttpError(400, "Explicit confirmation is required.");
  const patientId = normalizePositiveInteger(risproPatientId, "risproPatientId");
  const destination = normalizeOrthancModalityKey(destinationPacsKey || "");
  if (!patientId || !destination) throw new HttpError(400, "Patient and PACS destination are required.");
  if (!String(selectedStudyInstanceUID || "").trim()) throw new HttpError(400, "selectedStudyInstanceUID is required.");
  const normalizedUploadMode = String(uploadMode || "").trim();
  if (normalizedUploadMode && normalizedUploadMode !== "single_study_folder_unverified") {
    throw new HttpError(400, "DICOM remap upload mode is invalid.");
  }
  if (!files.length) throw new HttpError(400, "At least one DICOM file is required.");
  if (files.length > DICOM_REMAP_STAGING_MAX_FILES) {
    throw new HttpError(413, "Too many files in DICOM upload.", { code: "DICOM_REMAP_STAGING_FILE_LIMIT" });
  }
  const totalBytes = files.reduce((total, file) => total + file.byteSize, 0);
  if (totalBytes <= 0 || totalBytes > DICOM_REMAP_STAGING_MAX_TOTAL_BYTES) throw new HttpError(413, "DICOM upload exceeds the configured size limit.");

  await assertDicomRemapComparisonPatient(context.job, patientId);

  const patient = await getPatientForDicomRemap(patientId);
  const replacement = formatReplacementFromPatient(patient);
  if (!replacement.patientId || !replacement.patientName) throw new HttpError(400, "Selected patient does not have enough identity fields for DICOM replacement.");
  const modalities = await listModalitiesForDicomRemap();
  if (!modalities.modalities.some((item) => item.key === destination)) throw new HttpError(400, "Selected PACS destination is not available.");

  const manifest: DicomRemapStagingManifest = {
    version: DICOM_REMAP_STAGING_MANIFEST_VERSION,
    selectedStudyInstanceUID: String(selectedStudyInstanceUID).trim(),
    uploadMode: normalizedUploadMode === "single_study_folder_unverified" ? normalizedUploadMode : null,
    fileCount: files.length,
    totalBytes,
    files,
  };
  try {
    await writePrivateJson(path.join(context.directory, "manifest.json"), manifest);
  } catch (error) {
    await failDicomRemapStagingJob(context.job.id, "DICOM_REMAP_STAGING_MANIFEST_FAILED");
    throw error;
  }

  const result = await queryDicomRemapDb<DicomRemapJobRow>(
    `update dicom_remap_jobs set status = 'uploaded', processing_stage = 'queued', staged_manifest_version = $2, staged_file_count = $3, staged_total_bytes = $4, rispro_patient_id = $5, destination_pacs_key = $6, replacement_patient_id = $7, replacement_patient_name = $8, replacement_patient_sex = $9, replacement_patient_birth_date = $10, processing_error_code = null, processing_error_details = null, error_message = null, updated_at = now() where id = $1 and staged_storage_key = $11 returning *`,
    [context.job.id, manifest.version, manifest.fileCount, manifest.totalBytes, patientId, destination, replacement.patientId, replacement.patientName, replacement.patientSex, replacement.patientBirthDate, context.storageKey]
  );
  const job = result.rows[0];
  if (!job) throw new HttpError(409, "DICOM remap upload changed before staging completed.");
  await logDicomRemapAuditEntry({ entityType: "dicom_remap_job", entityId: job.id, actionType: "dicom_remap_staging_completed", oldValues: { status: "uploaded", processingStage: "staging" }, newValues: { status: "uploaded", processingStage: "queued", fileCount: manifest.fileCount, totalBytes: manifest.totalBytes }, changedByUserId: job.created_by_user_id });
  return { job };
}

export async function finalizeDicomRemapAwaitingConfirmationStagingJob({
  context,
  files,
  selectedStudyInstanceUID,
  provisionalSourceIdentity,
  confirmSource,
}: {
  context: DicomRemapStagingContext;
  files: DicomRemapStagedManifestFile[];
  selectedStudyInstanceUID: string | null;
  provisionalSourceIdentity: unknown;
  confirmSource: string | null;
}): Promise<{ job: DicomRemapJobRow }> {
  if (!validateExplicitConfirm(confirmSource)) {
    throw new HttpError(400, "Explicit source-study confirmation is required.");
  }
  const selectedUid = normalizeSelectedStudyInstanceUid(selectedStudyInstanceUID);
  const provisionalIdentity = normalizeProvisionalSourceIdentity(provisionalSourceIdentity, selectedUid);
  if (!files.length) throw new HttpError(400, "At least one DICOM file is required.");
  if (files.length > DICOM_REMAP_STAGING_MAX_FILES) {
    throw new HttpError(413, "Too many files in DICOM upload.", { code: "DICOM_REMAP_STAGING_FILE_LIMIT" });
  }
  const totalBytes = files.reduce((total, file) => total + file.byteSize, 0);
  if (totalBytes <= 0 || totalBytes > DICOM_REMAP_STAGING_MAX_TOTAL_BYTES) {
    throw new HttpError(413, "DICOM upload exceeds the configured size limit.", { code: "DICOM_REMAP_STAGING_SIZE_LIMIT" });
  }

  const manifest: DicomRemapStagingManifest = {
    version: DICOM_REMAP_SELECTED_STUDY_MANIFEST_VERSION,
    provisionalSelectedStudyInstanceUID: selectedUid,
    provisionalSourceIdentity: provisionalIdentity,
    uploadMode: "staged_folder_selected_study",
    fileCount: files.length,
    totalBytes,
    files,
  };
  try {
    await writePrivateJson(path.join(context.directory, "manifest.json"), manifest);
  } catch (error) {
    await failDicomRemapStagingJob(context.job.id, "DICOM_REMAP_STAGING_MANIFEST_FAILED");
    throw error;
  }

  const result = await queryDicomRemapDb<DicomRemapJobRow>(
    `update dicom_remap_jobs
        set status = 'awaiting_confirmation',
            processing_stage = 'awaiting_confirmation',
            staged_manifest_version = $2,
            staged_file_count = $3,
            staged_total_bytes = $4,
            provisional_source_identity = $5::jsonb,
            processing_error_code = null,
            processing_error_details = null,
            error_message = null,
            updated_at = now()
      where id = $1
        and status = 'uploaded'
        and processing_stage = 'staging'
        and staged_storage_key = $6
      returning *`,
    [
      context.job.id,
      manifest.version,
      manifest.fileCount,
      manifest.totalBytes,
      JSON.stringify(provisionalIdentity),
      context.storageKey,
    ]
  );
  const job = result.rows[0];
  if (!job) throw new HttpError(409, "DICOM remap upload changed before staging completed.");
  await logDicomRemapAuditEntry({
    entityType: "dicom_remap_job",
    entityId: job.id,
    actionType: "dicom_remap_staging_awaiting_confirmation",
    oldValues: { status: "uploaded", processingStage: "staging" },
    newValues: {
      status: "awaiting_confirmation",
      processingStage: "awaiting_confirmation",
      fileCount: manifest.fileCount,
      totalBytes: manifest.totalBytes,
    },
    changedByUserId: job.created_by_user_id,
  });
  return { job };
}

export async function failDicomRemapStagingJob(jobId: number, code: string): Promise<void> {
  const safeCode = ["DICOM_REMAP_STAGING_INTERRUPTED", "DICOM_REMAP_STAGING_FILE_LIMIT", "DICOM_REMAP_STAGING_SIZE_LIMIT", "DICOM_REMAP_STAGING_WRITE_FAILED", "DICOM_REMAP_STAGING_MANIFEST_FAILED"].includes(code) ? code : "DICOM_REMAP_STAGING_WRITE_FAILED";
  await queryDicomRemapDb(`update dicom_remap_jobs set status = 'failed', processing_stage = 'failed', processing_error_code = $2::text, processing_error_details = jsonb_build_object('code', $2::text), error_message = 'DICOM staging did not complete. Start a new upload.', processing_lease_owner = null, processing_lease_expires_at = null, updated_at = now() where id = $1`, [jobId, safeCode]);
}

export async function cleanupDicomRemapStagingStorage(storageKey: string): Promise<void> {
  const directory = resolveDicomRemapStagingPath(storageKey);
  await rm(directory, { recursive: true, force: true });
}

export async function cleanupExpiredFailedDicomRemapStaging(retentionHours: number, limit = 25): Promise<number> {
  const safeHours = Math.max(1, Math.min(Math.floor(retentionHours), 24 * 365));
  const { rows } = await queryDicomRemapDb<DicomRemapJobRow>(
    `select * from dicom_remap_jobs where status = 'failed' and staged_storage_key is not null and staging_cleanup_completed_at is null and coalesce(processing_completed_at, updated_at) < now() - ($1::text || ' hours')::interval and not (orthanc_recovery_status in ('available', 'processing', 'failed') and orthanc_recovery_expires_at > now()) order by updated_at asc limit $2`,
    [safeHours, Math.max(1, Math.min(limit, 100))]
  );
  let cleaned = 0;
  for (const job of rows) {
    try {
      await cleanupDicomRemapStagingStorage(String(job.staged_storage_key));
      const result = await queryDicomRemapDb<DicomRemapJobRow>(`update dicom_remap_jobs set staging_cleanup_completed_at = now(), updated_at = now() where id = $1 and status = 'failed' and staging_cleanup_completed_at is null returning *`, [job.id]);
      if (result.rows[0]) {
        cleaned += 1;
        await logDicomRemapAuditEntry({ entityType: "dicom_remap_job", entityId: job.id, actionType: "dicom_remap_staging_cleaned", oldValues: null, newValues: { retentionHours: safeHours, status: "failed" }, changedByUserId: null });
      }
    } catch {
      // Retention cleanup diagnostics must never change a processing or send result.
    }
  }
  const known = await queryDicomRemapDb<{ staged_storage_key: string | null }>(`select staged_storage_key from dicom_remap_jobs where staged_storage_key is not null`);
  const knownKeys = new Set(known.rows.map((row) => String(row.staged_storage_key || "")).filter(Boolean));
  const jobsRoot = path.join(dicomRemapStagingRoot(), "jobs");
  const cutoff = Date.now() - safeHours * 60 * 60 * 1000;
  const entries = await readdir(jobsRoot, { withFileTypes: true }).catch(() => []);
  for (const entry of entries) {
    if (!entry.isDirectory() || !/^\d+-[a-f0-9-]{36}$/i.test(entry.name)) continue;
    const storageKey = `jobs/${entry.name}`;
    if (knownKeys.has(storageKey)) continue;
    const directory = resolveDicomRemapStagingPath(storageKey);
    const info = await stat(directory).catch(() => null);
    if (!info || info.mtimeMs >= cutoff) continue;
    await rm(directory, { recursive: true, force: true }).catch(() => undefined);
  }
  return cleaned;
}

export async function cleanupExpiredAwaitingDicomRemapStaging(retentionHours: number, limit = 25): Promise<number> {
  const safeHours = Math.max(1, Math.min(Math.floor(retentionHours), 24 * 365));
  const safeLimit = Math.max(1, Math.min(limit, 100));
  const { rows } = await queryDicomRemapDb<DicomRemapJobRow>(
    `select *
       from dicom_remap_jobs
      where staged_storage_key is not null
        and staging_cleanup_completed_at is null
        and (
          (status = 'awaiting_confirmation' and updated_at < now() - ($1::text || ' hours')::interval)
          or status = 'cancelled'
        )
      order by updated_at asc
      limit $2`,
    [safeHours, safeLimit]
  );
  let cleaned = 0;
  for (const candidate of rows) {
    let job = candidate;
    if (candidate.status === "awaiting_confirmation") {
      const cancelled = await queryDicomRemapDb<DicomRemapJobRow>(
        `update dicom_remap_jobs
            set status = 'cancelled',
                cancellation_reason = 'AWAITING_CONFIRMATION_EXPIRED',
                processing_stage = 'cancelled',
                updated_at = now()
          where id = $1
            and status = 'awaiting_confirmation'
            and updated_at < now() - ($2::text || ' hours')::interval
          returning *`,
        [candidate.id, safeHours]
      );
      if (!cancelled.rows[0]) continue;
      job = cancelled.rows[0];
    }
    try {
      await cleanupDicomRemapStagingStorage(String(job.staged_storage_key));
      const result = await queryDicomRemapDb<DicomRemapJobRow>(
        `update dicom_remap_jobs
            set staging_cleanup_completed_at = now(), updated_at = now()
          where id = $1
            and status = 'cancelled'
            and staging_cleanup_completed_at is null
          returning *`,
        [job.id]
      );
      if (!result.rows[0]) continue;
      cleaned += 1;
      await logDicomRemapAuditEntry({
        entityType: "dicom_remap_job",
        entityId: job.id,
        actionType: job.cancellation_reason === "AWAITING_CONFIRMATION_EXPIRED"
          ? "dicom_remap_staging_expired"
          : "dicom_remap_staging_cleaned",
        oldValues: job.cancellation_reason === "AWAITING_CONFIRMATION_EXPIRED"
          ? { status: "awaiting_confirmation" }
          : { status: "cancelled" },
        newValues: { status: "cancelled", retentionHours: safeHours },
        changedByUserId: null,
      });
    } catch {
      // A later worker tick retries cancelled rows whose private staging remains.
    }
  }
  return cleaned;
}

export async function cleanupExpiredDicomRemapStaging(
  failedRetentionHours: number,
  awaitingConfirmationRetentionHours: number
): Promise<number> {
  const failed = await cleanupExpiredFailedDicomRemapStaging(failedRetentionHours);
  const awaiting = await cleanupExpiredAwaitingDicomRemapStaging(awaitingConfirmationRetentionHours);
  return failed + awaiting;
}

function processingErrorCode(error: unknown): string {
  if (error instanceof HttpError) {
    const code = String((error.details as { code?: unknown } | null)?.code || "");
    if (code.startsWith("DICOM_REMAP_")) return code;
  }
  return "DICOM_REMAP_PROCESSING_UNCLASSIFIED";
}

function processingErrorMessage(code: string): string {
  const messages: Record<string, string> = {
    DICOM_REMAP_MANIFEST_INVALID: "DICOM remap staging manifest is invalid.",
    DICOM_REMAP_STAGED_FILE_MISSING: "A staged DICOM file is missing.",
    DICOM_REMAP_STAGED_FILE_HASH_MISMATCH: "A staged DICOM file did not pass integrity validation.",
    DICOM_REMAP_UID_PLAN_INVALID: "DICOM remap UID plan is invalid.",
    DICOM_REMAP_DICOM_PARSE_FAILED: "DICOM study validation failed.",
    DICOM_REMAP_DICOM_REWRITE_FAILED: "DICOM metadata rewrite failed.",
    DICOM_REMAP_PIXEL_INTEGRITY_FAILED: "DICOM pixel integrity verification failed. The rewritten object was not uploaded.",
    DICOM_REMAP_MULTIPLE_STUDIES: "Uploaded files must belong to exactly one selected study.",
    DICOM_REMAP_MULTIPLE_STUDIES_DETECTED: "More than one DICOM study was found in the selected folder. Start again, allow the complete folder scan to finish, and select the required study.",
    DICOM_REMAP_SOURCE_IDENTITY_INCONSISTENT: "The selected folder contains conflicting source-patient identity information. No DICOM files were remapped or sent. Run the complete folder scan and select the required study.",
    DICOM_REMAP_SELECTED_STUDY_NOT_FOUND: "The confirmed source study was not found in the securely staged files. No DICOM files were remapped or sent.",
    DICOM_REMAP_SOURCE_IDENTITY_MISMATCH: "Server verification found that the source identity differs from the preliminary confirmation. No DICOM files were remapped or sent.",
    DICOM_REMAP_ORTHANC_UPLOAD_FAILED: "Orthanc could not ingest the remapped study.",
    DICOM_REMAP_ORTHANC_INSTANCE_CONFLICT: "Orthanc reported a conflicting remapped instance.",
    DICOM_REMAP_ORTHANC_VERIFICATION_FAILED: "Orthanc could not verify the remapped study.",
    DICOM_REMAP_IDENTITY_VERIFICATION_FAILED: "Orthanc did not verify the selected replacement identity.",
    DICOM_REMAP_PROCESSING_UNCLASSIFIED: "DICOM remap processing failed unexpectedly.",
    DICOM_REMAP_PROCESSING_LEASE_LOST: "DICOM remap processing lease was lost and will be recovered safely.",
  };
  return messages[code] || "DICOM remap processing failed.";
}

export async function releaseExpiredDicomRemapOrthancRecoveryClaims(limit = 25): Promise<number> {
  const safeLimit = Math.max(1, Math.min(Math.floor(limit), 100));
  const { rows } = await queryDicomRemapDb<DicomRemapJobRow>(
    `update dicom_remap_jobs
        set orthanc_recovery_status = 'failed',
            orthanc_recovery_stage = 'failed',
            orthanc_recovery_error_code = 'DICOM_REMAP_ORTHANC_RECOVERY_INTERRUPTED',
            orthanc_recovery_error_details = jsonb_build_object('code', 'DICOM_REMAP_ORTHANC_RECOVERY_INTERRUPTED', 'interruptedStage', orthanc_recovery_stage),
            orthanc_recovery_lease_owner = null,
            orthanc_recovery_lease_expires_at = null,
            error_message = 'Orthanc recovery was interrupted and can be retried while preserved staging remains available.',
            updated_at = now()
      where id in (
        select id from dicom_remap_jobs
         where orthanc_recovery_status = 'processing'
           and (orthanc_recovery_lease_expires_at is null or orthanc_recovery_lease_expires_at <= now())
         order by updated_at asc
         limit $1
         for update skip locked
      )
      returning *`,
    [safeLimit]
  );
  for (const job of rows) {
    await logDicomRemapAuditEntry({
      entityType: "dicom_remap_job",
      entityId: job.id,
      actionType: "dicom_remap_orthanc_recovery_interrupted",
      oldValues: { orthancRecoveryStatus: "processing" },
      newValues: {
        orthancRecoveryStatus: "failed",
        recoveryStage: job.orthanc_recovery_stage,
        attemptNumber: job.orthanc_recovery_attempt_count,
        sourceCheckpointExists: Boolean(job.orthanc_recovery_source_study_id),
        modifiedCheckpointExists: Boolean(job.modified_orthanc_study_id),
        errorCode: "DICOM_REMAP_ORTHANC_RECOVERY_INTERRUPTED",
      },
      changedByUserId: null,
    });
  }
  return rows.length;
}

const ORTHANC_RECOVERY_ELIGIBLE_PROCESSING_ERRORS = new Set([
  "DICOM_REMAP_DICOM_REWRITE_FAILED",
  "DICOM_REMAP_PIXEL_INTEGRITY_FAILED",
  "DICOM_REMAP_ORTHANC_UPLOAD_FAILED",
  "DICOM_REMAP_ORTHANC_UPLOAD_RETRY_EXHAUSTED",
  "DICOM_REMAP_ORTHANC_FILE_REJECTED",
  "DICOM_REMAP_ORTHANC_INSTANCE_CONFLICT",
  "DICOM_REMAP_ORTHANC_AUTH_FAILED",
  "DICOM_REMAP_ORTHANC_INFRASTRUCTURE_FAILURE",
  "DICOM_REMAP_ORTHANC_VERIFICATION_FAILED",
  "DICOM_REMAP_IDENTITY_VERIFICATION_FAILED",
  "DICOM_REMAP_MULTIFRAME_OBJECT_FAILED",
  // Operators may explicitly decide whether a preserved source is safe to recover.
  // This intentionally remains outside the automatic-fallback allowlist below.
  "DICOM_REMAP_PROCESSING_UNCLASSIFIED",
]);

// Automatic fallback is intentionally narrower than operator-invoked recovery.
// Verification and identity outcomes remain manual so an operator reviews them.
const ORTHANC_AUTO_RECOVERY_PROCESSING_ERRORS = new Set([
  "DICOM_REMAP_DICOM_REWRITE_FAILED",
  "DICOM_REMAP_PIXEL_INTEGRITY_FAILED",
  "DICOM_REMAP_ORTHANC_UPLOAD_FAILED",
  "DICOM_REMAP_ORTHANC_UPLOAD_RETRY_EXHAUSTED",
  "DICOM_REMAP_ORTHANC_FILE_REJECTED",
]);

function isOrthancRecoveryEligibleProcessingError(code: unknown): boolean {
  return ORTHANC_RECOVERY_ELIGIBLE_PROCESSING_ERRORS.has(String(code || ""));
}

function shouldAutomaticallyAttemptOrthancRecovery(job: DicomRemapJobRow): boolean {
  return job.status === "failed"
    && job.orthanc_recovery_status === "available"
    && Boolean(job.staged_storage_key)
    && !job.staging_cleanup_completed_at
    && Date.parse(String(job.orthanc_recovery_expires_at || "")) > Date.now()
    && Number(job.orthanc_recovery_attempt_count || 0) === 0
    && ORTHANC_AUTO_RECOVERY_PROCESSING_ERRORS.has(String(job.processing_error_code || ""));
}

async function readDicomRemapStagingManifestMetadata(job: DicomRemapJobRow): Promise<{ manifest: DicomRemapStagingManifest; directory: string }> {
  const storageKey = String(job.staged_storage_key || "").trim();
  if (!storageKey) throw new HttpError(409, "DICOM remap manifest is missing.", { code: "DICOM_REMAP_MANIFEST_INVALID" });
  const directory = resolveDicomRemapStagingPath(storageKey);
  let manifest: DicomRemapStagingManifest;
  try {
    manifest = JSON.parse(await readFile(path.join(directory, "manifest.json"), "utf8")) as DicomRemapStagingManifest;
  } catch {
    throw new HttpError(409, "DICOM remap manifest is invalid.", { code: "DICOM_REMAP_MANIFEST_INVALID" });
  }
  if (
    ![DICOM_REMAP_STAGING_MANIFEST_VERSION, DICOM_REMAP_SELECTED_STUDY_MANIFEST_VERSION].includes(Number(manifest.version))
    || !Array.isArray(manifest.files)
    || manifest.files.length === 0
    || manifest.files.length !== Number(manifest.fileCount)
    || Number(manifest.fileCount) !== Number(job.staged_file_count)
    || Number(manifest.totalBytes) !== Number(job.staged_total_bytes)
  ) {
    throw new HttpError(409, "DICOM remap manifest is invalid.", { code: "DICOM_REMAP_MANIFEST_INVALID" });
  }
  if (manifest.version === DICOM_REMAP_SELECTED_STUDY_MANIFEST_VERSION) {
    let selectedUid = "";
    let identityUid = "";
    try {
      selectedUid = normalizeSelectedStudyInstanceUid(manifest.provisionalSelectedStudyInstanceUID);
      identityUid = normalizeSelectedStudyInstanceUid(manifest.provisionalSourceIdentity?.studyInstanceUid);
    } catch {
      throw new HttpError(409, "DICOM remap manifest is invalid.", { code: "DICOM_REMAP_MANIFEST_INVALID" });
    }
    if (manifest.uploadMode !== "staged_folder_selected_study" || selectedUid !== identityUid) {
      throw new HttpError(409, "DICOM remap manifest is invalid.", { code: "DICOM_REMAP_MANIFEST_INVALID" });
    }
  }
  return { manifest, directory };
}

async function loadDicomRemapStagingManifest(job: DicomRemapJobRow): Promise<{ manifest: DicomRemapStagingManifest; directory: string }> {
  const { manifest, directory } = await readDicomRemapStagingManifestMetadata(job);
  const seen = new Set<string>();
  let totalBytes = 0;
  for (const file of manifest.files) {
    if (!file || !/^[a-z0-9-]{10,}$/i.test(String(file.id || "")) || !/^files\/[a-z0-9-]+\.dcm$/i.test(String(file.relativePath || "")) || seen.has(file.id) || !/^[a-f0-9]{64}$/i.test(String(file.sha256 || ""))) {
      throw new HttpError(409, "DICOM remap manifest is invalid.", { code: "DICOM_REMAP_MANIFEST_INVALID" });
    }
    seen.add(file.id);
    const filePath = path.resolve(directory, file.relativePath);
    if (!filePath.startsWith(`${directory}${path.sep}`)) throw new HttpError(409, "DICOM remap manifest is invalid.", { code: "DICOM_REMAP_MANIFEST_INVALID" });
    const info = await stat(filePath).catch(() => null);
    if (!info?.isFile()) throw new HttpError(409, "A staged DICOM file is missing.", { code: "DICOM_REMAP_STAGED_FILE_MISSING" });
    if (info.size !== Number(file.byteSize)) throw new HttpError(409, "A staged DICOM file has an unexpected size.", { code: "DICOM_REMAP_STAGED_FILE_HASH_MISMATCH" });
    const digest = createHash("sha256").update(await readFile(filePath)).digest("hex");
    if (digest !== file.sha256) throw new HttpError(409, "A staged DICOM file failed integrity validation.", { code: "DICOM_REMAP_STAGED_FILE_HASH_MISMATCH" });
    totalBytes += info.size;
  }
  if (totalBytes !== Number(manifest.totalBytes)) throw new HttpError(409, "DICOM remap manifest totals are invalid.", { code: "DICOM_REMAP_MANIFEST_INVALID" });
  return { manifest, directory };
}

function isDicomRemapSourceRecoveryAvailable(job: DicomRemapJobRow): boolean {
  return job.status === "failed"
    && Boolean(String(job.staged_storage_key || "").trim())
    && !job.staging_cleanup_completed_at
    && Date.parse(String(job.orthanc_recovery_expires_at || "")) > Date.now();
}

function sourceRecoveryUnavailable(): never {
  throw new HttpError(409, "Preserved source files are no longer available.", { code: "DICOM_REMAP_SOURCE_RECOVERY_UNAVAILABLE" });
}

function sourceRecoveryConflict(message: string, code: string): never {
  throw new HttpError(409, message, { code });
}

async function hashDicomRemapStagedFile(filePath: string): Promise<string> {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(filePath)) {
    hash.update(chunk);
  }
  return hash.digest("hex");
}

async function readDicomRemapSourceStudyUid(filePath: string, byteSize: number): Promise<string> {
  const handle = await open(filePath, "r");
  try {
    const preview = Buffer.alloc(Math.min(Math.max(byteSize, 0), DICOM_REMAP_PREVIEW_HEADER_BYTES));
    const { bytesRead } = await handle.read(preview, 0, preview.length, 0);
    const studyInstanceUid = normalizeDicomUid(parseDicomPreviewTags(preview.subarray(0, bytesRead))["0020000d"]);
    if (!studyInstanceUid) {
      sourceRecoveryConflict("A preserved source DICOM cannot be safely assigned to the selected study.", "DICOM_REMAP_SELECTED_STUDY_NOT_FOUND");
    }
    return studyInstanceUid;
  } finally {
    await handle.close();
  }
}

function confirmedDicomRemapSourceStudyUid(job: DicomRemapJobRow, manifest: DicomRemapStagingManifest): string {
  try {
    if (manifest.version === DICOM_REMAP_SELECTED_STUDY_MANIFEST_VERSION) {
      const provisionalUid = normalizeSelectedStudyInstanceUid(manifest.provisionalSelectedStudyInstanceUID);
      const confirmedUid = normalizeSelectedStudyInstanceUid(job.selected_study_instance_uid);
      if (provisionalUid !== confirmedUid) {
        sourceRecoveryConflict("The confirmed selected study is unavailable.", "DICOM_REMAP_SELECTED_STUDY_NOT_FOUND");
      }
      return confirmedUid;
    }
    return normalizeSelectedStudyInstanceUid(manifest.selectedStudyInstanceUID);
  } catch (error) {
    if (error instanceof HttpError) {
      sourceRecoveryConflict("The confirmed selected study is unavailable.", "DICOM_REMAP_SELECTED_STUDY_NOT_FOUND");
    }
    throw error;
  }
}

interface DicomRemapSourceRecoveryFile {
  path: string;
}

export interface DicomRemapSourceRecovery {
  jobId: number;
  objectCount: number;
  totalBytes: number;
  streamTo(destination: Writable): { completed: Promise<void>; abort: () => void };
}

export async function prepareDicomRemapSourceRecovery({
  jobId,
  currentUserId,
}: {
  jobId: number | string;
  currentUserId: UserId;
}): Promise<DicomRemapSourceRecovery> {
  const job = await loadAccessibleDicomRemapJob(jobId);
  if (!isDicomRemapSourceRecoveryAvailable(job)) sourceRecoveryUnavailable();

  const { manifest, directory } = await readDicomRemapStagingManifestMetadata(job);
  const selectedStudyUid = confirmedDicomRemapSourceStudyUid(job, manifest);
  const selectedFiles: DicomRemapSourceRecoveryFile[] = [];
  let selectedTotalBytes = 0;
  let manifestTotalBytes = 0;
  const parsedStudyUids = new Set<string>();
  const manifestFileIds = new Set<string>();
  const manifestRelativePaths = new Set<string>();

  for (const file of manifest.files) {
    if (!file || !/^[a-z0-9-]{10,}$/i.test(String(file.id || "")) || !/^files\/[a-z0-9-]+\.dcm$/i.test(String(file.relativePath || "")) || !/^[a-f0-9]{64}$/i.test(String(file.sha256 || "")) || manifestFileIds.has(file.id) || manifestRelativePaths.has(file.relativePath)) {
      sourceRecoveryConflict("DICOM remap manifest is invalid.", "DICOM_REMAP_MANIFEST_INVALID");
    }
    manifestFileIds.add(file.id);
    manifestRelativePaths.add(file.relativePath);
    const filePath = path.resolve(directory, file.relativePath);
    if (!filePath.startsWith(`${directory}${path.sep}`)) {
      sourceRecoveryConflict("DICOM remap manifest is invalid.", "DICOM_REMAP_MANIFEST_INVALID");
    }
    const info = await stat(filePath).catch(() => null);
    if (!info?.isFile()) {
      sourceRecoveryConflict("A preserved source DICOM file is missing.", "DICOM_REMAP_STAGED_FILE_MISSING");
    }
    if (info.size !== Number(file.byteSize)) {
      sourceRecoveryConflict("A preserved source DICOM file failed integrity validation.", "DICOM_REMAP_STAGED_FILE_HASH_MISMATCH");
    }
    manifestTotalBytes += info.size;
    if (await hashDicomRemapStagedFile(filePath) !== file.sha256) {
      sourceRecoveryConflict("A preserved source DICOM file failed integrity validation.", "DICOM_REMAP_STAGED_FILE_HASH_MISMATCH");
    }

    if (isSkippableDicomRemapFolderEntry(file.displayName) || !isLikelyDicomFile(file.displayName, file.mimeType)) {
      continue;
    }
    const sourceStudyUid = await readDicomRemapSourceStudyUid(filePath, info.size);
    parsedStudyUids.add(sourceStudyUid);
    if (sourceStudyUid === selectedStudyUid) {
      selectedFiles.push({ path: filePath });
      selectedTotalBytes += info.size;
    } else if (manifest.version !== DICOM_REMAP_SELECTED_STUDY_MANIFEST_VERSION) {
      sourceRecoveryConflict("Preserved source files cannot be safely separated into the selected study.", "DICOM_REMAP_MULTIPLE_STUDIES_DETECTED");
    }
  }

  if (manifestTotalBytes !== Number(manifest.totalBytes)) {
    sourceRecoveryConflict("DICOM remap manifest is invalid.", "DICOM_REMAP_MANIFEST_INVALID");
  }

  if (!selectedFiles.length || !parsedStudyUids.has(selectedStudyUid)) {
    sourceRecoveryConflict("The confirmed selected study was not found in preserved staging.", "DICOM_REMAP_SELECTED_STUDY_NOT_FOUND");
  }

  return {
    jobId: job.id,
    objectCount: selectedFiles.length,
    totalBytes: selectedTotalBytes,
    streamTo(destination) {
      const archive = archiver("zip", { store: true });
      const sourceStreams = new Set<Readable>();
      let aborted = false;
      let settled = false;
      let resolveCompleted!: () => void;
      let rejectCompleted!: (error: Error) => void;
      const completed = new Promise<void>((resolve, reject) => {
        resolveCompleted = resolve;
        rejectCompleted = reject;
      });
      const fail = (error: unknown) => {
        if (settled || aborted) return;
        settled = true;
        rejectCompleted(error instanceof Error ? error : new Error("DICOM source recovery download failed."));
      };
      const abort = () => {
        if (aborted || settled) return;
        aborted = true;
        for (const source of sourceStreams) source.destroy();
        archive.abort();
        settled = true;
        rejectCompleted(new Error("DICOM source recovery download was interrupted."));
      };

      archive.on("error", fail);
      destination.once("error", fail);
      destination.once("close", () => {
        if (!(destination as { writableFinished?: boolean }).writableFinished) abort();
      });
      destination.once("finish", () => {
        if (aborted || settled) return;
        void logDicomRemapAuditEntry({
          entityType: "dicom_remap_job",
          entityId: job.id,
          actionType: "dicom_remap_source_recovered",
          oldValues: null,
          newValues: { jobId: job.id, objectCount: selectedFiles.length, totalBytes: selectedTotalBytes, selectedStudyConfirmed: true },
          changedByUserId: currentUserId,
        }).then(() => {
          if (settled || aborted) return;
          settled = true;
          resolveCompleted();
        }).catch(fail);
      });
      archive.pipe(destination);
      for (const [index, file] of selectedFiles.entries()) {
        const source = createReadStream(file.path);
        sourceStreams.add(source);
        source.once("close", () => sourceStreams.delete(source));
        source.once("error", (error) => {
          archive.destroy(error);
          fail(error);
        });
        archive.append(source, { name: `${String(index + 1).padStart(6, "0")}.dcm`, store: true });
      }
      void archive.finalize().catch(fail);
      return { completed, abort };
    },
  };
}

function parseStagedDicomSummary(buffer: Buffer): { summary: OrthancStudySummary; seriesInstanceUid: string; sopInstanceUid: string; numberOfFrames?: number } {
  try {
    const dicom = DicomMessage.readFile(buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength)) as { dict: Record<string, unknown>; meta: Record<string, unknown> };
    const dataset = DicomMetaDictionary.naturalizeDataset(dicom.dict) as Record<string, unknown>;
    const summary = readNaturalizedStudySummary(dataset);
    const seriesInstanceUid = readDicomStringValue(dataset.SeriesInstanceUID);
    const sopInstanceUid = readDicomStringValue(dataset.SOPInstanceUID);
    if (!summary.studyInstanceUid || !seriesInstanceUid || !sopInstanceUid) throw new Error("missing_uid");
    const frameCount = Number(readDicomStringValue(dataset.NumberOfFrames));
    return {
      summary,
      seriesInstanceUid,
      sopInstanceUid,
      ...(Number.isInteger(frameCount) && frameCount > 1 ? { numberOfFrames: frameCount } : {}),
    };
  } catch {
    throw new HttpError(400, "DICOM file cannot be parsed.", { code: "DICOM_REMAP_DICOM_PARSE_FAILED" });
  }
}

function normalizeSourceIdentityValue(value: string, field: "patientId" | "patientName" | "patientBirthDate" | "patientSex"): string {
  const collapsed = String(value || "").trim().replace(/\s+/g, " ");
  if (!collapsed) return "";
  if (field === "patientName") return normalizeDicomPatientName(collapsed).split("^").map((part) => part.trim()).join("^").toUpperCase();
  if (field === "patientBirthDate") return normalizeDicomBirthDate(collapsed);
  if (field === "patientSex") return normalizePatientSex(collapsed);
  return collapsed;
}

async function readOrBuildDicomRemapUidPlan({
  manifest,
  directory,
  selectedStudyInstanceUID,
}: {
  manifest: DicomRemapStagingManifest;
  directory: string;
  selectedStudyInstanceUID?: string | null;
}): Promise<{
  plan: PersistedDicomUidPlan;
  originalSummary: OrthancStudySummary;
  validFiles: DicomRemapStagedManifestFile[];
  skippedFiles: number;
  selectionCounts: DicomRemapSelectionCounts;
}> {
  const planPath = path.join(directory, "uid-plan.json");
  const existing = await readFile(planPath, "utf8").catch(() => null);
  if (existing) {
    try {
      const plan = JSON.parse(existing) as PersistedDicomUidPlan;
      if (![1, 2, DICOM_REMAP_UID_PLAN_VERSION].includes(plan.version) || !plan.studyInstanceUid || !plan.seriesInstanceUidByOriginal || !plan.sopInstanceUidByFileId) throw new Error("invalid");
      const validFiles = manifest.files.filter((file) => Boolean(plan.sopInstanceUidByFileId[file.id]));
      if (!validFiles.length) throw new Error("empty");
      const selectionCounts = plan.selectionCounts || {
        totalStagedFiles: manifest.files.length,
        validDicomFiles: validFiles.length,
        selectedStudyFiles: validFiles.length,
        excludedOtherStudyFiles: 0,
        excludedStudyCount: 0,
        skippedOrUnparsedFiles: manifest.files.length - validFiles.length,
      };
      if (manifest.uploadMode === "staged_folder_selected_study" && !plan.selectionCounts) throw new Error("missing_selection_counts");
      const first = parseStagedDicomSummary(await readFile(path.join(directory, validFiles[0]!.relativePath)));
      return {
        plan,
        originalSummary: first.summary,
        validFiles,
        skippedFiles: manifest.files.length - validFiles.length,
        selectionCounts,
      };
    } catch {
      throw new HttpError(409, "DICOM remap UID plan is invalid.", { code: "DICOM_REMAP_UID_PLAN_INVALID" });
    }
  }

  const seriesInstanceUidByOriginal: Record<string, string> = {};
  const sopInstanceUidByFileId: Record<string, string> = {};
  const originalSeriesInstanceUidByFileId: Record<string, string> = {};
  const numberOfFramesByFileId: Record<string, number> = {};
  const fileOutcomes: Record<string, DicomRemapFileOutcome> = {};
  const parsedFiles: Array<{
    file: DicomRemapStagedManifestFile;
    parsed: ReturnType<typeof parseStagedDicomSummary>;
  }> = [];
  const studyUids = new Set<string>();
  for (const [fileIndex, file] of manifest.files.entries()) {
    const fileLabel = dicomRemapFileLabel(fileIndex);
    if (isSkippableDicomRemapFolderEntry(file.displayName) || !isLikelyDicomFile(file.displayName, file.mimeType)) {
      fileOutcomes[file.id] = { fileLabel, category: "skipped_non_dicom", retryCount: 0 };
      continue;
    }
    let parsed: ReturnType<typeof parseStagedDicomSummary>;
    try {
      parsed = parseStagedDicomSummary(await readFile(path.join(directory, file.relativePath)));
    } catch (error) {
      if (error instanceof HttpError && error.statusCode === 400) {
        fileOutcomes[file.id] = { fileLabel, category: "unassigned_likely_dicom", retryCount: 0 };
        continue;
      }
      throw error;
    }
    studyUids.add(parsed.summary.studyInstanceUid);
    parsedFiles.push({ file, parsed });
    originalSeriesInstanceUidByFileId[file.id] = parsed.seriesInstanceUid;
    if (parsed.numberOfFrames) numberOfFramesByFileId[file.id] = parsed.numberOfFrames;
  }
  if (!parsedFiles.length) throw new HttpError(400, "No valid DICOM instances were staged.", { code: "DICOM_REMAP_DICOM_PARSE_FAILED" });

  const selectedStudyMode = manifest.uploadMode === "staged_folder_selected_study";
  const expectedStudyUid = selectedStudyMode
    ? String(selectedStudyInstanceUID || "").trim()
    : String(manifest.selectedStudyInstanceUID || "").trim();
  let selectedFiles = parsedFiles;
  if (selectedStudyMode) {
    const provisionalUid = String(manifest.provisionalSelectedStudyInstanceUID || "").trim();
    if (!expectedStudyUid || expectedStudyUid !== provisionalUid || !studyUids.has(expectedStudyUid)) {
      throw new HttpError(400, "The selected study was not found in durable staging.", {
        code: "DICOM_REMAP_SELECTED_STUDY_NOT_FOUND",
        totalStagedFiles: manifest.files.length,
        validDicomFiles: parsedFiles.length,
        selectedStudyFiles: 0,
        excludedOtherStudyFiles: parsedFiles.length,
        excludedStudyCount: studyUids.size,
        skippedOrUnparsedFiles: manifest.files.length - parsedFiles.length,
        uniqueStudyCount: studyUids.size,
      });
    }
    selectedFiles = parsedFiles.filter(({ parsed }) => parsed.summary.studyInstanceUid === expectedStudyUid);
    for (const { file, parsed } of parsedFiles) {
      if (parsed.summary.studyInstanceUid !== expectedStudyUid) {
        const fileIndex = manifest.files.findIndex((candidate) => candidate.id === file.id);
        fileOutcomes[file.id] = { fileLabel: dicomRemapFileLabel(fileIndex), category: "skipped_other_study", retryCount: 0 };
      }
    }
  } else if (studyUids.size !== 1 || !expectedStudyUid || !studyUids.has(expectedStudyUid)) {
    const code = manifest.uploadMode === "single_study_folder_unverified"
      ? "DICOM_REMAP_MULTIPLE_STUDIES_DETECTED"
      : "DICOM_REMAP_MULTIPLE_STUDIES";
    throw new HttpError(400, "Uploaded files do not match the selected study.", {
      code,
      parsedDicomFileCount: parsedFiles.length,
      uniqueStudyCount: studyUids.size,
    });
  }

  const selectionCounts: DicomRemapSelectionCounts = {
    totalStagedFiles: manifest.files.length,
    validDicomFiles: parsedFiles.length,
    selectedStudyFiles: selectedFiles.length,
    excludedOtherStudyFiles: parsedFiles.length - selectedFiles.length,
    excludedStudyCount: selectedStudyMode ? Math.max(0, studyUids.size - 1) : 0,
    skippedOrUnparsedFiles: manifest.files.length - parsedFiles.length,
  };
  if (!selectedFiles.length) {
    throw new HttpError(400, "The selected study was not found in durable staging.", {
      code: "DICOM_REMAP_SELECTED_STUDY_NOT_FOUND",
      ...selectionCounts,
    });
  }

  const sourceIdentity = {
    patientId: new Set<string>(),
    patientName: new Set<string>(),
    patientBirthDate: new Set<string>(),
    patientSex: new Set<string>(),
  };
  for (const { parsed } of selectedFiles) {
    for (const field of Object.keys(sourceIdentity) as Array<keyof typeof sourceIdentity>) {
      const value = normalizeSourceIdentityValue(parsed.summary[field], field);
      if (value) sourceIdentity[field].add(value);
    }
  }
  const identityDiagnostics = {
    parsedDicomFileCount: selectedFiles.length,
    uniquePatientIdCount: sourceIdentity.patientId.size,
    uniquePatientNameCount: sourceIdentity.patientName.size,
    uniqueBirthDateCount: sourceIdentity.patientBirthDate.size,
    uniqueSexCount: sourceIdentity.patientSex.size,
    ...selectionCounts,
  };
  if (Object.values(sourceIdentity).some((values) => values.size > 1)) {
    throw new HttpError(400, "Uploaded files contain conflicting source-patient identity information.", {
      code: "DICOM_REMAP_SOURCE_IDENTITY_INCONSISTENT",
      ...identityDiagnostics,
    });
  }

  if (selectedStudyMode) {
    const provisional = manifest.provisionalSourceIdentity;
    if (!provisional) {
      throw new HttpError(409, "Provisional source identity is missing.", { code: "DICOM_REMAP_MANIFEST_INVALID" });
    }
    const mismatchedFields = ([
      ["patientId", "patientId"],
      ["patientName", "patientName"],
      ["patientBirthDate", "patientBirthDate"],
      ["patientSex", "patientSex"],
    ] as const).filter(([provisionalField, authoritativeField]) => {
      const provisionalValue = normalizeSourceIdentityValue(provisional[provisionalField], authoritativeField);
      if (!provisionalValue) return false;
      const authoritativeValues = sourceIdentity[authoritativeField];
      return authoritativeValues.size !== 1 || !authoritativeValues.has(provisionalValue);
    });
    if (mismatchedFields.length > 0) {
      throw new HttpError(400, "The verified source identity differs from the preliminary source identity.", {
        code: "DICOM_REMAP_SOURCE_IDENTITY_MISMATCH",
        mismatchFieldCount: mismatchedFields.length,
        ...identityDiagnostics,
      });
    }
  }

  const firstSummary = selectedFiles[0]!.parsed.summary;
  const originalSummary: OrthancStudySummary = {
    studyInstanceUid: firstSummary.studyInstanceUid,
    patientId: Array.from(sourceIdentity.patientId)[0] || "",
    patientName: Array.from(sourceIdentity.patientName)[0] || "",
    patientBirthDate: Array.from(sourceIdentity.patientBirthDate)[0] || "",
    patientSex: Array.from(sourceIdentity.patientSex)[0] || "",
  };
  for (const { file, parsed } of selectedFiles) {
    seriesInstanceUidByOriginal[parsed.seriesInstanceUid] ||= createDicomUid();
    sopInstanceUidByFileId[file.id] = createDicomUid();
  }
  const plan: PersistedDicomUidPlan = {
    version: DICOM_REMAP_UID_PLAN_VERSION,
    studyInstanceUid: createDicomUid(),
    seriesInstanceUidByOriginal,
    sopInstanceUidByFileId,
    selectionCounts,
    fileOutcomes,
    originalSeriesInstanceUidByFileId,
    numberOfFramesByFileId,
  };
  await writePrivateJson(planPath, plan);
  return {
    plan,
    originalSummary,
    validFiles: selectedFiles.map(({ file }) => file),
    skippedFiles: manifest.files.length - selectedFiles.length,
    selectionCounts,
  };
}

async function rewriteStagedDicomForPersistedPlan(file: DicomRemapStagedManifestFile, directory: string, replacement: OrthancPatientSummary, plan: PersistedDicomUidPlan): Promise<Buffer> {
  const raw = await readFile(path.join(directory, file.relativePath));
  const dicom = DicomMessage.readFile(raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.byteLength)) as { dict: Record<string, unknown>; meta: Record<string, unknown> };
  const dataset = DicomMetaDictionary.naturalizeDataset(dicom.dict) as Record<string, unknown>;
  dataset._meta = cloneDicomFileMetaForWriter(dicom.meta);
  const seriesUid = plan.seriesInstanceUidByOriginal[readDicomStringValue(dataset.SeriesInstanceUID)];
  const sopUid = plan.sopInstanceUidByFileId[file.id];
  if (!seriesUid || !sopUid) throw new HttpError(409, "DICOM remap UID plan is invalid.", { code: "DICOM_REMAP_UID_PLAN_INVALID" });
  dataset.PatientID = replacement.patientId;
  dataset.StudyInstanceUID = plan.studyInstanceUid;
  dataset.SeriesInstanceUID = seriesUid;
  dataset.SOPInstanceUID = sopUid;
  updateStructuredMediaStorageSopInstanceUid(dataset._meta as Record<string, unknown>, sopUid);
  let output: Buffer = serializeDicomDatasetForRewrite(dataset);
  if (mutateStagedRewriteBeforeIntegrityForTests) output = mutateStagedRewriteBeforeIntegrityForTests(output);
  assertRewrittenDicomPixelIntegrity(raw, output);
  return output;
}

export async function claimNextDicomRemapProcessingJob(leaseOwner: string, leaseSeconds: number): Promise<{ job: DicomRemapJobRow; recovered: boolean } | null> {
  const safeLeaseSeconds = Math.max(30, Math.min(Math.floor(leaseSeconds), 3600));
  const result = await queryDicomRemapDb<DicomRemapJobRow & { recovered: boolean; previous_status: DicomRemapJobStatus }>(
    `with candidate as (
       select id, status as previous_status
       from dicom_remap_jobs
       where (status = 'uploaded' and processing_stage = 'queued')
          or (status = 'remapped' and processing_stage = 'enqueueing_send')
          or (status = 'processing' and processing_lease_expires_at < now())
       order by created_at asc
       for update skip locked
       limit 1
     )
     update dicom_remap_jobs as job
     set status = 'processing', processing_stage = case when job.status = 'remapped' and job.processing_stage = 'enqueueing_send' then 'enqueueing_send' else 'validating' end, processing_attempt_count = coalesce(job.processing_attempt_count, 0) + 1,
         processing_started_at = coalesce(job.processing_started_at, now()), processing_last_checked_at = now(), processing_last_heartbeat_at = now(),
         processing_lease_owner = $1, processing_lease_expires_at = now() + ($2::text || ' seconds')::interval, updated_at = now()
     from candidate
     where job.id = candidate.id
     returning job.*, candidate.previous_status, (candidate.previous_status = 'processing' or candidate.previous_status = 'remapped') as recovered`,
    [leaseOwner, safeLeaseSeconds]
  );
  const claimed = result.rows[0] || null;
  if (!claimed) return null;
  await logDicomRemapAuditEntry({ entityType: "dicom_remap_job", entityId: claimed.id, actionType: claimed.recovered ? "dicom_remap_processing_recovered" : "dicom_remap_processing_claimed", oldValues: { status: claimed.previous_status }, newValues: { status: "processing", processingStage: claimed.processing_stage, attemptNumber: claimed.processing_attempt_count, recovered: claimed.recovered }, changedByUserId: null });
  return { job: claimed, recovered: Boolean(claimed.recovered) };
}

async function renewDicomRemapProcessingLease(jobId: number, leaseOwner: string, leaseSeconds: number, stage?: string): Promise<boolean> {
  const result = await queryDicomRemapDb<DicomRemapJobRow>(
    `update dicom_remap_jobs set processing_lease_expires_at = now() + ($3::text || ' seconds')::interval, processing_last_heartbeat_at = now(), processing_last_checked_at = now(), processing_stage = coalesce($4, processing_stage), updated_at = now() where id = $1 and status = 'processing' and processing_lease_owner = $2 returning *`,
    [jobId, leaseOwner, Math.max(30, Math.min(Math.floor(leaseSeconds), 3600)), stage || null]
  );
  return Boolean(result.rows[0]);
}

async function requireDicomRemapProcessingLease(jobId: number, leaseOwner: string, leaseSeconds: number, stage?: string): Promise<void> {
  if (await renewDicomRemapProcessingLease(jobId, leaseOwner, leaseSeconds, stage)) return;
  throw new HttpError(409, "DICOM remap processing lease was lost.", { code: "DICOM_REMAP_PROCESSING_LEASE_LOST" });
}

async function updateDicomRemapProcessingProgress(
  jobId: number,
  leaseOwner: string,
  processedFileCount: number,
  skippedFileCount: number,
  leaseSeconds: number,
  selectionCounts?: DicomRemapSelectionCounts
): Promise<void> {
  const result = await queryDicomRemapDb<DicomRemapJobRow>(
    `update dicom_remap_jobs
        set processed_file_count = greatest(coalesce(processed_file_count, 0), $3),
            processing_skipped_file_count = $4,
            processing_selection_counts = coalesce($6::jsonb, processing_selection_counts),
            processing_last_heartbeat_at = now(),
            processing_last_checked_at = now(),
            processing_lease_expires_at = now() + ($5::text || ' seconds')::interval,
            updated_at = now()
      where id = $1 and status = 'processing' and processing_lease_owner = $2
      returning *`,
    [
      jobId,
      leaseOwner,
      processedFileCount,
      skippedFileCount,
      Math.max(30, Math.min(Math.floor(leaseSeconds), 3600)),
      selectionCounts ? JSON.stringify(selectionCounts) : null,
    ]
  );
  if (!result.rows[0]) throw new HttpError(409, "DICOM remap processing lease was lost.", { code: "DICOM_REMAP_PROCESSING_LEASE_LOST" });
}

function orthancUploadStatus(payload: unknown): string {
  return payload && typeof payload === "object" ? String((payload as Record<string, unknown>).Status || "").trim().toLowerCase() : "";
}

function isTransientOrthancStatus(status: number): boolean {
  return status === 502 || status === 503 || status === 504 || status >= 500;
}

async function verifyStoredReplacementInstance(instanceId: string, expectedStudyId: string | null, expectedStudyUid: string, expectedSopUid: string): Promise<string> {
  const instance = await fetchOrthancForRemap(`/instances/${encodeURIComponent(instanceId)}`, { method: "GET" });
  if (!instance.ok || !instance.json || typeof instance.json !== "object") {
    throw new HttpError(502, "Orthanc could not verify an existing instance.", { code: "DICOM_REMAP_ORTHANC_INSTANCE_CONFLICT", orthancStatus: instance.status });
  }
  const identifiers = parseOrthancUploadResponse(instance.json);
  const parentStudyId = identifiers.parentStudyIds[0] || "";
  if (!parentStudyId || (expectedStudyId && parentStudyId !== expectedStudyId)) {
    throw new HttpError(409, "Orthanc existing instance belongs to an unexpected study.", { code: "DICOM_REMAP_ORTHANC_INSTANCE_CONFLICT" });
  }
  const tags = await fetchOrthancForRemap(`/instances/${encodeURIComponent(instanceId)}/simplified-tags`, { method: "GET" });
  const record = tags.ok && tags.json && typeof tags.json === "object" ? tags.json as Record<string, unknown> : null;
  if (!record || readDicomStringValue(record.StudyInstanceUID) !== expectedStudyUid || readDicomStringValue(record.SOPInstanceUID) !== expectedSopUid) {
    throw new HttpError(409, "Orthanc existing instance identity does not match the expected replacement instance.", { code: "DICOM_REMAP_ORTHANC_INSTANCE_CONFLICT" });
  }
  return parentStudyId;
}

async function uploadPersistedRemappedInstance(
  body: Buffer,
  fileIndex: number,
  expectedStudyUid?: string,
  expectedSopUid?: string,
  expectedStudyId: string | null = null,
): Promise<{ studyId: string; instanceId: string; category: "processed" | "already_stored"; retryCount: number; httpStatus: number; responseShape: string }> {
  let lastResponse: OrthancFetchResult | null = null;
  for (let attempt = 0; attempt <= DICOM_REMAP_UPLOAD_MAX_RETRIES; attempt += 1) {
    let response: OrthancFetchResult;
    try {
      response = await fetchOrthancForRemap("/instances", { method: "POST", body, contentType: "application/dicom", timeoutSeconds: REMAP_ORTHANC_OPERATION_TIMEOUT_SECONDS });
    } catch (error) {
      const details = error instanceof HttpError ? error.details as { code?: string } | undefined : undefined;
      if (details?.code === "ORTHANC_INFRASTRUCTURE_UNAVAILABLE") throw error;
      if (attempt < DICOM_REMAP_UPLOAD_MAX_RETRIES) {
        await sleepForDicomRemap(100 * (attempt + 1));
        continue;
      }
      throw new HttpError(502, "Orthanc transient upload retries were exhausted.", { code: "DICOM_REMAP_ORTHANC_UPLOAD_RETRY_EXHAUSTED", fileIndex, retryCount: attempt });
    }
    lastResponse = response;
    if (response.status === 401 || response.status === 403) {
      throw new HttpError(502, "Orthanc authentication or authorization failed.", { code: "DICOM_REMAP_ORTHANC_AUTH_FAILED", orthancStatus: response.status });
    }
    if (!response.ok && isTransientOrthancStatus(response.status)) {
      if (attempt < DICOM_REMAP_UPLOAD_MAX_RETRIES) {
        await sleepForDicomRemap(100 * (attempt + 1));
        continue;
      }
      throw new HttpError(502, "Orthanc transient upload retries were exhausted.", { code: "DICOM_REMAP_ORTHANC_UPLOAD_RETRY_EXHAUSTED", fileIndex, retryCount: attempt, orthancStatus: response.status, responseShape: describeOrthancPayloadShape(response.json) });
    }
    const identifiers = parseOrthancUploadResponse(response.json);
    const instanceId = identifiers.instanceIds[0] || "";
    const studyId = identifiers.parentStudyIds[0] || "";
    const alreadyStored = orthancUploadStatus(response.json) === "alreadystored";
    if (alreadyStored || response.status === 409) {
      if (!instanceId || !expectedStudyUid || !expectedSopUid) throw new HttpError(409, "Orthanc duplicate response was not conclusive.", { code: "DICOM_REMAP_ORTHANC_INSTANCE_CONFLICT" });
      const verifiedStudyId = await verifyStoredReplacementInstance(instanceId, expectedStudyId || studyId || null, expectedStudyUid, expectedSopUid);
      return { studyId: verifiedStudyId, instanceId, category: "already_stored", retryCount: attempt, httpStatus: response.status, responseShape: describeOrthancPayloadShape(response.json) };
    }
    if (!response.ok) {
      throw new HttpError(400, "Orthanc permanently rejected one remapped DICOM instance.", { code: "DICOM_REMAP_ORTHANC_FILE_REJECTED", fileIndex, orthancStatus: response.status, responseShape: describeOrthancPayloadShape(response.json) });
    }
    if (!studyId || !instanceId) throw new HttpError(502, "Orthanc did not identify the uploaded remapped instance.", { code: "DICOM_REMAP_ORTHANC_UPLOAD_FAILED", responseShape: describeOrthancPayloadShape(response.json) });
    return { studyId, instanceId, category: "processed", retryCount: attempt, httpStatus: response.status, responseShape: describeOrthancPayloadShape(response.json) };
  }
  throw new HttpError(502, "Orthanc upload failed.", { code: "DICOM_REMAP_ORTHANC_UPLOAD_FAILED", orthancStatus: lastResponse?.status });
}

function buildDicomRemapOutcomeSummary(plan: PersistedDicomUidPlan, base: DicomRemapSelectionCounts): DicomRemapSelectionCounts {
  const outcomes = Object.values(plan.fileOutcomes || {});
  const accepted = outcomes.filter(isAcceptedDicomRemapOutcome);
  const acceptedSops = new Set(accepted.map((outcome) => outcome.replacementSopInstanceUid).filter(Boolean));
  const failed = outcomes.filter((outcome) => ["skipped_unparseable", "skipped_missing_identity", "upload_failed_retryable", "upload_failed_permanent"].includes(outcome.category));
  const unassigned = outcomes.filter((outcome) => outcome.category === "unassigned_likely_dicom");
  const series = new Map<string, { accepted: Set<string>; failed: number }>();
  for (const outcome of outcomes) {
    const uid = outcome.replacementSeriesInstanceUid;
    if (!uid) continue;
    const entry = series.get(uid) || { accepted: new Set<string>(), failed: 0 };
    if (isAcceptedDicomRemapOutcome(outcome) && outcome.replacementSopInstanceUid) entry.accepted.add(outcome.replacementSopInstanceUid);
    if (["skipped_unparseable", "skipped_missing_identity", "upload_failed_retryable", "upload_failed_permanent"].includes(outcome.category)) entry.failed += 1;
    series.set(uid, entry);
  }
  const seriesOutcomes = Array.from(series.entries()).map(([seriesInstanceUid, entry]) => ({
    seriesInstanceUid,
    acceptedUniqueInstances: entry.accepted.size,
    failedInstances: entry.failed,
    zeroAcceptedAfterFailures: entry.failed > 0 && entry.accepted.size === 0,
  }));
  return {
    ...base,
    acceptedUniqueInstances: acceptedSops.size,
    processedInstances: outcomes.filter((outcome) => outcome.category === "processed").length,
    alreadyStoredInstances: outcomes.filter((outcome) => outcome.category === "already_stored").length,
    failedSelectedStudyFiles: failed.length,
    unassignedLikelyDicomFiles: unassigned.length,
    partial: failed.length > 0,
    completenessUncertain: unassigned.length > 0,
    completeSeriesLossCount: seriesOutcomes.filter((entry) => entry.zeroAcceptedAfterFailures).length,
    failedMultiframeObjectCount: failed.filter((outcome) => Number(outcome.numberOfFrames) > 1).length,
    failureSample: [...failed, ...unassigned].slice(0, DICOM_REMAP_FAILURE_SAMPLE_LIMIT).map(({ fileLabel, category }) => ({ fileLabel, category })),
    seriesOutcomes,
  };
}

async function probeOrthancHealthForRemap(): Promise<boolean> {
  try {
    const response = await fetchOrthancForRemap("/system", { method: "GET", timeoutSeconds: Math.min(10, REMAP_ORTHANC_OPERATION_TIMEOUT_SECONDS) });
    if (response.status === 401 || response.status === 403) throw new HttpError(502, "Orthanc authentication or authorization failed.", { code: "DICOM_REMAP_ORTHANC_AUTH_FAILED" });
    return response.ok && Boolean(response.json && typeof response.json === "object");
  } catch (error) {
    const code = error instanceof HttpError ? String((error.details as { code?: unknown } | null)?.code || "") : "";
    if (code === "DICOM_REMAP_ORTHANC_AUTH_FAILED" || code === "ORTHANC_INFRASTRUCTURE_UNAVAILABLE") throw error;
    return false;
  }
}

type OrthancVerificationReason = "STUDY_NOT_FOUND" | "STUDY_RESPONSE_MALFORMED" | "STUDY_INSTANCE_ENUMERATION_UNSUPPORTED" | "STUDY_INSTANCE_LIST_MISSING" | "STUDY_NOT_STABLE" | "ZERO_INSTANCES" | "EXPECTED_ACTUAL_COUNT_MISMATCH" | "INSTANCE_SOP_UID_UNREADABLE" | "SOP_SET_MISMATCH" | "STUDY_UID_MISMATCH" | "MULTIPLE_MODIFIED_STUDIES";
type OrthancEnumerationMethod = "direct" | "series";
type OrthancVerificationDetails = {
  code: "DICOM_REMAP_ORTHANC_VERIFICATION_FAILED";
  verificationReason: OrthancVerificationReason;
  expectedCount?: number;
  actualCount?: number;
  seriesCount?: number;
  enumerationMethod?: OrthancEnumerationMethod;
  orthancProduct?: string;
  orthancVersion?: string;
  studyResponseShape?: string;
  statisticsResponseShape?: string;
  instancesResponseShape?: string;
};

function orthancVerificationError(message: string, details: Omit<OrthancVerificationDetails, "code">): HttpError {
  return new HttpError(502, message, { code: "DICOM_REMAP_ORTHANC_VERIFICATION_FAILED", ...details });
}

function readOrthancResourceId(value: unknown): string {
  if (typeof value === "string" || typeof value === "number") return String(value).trim();
  if (!value || typeof value !== "object" || Array.isArray(value)) return "";
  const row = value as Record<string, unknown>;
  return readDicomStringValue(row.ID ?? row.Id ?? row.id);
}

function readExpandedOrthancSop(value: unknown): string {
  if (!value || typeof value !== "object" || Array.isArray(value)) return "";
  const row = value as Record<string, unknown>;
  const tags = row.MainDicomTags && typeof row.MainDicomTags === "object" && !Array.isArray(row.MainDicomTags) ? row.MainDicomTags as Record<string, unknown> : {};
  return readDicomStringValue(row.SOPInstanceUID ?? tags.SOPInstanceUID ?? tags["00080018"]);
}

function parseOrthancInstanceChildren(payload: unknown): { ids: string[]; sopsById: Map<string, string> } | null {
  if (!Array.isArray(payload)) return null;
  const ids: string[] = [];
  const sopsById = new Map<string, string>();
  for (const value of payload) {
    const id = readOrthancResourceId(value);
    if (!id) return null;
    ids.push(id);
    const sop = readExpandedOrthancSop(value);
    if (sop) sopsById.set(id, sop);
  }
  return { ids: Array.from(new Set(ids)), sopsById };
}

async function listOrthancStudyInstanceIds(studyId: string, studyPayload: Record<string, unknown>, baseDetails: Omit<OrthancVerificationDetails, "code" | "verificationReason">): Promise<{ ids: string[]; sopsById: Map<string, string>; method: OrthancEnumerationMethod; details: Omit<OrthancVerificationDetails, "code" | "verificationReason"> }> {
  const direct = await fetchOrthancForRemap(`/studies/${encodeURIComponent(studyId)}/instances`, { method: "GET" });
  const directShape = describeOrthancPayloadShape(direct.json);
  if (direct.ok) {
    const parsed = parseOrthancInstanceChildren(direct.json);
    if (!parsed) throw orthancVerificationError("Orthanc returned a malformed study instance list.", { ...baseDetails, enumerationMethod: "direct", instancesResponseShape: directShape, verificationReason: "STUDY_RESPONSE_MALFORMED" });
    return { ...parsed, method: "direct", details: { ...baseDetails, enumerationMethod: "direct", instancesResponseShape: directShape } };
  }
  if (![404, 405].includes(direct.status)) throw orthancVerificationError("Orthanc study instance enumeration failed.", { ...baseDetails, enumerationMethod: "direct", instancesResponseShape: directShape, verificationReason: "STUDY_INSTANCE_ENUMERATION_UNSUPPORTED" });

  const series = studyPayload.Series;
  if (!Array.isArray(series)) throw orthancVerificationError("Orthanc study response did not include a series list.", { ...baseDetails, enumerationMethod: "series", instancesResponseShape: directShape, verificationReason: "STUDY_INSTANCE_LIST_MISSING" });
  const seriesIds = series.map(readOrthancResourceId);
  if (seriesIds.some((id) => !id)) throw orthancVerificationError("Orthanc study response contained a malformed series list.", { ...baseDetails, seriesCount: series.length, enumerationMethod: "series", instancesResponseShape: directShape, verificationReason: "STUDY_RESPONSE_MALFORMED" });
  const ids = new Set<string>();
  const sopsById = new Map<string, string>();
  const shapes: string[] = [];
  for (const seriesId of seriesIds) {
    let response = await fetchOrthancForRemap(`/series/${encodeURIComponent(seriesId)}/instances`, { method: "GET" });
    const useSeriesResource = [404, 405].includes(response.status);
    if (useSeriesResource) response = await fetchOrthancForRemap(`/series/${encodeURIComponent(seriesId)}`, { method: "GET" });
    if (useSeriesResource && response.ok && response.json && typeof response.json === "object" && !Array.isArray(response.json) && !Array.isArray((response.json as Record<string, unknown>).Instances)) {
      shapes.push(describeOrthancPayloadShape(response.json));
      throw orthancVerificationError("Orthanc series response did not include an instance list.", { ...baseDetails, seriesCount: series.length, enumerationMethod: "series", instancesResponseShape: shapes.join(";"), verificationReason: "STUDY_INSTANCE_LIST_MISSING" });
    }
    const payload = response.ok && response.json && typeof response.json === "object" && !Array.isArray(response.json) && !Array.isArray((response.json as Record<string, unknown>).Instances)
      ? null
      : response.ok && !Array.isArray(response.json) ? (response.json as Record<string, unknown>).Instances : response.json;
    shapes.push(describeOrthancPayloadShape(response.json));
    if (!response.ok) throw orthancVerificationError("Orthanc series instance enumeration is unsupported.", { ...baseDetails, seriesCount: series.length, enumerationMethod: "series", instancesResponseShape: shapes.join(";"), verificationReason: "STUDY_INSTANCE_ENUMERATION_UNSUPPORTED" });
    const parsed = parseOrthancInstanceChildren(payload);
    if (!parsed) throw orthancVerificationError("Orthanc returned a malformed series instance list.", { ...baseDetails, seriesCount: series.length, enumerationMethod: "series", instancesResponseShape: shapes.join(";"), verificationReason: "STUDY_RESPONSE_MALFORMED" });
    for (const id of parsed.ids) ids.add(id);
    for (const [id, sop] of parsed.sopsById) sopsById.set(id, sop);
  }
  return { ids: Array.from(ids), sopsById, method: "series", details: { ...baseDetails, seriesCount: series.length, enumerationMethod: "series", instancesResponseShape: shapes.join(";") } };
}

async function mapWithConcurrency<T, R>(values: T[], concurrency: number, work: (value: T) => Promise<R>): Promise<R[]> {
  const results = new Array<R>(values.length);
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(concurrency, values.length) }, async () => {
    while (next < values.length) {
      const index = next++;
      results[index] = await work(values[index]!);
    }
  }));
  return results;
}

async function verifyOrthancStudyAcceptedSopSet(studyId: string, expectedSops: Set<string>, options: { renewLease?: () => Promise<void>; stabilityTimeoutSeconds?: number } = {}): Promise<Omit<OrthancVerificationDetails, "code" | "verificationReason">> {
  const system = await fetchOrthancForRemap("/system", { method: "GET" }).catch(() => null);
  const systemRow = system?.ok && system.json && typeof system.json === "object" && !Array.isArray(system.json) ? system.json as Record<string, unknown> : {};
  const systemDetails = { orthancProduct: readDicomStringValue(systemRow.Name ?? systemRow.Product), orthancVersion: readDicomStringValue(systemRow.Version) };
  const timeoutSeconds = readDicomRemapPositiveLimit(options.stabilityTimeoutSeconds, DICOM_REMAP_ORTHANC_STABILITY_TIMEOUT_SECONDS);
  let studyPayload: Record<string, unknown> | null = null;
  let studyShape = "null";
  let elapsedSeconds = 0;
  await options.renewLease?.();
  while (true) {
    const study = await fetchOrthancForRemap(`/studies/${encodeURIComponent(studyId)}`, { method: "GET" });
    studyShape = describeOrthancPayloadShape(study.json);
    if (study.status === 404) throw orthancVerificationError("Orthanc remapped study was not found.", { ...systemDetails, expectedCount: expectedSops.size, studyResponseShape: studyShape, verificationReason: "STUDY_NOT_FOUND" });
    if (!study.ok || !study.json || typeof study.json !== "object" || Array.isArray(study.json)) throw orthancVerificationError("Orthanc remapped study response was malformed.", { ...systemDetails, expectedCount: expectedSops.size, studyResponseShape: studyShape, verificationReason: "STUDY_RESPONSE_MALFORMED" });
    studyPayload = study.json as Record<string, unknown>;
    if (studyPayload.IsStable !== false) break;
    if (elapsedSeconds >= timeoutSeconds) throw orthancVerificationError("Orthanc remapped study did not become stable in time.", { ...systemDetails, expectedCount: expectedSops.size, seriesCount: Array.isArray(studyPayload.Series) ? studyPayload.Series.length : undefined, studyResponseShape: studyShape, verificationReason: "STUDY_NOT_STABLE" });
    await sleepForDicomRemap(DICOM_REMAP_ORTHANC_STABILITY_POLL_MS);
    elapsedSeconds += 1;
    if (elapsedSeconds % DICOM_REMAP_ORTHANC_LEASE_RENEWAL_INTERVAL_SECONDS === 0) await options.renewLease?.();
  }
  await options.renewLease?.();
  const statistics = await fetchOrthancForRemap(`/studies/${encodeURIComponent(studyId)}/statistics`, { method: "GET" }).catch(() => null);
  const baseDetails = { ...systemDetails, expectedCount: expectedSops.size, seriesCount: Array.isArray(studyPayload.Series) ? studyPayload.Series.length : undefined, studyResponseShape: studyShape, statisticsResponseShape: statistics ? describeOrthancPayloadShape(statistics.json) : "unavailable" };
  const enumerated = await listOrthancStudyInstanceIds(studyId, studyPayload, baseDetails);
  const actualCount = enumerated.ids.length;
  const details = { ...enumerated.details, expectedCount: expectedSops.size, actualCount };
  if (actualCount === 0) throw orthancVerificationError("Orthanc remapped study contained no instances.", { ...details, verificationReason: "ZERO_INSTANCES" });
  if (actualCount !== expectedSops.size) throw orthancVerificationError("Orthanc did not verify the expected unique remapped instance count.", { ...details, verificationReason: "EXPECTED_ACTUAL_COUNT_MISMATCH" });
  const sops = await mapWithConcurrency(enumerated.ids, DICOM_REMAP_ORTHANC_SOP_READ_CONCURRENCY, async (instanceId) => {
    const expanded = enumerated.sopsById.get(instanceId);
    if (expanded) return expanded;
    const tags = await fetchOrthancForRemap(`/instances/${encodeURIComponent(instanceId)}/simplified-tags`, { method: "GET" }).catch(() => null);
    if (!tags) return "";
    return tags.ok && tags.json && typeof tags.json === "object" && !Array.isArray(tags.json) ? readDicomStringValue((tags.json as Record<string, unknown>).SOPInstanceUID) : "";
  });
  if (sops.some((sop) => !sop)) throw orthancVerificationError("Orthanc instance identity could not be verified.", { ...details, verificationReason: "INSTANCE_SOP_UID_UNREADABLE" });
  const actualSops = new Set(sops);
  if (actualSops.size !== expectedSops.size || Array.from(expectedSops).some((uid) => !actualSops.has(uid))) throw orthancVerificationError("Orthanc remapped SOP Instance UID set does not match accepted outcomes.", { ...details, verificationReason: "SOP_SET_MISMATCH" });
  return details;
}

export async function processClaimedDicomRemapJob({ job, leaseOwner, leaseSeconds }: { job: DicomRemapJobRow; leaseOwner: string; leaseSeconds: number }): Promise<DicomRemapJobRow> {
  try {
    if (job.processing_stage === "enqueueing_send" && job.modified_orthanc_study_id) {
      await requireDicomRemapProcessingLease(job.id, leaseOwner, leaseSeconds, "enqueueing_send");
      const remapped = await queryDicomRemapDb<DicomRemapJobRow>(
        `update dicom_remap_jobs set status = 'remapped', processing_lease_owner = null, processing_lease_expires_at = null, updated_at = now() where id = $1 and status = 'processing' and processing_lease_owner = $2 returning *`,
        [job.id, leaseOwner]
      );
      const remappedJob = remapped.rows[0];
      if (!remappedJob) throw new HttpError(409, "DICOM remap processing lease was lost.", { code: "DICOM_REMAP_PROCESSING_LEASE_LOST" });
      return (await sendExistingDicomRemapJobToDestination({ job: remappedJob, currentUserId: remappedJob.created_by_user_id, auditActionType: "pacs_send_enqueued" })).job;
    }
    await requireDicomRemapProcessingLease(job.id, leaseOwner, leaseSeconds, "validating");
    const staged = await loadDicomRemapStagingManifest(job);
    const patientId = job.rispro_patient_id;
    const destination = String(job.destination_pacs_key || "").trim();
    if (!patientId || !destination) throw new HttpError(409, "DICOM remap processing inputs are missing.", { code: "DICOM_REMAP_MANIFEST_INVALID" });
    const patient = await getPatientForDicomRemap(patientId);
    const replacement = formatReplacementFromPatient(patient);
    if (!replacement.patientId || !replacement.patientName) throw new HttpError(409, "Replacement identity is unavailable.", { code: "DICOM_REMAP_IDENTITY_VERIFICATION_FAILED" });
    const modalities = await listModalitiesForDicomRemap();
    if (!modalities.modalities.some((item) => item.key === destination)) throw new HttpError(409, "PACS destination is unavailable.", { code: "DICOM_REMAP_MANIFEST_INVALID" });

    await requireDicomRemapProcessingLease(job.id, leaseOwner, leaseSeconds, "building_uid_plan");
    const planned = await readOrBuildDicomRemapUidPlan({
      ...staged,
      selectedStudyInstanceUID: job.selected_study_instance_uid,
    });
    await updateDicomRemapProcessingProgress(job.id, leaseOwner, 0, planned.skippedFiles, leaseSeconds, planned.selectionCounts);

    const studyIds = new Set<string>();
    const uidPlanPath = path.join(staged.directory, "uid-plan.json");
    planned.plan.fileOutcomes ||= {};
    let consecutiveExhaustedTransientFiles = 0;
    for (const [index, file] of planned.validFiles.entries()) {
      const fileIndex = staged.manifest.files.findIndex((candidate) => candidate.id === file.id);
      const fileLabel = dicomRemapFileLabel(fileIndex);
      const replacementSeriesInstanceUid = planned.plan.seriesInstanceUidByOriginal[planned.plan.originalSeriesInstanceUidByFileId?.[file.id] || ""];
      const replacementSopInstanceUid = planned.plan.sopInstanceUidByFileId[file.id];
      const existingOutcome = planned.plan.fileOutcomes[file.id];
      if (isAcceptedDicomRemapOutcome(existingOutcome)) {
        if (existingOutcome?.orthancStudyId) studyIds.add(existingOutcome.orthancStudyId);
        continue;
      }
      await requireDicomRemapProcessingLease(job.id, leaseOwner, leaseSeconds, "rewriting");
      let body: Buffer;
      try {
        body = await rewriteStagedDicomForPersistedPlan(file, staged.directory, replacement, planned.plan);
      } catch (error) {
        if (["DICOM_REMAP_PIXEL_INTEGRITY_FAILED", "DICOM_REMAP_DICOM_REWRITE_FAILED"].includes(processingErrorCode(error))) throw error;
        planned.plan.fileOutcomes[file.id] = {
          fileLabel,
          category: replacementSopInstanceUid ? "skipped_unparseable" : "skipped_missing_identity",
          retryCount: 0,
          ...(replacementSeriesInstanceUid ? { replacementSeriesInstanceUid } : {}),
          ...(replacementSopInstanceUid ? { replacementSopInstanceUid } : {}),
          ...(planned.plan.numberOfFramesByFileId?.[file.id] ? { numberOfFrames: planned.plan.numberOfFramesByFileId[file.id] } : {}),
        };
        await writePrivateJson(uidPlanPath, planned.plan);
        continue;
      }
      await requireDicomRemapProcessingLease(job.id, leaseOwner, leaseSeconds, "uploading_to_orthanc");
      try {
        const uploaded = await uploadPersistedRemappedInstance(body, index + 1, planned.plan.studyInstanceUid, replacementSopInstanceUid, studyIds.size === 1 ? Array.from(studyIds)[0]! : null);
        studyIds.add(uploaded.studyId);
        consecutiveExhaustedTransientFiles = 0;
        planned.plan.fileOutcomes[file.id] = {
          fileLabel,
          category: uploaded.category,
          retryCount: uploaded.retryCount,
          httpStatus: uploaded.httpStatus,
          responseShape: uploaded.responseShape,
          orthancInstanceId: uploaded.instanceId,
          orthancStudyId: uploaded.studyId,
          replacementSeriesInstanceUid,
          replacementSopInstanceUid,
          ...(planned.plan.numberOfFramesByFileId?.[file.id] ? { numberOfFrames: planned.plan.numberOfFramesByFileId[file.id] } : {}),
        };
        await writePrivateJson(uidPlanPath, planned.plan);
        if (afterRemappedInstanceUploadForTests) await afterRemappedInstanceUploadForTests({ jobId: job.id, fileIndex: index + 1, studyId: uploaded.studyId, body });
      } catch (error) {
        const code = error instanceof HttpError ? String((error.details as { code?: unknown } | null)?.code || "") : "";
        if (["DICOM_REMAP_ORTHANC_AUTH_FAILED", "ORTHANC_INFRASTRUCTURE_UNAVAILABLE", "DICOM_REMAP_ORTHANC_INSTANCE_CONFLICT"].includes(code)) throw error;
        const retryable = code === "DICOM_REMAP_ORTHANC_UPLOAD_RETRY_EXHAUSTED";
        planned.plan.fileOutcomes[file.id] = {
          fileLabel,
          category: retryable ? "upload_failed_retryable" : "upload_failed_permanent",
          retryCount: retryable ? DICOM_REMAP_UPLOAD_MAX_RETRIES : 0,
          ...(error instanceof HttpError && Number((error.details as { orthancStatus?: unknown } | null)?.orthancStatus) ? { httpStatus: Number((error.details as { orthancStatus?: unknown }).orthancStatus) } : {}),
          ...(replacementSeriesInstanceUid ? { replacementSeriesInstanceUid } : {}),
          ...(replacementSopInstanceUid ? { replacementSopInstanceUid } : {}),
          ...(planned.plan.numberOfFramesByFileId?.[file.id] ? { numberOfFrames: planned.plan.numberOfFramesByFileId[file.id] } : {}),
        };
        await writePrivateJson(uidPlanPath, planned.plan);
        if (retryable) {
          consecutiveExhaustedTransientFiles += 1;
          if (consecutiveExhaustedTransientFiles >= 2) {
            if (!await probeOrthancHealthForRemap()) throw new HttpError(502, "Orthanc is unavailable after repeated upload failures.", { code: "DICOM_REMAP_ORTHANC_INFRASTRUCTURE_FAILURE" });
            consecutiveExhaustedTransientFiles = 0;
          }
        }
      }
      const interim = buildDicomRemapOutcomeSummary(planned.plan, planned.selectionCounts);
      await updateDicomRemapProcessingProgress(job.id, leaseOwner, interim.acceptedUniqueInstances || 0, planned.skippedFiles, leaseSeconds, interim);
    }
    const finalSelectionCounts = buildDicomRemapOutcomeSummary(planned.plan, planned.selectionCounts);
    if ((finalSelectionCounts.failedMultiframeObjectCount || 0) > 0) throw new HttpError(409, "A selected multiframe DICOM object failed processing; the study cannot be sent.", { code: "DICOM_REMAP_MULTIFRAME_OBJECT_FAILED", ...finalSelectionCounts });
    if ((finalSelectionCounts.acceptedUniqueInstances || 0) === 0) throw new HttpError(400, "No valid selected-study instances remain.", { code: "DICOM_REMAP_DICOM_PARSE_FAILED", ...finalSelectionCounts });
    if (studyIds.size !== 1) throw orthancVerificationError("Orthanc produced an unexpected remapped study set.", { verificationReason: "MULTIPLE_MODIFIED_STUDIES", expectedCount: finalSelectionCounts.acceptedUniqueInstances || 0, actualCount: studyIds.size });
    const modifiedStudyId = Array.from(studyIds)[0]!;

    await requireDicomRemapProcessingLease(job.id, leaseOwner, leaseSeconds, "verifying_orthanc");
    const acceptedSops = new Set(Object.values(planned.plan.fileOutcomes).filter(isAcceptedDicomRemapOutcome).map((outcome) => outcome.replacementSopInstanceUid).filter((uid): uid is string => Boolean(uid)));
    const verificationDetails = await verifyOrthancStudyAcceptedSopSet(modifiedStudyId, acceptedSops, { renewLease: async () => { await requireDicomRemapProcessingLease(job.id, leaseOwner, leaseSeconds, "verifying_orthanc"); } });
    const summary = await readStudySummary(modifiedStudyId).catch(() => {
      throw orthancVerificationError("Orthanc remapped study could not be read for verification.", { ...verificationDetails, verificationReason: "STUDY_RESPONSE_MALFORMED" });
    });
    if (summary.studyInstanceUid !== planned.plan.studyInstanceUid) throw orthancVerificationError("Orthanc did not preserve the persisted replacement Study UID.", { ...verificationDetails, verificationReason: "STUDY_UID_MISMATCH" });
    if (!hasExpectedRemappedPatientId(summary, replacement.patientId)) throw new HttpError(502, "Orthanc did not verify replacement PatientID.", { code: "DICOM_REMAP_IDENTITY_VERIFICATION_FAILED" });

    const requiresAcknowledgement = Boolean(finalSelectionCounts.partial || finalSelectionCounts.completenessUncertain);

    if (beforeDicomRemapProcessingCompletionForTests) await beforeDicomRemapProcessingCompletionForTests();

    const remapped = await queryDicomRemapDb<DicomRemapJobRow>(
      `update dicom_remap_jobs set status = $13, processing_stage = $14, source_orthanc_study_id = $3, modified_orthanc_study_id = $3, original_patient_id = $4, original_patient_name = $5, original_patient_sex = $6, original_patient_birth_date = $7, replacement_patient_id = $8, replacement_patient_name = $9, replacement_patient_sex = $10, replacement_patient_birth_date = $11, processed_file_count = $15, processing_selection_counts = $12::jsonb, processing_completed_at = now(), processing_last_heartbeat_at = now(), processing_lease_owner = null, processing_lease_expires_at = null, processing_error_code = null, processing_error_details = null, dicom_integrity_version = $16, dicom_integrity_verified_at = now(), orthanc_recovery_status = 'none', orthanc_recovery_expires_at = null, error_message = null, updated_at = now() where id = $1 and status = 'processing' and processing_lease_owner = $2 returning *`,
      [job.id, leaseOwner, modifiedStudyId, planned.originalSummary.patientId, planned.originalSummary.patientName, planned.originalSummary.patientSex, planned.originalSummary.patientBirthDate, replacement.patientId, replacement.patientName, replacement.patientSex, replacement.patientBirthDate, JSON.stringify(finalSelectionCounts), requiresAcknowledgement ? "awaiting_confirmation" : "remapped", requiresAcknowledgement ? "awaiting_send_confirmation" : "enqueueing_send", acceptedSops.size, DICOM_REMAP_INTEGRITY_VERSION]
    );
    const remappedJob = remapped.rows[0];
    if (!remappedJob) throw new HttpError(409, "DICOM remap processing lease was lost.", { code: "DICOM_REMAP_PROCESSING_LEASE_LOST" });
    await logDicomRemapAuditEntry({ entityType: "dicom_remap_job", entityId: remappedJob.id, actionType: "dicom_remap_processing_completed", oldValues: { status: "processing" }, newValues: { status: remappedJob.status, processingStage: remappedJob.processing_stage, processedFileCount: acceptedSops.size, skippedFileCount: planned.skippedFiles, selectionCounts: finalSelectionCounts, modifiedOrthancStudyId: modifiedStudyId }, changedByUserId: null });
    if (requiresAcknowledgement) return remappedJob;
    const sending = await sendExistingDicomRemapJobToDestination({ job: remappedJob, currentUserId: remappedJob.created_by_user_id, auditActionType: "pacs_send_enqueued" });
    return sending.job;
  } catch (error) {
    const code = processingErrorCode(error);
    const details = error instanceof HttpError && error.details && typeof error.details === "object"
      ? error.details as {
        parsedDicomFileCount?: unknown;
        uniqueStudyCount?: unknown;
        uniquePatientIdCount?: unknown;
        uniquePatientNameCount?: unknown;
        uniqueBirthDateCount?: unknown;
        uniqueSexCount?: unknown;
        mismatchFieldCount?: unknown;
        totalStagedFiles?: unknown;
        validDicomFiles?: unknown;
        selectedStudyFiles?: unknown;
        excludedOtherStudyFiles?: unknown;
        excludedStudyCount?: unknown;
        skippedOrUnparsedFiles?: unknown;
        verificationReason?: unknown;
        expectedCount?: unknown;
        actualCount?: unknown;
        seriesCount?: unknown;
        enumerationMethod?: unknown;
        orthancProduct?: unknown;
        orthancVersion?: unknown;
        studyResponseShape?: unknown;
        statisticsResponseShape?: unknown;
        instancesResponseShape?: unknown;
        sourceTransferSyntax?: unknown;
        outputTransferSyntax?: unknown;
        sourcePixelLength?: unknown;
        outputPixelLength?: unknown;
        failedInvariant?: unknown;
        orthancError?: unknown;
      }
      : null;
    const numericDiagnostic = (value: unknown) => Number.isInteger(value) && Number(value) >= 0 ? Number(value) : undefined;
    const processingDiagnostics = {
      code,
      ...(numericDiagnostic(details?.parsedDicomFileCount) !== undefined ? { parsedDicomFileCount: numericDiagnostic(details?.parsedDicomFileCount) } : {}),
      ...(numericDiagnostic(details?.uniqueStudyCount) !== undefined ? { uniqueStudyCount: numericDiagnostic(details?.uniqueStudyCount) } : {}),
      ...(numericDiagnostic(details?.uniquePatientIdCount) !== undefined ? { uniquePatientIdCount: numericDiagnostic(details?.uniquePatientIdCount) } : {}),
      ...(numericDiagnostic(details?.uniquePatientNameCount) !== undefined ? { uniquePatientNameCount: numericDiagnostic(details?.uniquePatientNameCount) } : {}),
      ...(numericDiagnostic(details?.uniqueBirthDateCount) !== undefined ? { uniqueBirthDateCount: numericDiagnostic(details?.uniqueBirthDateCount) } : {}),
      ...(numericDiagnostic(details?.uniqueSexCount) !== undefined ? { uniqueSexCount: numericDiagnostic(details?.uniqueSexCount) } : {}),
      ...(numericDiagnostic(details?.mismatchFieldCount) !== undefined ? { mismatchFieldCount: numericDiagnostic(details?.mismatchFieldCount) } : {}),
      ...(numericDiagnostic(details?.totalStagedFiles) !== undefined ? { totalStagedFiles: numericDiagnostic(details?.totalStagedFiles) } : {}),
      ...(numericDiagnostic(details?.validDicomFiles) !== undefined ? { validDicomFiles: numericDiagnostic(details?.validDicomFiles) } : {}),
      ...(numericDiagnostic(details?.selectedStudyFiles) !== undefined ? { selectedStudyFiles: numericDiagnostic(details?.selectedStudyFiles) } : {}),
      ...(numericDiagnostic(details?.excludedOtherStudyFiles) !== undefined ? { excludedOtherStudyFiles: numericDiagnostic(details?.excludedOtherStudyFiles) } : {}),
      ...(numericDiagnostic(details?.excludedStudyCount) !== undefined ? { excludedStudyCount: numericDiagnostic(details?.excludedStudyCount) } : {}),
      ...(numericDiagnostic(details?.skippedOrUnparsedFiles) !== undefined ? { skippedOrUnparsedFiles: numericDiagnostic(details?.skippedOrUnparsedFiles) } : {}),
      ...(["STUDY_NOT_FOUND", "STUDY_RESPONSE_MALFORMED", "STUDY_INSTANCE_ENUMERATION_UNSUPPORTED", "STUDY_INSTANCE_LIST_MISSING", "STUDY_NOT_STABLE", "ZERO_INSTANCES", "EXPECTED_ACTUAL_COUNT_MISMATCH", "INSTANCE_SOP_UID_UNREADABLE", "SOP_SET_MISMATCH", "STUDY_UID_MISMATCH", "MULTIPLE_MODIFIED_STUDIES"].includes(String(details?.verificationReason || "")) ? { verificationReason: String(details?.verificationReason) } : {}),
      ...(numericDiagnostic(details?.expectedCount) !== undefined ? { expectedCount: numericDiagnostic(details?.expectedCount) } : {}),
      ...(numericDiagnostic(details?.actualCount) !== undefined ? { actualCount: numericDiagnostic(details?.actualCount) } : {}),
      ...(numericDiagnostic(details?.seriesCount) !== undefined ? { seriesCount: numericDiagnostic(details?.seriesCount) } : {}),
      ...(["direct", "series"].includes(String(details?.enumerationMethod || "")) ? { enumerationMethod: String(details?.enumerationMethod) } : {}),
      ...(typeof details?.orthancProduct === "string" ? { orthancProduct: details.orthancProduct.slice(0, 128) } : {}),
      ...(typeof details?.orthancVersion === "string" ? { orthancVersion: details.orthancVersion.slice(0, 64) } : {}),
      ...(typeof details?.studyResponseShape === "string" ? { studyResponseShape: details.studyResponseShape.slice(0, 500) } : {}),
      ...(typeof details?.statisticsResponseShape === "string" ? { statisticsResponseShape: details.statisticsResponseShape.slice(0, 500) } : {}),
      ...(typeof details?.instancesResponseShape === "string" ? { instancesResponseShape: details.instancesResponseShape.slice(0, 1000) } : {}),
      ...(typeof details?.sourceTransferSyntax === "string" ? { sourceTransferSyntax: details.sourceTransferSyntax.slice(0, 128) } : {}),
      ...(typeof details?.outputTransferSyntax === "string" ? { outputTransferSyntax: details.outputTransferSyntax.slice(0, 128) } : {}),
      ...(numericDiagnostic(details?.sourcePixelLength) !== undefined ? { sourcePixelLength: numericDiagnostic(details?.sourcePixelLength) } : {}),
      ...(numericDiagnostic(details?.outputPixelLength) !== undefined ? { outputPixelLength: numericDiagnostic(details?.outputPixelLength) } : {}),
      ...(typeof details?.failedInvariant === "string" ? { failedInvariant: details.failedInvariant.slice(0, 128) } : {}),
      ...(details?.orthancError && typeof details.orthancError === "object" ? { orthancError: sanitizeOrthancErrorResponse(details.orthancError) } : {}),
    };
    const recoveryAvailable = Boolean(job.staged_storage_key && !job.staging_cleanup_completed_at && isOrthancRecoveryEligibleProcessingError(code));
    const updated = await queryDicomRemapDb<DicomRemapJobRow>(
      `update dicom_remap_jobs set status = 'failed', processing_stage = 'failed', processing_completed_at = now(), processing_last_checked_at = now(), processing_lease_owner = null, processing_lease_expires_at = null, processing_error_code = $3::text, processing_error_details = $4::jsonb, error_message = $5::text, orthanc_recovery_status = case when $6 then 'available' else 'none' end, orthanc_recovery_expires_at = case when $6 then now() + ($7::text || ' hours')::interval else null end, updated_at = now() where id = $1 and status = 'processing' and processing_lease_owner = $2 returning *`,
      [job.id, leaseOwner, code, JSON.stringify(processingDiagnostics), processingErrorMessage(code), recoveryAvailable, DICOM_REMAP_ORTHANC_RECOVERY_RETENTION_HOURS]
    );
    if (updated.rows[0]) {
      await logDicomRemapAuditEntry({ entityType: "dicom_remap_job", entityId: job.id, actionType: "dicom_remap_processing_failed", oldValues: { status: "processing" }, newValues: { status: "failed", processingStage: "failed", errorCode: code, orthancRecoveryStatus: recoveryAvailable ? "available" : "none" }, changedByUserId: null });
      if (code === "DICOM_REMAP_PIXEL_INTEGRITY_FAILED") {
        await logDicomRemapAuditEntry({ entityType: "dicom_remap_job", entityId: job.id, actionType: "dicom_remap_primary_integrity_failed", oldValues: { status: "processing" }, newValues: processingDiagnostics, changedByUserId: null });
      }
      if (shouldAutomaticallyAttemptOrthancRecovery(updated.rows[0])) {
        return (await retryFailedDicomRemapWithOrthanc({ jobId: updated.rows[0].id, currentUserId: updated.rows[0].created_by_user_id, automatic: true })).job;
      }
    }
    throw error;
  }
}

function pickPreviewDisplayValue(existing: string, next: string): string {
  if (!existing && next) return next;
  return existing;
}

function summarizeDicomRemapPreview(entries: DicomRemapPreviewEntry[]): DicomRemapPreviewStudySummary[] {
  const map = new Map<string, DicomRemapPreviewStudySummary & { seriesSet: Set<string> }>();
  for (const entry of entries) {
    const existing = map.get(entry.studyInstanceUid);
    if (!existing) {
      const seriesSet = new Set<string>();
      if (entry.seriesInstanceUid) seriesSet.add(entry.seriesInstanceUid);
      map.set(entry.studyInstanceUid, {
        studyInstanceUid: entry.studyInstanceUid,
        studyDate: entry.studyDate,
        studyDescription: entry.studyDescription,
        modality: entry.modality,
        patientId: entry.patientId,
        patientName: entry.patientName,
        patientBirthDate: entry.patientBirthDate,
        patientSex: entry.patientSex,
        seriesCount: 0,
        fileCount: 1,
        totalBytes: entry.fileSize,
        files: [entry],
        seriesSet,
      });
      continue;
    }

    existing.studyDate = pickPreviewDisplayValue(existing.studyDate, entry.studyDate);
    existing.studyDescription = pickPreviewDisplayValue(existing.studyDescription, entry.studyDescription);
    existing.modality = pickPreviewDisplayValue(existing.modality, entry.modality);
    existing.patientId = pickPreviewDisplayValue(existing.patientId, entry.patientId);
    existing.patientName = pickPreviewDisplayValue(existing.patientName, entry.patientName);
    existing.patientBirthDate = pickPreviewDisplayValue(existing.patientBirthDate, entry.patientBirthDate);
    existing.patientSex = pickPreviewDisplayValue(existing.patientSex, entry.patientSex);
    existing.fileCount += 1;
    existing.totalBytes += entry.fileSize;
    existing.files.push(entry);
    if (entry.seriesInstanceUid) existing.seriesSet.add(entry.seriesInstanceUid);
  }

  return Array.from(map.values())
    .map((value) => ({
      studyInstanceUid: value.studyInstanceUid,
      studyDate: value.studyDate,
      studyDescription: value.studyDescription,
      modality: value.modality,
      patientId: value.patientId,
      patientName: value.patientName,
      patientBirthDate: value.patientBirthDate,
      patientSex: value.patientSex,
      seriesCount: value.seriesSet.size || 1,
      fileCount: value.fileCount,
      totalBytes: value.totalBytes,
      files: value.files,
    }))
    .sort((a, b) => b.fileCount - a.fileCount || b.totalBytes - a.totalBytes);
}

export async function previewDicomRemapMultipartUpload({
  files,
  tempDir,
}: {
  files: DicomRemapPreviewStagedFile[];
  tempDir?: string;
}): Promise<{
  studies: DicomRemapPreviewStudySummary[];
  skippedSidecarCount: number;
  unparsedCount: number;
  totalFileCount: number;
  dicomLikeFileCount: number;
  parsedDicomFileCount: number;
  fallbackUploadFiles: DicomRemapPreviewEntry[];
  unparsedFiles: Array<{
    previewIndex: number;
    fileName: string;
    filePath: string;
    fileSize: number;
    reason: string;
  }>;
  previewOnly: true;
  maxHeaderBytes: number;
}> {
  if (!Array.isArray(files) || files.length === 0) {
    throw new HttpError(400, "At least one DICOM preview file is required.");
  }

  try {
    const parsedEntries: DicomRemapPreviewEntry[] = [];
    const unparsedFiles: Array<{
      previewIndex: number;
      fileName: string;
      filePath: string;
      fileSize: number;
      reason: string;
    }> = [];
    let skippedSidecarCount = 0;
    let dicomLikeFileCount = 0;

    for (const file of files) {
      const fileName = sanitizeFileName(file.originalFileName || file.fileName);
      const filePath = String(file.originalFilePath || fileName).trim() || fileName;
      const fileSize = Number.isFinite(file.originalFileSize) && file.originalFileSize > 0 ? file.originalFileSize : file.size;
      const mimeType = String(file.mimeType || "application/octet-stream").trim();

      if (isSkippableDicomRemapFolderEntry(fileName)) {
        skippedSidecarCount += 1;
        continue;
      }
      if (!isLikelyDicomFile(fileName, mimeType)) {
        continue;
      }

      dicomLikeFileCount += 1;
      const raw = await readFile(file.path);
      const tags = parseDicomPreviewTags(raw.subarray(0, DICOM_REMAP_PREVIEW_HEADER_BYTES));
      const studyInstanceUid = normalizeDicomUid(tags["0020000d"]);
      if (!studyInstanceUid) {
        unparsedFiles.push({
          previewIndex: file.previewIndex,
          fileName,
          filePath,
          fileSize,
          reason: "missing_or_unreadable_study_uid",
        });
        continue;
      }

      parsedEntries.push({
        previewIndex: file.previewIndex,
        fileName,
        filePath,
        fileSize,
        studyInstanceUid,
        seriesInstanceUid: normalizeDicomUid(tags["0020000e"]),
        sopInstanceUid: normalizeDicomUid(tags["00080018"]),
        studyDate: String(tags["00080020"] || "").trim(),
        studyDescription: String(tags["00081030"] || "").trim(),
        modality: String(tags["00080060"] || "").trim(),
        patientId: String(tags["00100020"] || "").trim(),
        patientName: normalizeDicomPatientName(String(tags["00100010"] || "").trim()),
        patientBirthDate: normalizeDicomBirthDate(String(tags["00100030"] || "").trim()),
        patientSex: normalizePatientSex(String(tags["00100040"] || "").trim()),
      });
    }

    return {
      studies: summarizeDicomRemapPreview(parsedEntries),
      skippedSidecarCount,
      unparsedCount: unparsedFiles.length,
      totalFileCount: files.length,
      dicomLikeFileCount,
      parsedDicomFileCount: parsedEntries.length,
      fallbackUploadFiles: parsedEntries,
      unparsedFiles,
      previewOnly: true,
      maxHeaderBytes: DICOM_REMAP_PREVIEW_HEADER_BYTES,
    };
  } finally {
    if (tempDir) {
      await cleanupDicomRemapUploadTempDir(tempDir);
    }
  }
}

export async function createDicomRemapUploadJob({
  files,
  selectedStudyInstanceUID,
  currentUserId,
}: {
  files: DicomRemapUploadFileInput[];
  selectedStudyInstanceUID?: string | null;
  currentUserId: UserId;
}): Promise<DicomRemapUploadProcessingResult> {
  if (!Array.isArray(files) || files.length === 0) {
    throw new HttpError(400, "At least one DICOM file is required.");
  }

  const job = await createEmptyDicomRemapUploadJob(currentUserId);

  try {
    const studyIds = new Set<string>();
    let uploadedFileCount = 0;
    let skippedFilesCount = 0;

    for (const [index, file] of files.entries()) {
      const fileName = sanitizeFileName(file.fileName);
      const mimeType = String(file.mimeType || "application/octet-stream").trim();

      if (isSkippableDicomRemapFolderEntry(fileName)) {
        skippedFilesCount += 1;
        continue;
      }

      if (!isLikelyDicomFile(fileName, mimeType)) {
        throw new HttpError(400, `File "${fileName}" is not an accepted DICOM file.`);
      }

      const content = decodeBase64(file.fileContentBase64);
      const parentStudyId = await uploadDicomContentToOrthanc({
        body: content,
        fileName,
        fileIndex: index + 1,
      });

      if (!parentStudyId) {
        skippedFilesCount += 1;
        continue;
      }

      uploadedFileCount += 1;
      studyIds.add(parentStudyId);
    }

    return finalizeDicomRemapUploadJob({
      job,
      studyIds,
      selectedStudyInstanceUID,
      skippedFilesCount,
      uploadedFileCount,
      currentUserId,
    });
  } catch (error) {
    await failDicomRemapUploadJob(job.id, error);
    throw error;
  }
}

export async function createDicomRemapMultipartUploadJob({
  files,
  selectedStudyInstanceUID,
  currentUserId,
  tempDir,
}: {
  files: DicomRemapStagedUploadFile[];
  selectedStudyInstanceUID?: string | null;
  currentUserId: UserId;
  tempDir?: string;
}): Promise<DicomRemapUploadProcessingResult> {
  if (!Array.isArray(files) || files.length === 0) {
    throw new HttpError(400, "At least one DICOM file is required.");
  }

  let job: DicomRemapJobRow | null = null;

  try {
    job = await createEmptyDicomRemapUploadJob(currentUserId);
    const studyIds = new Set<string>();
    let uploadedFileCount = 0;
    let skippedFilesCount = 0;
    const acceptedFiles: Array<{ file: DicomRemapStagedUploadFile; fileName: string; fileIndex: number }> = [];

    for (const [index, file] of files.entries()) {
      const fileName = sanitizeFileName(file.fileName);
      const mimeType = String(file.mimeType || "application/octet-stream").trim();

      if (isSkippableDicomRemapFolderEntry(fileName)) {
        skippedFilesCount += 1;
        continue;
      }

      if (!isLikelyDicomFile(fileName, mimeType)) {
        skippedFilesCount += 1;
        continue;
      }

      acceptedFiles.push({ file, fileName, fileIndex: index + 1 });
    }

    for (let offset = 0; offset < acceptedFiles.length; offset += DICOM_REMAP_UPLOAD_CONCURRENCY) {
      const batch = acceptedFiles.slice(offset, offset + DICOM_REMAP_UPLOAD_CONCURRENCY);
      const parentStudyIds = await Promise.all(batch.map((entry) => uploadDicomContentToOrthanc({
        body: createReadStream(entry.file.path),
        fileName: entry.fileName,
        fileIndex: entry.fileIndex,
        tolerateInvalidDicom: true,
      })));

      for (const parentStudyId of parentStudyIds) {
        if (!parentStudyId) {
          skippedFilesCount += 1;
          continue;
        }
        uploadedFileCount += 1;
        studyIds.add(parentStudyId);
      }
    }

    return await finalizeDicomRemapUploadJob({
      job,
      studyIds,
      selectedStudyInstanceUID,
      skippedFilesCount,
      uploadedFileCount,
      currentUserId,
    });
  } catch (error) {
    if (job) {
      await failDicomRemapUploadJob(job.id, error);
    }
    throw error;
  } finally {
    if (tempDir) {
      await cleanupDicomRemapUploadTempDir(tempDir);
    }
  }
}

export async function processDicomRemapMultipartJob({
  files,
  selectedStudyInstanceUID,
  risproPatientId,
  destinationPacsKey,
  currentUserId,
  tempDir,
}: {
  files: DicomRemapStagedUploadFile[];
  selectedStudyInstanceUID?: string | null;
  risproPatientId: number | string;
  destinationPacsKey: number | string;
  currentUserId: UserId;
  tempDir?: string;
}): Promise<{ job: DicomRemapJobRow; skippedFilesCount: number }> {
  if (!Array.isArray(files) || files.length === 0) {
    throw new HttpError(400, "At least one DICOM file is required.");
  }

  const patientId = normalizePositiveInteger(risproPatientId, "risproPatientId");
  const destinationModalityKey = normalizeOrthancModalityKey(destinationPacsKey);
  if (!patientId) {
    throw new HttpError(400, "risproPatientId is required.");
  }

  let job: DicomRemapJobRow | null = null;

  try {
    const patient = await getPatientForDicomRemap(patientId);
    const replacement = formatReplacementFromPatient(patient);
    job = await createEmptyDicomRemapUploadJob(currentUserId);

    const studyIds = new Set<string>();
    let uploadedFileCount = 0;
    let skippedFilesCount = 0;
    let originalSummary: OrthancStudySummary | null = null;
    const rewrittenSopInstanceUids = new Set<string>();
    const expectedStudyInstanceUID = String(selectedStudyInstanceUID || "").trim();
    const uidPlan: DicomUidRemapPlan = {
      studyInstanceUid: createDicomUid(),
      seriesInstanceUidByOriginal: new Map<string, string>(),
    };
    const acceptedFiles: Array<{ file: DicomRemapStagedUploadFile; fileName: string; fileIndex: number }> = [];

    for (const [index, file] of files.entries()) {
      const fileName = sanitizeFileName(file.fileName);
      const mimeType = String(file.mimeType || "application/octet-stream").trim();

      if (isSkippableDicomRemapFolderEntry(fileName)) {
        skippedFilesCount += 1;
        continue;
      }

      if (!isLikelyDicomFile(fileName, mimeType)) {
        skippedFilesCount += 1;
        continue;
      }

      acceptedFiles.push({ file, fileName, fileIndex: index + 1 });
    }

    for (const entry of acceptedFiles) {
      const rewritten = await rewriteDicomFileForRemap(entry.file, replacement, uidPlan).catch((error: unknown) => {
        if (isDicomRewriteParseError(error)) {
          skippedFilesCount += 1;
          return null;
        }
        throw error;
      });
      if (!rewritten) {
        continue;
      }
      if (rewritten.replacementSopInstanceUid) rewrittenSopInstanceUids.add(rewritten.replacementSopInstanceUid);
      if (!originalSummary) {
        originalSummary = rewritten.originalSummary;
      }
      if (expectedStudyInstanceUID && rewritten.originalSummary.studyInstanceUid && rewritten.originalSummary.studyInstanceUid !== expectedStudyInstanceUID) {
        throw new HttpError(400, "Uploaded study does not match selected study. Please rescan and retry.");
      }

      const parentStudyId = await uploadDicomContentToOrthanc({
        body: rewritten.body,
        fileName: entry.fileName,
        fileIndex: entry.fileIndex,
      });

      if (!parentStudyId) {
        skippedFilesCount += 1;
        continue;
      }

      uploadedFileCount += 1;
      studyIds.add(parentStudyId);
    }

    if (!originalSummary) {
      throw new HttpError(400, "No uploadable DICOM instance files were found.");
    }

    if (uploadedFileCount === 0) {
      throw new HttpError(400, "No uploadable DICOM instance files were found.");
    }

    if (studyIds.size !== 1) {
      throw new HttpError(400, `Uploaded files must belong to exactly one study; detected ${studyIds.size} studies.`);
    }

    const sourceStudyId = Array.from(studyIds)[0];
    const uploadedSummary = await readStudySummary(sourceStudyId);
    if (!uploadedSummary.studyInstanceUid) {
      throw new HttpError(502, "Orthanc uploaded study did not expose a StudyInstanceUID. Please reset current upload and retry.");
    }
    if (uploadedSummary.studyInstanceUid === expectedStudyInstanceUID) {
      throw new HttpError(
        502,
        "Remapped study kept the original StudyInstanceUID. Please reset current upload and retry.",
        {
          originalStudyInstanceUID: expectedStudyInstanceUID,
          uploadedStudyInstanceUID: uploadedSummary.studyInstanceUid,
          sourceStudyId,
        }
      );
    }
    if (!hasExpectedRemappedPatientId(uploadedSummary, replacement.patientId)) {
      throw new HttpError(
        502,
        "Orthanc uploaded study identity does not match the selected RISPro patient. Please reset current upload and retry.",
        {
          uploadedSummary,
          replacement,
          sourceStudyId,
        }
      );
    }
    await verifyOrthancStudyAcceptedSopSet(sourceStudyId, rewrittenSopInstanceUids);

    const remappedResult = await queryDicomRemapDb<DicomRemapJobRow>(
      `
        update dicom_remap_jobs
        set
          status = 'remapped',
          source_orthanc_study_id = $2,
          modified_orthanc_study_id = $3,
          rispro_patient_id = $4,
          destination_pacs_key = $5,
          original_patient_id = $6,
          original_patient_name = $7,
          original_patient_sex = $8,
          original_patient_birth_date = $9,
          replacement_patient_id = $10,
          replacement_patient_name = $11,
          replacement_patient_sex = $12,
          replacement_patient_birth_date = $13,
          dicom_integrity_version = $14,
          dicom_integrity_verified_at = now(),
          error_message = null,
          updated_at = now()
        where id = $1
        returning *
      `,
      [
        job.id,
        sourceStudyId,
        sourceStudyId,
        patientId,
        destinationModalityKey,
        originalSummary.patientId,
        originalSummary.patientName,
        originalSummary.patientSex,
        originalSummary.patientBirthDate,
        replacement.patientId,
        replacement.patientName,
        replacement.patientSex,
        replacement.patientBirthDate,
        DICOM_REMAP_INTEGRITY_VERSION,
      ]
    );

    const remappedJob = remappedResult.rows[0];
    if (!remappedJob) {
      throw new HttpError(500, "Failed to update DICOM remap job after upload.");
    }

    await logDicomRemapAuditEntry({
      entityType: "dicom_remap_job",
      entityId: remappedJob.id,
      actionType: "upload_preingest_remap",
      oldValues: null,
      newValues: {
        sourceOrthancStudyId: remappedJob.source_orthanc_study_id,
        modifiedOrthancStudyId: remappedJob.modified_orthanc_study_id,
        originalPatient: originalSummary,
        replacementPatient: replacement,
        skippedFilesCount,
        uploadedFileCount,
      },
      changedByUserId: currentUserId,
    });

    const sentResult = await sendExistingDicomRemapJobToDestination({
      job: remappedJob,
      currentUserId,
      auditActionType: "pacs_send_enqueued",
    });

    return { job: sentResult.job, skippedFilesCount };
  } catch (error) {
    if (job) {
      const current = await loadAccessibleDicomRemapJob(job.id).catch(() => null);
      if (current && current.status !== "failed") {
        await failDicomRemapUploadJob(job.id, error);
        await logDicomRemapAuditEntry({
          entityType: "dicom_remap_job",
          entityId: job.id,
          actionType: "process_upload_send_failed",
          oldValues: { status: current.status },
          newValues: { status: "failed", errorMessage: error instanceof Error ? error.message : "DICOM remap send failed." },
          changedByUserId: currentUserId,
        });
      }
    }
    throw error;
  } finally {
    if (tempDir) {
      await cleanupDicomRemapUploadTempDir(tempDir);
    }
  }
}

export async function getDicomRemapJob({
  jobId,
}: {
  jobId: number | string;
}): Promise<{ job: DicomRemapJobRow; comparison: ConfirmComparison | null }> {
  const cleanJobId = normalizePositiveInteger(jobId, "jobId");
  const { rows } = await queryDicomRemapDb<DicomRemapJobRow>(
    `select j.*, u.full_name as created_by_user_name, u.username as created_by_username
       from dicom_remap_jobs j
       left join users u on u.id = j.created_by_user_id
      where j.id = $1
      limit 1`,
    [cleanJobId]
  );
  const job = rows[0];
  if (!job) throw new HttpError(404, "DICOM remap job not found.");
  const jobWithSourceRecovery = { ...job, source_recovery_available: isDicomRemapSourceRecoveryAvailable(job) };
  const comparison = jobWithSourceRecovery.replacement_patient_id
    ? {
      original: {
        patientId: jobWithSourceRecovery.original_patient_id || "",
        patientName: jobWithSourceRecovery.original_patient_name || "",
        patientSex: jobWithSourceRecovery.original_patient_sex || "",
        patientBirthDate: jobWithSourceRecovery.original_patient_birth_date || "",
      },
      replacement: {
        patientId: jobWithSourceRecovery.replacement_patient_id || "",
        patientName: jobWithSourceRecovery.replacement_patient_name || "",
        patientSex: jobWithSourceRecovery.replacement_patient_sex || "",
        patientBirthDate: jobWithSourceRecovery.replacement_patient_birth_date || "",
      },
    }
    : null;
  return { job: jobWithSourceRecovery, comparison };
}

export async function getMyActiveDicomRemapJob({
  currentUserId,
}: {
  currentUserId: UserId;
}): Promise<{ job: DicomRemapJobRow | null; comparison: ConfirmComparison | null }> {
  const activeJob = await readSingleResumableDicomRemapDraft(currentUserId);
  if (!activeJob) return { job: null, comparison: null };
  if (await markStaleActiveJobFailedIfSourceMissing(activeJob)) {
    return { job: null, comparison: null };
  }
  return getDicomRemapJob({ jobId: activeJob.id });
}

export async function listDicomRemapJobs({
  currentUserId,
  limit = 20,
  scope = "mine",
}: {
  currentUserId: UserId;
  limit?: number;
  scope?: "mine" | "all";
}): Promise<DicomRemapJobRow[]> {
  const cleanLimit = Math.min(Math.max(Number(limit) || 20, 1), 100);
  const { rows } = await queryDicomRemapDb<DicomRemapJobRow>(
    scope === "all"
      ? `select j.*, u.full_name as created_by_user_name, u.username as created_by_username
           from dicom_remap_jobs j
           left join users u on u.id = j.created_by_user_id
           order by j.created_at desc
           limit $1`
      : `select j.*, u.full_name as created_by_user_name, u.username as created_by_username
           from dicom_remap_jobs j
           left join users u on u.id = j.created_by_user_id
           where j.created_by_user_id = $1
           order by j.created_at desc
           limit $2`,
    scope === "all" ? [cleanLimit] : [currentUserId, cleanLimit]
  );
  return rows.map((job) => ({ ...job, source_recovery_available: isDicomRemapSourceRecoveryAvailable(job) }));
}

export async function listDicomRemapDestinations(): Promise<Array<{ key: string; id: string; name: string; isDefault: boolean }>> {
  const { modalities } = await listModalitiesForDicomRemap();
  return modalities.map((modality) => ({
    key: modality.key,
    id: modality.key,
    name: modality.key,
    isDefault: modality.isDefault,
  }));
}

export async function cancelDicomRemapJob({
  jobId,
  currentUserId,
  reason,
}: {
  jobId: number | string;
  currentUserId: UserId;
  reason?: unknown;
}): Promise<{ job: DicomRemapJobRow }> {
  const cleanJobId = normalizePositiveInteger(jobId, "jobId");
  if (!cleanJobId) {
    throw new HttpError(400, "jobId is required.");
  }
  const cleanReason = normalizeOptionalText(reason).slice(0, 1000);

  const result = await queryDicomRemapDb<DicomRemapJobRow>(
    `
      update dicom_remap_jobs
      set status = 'cancelled',
          cancellation_reason = nullif($2, ''),
          processing_stage = 'cancelled',
          processing_lease_owner = null,
          processing_lease_expires_at = null,
          updated_at = now()
      where id = $1
        and status = 'awaiting_confirmation'
        and processing_stage = 'awaiting_confirmation'
        and staged_manifest_version = $3
        and staged_storage_key is not null
      returning *
    `,
    [cleanJobId, cleanReason, DICOM_REMAP_SELECTED_STUDY_MANIFEST_VERSION]
  );

  const cancelledJob = result.rows[0];
  if (cancelledJob) {
    if (cancelledJob.staged_storage_key) {
      await cleanupDicomRemapStagingStorage(cancelledJob.staged_storage_key).then(async () => {
        await queryDicomRemapDb(`update dicom_remap_jobs set staging_cleanup_completed_at = now(), updated_at = now() where id = $1`, [cancelledJob.id]);
      }).catch(() => undefined);
    }
    await logDicomRemapAuditEntry({
      entityType: "dicom_remap_job",
      entityId: cancelledJob.id,
      actionType: "cancel",
      oldValues: null,
      newValues: {
        status: cancelledJob.status,
        cancellationReason: cancelledJob.cancellation_reason,
      },
      changedByUserId: currentUserId,
    });

    return { job: cancelledJob };
  }

  const currentJob = await loadAccessibleDicomRemapJob(cleanJobId);
  if (currentJob.status === "cancelled") {
    return { job: currentJob };
  }

  if (currentJob.status === "sent" || currentJob.status === "failed") {
    throw new HttpError(409, "Terminal DICOM remap jobs cannot be cancelled.", {
      status: currentJob.status,
    });
  }

  throw new HttpError(
    409,
    "This DICOM remap job is already being processed and cannot be interrupted safely.",
    { status: currentJob.status }
  );
}

export async function resetDicomRemapJob({
  jobId,
  currentUserId,
}: {
  jobId: number | string;
  currentUserId: UserId;
}): Promise<{ job: DicomRemapJobRow; summary: OrthancResetSummary }> {
  const job = await loadAccessibleDicomRemapJob(jobId);
  if (job.status === "processing" && job.processing_lease_expires_at && new Date(job.processing_lease_expires_at).getTime() > Date.now()) {
    throw new HttpError(409, "This DICOM remap job is actively processing and cannot be reset safely.");
  }
  if (job.status === "sending" || job.status === "sent") {
    throw new HttpError(409, "This DICOM remap job cannot be reset after send processing has started.");
  }

  const studyIds = uniqueStudyIdsFromJobs([job]);
  const results = await Promise.all(studyIds.map((studyId) => deleteOrthancStudyIfExists(studyId)));
  const summary = summarizeOrthancStudyDeletes(results);

  if (summary.failures.length > 0) {
    throw new HttpError(502, "Failed to delete one or more linked Orthanc studies.", summary);
  }

  const updateResult = await queryDicomRemapDb<DicomRemapJobRow>(
    `
      update dicom_remap_jobs
      set status = 'cancelled',
          cancellation_reason = 'Reset by user before retry',
          error_message = null,
          updated_at = now()
      where id = $1
      returning *
    `,
    [job.id]
  );
  const resetJob = updateResult.rows[0];
  if (!resetJob) {
    throw new HttpError(500, "Failed to reset DICOM remap job.");
  }

  if (resetJob.staged_storage_key) {
    await cleanupDicomRemapStagingStorage(resetJob.staged_storage_key).then(async () => {
      await queryDicomRemapDb(`update dicom_remap_jobs set staging_cleanup_completed_at = now(), updated_at = now() where id = $1`, [resetJob.id]);
    }).catch(() => undefined);
  }

  await logDicomRemapAuditEntry({
    entityType: "dicom_remap_job",
    entityId: resetJob.id,
    actionType: "reset_before_retry",
    oldValues: { status: job.status },
    newValues: {
      status: resetJob.status,
      cancellationReason: resetJob.cancellation_reason,
      deletedOrthancStudies: summary,
    },
    changedByUserId: currentUserId,
  });

  return { job: resetJob, summary };
}

export async function clearFailedDicomRemapOrthancStudies(currentUserId: UserId): Promise<OrthancResetSummary> {
  const { rows } = await queryDicomRemapDb<DicomRemapJobRow>(
    `
      select *
      from dicom_remap_jobs
      where status in ('failed', 'cancelled')
        and (
          source_orthanc_study_id is not null
          or modified_orthanc_study_id is not null
        )
    `
  );

  const studyIds = uniqueStudyIdsFromJobs(rows);
  const knownStudyIds = new Set(studyIds);
  for (const job of rows) {
    const discovered = await findMissingModifiedStudyIdsForJob(job, knownStudyIds);
    for (const studyId of discovered) {
      studyIds.push(studyId);
    }
  }
  const results = await Promise.all(studyIds.map((studyId) => deleteOrthancStudyIfExists(studyId)));
  const summary = summarizeOrthancStudyDeletes(results);

  await logDicomRemapAuditEntry({
    entityType: "dicom_remap_maintenance",
    entityId: null,
    actionType: "clear_failed_remap_orthanc_studies",
    oldValues: null,
    newValues: summary,
    changedByUserId: currentUserId,
  });

  return summary;
}

export async function hardResetOrthancStudies(
  currentUserId: UserId,
  confirmation: unknown
): Promise<{
  totalOrthancStudiesFound: number;
  deleted: number;
  alreadyMissing: number;
  failedDeletions: OrthancStudyDeleteResult[];
}> {
  if (String(confirmation || "") !== "DELETE ALL ORTHANC STUDIES") {
    throw new HttpError(400, "Typed confirmation is required to hard reset Orthanc studies.");
  }

  const listResponse = await fetchOrthancForRemap("/studies", {
    method: "GET",
    timeoutSeconds: REMAP_ORTHANC_OPERATION_TIMEOUT_SECONDS,
  });
  if (!listResponse.ok || !Array.isArray(listResponse.json)) {
    throw new HttpError(
      502,
      `Unable to list Orthanc studies before hard reset (status=${listResponse.status}, body=${sanitizeOrthancResponseSnippet(listResponse.text)}, shape=${describeOrthancPayloadShape(listResponse.json)}).`
    );
  }

  const studyIds = listResponse.json.map((studyId) => String(studyId || "").trim()).filter((studyId) => !!studyId);
  const results = await Promise.all(studyIds.map((studyId) => deleteOrthancStudyIfExists(studyId)));
  const summary = summarizeOrthancStudyDeletes(results);

  await queryDicomRemapDb(
    `
      update dicom_remap_jobs
      set status = 'failed',
          error_message = 'Orthanc hard reset performed',
          updated_at = now()
      where status = any($1::text[])
    `,
    [ACTIVE_JOB_STATUSES]
  );

  await logDicomRemapAuditEntry({
    entityType: "dicom_remap_maintenance",
    entityId: null,
    actionType: "hard_reset_orthanc_studies",
    oldValues: null,
    newValues: {
      totalOrthancStudiesFound: studyIds.length,
      ...summary,
    },
    changedByUserId: currentUserId,
  });

  return {
    totalOrthancStudiesFound: studyIds.length,
    deleted: summary.studiesDeleted,
    alreadyMissing: summary.studiesAlreadyMissing,
    failedDeletions: summary.failures,
  };
}

export async function prepareDicomRemapConfirmation({
  jobId,
  risproPatientId,
  destinationPacsKey,
  currentUserId,
}: {
  jobId: number | string;
  risproPatientId: number | string;
  destinationPacsKey: string;
  currentUserId: UserId;
}): Promise<{ job: DicomRemapJobRow; comparison: ConfirmComparison }> {
  const job = await loadAccessibleDicomRemapJob(jobId);
  assertJobStatus(job.status, "uploaded", "Job is not in uploaded state.");
  await assertJobSourceStudyExists(job);

  const patientId = normalizePositiveInteger(risproPatientId, "risproPatientId");
  const destinationModalityKey = normalizeOrthancModalityKey(destinationPacsKey);
  if (!patientId) {
    throw new HttpError(400, "risproPatientId is required.");
  }
  await assertDicomRemapComparisonPatient(job, patientId);

  const patient = await getPatientForDicomRemap(patientId);
  const replacement = formatReplacementFromPatient(patient);
  if (!replacement.patientId || !replacement.patientName) {
    throw new HttpError(400, "Selected patient does not have enough identity fields for DICOM replacement.");
  }

  const updateResult = await queryDicomRemapDb<DicomRemapJobRow>(
    `
      update dicom_remap_jobs
      set
        status = 'awaiting_confirmation',
        rispro_patient_id = $2,
        destination_pacs_key = $3,
        replacement_patient_id = $4,
        replacement_patient_name = $5,
        replacement_patient_sex = $6,
        replacement_patient_birth_date = $7,
        error_message = null,
        updated_at = now()
      where id = $1
      returning *
    `,
    [
      job.id,
      patient.id,
      destinationModalityKey,
      replacement.patientId,
      replacement.patientName,
      replacement.patientSex,
      replacement.patientBirthDate,
    ]
  );

  const updatedJob = updateResult.rows[0];
  if (!updatedJob) {
    throw new HttpError(500, "Failed to prepare DICOM remap job.");
  }

  const comparison: ConfirmComparison = {
    original: {
      patientId: updatedJob.original_patient_id || "",
      patientName: updatedJob.original_patient_name || "",
      patientSex: updatedJob.original_patient_sex || "",
      patientBirthDate: updatedJob.original_patient_birth_date || "",
    },
    replacement,
  };

  await logDicomRemapAuditEntry({
    entityType: "dicom_remap_job",
    entityId: updatedJob.id,
    actionType: "prepare_confirmation",
    oldValues: { status: job.status },
    newValues: {
      status: updatedJob.status,
      risproPatientId: patient.id,
      destinationPacsKey: updatedJob.destination_pacs_key,
      replacement,
    },
    changedByUserId: currentUserId,
  });

  return { job: updatedJob, comparison };
}

export async function getDicomRemapReplacementPreview({
  risproPatientId,
}: {
  risproPatientId: number | string;
}): Promise<OrthancPatientSummary> {
  const patientId = normalizePositiveInteger(risproPatientId, "risproPatientId");
  if (!patientId) {
    throw new HttpError(400, "risproPatientId is required.");
  }
  const patient = await getPatientForDicomRemap(patientId);
  const replacement = formatReplacementFromPatient(patient);
  if (!replacement.patientId || !replacement.patientName) {
    throw new HttpError(400, "Selected patient does not have enough identity fields for DICOM replacement.");
  }
  return replacement;
}

function isMatchingStagedConfirmation(
  job: DicomRemapJobRow,
  selectedStudyInstanceUid: string,
  patientId: number,
  destinationPacsKey: string
): boolean {
  return String(job.selected_study_instance_uid || "") === selectedStudyInstanceUid
    && Number(job.rispro_patient_id) === patientId
    && String(job.destination_pacs_key || "") === destinationPacsKey;
}

export async function confirmStagedDicomRemapJob({
  jobId,
  selectedStudyInstanceUID,
  risproPatientId,
  destinationPacsKey,
  confirm,
  currentUserId,
}: {
  jobId: number | string;
  selectedStudyInstanceUID: unknown;
  risproPatientId: number | string;
  destinationPacsKey: unknown;
  confirm: boolean;
  currentUserId: UserId;
}): Promise<{ job: DicomRemapJobRow }> {
  if (!confirm) throw new HttpError(400, "Explicit confirmation is required.");
  const cleanJobId = normalizePositiveInteger(jobId, "jobId");
  const patientId = normalizePositiveInteger(risproPatientId, "risproPatientId");
  if (!cleanJobId || !patientId) throw new HttpError(400, "Job and patient are required.");
  const selectedUid = normalizeSelectedStudyInstanceUid(selectedStudyInstanceUID);
  const destination = normalizeOrthancModalityKey(destinationPacsKey, "destinationPacsKey");

  const initialJob = await loadAccessibleDicomRemapJob(cleanJobId);
  await assertDicomRemapComparisonPatient(initialJob, patientId);
  if (initialJob.status !== "awaiting_confirmation") {
    if (initialJob.status !== "cancelled" && isMatchingStagedConfirmation(initialJob, selectedUid, patientId, destination)) {
      return { job: initialJob };
    }
    throw new HttpError(409, "Job is not awaiting staged confirmation.", { status: initialJob.status });
  }
  if (
    initialJob.processing_stage !== "awaiting_confirmation"
    || Number(initialJob.staged_manifest_version) !== DICOM_REMAP_SELECTED_STUDY_MANIFEST_VERSION
    || !initialJob.staged_storage_key
  ) {
    throw new HttpError(409, "Durable DICOM staging is not complete.", { code: "DICOM_REMAP_MANIFEST_INVALID" });
  }
  const { manifest } = await readDicomRemapStagingManifestMetadata(initialJob);
  if (
    manifest.uploadMode !== "staged_folder_selected_study"
    || String(manifest.provisionalSelectedStudyInstanceUID || "") !== selectedUid
  ) {
    throw new HttpError(409, "The confirmed study does not match the securely staged source selection.", {
      code: "DICOM_REMAP_SELECTED_STUDY_NOT_FOUND",
    });
  }

  const patient = await getPatientForDicomRemap(patientId);
  const replacement = formatReplacementFromPatient(patient);
  if (!replacement.patientId || !replacement.patientName) {
    throw new HttpError(400, "Selected patient does not have enough identity fields for DICOM replacement.");
  }
  const modalities = await listModalitiesForDicomRemap();
  if (!modalities.modalities.some((item) => item.key === destination)) {
    throw new HttpError(400, "Selected PACS destination is not available.");
  }

  const result = await queryDicomRemapDb<DicomRemapJobRow>(
    `update dicom_remap_jobs
        set selected_study_instance_uid = $2,
            rispro_patient_id = $3,
            destination_pacs_key = $4,
            replacement_patient_id = $5,
            replacement_patient_name = $6,
            replacement_patient_sex = $7,
            replacement_patient_birth_date = $8,
            status = 'uploaded',
            processing_stage = 'queued',
            processing_error_code = null,
            processing_error_details = null,
            error_message = null,
            updated_at = now()
      where id = $1
        and status = 'awaiting_confirmation'
        and processing_stage = 'awaiting_confirmation'
        and staged_manifest_version = $9
      returning *`,
    [
      cleanJobId,
      selectedUid,
      patientId,
      destination,
      replacement.patientId,
      replacement.patientName,
      replacement.patientSex,
      replacement.patientBirthDate,
      DICOM_REMAP_SELECTED_STUDY_MANIFEST_VERSION,
    ]
  );
  const job = result.rows[0];
  if (!job) {
    const current = await loadAccessibleDicomRemapJob(cleanJobId);
    if (isMatchingStagedConfirmation(current, selectedUid, patientId, destination)) return { job: current };
    throw new HttpError(409, "Job changed before staged confirmation completed.", { status: current.status });
  }
  await logDicomRemapAuditEntry({
    entityType: "dicom_remap_job",
    entityId: job.id,
    actionType: "dicom_remap_staged_confirmed",
    oldValues: { status: "awaiting_confirmation", processingStage: "awaiting_confirmation" },
    newValues: {
      status: "uploaded",
      processingStage: "queued",
      risproPatientId: patientId,
      destinationPacsKey: destination,
    },
    changedByUserId: currentUserId,
  });
  return { job };
}

async function validateOrthancRecoverySelectedFiles(
  job: DicomRemapJobRow,
  directory: string,
  files: DicomRemapStagedManifestFile[],
  manifestSelectedStudyUid?: string | null,
): Promise<{ originalSummary: OrthancStudySummary; sopInstanceUids: Set<string> }> {
  const selectedStudyUid = String(job.selected_study_instance_uid || manifestSelectedStudyUid || "").trim();
  if (!selectedStudyUid) throw new HttpError(409, "Confirmed selected study is missing.", { code: "DICOM_REMAP_SELECTED_STUDY_NOT_FOUND" });
  const patientIds = new Set<string>();
  const patientNames = new Set<string>();
  const birthDates = new Set<string>();
  const sexes = new Set<string>();
  const sopInstanceUids = new Set<string>();
  let firstSummary: OrthancStudySummary | null = null;
  for (const file of files) {
    const parsed = parseStagedDicomSummary(await readFile(path.join(directory, file.relativePath)));
    if (parsed.summary.studyInstanceUid !== selectedStudyUid) {
      throw new HttpError(409, "Persisted selected-study files no longer match the confirmed study.", { code: "DICOM_REMAP_SELECTED_STUDY_NOT_FOUND" });
    }
    firstSummary ||= parsed.summary;
    sopInstanceUids.add(parsed.sopInstanceUid);
    const patientId = normalizeSourceIdentityValue(parsed.summary.patientId, "patientId");
    const patientName = normalizeSourceIdentityValue(parsed.summary.patientName, "patientName");
    const birthDate = normalizeSourceIdentityValue(parsed.summary.patientBirthDate, "patientBirthDate");
    const sex = normalizeSourceIdentityValue(parsed.summary.patientSex, "patientSex");
    if (patientId) patientIds.add(patientId);
    if (patientName) patientNames.add(patientName);
    if (birthDate) birthDates.add(birthDate);
    if (sex) sexes.add(sex);
  }
  if (!firstSummary || sopInstanceUids.size !== files.length || [patientIds, patientNames, birthDates, sexes].some((values) => values.size > 1)) {
    throw new HttpError(409, "Preserved source study identity is inconsistent.", { code: "DICOM_REMAP_SOURCE_IDENTITY_INCONSISTENT" });
  }
  const originalSummary: OrthancStudySummary = {
    studyInstanceUid: selectedStudyUid,
    patientId: Array.from(patientIds)[0] || "",
    patientName: firstSummary.patientName,
    patientBirthDate: firstSummary.patientBirthDate,
    patientSex: firstSummary.patientSex,
  };
  const persistedOriginal: OrthancPatientSummary = {
    patientId: job.original_patient_id || originalSummary.patientId,
    patientName: job.original_patient_name || originalSummary.patientName,
    patientBirthDate: job.original_patient_birth_date || originalSummary.patientBirthDate,
    patientSex: job.original_patient_sex || originalSummary.patientSex,
  };
  if (!hasSameReplacementIdentity(originalSummary, persistedOriginal)) {
    throw new HttpError(409, "Preserved source identity does not match the confirmed source.", { code: "DICOM_REMAP_SOURCE_IDENTITY_MISMATCH" });
  }
  return { originalSummary, sopInstanceUids };
}

async function readStableOrthancStudySopSet(studyId: string, expectedCount: number): Promise<Set<string>> {
  const preflight = await waitForOrthancStudyStable(studyId);
  if (preflight.instanceCount !== expectedCount) {
    throw orthancVerificationError("Orthanc study instance count does not match preserved staging.", {
      verificationReason: "EXPECTED_ACTUAL_COUNT_MISMATCH",
      expectedCount,
      actualCount: preflight.instanceCount ?? 0,
      seriesCount: preflight.seriesCount ?? undefined,
    });
  }
  const studyPayload = preflight.studyResponse.json && typeof preflight.studyResponse.json === "object" && !Array.isArray(preflight.studyResponse.json)
    ? preflight.studyResponse.json as Record<string, unknown>
    : null;
  if (!studyPayload) throw orthancVerificationError("Orthanc study response was malformed.", { verificationReason: "STUDY_RESPONSE_MALFORMED", expectedCount });
  const enumerated = await listOrthancStudyInstanceIds(studyId, studyPayload, { expectedCount, actualCount: expectedCount, seriesCount: preflight.seriesCount ?? undefined });
  const sops = await mapWithConcurrency(enumerated.ids, DICOM_REMAP_ORTHANC_SOP_READ_CONCURRENCY, async (instanceId) => {
    const expanded = enumerated.sopsById.get(instanceId);
    if (expanded) return expanded;
    const tags = await fetchOrthancForRemap(`/instances/${encodeURIComponent(instanceId)}/simplified-tags`, { method: "GET" });
    return tags.ok && tags.json && typeof tags.json === "object" && !Array.isArray(tags.json)
      ? readDicomStringValue((tags.json as Record<string, unknown>).SOPInstanceUID)
      : "";
  });
  if (sops.some((sop) => !sop) || new Set(sops).size !== expectedCount) {
    throw orthancVerificationError("Orthanc instance identity could not be verified.", { verificationReason: "INSTANCE_SOP_UID_UNREADABLE", expectedCount, actualCount: sops.filter(Boolean).length });
  }
  return new Set(sops);
}

function sanitizedOrthancRecoveryError(error: unknown): { code: string; details: Record<string, unknown> } {
  const raw = error instanceof HttpError && error.details && typeof error.details === "object"
    ? error.details as Record<string, unknown>
    : {};
  const code = String(raw.code || processingErrorCode(error) || "DICOM_REMAP_ORTHANC_RECOVERY_FAILED");
  const details: Record<string, unknown> = { code };
  for (const key of ["orthancStatus", "verificationReason", "expectedCount", "actualCount", "seriesCount", "enumerationMethod", "responseShape", "failedInvariant", "sourceTransferSyntax", "outputTransferSyntax", "sourcePixelLength", "outputPixelLength"]) {
    const value = raw[key];
    if (typeof value === "number" && Number.isFinite(value)) details[key] = value;
    if (typeof value === "string" && value.length <= 256) details[key] = value;
  }
  if (raw.orthancError && typeof raw.orthancError === "object") details.orthancError = sanitizeOrthancErrorResponse(raw.orthancError);
  return { code, details };
}

const DICOM_REMAP_INTERRUPTIBLE_RECOVERY_STAGES = new Set<DicomRemapOrthancRecoveryStage>([
  "validating_staging",
  "uploading_source",
  "verifying_source",
  "modifying",
  "verifying_modified",
]);

async function renewDicomRemapOrthancRecoveryLease(jobId: number, leaseOwner: string, stage?: DicomRemapOrthancRecoveryStage): Promise<DicomRemapJobRow> {
  const leaseSeconds = Math.max(180, DICOM_REMAP_ORTHANC_RECOVERY_LEASE_SECONDS);
  const { rows } = await queryDicomRemapDb<DicomRemapJobRow>(
    `update dicom_remap_jobs
        set orthanc_recovery_stage = coalesce($3, orthanc_recovery_stage),
            orthanc_recovery_last_heartbeat_at = now(),
            orthanc_recovery_lease_expires_at = now() + ($4::text || ' seconds')::interval,
            updated_at = now()
      where id = $1
        and orthanc_recovery_status = 'processing'
        and orthanc_recovery_lease_owner = $2
      returning *`,
    [jobId, leaseOwner, stage || null, leaseSeconds]
  );
  if (!rows[0]) throw new HttpError(409, "Orthanc recovery lease was lost.", { code: "DICOM_REMAP_ORTHANC_RECOVERY_CLAIM_LOST" });
  return rows[0];
}

async function readOrthancModifiedFromStudyId(candidateStudyId: string): Promise<{ available: boolean; sourceStudyId: string }> {
  const response = await fetchOrthancForRemap(`/studies/${encodeURIComponent(candidateStudyId)}/metadata/ModifiedFrom`, { method: "GET" }).catch(() => null);
  if (!response || !response.ok) return { available: false, sourceStudyId: "" };
  const value = typeof response.json === "string" ? response.json : response.text;
  return { available: true, sourceStudyId: String(value || "").replace(/^"|"$/g, "").trim() };
}

async function findProvenOrthancRecoveryModifiedChildren(
  job: DicomRemapJobRow,
  sourceStudyId: string,
  options: { renewLease?: () => Promise<void> } = {},
): Promise<{ exact: string[]; provenanceAvailable: boolean; searchConclusive: boolean }> {
  await options.renewLease?.();
  const sourceMetadata = await readOrthancStudyMatchMetadata(sourceStudyId);
  const query: Record<string, string> = {};
  const replacementPatientId = String(job.replacement_patient_id || "").trim();
  if (replacementPatientId) query.PatientID = replacementPatientId;
  if (sourceMetadata?.studyDate) query.StudyDate = sourceMetadata.studyDate;
  if (sourceMetadata?.accessionNumber) query.AccessionNumber = sourceMetadata.accessionNumber;
  await options.renewLease?.();
  const studies = await fetchOrthancForRemap("/tools/find", {
    method: "POST",
    body: { Level: "Study", Query: query },
    timeoutSeconds: REMAP_ORTHANC_OPERATION_TIMEOUT_SECONDS,
  }).catch(() => null);
  await options.renewLease?.();
  if (!studies?.ok || !Array.isArray(studies.json)) return { exact: [], provenanceAvailable: false, searchConclusive: false };
  const candidateIds: string[] = [];
  for (const candidate of studies.json) {
    const candidateId = typeof candidate === "string" ? candidate.trim() : parseOrthancResourceId(candidate);
    if (!candidateId) return { exact: [], provenanceAvailable: false, searchConclusive: false };
    if (!candidateIds.includes(candidateId)) candidateIds.push(candidateId);
  }
  let provenanceAvailable = false;
  const exact: string[] = [];
  for (const candidateId of candidateIds) {
    if (!candidateId || candidateId === sourceStudyId) continue;
    await options.renewLease?.();
    const candidateMetadata = await readOrthancStudyMatchMetadata(candidateId);
    if (!candidateMetadata || candidateMetadata.patientId !== replacementPatientId) continue;
    if (sourceMetadata?.accessionNumber && candidateMetadata.accessionNumber !== sourceMetadata.accessionNumber) continue;
    if (sourceMetadata?.studyDate && candidateMetadata.studyDate !== sourceMetadata.studyDate) continue;
    if (sourceMetadata?.modality && candidateMetadata.modality && candidateMetadata.modality !== sourceMetadata.modality) continue;
    const provenance = await readOrthancModifiedFromStudyId(candidateId);
    await options.renewLease?.();
    provenanceAvailable ||= provenance.available;
    if (provenance.available && provenance.sourceStudyId === sourceStudyId) exact.push(candidateId);
  }
  return { exact, provenanceAvailable, searchConclusive: true };
}

export async function retryFailedDicomRemapWithOrthanc({
  jobId,
  currentUserId,
  automatic = false,
}: {
  jobId: number | string;
  currentUserId: UserId;
  automatic?: boolean;
}): Promise<{ job: DicomRemapJobRow }> {
  const initial = await loadAccessibleDicomRemapJob(jobId);
  if (automatic && !shouldAutomaticallyAttemptOrthancRecovery(initial)) {
    throw new HttpError(409, "This job is not eligible for automatic Orthanc recovery.", { code: "DICOM_REMAP_ORTHANC_RECOVERY_NOT_AVAILABLE" });
  }
  if (initial.orthanc_recovery_status === "completed") {
    if (initial.status === "remapped") {
      return sendExistingDicomRemapJobToDestination({ job: initial, currentUserId, auditActionType: "pacs_send_enqueued" });
    }
    return { job: initial };
  }
  if (initial.orthanc_recovery_status === "processing" && initial.orthanc_recovery_lease_expires_at && Date.parse(initial.orthanc_recovery_lease_expires_at) > Date.now()) {
    return { job: initial };
  }
  if (initial.status !== "failed" || !["available", "failed", "processing"].includes(String(initial.orthanc_recovery_status || ""))) {
    throw new HttpError(409, "This job is not eligible for Orthanc recovery.", { code: "DICOM_REMAP_ORTHANC_RECOVERY_NOT_AVAILABLE" });
  }
  if (!isOrthancRecoveryEligibleProcessingError(initial.processing_error_code)) {
    throw new HttpError(409, "This source-safety failure cannot be recovered through Orthanc.", { code: "DICOM_REMAP_ORTHANC_RECOVERY_NOT_SAFE" });
  }
  if (!initial.staged_storage_key || initial.staging_cleanup_completed_at || !initial.orthanc_recovery_expires_at || Date.parse(initial.orthanc_recovery_expires_at) <= Date.now()) {
    throw new HttpError(409, "Preserved source staging is unavailable or expired. Re-upload the original study.", { code: "DICOM_REMAP_REUPLOAD_REQUIRED" });
  }
  const replacement: OrthancPatientSummary = {
    patientId: initial.replacement_patient_id || "",
    patientName: initial.replacement_patient_name || "",
    patientSex: initial.replacement_patient_sex || "",
    patientBirthDate: initial.replacement_patient_birth_date || "",
  };
  if (!replacement.patientId || !replacement.patientName || !initial.destination_pacs_key) {
    throw new HttpError(409, "Recovery patient identity or PACS destination is missing.", { code: "DICOM_REMAP_ORTHANC_RECOVERY_NOT_AVAILABLE" });
  }

  const leaseOwner = `dicom-remap-recovery-${process.pid}-${randomUUID()}`;
  const leaseSeconds = Math.max(180, DICOM_REMAP_ORTHANC_RECOVERY_LEASE_SECONDS);
  const interruptedStage = initial.orthanc_recovery_error_details && typeof initial.orthanc_recovery_error_details === "object"
    ? String((initial.orthanc_recovery_error_details as Record<string, unknown>).interruptedStage || "")
    : "";
  const possiblePreviousModify = ["modifying", "verifying_modified", "completed"].includes(String(initial.orthanc_recovery_stage || ""))
    || ["modifying", "verifying_modified", "completed"].includes(interruptedStage)
    || [
      "DICOM_REMAP_ORTHANC_RECOVERY_PROVENANCE_UNVERIFIED",
      "DICOM_REMAP_ORTHANC_RECOVERY_MULTIPLE_MODIFIED_CHILDREN",
    ].includes(String(initial.orthanc_recovery_error_code || ""));
  const claimed = await queryDicomRemapDb<DicomRemapJobRow>(
    `update dicom_remap_jobs
        set orthanc_recovery_status = 'processing',
            orthanc_recovery_stage = case when orthanc_recovery_status = 'processing' then coalesce(orthanc_recovery_stage, 'validating_staging') else 'validating_staging' end,
            orthanc_recovery_attempt_count = coalesce(orthanc_recovery_attempt_count, 0) + 1,
            orthanc_recovery_started_at = now(),
            orthanc_recovery_completed_at = null,
            orthanc_recovery_error_code = null,
            orthanc_recovery_error_details = null,
            orthanc_recovery_lease_owner = $2,
            orthanc_recovery_lease_expires_at = now() + ($3::text || ' seconds')::interval,
            orthanc_recovery_last_heartbeat_at = now(),
            updated_at = now()
      where id = $1 and status = 'failed'
        and staged_storage_key is not null and staging_cleanup_completed_at is null and orthanc_recovery_expires_at > now()
        and ($4::boolean = false or coalesce(orthanc_recovery_attempt_count, 0) = 0)
        and (orthanc_recovery_status in ('available', 'failed') or (orthanc_recovery_status = 'processing' and (orthanc_recovery_lease_expires_at is null or orthanc_recovery_lease_expires_at <= now())))
      returning *`,
    [initial.id, leaseOwner, leaseSeconds, automatic]
  );
  let job = claimed.rows[0];
  if (!job) {
    const current = await loadAccessibleDicomRemapJob(initial.id);
    if (current.orthanc_recovery_status === "completed" || current.orthanc_recovery_status === "processing") return { job: current };
    throw new HttpError(409, "Orthanc recovery state changed before it could be claimed.", { code: "DICOM_REMAP_ORTHANC_RECOVERY_NOT_AVAILABLE" });
  }
  const reclaimed = initial.orthanc_recovery_status === "processing" || initial.orthanc_recovery_error_code === "DICOM_REMAP_ORTHANC_RECOVERY_INTERRUPTED";
  await logDicomRemapAuditEntry({ entityType: "dicom_remap_job", entityId: job.id, actionType: reclaimed ? "dicom_remap_orthanc_recovery_reclaimed" : "dicom_remap_orthanc_recovery_started", oldValues: { orthancRecoveryStatus: initial.orthanc_recovery_status, recoveryStage: initial.orthanc_recovery_stage }, newValues: { orthancRecoveryStatus: "processing", recoveryStage: job.orthanc_recovery_stage, attemptNumber: job.orthanc_recovery_attempt_count, sourceCheckpointExists: Boolean(job.orthanc_recovery_source_study_id), modifiedCheckpointExists: Boolean(job.modified_orthanc_study_id) }, changedByUserId: currentUserId });

  let recoveredForSend: DicomRemapJobRow | null = null;
  const recoverySourceSummary = {
    sourceObjectCount: 0,
    originalAcceptedCount: 0,
    structurallyRepairedCount: 0,
    repairFailedCount: 0,
    repairType: "missing_pixel_sequence_delimitation_item",
  };
  try {
    job = await renewDicomRemapOrthancRecoveryLease(job.id, leaseOwner, "validating_staging");
    const staged = await loadDicomRemapStagingManifest(job);
    const planned = await readOrBuildDicomRemapUidPlan({ ...staged, selectedStudyInstanceUID: job.selected_study_instance_uid });
    const selected = await validateOrthancRecoverySelectedFiles(job, staged.directory, planned.validFiles, staged.manifest.selectedStudyInstanceUID || staged.manifest.provisionalSelectedStudyInstanceUID);
    job = await renewDicomRemapOrthancRecoveryLease(job.id, leaseOwner, "uploading_source");
    let sourceStudyId = String(job.orthanc_recovery_source_study_id || job.source_orthanc_study_id || "").trim();
    let sourceVerified = false;
    if (sourceStudyId) {
      job = await renewDicomRemapOrthancRecoveryLease(job.id, leaseOwner, "verifying_source");
    }
    if (sourceStudyId && await readOrthancStudyExists(sourceStudyId)) {
      const summary = await readStudySummary(sourceStudyId);
      if (summary.studyInstanceUid !== selected.originalSummary.studyInstanceUid || !hasSameReplacementIdentity(summary, selected.originalSummary)) {
        throw new HttpError(409, "Persisted Orthanc recovery source does not match preserved staging.", { code: "DICOM_REMAP_SOURCE_IDENTITY_MISMATCH" });
      }
      try {
        await verifyOrthancStudyAcceptedSopSet(sourceStudyId, selected.sopInstanceUids, { renewLease: async () => { job = await renewDicomRemapOrthancRecoveryLease(job.id, leaseOwner, "verifying_source"); } });
        sourceVerified = true;
      } catch (error) {
        const reason = error instanceof HttpError ? String((error.details as { verificationReason?: unknown } | null)?.verificationReason || "") : "";
        if (!["ZERO_INSTANCES", "EXPECTED_ACTUAL_COUNT_MISMATCH", "SOP_SET_MISMATCH"].includes(reason)) throw error;
      }
    }
    if (!sourceVerified) {
      job = await renewDicomRemapOrthancRecoveryLease(job.id, leaseOwner, "uploading_source");
      const studyIds = new Set<string>();
      recoverySourceSummary.sourceObjectCount = planned.validFiles.length;
      for (const [index, file] of planned.validFiles.entries()) {
        job = await renewDicomRemapOrthancRecoveryLease(job.id, leaseOwner, "uploading_source");
        const originalBody = await readFile(path.join(staged.directory, file.relativePath));
        let prepared: OrthancRecoveryPreparedDicom;
        try {
          prepared = prepareDicomForOrthancRecoveryUpload(originalBody);
        } catch (error) {
          recoverySourceSummary.repairFailedCount += 1;
          throw error;
        }
        const uploadedStudyId = await uploadDicomContentToOrthanc({ body: prepared.body, fileName: file.displayName, fileIndex: index + 1 });
        if (prepared.structurallyRepaired) recoverySourceSummary.structurallyRepairedCount += 1;
        else recoverySourceSummary.originalAcceptedCount += 1;
        job = await renewDicomRemapOrthancRecoveryLease(job.id, leaseOwner, "uploading_source");
        if (!uploadedStudyId) throw new HttpError(502, "Orthanc did not accept a preserved source instance.", { code: "DICOM_REMAP_ORTHANC_UPLOAD_FAILED" });
        studyIds.add(uploadedStudyId);
        if (!sourceStudyId) {
          sourceStudyId = uploadedStudyId;
          const persisted = await queryDicomRemapDb<DicomRemapJobRow>(
            `update dicom_remap_jobs set orthanc_recovery_source_study_id = $2, source_orthanc_study_id = $2, updated_at = now() where id = $1 and orthanc_recovery_status = 'processing' and orthanc_recovery_lease_owner = $3 returning *`,
            [job.id, sourceStudyId, leaseOwner]
          );
          if (!persisted.rows[0]) throw new HttpError(409, "Orthanc recovery claim was lost.", { code: "DICOM_REMAP_ORTHANC_RECOVERY_CLAIM_LOST" });
          job = persisted.rows[0];
        }
        if (uploadedStudyId !== sourceStudyId) throw orthancVerificationError("Original staged instances produced multiple Orthanc studies.", { verificationReason: "MULTIPLE_MODIFIED_STUDIES", expectedCount: planned.validFiles.length, actualCount: studyIds.size });
        if (afterOrthancRecoverySourceUploadForTests) await afterOrthancRecoverySourceUploadForTests({ jobId: job.id, fileIndex: index + 1, studyId: uploadedStudyId, body: prepared.body });
      }
      if (!sourceStudyId) throw new HttpError(502, "Orthanc recovery source study was not created.", { code: "DICOM_REMAP_ORTHANC_UPLOAD_FAILED" });
      job = await renewDicomRemapOrthancRecoveryLease(job.id, leaseOwner, "verifying_source");
      await verifyOrthancStudyAcceptedSopSet(sourceStudyId, selected.sopInstanceUids, { renewLease: async () => { job = await renewDicomRemapOrthancRecoveryLease(job.id, leaseOwner, "verifying_source"); } });
    }

    job = await renewDicomRemapOrthancRecoveryLease(job.id, leaseOwner, "verifying_source");
    const sourceSummary = await readStudySummary(sourceStudyId);
    if (sourceSummary.studyInstanceUid !== selected.originalSummary.studyInstanceUid || !hasSameReplacementIdentity(sourceSummary, selected.originalSummary)) {
      throw new HttpError(409, "Orthanc recovery source identity could not be verified.", { code: "DICOM_REMAP_SOURCE_IDENTITY_MISMATCH" });
    }

    let modifiedStudyId = String(job.modified_orthanc_study_id || "").trim();
    if (!modifiedStudyId) {
      const mustReconcile = possiblePreviousModify || job.orthanc_recovery_stage === "modifying";
      if (mustReconcile) {
        job = await renewDicomRemapOrthancRecoveryLease(job.id, leaseOwner, "modifying");
        const discovered = await findProvenOrthancRecoveryModifiedChildren(job, sourceStudyId, {
          renewLease: async () => { job = await renewDicomRemapOrthancRecoveryLease(job.id, leaseOwner, "modifying"); },
        });
        if (discovered.exact.length > 1) throw new HttpError(409, "Multiple exact Orthanc recovery children were found.", { code: "DICOM_REMAP_ORTHANC_RECOVERY_MULTIPLE_MODIFIED_CHILDREN", actualCount: discovered.exact.length });
        if (!discovered.searchConclusive || discovered.exact.length !== 1) throw new HttpError(409, "Orthanc recovery provenance could not prove the modified child.", { code: "DICOM_REMAP_ORTHANC_RECOVERY_PROVENANCE_UNVERIFIED", provenanceAvailable: discovered.provenanceAvailable });
        modifiedStudyId = discovered.exact[0]!;
      } else {
        job = await renewDicomRemapOrthancRecoveryLease(job.id, leaseOwner, "modifying");
        modifiedStudyId = await createModifiedStudyCopy(sourceStudyId, replacement, { requireExactModifiedFromProvenance: true });
        if (afterOrthancRecoveryModifyForTests) await afterOrthancRecoveryModifyForTests({ jobId: job.id, sourceStudyId, modifiedStudyId });
      }
      const persisted = await queryDicomRemapDb<DicomRemapJobRow>(
        `update dicom_remap_jobs set modified_orthanc_study_id = $2, orthanc_recovery_stage = 'verifying_modified', orthanc_recovery_last_heartbeat_at = now(), orthanc_recovery_lease_expires_at = now() + ($4::text || ' seconds')::interval, updated_at = now() where id = $1 and orthanc_recovery_status = 'processing' and orthanc_recovery_lease_owner = $3 returning *`,
        [job.id, modifiedStudyId, leaseOwner, leaseSeconds]
      );
      if (!persisted.rows[0]) throw new HttpError(409, "Orthanc recovery claim was lost.", { code: "DICOM_REMAP_ORTHANC_RECOVERY_CLAIM_LOST" });
      job = persisted.rows[0];
    }

    job = await renewDicomRemapOrthancRecoveryLease(job.id, leaseOwner, "verifying_modified");
    await readStableOrthancStudySopSet(modifiedStudyId, selected.sopInstanceUids.size);
    job = await renewDicomRemapOrthancRecoveryLease(job.id, leaseOwner, "verifying_modified");
    const modifiedSummary = await readStudySummary(modifiedStudyId);
    if (!modifiedSummary.studyInstanceUid || modifiedSummary.studyInstanceUid === sourceSummary.studyInstanceUid) {
      throw orthancVerificationError("Orthanc recovery did not create a distinct modified Study Instance UID.", { verificationReason: "STUDY_UID_MISMATCH", expectedCount: selected.sopInstanceUids.size });
    }
    if (!hasExpectedRemappedPatientId(modifiedSummary, replacement.patientId)) {
      throw new HttpError(502, "Orthanc recovery did not verify replacement PatientID.", { code: "DICOM_REMAP_IDENTITY_VERIFICATION_FAILED" });
    }

    const completed = await queryDicomRemapDb<DicomRemapJobRow>(
      `update dicom_remap_jobs set status = 'remapped', processing_stage = 'enqueueing_send', source_orthanc_study_id = $2, orthanc_recovery_source_study_id = $2, modified_orthanc_study_id = $3, original_patient_id = $4, original_patient_name = $5, original_patient_sex = $6, original_patient_birth_date = $7, orthanc_recovery_status = 'completed', orthanc_recovery_stage = 'completed', orthanc_recovery_completed_at = now(), orthanc_recovery_error_code = null, orthanc_recovery_error_details = null, orthanc_recovery_lease_owner = null, orthanc_recovery_lease_expires_at = null, dicom_integrity_version = $8, dicom_integrity_verified_at = now(), processing_error_code = null, processing_error_details = null, error_message = null, updated_at = now() where id = $1 and orthanc_recovery_status = 'processing' and orthanc_recovery_lease_owner = $9 returning *`,
      [job.id, sourceStudyId, modifiedStudyId, selected.originalSummary.patientId, selected.originalSummary.patientName, selected.originalSummary.patientSex, selected.originalSummary.patientBirthDate, DICOM_REMAP_INTEGRITY_VERSION, leaseOwner]
    );
    const recovered = completed.rows[0];
    if (!recovered) throw new HttpError(409, "Orthanc recovery claim was lost.", { code: "DICOM_REMAP_ORTHANC_RECOVERY_CLAIM_LOST" });
    await logDicomRemapAuditEntry({ entityType: "dicom_remap_job", entityId: recovered.id, actionType: "dicom_remap_orthanc_recovery_completed", oldValues: { status: "failed", orthancRecoveryStatus: "processing" }, newValues: { status: "remapped", orthancRecoveryStatus: "completed", attemptNumber: recovered.orthanc_recovery_attempt_count, integrityVersion: DICOM_REMAP_INTEGRITY_VERSION, recoverySourceSummary }, changedByUserId: currentUserId });
    recoveredForSend = recovered;
  } catch (error) {
    const sanitized = sanitizedOrthancRecoveryError(error);
    const interruptedStage = DICOM_REMAP_INTERRUPTIBLE_RECOVERY_STAGES.has(job.orthanc_recovery_stage as DicomRemapOrthancRecoveryStage)
      ? job.orthanc_recovery_stage as DicomRemapOrthancRecoveryStage
      : null;
    if (interruptedStage) sanitized.details.interruptedStage = interruptedStage;
    Object.assign(sanitized.details, recoverySourceSummary);
    const failed = await queryDicomRemapDb<DicomRemapJobRow>(
      `update dicom_remap_jobs set status = 'failed', processing_stage = 'failed', orthanc_recovery_status = 'failed', orthanc_recovery_stage = 'failed', orthanc_recovery_error_code = $2, orthanc_recovery_error_details = $3::jsonb, orthanc_recovery_lease_owner = null, orthanc_recovery_lease_expires_at = null, error_message = 'Orthanc recovery failed. Preserved source staging remains available until recovery expiry.', updated_at = now() where id = $1 and orthanc_recovery_status = 'processing' and orthanc_recovery_lease_owner = $4 returning *`,
      [job.id, sanitized.code, JSON.stringify(sanitized.details), leaseOwner]
    );
    if (failed.rows[0]) {
      await logDicomRemapAuditEntry({ entityType: "dicom_remap_job", entityId: job.id, actionType: "dicom_remap_orthanc_recovery_failed", oldValues: { orthancRecoveryStatus: "processing" }, newValues: { status: "failed", orthancRecoveryStatus: "failed", errorCode: sanitized.code, attemptNumber: failed.rows[0].orthanc_recovery_attempt_count }, changedByUserId: currentUserId });
    }
    throw error;
  }
  if (!recoveredForSend) throw new HttpError(500, "Orthanc recovery did not produce a verified study.");
  return sendExistingDicomRemapJobToDestination({ job: recoveredForSend, currentUserId, auditActionType: "pacs_send_enqueued" });
}

export async function resendDicomRemapJobToPacs({
  jobId,
  currentUserId,
  confirmDestinationChecked = false,
}: {
  jobId: number | string;
  currentUserId: UserId;
  confirmDestinationChecked?: boolean;
}): Promise<{ job: DicomRemapJobRow }> {
  const job = await loadAccessibleDicomRemapJob(jobId);
  if (job.status === "sending" && job.orthanc_send_job_id) {
    return { job };
  }
  if (job.status !== "failed" || !job.send_error_code) {
    throw new HttpError(409, "A processing failure must be recovered from preserved staging or re-uploaded; Retry Send is not allowed.", {
      code: job.processing_error_code && hasUnexpiredOrthancRecovery(job) ? "DICOM_REMAP_ORTHANC_RECOVERY_REQUIRED" : "DICOM_REMAP_REUPLOAD_REQUIRED",
      status: job.status,
      processingErrorCode: job.processing_error_code,
    });
  }
  if (!job.modified_orthanc_study_id || !hasCurrentDicomIntegrityVerification(job)) {
    throw new HttpError(409, "Retry Send requires a currently verified remapped study from a previous failed PACS send.", {
      code: hasUnexpiredOrthancRecovery(job) ? "DICOM_REMAP_ORTHANC_RECOVERY_REQUIRED" : "DICOM_REMAP_REUPLOAD_REQUIRED",
      status: job.status,
    });
  }
  if (isDestinationVerificationRequired(job.send_error_code) && !confirmDestinationChecked) {
    throw new HttpError(409, "RISpro could not confirm whether PACS received this study. Check the destination PACS before resending to avoid a duplicate study.", {
      code: "PACS_DESTINATION_VERIFICATION_REQUIRED",
      sendErrorCode: job.send_error_code,
    });
  }

  return sendExistingDicomRemapJobToDestination({
    job,
    currentUserId,
    auditActionType: "pacs_resend_enqueued",
    auditMetadata: isDestinationVerificationRequired(job.send_error_code) ? { confirmDestinationChecked: true, previousSendErrorCode: job.send_error_code } : {},
  });
}

export async function confirmDicomRemapAndSend({
  jobId,
  confirm,
  confirmIncompleteStudy = false,
  currentUserId,
}: {
  jobId: number | string;
  confirm: boolean;
  confirmIncompleteStudy?: boolean;
  currentUserId: UserId;
}): Promise<{ job: DicomRemapJobRow }> {
  if (!confirm) {
    throw new HttpError(400, "Explicit confirmation is required.");
  }

  const cleanJobId = normalizePositiveInteger(jobId, "jobId");
  if (!cleanJobId) {
    throw new HttpError(400, "jobId is required.");
  }
  const confirmPartialJob = async (initial: DicomRemapJobRow): Promise<{ job: DicomRemapJobRow }> => {
    if (!confirmIncompleteStudy) throw new HttpError(400, "Explicit incomplete-study acknowledgement is required.");
    if (!initial.modified_orthanc_study_id) throw new HttpError(409, "The remapped Orthanc study is missing.");
    const { directory } = await readDicomRemapStagingManifestMetadata(initial);
    const plan = JSON.parse(await readFile(path.join(directory, "uid-plan.json"), "utf8")) as PersistedDicomUidPlan;
    const acceptedSops = new Set(Object.values(plan.fileOutcomes || {}).filter(isAcceptedDicomRemapOutcome).map((outcome) => outcome.replacementSopInstanceUid).filter((uid): uid is string => Boolean(uid)));
    if (!acceptedSops.size) throw new HttpError(409, "No accepted remapped instances are available.");
    const summary = await readStudySummary(initial.modified_orthanc_study_id);
    const replacement = { patientId: initial.replacement_patient_id || "", patientName: initial.replacement_patient_name || "", patientSex: initial.replacement_patient_sex || "", patientBirthDate: initial.replacement_patient_birth_date || "" };
    if (summary.studyInstanceUid !== plan.studyInstanceUid || !hasExpectedRemappedPatientId(summary, replacement.patientId)) throw new HttpError(409, "The remapped Orthanc study identity could not be verified.");
    await verifyOrthancStudyAcceptedSopSet(initial.modified_orthanc_study_id, acceptedSops);
    const selectionCounts: DicomRemapSelectionCounts = {
      ...(initial.processing_selection_counts || plan.selectionCounts || { totalStagedFiles: 0, validDicomFiles: 0, selectedStudyFiles: 0, excludedOtherStudyFiles: 0, excludedStudyCount: 0, skippedOrUnparsedFiles: 0 }),
      acknowledgement: { acknowledgedAt: new Date().toISOString(), acknowledgedByUserId: Number(currentUserId) },
    };
    const acknowledged = await queryDicomRemapDb<DicomRemapJobRow>(
      `update dicom_remap_jobs set status = 'remapped', processing_stage = 'enqueueing_send', processing_selection_counts = $2::jsonb, updated_at = now() where id = $1 and status = 'awaiting_confirmation' and processing_stage = 'awaiting_send_confirmation' returning *`,
      [cleanJobId, JSON.stringify(selectionCounts)]
    );
    const acknowledgedJob = acknowledged.rows[0];
    if (!acknowledgedJob) throw new HttpError(409, "Partial-study confirmation state changed before send.");
    await logDicomRemapAuditEntry({ entityType: "dicom_remap_job", entityId: acknowledgedJob.id, actionType: "dicom_remap_partial_study_acknowledged", oldValues: { status: "awaiting_confirmation", processingStage: "awaiting_send_confirmation" }, newValues: { status: "remapped", processingStage: "enqueueing_send", selectionCounts }, changedByUserId: currentUserId });
    return sendExistingDicomRemapJobToDestination({ job: acknowledgedJob, currentUserId, auditActionType: "pacs_send_enqueued" });
  };
  const claimResult = await queryDicomRemapDb<DicomRemapJobRow>(
    `
      update dicom_remap_jobs
      set status = 'remapped',
          updated_at = now()
      where id = $1
        and status = 'awaiting_confirmation'
        and processing_stage is distinct from 'awaiting_send_confirmation'
      returning *
    `,
    [cleanJobId]
  );

  const job = claimResult.rows[0];
  if (!job) {
    const currentJob = await loadAccessibleDicomRemapJob(cleanJobId);
    if (currentJob.status === "awaiting_confirmation" && currentJob.processing_stage === "awaiting_send_confirmation") {
      return confirmPartialJob(currentJob);
    }
    if (currentJob.status === "sent") {
      return { job: currentJob };
    }
    throw new HttpError(409, "Job is not awaiting confirmation.", {
      status: currentJob.status,
    });
  }

  try {
    if (!job.source_orthanc_study_id || !job.destination_pacs_key) {
      throw new HttpError(409, "Job does not have source study or destination set.");
    }
    await assertJobSourceStudyExists(job);

    const replacement: OrthancPatientSummary = {
      patientId: job.replacement_patient_id || "",
      patientName: job.replacement_patient_name || "",
      patientSex: job.replacement_patient_sex || "",
      patientBirthDate: job.replacement_patient_birth_date || "",
    };

    if (!replacement.patientId || !replacement.patientName) {
      throw new HttpError(409, "Replacement identity fields are missing.");
    }

    const modifiedStudyId = await createModifiedStudyCopy(job.source_orthanc_study_id, replacement);

    const remappedResult = await queryDicomRemapDb<DicomRemapJobRow>(
      `
        update dicom_remap_jobs
        set status = 'remapped',
            modified_orthanc_study_id = $2,
            updated_at = now()
        where id = $1
        and status = 'remapped'
        returning *
      `,
      [job.id, modifiedStudyId]
    );
    if (!remappedResult.rows[0]) {
      const currentJob = await loadAccessibleDicomRemapJob(job.id);
      throw new HttpError(409, "Job status changed before send could start.", {
        status: currentJob.status,
      });
    }
    return sendExistingDicomRemapJobToDestination({
      job: remappedResult.rows[0],
      currentUserId,
      auditActionType: "pacs_send_enqueued",
    });
  } catch (error) {
    const current = await loadAccessibleDicomRemapJob(job.id).catch(() => null);
    if (current && current.status !== "failed") {
      const message = error instanceof Error ? error.message : "DICOM remap send failed.";
      await queryDicomRemapDb(
        `
          update dicom_remap_jobs
          set status = 'failed',
              error_message = $2,
              updated_at = now()
          where id = $1
        `,
        [job.id, message]
      );

      await logDicomRemapAuditEntry({
        entityType: "dicom_remap_job",
        entityId: job.id,
        actionType: "confirm_send_failed",
        oldValues: { status: current.status },
        newValues: { status: "failed", errorMessage: message },
        changedByUserId: currentUserId,
      });
    }
    throw error;
  }
}

export async function assertDicomRemapRouteAccess(currentUserId: OptionalUserId): Promise<UserId> {
  const normalized = normalizePositiveInteger(currentUserId, "currentUserId");
  if (!normalized) {
    throw new HttpError(401, "Authentication required.");
  }
  return normalized as UserId;
}

export const __dicomRemapTestables = {
  DICOM_REMAP_INTEGRITY_VERSION,
  REMAP_ORTHANC_OPERATION_TIMEOUT_SECONDS,
  DICOM_REMAP_ORTHANC_STABILITY_TIMEOUT_SECONDS,
  DICOM_REMAP_UPLOAD_CONCURRENCY,
  DICOM_REMAP_PREVIEW_HEADER_BYTES,
  ACTIVE_JOB_STATUSES,
  CANCELLABLE_JOB_STATUSES,
  TERMINAL_JOB_STATUSES,
  isLikelyDicomFile,
  isSkippableDicomRemapFolderEntry,
  isOrthancInvalidDicomUploadRejection,
  deleteOrthancStudyIfExists,
  resetDicomRemapJob,
  clearFailedDicomRemapOrthancStudies,
  hardResetOrthancStudies,
  isDicomRemapActiveStatus,
  isDicomRemapTerminalStatus,
  isDicomRemapCancellableStatus,
  normalizePatientSex,
  normalizeDicomBirthDate,
  normalizeDicomPatientIdForReplace,
  normalizeDicomPatientNameForReplace,
  hasSameReplacementIdentity,
  validateOrthancReplacementIdentity,
  readNaturalizedStudySummary,
  getMyActiveDicomRemapJob,
  rewriteDicomFileForRemap,
  assertRewrittenDicomPixelIntegrity,
  inspectDicomPixelIntegrity,
  inspectMissingPixelSequenceDelimiter,
  prepareDicomForOrthancRecoveryUpload,
  parseOrthancResourceId,
  parseOrthancModifiedStudyId,
  parseOrthancSendJobId,
  parseOrthancUploadResponse,
  resolveStudyIdFromOrthancUploadResponse,
  readParentStudyIdForInstance,
  readStudyInstanceCountFromPayload,
  readStudyInstanceCountBeforeModify,
  readOrthancStudyBeforeModify,
  waitForOrthancStudyStable,
  createModifiedStudyCopy,
  verifyModifiedStudyAfterTimeout,
  verifySendCompletionAfterTimeout,
  enqueueOrthancAsyncStore,
  uploadPersistedRemappedInstance,
  buildDicomRemapOutcomeSummary,
  probeOrthancHealthForRemap,
  verifyOrthancStudyAcceptedSopSet,
  listOrthancStudyInstanceIds,
  sendExistingDicomRemapJobToDestination,
  isDestinationVerificationRequired,
  sanitizeOrthancSendJobResult,
  classifyOrthancSendFailure,
  hasCurrentDicomIntegrityVerification,
  hasUnexpiredOrthancRecovery,
  isOrthancRecoveryEligibleProcessingError,
  processingErrorCode,
  readOrthancModifiedFromStudyId,
  findProvenOrthancRecoveryModifiedChildren,
  isOrthancBulkModifyRouteAvailable,
  describeOrthancPayloadShape,
  sanitizeOrthancResponseSnippet,
  sanitizeOrthancErrorResponse,
  formatOrthancUploadFailureMessage,
  shouldAutomaticallyAttemptOrthancRecovery,
  readOrBuildDicomRemapUidPlan,
  assertJobStatus,
  setQueryForTests(query: DicomRemapQuery): void {
    queryDicomRemapDb = query;
  },
  setAuditLoggerForTests(logger: DicomRemapAuditLogger): void {
    logDicomRemapAuditEntry = logger;
  },
  setOrthancFetchForTests(fetcher: OrthancFetch): void {
    fetchOrthancForRemap = fetcher;
    orthancBulkModifyAvailableForTests = null;
  },
  setPacsNodeGetterForTests(_getter: unknown): void {
    // Deprecated compatibility no-op. DICOM remap destinations now come from Orthanc modalities.
  },
  setSleepForTests(sleep: RemapSleep): void {
    sleepForDicomRemap = sleep;
  },
  setPatientLoaderForTests(loader: DicomRemapPatientLoader): void {
    getPatientForDicomRemap = loader;
  },
  setModalityListerForTests(lister: DicomRemapModalityLister): void {
    listModalitiesForDicomRemap = lister;
  },
  setBulkModifyRouteAvailableForTests(value: boolean | null): void {
    orthancBulkModifyAvailableForTests = value;
  },
  setAfterRemappedInstanceUploadForTests(hook: ((details: { jobId: number; fileIndex: number; studyId: string; body: Buffer }) => void | Promise<void>) | null): void {
    afterRemappedInstanceUploadForTests = hook;
  },
  setAfterOrthancRecoverySourceUploadForTests(hook: ((details: { jobId: number; fileIndex: number; studyId: string; body: Buffer }) => void | Promise<void>) | null): void {
    afterOrthancRecoverySourceUploadForTests = hook;
  },
  setAfterOrthancRecoveryModifyForTests(hook: ((details: { jobId: number; sourceStudyId: string; modifiedStudyId: string }) => void | Promise<void>) | null): void {
    afterOrthancRecoveryModifyForTests = hook;
  },
  setBeforeDicomRemapProcessingCompletionForTests(hook: (() => void | Promise<void>) | null): void {
    beforeDicomRemapProcessingCompletionForTests = hook;
  },
  setMutateStagedRewriteBeforeIntegrityForTests(hook: ((output: Buffer) => Buffer) | null): void {
    mutateStagedRewriteBeforeIntegrityForTests = hook;
  },
  setFailDicomSerializationForTests(value: boolean): void {
    failDicomSerializationForTests = value;
  },
  resetTestOverrides(): void {
    queryDicomRemapDb = pool.query.bind(pool);
    logDicomRemapAuditEntry = logAuditEntry;
    fetchOrthancForRemap = orthancFetch;
    sleepForDicomRemap = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
    getPatientForDicomRemap = getPatientById;
    listModalitiesForDicomRemap = listOrthancRemoteModalities;
    orthancBulkModifyAvailableForTests = null;
    afterRemappedInstanceUploadForTests = null;
    afterOrthancRecoverySourceUploadForTests = null;
    afterOrthancRecoveryModifyForTests = null;
    beforeDicomRemapProcessingCompletionForTests = null;
    mutateStagedRewriteBeforeIntegrityForTests = null;
    failDicomSerializationForTests = false;
  },
};
