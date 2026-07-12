import { HttpError } from "../../utils/http-error.js";
import { resolveOrthancSettings, type ResolvedOrthancSettings } from "../../services/orthanc-settings-resolver.js";
import { searchOrthancPacsStudies } from "../../services/orthanc-pacs-service.js";
import type { UnknownRecord } from "../../types/http.js";
import type { ImagingSourceAdapter, ImagingStudy, OhifViewerConfiguration, PacsWebEndpoint } from "./types.js";
import { isValidDicomUid } from "./validation.js";

export type ImagingSourceFailureCategory = "dns" | "tls" | "authentication" | "unsupported" | "malformed" | "timeout" | "network";

export class ImagingSourceError extends Error {
  constructor(public readonly category: ImagingSourceFailureCategory, message: string, public readonly statusCode?: number) {
    super(message);
    this.name = "ImagingSourceError";
  }
}

type FetchResult = { response: Response; body: Uint8Array };

function joinUrl(root: string, path: string): string {
  return `${root.replace(/\/+$/, "")}/${path.replace(/^\/+/, "")}`;
}

function firstString(value: unknown): string {
  if (value == null) return "";
  if (typeof value === "string" || typeof value === "number") return String(value).trim();
  if (Array.isArray(value)) return value.map(firstString).find(Boolean) || "";
  if (typeof value === "object") {
    const record = value as UnknownRecord;
    return firstString(record.Value ?? record.value ?? record.Alphabetic);
  }
  return "";
}

function dicomJsonStudy(value: unknown): ImagingStudy {
  const dataset = value && typeof value === "object" ? value as UnknownRecord : {};
  return {
    patientId: firstString(dataset["00100020"] ?? dataset.PatientID),
    patientName: firstString(dataset["00100010"] ?? dataset.PatientName),
    accessionNumber: firstString(dataset["00080050"] ?? dataset.AccessionNumber),
    modality: firstString(dataset["00080061"] ?? dataset["00080060"] ?? dataset.ModalitiesInStudy ?? dataset.Modality),
    studyDescription: firstString(dataset["00081030"] ?? dataset.StudyDescription),
    studyDate: firstString(dataset["00080020"] ?? dataset.StudyDate),
    studyInstanceUid: firstString(dataset["0020000D"] ?? dataset.StudyInstanceUID),
  };
}

function sourceError(error: unknown): ImagingSourceError {
  if (error instanceof ImagingSourceError) return error;
  const message = error instanceof Error ? error.message : String(error || "Imaging source request failed.");
  const cause = (error as { cause?: { code?: string } })?.cause?.code || "";
  if ((error as Error)?.name === "AbortError") return new ImagingSourceError("timeout", "The imaging source request timed out.");
  if (["ENOTFOUND", "EAI_AGAIN"].includes(cause)) return new ImagingSourceError("dns", "The imaging source host could not be resolved.");
  if (/certificate|tls|ssl/i.test(message)) return new ImagingSourceError("tls", "The imaging source TLS connection failed.");
  return new ImagingSourceError("network", "The imaging source is unavailable.");
}

async function fetchBytes(url: string, options: RequestInit & { timeoutSeconds: number; verifyTls?: boolean }): Promise<FetchResult> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), Math.max(1, options.timeoutSeconds) * 1000);
  try {
    const init: RequestInit & { dispatcher?: unknown } = { ...options, signal: controller.signal };
    delete (init as Partial<typeof options>).timeoutSeconds;
    delete (init as Partial<typeof options>).verifyTls;
    if (options.verifyTls === false && url.toLowerCase().startsWith("https://")) {
      // @ts-ignore undici is present at runtime in this project.
      const undici = await import("undici");
      init.dispatcher = new undici.Agent({ connect: { rejectUnauthorized: false } });
    }
    const response = await fetch(url, init);
    return { response, body: new Uint8Array(await response.arrayBuffer()) };
  } catch (error) {
    throw sourceError(error);
  } finally {
    clearTimeout(timeout);
  }
}

function credentialHeaders(endpoint: PacsWebEndpoint): Record<string, string> {
  if (endpoint.authType === "none") return {};
  if (endpoint.authType === "basic") {
    const username = endpoint.usernameEnvKey ? process.env[endpoint.usernameEnvKey] : "";
    const password = endpoint.passwordEnvKey ? process.env[endpoint.passwordEnvKey] : "";
    if (!username || !password) throw new ImagingSourceError("authentication", "Configured DICOMweb credential environment variables are missing.");
    return { Authorization: `Basic ${Buffer.from(`${username}:${password}`).toString("base64")}` };
  }
  const token = endpoint.bearerTokenEnvKey ? process.env[endpoint.bearerTokenEnvKey] : "";
  if (!token) throw new ImagingSourceError("authentication", "Configured DICOMweb bearer-token environment variable is missing.");
  return { Authorization: `Bearer ${token}` };
}

