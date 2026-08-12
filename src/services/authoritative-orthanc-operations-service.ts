import { HttpError } from "../utils/http-error.js";
import type { UserId } from "../types/http.js";
import {
  AuthoritativeOrthancClient,
  buildAuthoritativeOrthancRouteAliases,
  readAuthoritativeOrthancSettings,
  synchronizeAuthoritativeOrthancAutoRoute,
  type AuthoritativeOrthancRouteSynchronizationSummary,
  type AuthoritativeOrthancSettings,
  type OrthancResourceStatistics,
  type OrthancStudyMatchResult,
} from "./authoritative-orthanc-service.js";
import { logAuditEntry } from "./audit-service.js";
import {
  getClinicalDocumentExportOperationsSummary,
  type ClinicalDocumentExportOperationsSummary,
} from "./clinical-document-export-service.js";
import { listOrthancRemoteModalities } from "./orthanc-pacs-service.js";
import { redactDiagnosticText } from "./system-diagnostics-service.js";

type PacsDestination = { key: string; aet: string; host: string; port: number | null; configurationError?: string | null };
type OrthancJobState = "Pending" | "Running" | "Success" | "Failure" | "Paused" | "Retry";
export type OrthancOperationalJob = {
  id: string;
  type: string;
  state: OrthancJobState;
  progress: number | null;
  creationTime: string | null;
  startTime: string | null;
  completionTime: string | null;
  updatedAt: string | null;
  description: string;
  error: string | null;
  retryPermitted: boolean;
};
export type AuthoritativeOrthancRouteTestState = "not_tested" | "reachable" | "unreachable" | "timeout" | "missing_route" | "configuration_error";
export type AuthoritativeOrthancOperationalRoute = {
  destinationKey: string;
  destinationName: string;
  alias: string;
  aet: string;
  host: string;
  port: number | null;
  selectedForAutoRouting: true;
  autoRouteActive: boolean;
  managedAliasExists: boolean | null;
  configurationState: "configured" | "missing_managed_route" | "invalid_pacs_configuration" | "not_checked";
  configurationError: string | null;
  dicomTest: { state: AuthoritativeOrthancRouteTestState; connected: boolean | null; testedAt: string | null; code: string | null; message: string | null };
};

type RouteTestResult = AuthoritativeOrthancOperationalRoute["dicomTest"];
type AuditInput = Parameters<typeof logAuditEntry>[0];
export type AuthoritativeOrthancOperationsDependencies = {
  readSettings: typeof readAuthoritativeOrthancSettings;
  loadPacsDestinations: () => Promise<{ modalities: PacsDestination[] }>;
  createClient: (settings: AuthoritativeOrthancSettings) => AuthoritativeOrthancClient;
  loadClinicalDocumentSummary: typeof getClinicalDocumentExportOperationsSummary;
  synchronizeRoutes: typeof synchronizeAuthoritativeOrthancAutoRoute;
  audit: (entry: AuditInput) => Promise<unknown>;
  now: () => Date;
};

const productionDependencies: AuthoritativeOrthancOperationsDependencies = {
  readSettings: readAuthoritativeOrthancSettings,
  loadPacsDestinations: listOrthancRemoteModalities,
  createClient: (settings) => new AuthoritativeOrthancClient(settings),
  loadClinicalDocumentSummary: getClinicalDocumentExportOperationsSummary,
  synchronizeRoutes: synchronizeAuthoritativeOrthancAutoRoute,
  audit: logAuditEntry,
  now: () => new Date(),
};
const routeTestResults = new Map<string, RouteTestResult>();

