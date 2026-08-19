import { HttpError } from "../utils/http-error.js";
import { validateIsoDate } from "../utils/date.js";
import { pool } from "../db/pool.js";
import { logAuditEntry } from "./audit-service.js";
import { normalizeDicomModalityValues } from "./clinical-document-dicom.js";
import { resolveOrthancSettings, type ResolvedOrthancSettings } from "./orthanc-settings-resolver.js";
import type { OptionalUserId, UnknownRecord } from "../types/http.js";

export interface OrthancPacsTarget {
  type: "local" | "remote_modality";
  key: string;
  name: string;
  isDefault: boolean;
}

export interface OrthancRemoteModality {
  key: string;
  aet: string;
  host: string;
  port: number | null;
  isDefault: boolean;
  isCdRobot?: boolean;
  configurationError?: string | null;
}

export interface OrthancPacsStudySummary {
  patientId: string;
  patientName: string;
  accessionNumber: string;
  modality: string;
  description: string;
  studyDescription: string;
  studyDate: string;
  studyTime?: string;
  studyInstanceUid: string;
}

export interface OrthancPacsSearchCriteria {
  patientId?: string;
  patientNationalId?: string;
  patientName?: string;
  accessionNumber?: string;
  studyDate?: string;
  modality?: string;
  studyInstanceUid?: string;
}

type OrthancFetchResponse = {
  status: number;
  ok: boolean;
  text: string;
  json: unknown;
};
type OrthancPacsAuditLogger = typeof logAuditEntry;

let orthancFetchForPacs: typeof orthancFetch = orthancFetch;
let orthancSettingsForTests: ResolvedOrthancSettings | null = null;
let logOrthancPacsAuditEntry: OrthancPacsAuditLogger = logAuditEntry;

const ORTHANC_MODALITIES_SETTINGS_CATEGORY = "pacs";
const ORTHANC_MODALITIES_SETTINGS_KEY = "orthanc_remote_modalities";

export function __setOrthancPacsFetchForTests(mockFetch: typeof orthancFetch): void {
  orthancFetchForPacs = mockFetch;
}

export function __resetOrthancPacsFetchForTests(): void {
  orthancFetchForPacs = orthancFetch;
}

export function __setOrthancPacsSettingsForTests(settings: ResolvedOrthancSettings): void {
  orthancSettingsForTests = settings;
}

export function __resetOrthancPacsSettingsForTests(): void {
  orthancSettingsForTests = null;
}

export function __setOrthancPacsAuditLoggerForTests(logger: OrthancPacsAuditLogger): void {
  logOrthancPacsAuditEntry = logger;
}

export function __resetOrthancPacsAuditLoggerForTests(): void {
  logOrthancPacsAuditEntry = logAuditEntry;
}

function operationalError(status: number, message: string, transientCode: string, invalidRequestCode: string): HttpError {
  const code = status === 401 || status === 403 ? "orthanc_auth_failed" : status === 404 ? "orthanc_remote_modality_missing" : (status === 408 || status === 429 || status >= 500 ? transientCode : invalidRequestCode);
  return new HttpError(502, message, { code });
}

function joinUrl(baseUrl: string, suffix: string): string {
  const cleanBase = baseUrl.endsWith("/") ? baseUrl.slice(0, -1) : baseUrl;
  const cleanSuffix = suffix.startsWith("/") ? suffix : `/${suffix}`;
  return `${cleanBase}${cleanSuffix}`;
}

async function resolveSettings(): Promise<ResolvedOrthancSettings> {
  const settings = orthancSettingsForTests ?? await resolveOrthancSettings();
  if (!settings.baseUrl) {
    throw new HttpError(400, "Orthanc base URL is not configured.");
  }
  return settings;
}

