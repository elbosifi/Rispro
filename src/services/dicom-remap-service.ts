import { Buffer } from "node:buffer";
import { randomUUID } from "node:crypto";
import { createReadStream } from "node:fs";
import { readFile, readdir, rm, stat } from "node:fs/promises";
import { Readable } from "node:stream";
import os from "node:os";
import path from "node:path";
import dcmjs from "dcmjs";
import { pool } from "../db/pool.js";
import { HttpError } from "../utils/http-error.js";
import { normalizeOptionalText, normalizePositiveInteger } from "../utils/normalize.js";
import { getPacsNode, listPacsNodes, type PacsNodeRow } from "./pacs-node-service.js";
import { logAuditEntry } from "./audit-service.js";
import { resolveOrthancSettings } from "./orthanc-settings-resolver.js";
import { getPatientById } from "./patient-service.js";
import type { OptionalUserId, UserId } from "../types/http.js";

type DicomRemapQuery = typeof pool.query;
type DicomRemapAuditLogger = typeof logAuditEntry;
type OrthancFetch = typeof orthancFetch;
type RemapSleep = (ms: number) => Promise<void>;
type PacsNodeGetter = typeof getPacsNode;
const { DicomMessage, DicomMetaDictionary, datasetToBuffer } = dcmjs.data;

export type DicomRemapJobStatus =
  | "uploaded"
  | "awaiting_confirmation"
  | "remapped"
  | "sending"
  | "sent"
  | "failed"
  | "cancelled";

export interface DicomRemapUploadFileInput {
  fileName?: unknown;
  mimeType?: unknown;
  fileContentBase64?: unknown;
}

export interface DicomRemapStagedUploadFile {
  fileName: string;
  mimeType?: string;
  path: string;
  size: number;
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
  error_message: string | null;
  cancellation_reason: string | null;
  created_at: string;
  updated_at: string;
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
const ACTIVE_JOB_STATUSES: DicomRemapJobStatus[] = ["uploaded", "awaiting_confirmation", "remapped", "sending"];
const CANCELLABLE_JOB_STATUSES: DicomRemapJobStatus[] = ["uploaded", "awaiting_confirmation"];
const TERMINAL_JOB_STATUSES: DicomRemapJobStatus[] = ["sent", "failed", "cancelled"];
const REMAP_ORTHANC_OPERATION_TIMEOUT_SECONDS = 60;
let queryDicomRemapDb: DicomRemapQuery = pool.query.bind(pool);
let logDicomRemapAuditEntry: DicomRemapAuditLogger = logAuditEntry;
let fetchOrthancForRemap: OrthancFetch;
let sleepForDicomRemap: RemapSleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
let readPacsNodeForRemap: PacsNodeGetter = getPacsNode;
let orthancBulkModifyAvailableForTests: boolean | null = null;

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

function isUniqueViolation(error: unknown): boolean {
  return (error as { code?: unknown } | null)?.code === "23505";
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

function normalizeDicomPatientName(value: string): string {
  const clean = String(value || "").trim();
  if (!clean) return "";
  if (clean.includes("^")) return clean;
  return clean.replace(/\s+/g, "^");
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
  const clean = String(text || "")
    .replace(/Basic\s+\S+/gi, "Basic [redacted]")
    .replace(/Bearer\s+\S+/gi, "Bearer [redacted]")
    .trim();
  return clean.slice(0, maxLength);
}

function formatOrthancUploadFailureMessage(fileName: string, fileIndex: number, response: OrthancFetchResult): string {
  const body = sanitizeOrthancResponseSnippet(response.text);
  const shape = describeOrthancPayloadShape(response.json);
  return `Orthanc rejected "${fileName}" during DICOM upload (file ${fileIndex}, status=${response.status}, body=${body || "empty"}, shape=${shape}).`;
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
      fileName,
      fileIndex,
      orthancStatus: uploadResponse.status,
      orthancResponseBody: sanitizeOrthancResponseSnippet(uploadResponse.text),
      orthancResponseShape: describeOrthancPayloadShape(uploadResponse.json),
    });

