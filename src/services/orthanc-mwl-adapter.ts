import { pool } from "../db/pool.js";
import { getOrthancSyncState } from "./mwl-sync-service.js";
import { resolveOrthancSettings, type ResolvedOrthancSettings } from "./orthanc-settings-resolver.js";
import { buildCanonicalMwlDataset, renderCanonicalMwlToOrthancJson } from "./mwl-dataset-builder.js";

interface OrthancBookingProjection {
  id: number;
  patient_id: number;
  patient_primary_id: string | null;
  booking_date: string;
  booking_time: string | null;
  status: string;
  mrn: string | null;
  national_id: string | null;
  arabic_full_name: string;
  english_full_name: string | null;
  estimated_date_of_birth: string | null;
  sex: string | null;
  modality_code: string;
  modality_name_en: string;
  modality_name_ar: string;
  exam_name_en: string | null;
  exam_name_ar: string | null;
}

export interface OrthancProbeResult {
  ok: boolean;
  baseUrl: string;
  orthancVersion: string | null;
  worklistsRouteReachable: boolean;
  worklistsPostSupported: boolean;
  worklistsCreateSupported: boolean;
}

export interface OrthancUpsertResult {
  externalWorklistId: string;
  strategy: string;
}

export interface OrthancDeleteResult {
  externalWorklistId: string | null;
  strategy: string;
}

export interface OrthancBulkDeleteResult {
  deletedCount: number;
  failed: Array<{ worklistId: string; error: string }>;
}

export class OrthancSyncError extends Error {
  retryable: boolean;
  statusCode: number | null;

  constructor(message: string, retryable: boolean, statusCode: number | null = null) {
    super(message);
    this.name = "OrthancSyncError";
    this.retryable = retryable;
    this.statusCode = statusCode;
  }
}

type FetchResponse = {
  status: number;
  ok: boolean;
  text: string;
  json: unknown;
};

function joinUrl(baseUrl: string, suffix: string): string {
  const cleanBase = baseUrl.endsWith("/") ? baseUrl.slice(0, -1) : baseUrl;
  const cleanSuffix = suffix.startsWith("/") ? suffix : `/${suffix}`;
  return `${cleanBase}${cleanSuffix}`;
}

function buildStableOrthancWorklistId(bookingId: number): string {
  return `rispro-v2-booking-${bookingId}`;
}

function buildOrthancWorklistPayload(
  row: OrthancBookingProjection,
  stableId: string,
  stationAeTitle: string
): Record<string, unknown> {
  const accessionNumber = `V2-${String(row.id).padStart(6, "0")}`;
  const canonicalDataset = buildCanonicalMwlDataset(
    {
      modalityCode: row.modality_code,
      appointmentDate: row.booking_date,
      patientPrimaryId: row.patient_primary_id,
      patientMrn: row.mrn,
      patientNationalId: row.national_id,
      patientId: row.patient_id,
      patientEnglishFullName: row.english_full_name,
      patientArabicFullName: row.arabic_full_name,
      patientBirthDate: row.estimated_date_of_birth,
      patientSex: row.sex,
      examNameEn: row.exam_name_en,
      examNameAr: row.exam_name_ar,
      modalityNameEn: row.modality_name_en,
      modalityNameAr: row.modality_name_ar,
      accessionNumber,
    },
    { mwlProfile: "minimal" }
  );

  const dicomPayload = renderCanonicalMwlToOrthancJson(canonicalDataset);

  return {
    ...dicomPayload,
    // RISpro projection metadata for stable idempotency/reconciliation.
    RISproProjection: {
      bookingId: row.id,
      stableOrthancWorklistId: stableId,
      sourceStatus: row.status,
      modalityCode: row.modality_code || "",
      worklistTarget: stationAeTitle,
      updatedAt: new Date().toISOString(),
    },
  };
}

