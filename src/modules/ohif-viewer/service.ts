import type { Response as ExpressResponse } from "express";
import { env } from "../../config/env.js";
import { pool } from "../../db/pool.js";
import { logAuditEntry } from "../../services/audit-service.js";
import { recordDiagnosticEvent } from "../../services/system-diagnostics-service.js";
import { listPacsNodes } from "../../services/pacs-node-service.js";
import { testPacsConnectionWithNode } from "../../services/pacs-service.js";
import { resolveOrthancSettings } from "../../services/orthanc-settings-resolver.js";
import { getAuthorizedReportingBoardAppointment, type Actor } from "../doctor-portal/reporting-board-service.js";
import type { UserId, UnknownRecord } from "../../types/http.js";
import { HttpError } from "../../utils/http-error.js";
import { createLogger } from "../../observability/logger.js";
import { asUnknownRecord } from "../../utils/records.js";
import { createImagingSourceAdapter, ImagingSourceError, proxyNativeDicomWebRequest, proxyOrthancDicomWebRequest } from "./adapters.js";
import {
  cleanupExpiredViewerSessionsAndJobs,
  consumeViewerLaunchToken,
  createViewerLaunchSession,
  enqueueRetrievalJob,
  findAuthorizedViewerSession,
  findPacsWebEndpoint,
  findRetrievalJob,
  findStudyResolution,
  readOhifViewerConfiguration,
  saveOhifViewerConfiguration,
  updatePacsWebDiagnostic,
  upsertStudyResolution,
} from "./repository.js";
import type { ImagingStudy, OhifAuthType, OhifViewerConfiguration, ViewerLaunchResponse } from "./types.js";
import {
  assertSameDicomWebOrigin,
  createLaunchToken,
  hashLaunchToken,
  isValidDicomUid,
  matchStudyByAccession,
  normalizeDicomWebUrl,
  normalizeEnvironmentKey,
  normalizeViewerBasePath,
  requestedStudyUids,
  selectPriorStudies,
} from "./validation.js";

function bool(value: unknown, fallback: boolean): boolean {
  if (value == null || value === "") return fallback;
  if (typeof value === "boolean") return value;
  const clean = String(value).trim().toLowerCase();
  if (["true", "1", "yes", "enabled"].includes(clean)) return true;
  if (["false", "0", "no", "disabled"].includes(clean)) return false;
  throw new HttpError(400, "Boolean setting value is invalid.");
}

function integer(value: unknown, field: string, fallback: number, min: number, max: number): number {
  const parsed = value == null || value === "" ? fallback : Number(value);
  if (!Number.isInteger(parsed) || parsed < min || parsed > max) throw new HttpError(400, `${field} must be between ${min} and ${max}.`);
  return parsed;
}

function nullablePositiveInteger(value: unknown, field: string): number | null {
  if (value == null || value === "") return null;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) throw new HttpError(400, `${field} must be a positive integer.`);
  return parsed;
}

function nullableText(value: unknown): string | null {
  const clean = String(value ?? "").trim();
  return clean || null;
}

function diagnosticFailureCategory(error: unknown): string {
  if (error instanceof ImagingSourceError) return error.category;
  const message = error instanceof Error ? error.message : String(error || "");
  const cause = (error as { cause?: { code?: string } })?.cause?.code || "";
  if ((error as Error)?.name === "TimeoutError" || (error as Error)?.name === "AbortError") return "timeout";
  if (["ENOTFOUND", "EAI_AGAIN"].includes(cause)) return "dns";
  if (/certificate|tls|ssl/i.test(message)) return "tls";
  if (error instanceof HttpError) return "configuration";
  return "network";
}

