import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { pool } from "../db/pool.js";
import { formatV2AccessionNumber } from "../modules/appointments-v2/shared/utils/accession.js";
import { verifyPublicCancelToken } from "../modules/appointments-v2/public/utils/public-cancel-token.js";
import { HttpError } from "../utils/http-error.js";
import { getTripoliToday } from "../utils/date.js";
import { uploadDocument } from "./document-service.js";
import { extractRequestScanBarcode, type RequestScanBarcodeFailure } from "./request-scan-barcode-service.js";
import { readPatientQrSettings } from "../modules/appointments-v2/public/utils/patient-qr-settings.js";
import {
  decideRequestScanFilenameEvidence,
  parseRequestScanFilenameIdentifiers,
  requestScanSafeDisplayFilename,
  type RequestScanFilenameDecision,
} from "./request-scan-filename-identifier.js";
import { classifyRequestScanSmbError, downloadRequestScanFile, listRequestScanFiles, moveRequestScanFile } from "./request-scan-smb-service.js";
import { readRequestScanSettings, type RequestScanSettings } from "./request-scan-settings-service.js";
import { logAuditEntry } from "./audit-service.js";
import { claimRequestScanJob, createRequestScanWorkerId, finishRequestScanJob, renewRequestScanLease, updateRequestScanProgress, type RequestScanLease } from "./request-scan-processing-service.js";

export type RequestScanFailureCategory = "recognition" | "identifier_conflict" | "smb_storage" | "source_missing" | "processing_interrupted" | "duplicate_or_existing" | "internal_processing" | "unknown";
export class RequestScanProcessingError extends Error { constructor(message: string, readonly category: RequestScanFailureCategory, options?: ErrorOptions) { super(message, options); } }
export type RequestScanJob = { id: number; filename: string; source_relative_path: string; mime_type: string; status: "pending" | "processing" | "processed" | "duplicate" | "failed"; barcode_value: string | null; appointment_id: number | null; document_id: number | null; error_message: string | null; failure_category?: RequestScanFailureCategory | null; dismissed_at?: string | null; dismissed_by?: number | null; dismiss_reason?: string | null; dismissed_by_name?: string | null; attempt_count: number; created_at: string; updated_at: string; completed_at: string | null; processing_stage?: string | null; processing_started_at?: string | null; stage_started_at?: string | null; heartbeat_at?: string | null; worker_id?: string | null; lease_token?: string | null; lease_expires_at?: string | null; progress_current?: number | null; progress_total?: number | null; recovery_count?: number; patient_name?: string | null; modality_name?: string | null; exam_name?: string | null; accession_number?: string | null };
export type RequestScanJobFilter = "active" | "processed" | "duplicate" | "failed" | "dismissed" | "all";
type EligibleAppointment = { id: number; patient_id: number; accession_number: string };
export type RequestScanServiceDependencies = {
  listRequestScanFiles: typeof listRequestScanFiles;
  downloadRequestScanFile: typeof downloadRequestScanFile;
  extractRequestScanBarcode: typeof extractRequestScanBarcode;
  moveRequestScanFile: typeof moveRequestScanFile;
  uploadDocument: typeof uploadDocument;
  automatedDocumentExists: (appointmentId: number) => Promise<boolean>;
  findEligibleAppointment: (accession: string) => Promise<EligibleAppointment>;
  verifyPublicAppointmentToken: typeof verifyPublicCancelToken;
  logDiagnostic?: (event: string, metadata: Record<string, string | number | boolean>) => void;
};
type RequestScanRetryDependencies = {
  readSettings: typeof readRequestScanSettings;
  getJob: typeof getRequestScanJob;
  moveFile: typeof moveRequestScanFile;
  updateJob: typeof updateJob;
};