async function orthancFetch(
  path: string,
  options: {
    method?: string;
    body?: unknown;
    contentType?: string;
    settings?: ResolvedOrthancSettings;
    timeoutSeconds?: number;
  } = {}
): Promise<OrthancFetchResponse> {
  const settings = options.settings ?? await resolveSettings();
  const timeoutSeconds = options.timeoutSeconds ?? settings.timeoutSeconds;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), Math.max(1, timeoutSeconds) * 1000);

  try {
    const headers: Record<string, string> = { Accept: "application/json" };
    if (settings.username) {
      headers.Authorization = `Basic ${Buffer.from(`${settings.username}:${settings.password}`).toString("base64")}`;
    }

    const init: RequestInit & { dispatcher?: unknown } = {
      method: options.method || "GET",
      headers,
      signal: controller.signal,
    };

    if (options.body !== undefined) {
      headers["Content-Type"] = options.contentType || "application/json";
      init.body = (Buffer.isBuffer(options.body) ? options.body : JSON.stringify(options.body)) as unknown as BodyInit;
    }

    if (!settings.verifyTls && settings.baseUrl.toLowerCase().startsWith("https://")) {
      // @ts-ignore undici is available at runtime in this repo; type declarations are not installed.
      const undici = await import("undici");
      init.dispatcher = new undici.Agent({ connect: { rejectUnauthorized: false } });
    }

    const response = await fetch(joinUrl(settings.baseUrl, path), init);
    const text = await response.text();
    let json: unknown = null;
    try {
      json = text ? JSON.parse(text) : null;
    } catch {
      json = null;
    }
    return { status: response.status, ok: response.ok, text, json };
  } catch (error) {
    if ((error as Error).name === "AbortError") {
      throw new HttpError(502, `Orthanc request timed out after ${Math.max(1, timeoutSeconds)}s.`, { code: "orthanc_timeout" });
    }
    throw new HttpError(502, "Orthanc request is unavailable.", { code: "orthanc_unavailable" });
  } finally {
    clearTimeout(timeout);
  }
}

function record(value: unknown): UnknownRecord {
  return value && typeof value === "object" && !Array.isArray(value) ? value as UnknownRecord : {};
}

function firstString(...values: unknown[]): string {
  for (const value of values) {
    if (value == null) continue;
    if (typeof value === "string" || typeof value === "number") {
      const clean = String(value).trim();
      if (clean) return clean;
      continue;
    }
    if (Array.isArray(value)) {
      const nested = firstString(...value);
      if (nested) return nested;
      continue;
    }
    if (typeof value === "object") {
      const item = value as UnknownRecord;
      const nested = firstString(item.Value, item.value, item.Alphabetic);
      if (nested) return nested;
    }
  }
  return "";
}

function normalizeModalityKey(value: unknown): string {
  const key = firstString(value);
  if (!key) {
    throw new HttpError(400, "Orthanc modality key is required.");
  }
  if (key === "local") {
    throw new HttpError(400, "local is reserved for the Orthanc local index.");
  }
  if (!/^[A-Za-z0-9_.:-]{1,128}$/.test(key)) {
    throw new HttpError(400, "Orthanc modality key may contain letters, numbers, underscore, dash, dot, and colon only.");
  }
  return key;
}

function normalizeAeTitle(value: unknown): string {
  const aet = firstString(value).toUpperCase();
  if (!/^[A-Z0-9_]{1,16}$/.test(aet)) {
    throw new HttpError(400, "AET must be 1-16 chars using A-Z, 0-9, or underscore.");
  }
  return aet;
}

function normalizeHost(value: unknown): string {
  const host = firstString(value);
  if (!host || host.includes("://") || host.includes("/") || host.includes("?") || host.includes("#")) {
    throw new HttpError(400, "Host must be a bare hostname or IP address.");
  }
  return host;
}

function normalizePort(value: unknown): number {
  const port = Number(value);
  if (!Number.isInteger(port) || port <= 0 || port > 65535) {
    throw new HttpError(400, "Port must be an integer between 1 and 65535.");
  }
  return port;
}

function normalizeBoolean(value: unknown, fallback = false): boolean {
  if (value === undefined || value === null) return fallback;
  if (typeof value === "boolean") return value;
  if (typeof value === "number") return value !== 0;
  const clean = String(value).trim().toLowerCase();
  if (!clean) return fallback;
  return !["false", "0", "no", "off", "disabled"].includes(clean);
}

function parseOrthancPort(value: unknown): number | null {
  const port = Number(value);
  return Number.isInteger(port) && port > 0 && port <= 65535 ? port : null;
}

function dicomDate(value: unknown): string {
  const clean = firstString(value).trim();
  if (!clean) return "";
  if (/^\d{8}$/.test(clean)) return clean;
  if (/^\d{4}-\d{2}-\d{2}$/.test(clean)) {
    validateIsoDate(clean, "studyDate");
    return clean.replaceAll("-", "");
  }
  throw new HttpError(400, "studyDate must be in YYYY-MM-DD format.");
}

