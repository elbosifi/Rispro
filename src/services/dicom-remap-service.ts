import { Buffer } from "node:buffer";
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

interface OrthancStudyModifyPreflight {
  sourceStudyId: string;
  studyResponse: OrthancFetchResult;
  instanceCount: number | null;
}

interface OrthancUploadResponseIdentifiers {
  parentStudyIds: string[];
  instanceIds: string[];
}

interface ConfirmComparison {
  original: OrthancPatientSummary;
  replacement: OrthancPatientSummary;
}

const ACTIVE_JOB_STATUSES: DicomRemapJobStatus[] = ["uploaded", "awaiting_confirmation", "remapped", "sending"];
const CANCELLABLE_JOB_STATUSES: DicomRemapJobStatus[] = ["uploaded", "awaiting_confirmation"];
const TERMINAL_JOB_STATUSES: DicomRemapJobStatus[] = ["sent", "failed", "cancelled"];
let queryDicomRemapDb: DicomRemapQuery = pool.query.bind(pool);
let logDicomRemapAuditEntry: DicomRemapAuditLogger = logAuditEntry;
let fetchOrthancForRemap: OrthancFetch;

function joinUrl(baseUrl: string, suffix: string): string {
  const cleanBase = baseUrl.endsWith("/") ? baseUrl.slice(0, -1) : baseUrl;
  const cleanSuffix = suffix.startsWith("/") ? suffix : `/${suffix}`;
  return `${cleanBase}${cleanSuffix}`;
}

function sanitizeFileName(value: unknown): string {
  return String(value || "dicom.dcm").trim().replace(/[^a-zA-Z0-9._-]/g, "_");
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

    const requestInit: RequestInit & { dispatcher?: unknown } = {
      method: options.method || "GET",
      headers,
      signal: controller.signal,
    };

    if (options.body !== undefined) {
      requestInit.body = typeof options.body === "string"
        ? options.body
        : Buffer.isBuffer(options.body)
          ? new Uint8Array(options.body)
          : JSON.stringify(options.body);
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
  const activeJobId = await readActiveDicomRemapJobId(userId);
  if (activeJobId) {
    throwActiveDicomRemapJobConflict(activeJobId);
  }
}

async function readActiveDicomRemapJobId(userId: UserId): Promise<number | null> {
  const { rows } = await queryDicomRemapDb<{ id: number }>(
    `
      select id
      from dicom_remap_jobs
      where created_by_user_id = $1
        and status = any($2::text[])
      order by created_at desc
      limit 1
    `,
    [userId, ACTIVE_JOB_STATUSES]
  );

  return rows[0]?.id ? Number(rows[0].id) : null;
}

function throwActiveDicomRemapJobConflict(activeJobId: number | null): never {
  throw new HttpError(
    409,
    "You already have an active DICOM remap job. Resume it from recent jobs.",
    activeJobId ? { activeJobId } : null
  );
}

async function readStudyPatientSummary(studyId: string): Promise<OrthancPatientSummary> {
  const response = await orthancFetch(`/studies/${encodeURIComponent(studyId)}`, { method: "GET" });
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
    patientId: extractTagCandidate(mergedTags, ["PatientID"]),
    patientName: extractTagCandidate(mergedTags, ["PatientName"]),
    patientSex: normalizePatientSex(extractTagCandidate(mergedTags, ["PatientSex"])),
    patientBirthDate: normalizeDicomBirthDate(extractTagCandidate(mergedTags, ["PatientBirthDate"])),
  };
}

async function readOrthancStudyBeforeModify(sourceStudyId: string): Promise<OrthancStudyModifyPreflight> {
  const studyResponse = await fetchOrthancForRemap(`/studies/${encodeURIComponent(sourceStudyId)}`, { method: "GET" });
  const instanceCount = await readStudyInstanceCountBeforeModify(sourceStudyId, studyResponse.json);

  if (studyResponse.ok && studyResponse.json && typeof studyResponse.json === "object") {
    return {
      sourceStudyId,
      studyResponse,
      instanceCount,
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
    `DICOM remap source study no longer exists in Orthanc (sourceStudyId=${sourceStudyId}, status=${studyResponse.status}, body=${sanitizeOrthancResponseSnippet(studyResponse.text)}, shape=${describeOrthancPayloadShape(studyResponse.json)}).`
  );
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
    patientId,
    patientName,
    patientSex,
    patientBirthDate,
  };
}