function record(value: unknown): Record<string, unknown> { return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {}; }
function first(...values: unknown[]): string | null { for (const value of values) { if (typeof value === "string" || typeof value === "number") { const result = String(value).trim(); if (result) return result; } } return null; }
function safeText(value: unknown, fallback: string, maxLength = 300): string {
  const redacted = redactDiagnosticText(value)
    .replace(/(authorization\s*:\s*(?:basic|bearer|token|apikey))\s+[^\s,;]+/gi, "$1 [REDACTED]")
    .replace(/(https?:\/\/)([^\s/:@]+):([^\s@/]+)@/gi, "$1[REDACTED]@")
    .replace(/(https?:\/\/[^\s?#]+)\?[^\s]+/gi, "$1?[REDACTED]")
    .replace(/[\r\n\t]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return (redacted || fallback).slice(0, maxLength);
}
function httpErrorCode(error: unknown): string {
  if (!(error instanceof HttpError)) return "request_failed";
  const details = record(error.details);
  return first(details.code) || "request_failed";
}
function sectionError(error: unknown, fallback: string) { return { code: httpErrorCode(error), message: safeText(error instanceof Error ? error.message : error, fallback) }; }
function normalizedProgress(value: unknown): number | null { const parsed = Number(value); return Number.isFinite(parsed) ? Math.min(100, Math.max(0, parsed)) : null; }

export function normalizeOrthancJob(payload: unknown, fallbackId = ""): OrthancOperationalJob {
  const row = record(payload);
  const id = first(row.ID, row.Id, row.id, fallbackId);
  const type = first(row.Type, row.type);
  const state = first(row.State, row.state) as OrthancJobState | null;
  const allowedStates: OrthancJobState[] = ["Pending", "Running", "Success", "Failure", "Paused", "Retry"];
  if (!id || !type || !state || !allowedStates.includes(state)) throw new HttpError(502, "Authoritative Orthanc returned a malformed job response.", { code: "orthanc_invalid_response" });
  const content = record(row.Content ?? row.content);
  const error = state === "Failure" ? safeText(first(row.ErrorDescription, row.errorDescription, row.ErrorDetails, row.error) || "Orthanc job failed.", "Orthanc job failed.") : null;
  return {
    id,
    type: safeText(type, "Orthanc job", 100),
    state,
    progress: normalizedProgress(row.Progress ?? row.progress),
    creationTime: first(row.CreationTime, row.creationTime),
    startTime: first(row.StartTime, row.startTime),
    completionTime: first(row.CompletionTime, row.completionTime),
    updatedAt: first(row.Timestamp, row.timestamp, row.LastUpdate, row.lastUpdate),
    description: safeText(first(content.Description, content.description, row.Description, row.description, type), "Orthanc job"),
    error,
    retryPermitted: state === "Failure",
  };
}

async function loadJobs(client: AuthoritativeOrthancClient): Promise<OrthancOperationalJob[]> {
  const payload = await client.listJobs();
  let jobs: OrthancOperationalJob[];
  if (Array.isArray(payload)) {
    jobs = await Promise.all(payload.map(async (item) => typeof item === "string" ? normalizeOrthancJob(await client.getJob(item), item) : normalizeOrthancJob(item)));
  } else {
    const rows = record(payload);
    jobs = Object.entries(rows).map(([id, item]) => normalizeOrthancJob(item, id));
  }
  const rank = (state: OrthancJobState) => state === "Failure" ? 0 : ["Running", "Pending", "Paused", "Retry"].includes(state) ? 1 : 2;
  return jobs.sort((a, b) => rank(a.state) - rank(b.state) || String(b.creationTime || b.updatedAt || "").localeCompare(String(a.creationTime || a.updatedAt || "")));
}

function parseOrthancTime(value: string | null): number | null {
  if (!value) return null;
  const compact = value.match(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})/);
  const parsed = compact ? Date.UTC(Number(compact[1]), Number(compact[2]) - 1, Number(compact[3]), Number(compact[4]), Number(compact[5]), Number(compact[6])) : Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}
function isRelevantDicomStoreJob(job: OrthancOperationalJob): boolean { return /(dicom.*store|store.*dicom|modality.*store)/i.test(`${job.type} ${job.description}`); }
function summarizeJobs(jobs: OrthancOperationalJob[], now: Date) {
  const recentCutoff = now.getTime() - 24 * 60 * 60 * 1000;
  const recentRelevantFailed = jobs.filter((job) => job.state === "Failure" && isRelevantDicomStoreJob(job) && (parseOrthancTime(job.completionTime || job.updatedAt || job.creationTime) ?? 0) >= recentCutoff).length;
  return {
    total: jobs.length,
    running: jobs.filter((job) => job.state === "Running").length,
    pending: jobs.filter((job) => job.state === "Pending" || job.state === "Retry").length,
    failed: jobs.filter((job) => job.state === "Failure").length,
    successful: jobs.filter((job) => job.state === "Success").length,
    paused: jobs.filter((job) => job.state === "Paused").length,
    recentRelevantFailed,
    recentFailureWindowHours: 24,
  };
}

async function buildRoutes(settings: AuthoritativeOrthancSettings, existingAliases: string[] | null, dependencies: AuthoritativeOrthancOperationsDependencies): Promise<AuthoritativeOrthancOperationalRoute[]> {
  const { modalities } = await dependencies.loadPacsDestinations();
  const aliases = buildAuthoritativeOrthancRouteAliases(settings.autoRouteDestinationKeys);
  return aliases.map(({ destinationKey, alias }) => {
    const destination = modalities.find((item) => item.key === destinationKey);
    const configurationError = destination?.configurationError || (!destination ? "The selected PACS destination no longer exists." : !destination.aet || !destination.host || destination.port == null ? "The PACS destination is missing a valid AET, host, or port." : null);
    const managedAliasExists = existingAliases == null ? null : existingAliases.includes(alias);
    const configurationState = configurationError ? "invalid_pacs_configuration" : managedAliasExists == null ? "not_checked" : managedAliasExists ? "configured" : "missing_managed_route";
    return {
      destinationKey,
      destinationName: destinationKey,
      alias,
      aet: destination?.aet || "",
      host: destination?.host || "",
      port: destination?.port ?? null,
      selectedForAutoRouting: true,
      autoRouteActive: settings.enabled && settings.autoRouteEnabled,
      managedAliasExists,
      configurationState,
      configurationError: configurationError ? safeText(configurationError, "Invalid PACS destination configuration.") : null,
      dicomTest: routeTestResults.get(alias) || { state: "not_tested", connected: null, testedAt: null, code: null, message: null },
    } satisfies AuthoritativeOrthancOperationalRoute;
  });
}

async function loadRoutes(settings: AuthoritativeOrthancSettings, client: AuthoritativeOrthancClient | null, dependencies: AuthoritativeOrthancOperationsDependencies): Promise<AuthoritativeOrthancOperationalRoute[]> {
  const existingAliases = client ? await client.listRemoteModalityKeys() : null;
  return buildRoutes(settings, existingAliases, dependencies);
}

export async function getAuthoritativeOrthancOperationalRoutes(dependencies: AuthoritativeOrthancOperationsDependencies = productionDependencies) {
  const settings = await dependencies.readSettings();
  const client = settings.enabled && settings.baseUrl ? dependencies.createClient(settings) : null;
  const routes = await loadRoutes(settings, client, dependencies);
  return { autoRouteEnabled: settings.autoRouteEnabled, routes, generatedAt: dependencies.now().toISOString() };
}

async function testRoute(route: AuthoritativeOrthancOperationalRoute, client: AuthoritativeOrthancClient, timeoutSeconds: number, now: Date): Promise<RouteTestResult> {
  const testedAt = now.toISOString();
  if (route.configurationError) return { state: "configuration_error", connected: false, testedAt, code: "route_configuration_error", message: route.configurationError };
  if (!route.managedAliasExists) return { state: "missing_route", connected: false, testedAt, code: "managed_route_missing", message: "The expected managed route is missing in Authoritative Orthanc." };
  try {
    await client.echoRemoteModality(route.alias, timeoutSeconds);
    return { state: "reachable", connected: true, testedAt, code: null, message: "DICOM C-ECHO succeeded." };
  } catch (error) {
    const code = httpErrorCode(error);
    return { state: code === "orthanc_timeout" ? "timeout" : "unreachable", connected: false, testedAt, code, message: safeText(error instanceof Error ? error.message : error, "DICOM C-ECHO failed.") };
  }
}

export async function testAuthoritativeOrthancOperationalRoute(alias: string, userId: UserId, dependencies: AuthoritativeOrthancOperationsDependencies = productionDependencies) {
  const settings = await dependencies.readSettings();
  if (!settings.enabled) throw new HttpError(409, "Authoritative Orthanc is disabled.", { code: "orthanc_disabled" });
  const client = dependencies.createClient(settings);
  const route = (await loadRoutes(settings, client, dependencies)).find((item) => item.alias === alias);
  if (!route) throw new HttpError(404, "The requested managed Authoritative Orthanc route is not selected.");
  const result = await testRoute(route, client, settings.timeoutSeconds, dependencies.now());
  routeTestResults.set(route.alias, result);
  await dependencies.audit({ entityType: "integration", entityId: null, actionType: "authoritative_orthanc_route_echo_tested", oldValues: null, newValues: { alias: route.alias, destinationKey: route.destinationKey, outcome: result.connected ? "success" : "failed", code: result.code }, changedByUserId: userId });
  return { route: { ...route, dicomTest: result } };
}

async function mapBounded<T, R>(items: T[], concurrency: number, task: (item: T) => Promise<R>): Promise<R[]> {
  const results = new Array<R>(items.length);
  let cursor = 0;
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (cursor < items.length) { const index = cursor++; results[index] = await task(items[index]!); }
  }));
  return results;
}

