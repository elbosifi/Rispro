import os from "os";
import { pool } from "../db/pool.js";
import { HttpError } from "../utils/http-error.js";
import { logAuditEntry } from "./audit-service.js";
import { loadSettingsMap } from "./settings-service.js";
import type { UnknownRecord, OptionalUserId } from "../types/http.js";

// Lazy-load native DICOM module to prevent crash on platforms where it's not built
let dimse: any = null;

function getDimseModule() {
  if (!dimse) {
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      dimse = require("dicom-dimse-native").default;
    } catch {
      throw new HttpError(503, "DICOM native module not available. Please rebuild dicom-dimse-native for your platform.");
    }
  }
  return dimse;
}

export interface PacsFindResult {
  patientId?: string;
  patientName?: string;
  accessionNumber?: string;
  studyDate?: string;
  studyDescription?: string;
  modalitiesInStudy?: string;
  numberOfStudyRelatedInstances?: string;
  studyInstanceUid?: string;
}

export interface StudySearchCriteria {
  patientId?: string;
  patientName?: string;
  accessionNumber?: string;
  studyDate?: string;
}

export interface StudySummary {
  patientId: string;
  patientName: string;
  accessionNumber: string;
  modality: string;
  studyDescription: string;
  studyDate: string;
}

export interface PacsSettings {
  enabled: boolean;
  host: string;
  port: number;
  calledAeTitle: string;
  callingAeTitle: string;
  timeoutSeconds: number;
}

const DEFAULT_DIMSE_SOURCE_PORT = 11112;

function parseEnabled(value: unknown): boolean {
  return String(value || "").trim() === "enabled";
}

function parsePositiveInteger(value: unknown, fallback: number): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0 || !Number.isInteger(parsed)) {
    return fallback;
  }
  return parsed;
}

function getDimseSourceIp(): string {
  const interfaces = os.networkInterfaces();

  for (const addresses of Object.values(interfaces)) {
    for (const address of addresses || []) {
      if (address && address.family === "IPv4" && !address.internal) {
        return address.address;
      }
    }
  }

  return "0.0.0.0";
}

function normalizeDateForDicom(value: unknown): string {
  const clean = String(value || "").trim();
  if (!clean) {
    return "";
  }

  if (/^\d{8}$/.test(clean)) {
    return clean;
  }

  if (/^\d{4}-\d{2}-\d{2}$/.test(clean)) {
    return clean.replaceAll("-", "");
  }

  throw new HttpError(400, "studyDate must be in YYYY-MM-DD format.");
}

function normalizeStudySearchCriteria(payload: UnknownRecord = {}): StudySearchCriteria {
  const patientId = String(payload.patientId || payload.patientNationalId || "").trim();
  const patientName = String(payload.patientName || "").trim();
  const accessionNumber = String(payload.accessionNumber || "").trim();
  const studyDate = normalizeDateForDicom(payload.studyDate || "");

  if (!patientId && !patientName && !accessionNumber && !studyDate) {
    throw new HttpError(400, "At least one PACS search field is required.");
  }

  return {
    patientId,
    patientName,
    accessionNumber,
    studyDate
  };
}

function extractTagValue(dataset: unknown, tag: string): string {
  if (!dataset || typeof dataset !== "object") {
    return "";
  }

  const datasetRecord = dataset as UnknownRecord;
  const candidates = [
    datasetRecord[tag],
    datasetRecord[tag?.toUpperCase()],
    datasetRecord[tag?.toLowerCase()]
  ];
  for (const candidate of candidates) {
    if (candidate === undefined || candidate === null) {
      continue;
    }
    if (typeof candidate === "string" || typeof candidate === "number") {
      return String(candidate);
    }
    if (Array.isArray(candidate)) {
      if (!candidate.length) {
        return "";
      }

      const firstValue = candidate[0];
      if (firstValue && typeof firstValue === "object") {
        const firstValueRecord = firstValue as UnknownRecord;
        return String(firstValueRecord.Alphabetic || firstValueRecord.Ideographic || firstValueRecord.Phonetic || "");
      }

      return String(firstValue ?? "");
    }
    if (typeof candidate === "object") {
      const candidateRecord = candidate as UnknownRecord;
      const candidateValue = candidateRecord.Value;
      if (Array.isArray(candidateValue)) {
        if (!candidateValue.length) {
          return "";
        }

        const firstValue = candidateValue[0];
        if (firstValue && typeof firstValue === "object") {
          const firstValueRecord = firstValue as UnknownRecord;
          return String(firstValueRecord.Alphabetic || firstValueRecord.Ideographic || firstValueRecord.Phonetic || "");
        }

        return String(firstValue ?? "");
      }
      if (candidateValue !== undefined) {
        return String(candidateValue ?? "");
      }
      if (candidateRecord.value !== undefined) {
        return String(candidateRecord.value ?? "");
      }
    }
  }

  return "";
}