function publicConfiguration(configuration: OhifViewerConfiguration) {
  return {
    ...configuration,
    webEndpoint: configuration.webEndpoint ? {
      ...configuration.webEndpoint,
      usernameEnvKey: configuration.webEndpoint.usernameEnvKey,
      passwordEnvKey: configuration.webEndpoint.passwordEnvKey,
      bearerTokenEnvKey: configuration.webEndpoint.bearerTokenEnvKey,
    } : null,
    environmentCredentialStatus: configuration.webEndpoint ? {
      usernameConfigured: Boolean(configuration.webEndpoint.usernameEnvKey && process.env[configuration.webEndpoint.usernameEnvKey]),
      passwordConfigured: Boolean(configuration.webEndpoint.passwordEnvKey && process.env[configuration.webEndpoint.passwordEnvKey]),
      bearerTokenConfigured: Boolean(configuration.webEndpoint.bearerTokenEnvKey && process.env[configuration.webEndpoint.bearerTokenEnvKey]),
    } : { usernameConfigured: false, passwordConfigured: false, bearerTokenConfigured: false },
  };
}

export async function getOhifAdminConfiguration() {
  const [configuration, pacsNodes] = await Promise.all([
    readOhifViewerConfiguration(),
    listPacsNodes({ includeInactive: true }),
  ]);
  return { configuration: publicConfiguration(configuration), pacsNodes };
}