export async function testAllAuthoritativeOrthancOperationalRoutes(userId: UserId, dependencies: AuthoritativeOrthancOperationsDependencies = productionDependencies) {
  const settings = await dependencies.readSettings();
  if (!settings.enabled) throw new HttpError(409, "Authoritative Orthanc is disabled.", { code: "orthanc_disabled" });
  const client = dependencies.createClient(settings);
  const routes = await loadRoutes(settings, client, dependencies);
  const tested = await mapBounded(routes, 3, async (route) => {
    const result = await testRoute(route, client, settings.timeoutSeconds, dependencies.now());
    routeTestResults.set(route.alias, result);
    return { ...route, dicomTest: result };
  });
  const reachable = tested.filter((route) => route.dicomTest.connected).length;
  const aggregate = { total: tested.length, reachable, failed: tested.length - reachable, results: tested };
  await dependencies.audit({ entityType: "integration", entityId: null, actionType: "authoritative_orthanc_routes_echo_tested", oldValues: null, newValues: { outcome: aggregate.failed ? "failed" : "success", total: aggregate.total, reachable: aggregate.reachable, failed: aggregate.failed }, changedByUserId: userId });
  return aggregate;
}

export async function synchronizeAuthoritativeOrthancOperationalRoutes(userId: UserId, dependencies: AuthoritativeOrthancOperationsDependencies = productionDependencies): Promise<AuthoritativeOrthancRouteSynchronizationSummary> {
  const settings = await dependencies.readSettings();
  const summary = await dependencies.synchronizeRoutes(settings);
  await dependencies.audit({ entityType: "integration", entityId: null, actionType: "authoritative_orthanc_routes_synchronized", oldValues: null, newValues: { outcome: "success", ...summary }, changedByUserId: userId });
  return summary;
}