function extractStudySummary(dataset: UnknownRecord): StudySummary {
  const patientId =
    extractTagValue(dataset, "00100020") ||
    extractTagValue(dataset, "PatientID");
  const patientName =
    extractTagValue(dataset, "00100010") ||
    extractTagValue(dataset, "PatientName");
  const accessionNumber =
    extractTagValue(dataset, "00080050") ||
    extractTagValue(dataset, "AccessionNumber");
  const modality =
    extractTagValue(dataset, "00080060") ||
    extractTagValue(dataset, "Modality");
  const description =
    extractTagValue(dataset, "00081030") ||
    extractTagValue(dataset, "StudyDescription");
  const studyDate =
    extractTagValue(dataset, "00080020") ||
    extractTagValue(dataset, "StudyDate");

  return {
    patientId,
    patientName,
    accessionNumber,
    modality,
    studyDescription: description,
    studyDate
  };
}

function normalizeStudyList(rawResult: unknown): StudySummary[] {
  const candidates: unknown[] = [];

  if (Array.isArray(rawResult)) {
    candidates.push(...rawResult);
  }

  if (rawResult && typeof rawResult === "object") {
    const rawRecord = rawResult as UnknownRecord;
    const possibleArrays = [
      rawRecord.container,
      rawRecord.datasets,
      rawRecord.results,
      rawRecord.responses
    ];

    for (const arrayValue of possibleArrays) {
      if (Array.isArray(arrayValue)) {
        candidates.push(...arrayValue);
      }
    }
  }

  return candidates
    .map((dataset) => extractStudySummary(dataset as UnknownRecord))
    .filter((entry) => entry.patientId || entry.modality || entry.studyDescription || entry.studyDate);
}

function parseDimseResult(result: unknown): UnknownRecord | null {
  if (!result) {
    return null;
  }

  let parsed = result;
  if (typeof result === "string") {
    parsed = JSON.parse(result);
  }

  if (parsed && typeof parsed === "object") {
    const parsedRecord = parsed as UnknownRecord;
    if (parsedRecord.container && typeof parsedRecord.container === "string") {
      try {
        parsedRecord.container = JSON.parse(parsedRecord.container);
      } catch {
        parsedRecord.container = parsedRecord.container;
      }
    }
  }

  return parsed && typeof parsed === "object" ? (parsed as UnknownRecord) : null;
}

async function loadPacsSettings(): Promise<PacsSettings> {
  const settings = await loadSettingsMap(["pacs_connection"]);
  const pacs = settings.pacs_connection || {};

  const enabled = parseEnabled(pacs.enabled || "");
  const host = String(pacs.host || "").trim();
  const port = parsePositiveInteger(pacs.port, 104);
  const calledAeTitle = String(pacs.called_ae_title || "").trim();
  const callingAeTitle = String(pacs.calling_ae_title || "").trim();
  const timeoutSeconds = parsePositiveInteger(pacs.timeout_seconds, 10);

  return {
    enabled,
    host,
    port,
    calledAeTitle,
    callingAeTitle,
    timeoutSeconds
  };
}

function normalizePacsSettingsInput(input: UnknownRecord = {}): PacsSettings {
  return {
    enabled: parseEnabled(input.enabled || "enabled"),
    host: String(input.host || "").trim(),
    port: parsePositiveInteger(input.port, 104),
    calledAeTitle: String(input.calledAeTitle || input.called_ae_title || "").trim(),
    callingAeTitle: String(input.callingAeTitle || input.calling_ae_title || "").trim(),
    timeoutSeconds: parsePositiveInteger(input.timeoutSeconds || input.timeout_seconds, 10)
  };
}

function buildStudySearchTags(criteria: StudySearchCriteria): { key: string; value: string }[] {
  const tags = [
    { key: "00080052", value: "STUDY" },
    { key: "00100010", value: criteria.patientName ? `*${criteria.patientName}*` : "" },
    { key: "00100020", value: criteria.patientId || "" },
    { key: "00080050", value: criteria.accessionNumber || "" },
    { key: "00080020", value: criteria.studyDate || "" },
    { key: "00080060", value: "" },
    { key: "00081030", value: "" }
  ];

  return tags;
}

async function runDimseFindScu({
  criteria,
  host,
  port,
  calledAeTitle,
  callingAeTitle,
  timeoutSeconds
}: {
  criteria: StudySearchCriteria;
  host: string;
  port: number;
  calledAeTitle: string;
  callingAeTitle: string;
  timeoutSeconds: number;
}): Promise<PacsFindResult[]> {
  return new Promise((resolve, reject) => {
    try {
      const sourceIp = getDimseSourceIp();
      const timeoutMs = Math.max(Number(timeoutSeconds) || 10, 1) * 1000;
      const timer = setTimeout(() => {
        reject(new Error("Timed out waiting for PACS response."));
      }, timeoutMs + 2000);
      const options = {
        source: {
          aet: callingAeTitle || "RISPRO",
          ip: sourceIp,
          port: DEFAULT_DIMSE_SOURCE_PORT
        },
        target: {
          aet: calledAeTitle,
          ip: host,
          port: Number(port)
        },
        tags: buildStudySearchTags(criteria),
        timeout: Number(timeoutSeconds),
        verbose: true
      };

      dimse.findScu(options, (result: unknown) => {
        clearTimeout(timer);
        if (!result) {
          resolve([]);
          return;
        }

        const parsed = parseDimseResult(result);
        if (parsed?.error || parsed?.status === "failure") {
          const errorMessage = String(parsed?.error || parsed?.message || "PACS query failed.");
          reject(new Error(errorMessage));
          return;
        }

        resolve((parsed || []) as PacsFindResult[]);
      });
    } catch (error) {
      reject(error);
    }
  });
}