export async function putOhifAdminConfiguration(value: unknown, userId: UserId) {
  const body = asUnknownRecord(value);
  const settingsInput = asUnknownRecord(body.settings ?? body);
  const endpointInput = asUnknownRecord(body.webEndpoint ?? {});
  const selectedPacsNodeId = nullablePositiveInteger(settingsInput.selectedPacsNodeId, "selectedPacsNodeId");
  const accessStrategy = String(settingsInput.accessStrategy || "native_dicomweb");
  if (!['native_dicomweb', 'orthanc_gateway'].includes(accessStrategy)) throw new HttpError(400, "accessStrategy is invalid.");
  const openMode = String(settingsInput.openMode || "new_tab");
  if (!['new_tab', 'same_tab'].includes(openMode)) throw new HttpError(400, "openMode is invalid.");
  const enabled = bool(settingsInput.enabled, false);
  if (enabled && !selectedPacsNodeId) throw new HttpError(400, "An active OHIF image source is required before enabling OHIF.");

  const nodes = await listPacsNodes({ includeInactive: true });
  const selected = selectedPacsNodeId ? nodes.find((node) => Number(node.id) === selectedPacsNodeId) : null;
  if (selectedPacsNodeId && (!selected || !selected.is_active)) throw new HttpError(400, "The selected OHIF image source must be an active PACS node.");

  const orthancGatewayEnabled = bool(settingsInput.orthancGatewayEnabled, accessStrategy === "orthanc_gateway");
  if (accessStrategy === "orthanc_gateway" && !orthancGatewayEnabled) throw new HttpError(400, "Orthanc gateway must be enabled for the selected strategy.");

  let endpoint: Parameters<typeof saveOhifViewerConfiguration>[0]["endpoint"] = null;
  if (selectedPacsNodeId && (accessStrategy === "native_dicomweb" || Boolean(nullableText(endpointInput.dicomwebBaseUrl)))) {
    const baseUrl = normalizeDicomWebUrl(endpointInput.dicomwebBaseUrl, "dicomwebBaseUrl");
    const qidoRoot = normalizeDicomWebUrl(endpointInput.qidoRoot, "qidoRoot");
    const wadoRsRoot = normalizeDicomWebUrl(endpointInput.wadoRsRoot, "wadoRsRoot");
    const wadoUriRoot = endpointInput.wadoUriRoot ? normalizeDicomWebUrl(endpointInput.wadoUriRoot, "wadoUriRoot") : null;
    const stowRoot = endpointInput.stowRoot ? normalizeDicomWebUrl(endpointInput.stowRoot, "stowRoot") : null;
    assertSameDicomWebOrigin(baseUrl, qidoRoot, wadoRsRoot, wadoUriRoot, stowRoot);
    const authType = String(endpointInput.authType || "none") as OhifAuthType;
    if (!['none', 'basic', 'bearer'].includes(authType)) throw new HttpError(400, "authType is invalid.");
    endpoint = {
      enabled: bool(endpointInput.enabled, accessStrategy === "native_dicomweb"),
      dicomwebBaseUrl: baseUrl, qidoRoot, wadoRsRoot, wadoUriRoot, stowRoot, authType,
      usernameEnvKey: normalizeEnvironmentKey(endpointInput.usernameEnvKey, "usernameEnvKey", authType === "basic"),
      passwordEnvKey: normalizeEnvironmentKey(endpointInput.passwordEnvKey, "passwordEnvKey", authType === "basic"),
      bearerTokenEnvKey: normalizeEnvironmentKey(endpointInput.bearerTokenEnvKey, "bearerTokenEnvKey", authType === "bearer"),
      verifyTls: bool(endpointInput.verifyTls, true),
      timeoutSeconds: integer(endpointInput.timeoutSeconds, "timeoutSeconds", 30, 1, 300),
      osirixVersion: nullableText(endpointInput.osirixVersion),
      dicomwebServerEnabled: endpointInput.dicomwebServerEnabled == null ? null : bool(endpointInput.dicomwebServerEnabled, false),
    };
    if (authType === "none") endpoint = { ...endpoint, usernameEnvKey: null, passwordEnvKey: null, bearerTokenEnvKey: null };
    if (authType === "basic") endpoint = { ...endpoint, bearerTokenEnvKey: null };
    if (authType === "bearer") endpoint = { ...endpoint, usernameEnvKey: null, passwordEnvKey: null };
  }

  const previous = await readOhifViewerConfiguration();
  const saved = await saveOhifViewerConfiguration({
    settings: {
      enabled,
      ohifPublicBaseUrl: normalizeViewerBasePath(settingsInput.ohifPublicBaseUrl, env.ohifPublicBaseUrl),
      selectedPacsNodeId,
      accessStrategy: accessStrategy as "native_dicomweb" | "orthanc_gateway",
      orthancGatewayEnabled,
      orthancModalityKey: nullableText(settingsInput.orthancModalityKey),
      openMode: openMode as "new_tab" | "same_tab",
      allowPriorStudies: bool(settingsInput.allowPriorStudies, true),
      maxPriorStudies: integer(settingsInput.maxPriorStudies, "maxPriorStudies", 5, 0, 20),
      launchTokenTtlSeconds: integer(settingsInput.launchTokenTtlSeconds, "launchTokenTtlSeconds", env.ohifLaunchTokenTtlSeconds, 60, 3600),
      cacheRetentionHours: integer(settingsInput.cacheRetentionHours, "cacheRetentionHours", 24, 1, 720),
      retrievalTimeoutSeconds: integer(settingsInput.retrievalTimeoutSeconds, "retrievalTimeoutSeconds", 300, 10, 3600),
    }, endpoint, userId,
  });
  await logAuditEntry({ entityType: "ohif_viewer_settings", actionType: "update", oldValues: publicConfiguration(previous), newValues: publicConfiguration(saved), changedByUserId: userId });
  return { configuration: publicConfiguration(saved), pacsNodes: nodes };
}

function failureMessage(status: ViewerLaunchResponse["status"]): string {
  const messages: Record<string, string> = {
    not_found: "No matching study was found on the configured OHIF image source.",
    ambiguous: "Multiple matching studies were found. The study could not be selected safely.",
    source_unavailable: "The image source is currently unavailable.",
    configuration_error: "OHIF Viewer is not configured.",
    retrieval_required: "The study must be retrieved from PACS.",
    retrieving: "The study is being retrieved from PACS.",
    retrieval_failed: "The study retrieval failed.",
  };
  return messages[status] || "The OHIF launch failed.";
}

