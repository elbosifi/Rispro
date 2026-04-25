import { HttpError } from "../utils/http-error.js";
import { logAuditEntry } from "./audit-service.js";
import { readSonicDicomReportSettings, type SonicDicomReportSettings } from "./sonicdicom-report-settings.js";

export type SonicDicomReportState =
  | "final"
  | "draft"
  | "no_report"
  | "unavailable"
  | "not_required"
  | "not_completed"
  | "disabled";

export interface ReportLookupContext {
  bookingId: number;
  accessionNumber: string;
  studyInstanceUid: string | null;
  requiresReport: boolean;
  status: string;
}

export interface ReportStatusResult {
  state: SonicDicomReportState;
  canViewReport: boolean;
  source: "sonicdicom" | "rispro";
}

export interface SonicDicomLookupDebugStep {
  lookupTarget: "accession_number" | "study_instance_uid";
  requestUrlPreview: string;
  contentType: string;
  state: SonicDicomReportState;
}

export interface SonicDicomLookupDebugResult extends ReportStatusResult {
  baseUrlSource: "internal" | "public_fallback" | "none";
  lookupTried: Array<"accession_number" | "study_instance_uid">;
  steps: SonicDicomLookupDebugStep[];
}

interface CacheEntry {
  expiresAt: number;
  result: ReportStatusResult;
}

const statusCache = new Map<number, CacheEntry>();

function containsAnyTerm(content: string, terms: string[]): boolean {
  const haystack = content.toLowerCase();
  return terms.some((term) => term.trim() && haystack.includes(term.trim().toLowerCase()));
}

function flattenJson(value: unknown): string {
  if (value == null) return "";
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") return String(value);
  if (Array.isArray(value)) return value.map(flattenJson).join(" ");
  if (typeof value === "object") return Object.values(value as Record<string, unknown>).map(flattenJson).join(" ");
  return "";
}

function normalizeFetchedStatus(content: string, settings: SonicDicomReportSettings): SonicDicomReportState {
  const finalDetected = containsAnyTerm(content, settings.sonicDicomFinalStatusTerms);
  const draftDetected = containsAnyTerm(content, settings.sonicDicomDraftStatusTerms);
  const noReportDetected = containsAnyTerm(content, settings.sonicDicomNoReportStatusTerms);
  const unavailableDetected = containsAnyTerm(content, settings.sonicDicomUnavailableStatusTerms);

  if (unavailableDetected) return "unavailable";
  if (finalDetected && draftDetected) return "unavailable";
  if (finalDetected) return "final";
  if (draftDetected) return "draft";
  if (noReportDetected) return "no_report";
  return "unavailable";
}

function encodeTemplateValue(value: string): string {
  return encodeURIComponent(value);
}

function renderTemplate(template: string, settings: SonicDicomReportSettings, context: ReportLookupContext, baseUrl: string, baseToken: "publicBaseUrl" | "internalBaseUrl"): string {
  const values: Record<string, string> = {
    publicBaseUrl: settings.sonicDicomPublicBaseUrl.replace(/\/+$/, ""),
    internalBaseUrl: settings.sonicDicomInternalBaseUrl.replace(/\/+$/, ""),
    [baseToken]: baseUrl.replace(/\/+$/, ""),
    username: settings.sonicDicomReportViewerUsername,
    password: settings.sonicDicomReportViewerPassword,
    accessionNumber: context.accessionNumber,
    studyInstanceUid: context.studyInstanceUid ?? "",
  };

  return template.replace(/\{\{(\w+)\}\}/g, (_match, key: string) => {
    const value = values[key] ?? "";
    return key === "publicBaseUrl" || key === "internalBaseUrl" ? value : encodeTemplateValue(value);
  });
}

function resolveLookupTargets(settings: SonicDicomReportSettings, context: ReportLookupContext): Array<"accession_number" | "study_instance_uid"> {
  switch (settings.sonicDicomReportLookupKey) {
    case "study_instance_uid":
      return context.studyInstanceUid ? ["study_instance_uid"] : [];
    case "prefer_study_uid_then_accession":
      return context.studyInstanceUid ? ["study_instance_uid", "accession_number"] : ["accession_number"];
    case "prefer_accession_then_study_uid":
      return context.studyInstanceUid ? ["accession_number", "study_instance_uid"] : ["accession_number"];
    case "accession_number":
    default:
      return ["accession_number"];
  }
}

