import { resolveOrthancSettings, type ResolvedOrthancSettings } from "./orthanc-settings-resolver.js";

export type OrthancVerificationTargetType = "local" | "remote_modality";
export type OrthancCompletionThreshold = "study_exists" | "series_exists" | "instance_exists";
export type OrthancMatchingStrategy = "study_uid_preferred_accession_fallback";
export type OrthancVerificationStatus = "matched" | "not_found" | "ambiguous" | "error" | "insufficient_evidence";
export type OrthancMatchKey = "study_instance_uid" | "accession_number";

export interface OrthancAutoCompletionSettingLike {
  id?: number | null;
  modality_id?: number | string | null;
  enabled?: boolean;
  orthanc_target_type: OrthancVerificationTargetType;
  orthanc_target_key?: string | null;
  matching_strategy: OrthancMatchingStrategy;
  completion_threshold: OrthancCompletionThreshold;
}

export interface OrthancBookingVerificationContext {
  id: number | string;
  modality_id: number | string;
  accession_number?: string | null;
  study_instance_uid?: string | null;
  appointment_date?: string | null;
  booking_date?: string | null;
  modality_code?: string | null;
  national_id?: string | null;
  mrn?: string | null;
  patient_primary_id?: string | null;
  patient_identifier_value?: string | null;
}

export interface OrthancVerificationResult {
  status: OrthancVerificationStatus;
  matchKey: OrthancMatchKey | null;
  matchValue: string | null;
  studyInstanceUid: string | null;
  accessionNumber: string | null;
  seriesCount: number | null;
  instanceCount: number | null;
  resultJson: Record<string, unknown>;
  lastError: string | null;
}

export interface OrthancVerificationTarget {
  type: OrthancVerificationTargetType;
  key: string;
  label: string;
}

type OrthancFetchResponse = {
  status: number;
  ok: boolean;
  text: string;
  json: unknown;
};

type OrthancFetch = (
  path: string,
  options?: {
    method?: string;
    body?: unknown;
    settings?: ResolvedOrthancSettings;
  }
) => Promise<OrthancFetchResponse>;

interface StudyCandidate {
  orthancStudyId: string | null;
  studyInstanceUid: string | null;
  accessionNumber: string | null;
  patientIds: string[];
  modality: string | null;
  studyDate: string | null;
  seriesCount: number | null;
  instanceCount: number | null;
  reliableSeriesCount: boolean;
  reliableInstanceCount: boolean;
  raw: unknown;
}

let fetchOrthancForVerification: OrthancFetch = orthancFetch;
let orthancSettingsForTests: ResolvedOrthancSettings | null = null;

export function __setOrthancFetchForTests(mockFetch: OrthancFetch): void {
  fetchOrthancForVerification = mockFetch;
}

export function __resetOrthancFetchForTests(): void {
  fetchOrthancForVerification = orthancFetch;
}

export function __setOrthancSettingsForTests(settings: ResolvedOrthancSettings): void {
  orthancSettingsForTests = settings;
}

export function __resetOrthancSettingsForTests(): void {
  orthancSettingsForTests = null;
}

function joinUrl(baseUrl: string, suffix: string): string {
  const cleanBase = baseUrl.endsWith("/") ? baseUrl.slice(0, -1) : baseUrl;
  const cleanSuffix = suffix.startsWith("/") ? suffix : `/${suffix}`;
  return `${cleanBase}${cleanSuffix}`;
}

async function orthancFetch(
  path: string,
  options: {
    method?: string;
    body?: unknown;
    settings?: ResolvedOrthancSettings;
  } = {}
): Promise<OrthancFetchResponse> {
  const settings = options.settings ?? (await resolveOrthancSettings());
  if (!settings.baseUrl) {
    throw new Error("Orthanc base URL is missing.");
  }

  const controller = new AbortController();
  const timeoutMs = Math.max(1, settings.timeoutSeconds) * 1000;
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

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
      headers["Content-Type"] = "application/json";
      init.body = JSON.stringify(options.body);
    }

    if (!settings.verifyTls && settings.baseUrl.toLowerCase().startsWith("https://")) {
      // @ts-ignore undici is provided by runtime dependencies, but this repo does not ship its type declarations.
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
      throw new Error(`Orthanc request timed out after ${timeoutMs}ms.`);
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

function getRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function firstString(...values: unknown[]): string | null {
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
      const record = value as Record<string, unknown>;
      const nested = firstString(record.Value, record.value, record.Alphabetic);
      if (nested) return nested;
    }
  }
  return null;
}