const MIME_BY_EXTENSION: Record<string, string> = { ".pdf": "application/pdf", ".jpg": "image/jpeg", ".jpeg": "image/jpeg" };
const errorMessage: Record<RequestScanBarcodeFailure, string> = {
  no_barcode: "No readable appointment barcode was found.",
  no_valid_accession: "A barcode was detected, but it did not contain a valid RISpro accession number.",
  multiple_accessions: "Multiple different appointment barcodes were detected. Assign the document manually.",
  unsupported_file: "Unsupported file",
  corrupt_file: "The barcode could not be processed automatically. Assign the document manually.",
  barcode_decoder_timeout: "The barcode could not be processed automatically. Assign the document manually.",
  barcode_decoder_failed: "The barcode could not be processed automatically. Assign the document manually.",
  pdf_render_failed: "The scanned PDF could not be prepared for barcode recognition. Assign the document manually.",
  image_preprocess_failed: "The barcode could not be processed automatically. Assign the document manually.",
  barcode_processing_failed: "The barcode could not be processed automatically. Assign the document manually.",
};
export function requestScanBarcodeErrorMessage(reason: RequestScanBarcodeFailure): string { return errorMessage[reason]; }
export function requestScanFailureCategory(message: string): RequestScanFailureCategory {
  const value = message.toLowerCase();
  if (value.includes("multiple") || value.includes("conflict") || value.includes("disagreement")) return "identifier_conflict";
  if (value.includes("source scan file could not be found")) return "source_missing";
  if (value.includes("smb") || value.includes("destination") || value.includes("incoming")) return "smb_storage";
  if (value.includes("interrupted repeatedly")) return "processing_interrupted";
  if (value.includes("barcode") || value.includes("identifier") || value.includes("pdf") || value.includes("scan")) return "recognition";
  return "internal_processing";
}
const defaultDependencies: RequestScanServiceDependencies = {
  listRequestScanFiles,
  downloadRequestScanFile,
  extractRequestScanBarcode,
  moveRequestScanFile,
  uploadDocument,
  automatedDocumentExists,
  findEligibleAppointment: findEligibleRequestScanAppointment,
  verifyPublicAppointmentToken: verifyPublicCancelToken,
  logDiagnostic(event, metadata) { console.info("[RequestScanIdentifier]", event, metadata); },
};
function mime(filename: string): string { return MIME_BY_EXTENSION[path.extname(filename).toLowerCase()] || "application/octet-stream"; }
function destination(folder: string, duplicate = false): string { return `${folder.replace(/[\\/]+$/g, "")}\\${duplicate ? "Duplicates\\" : ""}${getTripoliToday()}`; }

export function parseRequestScanJobFilter(value: unknown): RequestScanJobFilter {
  const normalized = value == null || value === "" ? "all" : String(value).toLowerCase();
  if (!["active", "processed", "duplicate", "failed", "dismissed", "all"].includes(normalized)) {
    throw new HttpError(400, "Invalid Request Scan status filter.");
  }
  return normalized as RequestScanJobFilter;
}

export async function listRequestScanJobs(filterInput?: unknown, categoryInput?: unknown): Promise<RequestScanJob[]> {
  const filter = parseRequestScanJobFilter(filterInput);
  const values: unknown[] = [];
  const category = categoryInput == null || categoryInput === "" ? null : String(categoryInput);
  if (category && !["recognition","identifier_conflict","smb_storage","source_missing","processing_interrupted","duplicate_or_existing","internal_processing","unknown"].includes(category)) throw new HttpError(400, "Invalid Request Scan failure category.");
  const where = filter === "active"
    ? "where j.status in ('pending', 'processing')"
    : filter === "all"
      ? ""
      : filter === "dismissed"
        ? "where j.status = 'failed' and j.dismissed_at is not null"
        : filter === "failed"
          ? "where j.status = 'failed' and j.dismissed_at is null"
      : "where j.status = $1";
  if (!["active", "all", "failed", "dismissed"].includes(filter)) values.push(filter);
  const finalWhere = category ? `${where || "where"}${where ? " and" : ""} j.failure_category = $${values.push(category)}` : where;
  const order = filter === "active"
    ? "case when j.status = 'processing' then 0 else 1 end, j.created_at asc, j.id asc"
    : "j.created_at desc, j.id desc";
  const { rows } = await pool.query(`select j.*, u.full_name as dismissed_by_name, ('V2-' || lpad(b.id::text, 6, '0')) as accession_number, coalesce(p.english_full_name, p.arabic_full_name) as patient_name, m.name_en as modality_name, e.name_en as exam_name from request_scan_jobs j left join users u on u.id=j.dismissed_by left join appointments_v2.bookings b on b.id=j.appointment_id left join patients p on p.id=b.patient_id left join modalities m on m.id=b.modality_id left join exam_types e on e.id=b.exam_type_id ${finalWhere} order by ${order} limit 250`, values);
  return rows as RequestScanJob[];
}

export async function getRequestScanJob(id: number): Promise<RequestScanJob> { const { rows } = await pool.query("select * from request_scan_jobs where id=$1", [id]); if (!rows[0]) throw new HttpError(404, "Request scan not found."); return rows[0] as RequestScanJob; }

