import { pool } from "../db/pool.js";
import { createRequire } from "module";
import { HttpError } from "../utils/http-error.js";
import { validateIsoDate } from "../utils/date.js";
import { logAuditEntry } from "./audit-service.js";
import { getDefaultPacsNode, type PacsNodeRow } from "./pacs-node-service.js";
import { loadSettingsMap } from "./settings-service.js";
import type { UnknownRecord, OptionalUserId } from "../types/http.js";

// Lazy-load native DICOM module to prevent crash on platforms where it's not built
let dimse: any = null;
const require = createRequire(import.meta.url);
const FALLBACK_DIMSE_SOURCE_IP = "127.0.0.1";
const FALLBACK_DIMSE_SOURCE_PORT = 4006;
const AE_TITLE_PATTERN = /^[A-Z0-9_]{1,16}$/;
const HOSTNAME_PATTERN = /^(?=.{1,253}$)(?:[A-Z0-9](?:[A-Z0-9-]{0,61}[A-Z0-9])?\.)*[A-Z0-9](?:[A-Z0-9-]{0,61}[A-Z0-9])$/i;
const PACS_FIND_QUERY_MODEL = "study-root";
const PACS_QUERY_RETRIEVE_LEVEL = "STUDY";
const DICOM_DATASET_KEYS = new Set([
  "00100020",
  "00100010",
  "00080050",
  "00080060",
  "00081030",
  "00080020",
  "PatientID",
  "PatientName",
  "AccessionNumber",
  "Modality",
  "StudyDescription",
  "StudyDate"
]);

function getDimseModule() {
  if (!dimse) {
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const loadedModule = require("dicom-dimse-native");
      dimse = loadedModule?.default ?? loadedModule;
    } catch {
      throw new HttpError(503, "DICOM native module not available. Please rebuild dicom-dimse-native for your platform.");
    }

    if (!dimse?.echoScu || !dimse?.findScu) {
      throw new HttpError(503, "DICOM native module is installed but incomplete. Please rebuild dicom-dimse-native for your platform.");
    }
  }
  return dimse;
}

export function __setDimseModuleForTests(mockModule: any): void {
  dimse = mockModule;
}

export function __resetDimseModuleForTests(): void {
  dimse = null;
}

let getDefaultPacsNodeForSearch = getDefaultPacsNode;

export function __setGetDefaultPacsNodeForTests(mockResolver: typeof getDefaultPacsNode): void {
  getDefaultPacsNodeForSearch = mockResolver;
}