async function parseJsonResponse(result: FetchResult, operation: string): Promise<unknown> {
  if (result.response.status === 401 || result.response.status === 403) throw new ImagingSourceError("authentication", `${operation} authentication failed.`, result.response.status);
  if ([404, 405, 501].includes(result.response.status)) throw new ImagingSourceError("unsupported", `${operation} endpoint is unsupported.`, result.response.status);
  if (!result.response.ok) throw new ImagingSourceError("network", `${operation} failed with status ${result.response.status}.`, result.response.status);
  try {
    return JSON.parse(Buffer.from(result.body).toString("utf8"));
  } catch {
    throw new ImagingSourceError("malformed", `${operation} returned malformed JSON.`, result.response.status);
  }
}

export class NativeDicomWebSourceAdapter implements ImagingSourceAdapter {
  readonly strategy = "native_dicomweb" as const;
  constructor(readonly endpoint: PacsWebEndpoint) {}

  private async json(url: string, operation: string): Promise<unknown> {
    const result = await fetchBytes(url, {
      headers: { Accept: "application/dicom+json, application/json", ...credentialHeaders(this.endpoint) },
      timeoutSeconds: this.endpoint.timeoutSeconds,
      verifyTls: this.endpoint.verifyTls,
    });
    return parseJsonResponse(result, operation);
  }

  async testConnection(): Promise<{ ok: true; message: string }> {
    await this.json(`${this.endpoint.qidoRoot}/studies?limit=1`, "QIDO study search");
    return { ok: true, message: "QIDO study search succeeded." };
  }

  async searchStudyByAccession(accessionNumber: string): Promise<ImagingStudy[]> {
    const params = new URLSearchParams({ AccessionNumber: accessionNumber, includefield: "all" });
    const payload = await this.json(`${this.endpoint.qidoRoot}/studies?${params}`, "QIDO accession search");
    if (!Array.isArray(payload)) throw new ImagingSourceError("malformed", "QIDO accession search did not return an array.");
    return payload.map(dicomJsonStudy).filter((study) => study.accessionNumber || study.studyInstanceUid);
  }

  async searchStudiesByPatient(patientId: string): Promise<ImagingStudy[]> {
    const params = new URLSearchParams({ PatientID: patientId, includefield: "all", limit: "100" });
    const payload = await this.json(`${this.endpoint.qidoRoot}/studies?${params}`, "QIDO prior-study search");
    if (!Array.isArray(payload)) throw new ImagingSourceError("malformed", "QIDO prior-study search did not return an array.");
    return payload.map(dicomJsonStudy).filter((study) => isValidDicomUid(study.studyInstanceUid));
  }

  async getStudyMetadata(studyInstanceUid: string): Promise<unknown> {
    return this.json(`${this.endpoint.wadoRsRoot}/studies/${encodeURIComponent(studyInstanceUid)}/metadata`, "WADO-RS metadata retrieval");
  }

  async testFrameRetrieval(studyInstanceUid: string, seriesInstanceUid: string, sopInstanceUid: string): Promise<{ bytes: number }> {
    const url = `${this.endpoint.wadoRsRoot}/studies/${encodeURIComponent(studyInstanceUid)}/series/${encodeURIComponent(seriesInstanceUid)}/instances/${encodeURIComponent(sopInstanceUid)}/frames/1`;
    const result = await fetchBytes(url, {
      headers: { Accept: "multipart/related; type=application/octet-stream, application/octet-stream", ...credentialHeaders(this.endpoint) },
      timeoutSeconds: this.endpoint.timeoutSeconds, verifyTls: this.endpoint.verifyTls,
    });
    if (result.response.status === 401 || result.response.status === 403) throw new ImagingSourceError("authentication", "WADO-RS frame authentication failed.", result.response.status);
    if ([404, 405, 501].includes(result.response.status)) throw new ImagingSourceError("unsupported", "WADO-RS frame retrieval is unsupported or the test instance was not found.", result.response.status);
    if (!result.response.ok || result.body.byteLength === 0) throw new ImagingSourceError("malformed", `WADO-RS frame retrieval failed with status ${result.response.status}.`, result.response.status);
    return { bytes: result.body.byteLength };
  }