async function orthancFetch(
  path: string,
  options: {
    method?: string;
    body?: unknown;
    timeoutSeconds?: number;
    settings?: ResolvedOrthancSettings;
  } = {}
): Promise<FetchResponse> {
  const settings = options.settings ?? (await resolveOrthancSettings());
  if (!settings.baseUrl) {
    throw new OrthancSyncError("ORTHANC_BASE_URL is missing.", false, null);
  }
  const timeoutMs = Math.max(1, options.timeoutSeconds || settings.timeoutSeconds) * 1000;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const headers: Record<string, string> = { Accept: "application/json" };
    if (settings.username) {
      const basic = Buffer.from(`${settings.username}:${settings.password}`).toString("base64");
      headers.Authorization = `Basic ${basic}`;
    }

    const requestInit: RequestInit & { dispatcher?: unknown } = {
      method: options.method || "GET",
      headers,
      signal: controller.signal,
    };

    if (options.body !== undefined) {
      headers["Content-Type"] = "application/json";
      requestInit.body = JSON.stringify(options.body);
    }

    if (!settings.verifyTls && settings.baseUrl.toLowerCase().startsWith("https://")) {
      const undici = await import("undici");
      requestInit.dispatcher = new undici.Agent({
        connect: { rejectUnauthorized: false },
      });
    }

    const response = await fetch(joinUrl(settings.baseUrl, path), requestInit);
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
      throw new OrthancSyncError(`Orthanc request timed out after ${timeoutMs}ms.`, true, null);
    }
    throw new OrthancSyncError(
      `Orthanc request failed: ${(error as Error).message || "unknown_error"}`,
      true,
      null
    );
  } finally {
    clearTimeout(timeout);
  }
}

async function loadOrthancProjection(bookingId: number): Promise<OrthancBookingProjection | null> {
  const { rows } = await pool.query<OrthancBookingProjection>(
    `
      select
        b.id,
        b.patient_id,
        p.identifier_value as patient_primary_id,
        b.booking_date::text as booking_date,
        b.booking_time::text as booking_time,
        b.status,
        p.mrn,
        p.national_id,
        p.arabic_full_name,
        p.english_full_name,
        p.estimated_date_of_birth::text as estimated_date_of_birth,
        p.sex,
        m.code as modality_code,
        m.name_en as modality_name_en,
        m.name_ar as modality_name_ar,
        et.name_en as exam_name_en,
        et.name_ar as exam_name_ar
      from appointments_v2.bookings b
      join patients p on p.id = b.patient_id
      join modalities m on m.id = b.modality_id
      left join exam_types et on et.id = b.exam_type_id
      where b.id = $1::bigint
      limit 1
    `,
    [bookingId]
  );
  return rows[0] ?? null;
}

function parseExternalIdFromOrthancResponse(payload: unknown): string | null {
  if (!payload || typeof payload !== "object") return null;
  const row = payload as Record<string, unknown>;
  const candidates = [row.ID, row.Id, row.id, row.uuid, row.UUID, row.Path];
  for (const candidate of candidates) {
    const str = String(candidate || "").trim();
    if (str) return str.replaceAll("/", "");
  }
  return null;
}

function extractStringCandidates(payload: unknown, values: string[]): void {
  if (payload == null) return;
  if (typeof payload === "string") {
    const trimmed = payload.trim();
    if (trimmed) values.push(trimmed);
    return;
  }
  if (Array.isArray(payload)) {
    for (const item of payload) {
      extractStringCandidates(item, values);
    }
    return;
  }
  if (typeof payload !== "object") return;

  for (const [key, value] of Object.entries(payload as Record<string, unknown>)) {
    if (
      key === "AccessionNumber" ||
      key === "RequestedProcedureID" ||
      key === "PatientID" ||
      key === "ID" ||
      key === "Id" ||
      key === "id" ||
      key === "Path" ||
      key === "stableOrthancWorklistId"
    ) {
      extractStringCandidates(value, values);
      continue;
    }

    if (key === "Value" && Array.isArray(value)) {
      extractStringCandidates(value, values);
      continue;
    }

    if (typeof value === "object" && value !== null) {
      extractStringCandidates(value, values);
    }
  }
}

function parseBookingIdFromOrthancPayload(payload: unknown): number | null {
  const values: string[] = [];
  extractStringCandidates(payload, values);

  for (const value of values) {
    const stableIdMatch = value.match(/rispro-v2-booking-(\d+)/i);
    if (stableIdMatch) {
      return Number(stableIdMatch[1]);
    }

    const accessionMatch = value.match(/\bV2-(\d+)\b/i);
    if (accessionMatch) {
      return Number(accessionMatch[1]);
    }
  }

  return null;
}

async function deleteOrthancWorklistById(
  worklistId: string,
  settings: ResolvedOrthancSettings
): Promise<void> {
  const response = await orthancFetch(`/worklists/${encodeURIComponent(worklistId)}`, {
    method: "DELETE",
    settings,
  });
  if (response.ok || response.status === 204 || response.status === 404) {
    return;
  }

  const retryable = response.status >= 500 || response.status === 429;
  throw new OrthancSyncError(
    `Orthanc delete failed for ${worklistId} (status=${response.status}).`,
    retryable,
    response.status
  );
}