async function createOrGetJob(filename: string, sourceRelativePath: string): Promise<RequestScanJob> {
  const { rows } = await pool.query(`insert into request_scan_jobs(filename,source_relative_path,mime_type,status) values($1,$2,$3,'pending') on conflict(source_relative_path) do update set filename=excluded.filename,updated_at=now() returning *`, [filename, sourceRelativePath, mime(filename)]);
  return rows[0] as RequestScanJob;
}
async function updateJob(id: number, values: Partial<RequestScanJob>): Promise<RequestScanJob> {
  const names = Object.keys(values); if (!names.length) return getRequestScanJob(id); const params = names.map((name) => (values as Record<string, unknown>)[name]);
  const sets = names.map((name, index) => `${name}=$${index + 1}`).join(", ");
  const { rows } = await pool.query(`update request_scan_jobs set ${sets},updated_at=now() where id=$${params.length + 1} returning *`, [...params, id]); return rows[0] as RequestScanJob;
}
export async function findEligibleRequestScanAppointment(accession: string): Promise<EligibleAppointment> {
  const { rows } = await pool.query<EligibleAppointment>(`select b.id,b.patient_id,('V2-' || lpad(b.id::text,6,'0')) as accession_number from appointments_v2.bookings b where ('V2-' || lpad(b.id::text,6,'0'))=$1 and b.status not in ('cancelled','discontinued','voided')`, [accession]);
  if (!rows.length) throw new HttpError(404, "No eligible appointment matches this accession"); if (rows.length > 1) throw new HttpError(409, "More than one eligible appointment matches this accession"); return rows[0];
}
async function automatedDocumentExists(appointmentId: number): Promise<boolean> { const result = await pool.query("select 1 from documents where v2_booking_id=$1 and document_type='appointment_request' and source='request_scan_automation' limit 1", [appointmentId]); return Boolean(result.rowCount); }
function concise(error: unknown): string { return error instanceof HttpError ? error.message : "Request scan processing failed"; }
function failureCategory(error: unknown): RequestScanFailureCategory { return error instanceof RequestScanProcessingError ? error.category : error instanceof HttpError ? requestScanFailureCategory(error.message) : "internal_processing"; }
async function downloadRequestScanSource(dependencies: RequestScanServiceDependencies, settings: RequestScanSettings, job: RequestScanJob, localPath: string): Promise<void> { try { await dependencies.downloadRequestScanFile(settings, job.source_relative_path, localPath); } catch (error) { const category = classifyRequestScanSmbError(error); throw new RequestScanProcessingError(category === "source_missing" ? "The source scan file could not be found." : "SMB destination operation failed.", category, { cause: error }); } }

type ResolvedFilenameEvidence = {
  decision: RequestScanFilenameDecision;
  appointments: Map<number, EligibleAppointment>;
  accessionCandidateCount: number;
  qrCandidateCount: number;
  verifiedAppointmentCount: number;
  invalidCandidateCount: number;
  unresolvedCandidateCount: number;
};

function identifierMetadata(
  filename: string,
  evidence: ResolvedFilenameEvidence,
  started: number,
  documentFallbackRan: boolean,
  sourcesAgreed: boolean
): Record<string, string | number | boolean> {
  return {
    inputType: path.extname(filename).toLowerCase().replace(".", "") || "unknown",
    accessionCandidateCount: evidence.accessionCandidateCount,
    qrCandidateCount: evidence.qrCandidateCount,
    verifiedAppointmentCount: evidence.verifiedAppointmentCount,
    selectedStrategy: evidence.decision.strategy,
    documentFallbackRan,
    sourcesAgreed,
    elapsedMs: Date.now() - started,
  };
}

function logIdentifier(
  dependencies: RequestScanServiceDependencies,
  code: string,
  metadata: Record<string, string | number | boolean>
): void {
  dependencies.logDiagnostic?.("request_scan_identifier", { code, ...metadata });
}