function normalizeCriteria(payload: OrthancPacsSearchCriteria | UnknownRecord): OrthancPacsSearchCriteria {
  const criteria = {
    patientId: firstString(payload.patientId, payload.patientNationalId).replace(/\D/g, "") || firstString(payload.patientId),
    patientNationalId: firstString(payload.patientNationalId).replace(/\D/g, ""),
    patientName: firstString(payload.patientName),
    accessionNumber: firstString(payload.accessionNumber),
    studyDate: dicomDate(payload.studyDate),
    modality: firstString(payload.modality).toUpperCase(),
    studyInstanceUid: firstString(payload.studyInstanceUid),
  };

  if (!criteria.patientId && !criteria.patientName && !criteria.accessionNumber && !criteria.studyDate && !criteria.modality && !criteria.studyInstanceUid) {
    throw new HttpError(400, "At least one PACS search field is required.");
  }

  return criteria;
}

function buildStudyQuery(criteria: OrthancPacsSearchCriteria): UnknownRecord {
  return {
    Level: "Study",
    Query: {
      PatientID: criteria.patientId || criteria.patientNationalId || "",
      PatientName: criteria.patientName ? `*${criteria.patientName}*` : "",
      AccessionNumber: criteria.accessionNumber || "",
      StudyDate: criteria.studyDate || "",
      StudyTime: "",
      ModalitiesInStudy: criteria.modality || "",
      StudyInstanceUID: criteria.studyInstanceUid || "",
      StudyDescription: "",
    },
  };
}

export async function storeDicomStraightToOrthancPacs({ targetKey, dicomBytes }: { targetKey: string; dicomBytes: Buffer }): Promise<{ sopClassUid: string; sopInstanceUid: string }> {
  if (!targetKey) throw new HttpError(400, "A PACS destination is required.", { code: "orthanc_remote_modality_missing" });
  if (!dicomBytes.length) throw new HttpError(400, "Generated DICOM instance is empty.", { code: "orthanc_invalid_dicom" });
  const settings = await resolveSettings();
  const response = await orthancFetchForPacs(`/modalities/${encodeURIComponent(targetKey)}/store-straight`, { method: "POST", body: dicomBytes, contentType: "application/dicom", settings });
  if (!response.ok) throw operationalError(response.status, `Orthanc PACS store failed (status=${response.status}).`, "orthanc_store_failed", "orthanc_invalid_dicom");
  const payload = record(response.json);
  const sopInstanceUid = firstString(payload.SOPInstanceUID, payload.sopInstanceUid);
  if (!sopInstanceUid) throw new HttpError(502, "Orthanc PACS store returned an invalid response.", { code: "orthanc_invalid_response" });
  return { sopClassUid: firstString(payload.SOPClassUID, payload.sopClassUid), sopInstanceUid };
}

function extractTags(payload: unknown): UnknownRecord {
  const source = record(payload);
  const tags: UnknownRecord = {};
  const addTags = (value: unknown): void => {
    const sourceTags = record(value);
    for (const [key, tagValue] of Object.entries(sourceTags)) {
      tags[key] = tagValue;
      const compactDicomTag = key.replace(/[^0-9A-Fa-f]/g, "").toUpperCase();
      if (compactDicomTag.length === 8) {
        tags[compactDicomTag] = tagValue;
      }
      const tagName = firstString(record(tagValue).Name, record(tagValue).name);
      if (tagName) {
        tags[tagName] = tagValue;
      }
    }
  };

  addTags(source);
  addTags(source.Content);
  addTags(source.content);
  addTags(source.Tags);
  addTags(source.NormalizedTags);
  addTags(source.MainDicomTags);
  addTags(source.PatientMainDicomTags);

  return tags;
}