function chooseInternalTemplate(settings: SonicDicomReportSettings, lookupTarget: "accession_number" | "study_instance_uid"): string {
  if (settings.sonicDicomInternalSearchUrlTemplate.trim()) return settings.sonicDicomInternalSearchUrlTemplate;
  const template = settings.sonicDicomInternalReportViewerUrlTemplate || settings.sonicDicomInternalPdfUrlTemplate;
  if (lookupTarget === "study_instance_uid") {
    return template.replace(/accessionnumber=\{\{accessionNumber\}\}/i, "studyinstanceuid={{studyInstanceUid}}");
  }
  return template;
}

function getStatusCheckBaseUrl(settings: SonicDicomReportSettings): string {
  if (settings.sonicDicomInternalBaseUrl.trim()) return settings.sonicDicomInternalBaseUrl.trim();
  if (settings.allowPublicFallbackForStatusCheck) return settings.sonicDicomPublicBaseUrl.trim();
  return "";
}

function getStatusCheckBaseUrlSource(settings: SonicDicomReportSettings): "internal" | "public_fallback" | "none" {
  if (settings.sonicDicomInternalBaseUrl.trim()) return "internal";
  if (settings.allowPublicFallbackForStatusCheck) return "public_fallback";
  return "none";
}

function sanitizeUrlForDebug(url: string): string {
  try {
    const parsed = new URL(url);
    for (const key of ["password", "pass", "pwd"]) {
      if (parsed.searchParams.has(key)) parsed.searchParams.set(key, "***");
    }
    return parsed.toString();
  } catch {
    return url
      .replace(/([?&](?:password|pass|pwd)=)[^&]*/gi, "$1***")
      .replace(/(\{\{password\}\})/gi, "***");
  }
}

async function fetchStatusContent(url: string, timeoutMs: number): Promise<{ content: string; contentType: string }> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      method: "GET",
      redirect: "follow",
      signal: controller.signal,
    });
    const contentType = response.headers.get("content-type") || "";
    const text = await response.text();
    if (!response.ok) {
      return { content: `Unavailable HTTP ${response.status} ${text.slice(0, 200)}`, contentType };
    }
    if (contentType.includes("application/json")) {
      try {
        return { content: flattenJson(JSON.parse(text)), contentType };
      } catch {
        return { content: text, contentType };
      }
    }
    return { content: text, contentType };
  } catch {
    return { content: "Unavailable Timeout", contentType: "text/plain" };
  } finally {
    clearTimeout(timeout);
  }
}

export function messageForReportState(state: SonicDicomReportState, settings: Pick<SonicDicomReportSettings, never> & {
  qrReportFinalMessage?: string;
  qrReportDraftMessage?: string;
  qrReportNoReportMessage?: string;
  qrReportUnavailableMessage?: string;
  qrReportNotRequiredMessage?: string;
  qrReportNotCompletedMessage?: string;
}): string {
  if (state === "final") return settings.qrReportFinalMessage || "";
  if (state === "draft") return settings.qrReportDraftMessage || "";
  if (state === "no_report") return settings.qrReportNoReportMessage || "";
  if (state === "not_required") return settings.qrReportNotRequiredMessage || "";
  if (state === "not_completed") return settings.qrReportNotCompletedMessage || "";
  return settings.qrReportUnavailableMessage || "";
}

async function resolveSonicDicomReportStatus(
  settings: SonicDicomReportSettings,
  context: ReportLookupContext
): Promise<SonicDicomLookupDebugResult> {
  const baseUrl = getStatusCheckBaseUrl(settings);
  const baseUrlSource = getStatusCheckBaseUrlSource(settings);
  if (!baseUrl) {
    return {
      state: "unavailable",
      canViewReport: false,
      source: "sonicdicom",
      baseUrlSource,
      lookupTried: [],
      steps: [],
    };
  }

  const targets = resolveLookupTargets(settings, context);
  if (targets.length === 0) {
    return {
      state: "unavailable",
      canViewReport: false,
      source: "sonicdicom",
      baseUrlSource,
      lookupTried: [],
      steps: [],
    };
  }

  let result: ReportStatusResult = { state: "no_report", canViewReport: false, source: "sonicdicom" };
  const steps: SonicDicomLookupDebugStep[] = [];

  for (const target of targets) {
    const template = chooseInternalTemplate(settings, target);
    if (!template.trim()) {
      result = { state: "unavailable", canViewReport: false, source: "sonicdicom" };
      steps.push({
        lookupTarget: target,
        requestUrlPreview: "(missing template)",
        contentType: "text/plain",
        state: "unavailable",
      });
      break;
    }

    const url = renderTemplate(template, settings, context, baseUrl, settings.sonicDicomInternalBaseUrl.trim() ? "internalBaseUrl" : "publicBaseUrl");
    const { content, contentType } = await fetchStatusContent(url, settings.sonicDicomTimeoutMs);
    const state = normalizeFetchedStatus(content, settings);
    result = { state, canViewReport: state === "final", source: "sonicdicom" };
    steps.push({
      lookupTarget: target,
      requestUrlPreview: sanitizeUrlForDebug(url),
      contentType: contentType || "text/plain",
      state,
    });
    if (state === "final" || state === "draft" || state === "unavailable") break;
  }

  return {
    ...result,
    baseUrlSource,
    lookupTried: targets,
    steps,
  };
}