async function resolveFilenameEvidence(
  filename: string,
  dependencies: RequestScanServiceDependencies
): Promise<ResolvedFilenameEvidence> {
  const parsed = parseRequestScanFilenameIdentifiers(filename);
  const appointments = new Map<number, EligibleAppointment>();
  const verified: Array<{ appointmentId: number; source: "accession" | "qr" }> = [];
  let unresolvedCandidateCount = 0;
  let invalidCandidateCount = parsed.invalidAccessionCount + parsed.invalidQrCount;

  for (const accession of parsed.accessions) {
    try {
      const appointment = await dependencies.findEligibleAppointment(accession);
      appointments.set(Number(appointment.id), appointment);
      verified.push({ appointmentId: Number(appointment.id), source: "accession" });
    } catch {
      unresolvedCandidateCount += 1;
    }
  }
  for (const token of parsed.qrTokens) {
    let bookingId: number;
    try {
      const payload = await dependencies.verifyPublicAppointmentToken(token);
      bookingId = payload.bookingId;
    } catch {
      invalidCandidateCount += 1;
      continue;
    }
    try {
      const appointment = await dependencies.findEligibleAppointment(formatV2AccessionNumber(bookingId));
      appointments.set(Number(appointment.id), appointment);
      verified.push({ appointmentId: Number(appointment.id), source: "qr" });
    } catch {
      unresolvedCandidateCount += 1;
    }
  }

  const decision = decideRequestScanFilenameEvidence({
    accessionCandidateCount: parsed.accessions.length,
    qrCandidateCount: parsed.qrTokens.length,
    invalidCandidateCount,
    unresolvedCandidateCount,
    verified,
  });
  return {
    decision,
    appointments,
    accessionCandidateCount: parsed.accessions.length + parsed.invalidAccessionCount,
    qrCandidateCount: parsed.qrTokens.length + parsed.invalidQrCount,
    verifiedAppointmentCount: new Set(verified.map((candidate) => candidate.appointmentId)).size,
    invalidCandidateCount,
    unresolvedCandidateCount,
  };
}

async function moveOutcome(dependencies: RequestScanServiceDependencies, settings: RequestScanSettings, job: RequestScanJob, folder: string, duplicate = false): Promise<string> { return dependencies.moveRequestScanFile(settings, job.source_relative_path, destination(folder, duplicate), job.filename); }