function studyFromPayload(payload: unknown): OrthancPacsStudySummary {
  const tags = extractTags(payload);
  const studyDescription = firstString(tags.StudyDescription, tags["00081030"]);
  const modalities = normalizeDicomModalityValues(tags.ModalitiesInStudy ?? tags["00080061"]);
  if (modalities.length === 0) modalities.push(...normalizeDicomModalityValues(tags.Modality ?? tags["00080060"]));
  return {
    patientId: firstString(tags.PatientID, tags["00100020"]),
    patientName: firstString(tags.PatientName, tags["00100010"]),
    accessionNumber: firstString(tags.AccessionNumber, tags["00080050"]),
    modality: modalities.join("\\"),
    description: studyDescription,
    studyDescription,
    studyDate: firstString(tags.StudyDate, tags["00080020"]),
    studyTime: firstString(tags.StudyTime, tags["00080030"]),
    studyInstanceUid: firstString(tags.StudyInstanceUID, tags.StudyInstanceUid, tags["0020000D"]),
  };
}

async function listRemoteModalityKeys(settings: ResolvedOrthancSettings): Promise<string[]> {
  const response = await orthancFetchForPacs("/modalities", { settings });
  if (!response.ok) {
    throw new HttpError(502, `Orthanc modality list failed (status=${response.status}).`);
  }
  return Array.isArray(response.json)
    ? response.json.map((value) => firstString(value)).filter(Boolean).sort((a, b) => a.localeCompare(b))
    : Object.keys(record(response.json)).sort((a, b) => a.localeCompare(b));
}

function modalityFromPayload(key: string, payload: unknown): OrthancRemoteModality {
  if (Array.isArray(payload)) {
    const port = parseOrthancPort(payload[2]);
    return {
      key,
      aet: firstString(payload[0]),
      host: firstString(payload[1]),
      port,
    isDefault: false,
    isCdRobot: false,
    configurationError: port == null ? "Port is missing or invalid in Orthanc." : null,
    };
  }
  const data = record(payload);
  const port = parseOrthancPort(data.Port ?? data.port);
  return {
    key,
    aet: firstString(data.AET, data.Aet, data.aet),
    host: firstString(data.Host, data.host),
    port,
    isDefault: false,
    isCdRobot: false,
    configurationError: port == null ? "Port is missing or invalid in Orthanc." : null,
  };
}

function normalizeStoredModality(value: unknown): OrthancRemoteModality | null {
  const data = record(value);
  const key = firstString(data.key);
  if (!key) return null;
  return {
    key,
    aet: firstString(data.aet, data.AET),
    host: firstString(data.host, data.Host),
    port: parseOrthancPort(data.port ?? data.Port),
    isDefault: normalizeBoolean(data.isDefault ?? data.is_default),
    isCdRobot: normalizeBoolean(data.isCdRobot ?? data.is_cd_robot),
    configurationError: null,
  };
}

async function loadStoredOrthancRemoteModalities(): Promise<OrthancRemoteModality[]> {
  const { rows } = await pool.query(
    `
      select setting_value
      from system_settings
      where category = $1 and setting_key = $2
      limit 1
    `,
    [ORTHANC_MODALITIES_SETTINGS_CATEGORY, ORTHANC_MODALITIES_SETTINGS_KEY]
  );
  const payload = record(rows[0]?.setting_value);
  const values = Array.isArray(payload.value) ? payload.value : [];
  return values.map(normalizeStoredModality).filter((item): item is OrthancRemoteModality => Boolean(item));
}

async function saveStoredOrthancRemoteModalities(modalities: OrthancRemoteModality[], currentUserId: OptionalUserId): Promise<void> {
  const normalized = modalities
    .filter((modality) => modality.key && modality.aet && modality.host && modality.port != null)
    .map((modality) => ({
      key: modality.key,
      aet: modality.aet,
      host: modality.host,
      port: modality.port,
      isDefault: Boolean(modality.isDefault),
      isCdRobot: Boolean(modality.isCdRobot),
    }))
    .sort((a, b) => a.key.localeCompare(b.key));

  const defaultIndex = normalized.findIndex((modality) => modality.isDefault);
  if (defaultIndex >= 0) {
    normalized.forEach((modality, index) => {
      modality.isDefault = index === defaultIndex;
    });
  } else if (normalized.length === 1) {
    normalized[0]!.isDefault = true;
  }

  await pool.query(
    `
      insert into system_settings (category, setting_key, setting_value, updated_by_user_id)
      values ($1, $2, $3::jsonb, $4)
      on conflict (category, setting_key)
      do update set
        setting_value = excluded.setting_value,
        updated_by_user_id = excluded.updated_by_user_id,
        updated_at = now()
    `,
    [
      ORTHANC_MODALITIES_SETTINGS_CATEGORY,
      ORTHANC_MODALITIES_SETTINGS_KEY,
      JSON.stringify({ value: normalized }),
      currentUserId,
    ]
  );
}