async function auditLaunch(actor: Actor, appointmentId: number, status: string, fields: Record<string, unknown> = {}): Promise<void> {
  await logAuditEntry({
    entityType: "ohif_viewer_launch", entityId: appointmentId, actionType: `viewer_launch_${status}`,
    newValues: { status, appointmentId, ...fields }, changedByUserId: actor.userId,
  }).catch(() => null);
}

async function resolveCurrentStudy(input: {
  appointmentId: number; accessionNumber: string; patientId: string | null; modality: string; studyDate: string;
  persistedStudyUid: string | null; sourcePacsNodeId: number; adapter: Awaited<ReturnType<typeof createImagingSourceAdapter>>;
}) {
  const persisted = await findStudyResolution(input.appointmentId, input.sourcePacsNodeId);
  const candidateUid = persisted?.studyInstanceUid || (isValidDicomUid(input.persistedStudyUid) ? input.persistedStudyUid : null);
  if (candidateUid && await input.adapter.verifyStudyAvailable(candidateUid)) {
    const study: ImagingStudy = {
      patientId: input.patientId || "", patientName: "", accessionNumber: input.accessionNumber,
      modality: input.modality, studyDescription: "", studyDate: input.studyDate, studyInstanceUid: candidateUid,
    };
    await upsertStudyResolution({
      appointmentId: input.appointmentId, accessionNumber: input.accessionNumber, patientIdValue: input.patientId,
      study, sourcePacsNodeId: input.sourcePacsNodeId, resolutionMethod: "persisted_uid_verified", diagnostic: { reused: true },
    });
    return { status: "matched" as const, study, candidateCount: 1, rejectedPatientMismatchCount: 0 };
  }
  const studies = await input.adapter.searchStudyByAccession(input.accessionNumber);
  return matchStudyByAccession({ studies, accessionNumber: input.accessionNumber, patientId: input.patientId, modality: input.modality, studyDate: input.studyDate });
}