const requestScanWorkerId = createRequestScanWorkerId();
export async function processRequestScanJob(jobId: number, suppliedSettings?: RequestScanSettings, dependencies: RequestScanServiceDependencies = defaultDependencies, workerId = requestScanWorkerId): Promise<RequestScanJob> {
  const settings = suppliedSettings ?? await readRequestScanSettings();
  const claimed = await claimRequestScanJob(jobId, workerId);
  if (!claimed) return getRequestScanJob(jobId);
  let job = claimed.job; const lease: RequestScanLease = claimed.lease;
  let leaseLost = false;
  const heartbeat = setInterval(() => { void renewRequestScanLease(jobId, lease).then((owned) => { leaseLost ||= !owned; }); }, 12_000);
  const stage = async (value: Parameters<typeof updateRequestScanProgress>[2]) => { if (leaseLost || !(await updateRequestScanProgress(jobId, lease, value))) { leaseLost = true; throw new HttpError(409, "Request Scan lease was lost."); } };
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "rispro-request-scan-file-")); const localPath = path.join(tempDir, job.filename);
  const identifierStarted = Date.now();
  try {
    await stage({ stage: "checking_filename" });
    const filenameEvidence = await resolveFilenameEvidence(job.filename, dependencies);
    const baseMetadata = () => identifierMetadata(job.filename, filenameEvidence, identifierStarted, false, false);
    let appointment: EligibleAppointment;

    if (filenameEvidence.decision.kind === "conflict") {
      logIdentifier(dependencies, "IDENTIFIER_FILENAME_CONFLICT", baseMetadata());
      throw new HttpError(422, "The filename contains conflicting appointment information. Assign the document manually.");
    }

    if (filenameEvidence.decision.kind === "success") {
      appointment = filenameEvidence.appointments.get(filenameEvidence.decision.appointmentId)!;
      const code = filenameEvidence.decision.strategy === "filename_accession"
        ? "IDENTIFIER_SUCCESS_FILENAME_ACCESSION"
        : filenameEvidence.decision.strategy === "filename_qr"
          ? "IDENTIFIER_SUCCESS_FILENAME_QR"
          : "IDENTIFIER_SUCCESS_FILENAME_CONSENSUS";
      logIdentifier(dependencies, code, { ...baseMetadata(), sourcesAgreed: true });
      await stage({ stage: "downloading" }); await downloadRequestScanSource(dependencies, settings, job, localPath);
    } else {
      const initialCode = filenameEvidence.accessionCandidateCount + filenameEvidence.qrCandidateCount === 0
        ? "IDENTIFIER_FILENAME_NOT_FOUND"
        : filenameEvidence.invalidCandidateCount > 0
          ? "IDENTIFIER_FILENAME_INVALID"
          : "IDENTIFIER_FILENAME_UNRESOLVED";
      logIdentifier(dependencies, initialCode, baseMetadata());
      logIdentifier(dependencies, "IDENTIFIER_FALLBACK_DOCUMENT_SCAN", {
        ...identifierMetadata(job.filename, filenameEvidence, identifierStarted, true, false),
      });
      await stage({ stage: "downloading" }); await downloadRequestScanSource(dependencies, settings, job, localPath);
      const patientQrSettings = await readPatientQrSettings();
      await stage({ stage: "verifying_identifier" }); const barcode = await dependencies.extractRequestScanBarcode(localPath, undefined, {
        risproPublicBaseUrl: patientQrSettings.risproPublicBaseUrl,
        onProgress: (processingStage, current, total) => stage({ stage: processingStage, current, total }),
      });
      if (!barcode.ok) {
        if (barcode.ignoredQrCount) {
          logIdentifier(dependencies, "IDENTIFIER_DOCUMENT_QR_IGNORED", {
            ...identifierMetadata(job.filename, filenameEvidence, identifierStarted, true, false),
            ignoredQrCount: barcode.ignoredQrCount,
          });
        }
        if (barcode.reason === "multiple_accessions") {
          logIdentifier(dependencies, "IDENTIFIER_DOCUMENT_CONFLICT", {
            ...identifierMetadata(job.filename, filenameEvidence, identifierStarted, true, false),
          });
          throw new HttpError(422, "Multiple different appointment barcodes were detected. Assign the document manually.");
        }
        if (barcode.reason === "no_barcode" || barcode.reason === "no_valid_accession") {
          throw new HttpError(422, "No valid appointment identifier could be confirmed. Assign the document manually.");
        }
        throw new HttpError(422, requestScanBarcodeErrorMessage(barcode.reason));
      }

      if (barcode.ignoredQrCount) {
        logIdentifier(dependencies, "IDENTIFIER_DOCUMENT_QR_IGNORED", {
          ...identifierMetadata(job.filename, filenameEvidence, identifierStarted, true, false),
          ignoredQrCount: barcode.ignoredQrCount,
        });
      }
      const documentAppointments = new Map<number, EligibleAppointment>();
      const documentSources: Array<{ appointmentId: number; source: "accession" | "qr" }> = [];
      if (barcode.accession) {
        try {
          const accessionAppointment = await dependencies.findEligibleAppointment(barcode.accession);
          documentAppointments.set(Number(accessionAppointment.id), accessionAppointment);
          documentSources.push({ appointmentId: Number(accessionAppointment.id), source: "accession" });
        } catch {
          // An unresolved accession is not authoritative evidence.
        }
      }
      let invalidQrCount = 0;
      for (const token of barcode.qrTokens ?? []) {
        let bookingId: number;
        try {
          const payload = await dependencies.verifyPublicAppointmentToken(token);
          bookingId = payload.bookingId;
        } catch {
          invalidQrCount += 1;
          continue;
        }
        try {
          const qrAppointment = await dependencies.findEligibleAppointment(formatV2AccessionNumber(bookingId));
          documentAppointments.set(Number(qrAppointment.id), qrAppointment);
          documentSources.push({ appointmentId: Number(qrAppointment.id), source: "qr" });
        } catch {
          invalidQrCount += 1;
        }
      }
      if (invalidQrCount) {
        logIdentifier(dependencies, "IDENTIFIER_DOCUMENT_QR_INVALID", {
          ...identifierMetadata(job.filename, filenameEvidence, identifierStarted, true, false),
          qrCandidateCount: barcode.qrTokens?.length ?? 0,
          invalidQrCount,
        });
      }

      const documentAppointmentIds = [...documentAppointments.keys()];
      if (documentAppointmentIds.length > 1) {
        logIdentifier(dependencies, "IDENTIFIER_DOCUMENT_CONFLICT", {
          ...identifierMetadata(job.filename, filenameEvidence, identifierStarted, true, false),
          documentAccessionCandidateCount: barcode.accession ? 1 : 0,
          documentQrCandidateCount: barcode.qrTokens?.length ?? 0,
        });
        throw new HttpError(422, "The scanned document contains conflicting appointment information. Assign the document manually.");
      }
      if (documentAppointmentIds.length === 0) {
        throw new HttpError(422, "No valid appointment identifier could be confirmed. Assign the document manually.");
      }
      const documentAppointment = documentAppointments.get(documentAppointmentIds[0])!;
      const documentSourceKinds = new Set(documentSources.map((source) => source.source));
      const documentSuccessCode = documentSourceKinds.size > 1
        ? "IDENTIFIER_SUCCESS_DOCUMENT_CONSENSUS"
        : documentSourceKinds.has("qr")
          ? "IDENTIFIER_SUCCESS_DOCUMENT_QR"
          : "IDENTIFIER_SUCCESS_DOCUMENT_ACCESSION";
      logIdentifier(dependencies, documentSuccessCode, {
        ...identifierMetadata(job.filename, filenameEvidence, identifierStarted, true, true),
        documentAccessionCandidateCount: barcode.accession ? 1 : 0,
        documentQrCandidateCount: barcode.qrTokens?.length ?? 0,
      });

      const verifiedFilenameAppointmentId = filenameEvidence.decision.kind === "partial"
        ? filenameEvidence.decision.appointmentId
        : null;
      if (verifiedFilenameAppointmentId != null && verifiedFilenameAppointmentId !== Number(documentAppointment.id)) {
        logIdentifier(dependencies, "IDENTIFIER_DOCUMENT_CONFLICT", {
          ...identifierMetadata(job.filename, filenameEvidence, identifierStarted, true, false),
        });
        throw new HttpError(422, "The filename and scanned barcode identify different appointments. Assign the document manually.");
      }
      appointment = documentAppointment;
      if (verifiedFilenameAppointmentId != null) {
        logIdentifier(dependencies, "IDENTIFIER_DOCUMENT_CONFIRMATION", {
          ...identifierMetadata(job.filename, filenameEvidence, identifierStarted, true, true),
        });
      }
    }

    await stage({ stage: "checking_duplicate" }); if (await dependencies.automatedDocumentExists(appointment.id)) {
      const moved = await moveOutcome(dependencies, settings, job, settings.processedSubfolder, true);
      const completed = await finishRequestScanJob(job.id, lease, { status: "duplicate", barcode_value: appointment.accession_number, appointment_id: appointment.id, source_relative_path: moved, error_message: null, completed_at: new Date().toISOString() }); if (!completed) throw new HttpError(409, "Request Scan lease was lost."); return completed;
    }
    await stage({ stage: "attaching_document" }); const buffer = await fs.readFile(localPath);
    const document = await dependencies.uploadDocument({ patientId: appointment.patient_id, appointmentId: appointment.id, appointmentRefType: "v2_booking", documentType: "appointment_request", originalFilename: job.filename, mimeType: job.mime_type, fileContentBuffer: buffer, source: "request_scan_automation" }, null);
    await stage({ stage: "moving_file" }); const moved = await moveOutcome(dependencies, settings, job, settings.processedSubfolder);
    const completed = await finishRequestScanJob(job.id, lease, { status: "processed", barcode_value: appointment.accession_number, appointment_id: appointment.id, document_id: document.id, source_relative_path: moved, error_message: null, completed_at: new Date().toISOString() }); if (!completed) throw new HttpError(409, "Request Scan lease was lost."); return completed;
  } catch (error) {
    const category = failureCategory(error); const message = error instanceof RequestScanProcessingError ? error.message : concise(error); let moved = job.source_relative_path;
    try { moved = await moveOutcome(dependencies, settings, job, settings.failedSubfolder); } catch { /* keep the original path so recovery can retry it */ }
    if (leaseLost) return getRequestScanJob(job.id);
    return (await finishRequestScanJob(job.id, lease, { status: "failed", source_relative_path: moved, error_message: message, failure_category: category, completed_at: new Date().toISOString() })) ?? getRequestScanJob(job.id);
  } finally { clearInterval(heartbeat); await fs.rm(tempDir, { recursive: true, force: true }); }
}