async function putOrthancRemoteModality(modality: OrthancRemoteModality, settings: ResolvedOrthancSettings): Promise<void> {
  if (!modality.aet || !modality.host || modality.port == null) {
    throw new HttpError(400, `Orthanc modality ${modality.key} is missing AET, host, or port.`);
  }
  const response = await orthancFetchForPacs(`/modalities/${encodeURIComponent(modality.key)}`, {
    method: "PUT",
    body: [modality.aet, modality.host, modality.port],
    settings,
  });
  if (!response.ok) {
    throw new HttpError(502, `Orthanc modality save failed for ${modality.key} (status=${response.status}).`);
  }
}

export async function syncStoredOrthancRemoteModalitiesToOrthanc(): Promise<{ synced: number }> {
  const settings = await resolveSettings();
  const stored = await loadStoredOrthancRemoteModalities();
  let synced = 0;
  for (const modality of stored) {
    try {
      await putOrthancRemoteModality(modality, settings);
      synced += 1;
    } catch (error) {
      console.warn(
        JSON.stringify({
          type: "orthanc_remote_modality_sync_failed",
          key: modality.key,
          error: error instanceof Error ? error.message : String(error),
        })
      );
    }
  }
  return { synced };
}

export async function listOrthancRemoteModalities(): Promise<{ modalities: OrthancRemoteModality[] }> {
  const settings = await resolveSettings();
  await syncStoredOrthancRemoteModalitiesToOrthanc().catch(() => undefined);
  const stored = await loadStoredOrthancRemoteModalities();
  const storedDefaultKey = stored.find((modality) => modality.isDefault)?.key ?? null;
  const keys = await listRemoteModalityKeys(settings);
  const modalities = await Promise.all(keys.map(async (key) => {
    try {
      const response = await orthancFetchForPacs(`/modalities/${encodeURIComponent(key)}/configuration`, { settings });
      if (!response.ok) {
        return { key, aet: "", host: "", port: null, isDefault: false, isCdRobot: stored.find((item) => item.key === key)?.isCdRobot || false, configurationError: `Orthanc read failed (status=${response.status}).` };
      }
      return { ...modalityFromPayload(key, response.json), isCdRobot: stored.find((item) => item.key === key)?.isCdRobot || false };
    } catch (error) {
      return {
        key,
        aet: "",
        host: "",
        port: null,
        isDefault: false,
        isCdRobot: stored.find((item) => item.key === key)?.isCdRobot || false,
        configurationError: error instanceof Error ? error.message : String(error),
      };
    }
  }));
  const resolvedDefaultKey = storedDefaultKey && modalities.some((modality) => modality.key === storedDefaultKey)
    ? storedDefaultKey
    : (modalities[0]?.key ?? null);

  return {
    modalities: modalities.map((modality) => ({
      ...modality,
      isDefault: modality.key === resolvedDefaultKey,
    })),
  };
}

export async function upsertOrthancRemoteModality({
  key,
  payload,
  currentUserId,
}: {
  key: unknown;
  payload: UnknownRecord;
  currentUserId: OptionalUserId;
}): Promise<{ modality: OrthancRemoteModality }> {
  const cleanKey = normalizeModalityKey(key);
  const modality: OrthancRemoteModality = {
    key: cleanKey,
    aet: normalizeAeTitle(payload.aet ?? payload.AET ?? payload.calledAeTitle),
    host: normalizeHost(payload.host ?? payload.Host),
    port: normalizePort(payload.port ?? payload.Port),
    isDefault: normalizeBoolean(payload.isDefault ?? payload.is_default),
    isCdRobot: normalizeBoolean(payload.isCdRobot ?? payload.is_cd_robot),
  };
  const settings = await resolveSettings();
  await putOrthancRemoteModality(modality, settings);

  const stored = await loadStoredOrthancRemoteModalities();
  const previous = stored.find((item) => item.key === cleanKey);
  if (payload.isDefault == null && payload.is_default == null && previous) modality.isDefault = previous.isDefault;
  if (payload.isCdRobot == null && payload.is_cd_robot == null && previous) modality.isCdRobot = previous.isCdRobot;
  const remaining = stored.filter((item) => item.key !== cleanKey);
  const next = [
    ...(modality.isDefault ? remaining.map((item) => ({ ...item, isDefault: false })) : remaining),
    modality,
  ];
  await saveStoredOrthancRemoteModalities(next, currentUserId);

  await logOrthancPacsAuditEntry({
    entityType: "orthanc_remote_modality",
    entityId: null,
    actionType: "upsert",
    oldValues: null,
    newValues: modality,
    changedByUserId: currentUserId,
  });

  return { modality };
}