export async function getAuthoritativeOrthancOperationalJobs(dependencies: AuthoritativeOrthancOperationsDependencies = productionDependencies) {
  const settings = await dependencies.readSettings();
  const jobs = await loadJobs(dependencies.createClient(settings));
  return { jobs, summary: summarizeJobs(jobs, dependencies.now()), generatedAt: dependencies.now().toISOString() };
}

export async function retryAuthoritativeOrthancOperationalJob(jobId: string, userId: UserId, dependencies: AuthoritativeOrthancOperationsDependencies = productionDependencies) {
  if (!/^[A-Za-z0-9-]{1,128}$/.test(jobId)) throw new HttpError(400, "Invalid Orthanc job ID.");
  const settings = await dependencies.readSettings();
  const client = dependencies.createClient(settings);
  const job = normalizeOrthancJob(await client.getJob(jobId), jobId);
  if (!job.retryPermitted) throw new HttpError(409, "Only failed Orthanc jobs can be retried.");
  await client.resubmitJob(job.id);
  await dependencies.audit({ entityType: "integration", entityId: null, actionType: "authoritative_orthanc_job_retry_requested", oldValues: { state: job.state }, newValues: { outcome: "pending", jobId: job.id, type: job.type }, changedByUserId: userId });
  return { jobId: job.id, state: "Pending" as const, requestedAt: dependencies.now().toISOString() };
}