    throw new HttpError(
      400,
      message,
      {
        fileName,
        fileIndex,
        orthancStatus: uploadResponse.status,
        orthancResponse: sanitizeOrthancResponseSnippet(uploadResponse.text),
        orthancResponseShape: describeOrthancPayloadShape(uploadResponse.json),
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
    summary.patientName === replacement.patientName &&
    normalizePatientSex(summary.patientSex) === normalizePatientSex(replacement.patientSex) &&
    normalizeDicomBirthDate(summary.patientBirthDate) === normalizeDicomBirthDate(replacement.patientBirthDate)
  );
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

async function rewriteDicomFileForRemap(
  stagedFile: DicomRemapStagedUploadFile,
  replacement: OrthancPatientSummary,
  uidPlan?: DicomUidRemapPlan,
): Promise<{ body: Buffer; originalSummary: OrthancStudySummary }> {
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
      `RISPro could not rewrite "${stagedFile.fileName}" before upload. Please reset current upload and retry.`,
      {
        fileName: stagedFile.fileName,
        reason: error instanceof Error ? error.message : "Unknown DICOM parse error",
      }
    );
  }

  const dataset = DicomMetaDictionary.naturalizeDataset(dicomFile.dict) as Record<string, unknown>;
  dataset._meta = DicomMetaDictionary.naturalizeDataset(dicomFile.meta) as Record<string, unknown>;

  const originalSummary = readNaturalizedStudySummary(dataset);
  const originalSeriesInstanceUid = readDicomStringValue(dataset.SeriesInstanceUID);
  dataset.PatientID = replacement.patientId;
  dataset.PatientName = replacement.patientName;
  dataset.PatientSex = replacement.patientSex;
  dataset.PatientBirthDate = replacement.patientBirthDate;
  if (uidPlan) {
    dataset.StudyInstanceUID = uidPlan.studyInstanceUid;
    dataset.SeriesInstanceUID = getOrCreateSeriesInstanceUid(originalSeriesInstanceUid, uidPlan);
    const newSopInstanceUid = createDicomUid();
    dataset.SOPInstanceUID = newSopInstanceUid;
    if (dataset._meta && typeof dataset._meta === "object") {
      (dataset._meta as Record<string, unknown>).MediaStorageSOPInstanceUID = newSopInstanceUid;
    }
  }

  return {
    body: Buffer.from(datasetToBuffer(dataset)),
    originalSummary,
  };
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
  replacement: OrthancPatientSummary
): Promise<string | null> {
  if (!preflight.parentPatientId) {
    return null;
  }

  const afterStudyIds = await readPatientStudyIds(preflight.parentPatientId);
  const beforeSet = new Set(preflight.patientStudyIds);
  const candidates = afterStudyIds.filter((studyId) => !beforeSet.has(studyId) && studyId !== preflight.sourceStudyId);

  for (const candidateId of candidates) {
    try {
      const summary = await readStudySummary(candidateId);
      if (hasSameReplacementIdentity(summary, replacement)) {
        return candidateId;
      }
    } catch {
      continue;
    }
  }

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
      throw new HttpError(504, `Orthanc request timed out after ${timeoutMs}ms.`);
    }
    throw new HttpError(502, `Orthanc request failed: ${(error as Error).message || "unknown_error"}`);
  } finally {
    clearTimeout(timeout);
  }
}

fetchOrthancForRemap = orthancFetch;

async function assertNoActiveUserJob(userId: UserId): Promise<void> {
  const activeJob = await readActiveDicomRemapJob(userId);
  if (!activeJob) {
    return;
  }

  if (await markStaleActiveJobFailedIfSourceMissing(activeJob)) {
    return;
  }

  throwActiveDicomRemapJobConflict(activeJob.id);
}

async function readActiveDicomRemapJobId(userId: UserId): Promise<number | null> {
  const activeJob = await readActiveDicomRemapJob(userId);
  return activeJob?.id ? Number(activeJob.id) : null;
}