export async function deleteOrthancRemoteModality({
  key,
  currentUserId,
}: {
  key: unknown;
  currentUserId: OptionalUserId;
}): Promise<{ ok: true }> {
  const cleanKey = normalizeModalityKey(key);
  const active = await pool.query(`select 1 from system_settings where category='clinical_document_export' and setting_key='enabled' and setting_value->>'value'='enabled' limit 1`);
  const destination = await pool.query(`select 1 from system_settings where category='clinical_document_export' and setting_key='destination_key' and setting_value->>'value'=$1 limit 1`, [cleanKey]);
  const unfinished = await pool.query(`select 1 from clinical_document_exports where destination_key=$1 and status in ('pending','exporting','failed','blocked') limit 1`, [`orthanc_remote:${cleanKey}`]);
  if ((active.rowCount && destination.rowCount) || unfinished.rowCount) throw new HttpError(409, "Change or disable the clinical-document export destination, or resolve outstanding exports, before deleting this PACS destination.");
  const settings = await resolveSettings();
  const response = await orthancFetchForPacs(`/modalities/${encodeURIComponent(cleanKey)}`, {
    method: "DELETE",
    settings,
  });
  if (!response.ok && response.status !== 404) {
    throw new HttpError(502, `Orthanc modality delete failed (status=${response.status}).`);
  }

  const stored = await loadStoredOrthancRemoteModalities();
  const next = stored.filter((item) => item.key !== cleanKey);
  if (!next.some((item) => item.isDefault) && next.length > 0) {
    next[0] = { ...next[0], isDefault: true };
  }
  await saveStoredOrthancRemoteModalities(next, currentUserId);

  await logOrthancPacsAuditEntry({
    entityType: "orthanc_remote_modality",
    entityId: null,
    actionType: "delete",
    oldValues: { key: cleanKey },
    newValues: null,
    changedByUserId: currentUserId,
  });

  return { ok: true };
}

export async function listOrthancPacsTargets(): Promise<{ targets: OrthancPacsTarget[] }> {
  const settings = await resolveSettings();
  const remoteKeys = await listRemoteModalityKeys(settings).catch(() => []);
  return {
    targets: [
      { type: "local", key: "local", name: "Local Orthanc index", isDefault: true },
      ...remoteKeys.map((key) => ({ type: "remote_modality" as const, key, name: key, isDefault: false })),
    ],
  };
}

async function searchLocal(criteria: OrthancPacsSearchCriteria, settings: ResolvedOrthancSettings): Promise<OrthancPacsStudySummary[]> {
  const response = await orthancFetchForPacs("/tools/find", {
    method: "POST",
    body: buildStudyQuery(criteria),
    settings,
  });
  if (!response.ok || !Array.isArray(response.json)) {
    throw new HttpError(502, `Orthanc local study search failed (status=${response.status}).`);
  }

  const studyIds = response.json.map((value) => firstString(value)).filter(Boolean);
  const studies = await Promise.all(studyIds.map(async (studyId) => {
    const detail = await orthancFetchForPacs(`/studies/${encodeURIComponent(studyId)}`, { settings });
    if (!detail.ok) {
      throw new HttpError(502, `Orthanc study read failed (status=${detail.status}).`);
    }
    return studyFromPayload(detail.json);
  }));
  return studies;
}