async function createModifiedStudyCopy(sourceStudyId: string, replacement: OrthancPatientSummary): Promise<string> {
  const preflight = await readOrthancStudyBeforeModify(sourceStudyId);
  const modifyPayload = {
    Replace: {
      PatientID: replacement.patientId,
      PatientName: replacement.patientName,
      PatientSex: replacement.patientSex,
      PatientBirthDate: replacement.patientBirthDate,
    },
    KeepSource: true,
    Force: true,
  };
  const response = await fetchOrthancForRemap(`/studies/${encodeURIComponent(sourceStudyId)}/modify`, {
    method: "POST",
    body: modifyPayload,
  });

  if (!response.ok) {
    const responseSnippet = sanitizeOrthancResponseSnippet(response.text);
    const responseShape = describeOrthancPayloadShape(response.json);
    const requestPayloadShape = describeOrthancPayloadShape(modifyPayload);
    console.error("Orthanc study modify failed.", {
      sourceStudyId,
      studyPreflightStatus: preflight.studyResponse.status,
      instanceCount: preflight.instanceCount,
      modifyStatus: response.status,
      modifyResponseBody: responseSnippet,
      modifyResponseShape: responseShape,
      modifyPayloadShape: requestPayloadShape,
    });

    if (response.status === 404) {
      throw new HttpError(
        502,
        `Orthanc modify endpoint rejected this DICOM study (sourceStudyId=${sourceStudyId}, instances=${preflight.instanceCount ?? "unknown"}, status=${response.status}, body=${responseSnippet}, shape=${responseShape}).`
      );
    }

    throw new HttpError(
      502,
      `Orthanc study modify failed (sourceStudyId=${sourceStudyId}, instances=${preflight.instanceCount ?? "unknown"}, status=${response.status}, body=${responseSnippet}, shape=${responseShape}).`
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
  const response = await orthancFetch(`/modalities/${encodeURIComponent(modalityKey)}`, {
    method: "PUT",
    body: {
      AET: node.called_ae_title,
      Host: node.host,
      Port: Number(node.port),
    },
  });

  if (!response.ok) {
    throw new HttpError(502, `Failed to register Orthanc modality destination (status=${response.status}).`);
  }
}

async function sendStudyToOrthancModality(studyId: string, modalityKey: string): Promise<unknown> {
  const payloadCandidates: unknown[] = [
    studyId,
    { Resources: [studyId] },
    { resources: [studyId] },
  ];

  for (const payload of payloadCandidates) {
    const response = await orthancFetch(`/modalities/${encodeURIComponent(modalityKey)}/store`, {
      method: "POST",
      body: payload,
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
    const response = await orthancFetch(`/studies/${encodeURIComponent(studyId)}/store`, {
      method: "POST",
      body: payload,
    });
    if (response.ok || response.status === 202) {
      return response.json ?? response.text ?? null;
    }
  }

  throw new HttpError(502, "Orthanc store-to-modality request failed.");
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

export async function createDicomRemapUploadJob({
  files,
  currentUserId,
}: {
  files: DicomRemapUploadFileInput[];
  currentUserId: UserId;
}): Promise<{ job: DicomRemapJobRow; summary: OrthancPatientSummary }> {
  if (!Array.isArray(files) || files.length === 0) {
    throw new HttpError(400, "At least one DICOM file is required.");
  }

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

  try {
    const studyIds = new Set<string>();

    for (const file of files) {
      const fileName = sanitizeFileName(file.fileName);
      const mimeType = String(file.mimeType || "application/octet-stream").trim();

      if (!isLikelyDicomFile(fileName, mimeType)) {
        throw new HttpError(400, `File "${fileName}" is not an accepted DICOM file.`);
      }

      const content = decodeBase64(file.fileContentBase64);

      const uploadResponse = await orthancFetch("/instances", {
        method: "POST",
        body: content,
        contentType: "application/dicom",
      });

      if (!uploadResponse.ok) {
        throw new HttpError(
          400,
          `Orthanc rejected "${fileName}" as non-DICOM or invalid content.`,
          {
            fileName,
            orthancStatus: uploadResponse.status,
            orthancResponse: String(uploadResponse.text || "").slice(0, 400),
          }
        );
      }

      const parentStudyId = await resolveStudyIdFromOrthancUploadResponse(uploadResponse);
      studyIds.add(parentStudyId);
    }

    if (studyIds.size !== 1) {
      throw new HttpError(400, "Uploaded files must belong to exactly one study.");
    }

    const sourceStudyId = Array.from(studyIds)[0];
    const summary = await readStudyPatientSummary(sourceStudyId);

    const updateResult = await queryDicomRemapDb<DicomRemapJobRow>(
      `
        update dicom_remap_jobs
        set
          source_orthanc_study_id = $2,
          original_patient_id = $3,
          original_patient_name = $4,
          original_patient_sex = $5,
          original_patient_birth_date = $6,
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
      },
      changedByUserId: currentUserId,
    });

    return { job: updatedJob, summary };
  } catch (error) {
    const message = error instanceof Error ? error.message : "DICOM upload failed.";
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
    throw error;
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
  if (!job.source_orthanc_study_id) {
    throw new HttpError(409, "Uploaded Orthanc study ID is missing for this job.");
  }

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

    const replacement: OrthancPatientSummary = {
      patientId: job.replacement_patient_id || "",
      patientName: job.replacement_patient_name || "",
      patientSex: job.replacement_patient_sex || "",
      patientBirthDate: job.replacement_patient_birth_date || "",
    };

    if (!replacement.patientId || !replacement.patientName) {
      throw new HttpError(409, "Replacement identity fields are missing.");
    }

    const destinationNodeId = normalizePositiveInteger(job.destination_pacs_key, "destinationPacsKey");
    if (!destinationNodeId) {
      throw new HttpError(409, "destinationPacsKey is missing.");
    }
    const destinationNode = await getPacsNode(destinationNodeId);
    if (!destinationNode.is_active) {
      throw new HttpError(400, "Selected PACS destination is inactive.");
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

    const modalityKey = `RISPRO_NODE_${destinationNode.id}`;
    await ensureOrthancModalityFromPacsNode(destinationNode, modalityKey);
    const sendResult = await sendStudyToOrthancModality(modifiedStudyId, modalityKey);

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
      actionType: "confirm_send",
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
    const failed = await queryDicomRemapDb<DicomRemapJobRow>(
      `
        update dicom_remap_jobs
        set status = 'failed',
            error_message = $2,
            updated_at = now()
        where id = $1
        returning *
      `,
      [job.id, message]
    );
    const failedJob = failed.rows[0];

    await logDicomRemapAuditEntry({
      entityType: "dicom_remap_job",
      entityId: job.id,
      actionType: "confirm_send_failed",
      oldValues: { status: job.status },
      newValues: { status: "failed", errorMessage: message },
      changedByUserId: currentUserId,
    });

    if (failedJob) {
      return { job: failedJob };
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
  ACTIVE_JOB_STATUSES,
  CANCELLABLE_JOB_STATUSES,
  TERMINAL_JOB_STATUSES,
  isLikelyDicomFile,
  isDicomRemapActiveStatus,
  isDicomRemapTerminalStatus,
  isDicomRemapCancellableStatus,
  isUniqueViolation,
  normalizePatientSex,
  normalizeDicomBirthDate,
  parseOrthancResourceId,
  parseOrthancUploadResponse,
  resolveStudyIdFromOrthancUploadResponse,
  readParentStudyIdForInstance,
  readStudyInstanceCountFromPayload,
  readStudyInstanceCountBeforeModify,
  readOrthancStudyBeforeModify,
  createModifiedStudyCopy,
  describeOrthancPayloadShape,
  sanitizeOrthancResponseSnippet,
  assertJobStatus,
  setQueryForTests(query: DicomRemapQuery): void {
    queryDicomRemapDb = query;
  },
  setAuditLoggerForTests(logger: DicomRemapAuditLogger): void {
    logDicomRemapAuditEntry = logger;
  },
  setOrthancFetchForTests(fetcher: OrthancFetch): void {
    fetchOrthancForRemap = fetcher;
  },
  resetTestOverrides(): void {
    queryDicomRemapDb = pool.query.bind(pool);
    logDicomRemapAuditEntry = logAuditEntry;
    fetchOrthancForRemap = orthancFetch;
  },
};