export type RequestScanCycleResult = { discovered: number; processed: number; failed: number; duplicates: number; skipped: number };
const REQUEST_SCAN_MAX_JOBS_PER_CYCLE = 100;
async function nextPendingRequestScanJob(): Promise<RequestScanJob | null> { const { rows } = await pool.query("select * from request_scan_jobs where status='pending' order by priority_requested_at asc nulls last,created_at asc,id asc limit 1"); return rows[0] as RequestScanJob | undefined ?? null; }
export async function prioritizePendingRequestScanJob(id: number): Promise<RequestScanJob> { const { rows } = await pool.query("update request_scan_jobs set priority_requested_at=coalesce(priority_requested_at,now()),updated_at=now() where id=$1 and status='pending' returning *", [id]); if (rows[0]) return rows[0] as RequestScanJob; const job = await getRequestScanJob(id); if (job.status !== "pending") throw new HttpError(409, "Only queued request scans can be started."); throw new HttpError(404, "Request scan not found."); }
async function drainPendingRequestScanJobs(settings: RequestScanSettings, dependencies: RequestScanServiceDependencies, result: RequestScanCycleResult, limit: number): Promise<number> { let count = 0; for (; count < limit; count += 1) { const job = await nextPendingRequestScanJob(); if (!job) break; const completed = await processRequestScanJob(job.id, settings, dependencies); if (completed.status === "processed") result.processed += 1; else if (completed.status === "duplicate") result.duplicates += 1; else if (completed.status === "failed") result.failed += 1; else result.skipped += 1; } return count; }