function parseCount(value: unknown): number | null {
  const str = firstString(value);
  if (!str) return null;
  const parsed = Number(str);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}

function normalizeDicomDate(value: unknown): string | null {
  const clean = firstString(value)?.replace(/[^0-9]/g, "") || "";
  if (/^\d{8}$/.test(clean)) return clean;
  if (/^\d{4}-\d{2}-\d{2}$/.test(firstString(value) || "")) return (firstString(value) || "").replaceAll("-", "");
  return null;
}

function normalizeBookingDate(booking: OrthancBookingVerificationContext): string | null {
  return normalizeDicomDate(booking.appointment_date || booking.booking_date);
}

function normalizeAccession(booking: OrthancBookingVerificationContext): string {
  const explicit = firstString(booking.accession_number);
  if (explicit) return explicit;
  return `V2-${String(booking.id)}`;
}

function normalizeToken(value: unknown): string {
  return String(value || "").trim().toUpperCase();
}

function collectPatientIds(booking: OrthancBookingVerificationContext): string[] {
  return Array.from(new Set([
    firstString(booking.patient_primary_id),
    firstString(booking.patient_identifier_value),
    firstString(booking.mrn),
    firstString(booking.national_id),
  ].filter((value): value is string => Boolean(value))));
}

function makeResult(
  status: OrthancVerificationStatus,
  patch: Partial<OrthancVerificationResult> = {}
): OrthancVerificationResult {
  return {
    status,
    matchKey: patch.matchKey ?? null,
    matchValue: patch.matchValue ?? null,
    studyInstanceUid: patch.studyInstanceUid ?? null,
    accessionNumber: patch.accessionNumber ?? null,
    seriesCount: patch.seriesCount ?? null,
    instanceCount: patch.instanceCount ?? null,
    resultJson: patch.resultJson ?? {},
    lastError: patch.lastError ?? null,
  };
}

function extractTags(payload: unknown): Record<string, unknown> {
  const record = getRecord(payload);
  const mainTags = getRecord(record.MainDicomTags);
  const patientTags = getRecord(record.PatientMainDicomTags);
  const normalized = getRecord(record.NormalizedTags);
  const tags = getRecord(record.Tags);
  return {
    ...record,
    ...tags,
    ...normalized,
    ...mainTags,
    ...patientTags,
  };
}

function candidateFromPayload(payload: unknown, options: { remote: boolean; orthancStudyId?: string | null } = { remote: false }): StudyCandidate {
  const record = getRecord(payload);
  const tags = extractTags(payload);
  const seriesCount = parseCount(record.SeriesCount ?? record.CountSeries ?? tags.NumberOfStudyRelatedSeries ?? tags["00201206"]);
  const instanceCount = parseCount(record.InstanceCount ?? record.CountInstances ?? tags.NumberOfStudyRelatedInstances ?? tags["00201208"]);

  return {
    orthancStudyId: firstString(options.orthancStudyId, record.ID, record.Id, record.id) || null,
    studyInstanceUid: firstString(tags.StudyInstanceUID, tags.StudyInstanceUid, tags["0020000D"]) || null,
    accessionNumber: firstString(tags.AccessionNumber, tags["00080050"]) || null,
    patientIds: Array.from(new Set([
      firstString(tags.PatientID, tags["00100020"]),
      firstString(tags.OtherPatientIDs, tags["00101000"]),
    ].filter((value): value is string => Boolean(value)))),
    modality: firstString(tags.Modality, tags.ModalitiesInStudy, tags["00080060"], tags["00080061"]),
    studyDate: normalizeDicomDate(tags.StudyDate ?? tags["00080020"]),
    seriesCount,
    instanceCount,
    reliableSeriesCount: !options.remote && seriesCount != null,
    reliableInstanceCount: !options.remote && instanceCount != null,
    raw: payload,
  };
}

function hasConflict(booking: OrthancBookingVerificationContext, candidate: StudyCandidate): string | null {
  const bookingPatientIds = collectPatientIds(booking);
  if (bookingPatientIds.length > 0 && candidate.patientIds.length > 0) {
    const expected = new Set(bookingPatientIds.map((value) => value.toUpperCase()));
    const hasOverlap = candidate.patientIds.some((value) => expected.has(value.toUpperCase()));
    if (!hasOverlap) return "patient_conflict";
  }

  const expectedModality = normalizeToken(booking.modality_code);
  const candidateModality = normalizeToken(candidate.modality);
  if (expectedModality && candidateModality && !candidateModality.split("\\").includes(expectedModality)) {
    return "modality_conflict";
  }

  const expectedDate = normalizeBookingDate(booking);
  if (expectedDate && candidate.studyDate && expectedDate !== candidate.studyDate) {
    return "study_date_conflict";
  }

  return null;
}