async function runDimseEchoScu({
  host,
  port,
  calledAeTitle,
  callingAeTitle,
  timeoutSeconds
}: {
  host: string;
  port: number;
  calledAeTitle: string;
  callingAeTitle: string;
  timeoutSeconds: number;
}): Promise<boolean> {
  return new Promise((resolve, reject) => {
    try {
      const sourceIp = getDimseSourceIp();
      const timeoutMs = Math.max(Number(timeoutSeconds) || 10, 1) * 1000;
      const timer = setTimeout(() => {
        reject(new Error("Timed out waiting for PACS response."));
      }, timeoutMs + 2000);
      const options = {
        source: {
          aet: callingAeTitle || "RISPRO",
          ip: sourceIp,
          port: DEFAULT_DIMSE_SOURCE_PORT
        },
        target: {
          aet: calledAeTitle,
          ip: host,
          port: Number(port)
        },
        timeout: Number(timeoutSeconds),
        verbose: true
      };

      dimse.echoScu(options, (result: unknown) => {
        clearTimeout(timer);
        if (!result) {
          resolve(false);
          return;
        }

        const parsed = parseDimseResult(result);
        if (parsed?.error || parsed?.status === "failure") {
          const errorMessage = String(parsed?.error || parsed?.message || "PACS echo failed.");
          reject(new Error(errorMessage));
          return;
        }

        resolve(Boolean(parsed));
      });
    } catch (error) {
      reject(error);
    }
  });
}

export async function searchPacsStudies({
  criteria: rawCriteria,
  currentUserId
}: {
  criteria: UnknownRecord;
  currentUserId: OptionalUserId;
}): Promise<StudySummary[]> {
  const criteria = normalizeStudySearchCriteria(rawCriteria);
  const settings = await loadPacsSettings();

  if (!settings.enabled) {
    throw new HttpError(400, "PACS is disabled in settings.");
  }

  if (!settings.host || !settings.port || !settings.calledAeTitle || !settings.callingAeTitle) {
    throw new HttpError(400, "PACS connection details are missing in settings.");
  }

  let rawResult;
  try {
    rawResult = await runDimseFindScu({
      criteria,
      host: settings.host,
      port: settings.port,
      calledAeTitle: settings.calledAeTitle,
      callingAeTitle: settings.callingAeTitle,
      timeoutSeconds: settings.timeoutSeconds
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    throw new HttpError(502, `PACS connection failed. ${message}`.trim());
  }

  const studies = normalizeStudyList(rawResult);

  await logAuditEntry({
    entityType: "integration",
    entityId: null,
    actionType: "pacs_cfind",
    oldValues: null,
    newValues: {
      criteria,
      resultCount: studies.length
    },
    changedByUserId: currentUserId
  });

  return studies;
}

export async function runPacsCFind({
  patientNationalId,
  currentUserId
}: {
  patientNationalId?: string;
  currentUserId: OptionalUserId;
}): Promise<StudySummary[]> {
  return searchPacsStudies({
    criteria: { patientId: patientNationalId },
    currentUserId
  });
}

export async function testPacsConnection({
  currentUserId,
  overrides = null
}: {
  currentUserId: OptionalUserId;
  overrides?: UnknownRecord | null;
}): Promise<{ ok: true }> {
  const settings = overrides ? normalizePacsSettingsInput(overrides) : await loadPacsSettings();

  if (!settings.enabled) {
    throw new HttpError(400, "PACS is disabled in settings.");
  }

  if (!settings.host || !settings.port || !settings.calledAeTitle || !settings.callingAeTitle) {
    throw new HttpError(400, "PACS connection details are missing in settings.");
  }

  try {
    await runDimseEchoScu({
      host: settings.host,
      port: settings.port,
      calledAeTitle: settings.calledAeTitle,
      callingAeTitle: settings.callingAeTitle,
      timeoutSeconds: settings.timeoutSeconds
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    throw new HttpError(502, `PACS connection failed. ${message}`.trim());
  }

  await logAuditEntry({
    entityType: "integration",
    entityId: null,
    actionType: "pacs_echo",
    oldValues: null,
    newValues: {
      host: settings.host,
      port: settings.port,
      calledAeTitle: settings.calledAeTitle,
      callingAeTitle: settings.callingAeTitle
    },
    changedByUserId: currentUserId
  });

  return { ok: true };
}