async function cleanupObsoleteOrthancEntries(
  bookingId: number,
  preservedWorklistId: string,
  settings: ResolvedOrthancSettings
): Promise<void> {
  const stableId = buildStableOrthancWorklistId(bookingId);
  const state = await getOrthancSyncState(bookingId);
  const obsoleteIds = Array.from(
    new Set([state?.externalWorklistId, stableId].filter(Boolean) as string[])
  ).filter((candidateId) => candidateId !== preservedWorklistId);

  for (const candidateId of obsoleteIds) {
    await deleteOrthancWorklistById(candidateId, settings);
  }
}

export async function probeOrthancWorklistApi(): Promise<OrthancProbeResult> {
  const settings = await resolveOrthancSettings();
  const system = await orthancFetch("/system", { settings });
  const orthancVersion = system.ok && system.json && typeof system.json === "object"
    ? String((system.json as Record<string, unknown>).Version || "")
    : null;

  const worklists = await orthancFetch("/worklists", { settings });
  const worklistsRouteReachable = [200, 401, 403].includes(worklists.status);

  // Check write capabilities
  const worklistsPost = await orthancFetch("/worklists", {
    method: "POST",
    body: {},
    settings,
  });
  const worklistsPostSupported = worklistsPost.status !== 405;

  const worklistsCreate = await orthancFetch("/worklists/create", {
    method: "POST",
    body: {},
    settings,
  });
  const worklistsCreateSupported = worklistsCreate.status !== 405;

  return {
    ok: system.ok || worklistsRouteReachable,
    baseUrl: settings.baseUrl,
    orthancVersion: orthancVersion || null,
    worklistsRouteReachable,
    worklistsPostSupported,
    worklistsCreateSupported,
  };
}

export async function upsertBookingToOrthanc(bookingId: number): Promise<OrthancUpsertResult> {
  if (!Number.isInteger(bookingId) || bookingId <= 0) {
    throw new OrthancSyncError(`Invalid booking ID: ${bookingId}`, false, null);
  }

  const settings = await resolveOrthancSettings();
  const projection = await loadOrthancProjection(bookingId);
  if (!projection) {
    throw new OrthancSyncError(`Booking ${bookingId} not found for Orthanc upsert.`, false, null);
  }

  const stableId = buildStableOrthancWorklistId(bookingId);
  const fullPayload = buildOrthancWorklistPayload(projection, stableId, settings.worklistTarget || "RISPRO_MWL");

  // For new worklists plugin, strip custom fields that aren't valid DICOM tags
  const { RISproProjection, ...dicomOnlyPayload } = fullPayload;

  // Try primary method based on strategy preference
  const primaryMethod = settings.strategyPreference === "post_first" ? "POST" : "PUT";
  const primaryPath = primaryMethod === "POST" ? "/worklists" : `/worklists/${encodeURIComponent(stableId)}`;
  const primaryPayload = primaryMethod === "PUT" ? fullPayload : fullPayload; // Both use full payload with metadata

  const primaryResult = await orthancFetch(primaryPath, {
    method: primaryMethod,
    body: primaryPayload,
    settings,
  });

  if (primaryResult.ok || primaryResult.status === 201 || primaryResult.status === 204) {
    if (primaryMethod === "PUT") {
      return { externalWorklistId: stableId, strategy: "put_by_stable_id" };
    } else {
      const parsed = parseExternalIdFromOrthancResponse(primaryResult.json);
      const externalWorklistId = parsed || stableId;
      await cleanupObsoleteOrthancEntries(bookingId, externalWorklistId, settings);
      return { externalWorklistId, strategy: "post_collection" };
    }
  }

  // Try fallback method for client-like errors
  if ([400, 404, 405, 501].includes(primaryResult.status)) {
    const fallbackMethod = primaryMethod === "POST" ? "PUT" : "POST";
    const fallbackPath = fallbackMethod === "POST" ? "/worklists" : `/worklists/${encodeURIComponent(stableId)}`;
    const fallbackPayload = fallbackMethod === "PUT" ? fullPayload : fullPayload; // Both use full payload with metadata

    const fallbackResult = await orthancFetch(fallbackPath, {
      method: fallbackMethod,
      body: fallbackPayload,
      settings,
    });
    if (fallbackResult.ok || fallbackResult.status === 201 || fallbackResult.status === 204) {
      if (fallbackMethod === "PUT") {
        return { externalWorklistId: stableId, strategy: "put_by_stable_id" };
      } else {
        const parsed = parseExternalIdFromOrthancResponse(fallbackResult.json);
        const externalWorklistId = parsed || stableId;
        await cleanupObsoleteOrthancEntries(bookingId, externalWorklistId, settings);
        return { externalWorklistId, strategy: "post_collection" };
      }
    }

    // If fallback also fails with method not allowed, try alternative POST endpoint for new worklists plugin
    if (fallbackMethod === "POST" && fallbackResult.status === 405) {
      const createPayload = { Tags: dicomOnlyPayload }; // New plugin expects { Tags: { ...dicom... } } without custom fields
      const altResult = await orthancFetch("/worklists/create", {
        method: "POST",
        body: createPayload,
        settings,
      });
      if (altResult.ok || altResult.status === 201 || altResult.status === 204) {
        const parsed = parseExternalIdFromOrthancResponse(altResult.json);
        const externalWorklistId = parsed || stableId;
        await cleanupObsoleteOrthancEntries(bookingId, externalWorklistId, settings);
        return { externalWorklistId, strategy: "post_create" };
      }
      const retryable = altResult.status >= 500 || altResult.status === 429;
      throw new OrthancSyncError(
        `Orthanc upsert failed via POST /worklists/create (status=${altResult.status}): ${altResult.text}`,
        retryable,
        altResult.status
      );
    }

    // If fallback also fails with method not allowed, this is likely a server configuration issue
    const retryable = fallbackResult.status >= 500 || fallbackResult.status === 429;
    throw new OrthancSyncError(
      `Orthanc upsert failed via ${fallbackMethod} ${fallbackPath} (status=${fallbackResult.status}): ${fallbackResult.text}`,
      retryable,
      fallbackResult.status
    );
  }

  const retryable = primaryResult.status >= 500 || primaryResult.status === 429;
  throw new OrthancSyncError(
    `Orthanc upsert failed via ${primaryMethod} ${primaryPath} (status=${primaryResult.status}): ${primaryResult.text}`,
    retryable,
    primaryResult.status
  );
}