function thresholdSatisfied(candidate: StudyCandidate, threshold: OrthancCompletionThreshold): { ok: boolean; reason?: string } {
  if (threshold === "study_exists") return { ok: true };
  if (threshold === "series_exists") {
    if (!candidate.reliableSeriesCount) return { ok: false, reason: "series_count_unavailable" };
    return candidate.seriesCount != null && candidate.seriesCount > 0
      ? { ok: true }
      : { ok: false, reason: "series_count_zero" };
  }

  if (!candidate.reliableInstanceCount) return { ok: false, reason: "instance_count_unavailable" };
  return candidate.instanceCount != null && candidate.instanceCount > 0
    ? { ok: true }
    : { ok: false, reason: "instance_count_zero" };
}

function evaluateCandidates({
  booking,
  candidates,
  matchKey,
  matchValue,
  threshold,
}: {
  booking: OrthancBookingVerificationContext;
  candidates: StudyCandidate[];
  matchKey: OrthancMatchKey;
  matchValue: string;
  threshold: OrthancCompletionThreshold;
}): OrthancVerificationResult {
  if (candidates.length === 0) {
    return makeResult("not_found", {
      matchKey,
      matchValue,
      resultJson: { candidateCount: 0 },
    });
  }

  if (candidates.length > 1) {
    return makeResult("ambiguous", {
      matchKey,
      matchValue,
      resultJson: { candidateCount: candidates.length, candidates: candidates.map((candidate) => candidate.raw) },
    });
  }

  const candidate = candidates[0]!;
  const conflict = hasConflict(booking, candidate);
  if (conflict) {
    return makeResult("insufficient_evidence", {
      matchKey,
      matchValue,
      studyInstanceUid: candidate.studyInstanceUid,
      accessionNumber: candidate.accessionNumber,
      seriesCount: candidate.seriesCount,
      instanceCount: candidate.instanceCount,
      resultJson: { conflict, candidate: candidate.raw },
      lastError: conflict,
    });
  }

  const thresholdResult = thresholdSatisfied(candidate, threshold);
  if (!thresholdResult.ok) {
    return makeResult("insufficient_evidence", {
      matchKey,
      matchValue,
      studyInstanceUid: candidate.studyInstanceUid,
      accessionNumber: candidate.accessionNumber,
      seriesCount: candidate.seriesCount,
      instanceCount: candidate.instanceCount,
      resultJson: { reason: thresholdResult.reason, candidate: candidate.raw },
      lastError: thresholdResult.reason || null,
    });
  }

  return makeResult("matched", {
    matchKey,
    matchValue,
    studyInstanceUid: candidate.studyInstanceUid,
    accessionNumber: candidate.accessionNumber,
    seriesCount: candidate.seriesCount,
    instanceCount: candidate.instanceCount,
    resultJson: { candidate: candidate.raw },
  });
}

function buildFindQuery(matchKey: OrthancMatchKey, matchValue: string): Record<string, unknown> {
  return {
    Level: "Study",
    Query: matchKey === "study_instance_uid"
      ? { StudyInstanceUID: matchValue }
      : { AccessionNumber: matchValue },
  };
}

async function readLocalCandidate(studyId: string, settings: ResolvedOrthancSettings): Promise<StudyCandidate> {
  const [detail, statistics] = await Promise.all([
    fetchOrthancForVerification(`/studies/${encodeURIComponent(studyId)}`, { settings }),
    fetchOrthancForVerification(`/studies/${encodeURIComponent(studyId)}/statistics`, { settings }).catch(() => null),
  ]);
  const merged = {
    ...getRecord(detail.json),
    ...getRecord(statistics?.json),
  };
  return candidateFromPayload(merged, { remote: false, orthancStudyId: studyId });
}

