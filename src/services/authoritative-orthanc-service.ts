import { pool } from "../db/pool.js";
import { Agent as HttpsAgent, request as httpsRequest } from "node:https";
import { HttpError } from "../utils/http-error.js";
import { logAuditEntry } from "./audit-service.js";
import { loadSettingsMap, upsertSettings } from "./settings-service.js";
import type { UserId } from "../types/http.js";

export const AUTHORITATIVE_ORTHANC_CATEGORY = "authoritative_orthanc";
export type AuthoritativeOrthancSettings = { enabled: boolean; baseUrl: string; username: string; password: string; timeoutSeconds: number; verifyTls: boolean; displayName: string };
export type AuthoritativeOrthancSettingsDisplay = Omit<AuthoritativeOrthancSettings, "password"> & { passwordConfigured: boolean };
export type OrthancSystemInfo = { name: string | null; version: string | null; apiVersion: string | null };
export type OrthancStudyDetails = { orthancStudyId: string; studyInstanceUid: string | null; accessionNumber: string | null; patientId: string | null; patientName: string | null; studyDate: string | null; studyDescription: string | null; modalitiesInStudy: string[]; seriesCount: number; instanceCount: number };
export type OrthancStudyMatchResult = { status: "matched" | "not_found" | "ambiguous"; matchKey: "study_instance_uid" | "accession_number"; study: OrthancStudyDetails | null; reason?: string };
export type OrthancStudyQuery = { studyInstanceUid?: string | null; accessionNumber?: string | null; expectedPatientIds?: string[]; expectedModalityCode?: string | null; expectedStudyDate?: string | null };

type FetchLike = typeof fetch;
let fetchForTests: FetchLike = fetch;
let settingsForTests: AuthoritativeOrthancSettings | null = null;
export function __setAuthoritativeOrthancFetchForTests(value: FetchLike) { fetchForTests = value; }
export function __setAuthoritativeOrthancSettingsForTests(value: AuthoritativeOrthancSettings | null) { settingsForTests = value; }
export function __resetAuthoritativeOrthancForTests() { fetchForTests = fetch; settingsForTests = null; }

function bool(value: unknown, fallback = false) { if (value == null || value === "") return fallback; return [true, 1, "1", "true", "yes", "enabled", "on"].includes(typeof value === "string" ? value.trim().toLowerCase() : value as never); }
function text(value: unknown) { return String(value ?? "").trim(); }
function positive(value: unknown, fallback: number) { const parsed = Number(value); return Number.isInteger(parsed) && parsed >= 1 && parsed <= 120 ? parsed : fallback; }
function validateBaseUrl(value: unknown): string { const raw = text(value); if (!raw) return ""; let url: URL; try { url = new URL(raw); } catch { throw new HttpError(400, "Authoritative Orthanc base URL must be a valid HTTP(S) URL."); } if (!["http:", "https:"].includes(url.protocol) || url.username || url.password || url.search || url.hash || url.pathname !== "/") throw new HttpError(400, "Authoritative Orthanc base URL must be an HTTP(S) origin without credentials, path, query, or fragment."); return url.origin; }
function display(settings: AuthoritativeOrthancSettings): AuthoritativeOrthancSettingsDisplay { const { password: _password, ...safe } = settings; return { ...safe, passwordConfigured: Boolean(settings.password) }; }
function record(value: unknown): Record<string, unknown> { return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {}; }
function first(...values: unknown[]): string | null { for (const value of values) { if (value == null) continue; if (typeof value === "string" || typeof value === "number") { const clean = String(value).trim(); if (clean) return clean; } else if (typeof value === "object") { const row = value as Record<string, unknown>; const nested = first(row.Value, row.value, row.Alphabetic); if (nested) return nested; } } return null; }
function tags(payload: unknown) { const row = record(payload); return { ...row, ...record(row.MainDicomTags), ...record(row.PatientMainDicomTags), ...record(row.Tags), ...record(row.NormalizedTags) }; }
function count(value: unknown) { const parsed = Number(first(value) ?? 0); return Number.isInteger(parsed) && parsed >= 0 ? parsed : 0; }