export async function deleteBookingFromOrthanc(bookingId: number): Promise<OrthancDeleteResult> {
  const settings = await resolveOrthancSettings();
  const stableId = buildStableOrthancWorklistId(bookingId);
  const state = await getOrthancSyncState(bookingId);
  const candidateIds = Array.from(new Set([state?.externalWorklistId, stableId].filter(Boolean) as string[]));

  let lastFailure: OrthancSyncError | null = null;
  for (const candidateId of candidateIds) {
    try {
      await deleteOrthancWorklistById(candidateId, settings);
      return { externalWorklistId: candidateId, strategy: "delete_by_id" };
    } catch (error) {
      lastFailure = error instanceof OrthancSyncError
        ? error
        : new OrthancSyncError("Orthanc delete failed.", true, null);
      if (lastFailure.retryable) {
        throw lastFailure;
      }
    }
  }

  if (candidateIds.length === 0) {
    return { externalWorklistId: null, strategy: "nothing_to_delete" };
  }

  throw lastFailure || new OrthancSyncError("Orthanc delete failed.", true, null);
}

export async function deleteOrthancEntriesForBookingIds(bookingIds: number[]): Promise<OrthancBulkDeleteResult> {
  const targetIds = new Set(
    bookingIds.map((bookingId) => Number(bookingId)).filter((bookingId) => Number.isInteger(bookingId) && bookingId > 0)
  );
  if (targetIds.size === 0) {
    return { deletedCount: 0, failed: [] };
  }

  const settings = await resolveOrthancSettings();
  const worklists = await orthancFetch("/worklists", { settings });
  if (!worklists.ok || !Array.isArray(worklists.json)) {
    throw new OrthancSyncError(
      `Orthanc worklist enumeration failed (status=${worklists.status}).`,
      worklists.status >= 500 || worklists.status === 429,
      worklists.status
    );
  }

  const failed: Array<{ worklistId: string; error: string }> = [];
  let deletedCount = 0;

  for (const entry of worklists.json) {
    const worklistId = parseExternalIdFromOrthancResponse(entry) || String(entry || "").trim();
    if (!worklistId) continue;

    const detail = await orthancFetch(`/worklists/${encodeURIComponent(worklistId)}`, { settings });
    if (!detail.ok) {
      failed.push({
        worklistId,
        error: `Failed to inspect worklist (status=${detail.status}).`,
      });
      continue;
    }

    const bookingId = parseBookingIdFromOrthancPayload(detail.json);
    if (!bookingId || !targetIds.has(bookingId)) {
      continue;
    }

    try {
      await deleteOrthancWorklistById(worklistId, settings);
      deletedCount += 1;
    } catch (error) {
      failed.push({
        worklistId,
        error: error instanceof Error ? error.message : "delete_failed",
      });
    }
  }

  return { deletedCount, failed };
}