async function queryLocal(matchKey: OrthancMatchKey, matchValue: string, settings: ResolvedOrthancSettings): Promise<StudyCandidate[]> {
  const response = await fetchOrthancForVerification("/tools/find", {
    method: "POST",
    body: buildFindQuery(matchKey, matchValue),
    settings,
  });
  if (!response.ok || !Array.isArray(response.json)) {
    throw new Error(`Orthanc local search failed (status=${response.status}).`);
  }
  const studyIds = response.json.map((value) => firstString(value)).filter((value): value is string => Boolean(value));
  return Promise.all(studyIds.map((studyId) => readLocalCandidate(studyId, settings)));
}

async function readRemoteAnswer(queryId: string, answerId: string, settings: ResolvedOrthancSettings): Promise<StudyCandidate> {
  const response = await fetchOrthancForVerification(
    `/queries/${encodeURIComponent(queryId)}/answers/${encodeURIComponent(answerId)}/content`,
    { settings }
  );
  if (!response.ok) {
    throw new Error(`Orthanc remote answer read failed (status=${response.status}).`);
  }
  return candidateFromPayload(response.json, { remote: true });
}

async function queryRemote(
  targetKey: string,
  matchKey: OrthancMatchKey,
  matchValue: string,
  settings: ResolvedOrthancSettings
): Promise<StudyCandidate[]> {
  const query = await fetchOrthancForVerification(`/modalities/${encodeURIComponent(targetKey)}/query`, {
    method: "POST",
    body: buildFindQuery(matchKey, matchValue),
    settings,
  });
  if (!query.ok) {
    throw new Error(`Orthanc remote query failed (status=${query.status}).`);
  }
  const queryId = firstString(getRecord(query.json).ID, getRecord(query.json).Id, getRecord(query.json).id);
  if (!queryId) {
    throw new Error("Orthanc remote query did not return a query ID.");
  }

  const answers = await fetchOrthancForVerification(`/queries/${encodeURIComponent(queryId)}/answers`, { settings });
  if (!answers.ok || !Array.isArray(answers.json)) {
    throw new Error(`Orthanc remote answers read failed (status=${answers.status}).`);
  }

  const answerIds = answers.json.map((value) => firstString(value)).filter((value): value is string => Boolean(value));
  return Promise.all(answerIds.map((answerId) => readRemoteAnswer(queryId, answerId, settings)));
}

async function runQuery(
  booking: OrthancBookingVerificationContext,
  setting: OrthancAutoCompletionSettingLike,
  matchKey: OrthancMatchKey,
  matchValue: string,
  settings: ResolvedOrthancSettings
): Promise<OrthancVerificationResult> {
  const candidates = setting.orthanc_target_type === "remote_modality"
    ? await queryRemote(String(setting.orthanc_target_key || "").trim(), matchKey, matchValue, settings)
    : await queryLocal(matchKey, matchValue, settings);

  return evaluateCandidates({
    booking,
    candidates,
    matchKey,
    matchValue,
    threshold: setting.completion_threshold,
  });
}

export async function verifyBookingStudyWithOrthanc(
  booking: OrthancBookingVerificationContext,
  setting: OrthancAutoCompletionSettingLike
): Promise<OrthancVerificationResult> {
  try {
    const orthancSettings = orthancSettingsForTests ?? await resolveOrthancSettings();
    const studyInstanceUid = firstString(booking.study_instance_uid);
    const accessionNumber = normalizeAccession(booking);

    if (studyInstanceUid) {
      const byUid = await runQuery(booking, setting, "study_instance_uid", studyInstanceUid, orthancSettings);
      if (byUid.status !== "not_found") {
        return byUid;
      }
    }

    return await runQuery(booking, setting, "accession_number", accessionNumber, orthancSettings);
  } catch (error) {
    return makeResult("error", {
      resultJson: { error: error instanceof Error ? error.message : String(error) },
      lastError: error instanceof Error ? error.message : String(error),
    });
  }
}

export async function listOrthancVerificationTargets(): Promise<OrthancVerificationTarget[]> {
  const settings = orthancSettingsForTests ?? await resolveOrthancSettings();
  const targets: OrthancVerificationTarget[] = [
    { type: "local", key: "local", label: "Local Orthanc index" },
  ];

  try {
    const response = await fetchOrthancForVerification("/modalities", { settings });
    const payload = response.json;
    const keys = Array.isArray(payload)
      ? payload.map((value) => firstString(value)).filter((value): value is string => Boolean(value))
      : Object.keys(getRecord(payload));

    for (const key of keys.sort((a, b) => a.localeCompare(b))) {
      targets.push({ type: "remote_modality", key, label: key });
    }
  } catch {
    return targets;
  }

  return targets;
}