export async function launchReportingBoardCaseInOhif(actor: Actor, appointmentId: number, includePriors = true, requestId?: string): Promise<ViewerLaunchResponse> {
  const started = performance.now();
  const logger = createLogger({ domain: "ohif_viewer", requestId });
  logger.info("viewer_launch_requested", { appointmentId, includePriors });
  try {
    if (!env.ohifEnabled) return { status: "configuration_error", message: failureMessage("configuration_error") };
    const { row } = await getAuthorizedReportingBoardAppointment(actor, appointmentId, "You are not allowed to open this Reporting Board case in OHIF.");
    if (row.caseType !== "appointment") throw new HttpError(400, "OHIF launch currently supports appointment cases only.");
    const configuration = await readOhifViewerConfiguration();
    if (!configuration.settings.enabled || !configuration.settings.selectedPacsNodeId) {
      await auditLaunch(actor, appointmentId, "configuration_error");
      return { status: "configuration_error", message: failureMessage("configuration_error") };
    }
    const adapter = await createImagingSourceAdapter(configuration);
    logger.info("viewer_source_selected", { appointmentId, sourcePacsNodeId: configuration.settings.selectedPacsNodeId, accessStrategy: adapter.strategy });
    const matched = await resolveCurrentStudy({
      appointmentId, accessionNumber: row.accessionNumber, patientId: row.patientDicomId, modality: row.modalityCode,
      studyDate: row.bookingDate, persistedStudyUid: row.studyInstanceUid,
      sourcePacsNodeId: configuration.settings.selectedPacsNodeId, adapter,
    });
    if (matched.status !== "matched" || !matched.study) {
      const status = matched.status === "ambiguous" ? "ambiguous" : "not_found";
      await auditLaunch(actor, appointmentId, status, { candidateCount: matched.candidateCount, rejectedPatientMismatchCount: matched.rejectedPatientMismatchCount });
      logger.warn("viewer_accession_resolution_failed", { appointmentId, status, candidateCount: matched.candidateCount, durationMs: Math.round(performance.now() - started) });
      return { status, message: failureMessage(status) };
    }
    const currentStudy = matched.study;
    await upsertStudyResolution({
      appointmentId, accessionNumber: row.accessionNumber, patientIdValue: row.patientDicomId,
      study: currentStudy, sourcePacsNodeId: configuration.settings.selectedPacsNodeId,
      resolutionMethod: adapter.strategy === "orthanc_gateway" ? "orthanc_remote_query" : "exact_accession",
      diagnostic: { candidateCount: matched.candidateCount, rejectedPatientMismatchCount: matched.rejectedPatientMismatchCount },
    });
    await logAuditEntry({ entityType: "study_source_resolution", entityId: appointmentId, actionType: "ohif_study_resolved", newValues: {
      status: "successful", appointmentId, sourcePacsNodeId: configuration.settings.selectedPacsNodeId,
      resolutionMethod: adapter.strategy === "orthanc_gateway" ? "orthanc_remote_query" : "exact_accession",
    }, changedByUserId: actor.userId });

    if (adapter.strategy === "orthanc_gateway" && !(await adapter.verifyStudyAvailable(currentStudy.studyInstanceUid))) {
      const job = await enqueueRetrievalJob({ appointmentId, accessionNumber: row.accessionNumber, studyInstanceUid: currentStudy.studyInstanceUid, sourcePacsNodeId: configuration.settings.selectedPacsNodeId, userId: actor.userId });
      await auditLaunch(actor, appointmentId, "retrieving", { retrievalJobId: job.id });
      logger.info("viewer_retrieval_joined", { appointmentId, jobId: job.id });
      return { status: "retrieving", message: failureMessage("retrieving"), retrievalJobId: job.id };
    }

    let priors: ImagingStudy[] = [];
    if (includePriors && configuration.settings.allowPriorStudies && row.patientDicomId) {
      const candidates = await adapter.searchStudiesByPatient(row.patientDicomId);
      priors = selectPriorStudies({ studies: candidates, currentStudy, patientId: row.patientDicomId, maxPriors: configuration.settings.maxPriorStudies });
      if (adapter.strategy === "orthanc_gateway") {
        let firstMissingJobId: number | null = null;
        for (const prior of priors) {
          if (await adapter.verifyStudyAvailable(prior.studyInstanceUid)) continue;
          const job = await enqueueRetrievalJob({
            appointmentId,
            accessionNumber: prior.accessionNumber || prior.studyInstanceUid,
            studyInstanceUid: prior.studyInstanceUid,
            sourcePacsNodeId: configuration.settings.selectedPacsNodeId,
            userId: actor.userId,
          });
          firstMissingJobId ??= job.id;
        }
        if (firstMissingJobId) {
          await auditLaunch(actor, appointmentId, "retrieving", { retrievalJobId: firstMissingJobId, priorRetrieval: true });
          return { status: "retrieving", message: failureMessage("retrieving"), retrievalJobId: firstMissingJobId };
        }
      }
    }
    const permittedStudyUids = [currentStudy.studyInstanceUid, ...priors.map((study) => study.studyInstanceUid)];
    const { token, tokenHash } = createLaunchToken();
    const expiresAt = new Date(Date.now() + configuration.settings.launchTokenTtlSeconds * 1000);
    await createViewerLaunchSession({
      userId: actor.userId, appointmentId, sourcePacsNodeId: configuration.settings.selectedPacsNodeId,
      accessStrategy: configuration.settings.accessStrategy, currentStudyUid: currentStudy.studyInstanceUid,
      permittedStudyUids, tokenHash, expiresAt,
    });
    await auditLaunch(actor, appointmentId, "ready", { priorStudyCount: priors.length, durationMs: Math.round(performance.now() - started) });
    logger.info("viewer_launch_ready", { appointmentId, priorStudyCount: priors.length, durationMs: Math.round(performance.now() - started) });
    return {
      status: "ready", launchUrl: `/api/ohif/launch/${encodeURIComponent(token)}`, openMode: configuration.settings.openMode,
      currentStudy: { studyInstanceUid: currentStudy.studyInstanceUid },
      priorStudies: priors.map(({ studyInstanceUid, studyDate, modality, studyDescription, accessionNumber }) => ({ studyInstanceUid, studyDate, modality, studyDescription, accessionNumber })),
      priorStudyCount: priors.length,
    };
  } catch (error) {
    if (error instanceof ImagingSourceError) {
      await auditLaunch(actor, appointmentId, "source_unavailable", { failureCategory: error.category, durationMs: Math.round(performance.now() - started) });
      recordDiagnosticEvent({ severity: "error", source: "ohif_viewer", component: "imaging_source", operation: "viewer_launch", userId: actor.userId, message: error.message, metadata: { appointmentId, failureCategory: error.category } });
      logger.error("viewer_launch_source_unavailable", { appointmentId, failureCategory: error.category, durationMs: Math.round(performance.now() - started) });
      return { status: "source_unavailable", message: failureMessage("source_unavailable") };
    }
    if (error instanceof HttpError && error.statusCode === 400) {
      await auditLaunch(actor, appointmentId, "configuration_error");
      return { status: "configuration_error", message: error.message };
    }
    await auditLaunch(actor, appointmentId, "failed", { durationMs: Math.round(performance.now() - started) });
    throw error;
  }
}