export async function searchAuthoritativeOrthancOperationalStudy(query: { studyInstanceUid?: string | null; accessionNumber?: string | null }, dependencies: AuthoritativeOrthancOperationsDependencies = productionDependencies): Promise<OrthancStudyMatchResult> {
  const studyInstanceUid = String(query.studyInstanceUid || "").trim();
  const accessionNumber = String(query.accessionNumber || "").trim();
  if (!studyInstanceUid && !accessionNumber) throw new HttpError(400, "A StudyInstanceUID or accession number is required.");
  if (studyInstanceUid && accessionNumber) throw new HttpError(400, "Provide only one study lookup key.");
  if ((studyInstanceUid || accessionNumber).length > 256) throw new HttpError(400, "The study lookup value is too long.");
  return dependencies.createClient(await dependencies.readSettings()).findStudy({ studyInstanceUid, accessionNumber });
}

function emptyClinicalDocumentSummary(): ClinicalDocumentExportOperationsSummary { return { pending: 0, processing: 0, retryable: 0, failed: 0, completed: 0, oldestPendingOrRetryableAt: null, latestFailures: [] }; }
function routingSummary(settings: AuthoritativeOrthancSettings, routes: AuthoritativeOrthancOperationalRoute[]) {
  return {
    autoRouteEnabled: settings.autoRouteEnabled,
    selected: routes.length,
    configured: routes.filter((route) => route.configurationState === "configured").length,
    missing: routes.filter((route) => route.configurationState === "missing_managed_route").length,
    invalid: routes.filter((route) => route.configurationState === "invalid_pacs_configuration").length,
    routes,
  };
}