export function __resetGetDefaultPacsNodeForTests(): void {
  getDefaultPacsNodeForSearch = getDefaultPacsNode;
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
  modality?: string;
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

function logFindNegotiationFailure({
  host,
  port,
  calledAeTitle,
  callingAeTitle,
  timeoutSeconds,
  criteria,
  errorMessage,
  rawResult
}: {
  host: string;
  port: number;
  calledAeTitle: string;
  callingAeTitle: string;
  timeoutSeconds: number;
  criteria: StudySearchCriteria;
  errorMessage: string;
  rawResult?: unknown;
}): void {
  console.error("PACS C-FIND negotiation/query failed.", {
    queryModel: PACS_FIND_QUERY_MODEL,
    queryRetrieveLevel: PACS_QUERY_RETRIEVE_LEVEL,
    host,
    port,
    calledAeTitle,
    callingAeTitle,
    timeoutSeconds,
    criteria,
    errorMessage,
    rawResult
  });
}

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

function normalizeAeTitle(value: unknown, fallback = ""): string {
  return String(value || fallback).trim().toUpperCase();
}

async function reserveDimseSourcePort(host: string): Promise<number> {
  const net = await import("net");

  return await new Promise<number>((resolve, reject) => {
    const server = net.createServer();

    server.unref();
    server.once("error", reject);
    server.once("listening", () => {
      const address = server.address();
      const port = typeof address === "object" && address ? address.port : 0;

      server.close((closeError) => {
        if (closeError) {
          reject(closeError);
          return;
        }

        resolve(port);
      });
    });

    server.listen({ host, port: 0, exclusive: true });
  });
}

function validateAeTitle(value: string, fieldName: string): string {
  const aeTitle = normalizeAeTitle(value);

  if (!aeTitle) {
    throw new HttpError(400, `${fieldName} is required.`);
  }

  if (!AE_TITLE_PATTERN.test(aeTitle)) {
    throw new HttpError(400, `${fieldName} must be 1-16 chars using A-Z, 0-9, or underscore.`);
  }

  return aeTitle;
}

function validatePacsHost(value: unknown): string {
  const host = String(value || "").trim();

  if (!host) {
    throw new HttpError(400, "PACS host is required.");
  }

  if (host.includes("://") || host.includes("/") || host.includes("?") || host.includes("#")) {
    throw new HttpError(400, "PACS host must be a bare hostname or IP address, not a URL.");
  }

  const isIpv4 = /^(25[0-5]|2[0-4]\d|1?\d?\d)(\.(25[0-5]|2[0-4]\d|1?\d?\d)){3}$/.test(host);
  const isHostname = HOSTNAME_PATTERN.test(host);

  if (!isIpv4 && !isHostname) {
    throw new HttpError(400, "PACS host must be a valid IPv4 address or hostname.");
  }

  return host;
}

async function getDimseSourceNode(callingAeTitle: string): Promise<{ aet: string; ip: string; port: number }> {
  try {
    const reservedPort = await reserveDimseSourcePort(FALLBACK_DIMSE_SOURCE_IP);
    return {
      aet: callingAeTitle,
      ip: FALLBACK_DIMSE_SOURCE_IP,
      port: reservedPort || FALLBACK_DIMSE_SOURCE_PORT
    };
  } catch {
    return {
      aet: callingAeTitle,
      ip: FALLBACK_DIMSE_SOURCE_IP,
      port: FALLBACK_DIMSE_SOURCE_PORT
    };
  }
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
    // Validate it's a real date, then convert to YYYYMMDD
    validateIsoDate(clean, "studyDate");
    return clean.replaceAll("-", "");
  }

  throw new HttpError(400, "studyDate must be in YYYY-MM-DD format.");
}