export async function getRetrievalStatusForDoctor(actor: Actor, jobId: number) {
  const job = await findRetrievalJob(jobId);
  if (!job) throw new HttpError(404, "OHIF retrieval job not found.");
  if (Number(job.requestedByUserId) !== Number(actor.userId)) {
    await getAuthorizedReportingBoardAppointment(actor, job.appointmentId, "You are not allowed to view this OHIF retrieval job.");
  }
  const status = job.status === "available" ? "ready" : job.status === "failed" || job.status === "timed_out" ? "retrieval_failed" : job.status;
  return { status, retrievalJobId: job.id, message: status === "ready" ? "The study is ready." : failureMessage(status as ViewerLaunchResponse["status"]) };
}

export async function exchangeViewerLaunchToken(token: string, userId: UserId, response: ExpressResponse): Promise<string> {
  const tokenHash = hashLaunchToken(token);
  const session = await consumeViewerLaunchToken(tokenHash, userId);
  if (!session) throw new HttpError(404, "Viewer launch session is invalid or expired.");
  response.cookie(env.ohifSessionCookieName, token, {
    httpOnly: true, secure: env.cookieSecure, sameSite: env.cookieSameSite, path: env.ohifDicomWebProxyPath,
    expires: new Date(session.expiresAt),
  });
  const configuration = await readOhifViewerConfiguration();
  const basePath = normalizeViewerBasePath(configuration.settings.ohifPublicBaseUrl, env.ohifPublicBaseUrl);
  const studies = session.permittedStudyUids.map(encodeURIComponent).join(",");
  return `${basePath}/viewer?StudyInstanceUIDs=${studies}`;
}

export async function proxyAuthorizedDicomWebRequest(input: {
  userId: UserId; launchToken: string; relativePathWithQuery: string; headers: Record<string, string>;
}): Promise<globalThis.Response> {
  if (!input.launchToken) throw new HttpError(401, "Viewer session is required.");
  const session = await findAuthorizedViewerSession(hashLaunchToken(input.launchToken), input.userId);
  if (!session) throw new HttpError(401, "Viewer session is invalid or expired.");
  const requested = requestedStudyUids(input.relativePathWithQuery);
  if (requested.length === 0 || requested.some((uid) => !isValidDicomUid(uid) || !session.permittedStudyUids.includes(uid))) {
    await logAuditEntry({ entityType: "ohif_dicomweb", entityId: session.appointmentId, actionType: "viewer_proxy_denied", newValues: { status: "rejected", reason: "study_not_permitted" }, changedByUserId: input.userId });
    throw new HttpError(403, "This DICOMweb request is outside the authorized viewer session.");
  }
  if (session.accessStrategy === "native_dicomweb") {
    const endpoint = await findPacsWebEndpoint(session.sourcePacsNodeId);
    if (!endpoint?.enabled) throw new HttpError(503, "DICOMweb source configuration is unavailable.");
    return proxyNativeDicomWebRequest(endpoint, input.relativePathWithQuery, input.headers);
  }
  return proxyOrthancDicomWebRequest(input.relativePathWithQuery, input.headers);
}