export async function getAuthoritativeOrthancOperationsSummary(dependencies: AuthoritativeOrthancOperationsDependencies = productionDependencies) {
  const settings = await dependencies.readSettings();
  const generatedAt = dependencies.now().toISOString();
  const clinicalPromise = dependencies.loadClinicalDocumentSummary();
  const configurationRoutesPromise = buildRoutes(settings, null, dependencies);
  if (!settings.enabled) {
    const [routesResult, clinicalResult] = await Promise.allSettled([configurationRoutesPromise, clinicalPromise]);
    const routes = routesResult.status === "fulfilled" ? routesResult.value : [];
    return {
      overallState: "disabled" as const,
      connectionState: "disabled" as const,
      healthSentence: "Authoritative Orthanc is disabled in Settings.",
      reasons: [{ code: "ORTHANC_DISABLED", message: "The integration is disabled." }],
      system: null,
      statistics: { data: null, error: null },
      routing: { ...routingSummary(settings, routes), error: routesResult.status === "rejected" ? sectionError(routesResult.reason, "Routing configuration is unavailable.") : null },
      jobs: { items: [], summary: summarizeJobs([], dependencies.now()), error: null },
      clinicalDocuments: { data: clinicalResult.status === "fulfilled" ? clinicalResult.value : emptyClinicalDocumentSummary(), error: clinicalResult.status === "rejected" ? sectionError(clinicalResult.reason, "Clinical document export status is unavailable.") : null },
      generatedAt,
    };
  }

  const client = dependencies.createClient(settings);
  let system;
  try { system = await client.getSystem(); }
  catch (error) {
    const [routesResult, clinicalResult] = await Promise.allSettled([configurationRoutesPromise, clinicalPromise]);
    const reason = sectionError(error, "Authoritative Orthanc is unavailable.");
    const routes = routesResult.status === "fulfilled" ? routesResult.value : [];
    return {
      overallState: "offline" as const,
      connectionState: "unavailable" as const,
      healthSentence: reason.message,
      reasons: [{ code: reason.code === "orthanc_auth_failed" ? "ORTHANC_AUTHENTICATION_FAILED" : reason.code === "orthanc_timeout" ? "ORTHANC_TIMEOUT" : "ORTHANC_UNAVAILABLE", message: reason.message }],
      system: null,
      statistics: { data: null, error: reason },
      routing: { ...routingSummary(settings, routes), error: reason },
      jobs: { items: [], summary: summarizeJobs([], dependencies.now()), error: reason },
      clinicalDocuments: { data: clinicalResult.status === "fulfilled" ? clinicalResult.value : emptyClinicalDocumentSummary(), error: clinicalResult.status === "rejected" ? sectionError(clinicalResult.reason, "Clinical document export status is unavailable.") : null },
      generatedAt,
    };
  }

  const [statisticsResult, jobsResult, routesResult, clinicalResult] = await Promise.allSettled([
    client.getStatistics(),
    loadJobs(client),
    loadRoutes(settings, client, dependencies),
    clinicalPromise,
  ]);
  const jobs = jobsResult.status === "fulfilled" ? jobsResult.value : [];
  const jobSummary = summarizeJobs(jobs, dependencies.now());
  const routes = routesResult.status === "fulfilled" ? routesResult.value : [];
  const routeSummary = routingSummary(settings, routes);
  const reasons: Array<{ code: string; message: string }> = [];
  if (statisticsResult.status === "rejected") reasons.push({ code: "STATISTICS_UNAVAILABLE", message: "Orthanc storage statistics are unavailable." });
  if (jobsResult.status === "rejected") reasons.push({ code: "JOBS_UNAVAILABLE", message: "Orthanc job monitoring is unavailable." });
  if (routesResult.status === "rejected") reasons.push({ code: "ROUTING_STATUS_UNAVAILABLE", message: "Managed route status is unavailable." });
  if (settings.autoRouteEnabled && routeSummary.selected === 0) reasons.push({ code: "NO_AUTO_ROUTE_DESTINATIONS", message: "Auto-routing is enabled without a selected destination." });
  if (routeSummary.missing > 0) reasons.push({ code: "MANAGED_ROUTES_MISSING", message: `${routeSummary.missing} selected managed route${routeSummary.missing === 1 ? " is" : "s are"} missing.` });
  if (routeSummary.invalid > 0) reasons.push({ code: "ROUTE_CONFIGURATION_INVALID", message: `${routeSummary.invalid} selected destination${routeSummary.invalid === 1 ? " has" : "s have"} invalid PACS configuration.` });
  if (jobSummary.recentRelevantFailed > 0) reasons.push({ code: "RECENT_DICOM_STORE_FAILURES", message: `${jobSummary.recentRelevantFailed} relevant DICOM Store job${jobSummary.recentRelevantFailed === 1 ? " has" : "s have"} failed in the last 24 hours.` });
  if (clinicalResult.status === "rejected") reasons.push({ code: "CLINICAL_DOCUMENT_STATUS_UNAVAILABLE", message: "Clinical document export status is unavailable." });
  const degraded = reasons.length > 0;
  const routeText = settings.autoRouteEnabled ? `${routeSummary.configured}/${routeSummary.selected} selected destinations are configured` : "stable-series auto-routing is disabled";
  const failureText = jobSummary.recentRelevantFailed ? `${jobSummary.recentRelevantFailed} relevant DICOM Store jobs failed recently` : "no relevant failed DICOM Store jobs were found";
  return {
    overallState: degraded ? "degraded" as const : "healthy" as const,
    connectionState: degraded ? "degraded" as const : "connected" as const,
    healthSentence: degraded ? `Operational attention is required: ${reasons.map((reason) => reason.message).join(" ")}` : `Routing healthy — ${routeText} and ${failureText}.`,
    reasons,
    system: { ...system, uptimeSeconds: null as number | null },
    statistics: { data: statisticsResult.status === "fulfilled" ? statisticsResult.value : null as OrthancResourceStatistics | null, error: statisticsResult.status === "rejected" ? sectionError(statisticsResult.reason, "Orthanc statistics are unavailable.") : null },
    routing: { ...routeSummary, error: routesResult.status === "rejected" ? sectionError(routesResult.reason, "Managed route status is unavailable.") : null },
    jobs: { items: jobs, summary: jobSummary, error: jobsResult.status === "rejected" ? sectionError(jobsResult.reason, "Orthanc jobs are unavailable.") : null },
    clinicalDocuments: { data: clinicalResult.status === "fulfilled" ? clinicalResult.value : emptyClinicalDocumentSummary(), error: clinicalResult.status === "rejected" ? sectionError(clinicalResult.reason, "Clinical document export status is unavailable.") : null },
    generatedAt,
  };
}

export function __resetAuthoritativeOrthancOperationsForTests(): void { routeTestResults.clear(); }