async function searchRemote(targetKey: string, criteria: OrthancPacsSearchCriteria, settings: ResolvedOrthancSettings): Promise<OrthancPacsStudySummary[]> {
  if (!targetKey || targetKey === "local") {
    return searchLocal(criteria, settings);
  }

  const query = await orthancFetchForPacs(`/modalities/${encodeURIComponent(targetKey)}/query`, {
    method: "POST",
    body: buildStudyQuery(criteria),
    settings,
  });
  if (!query.ok) {
    throw operationalError(query.status, `Orthanc remote query failed (status=${query.status}).`, "orthanc_remote_query_failed", "orthanc_invalid_response");
  }

  const queryId = firstString(record(query.json).ID, record(query.json).Id, record(query.json).id);
  if (!queryId) {
    throw new HttpError(502, "Orthanc remote query did not return a query ID.");
  }

  const answers = await orthancFetchForPacs(`/queries/${encodeURIComponent(queryId)}/answers`, { settings });
  if (!answers.ok || !Array.isArray(answers.json)) {
    throw operationalError(answers.status, `Orthanc remote query answers failed (status=${answers.status}).`, "orthanc_remote_query_failed", "orthanc_invalid_response");
  }

  const answerIds = answers.json.map((value) => firstString(value)).filter(Boolean);
  return Promise.all(answerIds.map(async (answerId) => {
    const answer = await orthancFetchForPacs(`/queries/${encodeURIComponent(queryId)}/answers/${encodeURIComponent(answerId)}/content`, { settings });
    if (!answer.ok) {
      throw operationalError(answer.status, `Orthanc remote answer read failed (status=${answer.status}).`, "orthanc_remote_query_failed", "orthanc_invalid_response");
    }
    return studyFromPayload(answer.json);
  }));
}

export async function searchOrthancPacsStudies({
  criteria: rawCriteria,
  targetKey = "local",
  currentUserId,
  audit = true,
}: {
  criteria: OrthancPacsSearchCriteria | UnknownRecord;
  targetKey?: string | null;
  currentUserId: OptionalUserId;
  audit?: boolean;
}): Promise<{ studies: OrthancPacsStudySummary[]; target: OrthancPacsTarget }> {
  const settings = await resolveSettings();
  const criteria = normalizeCriteria(rawCriteria);
  const key = firstString(targetKey) || "local";
  const target: OrthancPacsTarget = key === "local"
    ? { type: "local", key: "local", name: "Local Orthanc index", isDefault: true }
    : { type: "remote_modality", key, name: key, isDefault: false };

  const studies = key === "local"
    ? await searchLocal(criteria, settings)
    : await searchRemote(key, criteria, settings);

  if (audit) {
    await logOrthancPacsAuditEntry({
      entityType: "integration",
      entityId: null,
      actionType: "orthanc_pacs_search",
      oldValues: null,
      newValues: {
        criteria,
        target,
        resultCount: studies.length,
      },
      changedByUserId: currentUserId,
    });
  }

  return { studies, target };
}

export async function runOrthancPacsCFind({
  patientNationalId,
  currentUserId,
}: {
  patientNationalId?: string;
  currentUserId: OptionalUserId;
}): Promise<OrthancPacsStudySummary[]> {
  const result = await searchOrthancPacsStudies({
    criteria: { patientId: patientNationalId, patientNationalId },
    targetKey: "local",
    currentUserId,
  });
  return result.studies;
}

export async function testOrthancPacsTarget({
  targetKey = "local",
  currentUserId,
}: {
  targetKey?: string | null;
  currentUserId: OptionalUserId;
}): Promise<{ ok: true; target: OrthancPacsTarget }> {
  const settings = await resolveSettings();
  const key = firstString(targetKey) || "local";
  const target: OrthancPacsTarget = key === "local"
    ? { type: "local", key: "local", name: "Local Orthanc index", isDefault: true }
    : { type: "remote_modality", key, name: key, isDefault: false };

  const response = key === "local"
    ? await orthancFetchForPacs("/system", { settings })
    : await orthancFetchForPacs(`/modalities/${encodeURIComponent(key)}/echo`, { method: "POST", settings });
  if (!response.ok) {
    throw new HttpError(502, `Orthanc PACS target test failed (status=${response.status}).`);
  }

  await logOrthancPacsAuditEntry({
    entityType: "integration",
    entityId: null,
    actionType: "orthanc_pacs_test",
    oldValues: null,
    newValues: { target },
    changedByUserId: currentUserId,
  });

  return { ok: true, target };
}