export async function runOhifDiagnostic(value: unknown, actor: Actor) {
  const body = asUnknownRecord(value);
  const action = String(body.action || "").trim();
  const userId = actor.userId;
  const configuration = await readOhifViewerConfiguration();
  if (!configuration.settings.selectedPacsNodeId) throw new HttpError(400, "Select an OHIF PACS source first.");
  const adapter = await createImagingSourceAdapter(configuration);
  const started = performance.now();
  try {
    let result: Record<string, unknown>;
    if (action === "test_ohif_url") {
      const response = await fetch(new URL("/", env.ohifContainerUrl), { signal: AbortSignal.timeout(10_000) });
      if (!response.ok) throw new ImagingSourceError("network", `OHIF URL returned status ${response.status}.`, response.status);
      result = { ok: true, action, message: "OHIF URL is reachable." };
    } else if (action === "test_source") {
      result = { ...(await adapter.testConnection()), action };
    } else if (action === "test_pacs_echo") {
      if (!configuration.selectedPacsNode) throw new HttpError(400, "The selected PACS node is unavailable.");
      await testPacsConnectionWithNode({ node: configuration.selectedPacsNode, currentUserId: userId });
      result = { ok: true, action, message: "PACS C-ECHO succeeded." };
    } else if (action === "test_orthanc_rest" || action === "test_orthanc_dicomweb") {
      const orthanc = await resolveOrthancSettings();
      if (!orthanc.baseUrl) throw new HttpError(400, "Orthanc base URL is not configured.");
      const headers: Record<string, string> = { Accept: "application/json" };
      if (orthanc.username) headers.Authorization = `Basic ${Buffer.from(`${orthanc.username}:${orthanc.password}`).toString("base64")}`;
      const suffix = action === "test_orthanc_rest" ? "/system" : "/dicom-web/studies?limit=1";
      const requestInit: RequestInit & { dispatcher?: unknown } = { headers, signal: AbortSignal.timeout(orthanc.timeoutSeconds * 1000) };
      if (!orthanc.verifyTls && orthanc.baseUrl.toLowerCase().startsWith("https://")) {
        // @ts-ignore undici is present at runtime in this project.
        const undici = await import("undici");
        requestInit.dispatcher = new undici.Agent({ connect: { rejectUnauthorized: false } });
      }
      const response = await fetch(`${orthanc.baseUrl.replace(/\/+$/, "")}${suffix}`, requestInit);
      if (!response.ok) throw new ImagingSourceError(response.status === 401 || response.status === 403 ? "authentication" : "network", `${action === "test_orthanc_rest" ? "Orthanc REST" : "Orthanc DICOMweb"} returned status ${response.status}.`, response.status);
      result = { ok: true, action, message: `${action === "test_orthanc_rest" ? "Orthanc REST" : "Orthanc DICOMweb"} succeeded.` };
    } else if (action === "test_accession") {
      const accessionNumber = String(body.accessionNumber || "").trim();
      if (!accessionNumber) throw new HttpError(400, "accessionNumber is required.");
      const studies = await adapter.searchStudyByAccession(accessionNumber);
      result = { ok: true, action, resultCount: studies.length, message: `Accession search returned ${studies.length} candidate(s).` };
    } else if (action === "test_wado_metadata") {
      const studyInstanceUid = String(body.studyInstanceUid || "").trim();
      if (!isValidDicomUid(studyInstanceUid)) throw new HttpError(400, "A valid studyInstanceUid is required.");
      const metadata = await adapter.getStudyMetadata(studyInstanceUid);
      result = { ok: true, action, metadataItems: Array.isArray(metadata) ? metadata.length : 1, message: "WADO-RS metadata retrieval succeeded." };
    } else if (action === "test_wado_frame") {
      const studyInstanceUid = String(body.studyInstanceUid || "").trim();
      const seriesInstanceUid = String(body.seriesInstanceUid || "").trim();
      const sopInstanceUid = String(body.sopInstanceUid || "").trim();
      if (![studyInstanceUid, seriesInstanceUid, sopInstanceUid].every(isValidDicomUid)) throw new HttpError(400, "Valid study, series, and SOP instance UIDs are required.");
      if (!adapter.testFrameRetrieval) throw new HttpError(400, "Frame retrieval diagnostics are unavailable for this source adapter.");
      const frame = await adapter.testFrameRetrieval(studyInstanceUid, seriesInstanceUid, sopInstanceUid);
      result = { ok: true, action, bytes: frame.bytes, message: "WADO-RS frame retrieval succeeded." };
    } else if (action === "test_full_launch") {
      const appointmentId = nullablePositiveInteger(body.appointmentId, "appointmentId");
      if (!appointmentId) throw new HttpError(400, "appointmentId is required.");
      const launch = await launchReportingBoardCaseInOhif(actor, appointmentId, true);
      if (launch.status !== "ready") throw new HttpError(409, launch.message);
      result = {
        ok: true,
        action,
        status: launch.status,
        priorStudyCount: launch.priorStudyCount,
        message: "Authorized full-launch preparation succeeded.",
      };
    } else {
      throw new HttpError(400, "Unsupported OHIF diagnostic action.");
    }
    await updatePacsWebDiagnostic(configuration.settings.selectedPacsNodeId, {
      lastTestStatus: "success", lastTestMessage: String(result.message || "Diagnostic succeeded."),
      qidoLastStatus: action === "test_source" || action === "test_accession" ? "success" : undefined,
      wadoMetadataLastStatus: action === "test_wado_metadata" ? "success" : undefined,
      wadoFrameLastStatus: action === "test_wado_frame" ? "success" : undefined,
      corsLastStatus: "same_origin_proxy",
    });
    await logAuditEntry({ entityType: "ohif_diagnostic", actionType: action, newValues: { status: "successful", durationMs: Math.round(performance.now() - started) }, changedByUserId: userId });
    return result;
  } catch (error) {
    const message = error instanceof Error ? error.message : "OHIF diagnostic failed.";
    const category = diagnosticFailureCategory(error);
    await updatePacsWebDiagnostic(configuration.settings.selectedPacsNodeId, {
      lastTestStatus: "failed", lastTestMessage: message,
      qidoLastStatus: action === "test_source" || action === "test_accession" ? "failed" : undefined,
      wadoMetadataLastStatus: action === "test_wado_metadata" ? "failed" : undefined,
      wadoFrameLastStatus: action === "test_wado_frame" ? "failed" : undefined,
      authenticationLastStatus: category === "authentication" ? "failed" : undefined,
      tlsLastStatus: category === "tls" ? "failed" : undefined,
    }).catch(() => null);
    await logAuditEntry({ entityType: "ohif_diagnostic", actionType: action || "unknown", newValues: { status: "failed", category }, changedByUserId: userId }).catch(() => null);
    throw error;
  }
}

export async function cleanupOhifState(): Promise<{ sessions: number; jobs: number }> {
  const configuration = await readOhifViewerConfiguration();
  return cleanupExpiredViewerSessionsAndJobs(configuration.settings.cacheRetentionHours);
}