  async verifyStudyAvailable(studyInstanceUid: string): Promise<boolean> {
    const params = new URLSearchParams({ StudyInstanceUID: studyInstanceUid, includefield: "0020000D", limit: "2" });
    const payload = await this.json(`${this.endpoint.qidoRoot}/studies?${params}`, "QIDO StudyInstanceUID verification");
    return Array.isArray(payload) && payload.map(dicomJsonStudy).some((study) => study.studyInstanceUid === studyInstanceUid);
  }
}

async function orthancRequest(settings: ResolvedOrthancSettings, path: string, options: { method?: string; body?: unknown; accept?: string } = {}): Promise<FetchResult> {
  const headers: Record<string, string> = { Accept: options.accept || "application/json" };
  if (settings.username) headers.Authorization = `Basic ${Buffer.from(`${settings.username}:${settings.password}`).toString("base64")}`;
  if (options.body !== undefined) headers["Content-Type"] = "application/json";
  return fetchBytes(joinUrl(settings.baseUrl, path), {
    method: options.method || "GET", headers,
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
    timeoutSeconds: settings.timeoutSeconds, verifyTls: settings.verifyTls,
  });
}

export async function deleteOrthancCachedStudyByUid(studyInstanceUid: string): Promise<number> {
  const settings = await resolveOrthancSettings();
  if (!settings.baseUrl) throw new HttpError(400, "Orthanc base URL is not configured.");
  const found = await orthancRequest(settings, "/tools/find", {
    method: "POST", body: { Level: "Study", Query: { StudyInstanceUID: studyInstanceUid } },
  });
  const payload = await parseJsonResponse(found, "Orthanc cache lookup");
  if (!Array.isArray(payload)) throw new ImagingSourceError("malformed", "Orthanc cache lookup did not return an array.");
  let deleted = 0;
  for (const value of payload) {
    const orthancId = firstString(value);
    if (!orthancId) continue;
    const response = await orthancRequest(settings, `/studies/${encodeURIComponent(orthancId)}`, { method: "DELETE" });
    if (!response.response.ok && response.response.status !== 404) throw new ImagingSourceError("network", `Orthanc cache deletion failed with status ${response.response.status}.`, response.response.status);
    deleted += response.response.status === 404 ? 0 : 1;
  }
  return deleted;
}

export class OrthancGatewaySourceAdapter implements ImagingSourceAdapter {
  readonly strategy = "orthanc_gateway" as const;
  private constructor(private readonly settings: ResolvedOrthancSettings, private readonly modalityKey: string) {}

  static async create(modalityKey: string): Promise<OrthancGatewaySourceAdapter> {
    const settings = await resolveOrthancSettings();
    if (!settings.baseUrl) throw new HttpError(400, "Orthanc base URL is not configured.");
    if (!modalityKey) throw new HttpError(400, "Orthanc modality key is not configured for the OHIF source.");
    return new OrthancGatewaySourceAdapter(settings, modalityKey);
  }

  async testConnection(): Promise<{ ok: true; message: string }> {
    const result = await orthancRequest(this.settings, "/system");
    await parseJsonResponse(result, "Orthanc REST test");
    const dicomWeb = await orthancRequest(this.settings, "/dicom-web/studies?limit=1");
    await parseJsonResponse(dicomWeb, "Orthanc DICOMweb test");
    return { ok: true, message: "Orthanc REST and DICOMweb tests succeeded." };
  }

  async searchStudyByAccession(accessionNumber: string): Promise<ImagingStudy[]> {
    const result = await searchOrthancPacsStudies({ criteria: { accessionNumber }, targetKey: this.modalityKey, currentUserId: null, audit: false });
    return result.studies;
  }

  async searchStudiesByPatient(patientId: string): Promise<ImagingStudy[]> {
    const result = await searchOrthancPacsStudies({ criteria: { patientId }, targetKey: this.modalityKey, currentUserId: null, audit: false });
    return result.studies;
  }

  async getStudyMetadata(studyInstanceUid: string): Promise<unknown> {
    const result = await orthancRequest(this.settings, `/dicom-web/studies/${encodeURIComponent(studyInstanceUid)}/metadata`, { accept: "application/dicom+json, application/json" });
    return parseJsonResponse(result, "Orthanc WADO-RS metadata retrieval");
  }

