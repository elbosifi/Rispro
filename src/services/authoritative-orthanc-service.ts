import { pool } from "../db/pool.js";
import { Agent as HttpsAgent, request as httpsRequest } from "node:https";
import { createHash } from "node:crypto";
import { HttpError } from "../utils/http-error.js";
import { logAuditEntry } from "./audit-service.js";
import { loadSettingsMap, upsertSettings } from "./settings-service.js";
import type { UserId } from "../types/http.js";
import { normalizeRisproModalityCode } from "./clinical-document-dicom.js";
import { listOrthancRemoteModalities } from "./orthanc-pacs-service.js";

export const AUTHORITATIVE_ORTHANC_CATEGORY = "authoritative_orthanc";
export const AUTHORITATIVE_ORTHANC_ROUTE_PREFIX = "rispro_route_";
export const AUTHORITATIVE_ORTHANC_CD_PREFIX = "rispro_cd_";
const LEGACY_AUTHORITATIVE_ORTHANC_AUTOROUTE_ALIAS = /^rispro_autoroute(?:_[2-9][0-9]*)?$/;
export type AuthoritativeOrthancSettings = { enabled: boolean; autoExportClinicalDocuments: boolean; autoRouteEnabled: boolean; autoRouteDestinationKey: string; autoRouteDestinationKeys: string[]; baseUrl: string; username: string; password: string; timeoutSeconds: number; verifyTls: boolean; displayName: string };
export type AuthoritativeOrthancSettingsDisplay = Omit<AuthoritativeOrthancSettings, "password"> & { passwordConfigured: boolean };
export type OrthancSystemInfo = { name: string | null; version: string | null; apiVersion: string | null };
export type OrthancStudyDetails = { orthancStudyId: string; studyInstanceUid: string | null; accessionNumber: string | null; patientId: string | null; patientName: string | null; patientBirthDate: string | null; patientSex: string | null; studyDate: string | null; studyDescription: string | null; modalitiesInStudy: string[]; seriesCount: number; instanceCount: number };
export type OrthancStudyMatchResult = { status: "matched" | "not_found" | "ambiguous"; matchKey: "study_instance_uid" | "accession_number"; study: OrthancStudyDetails | null; reason?: string };
export type OrthancStudyQuery = { studyInstanceUid?: string | null; accessionNumber?: string | null; expectedPatientIds?: string[]; expectedModalityCode?: string | null; expectedStudyDate?: string | null };
export type OrthancInstanceDetails = { orthancInstanceId: string; orthancSeriesId: string | null; orthancStudyId: string | null; studyInstanceUid: string | null; seriesInstanceUid: string | null; sopInstanceUid: string | null; patientId: string | null; accessionNumber: string | null; modality: string | null };
export type OrthancUploadedInstance = OrthancInstanceDetails;

type FetchLike = typeof fetch;
type AutoRouteDestination = { key: string; aet: string; host: string; port: number | null; isCdRobot?: boolean; configurationError?: string | null };
type AutoRouteDestinationLoader = () => Promise<{ modalities: AutoRouteDestination[] }>;
let fetchForTests: FetchLike = fetch;
let settingsForTests: AuthoritativeOrthancSettings | null = null;
let autoRouteDestinationLoader: AutoRouteDestinationLoader = listOrthancRemoteModalities;
export function __setAuthoritativeOrthancFetchForTests(value: FetchLike) { fetchForTests = value; }
export function __setAuthoritativeOrthancSettingsForTests(value: AuthoritativeOrthancSettings | null) { settingsForTests = value; }
export function __setAuthoritativeOrthancAutoRouteDestinationLoaderForTests(value: AutoRouteDestinationLoader) { autoRouteDestinationLoader = value; }
export function __resetAuthoritativeOrthancForTests() { fetchForTests = fetch; settingsForTests = null; autoRouteDestinationLoader = listOrthancRemoteModalities; }

