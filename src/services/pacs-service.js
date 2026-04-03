// @ts-check

import dimse from "dicom-dimse-native";
import os from "os";
import { pool } from "../db/pool.js";
import { HttpError } from "../utils/http-error.js";
import { logAuditEntry } from "./audit-service.js";

const DEFAULT_DIMSE_SOURCE_PORT = 11112;

/**
 * @typedef StudySearchCriteria
 * @property {string} patientId
 * @property {string} patientName
 * @property {string} accessionNumber
 * @property {string} studyDate
 */

/**
 * @param {unknown} value
 */
function parseEnabled(value) {
  return String(value || "").trim() === "enabled";
}

/**
 * @param {unknown} value
 * @param {number} fallback
 */
function parsePositiveInteger(value, fallback) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0 || !Number.isInteger(parsed)) {
    return fallback;
  }
  return parsed;
}

function getDimseSourceIp() {
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

/**
 * @param {string[]} categories
 */
async function loadSettingsMap(categories) {
  const { rows } = await pool.query(
    `
      select category, setting_key, setting_value
      from system_settings
      where category = any($1::text[])
    `,
    [categories]
  );

  return rows.reduce((accumulator, row) => {
    if (!accumulator[row.category]) {
      accumulator[row.category] = {};
    }

    accumulator[row.category][row.setting_key] = row.setting_value?.value ?? "";
    return accumulator;
  }, /** @type {Record<string, Record<string, unknown>>} */ ({}));
}

/**
 * @param {unknown} value
 */
function normalizeDateForDicom(value) {
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

/**
 * @param {Record<string, unknown>} [payload]
 * @returns {StudySearchCriteria}
 */
function normalizeStudySearchCriteria(payload = {}) {
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

/**
 * @param {Record<string, unknown>} dataset
 * @param {string} tag
 */
function extractTagValue(dataset, tag) {
  if (!dataset || typeof dataset !== "object") {
    return "";
  }

  const datasetRecord = /** @type {Record<string, unknown>} */ (dataset);
  const candidates = [datasetRecord[tag], datasetRecord[tag?.toUpperCase()], datasetRecord[tag?.toLowerCase()]];
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
        const firstValueRecord = /** @type {Record<string, unknown>} */ (firstValue);
        return String(firstValueRecord.Alphabetic || firstValueRecord.Ideographic || firstValueRecord.Phonetic || "");
      }

      return String(firstValue ?? "");
    }
    if (typeof candidate === "object") {
      const candidateRecord = /** @type {Record<string, unknown>} */ (candidate);
      const candidateValue = candidateRecord.Value;
      if (Array.isArray(candidateValue)) {
        if (!candidateValue.length) {
          return "";
        }

        const firstValue = candidateValue[0];
        if (firstValue && typeof firstValue === "object") {
          const firstValueRecord = /** @type {Record<string, unknown>} */ (firstValue);
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

/**
 * @param {Record<string, unknown>} dataset
 */
function extractStudySummary(dataset) {
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

/**
 * @param {unknown} rawResult
 */
function normalizeStudyList(rawResult) {
  const candidates = [];

  if (Array.isArray(rawResult)) {
    candidates.push(...rawResult);
  }

  if (rawResult && typeof rawResult === "object") {
    const rawRecord = /** @type {Record<string, unknown>} */ (rawResult);
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
    .map((dataset) => extractStudySummary(/** @type {Record<string, unknown>} */ (dataset)))
    .filter((entry) => entry.patientId || entry.modality || entry.studyDescription || entry.studyDate);
}

/**
 * @param {unknown} result
 * @returns {Record<string, unknown> | null}
 */
function parseDimseResult(result) {
  if (!result) {
    return null;
  }

  let parsed = result;
  if (typeof result === "string") {
    parsed = JSON.parse(result);
  }

  if (parsed && typeof parsed === "object") {
    const parsedRecord = /** @type {Record<string, unknown>} */ (parsed);
    if (parsedRecord.container && typeof parsedRecord.container === "string") {
    try {
      parsedRecord.container = JSON.parse(parsedRecord.container);
    } catch (error) {
      parsedRecord.container = parsedRecord.container;
    }
    }
  }

  return parsed && typeof parsed === "object" ? /** @type {Record<string, unknown>} */ (parsed) : null;
}

async function loadPacsSettings() {
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

/**
 * @param {Record<string, unknown>} [input]
 */
function normalizePacsSettingsInput(input = {}) {
  return {
    enabled: parseEnabled(input.enabled || "enabled"),
    host: String(input.host || "").trim(),
    port: parsePositiveInteger(input.port, 104),
    calledAeTitle: String(input.calledAeTitle || input.called_ae_title || "").trim(),
    callingAeTitle: String(input.callingAeTitle || input.calling_ae_title || "").trim(),
    timeoutSeconds: parsePositiveInteger(input.timeoutSeconds || input.timeout_seconds, 10)
  };
}

/**
 * @param {StudySearchCriteria} criteria
 */
function buildStudySearchTags(criteria) {
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

async function runDimseFindScu({ criteria, host, port, calledAeTitle, callingAeTitle, timeoutSeconds }) {
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

      dimse.findScu(options, (result) => {
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

        resolve(parsed);
      });
    } catch (error) {
      reject(error);
    }
  });
}

async function runDimseEchoScu({ host, port, calledAeTitle, callingAeTitle, timeoutSeconds }) {
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

      dimse.echoScu(options, (result) => {
        clearTimeout(timer);
        if (!result) {
          resolve([]);
          return;
        }

        const parsed = parseDimseResult(result);
        if (parsed?.error || parsed?.status === "failure") {
          const errorMessage = String(parsed?.error || parsed?.message || "PACS echo failed.");
          reject(new Error(errorMessage));
          return;
        }

        resolve(parsed);
      });
    } catch (error) {
      reject(error);
    }
  });
}

/**
 * @param {{ criteria: Record<string, unknown>, currentUserId: number | string | null | undefined }} params
 */
export async function searchPacsStudies({ criteria: rawCriteria, currentUserId }) {
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

export async function runPacsCFind({ patientNationalId, currentUserId }) {
  return searchPacsStudies({
    criteria: { patientId: patientNationalId },
    currentUserId
  });
}

/**
 * @param {{ currentUserId: number | string | null | undefined, overrides?: Record<string, unknown> | null }} params
 */
export async function testPacsConnection({ currentUserId, overrides = null }) {
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