  async testFrameRetrieval(studyInstanceUid: string, seriesInstanceUid: string, sopInstanceUid: string): Promise<{ bytes: number }> {
    const result = await orthancRequest(this.settings, `/dicom-web/studies/${encodeURIComponent(studyInstanceUid)}/series/${encodeURIComponent(seriesInstanceUid)}/instances/${encodeURIComponent(sopInstanceUid)}/frames/1`, { accept: "multipart/related; type=application/octet-stream, application/octet-stream" });
    if (!result.response.ok || result.body.byteLength === 0) throw new ImagingSourceError("malformed", `Orthanc WADO-RS frame retrieval failed with status ${result.response.status}.`, result.response.status);
    return { bytes: result.body.byteLength };
  }

  async verifyStudyAvailable(studyInstanceUid: string): Promise<boolean> {
    const result = await orthancRequest(this.settings, "/tools/find", {
      method: "POST", body: { Level: "Study", Query: { StudyInstanceUID: studyInstanceUid } },
    });
    const payload = await parseJsonResponse(result, "Orthanc local study verification");
    return Array.isArray(payload) && payload.length > 0;
  }

  async requestStudyRetrieval(studyInstanceUid: string): Promise<{ orthancJobId: string | null }> {
    const result = await orthancRequest(this.settings, `/modalities/${encodeURIComponent(this.modalityKey)}/move`, {
      method: "POST",
      body: { Level: "Study", Resources: [{ StudyInstanceUID: studyInstanceUid }], Synchronous: false },
    });
    const payload = await parseJsonResponse(result, "Orthanc C-MOVE retrieval");
    const row = payload && typeof payload === "object" ? payload as UnknownRecord : {};
    return { orthancJobId: firstString(row.ID ?? row.Id ?? row.id) || null };
  }
}

export async function createImagingSourceAdapter(configuration: OhifViewerConfiguration): Promise<ImagingSourceAdapter> {
  const { settings, selectedPacsNode, webEndpoint } = configuration;
  if (!selectedPacsNode || !selectedPacsNode.is_active) throw new HttpError(400, "The selected OHIF image source is missing or inactive.");
  if (settings.accessStrategy === "native_dicomweb") {
    if (!webEndpoint?.enabled) throw new HttpError(400, "Native DICOMweb is not configured for the selected OHIF image source.");
    return new NativeDicomWebSourceAdapter(webEndpoint);
  }
  if (!settings.orthancGatewayEnabled) throw new HttpError(400, "Orthanc gateway mode is not enabled.");
  return OrthancGatewaySourceAdapter.create(settings.orthancModalityKey || "");
}

export async function proxyNativeDicomWebRequest(endpoint: PacsWebEndpoint, relativePath: string, requestHeaders: Record<string, string>): Promise<Response> {
  const upstream = joinUrl(endpoint.dicomwebBaseUrl, relativePath);
  const headers: Record<string, string> = {
    Accept: requestHeaders.accept || "application/dicom+json, multipart/related, application/octet-stream",
    ...credentialHeaders(endpoint),
  };
  if (requestHeaders.range) headers.Range = requestHeaders.range;
  return streamFetch(upstream, { headers, timeoutSeconds: endpoint.timeoutSeconds, verifyTls: endpoint.verifyTls });
}

export async function proxyOrthancDicomWebRequest(relativePath: string, requestHeaders: Record<string, string>): Promise<Response> {
  const settings = await resolveOrthancSettings();
  if (!settings.baseUrl) throw new ImagingSourceError("network", "Orthanc base URL is not configured.");
  const headers: Record<string, string> = { Accept: requestHeaders.accept || "application/dicom+json, multipart/related, application/octet-stream" };
  if (settings.username) headers.Authorization = `Basic ${Buffer.from(`${settings.username}:${settings.password}`).toString("base64")}`;
  if (requestHeaders.range) headers.Range = requestHeaders.range;
  return streamFetch(joinUrl(settings.baseUrl, `/dicom-web/${relativePath}`), {
    headers, timeoutSeconds: settings.timeoutSeconds, verifyTls: settings.verifyTls,
  });
}

async function streamFetch(url: string, options: RequestInit & { timeoutSeconds: number; verifyTls?: boolean }): Promise<Response> {
  try {
    const init: RequestInit & { dispatcher?: unknown } = { ...options, signal: AbortSignal.timeout(Math.max(1, options.timeoutSeconds) * 1000) };
    delete (init as Partial<typeof options>).timeoutSeconds;
    delete (init as Partial<typeof options>).verifyTls;
    if (options.verifyTls === false && url.toLowerCase().startsWith("https://")) {
      // @ts-ignore undici is present at runtime in this project.
      const undici = await import("undici");
      init.dispatcher = new undici.Agent({ connect: { rejectUnauthorized: false } });
    }
    return await fetch(url, init);
  } catch (error) {
    throw sourceError(error);
  }
}