export async function runRequestScanCycle(suppliedSettings?: RequestScanSettings, dependencies: RequestScanServiceDependencies = defaultDependencies): Promise<RequestScanCycleResult> {
  const settings = suppliedSettings ?? await readRequestScanSettings(); if (!settings.enabled) return { discovered: 0, processed: 0, failed: 0, duplicates: 0, skipped: 0 };
  const result: RequestScanCycleResult = { discovered: 0, processed: 0, failed: 0, duplicates: 0, skipped: 0 }; const queuedAtStart = await drainPendingRequestScanJobs(settings, dependencies, result, REQUEST_SCAN_MAX_JOBS_PER_CYCLE);
  const files = await dependencies.listRequestScanFiles(settings); result.discovered = files.length;
  for (const file of files) {
    if (file.modifiedAt && Date.now() - file.modifiedAt.getTime() < settings.fileReadyDelaySeconds * 1000) { result.skipped += 1; continue; }
    const job = await createOrGetJob(file.filename, file.relativePath); if (job.status !== "pending") result.skipped += 1;
  }
  await drainPendingRequestScanJobs(settings, dependencies, result, REQUEST_SCAN_MAX_JOBS_PER_CYCLE - queuedAtStart);
  return result;
}

const pendingRetryFields = { status: "pending" as const, error_message: null, failure_category: null, dismissed_at: null, dismissed_by: null, dismiss_reason: null, completed_at: null, processing_stage: "queued", processing_started_at: null, heartbeat_at: null, worker_id: null, lease_token: null, lease_expires_at: null, progress_current: null, progress_total: null };
export async function retryRequestScanJob(id: number, overrides: Partial<RequestScanRetryDependencies> = {}): Promise<RequestScanJob> { const dependencies: RequestScanRetryDependencies = { readSettings: readRequestScanSettings, getJob: getRequestScanJob, moveFile: moveRequestScanFile, updateJob, ...overrides }; const settings = await dependencies.readSettings(); const job = await dependencies.getJob(id); if (job.status !== "failed" || job.dismissed_at) throw new HttpError(409, "Only visible failed request scans can be retried."); const moved = await dependencies.moveFile(settings, job.source_relative_path, settings.incomingSubfolder, job.filename); return dependencies.updateJob(id, { ...pendingRetryFields, source_relative_path: moved, stage_started_at: new Date().toISOString() }); }
function cleanDismissReason(value: unknown): string | null { const reason = String(value ?? "").trim(); if (reason.length > 500) throw new HttpError(400, "Dismiss reason must be 500 characters or fewer."); return reason || null; }
export async function dismissRequestScanJob(id: number, userId: number, reason?: unknown): Promise<RequestScanJob> { const { rows } = await pool.query("update request_scan_jobs set dismissed_at=now(),dismissed_by=$2,dismiss_reason=$3,updated_at=now() where id=$1 and status='failed' and dismissed_at is null returning *", [id, userId, cleanDismissReason(reason)]); if (!rows[0]) throw new HttpError(409, "Only visible failed request scans can be dismissed."); const job = rows[0] as RequestScanJob; await logAuditEntry({ entityType: "request_scan_job", entityId: id, actionType: "request_scan_dismissed", newValues: { failure_category: job.failure_category }, changedByUserId: userId }); return job; }
export async function restoreDismissedRequestScanJob(id: number, userId: number): Promise<RequestScanJob> { const { rows } = await pool.query("update request_scan_jobs set dismissed_at=null,dismissed_by=null,dismiss_reason=null,updated_at=now() where id=$1 and status='failed' and dismissed_at is not null returning *", [id]); if (!rows[0]) throw new HttpError(409, "Only dismissed failed request scans can be restored."); const job = rows[0] as RequestScanJob; await logAuditEntry({ entityType: "request_scan_job", entityId: id, actionType: "request_scan_restored", newValues: { failure_category: job.failure_category }, changedByUserId: userId }); return job; }
export async function bulkDismissRequestScanJobs(ids: number[], userId: number, reason?: unknown): Promise<RequestScanJob[]> { const unique = [...new Set(ids)]; if (!unique.length || unique.length > 50) throw new HttpError(400, "Select between 1 and 50 request scans."); const clean = cleanDismissReason(reason); const client = await pool.connect(); try { await client.query("begin"); const locked = await client.query("select id from request_scan_jobs where id=any($1::bigint[]) and status='failed' and dismissed_at is null for update", [unique]); if (locked.rows.length !== unique.length) throw new HttpError(409, "All selected jobs must be visible failed request scans."); const { rows } = await client.query("update request_scan_jobs set dismissed_at=now(),dismissed_by=$2,dismiss_reason=$3,updated_at=now() where id=any($1::bigint[]) returning *", [unique, userId, clean]); await client.query("commit"); await logAuditEntry({ entityType: "request_scan_job", actionType: "request_scan_bulk_dismissed", newValues: { count: rows.length }, changedByUserId: userId }); return rows as RequestScanJob[]; } catch (error) { await client.query("rollback"); throw error; } finally { client.release(); } }
export async function bulkRetryRequestScanJobs(ids: number[]): Promise<{ requestedCount: number; queued: RequestScanJob[]; failed: Array<{ id: number; message: string }> }> { const unique = [...new Set(ids)]; if (!unique.length || unique.length > 50) throw new HttpError(400, "Select between 1 and 50 request scans."); const queued: RequestScanJob[] = []; const failed: Array<{ id: number; message: string }> = []; for (const id of unique) { try { queued.push(await retryRequestScanJob(id)); } catch { failed.push({ id, message: "The source scan file could not be returned to Incoming." }); } } return { requestedCount: unique.length, queued, failed }; }
export async function auditBulkRequestScanRetry(result: { requestedCount: number; queued: RequestScanJob[]; failed: Array<{ id: number }> }, userId: number, triggerStatus: "accepted" | "already_running" | "disabled" | "not_triggered"): Promise<void> { await logAuditEntry({ entityType: "request_scan_job", actionType: "request_scan_bulk_retried", newValues: { requestedCount: result.requestedCount, queuedCount: result.queued.length, failedCount: result.failed.length, triggerStatus }, changedByUserId: userId }); }
export async function returnRequestScanToIncoming(id: number): Promise<RequestScanJob> { const settings = await readRequestScanSettings(); const job = await getRequestScanJob(id); if (job.status !== "failed" || job.dismissed_at) throw new HttpError(409, "Only visible failed request scans can be returned."); const moved = await moveRequestScanFile(settings, job.source_relative_path, settings.incomingSubfolder, job.filename); return updateJob(id, { ...pendingRetryFields, source_relative_path: moved, stage_started_at: new Date().toISOString() }); }
export async function manuallyAssignRequestScan(id: number, appointmentId: number, userId: number, suppliedSettings?: RequestScanSettings, dependencies: RequestScanServiceDependencies = defaultDependencies): Promise<RequestScanJob> { const settings = suppliedSettings ?? await readRequestScanSettings(); const job = await getRequestScanJob(id); if (job.status !== "failed" || job.dismissed_at) throw new HttpError(409, "Restore this dismissed request scan before manual assignment."); const appointment = await findEligibleRequestScanAppointment(`V2-${String(appointmentId).padStart(6, "0")}`); const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "rispro-request-scan-manual-")); try { const localPath = path.join(tempDir, job.filename); await dependencies.downloadRequestScanFile(settings, job.source_relative_path, localPath); const document = await dependencies.uploadDocument({ patientId: appointment.patient_id, appointmentId: appointment.id, appointmentRefType: "v2_booking", documentType: "appointment_request", originalFilename: job.filename, mimeType: job.mime_type, fileContentBuffer: await fs.readFile(localPath), source: "request_scan_automation" }, userId); const moved = await moveOutcome(dependencies, settings, job, settings.processedSubfolder); return updateJob(id, { status: "processed", appointment_id: appointment.id, document_id: document.id, source_relative_path: moved, error_message: null, completed_at: new Date().toISOString() }); } finally { await fs.rm(tempDir, { recursive: true, force: true }); } }
export async function downloadRequestScanJobFile(id: number): Promise<{ job: RequestScanJob; buffer: Buffer }> { const settings = await readRequestScanSettings(); const job = await getRequestScanJob(id); const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "rispro-request-scan-preview-")); try { const localPath = path.join(tempDir, job.filename); await downloadRequestScanFile(settings, job.source_relative_path, localPath); return { job, buffer: await fs.readFile(localPath) }; } finally { await fs.rm(tempDir, { recursive: true, force: true }); } }

export function withSafeRequestScanFilename<T extends Pick<RequestScanJob, "filename">>(job: T): T {
  const safe = { ...job, filename: requestScanSafeDisplayFilename(job.filename) } as T & { source_relative_path?: unknown };
  delete safe.source_relative_path;
  return safe;
}