export async function readAuthoritativeOrthancSettings(): Promise<AuthoritativeOrthancSettings> {
  if (settingsForTests) return settingsForTests;
  const values = (await loadSettingsMap([AUTHORITATIVE_ORTHANC_CATEGORY]))[AUTHORITATIVE_ORTHANC_CATEGORY] || {};
  return { enabled: bool(values.enabled), baseUrl: validateBaseUrl(values.base_url), username: text(values.username), password: text(values.password), timeoutSeconds: positive(values.timeout_seconds, 10), verifyTls: bool(values.verify_tls, true), displayName: text(values.display_name) };
}
export async function readAuthoritativeOrthancSettingsForDisplay() { return display(await readAuthoritativeOrthancSettings()); }
export async function saveAuthoritativeOrthancSettings(input: Record<string, unknown>, userId: UserId) {
  const current = await readAuthoritativeOrthancSettings();
  const password = text(input.password) || current.password;
  const settings: AuthoritativeOrthancSettings = { enabled: bool(input.enabled), baseUrl: validateBaseUrl(input.baseUrl ?? input.base_url), username: text(input.username), password, timeoutSeconds: positive(input.timeoutSeconds ?? input.timeout_seconds, 10), verifyTls: bool(input.verifyTls ?? input.verify_tls, true), displayName: text(input.displayName ?? input.display_name) };
  if (settings.enabled && !settings.baseUrl) throw new HttpError(400, "Authoritative Orthanc base URL is required when enabled.");
  await upsertSettings(AUTHORITATIVE_ORTHANC_CATEGORY, [{ key: "enabled", value: settings.enabled ? "enabled" : "disabled" }, { key: "base_url", value: settings.baseUrl }, { key: "username", value: settings.username }, { key: "password", value: settings.password }, { key: "timeout_seconds", value: String(settings.timeoutSeconds) }, { key: "verify_tls", value: settings.verifyTls ? "true" : "false" }, { key: "display_name", value: settings.displayName }], userId);
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
      if (typeof init.body === "string") request.write(init.body);
      request.end();
    });
  }
  private async request(path: string, init: RequestInit = {}): Promise<unknown> {
    if (!this.settings.enabled) throw new HttpError(503, "Authoritative Orthanc is disabled.", { code: "orthanc_disabled" });
    if (!this.settings.baseUrl) throw new HttpError(503, "Authoritative Orthanc base URL is not configured.");
    const controller = new AbortController(); const timeout = setTimeout(() => controller.abort(), this.settings.timeoutSeconds * 1000);
    try {
      const headers: Record<string, string> = { Accept: "application/json", ...(init.headers as Record<string, string> || {}) };
      if (this.settings.username) headers.Authorization = `Basic ${Buffer.from(`${this.settings.username}:${this.settings.password}`).toString("base64")}`;
      const request: RequestInit = { ...init, headers, signal: controller.signal };
      const url = new URL(path.replace(/^\//, ""), `${this.settings.baseUrl}/`).toString();
      const response = !this.settings.verifyTls && this.settings.baseUrl.startsWith("https://") ? await this.insecureTlsRequest(url, request) : await fetchForTests(url, request);
      if (response.status === 401 || response.status === 403) throw new HttpError(502, "Authoritative Orthanc authentication failed.", { code: "orthanc_auth_failed" });
      if (!response.ok) throw new HttpError(502, `Authoritative Orthanc request failed (status=${response.status}).`);
      try { return await response.json(); } catch { throw new HttpError(502, "Authoritative Orthanc returned an invalid JSON response.", { code: "orthanc_invalid_response" }); }
    } catch (error) { if ((error as Error).name === "AbortError") throw new HttpError(502, "Authoritative Orthanc request timed out.", { code: "orthanc_timeout" }); if (error instanceof HttpError) throw error; if (/ECONNREFUSED|fetch failed|ENOTFOUND/i.test(String(error))) throw new HttpError(502, "Authoritative Orthanc is unavailable.", { code: "orthanc_unavailable" }); throw error; } finally { clearTimeout(timeout); }
  }
  async getSystem(): Promise<OrthancSystemInfo> { const row = record(await this.request("/system")); const version = first(row.Version, row.version); if (!version && !first(row.Name, row.name)) throw new HttpError(502, "Authoritative Orthanc returned an invalid system response."); return { name: first(row.Name, row.name, this.settings.displayName), version, apiVersion: first(row.ApiVersion, row.API_VERSION, row.apiVersion) }; }
  async getStudy(orthancStudyId: string): Promise<OrthancStudyDetails> { if (!/^[A-Za-z0-9_-]{1,256}$/.test(orthancStudyId)) throw new HttpError(400, "Invalid Orthanc study ID."); const [detail, statistics] = await Promise.all([this.request(`/studies/${encodeURIComponent(orthancStudyId)}`), this.request(`/studies/${encodeURIComponent(orthancStudyId)}/statistics`).catch(() => ({}))]); const row = { ...record(detail), ...record(statistics) }; const dicom = tags(row); return { orthancStudyId, studyInstanceUid: first(dicom.StudyInstanceUID, dicom["0020000D"]), accessionNumber: first(dicom.AccessionNumber, dicom["00080050"]), patientId: first(dicom.PatientID, dicom["00100020"]), patientName: first(dicom.PatientName, dicom["00100010"]), studyDate: first(dicom.StudyDate, dicom["00080020"]), studyDescription: first(dicom.StudyDescription, dicom["00081030"]), modalitiesInStudy: (first(dicom.ModalitiesInStudy, dicom.Modality, dicom["00080061"], dicom["00080060"]) || "").split("\\").filter(Boolean), seriesCount: count(row.SeriesCount ?? row.CountSeries ?? dicom.NumberOfStudyRelatedSeries ?? dicom["00201206"]), instanceCount: count(row.InstanceCount ?? row.CountInstances ?? dicom.NumberOfStudyRelatedInstances ?? dicom["00201208"]) }; }
  async findStudy(query: OrthancStudyQuery): Promise<OrthancStudyMatchResult> { const uid = text(query.studyInstanceUid); const accession = text(query.accessionNumber); const matchKey = uid ? "study_instance_uid" : "accession_number" as const; const matchValue = uid || accession; if (!matchValue) throw new HttpError(400, "A StudyInstanceUID or accession number is required."); const ids = await this.request("/tools/find", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ Level: "Study", Query: uid ? { StudyInstanceUID: uid } : { AccessionNumber: accession } }) }); if (!Array.isArray(ids)) throw new HttpError(502, "Authoritative Orthanc returned an invalid study search response."); const studies = await Promise.all(ids.filter((id): id is string => typeof id === "string").map((id) => this.getStudy(id)));
    const exact = uid ? studies.filter((study) => study.studyInstanceUid === uid) : studies.filter((study) => study.accessionNumber === accession); if (uid && exact.length !== studies.length) return { status: "ambiguous", matchKey, study: null, reason: "study_instance_uid_conflict" }; if (exact.length === 0) return { status: "not_found", matchKey, study: null }; if (exact.length !== 1) return { status: "ambiguous", matchKey, study: null, reason: "multiple_studies" }; const study = exact[0]!;
    if (!uid) { const expected = (query.expectedPatientIds || []).map((value) => value.trim().toUpperCase()).filter(Boolean); if (expected.length && study.patientId && !expected.includes(study.patientId.toUpperCase())) return { status: "ambiguous", matchKey, study: null, reason: "patient_conflict" }; if (query.expectedModalityCode && study.modalitiesInStudy.length && !study.modalitiesInStudy.map((value) => value.toUpperCase()).includes(query.expectedModalityCode.toUpperCase())) return { status: "ambiguous", matchKey, study: null, reason: "modality_conflict" }; if (query.expectedStudyDate && study.studyDate && study.studyDate.replace(/[^0-9]/g, "").slice(0, 8) !== query.expectedStudyDate.replace(/[^0-9]/g, "").slice(0, 8)) return { status: "ambiguous", matchKey, study: null, reason: "study_date_conflict" }; }
    return { status: "matched", matchKey, study };
  }
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
export async function findAuthoritativeOrthancStudyForAppointment(appointmentId: number, userId: UserId) { const { rows } = await pool.query<{ id:number; accession_number:string; study_instance_uid:string|null; national_id:string|null; mrn:string|null; modality_code:string|null; booking_date:string }>(`select b.id,('V2-' || lpad(b.id::text,6,'0')) accession_number,b.study_instance_uid,p.national_id,p.mrn,m.code modality_code,b.booking_date::text booking_date from appointments_v2.bookings b join patients p on p.id=b.patient_id left join modalities m on m.id=b.modality_id where b.id=$1`, [appointmentId]); if (!rows[0]) throw new HttpError(404, "Appointment not found."); const booking = rows[0]; const result = await (await createAuthoritativeOrthancClient()).findStudy({ studyInstanceUid: booking.study_instance_uid, accessionNumber: booking.accession_number, expectedPatientIds: [booking.national_id || "", booking.mrn || ""], expectedModalityCode: booking.modality_code, expectedStudyDate: booking.booking_date }); if (result.status === "ambiguous") await logAuditEntry({ entityType: "appointment", entityId: appointmentId, actionType: "authoritative_orthanc_study_lookup_failed", oldValues: null, newValues: { status: result.status, reason: result.reason, matchKey: result.matchKey }, changedByUserId: userId }); return result; }