function bool(value: unknown, fallback = false) { if (value == null || value === "") return fallback; return [true, 1, "1", "true", "yes", "enabled", "on"].includes(typeof value === "string" ? value.trim().toLowerCase() : value as never); }
function text(value: unknown) { return String(value ?? "").trim(); }
function textList(value: unknown): string[] { let values: unknown[] = []; if (Array.isArray(value)) values = value; else { const raw = text(value); if (!raw) return []; try { const parsed = JSON.parse(raw) as unknown; values = Array.isArray(parsed) ? parsed : [raw]; } catch { values = [raw]; } } return [...new Set(values.map(text).filter(Boolean))]; }
function positive(value: unknown, fallback: number) { const parsed = Number(value); return Number.isInteger(parsed) && parsed >= 1 && parsed <= 120 ? parsed : fallback; }
function validateBaseUrl(value: unknown): string { const raw = text(value); if (!raw) return ""; let url: URL; try { url = new URL(raw); } catch { throw new HttpError(400, "Authoritative Orthanc base URL must be a valid HTTP(S) URL."); } if (!["http:", "https:"].includes(url.protocol) || url.username || url.password || url.search || url.hash || url.pathname !== "/") throw new HttpError(400, "Authoritative Orthanc base URL must be an HTTP(S) origin without credentials, path, query, or fragment."); return url.origin; }
function display(settings: AuthoritativeOrthancSettings): AuthoritativeOrthancSettingsDisplay { const { password: _password, ...safe } = settings; return { ...safe, passwordConfigured: Boolean(settings.password) }; }
function record(value: unknown): Record<string, unknown> { return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {}; }
function first(...values: unknown[]): string | null { for (const value of values) { if (value == null) continue; if (typeof value === "string" || typeof value === "number") { const clean = String(value).trim(); if (clean) return clean; } else if (typeof value === "object") { const row = value as Record<string, unknown>; const nested = first(row.Value, row.value, row.Alphabetic); if (nested) return nested; } } return null; }
function tags(payload: unknown) { const row = record(payload); return { ...row, ...record(row.MainDicomTags), ...record(row.PatientMainDicomTags), ...record(row.Tags), ...record(row.NormalizedTags) }; }
function count(value: unknown) { const parsed = Number(first(value) ?? 0); return Number.isInteger(parsed) && parsed >= 0 ? parsed : 0; }
function routeSlug(value: string): string { return value.trim().toLowerCase().normalize("NFKD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]+/g, "_").replace(/_+/g, "_").replace(/^_+|_+$/g, ""); }
function routeKeyHash(value: string): string { return createHash("sha256").update(value).digest("hex").slice(0, 10); }
export function buildAuthoritativeOrthancRouteAliases(destinationKeys: string[]): Array<{ destinationKey: string; alias: string }> {
  const routes = destinationKeys.map((destinationKey) => ({ destinationKey, slug: routeSlug(destinationKey) || `destination_${routeKeyHash(destinationKey)}` }));
  const slugCounts = new Map<string, number>();
  for (const route of routes) slugCounts.set(route.slug, (slugCounts.get(route.slug) || 0) + 1);
  const aliases = routes.map(({ destinationKey, slug }) => {
    const suffix = slugCounts.get(slug)! > 1 ? `_${routeKeyHash(destinationKey)}` : "";
    const maxSlugLength = 64 - AUTHORITATIVE_ORTHANC_ROUTE_PREFIX.length - suffix.length;
    return { destinationKey, alias: `${AUTHORITATIVE_ORTHANC_ROUTE_PREFIX}${slug.slice(0, maxSlugLength).replace(/_+$/g, "")}${suffix}` };
  });
  if (new Set(aliases.map((route) => route.alias)).size !== aliases.length) throw new HttpError(400, "Selected PACS destinations produce ambiguous Authoritative Orthanc routing aliases.");
  return aliases;
}
export function buildAuthoritativeOrthancCdAliases(destinationKeys: string[]): Array<{ destinationKey: string; alias: string }> {
  const routes = destinationKeys.map((destinationKey) => ({ destinationKey, slug: routeSlug(destinationKey) || `destination_${routeKeyHash(destinationKey)}` }));
  const slugCounts = new Map<string, number>();
  for (const route of routes) slugCounts.set(route.slug, (slugCounts.get(route.slug) || 0) + 1);
  const aliases = routes.map(({ destinationKey, slug }) => {
    const suffix = slugCounts.get(slug)! > 1 ? `_${routeKeyHash(destinationKey)}` : "";
    const maxSlugLength = 64 - AUTHORITATIVE_ORTHANC_CD_PREFIX.length - suffix.length;
    return { destinationKey, alias: `${AUTHORITATIVE_ORTHANC_CD_PREFIX}${slug.slice(0, maxSlugLength).replace(/_+$/g, "")}${suffix}` };
  });
  if (new Set(aliases.map((item) => item.alias)).size !== aliases.length) throw new HttpError(400, "CD robot destinations produce ambiguous Authoritative Orthanc aliases.");
  return aliases;
}

export async function resolveAuthoritativeOrthancCdAlias(destinationKey: string): Promise<string> {
  const { modalities } = await autoRouteDestinationLoader();
  const alias = buildAuthoritativeOrthancCdAliases(modalities.filter((item) => item.isCdRobot).map((item) => item.key))
    .find((item) => item.destinationKey === destinationKey)?.alias;
  if (!alias) throw new HttpError(409, "Selected CD robot is not available.");
  return alias;
}

export async function readAuthoritativeOrthancSettings(): Promise<AuthoritativeOrthancSettings> {
  if (settingsForTests) return settingsForTests;
  const values = (await loadSettingsMap([AUTHORITATIVE_ORTHANC_CATEGORY]))[AUTHORITATIVE_ORTHANC_CATEGORY] || {};
  const enabled = bool(values.enabled);
  const legacyDestinationKey = text(values.auto_route_destination_key);
  const autoRouteDestinationKeys = textList(values.auto_route_destination_keys);
  if (!autoRouteDestinationKeys.length && legacyDestinationKey) autoRouteDestinationKeys.push(legacyDestinationKey);
  return { enabled, autoExportClinicalDocuments: bool(values.auto_export_clinical_documents, enabled), autoRouteEnabled: bool(values.auto_route_enabled), autoRouteDestinationKey: autoRouteDestinationKeys[0] || legacyDestinationKey, autoRouteDestinationKeys, baseUrl: validateBaseUrl(values.base_url), username: text(values.username), password: text(values.password), timeoutSeconds: positive(values.timeout_seconds, 10), verifyTls: bool(values.verify_tls, true), displayName: text(values.display_name) };
}
export function isClinicalDocumentAutoExportEnabled(settings: AuthoritativeOrthancSettings): boolean { return settings.enabled && settings.autoExportClinicalDocuments; }
export async function readAuthoritativeOrthancSettingsForDisplay() { return display(await readAuthoritativeOrthancSettings()); }
export async function saveAuthoritativeOrthancSettings(input: Record<string, unknown>, userId: UserId) {
  const current = await readAuthoritativeOrthancSettings();
  const password = text(input.password) || current.password;
  const suppliedDestinationKeys = input.autoRouteDestinationKeys ?? input.auto_route_destination_keys;
  const autoRouteDestinationKeys = suppliedDestinationKeys == null ? textList(input.autoRouteDestinationKey ?? input.auto_route_destination_key ?? current.autoRouteDestinationKeys) : textList(suppliedDestinationKeys);
  const settings: AuthoritativeOrthancSettings = { enabled: bool(input.enabled), autoExportClinicalDocuments: bool(input.autoExportClinicalDocuments ?? input.auto_export_clinical_documents, current.autoExportClinicalDocuments), autoRouteEnabled: bool(input.autoRouteEnabled ?? input.auto_route_enabled, current.autoRouteEnabled), autoRouteDestinationKey: autoRouteDestinationKeys[0] || "", autoRouteDestinationKeys, baseUrl: validateBaseUrl(input.baseUrl ?? input.base_url), username: text(input.username), password, timeoutSeconds: positive(input.timeoutSeconds ?? input.timeout_seconds, 10), verifyTls: bool(input.verifyTls ?? input.verify_tls, true), displayName: text(input.displayName ?? input.display_name) };
  if (settings.enabled && !settings.baseUrl) throw new HttpError(400, "Authoritative Orthanc base URL is required when enabled.");
  if (settings.autoRouteEnabled && !settings.enabled) throw new HttpError(400, "Authoritative Orthanc must be enabled before DICOM auto-routing can be enabled.");
  await synchronizeAuthoritativeOrthancAutoRoute(settings);
  await upsertSettings(AUTHORITATIVE_ORTHANC_CATEGORY, [{ key: "enabled", value: settings.enabled ? "enabled" : "disabled" }, { key: "auto_export_clinical_documents", value: settings.autoExportClinicalDocuments ? "enabled" : "disabled" }, { key: "auto_route_enabled", value: settings.autoRouteEnabled ? "enabled" : "disabled" }, { key: "auto_route_destination_key", value: settings.autoRouteDestinationKey }, { key: "auto_route_destination_keys", value: JSON.stringify(settings.autoRouteDestinationKeys) }, { key: "base_url", value: settings.baseUrl }, { key: "username", value: settings.username }, { key: "password", value: settings.password }, { key: "timeout_seconds", value: String(settings.timeoutSeconds) }, { key: "verify_tls", value: settings.verifyTls ? "true" : "false" }, { key: "display_name", value: settings.displayName }], userId);
  await logAuditEntry({ entityType: "integration", entityId: null, actionType: "authoritative_orthanc_settings_saved", oldValues: null, newValues: { ...display(settings), passwordChanged: Boolean(text(input.password)) }, changedByUserId: userId });
  return display(settings);
}

export class AuthoritativeOrthancClient {
  constructor(private readonly settings: AuthoritativeOrthancSettings) {}
  private async insecureTlsRequest(url: string, init: RequestInit): Promise<Response> {
    return new Promise((resolve, reject) => {
      const request = httpsRequest(url, { method: init.method || "GET", headers: init.headers as Record<string, string>, agent: new HttpsAgent({ rejectUnauthorized: false }) }, (response) => {
        const chunks: Buffer[] = [];
        response.on("data", (chunk: Buffer) => chunks.push(Buffer.from(chunk)));
        response.on("end", () => resolve(new Response(Buffer.concat(chunks), { status: response.statusCode || 502 })));
      });
      const abort = () => { const error = new Error("aborted"); error.name = "AbortError"; request.destroy(error); };
      init.signal?.addEventListener("abort", abort, { once: true });
      request.on("error", reject);
      if (typeof init.body === "string" || Buffer.isBuffer(init.body)) request.write(init.body);
      request.end();
    });
  }
  private async request(path: string, init: RequestInit = {}, options: { allowDisabled?: boolean; acceptableStatuses?: number[] } = {}): Promise<unknown> {
    if (!this.settings.enabled && !options.allowDisabled) throw new HttpError(503, "Authoritative Orthanc is disabled.", { code: "orthanc_disabled" });
    if (!this.settings.baseUrl) throw new HttpError(503, "Authoritative Orthanc base URL is not configured.");
    const controller = new AbortController(); const timeout = setTimeout(() => controller.abort(), this.settings.timeoutSeconds * 1000);
    try {
      const headers: Record<string, string> = { Accept: "application/json", ...(init.headers as Record<string, string> || {}) };
      if (this.settings.username) headers.Authorization = `Basic ${Buffer.from(`${this.settings.username}:${this.settings.password}`).toString("base64")}`;
      const request: RequestInit = { ...init, headers, signal: controller.signal };
      const url = new URL(path.replace(/^\//, ""), `${this.settings.baseUrl}/`).toString();
      const response = !this.settings.verifyTls && this.settings.baseUrl.startsWith("https://") ? await this.insecureTlsRequest(url, request) : await fetchForTests(url, request);
      if (response.status === 401 || response.status === 403) throw new HttpError(502, "Authoritative Orthanc authentication failed.", { code: "orthanc_auth_failed" });
      if (options.acceptableStatuses?.includes(response.status)) return null;
      if (!response.ok) throw new HttpError(502, `Authoritative Orthanc request failed (status=${response.status}).`);
      const body = await response.text();
      if (!body) return null;
      try { return JSON.parse(body) as unknown; } catch { throw new HttpError(502, "Authoritative Orthanc returned an invalid JSON response.", { code: "orthanc_invalid_response" }); }
    } catch (error) { if ((error as Error).name === "AbortError") throw new HttpError(502, "Authoritative Orthanc request timed out.", { code: "orthanc_timeout" }); if (error instanceof HttpError) throw error; if (/ECONNREFUSED|ECONNRESET|ETIMEDOUT|EAI_AGAIN|fetch failed|ENOTFOUND/i.test(String(error))) throw new HttpError(502, "Authoritative Orthanc is unavailable.", { code: "orthanc_unavailable" }); throw error; } finally { clearTimeout(timeout); }
  }
  async getSystem(): Promise<OrthancSystemInfo> { const row = record(await this.request("/system")); const version = first(row.Version, row.version); if (!version && !first(row.Name, row.name)) throw new HttpError(502, "Authoritative Orthanc returned an invalid system response."); return { name: first(row.Name, row.name, this.settings.displayName), version, apiVersion: first(row.ApiVersion, row.API_VERSION, row.apiVersion) }; }
  async listRemoteModalityKeys(): Promise<string[]> { const payload = await this.request("/modalities", {}, { allowDisabled: true }); return Array.isArray(payload) ? payload.map(text).filter(Boolean) : Object.keys(record(payload)); }
  async upsertRemoteModality(key: string, modality: { aet: string; host: string; port: number }): Promise<void> { if (!/^[A-Za-z0-9_-]{1,64}$/.test(key)) throw new HttpError(400, "Invalid Authoritative Orthanc modality alias."); await this.request(`/modalities/${encodeURIComponent(key)}`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ AET: modality.aet, Host: modality.host, Port: modality.port }) }); }
  async deleteRemoteModality(key: string): Promise<void> { if (!/^[A-Za-z0-9_-]{1,64}$/.test(key)) throw new HttpError(400, "Invalid Authoritative Orthanc modality alias."); await this.request(`/modalities/${encodeURIComponent(key)}`, { method: "DELETE" }, { allowDisabled: true, acceptableStatuses: [404] }); }
  async echoRemoteModality(key: string): Promise<void> { await this.request(`/modalities/${encodeURIComponent(key)}/echo`, { method: "POST" }); }
  async enqueueStudyStore(key: string, orthancStudyId: string): Promise<string> {
    const response = record(await this.request(`/modalities/${encodeURIComponent(key)}/store`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ Resources: [orthancStudyId], Synchronous: false }) }));
    const jobId = first(response.ID, response.Id, response.id, response.Path);
    if (!jobId) throw new HttpError(502, "Authoritative Orthanc accepted the study send without a job ID.", { code: "orthanc_send_job_id_missing" });
    return jobId.replace(/^\/jobs\//, "");
  }
  async getJob(jobId: string): Promise<Record<string, unknown>> { return record(await this.request(`/jobs/${encodeURIComponent(jobId)}`)); }
  async assertStudyStableAndNonEmpty(orthancStudyId: string): Promise<OrthancStudyDetails> {
    const detail = await this.getStudy(orthancStudyId);
    const raw = record(await this.request(`/studies/${encodeURIComponent(orthancStudyId)}`));
    if (raw.IsStable === false) throw new HttpError(409, "Study is not yet stable in Authoritative Orthanc.", { code: "study_not_stable" });
    if (detail.instanceCount < 1) throw new HttpError(409, "Study has no instances in Authoritative Orthanc.", { code: "study_empty" });
    return detail;
  }
  async getStudy(orthancStudyId: string): Promise<OrthancStudyDetails> { if (!/^[A-Za-z0-9_-]{1,256}$/.test(orthancStudyId)) throw new HttpError(400, "Invalid Orthanc study ID."); const [detail, statistics] = await Promise.all([this.request(`/studies/${encodeURIComponent(orthancStudyId)}`), this.request(`/studies/${encodeURIComponent(orthancStudyId)}/statistics`).catch(() => ({}))]); const row = { ...record(detail), ...record(statistics) }; const dicom = tags(row); return { orthancStudyId, studyInstanceUid: first(dicom.StudyInstanceUID, dicom["0020000D"]), accessionNumber: first(dicom.AccessionNumber, dicom["00080050"]), patientId: first(dicom.PatientID, dicom["00100020"]), patientName: first(dicom.PatientName, dicom["00100010"]), patientBirthDate: first(dicom.PatientBirthDate, dicom["00100030"]), patientSex: first(dicom.PatientSex, dicom["00100040"]), studyDate: first(dicom.StudyDate, dicom["00080020"]), studyDescription: first(dicom.StudyDescription, dicom["00081030"]), modalitiesInStudy: (first(dicom.ModalitiesInStudy, dicom.Modality, dicom["00080061"], dicom["00080060"]) || "").split("\\").filter(Boolean), seriesCount: count(row.SeriesCount ?? row.CountSeries ?? dicom.NumberOfStudyRelatedSeries ?? dicom["00201206"]), instanceCount: count(row.InstanceCount ?? row.CountInstances ?? dicom.NumberOfStudyRelatedInstances ?? dicom["00201208"]) }; }
  async getInstance(orthancInstanceId: string): Promise<OrthancInstanceDetails> {
    if (!/^[A-Za-z0-9_-]{1,256}$/.test(orthancInstanceId)) throw new HttpError(400, "Invalid Orthanc instance ID.");
    const detail = record(await this.request(`/instances/${encodeURIComponent(orthancInstanceId)}`));
    const orthancSeriesId = first(detail.ParentSeries, detail.parentSeries);
    let orthancStudyId = first(detail.ParentStudy, detail.parentStudy);
    if (!orthancStudyId && orthancSeriesId) {
      const series = record(await this.request(`/series/${encodeURIComponent(orthancSeriesId)}`));
      orthancStudyId = first(series.ParentStudy, series.parentStudy);
    }

    let simplifiedTags: unknown = null;
    let simplifiedError: unknown = null;
    try { simplifiedTags = await this.request(`/instances/${encodeURIComponent(orthancInstanceId)}/simplified-tags`); } catch (error) { simplifiedError = error; }
    let dicom = tags(simplifiedTags);
    const readInstanceValues = () => ({
      studyInstanceUid: first(dicom.StudyInstanceUID, dicom["0020000D"]),
      seriesInstanceUid: first(dicom.SeriesInstanceUID, dicom["0020000E"]),
      sopInstanceUid: first(dicom.SOPInstanceUID, dicom["00080018"]),
      patientId: first(dicom.PatientID, dicom["00100020"]),
      accessionNumber: first(dicom.AccessionNumber, dicom["00080050"]),
      modality: first(dicom.Modality, dicom["00080060"]),
    });
    let values = readInstanceValues();
    if (!values.studyInstanceUid || !values.seriesInstanceUid || !values.sopInstanceUid || !values.modality) {
      let detailed: unknown = null;
      let detailedError: unknown = null;
      try { detailed = await this.request(`/instances/${encodeURIComponent(orthancInstanceId)}/tags`); } catch (error) { detailedError = error; }
      if (simplifiedError && detailedError) throw detailedError;
      dicom = { ...dicom, ...tags(detailed) };
      values = readInstanceValues();
    }
    const result = { orthancInstanceId, orthancSeriesId, orthancStudyId, ...values };
    if (!result.studyInstanceUid || !result.seriesInstanceUid || !result.sopInstanceUid) throw new HttpError(502, "Authoritative Orthanc returned incomplete instance metadata.", { code: "orthanc_invalid_response" });
    return result;
  }
  async findInstanceBySopInstanceUid(sopInstanceUid: string): Promise<OrthancInstanceDetails | null> { const uid = text(sopInstanceUid); if (!uid) throw new HttpError(400, "A SOPInstanceUID is required."); const ids = await this.request("/tools/find", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ Level: "Instance", Query: { SOPInstanceUID: uid } }) }); if (!Array.isArray(ids)) throw new HttpError(502, "Authoritative Orthanc returned an invalid instance search response.", { code: "orthanc_invalid_response" }); const matches = await Promise.all(ids.filter((id): id is string => typeof id === "string").map((id) => this.getInstance(id))); const exact = matches.filter((instance) => instance.sopInstanceUid === uid); if (exact.length > 1) throw new HttpError(502, "Authoritative Orthanc returned multiple instances for one SOPInstanceUID.", { code: "orthanc_invalid_response" }); return exact[0] || null; }
  async uploadDicomInstance(bytes: Buffer, intendedStudyInstanceUid: string): Promise<OrthancUploadedInstance> { if (!bytes.length) throw new HttpError(400, "Generated DICOM instance is empty.", { code: "orthanc_invalid_dicom" }); const response = record(await this.request("/instances", { method: "POST", headers: { "Content-Type": "application/dicom", Accept: "application/json" }, body: bytes as unknown as BodyInit })); const orthancInstanceId = first(response.ID, response.Id, response.id); if (!orthancInstanceId) throw new HttpError(502, "Authoritative Orthanc returned an invalid upload response.", { code: "orthanc_invalid_response" }); const verified = await this.getInstance(orthancInstanceId); if (verified.studyInstanceUid !== text(intendedStudyInstanceUid)) throw new HttpError(502, "Authoritative Orthanc accepted the instance in a different study.", { code: "orthanc_study_mismatch" }); return verified; }
  async findStudy(query: OrthancStudyQuery): Promise<OrthancStudyMatchResult> { const uid = text(query.studyInstanceUid); const accession = text(query.accessionNumber); const matchKey = uid ? "study_instance_uid" : "accession_number" as const; const matchValue = uid || accession; if (!matchValue) throw new HttpError(400, "A StudyInstanceUID or accession number is required."); const ids = await this.request("/tools/find", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ Level: "Study", Query: uid ? { StudyInstanceUID: uid } : { AccessionNumber: accession } }) }); if (!Array.isArray(ids)) throw new HttpError(502, "Authoritative Orthanc returned an invalid study search response."); const studies = await Promise.all(ids.filter((id): id is string => typeof id === "string").map((id) => this.getStudy(id)));
    const exact = uid ? studies.filter((study) => study.studyInstanceUid === uid) : studies.filter((study) => study.accessionNumber === accession); if (uid && exact.length !== studies.length) return { status: "ambiguous", matchKey, study: null, reason: "study_instance_uid_conflict" }; if (exact.length === 0) return { status: "not_found", matchKey, study: null }; if (exact.length !== 1) return { status: "ambiguous", matchKey, study: null, reason: "multiple_studies" }; const study = exact[0]!;
    if (!uid) { const expected = (query.expectedPatientIds || []).map((value) => value.trim().toUpperCase()).filter(Boolean); if (expected.length && study.patientId && !expected.includes(study.patientId.toUpperCase())) return { status: "ambiguous", matchKey, study: null, reason: "patient_conflict" }; if (query.expectedModalityCode && study.modalitiesInStudy.length && !study.modalitiesInStudy.map((value) => value.toUpperCase()).includes(query.expectedModalityCode.toUpperCase())) return { status: "ambiguous", matchKey, study: null, reason: "modality_conflict" }; if (query.expectedStudyDate && study.studyDate && study.studyDate.replace(/[^0-9]/g, "").slice(0, 8) !== query.expectedStudyDate.replace(/[^0-9]/g, "").slice(0, 8)) return { status: "ambiguous", matchKey, study: null, reason: "study_date_conflict" }; }
    return { status: "matched", matchKey, study };
  }
}
export async function synchronizeAuthoritativeOrthancAutoRoute(settings: AuthoritativeOrthancSettings): Promise<void> {
  const client = new AuthoritativeOrthancClient(settings);
  const managedAlias = (key: string) => key.startsWith(AUTHORITATIVE_ORTHANC_ROUTE_PREFIX) || LEGACY_AUTHORITATIVE_ORTHANC_AUTOROUTE_ALIAS.test(key);
  const existingAliases = settings.baseUrl ? (await client.listRemoteModalityKeys()).filter(managedAlias) : [];
  if (!settings.autoRouteEnabled) {
    for (const alias of existingAliases) await client.deleteRemoteModality(alias);
    return;
  }
  const { modalities } = await autoRouteDestinationLoader();
  const destinations = settings.autoRouteDestinationKeys.map((key) => modalities.find((item) => item.key === key));
  if (!destinations.length || destinations.some((destination) => !destination || !destination.aet || !destination.host || destination.port == null || destination.configurationError)) throw new HttpError(400, "Select one or more valid existing PACS destinations for DICOM auto-routing.");
  const routes = buildAuthoritativeOrthancRouteAliases(settings.autoRouteDestinationKeys);
  const desiredAliases = routes.map((route) => route.alias);
  for (const [index, destination] of destinations.entries()) await client.upsertRemoteModality(routes[index]!.alias, { aet: destination!.aet, host: destination!.host, port: destination!.port! });
  for (const alias of existingAliases.filter((item) => !desiredAliases.includes(item))) await client.deleteRemoteModality(alias);
}
export async function synchronizeAuthoritativeOrthancCdRobots(): Promise<void> {
  const settings = await readAuthoritativeOrthancSettings();
  if (!settings.enabled || !settings.baseUrl) return;
  const client = new AuthoritativeOrthancClient(settings);
  const { modalities } = await autoRouteDestinationLoader();
  const destinations = modalities.filter((item) => item.isCdRobot);
  if (destinations.some((item) => !item.aet || !item.host || item.port == null || item.configurationError)) throw new HttpError(400, "A CD robot destination is missing valid PACS connection details.");
  const routes = buildAuthoritativeOrthancCdAliases(destinations.map((item) => item.key));
  const existing = (await client.listRemoteModalityKeys()).filter((key) => key.startsWith(AUTHORITATIVE_ORTHANC_CD_PREFIX));
  for (const [index, destination] of destinations.entries()) await client.upsertRemoteModality(routes[index]!.alias, { aet: destination.aet, host: destination.host, port: destination.port! });
  for (const alias of existing.filter((alias) => !routes.some((route) => route.alias === alias))) await client.deleteRemoteModality(alias);
}
export async function createAuthoritativeOrthancClient() { return new AuthoritativeOrthancClient(await readAuthoritativeOrthancSettings()); }
function httpErrorCode(error: HttpError): string { const details = record(error.details); return text(details.code) || "request_failed"; }
export async function testAuthoritativeOrthancConnection(userId: UserId) {
  try {
    const system = await (await createAuthoritativeOrthancClient()).getSystem();
    await logAuditEntry({ entityType: "integration", entityId: null, actionType: "authoritative_orthanc_connection_tested", oldValues: null, newValues: { outcome: "connected", name: system.name, version: system.version }, changedByUserId: userId });
    return system;
  } catch (error) {
    await logAuditEntry({ entityType: "integration", entityId: null, actionType: "authoritative_orthanc_connection_tested", oldValues: null, newValues: { outcome: "failed", code: error instanceof HttpError ? httpErrorCode(error) : "request_failed" }, changedByUserId: userId });
    throw error;
  }
}
export async function getAuthoritativeOrthancStatus() { const settings = await readAuthoritativeOrthancSettings(); if (!settings.enabled) return { state: "disabled" as const, system: null }; try { return { state: "connected" as const, system: await new AuthoritativeOrthancClient(settings).getSystem() }; } catch { return { state: "unavailable" as const, system: null }; } }
export async function findAuthoritativeOrthancStudyForAppointment(appointmentId: number, userId: UserId) { const { rows } = await pool.query<{ id:number; accession_number:string; study_instance_uid:string|null; national_id:string|null; mrn:string|null; patient_primary_id:string|null; modality_code:string|null; booking_date:string }>(`select b.id,('V2-' || lpad(b.id::text,6,'0')) accession_number,b.study_instance_uid,p.national_id,p.mrn,p.identifier_value patient_primary_id,m.code modality_code,b.booking_date::text booking_date from appointments_v2.bookings b join patients p on p.id=b.patient_id left join modalities m on m.id=b.modality_id where b.id=$1`, [appointmentId]); if (!rows[0]) throw new HttpError(404, "Appointment not found."); const booking = rows[0]; const modality = normalizeRisproModalityCode(booking.modality_code); if (!modality) throw new HttpError(409, "The RISpro modality code cannot be mapped to a DICOM modality."); const client = await createAuthoritativeOrthancClient(); const uidResult = booking.study_instance_uid ? await client.findStudy({ studyInstanceUid: booking.study_instance_uid, accessionNumber: booking.accession_number }) : { status: "not_found" as const, matchKey: "study_instance_uid" as const, study: null }; const result = uidResult.status === "not_found" ? await client.findStudy({ accessionNumber: booking.accession_number, expectedPatientIds: [booking.patient_primary_id || "", booking.national_id || "", booking.mrn || ""], expectedModalityCode: modality, expectedStudyDate: booking.booking_date }) : uidResult; if (result.status === "ambiguous") await logAuditEntry({ entityType: "appointment", entityId: appointmentId, actionType: "authoritative_orthanc_study_lookup_failed", oldValues: null, newValues: { status: result.status, reason: result.reason, matchKey: result.matchKey }, changedByUserId: userId }); return result; }