async function readActiveDicomRemapJob(userId: UserId): Promise<DicomRemapJobRow | null> {
  const { rows } = await queryDicomRemapDb<DicomRemapJobRow>(
    `
      select *
      from dicom_remap_jobs
      where created_by_user_id = $1
        and status = any($2::text[])
      order by created_at desc
      limit 1
    `,
    [userId, ACTIVE_JOB_STATUSES]
  );

  return rows[0] || null;
}

function throwActiveDicomRemapJobConflict(activeJobId: number | null): never {
  throw new HttpError(
    409,
    "You already have an active DICOM remap job. Resume it from recent jobs.",
    activeJobId ? { activeJobId } : null
  );
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

  return validateOrthancReplacementIdentity({
    patientId,
    patientName,
    patientSex,
    patientBirthDate,
  });
}

async function tryBulkModifiedStudyCopy(
  sourceStudyId: string,
  modifyPayload: {
    Replace: {
      PatientID: string;
      PatientName: string;
      PatientSex: string;
      PatientBirthDate: string;
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
  options: { stabilityTimeoutMs?: number } = {},
): Promise<string> {
  const validatedReplacement = validateOrthancReplacementIdentity(replacement);
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
      PatientID: validatedReplacement.patientId,
      PatientName: validatedReplacement.patientName,
      PatientSex: validatedReplacement.patientSex,
      PatientBirthDate: validatedReplacement.patientBirthDate,
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
      const verifiedStudyId = await verifyModifiedStudyAfterTimeout(preflight, validatedReplacement);
      if (verifiedStudyId) {
        return verifiedStudyId;
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

async function ensureOrthancModalityFromPacsNode(node: PacsNodeRow, modalityKey: string): Promise<void> {
  const response = await fetchOrthancForRemap(`/modalities/${encodeURIComponent(modalityKey)}`, {
    method: "PUT",
    body: {
      AET: node.called_ae_title,
      Host: node.host,
      Port: Number(node.port),
    },
    timeoutSeconds: REMAP_ORTHANC_OPERATION_TIMEOUT_SECONDS,
  });

  if (!response.ok) {
    throw new HttpError(502, `Failed to register Orthanc modality destination (status=${response.status}).`);
  }
}

async function sendStudyToOrthancModality(studyId: string, modalityKey: string): Promise<unknown> {
  const attempts: Array<Record<string, unknown>> = [];
  const payloadCandidates: unknown[] = [
    studyId,
    { Resources: [studyId] },
    { resources: [studyId] },
  ];

  for (const payload of payloadCandidates) {
    const response = await fetchOrthancForRemap(`/modalities/${encodeURIComponent(modalityKey)}/store`, {
      method: "POST",
      body: payload,
      timeoutSeconds: REMAP_ORTHANC_OPERATION_TIMEOUT_SECONDS,
    });
    attempts.push({
      path: `/modalities/${modalityKey}/store`,
      status: response.status,
      body: sanitizeOrthancResponseSnippet(response.text),
      shape: describeOrthancPayloadShape(response.json),
      payloadShape: describeOrthancPayloadShape(payload),
    });

    if (response.ok || response.status === 202) {
      return response.json ?? response.text ?? null;
    }
  }

  const studyStoreCandidates: unknown[] = [
    modalityKey,
    { Target: modalityKey },
  ];

  for (const payload of studyStoreCandidates) {
    const response = await fetchOrthancForRemap(`/studies/${encodeURIComponent(studyId)}/store`, {
      method: "POST",
      body: payload,
      timeoutSeconds: REMAP_ORTHANC_OPERATION_TIMEOUT_SECONDS,
    });
    attempts.push({
      path: `/studies/${studyId}/store`,
      status: response.status,
      body: sanitizeOrthancResponseSnippet(response.text),
      shape: describeOrthancPayloadShape(response.json),
      payloadShape: describeOrthancPayloadShape(payload),
    });
    if (response.ok || response.status === 202) {
      return response.json ?? response.text ?? null;
    }
  }

  throw new HttpError(
    502,
    "Orthanc could not send the remapped study to PACS. Please verify the destination and try resend.",
    {
      studyId,
      modalityKey,
      attempts,
    }
  );
}

function resolveSendStudyIdForJob(job: DicomRemapJobRow): string {
  return String(job.modified_orthanc_study_id || job.source_orthanc_study_id || "").trim();
}

async function sendExistingDicomRemapJobToDestination({
  job,
  currentUserId,
  auditActionType,
  failedAuditActionType,
}: {
  job: DicomRemapJobRow;
  currentUserId: UserId;
  auditActionType: string;
  failedAuditActionType: string;
}): Promise<{ job: DicomRemapJobRow }> {
  const sendStudyId = resolveSendStudyIdForJob(job);
  if (!sendStudyId || !job.destination_pacs_key) {
    throw new HttpError(409, "Job does not have a remapped study or destination set.");
  }

  const exists = await readOrthancStudyExists(sendStudyId);
  if (!exists) {
    throw new HttpError(409, "Remapped study no longer exists in Orthanc. Please upload again.");
  }

  const destinationNodeId = normalizePositiveInteger(job.destination_pacs_key, "destinationPacsKey");
  if (!destinationNodeId) {
    throw new HttpError(409, "destinationPacsKey is missing.");
  }

  const destinationNode = await readPacsNodeForRemap(destinationNodeId);
  if (!destinationNode.is_active) {
    throw new HttpError(400, "Selected PACS destination is inactive.");
  }

  let sendingJob: DicomRemapJobRow | null = null;
  if (job.status === "sending") {
    sendingJob = job;
  } else {
    const sendClaim = await queryDicomRemapDb<DicomRemapJobRow>(
      `
        update dicom_remap_jobs
        set status = 'sending',
            updated_at = now()
        where id = $1
          and created_by_user_id = $2
          and status = any($3::text[])
        returning *
      `,
      [job.id, currentUserId, ["remapped", "failed", "sent"]]
    );

    sendingJob = sendClaim.rows[0] || null;
    if (!sendingJob) {
      const currentJob = await loadOwnedJob(job.id, currentUserId);
      throw new HttpError(409, "Job is not ready for resend.", { status: currentJob.status });
    }
  }

  try {
    const modalityKey = `RISPRO_NODE_${destinationNode.id}`;
    await ensureOrthancModalityFromPacsNode(destinationNode, modalityKey);
    let sendResult: unknown;
    try {
      sendResult = await sendStudyToOrthancModality(sendStudyId, modalityKey);
    } catch (error) {
      if (!isOrthancTimeoutError(error)) {
        throw error;
      }
      const verifiedSendResult = await verifySendCompletionAfterTimeout(sendStudyId, modalityKey);
      if (!verifiedSendResult) {
        throw new HttpError(
          502,
          `Orthanc send timed out and completion could not be verified (studyId=${sendStudyId}, modalityKey=${modalityKey}).`
        );
      }
      sendResult = verifiedSendResult;
    }

    const result = await queryDicomRemapDb<DicomRemapJobRow>(
      `
        update dicom_remap_jobs
        set status = 'sent',
            send_result = $2::jsonb,
            error_message = null,
            updated_at = now()
        where id = $1
        returning *
      `,
      [job.id, JSON.stringify(sendResult ?? {})]
    );
    const finalJob = result.rows[0];
    if (!finalJob) {
      throw new HttpError(500, "Failed to finalize DICOM remap send result.");
    }

    await logDicomRemapAuditEntry({
      entityType: "dicom_remap_job",
      entityId: finalJob.id,
      actionType: auditActionType,
      oldValues: { status: job.status },
      newValues: {
        status: finalJob.status,
        sourceOrthancStudyId: finalJob.source_orthanc_study_id,
        modifiedOrthancStudyId: finalJob.modified_orthanc_study_id,
        destinationPacsKey: finalJob.destination_pacs_key,
      },
      changedByUserId: currentUserId,
    });

    return { job: finalJob };
  } catch (error) {
    const message = error instanceof Error ? error.message : "DICOM remap send failed.";
    await queryDicomRemapDb<DicomRemapJobRow>(
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
      actionType: failedAuditActionType,
      oldValues: { status: sendingJob.status },
      newValues: { status: "failed", errorMessage: message },
      changedByUserId: currentUserId,
    });

    throw error;
  }
}

async function loadOwnedJob(jobId: number | string, userId: UserId): Promise<DicomRemapJobRow> {
  const cleanJobId = normalizePositiveInteger(jobId, "jobId");
  const { rows } = await queryDicomRemapDb<DicomRemapJobRow>(
    `
      select *
      from dicom_remap_jobs
      where id = $1
        and created_by_user_id = $2
      limit 1
    `,
    [cleanJobId, userId]
  );

  const job = rows[0];
  if (!job) {
    throw new HttpError(404, "DICOM remap job not found.");
  }
  return job;
}

async function createEmptyDicomRemapUploadJob(currentUserId: UserId): Promise<DicomRemapJobRow> {
  await assertNoActiveUserJob(currentUserId);

  let createResult: { rows: DicomRemapJobRow[] };
  try {
    createResult = await queryDicomRemapDb<DicomRemapJobRow>(
      `
        insert into dicom_remap_jobs (
          created_by_user_id,
          status
        )
        values ($1, 'uploaded')
        returning *
      `,
      [currentUserId]
    );
  } catch (error) {
    if (isUniqueViolation(error)) {
      const activeJobId = await readActiveDicomRemapJobId(currentUserId);
      throwActiveDicomRemapJobConflict(activeJobId);
    }
    throw error;
  }

  const job = createResult.rows[0];
  if (!job) {
    throw new HttpError(500, "Failed to create DICOM remap job.");
  }
  return job;
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
  const destinationNodeId = normalizePositiveInteger(destinationPacsKey, "destinationPacsKey");
  if (!patientId) {
    throw new HttpError(400, "risproPatientId is required.");
  }
  if (!destinationNodeId) {
    throw new HttpError(400, "destinationPacsKey is required.");
  }

  let job: DicomRemapJobRow | null = null;

  try {
    const patient = await getPatientById(patientId);
    const replacement = formatReplacementFromPatient(patient);
    const destinationNode = await readPacsNodeForRemap(destinationNodeId);
    if (!destinationNode.is_active) {
      throw new HttpError(400, "Selected PACS destination is inactive.");
    }

    job = await createEmptyDicomRemapUploadJob(currentUserId);

    const studyIds = new Set<string>();
    let uploadedFileCount = 0;
    let skippedFilesCount = 0;
    let originalSummary: OrthancStudySummary | null = null;
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
      const rewritten = await rewriteDicomFileForRemap(entry.file, replacement, uidPlan);
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
    if (!hasSameReplacementIdentity(uploadedSummary, replacement)) {
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
        String(destinationNode.id),
        originalSummary.patientId,
        originalSummary.patientName,
        originalSummary.patientSex,
        originalSummary.patientBirthDate,
        replacement.patientId,
        replacement.patientName,
        replacement.patientSex,
        replacement.patientBirthDate,
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
      auditActionType: "confirm_send",
      failedAuditActionType: "process_upload_send_failed",
    });

    return { job: sentResult.job, skippedFilesCount };
  } catch (error) {
    if (job) {
      const current = await loadOwnedJob(job.id, currentUserId).catch(() => null);
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
  currentUserId,
}: {
  jobId: number | string;
  currentUserId: UserId;
}): Promise<{ job: DicomRemapJobRow; comparison: ConfirmComparison | null }> {
  const job = await loadOwnedJob(jobId, currentUserId);
  const comparison = job.replacement_patient_id
    ? {
      original: {
        patientId: job.original_patient_id || "",
        patientName: job.original_patient_name || "",
        patientSex: job.original_patient_sex || "",
        patientBirthDate: job.original_patient_birth_date || "",
      },
      replacement: {
        patientId: job.replacement_patient_id || "",
        patientName: job.replacement_patient_name || "",
        patientSex: job.replacement_patient_sex || "",
        patientBirthDate: job.replacement_patient_birth_date || "",
      },
    }
    : null;
  return { job, comparison };
}

export async function listMyDicomRemapJobs({
  currentUserId,
  limit = 20,
}: {
  currentUserId: UserId;
  limit?: number;
}): Promise<DicomRemapJobRow[]> {
  const cleanLimit = Math.min(Math.max(Number(limit) || 20, 1), 100);
  const { rows } = await queryDicomRemapDb<DicomRemapJobRow>(
    `
      select *
      from dicom_remap_jobs
      where created_by_user_id = $1
      order by created_at desc
      limit $2
    `,
    [currentUserId, cleanLimit]
  );
  return rows;
}

export async function listDicomRemapDestinations(): Promise<Array<{ key: string; id: number; name: string }>> {
  const nodes = await listPacsNodes({ includeInactive: false });
  return nodes
    .filter((node) => node.is_active)
    .map((node) => ({
      key: String(node.id),
      id: node.id,
      name: node.name,
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
          cancellation_reason = nullif($3, ''),
          updated_at = now()
      where id = $1
        and created_by_user_id = $2
        and status = any($4::text[])
      returning *
    `,
    [cleanJobId, currentUserId, cleanReason, CANCELLABLE_JOB_STATUSES]
  );

  const cancelledJob = result.rows[0];
  if (cancelledJob) {
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

  const currentJob = await loadOwnedJob(cleanJobId, currentUserId);
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
  const job = await loadOwnedJob(jobId, currentUserId);
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
        and created_by_user_id = $2
      returning *
    `,
    [job.id, currentUserId]
  );
  const resetJob = updateResult.rows[0];
  if (!resetJob) {
    throw new HttpError(500, "Failed to reset DICOM remap job.");
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
  const job = await loadOwnedJob(jobId, currentUserId);
  assertJobStatus(job.status, "uploaded", "Job is not in uploaded state.");
  await assertJobSourceStudyExists(job);

  const patientId = normalizePositiveInteger(risproPatientId, "risproPatientId");
  const destinationNodeId = normalizePositiveInteger(destinationPacsKey, "destinationPacsKey");
  if (!patientId) {
    throw new HttpError(400, "risproPatientId is required.");
  }
  if (!destinationNodeId) {
    throw new HttpError(400, "destinationPacsKey is required.");
  }

  const patient = await getPatientById(patientId);
  const destinationNode = await getPacsNode(destinationNodeId);
  if (!destinationNode.is_active) {
    throw new HttpError(400, "Selected PACS destination is inactive.");
  }

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
      String(destinationNode.id),
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
  const patient = await getPatientById(patientId);
  const replacement = formatReplacementFromPatient(patient);
  if (!replacement.patientId || !replacement.patientName) {
    throw new HttpError(400, "Selected patient does not have enough identity fields for DICOM replacement.");
  }
  return replacement;
}

export async function resendDicomRemapJobToPacs({
  jobId,
  currentUserId,
}: {
  jobId: number | string;
  currentUserId: UserId;
}): Promise<{ job: DicomRemapJobRow }> {
  const job = await loadOwnedJob(jobId, currentUserId);
  if (!["failed", "remapped", "sent"].includes(job.status)) {
    throw new HttpError(409, "Only remapped, failed, or sent jobs can be resent to PACS.", {
      status: job.status,
    });
  }

  return sendExistingDicomRemapJobToDestination({
    job,
    currentUserId,
    auditActionType: "resend_to_pacs",
    failedAuditActionType: "resend_to_pacs_failed",
  });
}

export async function confirmDicomRemapAndSend({
  jobId,
  confirm,
  currentUserId,
}: {
  jobId: number | string;
  confirm: boolean;
  currentUserId: UserId;
}): Promise<{ job: DicomRemapJobRow }> {
  if (!confirm) {
    throw new HttpError(400, "Explicit confirmation is required.");
  }

  const cleanJobId = normalizePositiveInteger(jobId, "jobId");
  if (!cleanJobId) {
    throw new HttpError(400, "jobId is required.");
  }
  const claimResult = await queryDicomRemapDb<DicomRemapJobRow>(
    `
      update dicom_remap_jobs
      set status = 'remapped',
          updated_at = now()
      where id = $1
        and created_by_user_id = $2
        and status = 'awaiting_confirmation'
      returning *
    `,
    [cleanJobId, currentUserId]
  );

  const job = claimResult.rows[0];
  if (!job) {
    const currentJob = await loadOwnedJob(cleanJobId, currentUserId);
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

    const sendingResult = await queryDicomRemapDb<DicomRemapJobRow>(
      `
        update dicom_remap_jobs
        set status = 'sending',
            modified_orthanc_study_id = $2,
            updated_at = now()
        where id = $1
          and status = 'remapped'
        returning *
      `,
      [job.id, modifiedStudyId]
    );
    if (!sendingResult.rows[0]) {
      const currentJob = await loadOwnedJob(job.id, currentUserId);
      throw new HttpError(409, "Job status changed before send could start.", {
        status: currentJob.status,
      });
    }
    return sendExistingDicomRemapJobToDestination({
      job: sendingResult.rows[0],
      currentUserId,
      auditActionType: "confirm_send",
      failedAuditActionType: "confirm_send_failed",
    });
  } catch (error) {
    const current = await loadOwnedJob(job.id, currentUserId).catch(() => null);
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

export function validateDicomRemapUploadFilesInput(value: unknown): DicomRemapUploadFileInput[] {
  if (!Array.isArray(value) || value.length === 0) {
    throw new HttpError(400, "files must be a non-empty array.");
  }
  return value as DicomRemapUploadFileInput[];
}

export function validateExplicitConfirm(value: unknown): boolean {
  return value === true || String(value || "").trim().toLowerCase() === "true";
}

export async function assertDicomRemapRouteAccess(currentUserId: OptionalUserId): Promise<UserId> {
  const normalized = normalizePositiveInteger(currentUserId, "currentUserId");
  if (!normalized) {
    throw new HttpError(401, "Authentication required.");
  }
  return normalized as UserId;
}

export const __dicomRemapTestables = {
  REMAP_ORTHANC_OPERATION_TIMEOUT_SECONDS,
  DICOM_REMAP_UPLOAD_CONCURRENCY,
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
  isUniqueViolation,
  normalizePatientSex,
  normalizeDicomBirthDate,
  normalizeDicomPatientIdForReplace,
  normalizeDicomPatientNameForReplace,
  validateOrthancReplacementIdentity,
  readNaturalizedStudySummary,
  rewriteDicomFileForRemap,
  parseOrthancResourceId,
  parseOrthancModifiedStudyId,
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
  isOrthancBulkModifyRouteAvailable,
  describeOrthancPayloadShape,
  sanitizeOrthancResponseSnippet,
  formatOrthancUploadFailureMessage,
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
  setPacsNodeGetterForTests(getter: PacsNodeGetter): void {
    readPacsNodeForRemap = getter;
  },
  setSleepForTests(sleep: RemapSleep): void {
    sleepForDicomRemap = sleep;
  },
  setBulkModifyRouteAvailableForTests(value: boolean | null): void {
    orthancBulkModifyAvailableForTests = value;
  },
  resetTestOverrides(): void {
    queryDicomRemapDb = pool.query.bind(pool);
    logDicomRemapAuditEntry = logAuditEntry;
    fetchOrthancForRemap = orthancFetch;
    sleepForDicomRemap = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
    readPacsNodeForRemap = getPacsNode;
    orthancBulkModifyAvailableForTests = null;
  },
};