export async function checkSonicDicomReportStatus(context: ReportLookupContext, options: { useCache?: boolean } = {}): Promise<ReportStatusResult> {
  const settings = await readSonicDicomReportSettings();
  if (!settings.sonicDicomReportsEnabled) return { state: "disabled", canViewReport: false, source: "rispro" };

  if (options.useCache !== false) {
    const cached = statusCache.get(context.bookingId);
    if (cached && cached.expiresAt > Date.now()) return cached.result;
  }

  const debugResult = await resolveSonicDicomReportStatus(settings, context);
  const result: ReportStatusResult = {
    state: debugResult.state,
    canViewReport: debugResult.canViewReport,
    source: debugResult.source,
  };

  const ttlMs = Math.max(0, settings.sonicDicomStatusCacheTtlSeconds) * 1000;
  if (ttlMs > 0) {
    statusCache.set(context.bookingId, { result, expiresAt: Date.now() + ttlMs });
  }

  if (settings.auditReportStatusChecks) {
    await logAuditEntry({
      entityType: "patient_report",
      entityId: context.bookingId,
      actionType: `report_status_${result.state}`,
      oldValues: null,
      newValues: { state: result.state, canViewReport: result.canViewReport },
      changedByUserId: null,
    }).catch(() => null);
  }

  return result;
}

export async function testSonicDicomReportStatusLookup(input: {
  accessionNumber: string;
  studyInstanceUid?: string | null;
  lookupKey?: "accession_number" | "study_instance_uid" | "prefer_study_uid_then_accession" | "prefer_accession_then_study_uid";
}): Promise<SonicDicomLookupDebugResult> {
  const settings = await readSonicDicomReportSettings();
  if (!settings.sonicDicomReportsEnabled) {
    return {
      state: "disabled",
      canViewReport: false,
      source: "rispro",
      baseUrlSource: getStatusCheckBaseUrlSource(settings),
      lookupTried: [],
      steps: [],
    };
  }

  const context: ReportLookupContext = {
    bookingId: 0,
    accessionNumber: String(input.accessionNumber || "").trim(),
    studyInstanceUid: String(input.studyInstanceUid || "").trim() || null,
    requiresReport: true,
    status: "completed",
  };

  const lookupKey = input.lookupKey;
  const effectiveSettings = lookupKey ? { ...settings, sonicDicomReportLookupKey: lookupKey } : settings;
  const result = await resolveSonicDicomReportStatus(effectiveSettings, context);

  if (settings.auditReportStatusChecks) {
    await logAuditEntry({
      entityType: "patient_report",
      entityId: null,
      actionType: "report_status_test",
      oldValues: null,
      newValues: {
        state: result.state,
        lookupTried: result.lookupTried,
        stepCount: result.steps.length,
      },
      changedByUserId: null,
    }).catch(() => null);
  }

  return result;
}

export async function buildPublicSonicDicomReportUrl(context: ReportLookupContext): Promise<string> {
  const settings = await readSonicDicomReportSettings();
  const publicBaseUrl = settings.sonicDicomPublicBaseUrl.trim();
  if (!publicBaseUrl) throw new HttpError(503, "Public SonicDICOM URL is not configured.");
  try {
    new URL(publicBaseUrl);
  } catch {
    throw new HttpError(503, "Public SonicDICOM URL is malformed.");
  }

  const targets = resolveLookupTargets(settings, context);
  const target = targets[0];
  if (!target) throw new HttpError(503, "No valid report lookup key is available.");
  let template = settings.sonicDicomPublicReportViewerUrlTemplate || settings.sonicDicomPublicPdfUrlTemplate;
  if (target === "study_instance_uid") {
    template = template.replace(/accessionnumber=\{\{accessionNumber\}\}/i, "studyinstanceuid={{studyInstanceUid}}");
  }
  return renderTemplate(template, settings, context, publicBaseUrl, "publicBaseUrl");
}
