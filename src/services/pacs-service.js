import dimse from "dicom-dimse-native";
import os from "os";
import { pool } from "../db/pool.js";
import { HttpError } from "../utils/http-error.js";
import { logAuditEntry } from "./audit-service.js";

const DEFAULT_DIMSE_SOURCE_PORT = "11112";

function parseEnabled(value) {
  return String(value || "").trim() === "enabled";
}

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
  }, {});
}

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

function extractTagValue(dataset, tag) {
  if (!dataset || typeof dataset !== "object") {
    return "";
  }

  const candidates = [dataset[tag], dataset[tag?.toUpperCase()], dataset[tag?.toLowerCase()]];
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
        return String(firstValue.Alphabetic || firstValue.Ideographic || firstValue.Phonetic || "");
      }

      return String(firstValue ?? "");
    }
    if (typeof candidate === "object") {
      if (Array.isArray(candidate.Value)) {
        if (!candidate.Value.length) {
          return "";
        }

        const firstValue = candidate.Value[0];
        if (firstValue && typeof firstValue === "object") {
          return String(firstValue.Alphabetic || firstValue.Ideographic || firstValue.Phonetic || "");
        }

        return String(firstValue ?? "");
      }
      if (candidate.Value !== undefined) {
        return String(candidate.Value ?? "");
      }
      if (candidate.value !== undefined) {
        return String(candidate.value ?? "");
      }
    }
  }

  return "";
}

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

function normalizeStudyList(rawResult) {
  const candidates = [];

  if (Array.isArray(rawResult)) {
    candidates.push(...rawResult);
  }

  if (rawResult && typeof rawResult === "object") {
    const possibleArrays = [
      rawResult.container,
      rawResult.datasets,
      rawResult.results,
      rawResult.responses,
      rawResult.container?.datasets,
      rawResult.container?.results,
      rawResult.container?.responses
    ];

    for (const arrayValue of possibleArrays) {
      if (Array.isArray(arrayValue)) {
        candidates.push(...arrayValue);
      }
    }
  }

  return candidates
    .map((dataset) => extractStudySummary(dataset))
    .filter((entry) => entry.patientId || entry.modality || entry.studyDescription || entry.studyDate);
}

function parseDimseResult(result) {
  if (!result) {
    return null;
  }

  let parsed = result;
  if (typeof result === "string") {
    parsed = JSON.parse(result);
  }

  if (parsed?.container && typeof parsed.container === "string") {
    try {
      parsed.container = JSON.parse(parsed.container);
    } catch (error) {
      parsed.container = parsed.container;
    }
  }

  return parsed;
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
          port: String(port)
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
          reject(new Error(parsed?.error || parsed?.message || "PACS query failed."));
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
          port: String(port)
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
          reject(new Error(parsed?.error || parsed?.message || "PACS echo failed."));
          return;
        }

        resolve(parsed);
      });
    } catch (error) {
      reject(error);
    }
  });
}

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
    throw new HttpError(502, `PACS connection failed. ${error.message || ""}`.trim());
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
    throw new HttpError(502, `PACS connection failed. ${error.message || ""}`.trim());
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