function normalizeStudySearchCriteria(payload: UnknownRecord = {}): StudySearchCriteria {
  const patientId = String(payload.patientId || payload.patientNationalId || "").trim();
  const patientName = String(payload.patientName || "").trim();
  const accessionNumber = String(payload.accessionNumber || "").trim();
  const studyDate = normalizeDateForDicom(payload.studyDate || "");
  const modality = String(payload.modality || "").trim().toUpperCase();

  if (!patientId && !patientName && !accessionNumber && !studyDate && !modality) {
    throw new HttpError(400, "At least one PACS search field is required.");
  }

  return {
    patientId,
    patientName,
    accessionNumber,
    studyDate,
    modality
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

function looksLikeDicomDataset(dataset: UnknownRecord): boolean {
  return Object.keys(dataset).some((key) => /^[0-9A-F]{8}$/i.test(key) || DICOM_DATASET_KEYS.has(key));
}

export function normalizeDimseStudyList(rawResult: unknown): StudySummary[] {
  const candidates: unknown[] = [];
  const collectCandidate = (value: unknown): void => {
    if (!value) {
      return;
    }

    if (Array.isArray(value)) {
      candidates.push(...value);
      return;
    }

    if (typeof value === "object" && looksLikeDicomDataset(value as UnknownRecord)) {
      candidates.push(value);
    }
  };

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

    for (const candidateValue of possibleArrays) {
      collectCandidate(candidateValue);
    }

    if (looksLikeDicomDataset(rawRecord)) {
      candidates.push(rawRecord);
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

function isPendingDimseResult(parsed: UnknownRecord | null): boolean {
  if (!parsed) {
    return false;
  }

  return String(parsed.status || "").toLowerCase() === "pending" || Number(parsed.code) === 1;
}

function isFailureDimseResult(parsed: UnknownRecord | null): boolean {
  if (!parsed) {
    return false;
  }

  return Boolean(parsed.error) || String(parsed.status || "").toLowerCase() === "failure" || Number(parsed.code) === 2;
}

function extractDimsePayload(parsed: UnknownRecord | null): unknown {
  if (!parsed) {
    return null;
  }

  for (const key of ["container", "datasets", "results", "responses"] as const) {
    if (parsed[key] !== undefined) {
      return parsed[key];
    }
  }

  return parsed;
}

async function loadPacsSettings(): Promise<PacsSettings> {
  const settings = await loadSettingsMap(["pacs_connection"]);
  const pacs = settings.pacs_connection || {};

  const enabled = parseEnabled(pacs.enabled || "");
  const host = String(pacs.host || "").trim();
  const port = parsePositiveInteger(pacs.port, 104);
  const calledAeTitle = normalizeAeTitle(pacs.called_ae_title);
  const callingAeTitle = normalizeAeTitle(pacs.calling_ae_title, "RISPRO");
  const timeoutSeconds = parsePositiveInteger(pacs.timeout_seconds, 10);

  return {
    enabled,
    host: validatePacsHost(host),
    port,
    calledAeTitle: validateAeTitle(calledAeTitle, "calledAeTitle"),
    callingAeTitle: validateAeTitle(callingAeTitle, "callingAeTitle"),
    timeoutSeconds
  };
}

function normalizePacsSettingsInput(input: UnknownRecord = {}): PacsSettings {
  const host = validatePacsHost(input.host);
  const calledAeTitle = validateAeTitle(
    normalizeAeTitle(input.calledAeTitle || input.called_ae_title),
    "calledAeTitle"
  );
  const callingAeTitle = validateAeTitle(
    normalizeAeTitle(input.callingAeTitle || input.calling_ae_title, "RISPRO"),
    "callingAeTitle"
  );

  return {
    enabled: parseEnabled(input.enabled || "enabled"),
    host,
    port: parsePositiveInteger(input.port, 104),
    calledAeTitle,
    callingAeTitle,
    timeoutSeconds: parsePositiveInteger(input.timeoutSeconds || input.timeout_seconds, 10)
  };
}

function buildStudySearchTags(criteria: StudySearchCriteria): { key: string; value: string }[] {
  const tags = [
    { key: "00080052", value: PACS_QUERY_RETRIEVE_LEVEL },
    { key: "00100010", value: criteria.patientName ? `*${criteria.patientName}*` : "" },
    { key: "00100020", value: criteria.patientId || "" },
    { key: "00080050", value: criteria.accessionNumber || "" },
    { key: "00080020", value: criteria.studyDate || "" },
    { key: "00080060", value: criteria.modality || "" },
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
  const dimseModule = getDimseModule();
  const source = await getDimseSourceNode(callingAeTitle);

  return await new Promise((resolve, reject) => {
    let settled = false;
    const timeoutMs = Math.max(Number(timeoutSeconds) || 10, 1) * 1000;
    const timer = setTimeout(() => {
      settled = true;
      reject(new Error("Timed out waiting for PACS response."));
    }, timeoutMs + 2000);
    const settleResolve = (value: PacsFindResult[]) => {
      if (settled) {
        return;
      }

      settled = true;
      clearTimeout(timer);
      resolve(value);
    };
    const settleReject = (error: unknown) => {
      if (settled) {
        return;
      }

      settled = true;
      clearTimeout(timer);
      reject(error);
    };
    const options = {
      source,
      target: {
        aet: calledAeTitle,
        ip: host,
        port: Number(port)
      },
      // The current native binding negotiates Study Root internally; we mirror the
      // selected model here so diagnostics and any future wrapper upgrade stay explicit.
      queryModel: PACS_FIND_QUERY_MODEL,
      tags: buildStudySearchTags(criteria),
      timeout: Number(timeoutSeconds),
      verbose: true
    };

    try {
      dimseModule.findScu(options, (result: unknown) => {
        if (settled) {
          return;
        }

        if (!result) {
          settleResolve([]);
          return;
        }

        let parsed: UnknownRecord | null;
        try {
          parsed = parseDimseResult(result);
        } catch (error) {
          settleReject(error);
          return;
        }

        if (isPendingDimseResult(parsed)) {
          return;
        }

        if (isFailureDimseResult(parsed)) {
          const errorMessage = String(parsed?.error || parsed?.message || "PACS query failed.");
          logFindNegotiationFailure({
            host,
            port: Number(port),
            calledAeTitle,
            callingAeTitle,
            timeoutSeconds,
            criteria,
            errorMessage,
            rawResult: parsed
          });
          settleReject(new Error(errorMessage));
          return;
        }

        const payload = extractDimsePayload(parsed);
        settleResolve((payload ?? []) as PacsFindResult[]);
      });
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      logFindNegotiationFailure({
        host,
        port: Number(port),
        calledAeTitle,
        callingAeTitle,
        timeoutSeconds,
        criteria,
        errorMessage
      });
      settleReject(error);
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
  const dimseModule = getDimseModule();
  const source = await getDimseSourceNode(callingAeTitle);

  return await new Promise((resolve, reject) => {
    let settled = false;
    const timeoutMs = Math.max(Number(timeoutSeconds) || 10, 1) * 1000;
    const timer = setTimeout(() => {
      settled = true;
      reject(new Error("Timed out waiting for PACS response."));
    }, timeoutMs + 2000);
    const settleResolve = (value: boolean) => {
      if (settled) {
        return;
      }

      settled = true;
      clearTimeout(timer);
      resolve(value);
    };
    const settleReject = (error: unknown) => {
      if (settled) {
        return;
      }

      settled = true;
      clearTimeout(timer);
      reject(error);
    };
    const options = {
      source,
      target: {
        aet: calledAeTitle,
        ip: host,
        port: Number(port)
      },
      timeout: Number(timeoutSeconds),
      verbose: true
    };

    try {
      dimseModule.echoScu(options, (result: unknown) => {
        if (settled) {
          return;
        }

        if (!result) {
          settleResolve(false);
          return;
        }

        let parsed: UnknownRecord | null;
        try {
          parsed = parseDimseResult(result);
        } catch (error) {
          settleReject(error);
          return;
        }

        if (isPendingDimseResult(parsed)) {
          return;
        }

        if (isFailureDimseResult(parsed)) {
          const errorMessage = String(parsed?.error || parsed?.message || "PACS echo failed.");
          settleReject(new Error(errorMessage));
          return;
        }

        settleResolve(Boolean(parsed));
      });
    } catch (error) {
      settleReject(error);
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
    const calledAeTitle = validateAeTitle(settings.calledAeTitle, "calledAeTitle");
    const callingAeTitle = validateAeTitle(settings.callingAeTitle, "callingAeTitle");
    rawResult = await runDimseFindScu({
      criteria,
      host: validatePacsHost(settings.host),
      port: settings.port,
      calledAeTitle,
      callingAeTitle,
      timeoutSeconds: settings.timeoutSeconds
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    throw new HttpError(502, `PACS connection failed. ${message}`.trim());
  }

  const studies = normalizeDimseStudyList(rawResult);

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
    const calledAeTitle = validateAeTitle(settings.calledAeTitle, "calledAeTitle");
    const callingAeTitle = validateAeTitle(settings.callingAeTitle, "callingAeTitle");
    await runDimseEchoScu({
      host: validatePacsHost(settings.host),
      port: settings.port,
      calledAeTitle,
      callingAeTitle,
      timeoutSeconds: settings.timeoutSeconds
    });
  } catch (error) {
    const rawMessage = error instanceof Error ? error.message : String(error);
    let userMessage = "PACS connection failed.";

    if (/timed? ?out/i.test(rawMessage)) {
      userMessage = `Connection timed out (${settings.timeoutSeconds}s). Check that the PACS server at ${settings.host}:${settings.port} is reachable and the firewall allows DICOM traffic.`;
    } else if (/ECONNREFUSED|connection refused/i.test(rawMessage)) {
      userMessage = `Connection refused at ${settings.host}:${settings.port}. Verify the PACS server is running and accepting connections on that port.`;
    } else if (/ENOTFOUND|getaddrinfo/i.test(rawMessage)) {
      userMessage = `Could not resolve host "${settings.host}". Check the PACS server hostname or IP address.`;
    } else if (/AE ?title|AET/i.test(rawMessage) || /rejected/i.test(rawMessage)) {
      userMessage = `AE title rejected. Local: "${settings.callingAeTitle}", Remote: "${settings.calledAeTitle}". Verify both AE titles are correct and registered on the PACS server.`;
    } else if (/string.*pattern|regex|match/i.test(rawMessage)) {
      userMessage = `Invalid DICOM parameter format. AE titles must be uppercase alphanumeric (A-Z, 0-9) with no spaces or special characters. Local: "${settings.callingAeTitle}", Remote: "${settings.calledAeTitle}".`;
    } else if (/native module|dicom-dimse|not available/i.test(rawMessage)) {
      userMessage = "DICOM native module is not installed. Please rebuild dicom-dimse-native for your platform.";
    } else {
      userMessage = `PACS connection failed: ${rawMessage}`;
    }

    throw new HttpError(502, userMessage);
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

// ---------------------------------------------------------------------------
// Node-specific search (for multi-PACS support)
// ---------------------------------------------------------------------------

export interface PacsNodeForSearch {
  id?: number;
  name?: string;
  host: string;
  port: number | string;
  called_ae_title: string;
  calling_ae_title: string;
  timeout_seconds: number | string;
}

export async function resolveDefaultPacsNodeForSearch(): Promise<PacsNodeRow> {
  const defaultNode = await getDefaultPacsNodeForSearch();

  if (!defaultNode || !defaultNode.is_active) {
    throw new HttpError(400, "No active default PACS node is configured.");
  }

  return defaultNode;
}

export async function searchPacsStudiesWithNode({
  criteria: rawCriteria,
  node,
  currentUserId
}: {
  criteria: UnknownRecord;
  node: PacsNodeForSearch;
  currentUserId: OptionalUserId;
}): Promise<StudySummary[]> {
  const criteria = normalizeStudySearchCriteria(rawCriteria);

  let rawResult;
  try {
    const calledAeTitle = validateAeTitle(node.called_ae_title, "calledAeTitle");
    const callingAeTitle = validateAeTitle(node.calling_ae_title, "callingAeTitle");
    rawResult = await runDimseFindScu({
      criteria,
      host: validatePacsHost(node.host),
      port: Number(node.port) || 104,
      calledAeTitle,
      callingAeTitle,
      timeoutSeconds: Number(node.timeout_seconds) || 10
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    throw new HttpError(502, `PACS connection failed. ${message}`.trim());
  }

  const studies = normalizeDimseStudyList(rawResult);

  await logAuditEntry({
    entityType: "integration",
    entityId: null,
    actionType: "pacs_cfind",
    oldValues: null,
    newValues: {
      criteria,
      resultCount: studies.length,
      nodeHost: node.host
    },
    changedByUserId: currentUserId
  });

  return studies;
}

export async function testPacsConnectionWithNode({
  node,
  currentUserId
}: {
  node: PacsNodeForSearch;
  currentUserId: OptionalUserId;
}): Promise<{ ok: true }> {
  try {
    const calledAeTitle = validateAeTitle(node.called_ae_title, "calledAeTitle");
    const callingAeTitle = validateAeTitle(node.calling_ae_title, "callingAeTitle");
    await runDimseEchoScu({
      host: validatePacsHost(node.host),
      port: Number(node.port) || 104,
      calledAeTitle,
      callingAeTitle,
      timeoutSeconds: Number(node.timeout_seconds) || 10
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
      host: node.host,
      port: node.port,
      calledAeTitle: node.called_ae_title,
      callingAeTitle: node.calling_ae_title
    },
    changedByUserId: currentUserId
  });

  return { ok: true };
}
