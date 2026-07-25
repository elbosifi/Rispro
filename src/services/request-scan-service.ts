import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { pool } from "../db/pool.js";
import { formatV2AccessionNumber } from "../modules/appointments-v2/shared/utils/accession.js";
import { HttpError } from "../utils/http-error.js";
import { getTripoliToday } from "../utils/date.js";
import { findDocumentByIdempotencyKey, getDocumentAbsolutePath, getDocumentById, uploadDocument, uploadDocumentIdempotently, upsertDocumentAppointmentLinks } from "./document-service.js";
import { extractRequestScanBarcode, type RequestScanBarcodeFailure } from "./request-scan-barcode-service.js";
import { readPatientQrSettings } from "../modules/appointments-v2/public/utils/patient-qr-settings.js";
import {
  decideRequestScanFilenameEvidence,
  parseRequestScanFilenameIdentifiers,
  requestScanSafeDisplayFilename,
  type RequestScanFilenameDecision,
} from "./request-scan-filename-identifier.js";
import { classifyRequestScanSmbError, downloadRequestScanFile, listRequestScanFiles, moveRequestScanFile, reconcileRequestScanMove, requestScanArchivePath, validateRequestScanRemoteFilename } from "./request-scan-smb-service.js";
import { readRequestScanSettings, type RequestScanSettings } from "./request-scan-settings-service.js";
import { logAuditEntry } from "./audit-service.js";
import { env } from "../config/env.js";
import { assertRequestScanLeaseOwned, beginRequestScanArchive, beginRequestScanAttachment, checkpointRequestScanJobAppointments, claimNextRequestScanJob, claimRequestScanJob, createRequestScanWorkerId, finishRequestScanJob, linkRequestScanDocumentAppointments, loadRequestScanJobAppointments, renewRequestScanLeaseExecutionState, RequestScanCancellationRequestedError, RequestScanLeaseLostError, updateRequestScanCheckpoint, updateRequestScanProgress, type ClaimedRequestScanJob, type RequestScanJobAppointmentCheckpoint, type RequestScanLease } from "./request-scan-processing-service.js";
import { createRequestScanProgressCoalescer } from "./request-scan-progress-coalescer.js";
import { requestRequestScanWorkerRun } from "./request-scan-worker-control-service.js";
import { resolveRequestScanAppointmentToken } from "./request-scan-appointment-token-service.js";

export type RequestScanFailureCategory = "recognition" | "identifier_conflict" | "smb_storage" | "source_missing" | "processing_interrupted" | "duplicate_or_existing" | "internal_processing" | "unknown";
export class RequestScanProcessingError extends Error { constructor(message: string, readonly category: RequestScanFailureCategory, options?: ErrorOptions) { super(message, options); } }
export type RequestScanMatchedAppointment = { id: number; accessionNumber: string; patientId: number; modality?: string; examination?: string };
export type RequestScanJob = { id: number; filename: string; source_relative_path: string; mime_type: string; status: "pending" | "processing" | "processed" | "duplicate" | "failed"; barcode_value: string | null; appointment_id: number | null; document_id: number | null; manual_assignment_requested_at?: string | null; manual_assignment_requested_by?: number | null; manual_assignment_confirmed_at?: string | null; manual_assignment_appointment_id?: number | null; matchedAppointments?: RequestScanMatchedAppointment[]; identifier_verified_at?: string | null; identifier_strategy?: string | null; attachment_completed_at?: string | null; attachment_created?: boolean | null; intended_destination_path?: string | null; source_moved_at?: string | null; archive_attempt_count?: number; last_archive_attempt_at?: string | null; archive_last_error?: string | null; archive_next_retry_at?: string | null; return_requested_at?: string | null; return_source_path?: string | null; return_destination_path?: string | null; return_completed_at?: string | null; cancel_requested_at?: string | null; cancel_requested_by?: number | null; cancel_reason?: string | null; error_message: string | null; failure_category?: RequestScanFailureCategory | null; dismissed_at?: string | null; dismissed_by?: number | null; dismiss_reason?: string | null; dismissed_by_name?: string | null; attempt_count: number; created_at: string; updated_at: string; completed_at: string | null; processing_stage?: string | null; processing_started_at?: string | null; stage_started_at?: string | null; heartbeat_at?: string | null; worker_id?: string | null; lease_token?: string | null; lease_expires_at?: string | null; progress_current?: number | null; progress_total?: number | null; recovery_count?: number; patient_name?: string | null; patient_name_ar?: string | null; patient_name_en?: string | null; patient_mrn?: string | null; patient_date_of_birth?: string | null; modality_name?: string | null; modality_name_ar?: string | null; modality_name_en?: string | null; exam_name?: string | null; exam_name_ar?: string | null; exam_name_en?: string | null; appointment_date?: string | null; accession_number?: string | null };
export type RequestScanJobFilter = "active" | "processed" | "duplicate" | "failed" | "dismissed" | "all";
type EligibleAppointment = { id: number; patient_id: number; accession_number: string };
export type RequestScanServiceDependencies = {
  listRequestScanFiles: typeof listRequestScanFiles;
  downloadRequestScanFile: typeof downloadRequestScanFile;
  extractRequestScanBarcode: typeof extractRequestScanBarcode;
  moveRequestScanFile: typeof moveRequestScanFile;
  reconcileRequestScanMove?: typeof reconcileRequestScanMove;
  uploadDocument: typeof uploadDocument;
  uploadDocumentIdempotently?: typeof uploadDocumentIdempotently;
  findDocumentByIdempotencyKey?: typeof findDocumentByIdempotencyKey;
  upsertDocumentAppointmentLinks?: typeof upsertDocumentAppointmentLinks;
  automatedDocumentExists: (appointmentId: number) => Promise<boolean>;
  findEligibleAppointment: (accession: string) => Promise<EligibleAppointment>;
  verifyPublicAppointmentToken: (token: string) => Promise<{ bookingId: number }>;
  logDiagnostic?: (event: string, metadata: Record<string, string | number | boolean>) => void;
};
export type RequestScanCycleOptions = { maxConcurrency?: 1 | 2; shouldContinue?: () => boolean };
type RequestScanRetryDependencies = {
  readSettings: typeof readRequestScanSettings;
  getJob: typeof getRequestScanJob;
  moveFile: typeof moveRequestScanFile;
  updateJob: typeof updateJob;
};
type RequestScanReturnDependencies = {
  readSettings: typeof readRequestScanSettings;
  reconcileMove: typeof reconcileRequestScanMove;
  triggerWorker: typeof requestRequestScanWorkerRun;
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
  reconcileRequestScanMove,
  uploadDocument,
  uploadDocumentIdempotently,
  findDocumentByIdempotencyKey,
  upsertDocumentAppointmentLinks,
  automatedDocumentExists,
  findEligibleAppointment: findRequestScanAppointment,
  verifyPublicAppointmentToken: resolveRequestScanAppointmentToken,
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
  const { rows } = await pool.query(`select j.*, u.full_name as dismissed_by_name, ('V2-' || lpad(b.id::text, 6, '0')) as accession_number, coalesce(p.english_full_name, p.arabic_full_name) as patient_name, p.arabic_full_name as patient_name_ar, p.english_full_name as patient_name_en, p.mrn as patient_mrn, p.estimated_date_of_birth as patient_date_of_birth, m.name_en as modality_name, m.name_ar as modality_name_ar, m.name_en as modality_name_en, e.name_en as exam_name, e.name_ar as exam_name_ar, e.name_en as exam_name_en, b.booking_date as appointment_date from request_scan_jobs j left join users u on u.id=j.dismissed_by left join appointments_v2.bookings b on b.id=j.appointment_id left join patients p on p.id=b.patient_id left join modalities m on m.id=b.modality_id left join exam_types e on e.id=b.exam_type_id ${finalWhere} order by ${order} limit 250`, values);
  return hydrateMatchedAppointments(rows as RequestScanJob[]);
}

async function hydrateMatchedAppointments(jobs: RequestScanJob[]): Promise<RequestScanJob[]> {
  if (!jobs.length) return jobs;
  const { rows } = await pool.query<{ request_scan_job_id: number; id: number; patient_id: number; accession_number: string; modality: string | null; examination: string | null }>(
    `select link.request_scan_job_id,b.id,b.patient_id,('V2-' || lpad(b.id::text,6,'0')) accession_number,m.name_en modality,e.name_en examination
     from request_scan_job_appointments link
     join appointments_v2.bookings b on b.id=link.appointment_id
     left join modalities m on m.id=b.modality_id
     left join exam_types e on e.id=b.exam_type_id
     where link.request_scan_job_id=any($1::bigint[])
     order by link.request_scan_job_id,b.id`,
    [jobs.map(({ id }) => Number(id))],
  );
  const matches = new Map<number, RequestScanMatchedAppointment[]>();
  for (const row of rows) {
    const values = matches.get(Number(row.request_scan_job_id)) ?? [];
    values.push({ id: Number(row.id), accessionNumber: row.accession_number, patientId: Number(row.patient_id), ...(row.modality ? { modality: row.modality } : {}), ...(row.examination ? { examination: row.examination } : {}) });
    matches.set(Number(row.request_scan_job_id), values);
  }
  return jobs.map((job) => ({ ...job, matchedAppointments: matches.get(Number(job.id)) ?? [] }));
}

export async function getRequestScanJob(id: number): Promise<RequestScanJob> { const { rows } = await pool.query("select * from request_scan_jobs where id=$1", [id]); if (!rows[0]) throw new HttpError(404, "Request scan not found."); return (await hydrateMatchedAppointments([rows[0] as RequestScanJob]))[0]!; }

const INCOMING_ORPHAN_CONFLICT_MESSAGE = "An Incoming file is owned by a terminal Request Scan row without a completed Return checkpoint. Manual reconciliation is required.";
const ARCHIVE_PENDING_MESSAGE = "Document attached successfully. Archive movement is pending.";
export type IncomingReconciliation = { job: RequestScanJob; outcome: "active" | "created" | "reactivated" | "archive_pending" | "orphan_conflict" };
export async function reconcileIncomingRequestScanFile(filename: string, sourceRelativePath: string): Promise<IncomingReconciliation> {
  const client = await pool.connect();
  try {
    await client.query("begin");
    const owned = await client.query<RequestScanJob>(`select * from request_scan_jobs where source_relative_path=$1 or (return_destination_path=$1 and return_requested_at is not null) order by case when source_relative_path=$1 then 0 else 1 end,id for update`, [sourceRelativePath]);
    const active = owned.rows.find((row) => row.status === "pending" || row.status === "processing");
    if (active) { await client.query("commit"); return { job: active, outcome: "active" }; }
    const attached = owned.rows.find((row) => row.document_id != null && row.attachment_completed_at != null);
    if (attached) {
      if (attached.error_message === INCOMING_ORPHAN_CONFLICT_MESSAGE && attached.failure_category === "internal_processing") {
        const { rows } = await client.query<RequestScanJob>("update request_scan_jobs set error_message=$2,failure_category='smb_storage',updated_at=now() where id=$1 returning *", [attached.id, ARCHIVE_PENDING_MESSAGE]);
        await client.query("commit"); return { job: rows[0]!, outcome: "archive_pending" };
      }
      await client.query("commit"); return { job: attached, outcome: "archive_pending" };
    }
    const returned = owned.rows.find((row) => row.return_requested_at && (row.return_completed_at || row.return_destination_path === sourceRelativePath));
    if (returned) {
      const { rows } = await client.query<RequestScanJob>(`update request_scan_jobs set filename=$2,source_relative_path=$3,status='pending',return_completed_at=coalesce(return_completed_at,now()),error_message=null,failure_category=null,dismissed_at=null,dismissed_by=null,dismiss_reason=null,cancel_requested_at=null,cancel_requested_by=null,cancel_reason=null,completed_at=null,processing_stage='queued',processing_started_at=null,stage_started_at=now(),heartbeat_at=null,worker_id=null,lease_token=null,lease_expires_at=null,progress_current=null,progress_total=null,updated_at=now() where id=$1 returning *`, [returned.id, filename, sourceRelativePath]);
      await client.query("commit"); return { job: rows[0]!, outcome: "reactivated" };
    }
    if (owned.rows[0]) {
      const { rows } = await client.query<RequestScanJob>(`update request_scan_jobs set status='failed',error_message=$2,failure_category='internal_processing',dismissed_at=null,dismissed_by=null,dismiss_reason=null,updated_at=now() where id=$1 returning *`, [owned.rows[0].id, INCOMING_ORPHAN_CONFLICT_MESSAGE]);
      await client.query("commit"); return { job: rows[0]!, outcome: "orphan_conflict" };
    }
    const { rows } = await client.query<RequestScanJob>(`insert into request_scan_jobs(filename,source_relative_path,mime_type,status) values($1,$2,$3,'pending') returning *`, [filename, sourceRelativePath, mime(filename)]);
    await client.query("commit"); return { job: rows[0]!, outcome: "created" };
  } catch (error) {
    await client.query("rollback");
    if ((error as { code?: string }).code === "23505") {
      const { rows } = await pool.query<RequestScanJob>("select * from request_scan_jobs where source_relative_path=$1", [sourceRelativePath]);
      if (rows[0]) {
        const job = rows[0];
        if (job.status === "pending" || job.status === "processing") return { job, outcome: "active" };
        if (job.document_id != null && job.attachment_completed_at != null) return { job, outcome: "archive_pending" };
        return { job, outcome: "orphan_conflict" };
      }
    }
    throw error;
  } finally { client.release(); }
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
export async function findRequestScanAppointment(accession: string): Promise<EligibleAppointment> {
  const { rows } = await pool.query<EligibleAppointment>(`select b.id,b.patient_id,('V2-' || lpad(b.id::text,6,'0')) as accession_number from appointments_v2.bookings b where ('V2-' || lpad(b.id::text,6,'0'))=$1`, [accession]);
  if (!rows.length) throw new HttpError(404, "No appointment matches this accession");
  return { ...rows[0]!, id: Number(rows[0]!.id), patient_id: Number(rows[0]!.patient_id) };
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

async function archiveCheckpointedRequestScanJob(job: RequestScanJob, lease: RequestScanLease, settings: RequestScanSettings, dependencies: RequestScanServiceDependencies, created: boolean): Promise<RequestScanJob> {
  const folder = destination(settings.processedSubfolder, !created);
  const intended = job.intended_destination_path || requestScanArchivePath(folder, Number(job.id), job.filename);
  if (!job.intended_destination_path) job = await updateRequestScanCheckpoint(job.id, lease, { intended_destination_path: intended });
  await assertRequestScanLeaseOwned(job.id, lease);
  if (!job.source_moved_at) {
    job = await beginRequestScanArchive(job.id, lease);
    const outcome = dependencies.reconcileRequestScanMove ? await dependencies.reconcileRequestScanMove(settings, job.source_relative_path, intended, undefined, { jobId: job.id, logDiagnostic: dependencies.logDiagnostic }) : "moved";
    if (!dependencies.reconcileRequestScanMove) await dependencies.moveRequestScanFile(settings, job.source_relative_path, folder, requestScanArchivePath("", Number(job.id), job.filename));
    if (outcome === "conflict") throw new RequestScanProcessingError("The Incoming file and archived file have the same job destination but different contents. Both files were preserved for manual review.", "smb_storage");
    if (outcome === "missing") throw new RequestScanProcessingError("The Request Scan source and archive destination are both missing.", "source_missing");
    await assertRequestScanLeaseOwned(job.id, lease);
    job = await updateRequestScanCheckpoint(job.id, lease, { source_relative_path: intended, source_moved_at: new Date().toISOString() });
  }
  await assertRequestScanLeaseOwned(job.id, lease);
  const completed = await finishRequestScanJob(job.id, lease, { status: created ? "processed" : "duplicate", source_relative_path: intended, error_message: null });
  if (!completed) throw new RequestScanLeaseLostError();
  return completed;
}

const requestScanWorkerId = createRequestScanWorkerId();
export async function processClaimedRequestScanJob(claimed: ClaimedRequestScanJob, suppliedSettings?: RequestScanSettings, dependencies: RequestScanServiceDependencies = defaultDependencies): Promise<RequestScanJob> {
  const settings = suppliedSettings ?? await readRequestScanSettings();
  let job = claimed.job; const lease: RequestScanLease = claimed.lease;
  const jobId = job.id;
  let leaseLost = false; let cancellationRequested = false; let heartbeat: NodeJS.Timeout | null = null; let renewing = false; let renewalPromise: Promise<void> | null = null; let tempDir: string | null = null;
  const cancellationController = new AbortController();
  const ensureLease = async () => { if (leaseLost) throw new RequestScanLeaseLostError(); if (cancellationRequested) throw new RequestScanCancellationRequestedError(); await assertRequestScanLeaseOwned(jobId, lease); };
  const progress = createRequestScanProgressCoalescer(async (value) => { await ensureLease(); if (!(await updateRequestScanProgress(jobId, lease, value))) { leaseLost = true; throw new RequestScanLeaseLostError(); } });
  const stage = (value: Parameters<typeof updateRequestScanProgress>[2]) => progress.update(value);
  const identifierStarted = Date.now();
  try {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "rispro-request-scan-file-")); const localPath = path.join(tempDir, job.filename);
    heartbeat = setInterval(() => { if (renewing || leaseLost || cancellationRequested) return; renewing = true; renewalPromise = renewRequestScanLeaseExecutionState(jobId, lease).then((state) => { if (state === "lost") leaseLost = true; else if (state === "cancel_requested") { cancellationRequested = true; cancellationController.abort(); } }).catch(() => { leaseLost = true; }).finally(() => { renewing = false; renewalPromise = null; }); }, 12_000);
    if (job.attachment_completed_at && job.document_id) {
      try { await getDocumentById(job.document_id); } catch { throw new RequestScanProcessingError("The checkpointed Request Scan document no longer exists. Manual review is required.", "internal_processing"); }
      const checkpointed = await loadRequestScanJobAppointments(job.id);
      const appointmentIds = checkpointed.length ? checkpointed.map((value) => value.appointment_id) : job.appointment_id ? [Number(job.appointment_id)] : [];
      if (!appointmentIds.length) throw new RequestScanProcessingError("The checkpointed Request Scan appointment links are missing. Manual review is required.", "internal_processing");
      await ensureLease();
      if (dependencies.upsertDocumentAppointmentLinks) await dependencies.upsertDocumentAppointmentLinks(job.document_id, appointmentIds);
      else await linkRequestScanDocumentAppointments(job.id, lease, job.document_id, appointmentIds);
      await ensureLease();
      return await archiveCheckpointedRequestScanJob(job, lease, settings, dependencies, job.attachment_created !== false);
    }
    let appointments: EligibleAppointment[] = [];
    let appointmentSources = new Map<number, Set<"accession" | "qr" | "filename" | "checkpoint" | "manual">>();
    let identifierStrategy = job.identifier_strategy || "checkpoint";
    if (job.manual_assignment_appointment_id) {
      const appointment = await dependencies.findEligibleAppointment(formatV2AccessionNumber(Number(job.manual_assignment_appointment_id)));
      appointments = [appointment];
      appointmentSources.set(Number(appointment.id), new Set(["manual"]));
      identifierStrategy = "manual";
      await stage({ stage: "downloading" }); await downloadRequestScanSource(dependencies, settings, job, localPath);
    } else if (job.identifier_verified_at && job.appointment_id && job.barcode_value) {
      const checkpointed = await loadRequestScanJobAppointments(job.id);
      const appointmentIds = checkpointed.length ? checkpointed.map((value) => value.appointment_id) : [Number(job.appointment_id)];
      appointments = await Promise.all(appointmentIds.map((id) => dependencies.findEligibleAppointment(formatV2AccessionNumber(id))));
      if (!appointments.some((appointment) => Number(appointment.id) === Number(job.appointment_id))) throw new RequestScanProcessingError("The checkpointed Request Scan identifier no longer resolves to the same appointment. Manual review is required.", "internal_processing");
      for (const appointment of appointments) appointmentSources.set(Number(appointment.id), new Set(["checkpoint"]));
      await stage({ stage: "downloading" }); await downloadRequestScanSource(dependencies, settings, job, localPath);
    } else {
      await stage({ stage: "checking_filename" });
      const filenameEvidence = await resolveFilenameEvidence(job.filename, dependencies);
      const baseMetadata = () => identifierMetadata(job.filename, filenameEvidence, identifierStarted, false, false);

      if (filenameEvidence.decision.kind === "conflict") {
        logIdentifier(dependencies, "IDENTIFIER_FILENAME_CONFLICT", baseMetadata());
        throw new HttpError(422, "The filename contains conflicting appointment information. Assign the document manually.");
      }

      {
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
        signal: cancellationController.signal,
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
          throw new HttpError(422, filenameEvidence.decision.kind === "success"
            ? "The filename identifies an appointment, but no matching identifier could be confirmed inside the document. Review and assign the document manually."
            : "No valid appointment identifier could be confirmed. Assign the document manually.");
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
      let unresolvedInternalCount = 0;
      const barcodeAccessions = barcode.accessions ?? (barcode.accession ? [barcode.accession] : []);
      for (const accession of barcodeAccessions) {
        try {
          const accessionAppointment = await dependencies.findEligibleAppointment(accession);
          documentAppointments.set(Number(accessionAppointment.id), accessionAppointment);
          documentSources.push({ appointmentId: Number(accessionAppointment.id), source: "accession" });
        } catch {
          unresolvedInternalCount += 1;
        }
      }
      for (const token of barcode.qrTokens ?? []) {
        let bookingId: number;
        try {
          const payload = await dependencies.verifyPublicAppointmentToken(token);
          bookingId = payload.bookingId;
        } catch (error) {
          unresolvedInternalCount += 1;
          const detailCode = error instanceof HttpError && error.details && typeof error.details === "object" ? String((error.details as { code?: unknown }).code || "") : "";
          logIdentifier(dependencies, detailCode === "qr_token_revoked" || detailCode === "qr_booking_not_found" ? detailCode : "qr_token_invalid", { rawCandidateIndex: (barcode.qrTokens ?? []).indexOf(token) });
          continue;
        }
        try {
          const qrAppointment = await dependencies.findEligibleAppointment(formatV2AccessionNumber(bookingId));
          documentAppointments.set(Number(qrAppointment.id), qrAppointment);
          documentSources.push({ appointmentId: Number(qrAppointment.id), source: "qr" });
          logIdentifier(dependencies, "qr_resolved", { rawCandidateIndex: (barcode.qrTokens ?? []).indexOf(token) });
        } catch {
          unresolvedInternalCount += 1;
          logIdentifier(dependencies, "qr_booking_not_found", { rawCandidateIndex: (barcode.qrTokens ?? []).indexOf(token) });
        }
      }
      if (unresolvedInternalCount) {
        logIdentifier(dependencies, "IDENTIFIER_DOCUMENT_QR_INVALID", {
          ...identifierMetadata(job.filename, filenameEvidence, identifierStarted, true, false),
          qrCandidateCount: barcode.qrTokens?.length ?? 0,
          invalidQrCount: unresolvedInternalCount,
        });
      }

      const documentAppointmentIds = [...documentAppointments.keys()];
      if (documentAppointmentIds.length === 0) {
        throw new HttpError(422, filenameEvidence.decision.kind === "success"
          ? "The filename identifies an appointment, but no matching identifier could be confirmed inside the document. Review and assign the document manually."
          : "No valid appointment identifier could be confirmed. Assign the document manually.");
      }
      if (unresolvedInternalCount) throw new HttpError(422, "The document contains an appointment identifier that could not be resolved. Review and assign the document manually.");
      const documentPatients = new Set([...documentAppointments.values()].map((value) => Number(value.patient_id)));
      if (documentPatients.size > 1) throw new HttpError(422, "The document contains appointment identifiers for different patients. Separate the document or assign it manually.");
      const documentSourceKinds = new Set(documentSources.map((source) => source.source));
      const documentSuccessCode = documentSourceKinds.size > 1
        ? "IDENTIFIER_SUCCESS_DOCUMENT_CONSENSUS"
        : documentSourceKinds.has("qr")
          ? "IDENTIFIER_SUCCESS_DOCUMENT_QR"
          : "IDENTIFIER_SUCCESS_DOCUMENT_ACCESSION";
      logIdentifier(dependencies, documentSuccessCode, {
        ...identifierMetadata(job.filename, filenameEvidence, identifierStarted, true, true),
        documentAccessionCandidateCount: barcodeAccessions.length,
        documentQrCandidateCount: barcode.qrTokens?.length ?? 0,
      });

      const verifiedFilenameAppointmentId = filenameEvidence.decision.kind === "success" || filenameEvidence.decision.kind === "partial"
        ? filenameEvidence.decision.appointmentId
        : null;
      if (verifiedFilenameAppointmentId != null && !documentAppointments.has(verifiedFilenameAppointmentId)) {
        logIdentifier(dependencies, "IDENTIFIER_DOCUMENT_CONFLICT", {
          ...identifierMetadata(job.filename, filenameEvidence, identifierStarted, true, false),
        });
        throw new HttpError(422, "The filename and scanned barcode identify different appointments. Assign the document manually.");
      }
      appointments = [...documentAppointments.values()].sort((a, b) => Number(a.id) - Number(b.id));
      for (const source of documentSources) {
        const sources = appointmentSources.get(source.appointmentId) ?? new Set();
        sources.add(source.source);
        appointmentSources.set(source.appointmentId, sources);
      }
      identifierStrategy = documentSourceKinds.size > 1 ? "document_consensus" : documentSourceKinds.has("qr") ? "document_qr" : "document_accession";
      if (verifiedFilenameAppointmentId != null) {
        const sources = appointmentSources.get(verifiedFilenameAppointmentId) ?? new Set();
        sources.add("filename");
        appointmentSources.set(verifiedFilenameAppointmentId, sources);
        identifierStrategy = "filename_document_consensus";
        logIdentifier(dependencies, "IDENTIFIER_DOCUMENT_CONFIRMATION", {
          ...identifierMetadata(job.filename, filenameEvidence, identifierStarted, true, true),
        });
      }
      }
    }

    if (!appointments.length) throw new HttpError(422, "No valid appointment identifier could be confirmed. Assign the document manually.");
    appointments.sort((a, b) => Number(a.id) - Number(b.id));
    const appointment = appointments[0]!;
    const appointmentCheckpoints: RequestScanJobAppointmentCheckpoint[] = appointments.map((value) => {
      const sources = appointmentSources.get(Number(value.id)) ?? new Set(["checkpoint" as const]);
      const identifier_source = sources.size > 1 ? "consensus" : [...sources][0]!;
      return { appointment_id: Number(value.id), patient_id: Number(value.patient_id), identifier_source };
    });
    await checkpointRequestScanJobAppointments(job.id, lease, appointmentCheckpoints);
    if (!job.identifier_verified_at) job = await updateRequestScanCheckpoint(job.id, lease, { appointment_id: appointment.id, barcode_value: appointment.accession_number, identifier_verified_at: new Date().toISOString(), identifier_strategy: identifierStrategy });
    await stage({ stage: "checking_duplicate" });
    const idempotencyKey = `request-scan:job:${job.id}:appointment-request`;
    if (!dependencies.uploadDocumentIdempotently && await dependencies.automatedDocumentExists(appointment.id)) {
      const existing = dependencies.findDocumentByIdempotencyKey ? await dependencies.findDocumentByIdempotencyKey(idempotencyKey) : null;
      await ensureLease(); const moved = await moveOutcome(dependencies, settings, job, settings.processedSubfolder, true); await ensureLease(); const completed = await finishRequestScanJob(job.id, lease, { status: "duplicate", barcode_value: appointment.accession_number, appointment_id: appointment.id, document_id: existing?.id ?? null, source_relative_path: moved, error_message: null }); if (!completed) throw new RequestScanLeaseLostError(); return completed;
    }
    await progress.flush(); job = await beginRequestScanAttachment(job.id, lease);
    const payload = { patientId: appointment.patient_id, appointmentId: appointment.id, appointmentRefType: "v2_booking", documentType: "appointment_request", originalFilename: job.filename, mimeType: job.mime_type, fileSourcePath: localPath, source: "request_scan_automation", requestScanJobId: job.id };
    const attachment = dependencies.uploadDocumentIdempotently ? await dependencies.uploadDocumentIdempotently(payload, null, idempotencyKey) : { document: await dependencies.uploadDocument(payload, null), created: true };
    await ensureLease();
    if (dependencies.upsertDocumentAppointmentLinks) await dependencies.upsertDocumentAppointmentLinks(attachment.document.id, appointments.map((value) => Number(value.id)));
    else await linkRequestScanDocumentAppointments(job.id, lease, attachment.document.id, appointments.map((value) => Number(value.id)));
    await ensureLease();
    const createdByThisJob = attachment.created || attachment.document.request_scan_job_id === job.id;
    job = await updateRequestScanCheckpoint(job.id, lease, { appointment_id: appointment.id, document_id: attachment.document.id, barcode_value: appointment.accession_number, attachment_completed_at: new Date().toISOString(), attachment_created: createdByThisJob });
    await stage({ stage: "moving_file" });
    await progress.flush();
    return await archiveCheckpointedRequestScanJob(job, lease, settings, dependencies, createdByThisJob);
  } catch (error) {
    if (error instanceof RequestScanLeaseLostError || leaseLost) { progress.cancel(); return getRequestScanJob(job.id); }
    if (error instanceof RequestScanCancellationRequestedError || cancellationRequested || (error && typeof error === "object" && (error as { name?: unknown }).name === "AbortError")) {
      progress.cancel(); cancellationController.abort();
      const stoppedMessage = "Automatic scanning was stopped after manual review. No QR code or barcode was confirmed. Assign the document manually.";
      let moved = job.source_relative_path;
      try {
        await assertRequestScanLeaseOwned(job.id, lease, true);
        moved = await moveOutcome(dependencies, settings, job, settings.failedSubfolder);
        await assertRequestScanLeaseOwned(job.id, lease, true);
      } catch (moveError) {
        if (moveError instanceof RequestScanLeaseLostError) return getRequestScanJob(job.id);
      }
      return (await finishRequestScanJob(job.id, lease, { status: "failed", source_relative_path: moved, error_message: stoppedMessage, failure_category: "recognition" })) ?? getRequestScanJob(job.id);
    }
    await progress.flush().catch(() => undefined);
    const category = failureCategory(error); const message = error instanceof RequestScanProcessingError ? error.message : concise(error); let moved = job.source_relative_path;
    if (!job.attachment_completed_at) { try { await ensureLease(); moved = await moveOutcome(dependencies, settings, job, settings.failedSubfolder); } catch (moveError) { if (moveError instanceof RequestScanLeaseLostError) return getRequestScanJob(job.id); } }
    const archiveFailure = Boolean(job.attachment_completed_at && job.document_id && !job.source_moved_at);
    const retryDelayMinutes = Math.min(60, 2 ** Math.min(6, Math.max(0, Number(job.archive_attempt_count ?? 1) - 1)));
    return (await finishRequestScanJob(job.id, lease, { status: "failed", source_relative_path: moved, error_message: message, failure_category: category, ...(archiveFailure ? { archive_last_error: message, archive_next_retry_at: new Date(Date.now() + retryDelayMinutes * 60_000).toISOString() } : {}), completed_at: new Date().toISOString() })) ?? getRequestScanJob(job.id);
  } finally { progress.cancel(); if (heartbeat) clearInterval(heartbeat); if (renewalPromise) await renewalPromise; if (tempDir) await fs.rm(tempDir, { recursive: true, force: true }).catch(() => undefined); }
}

export async function processRequestScanJob(jobId: number, suppliedSettings?: RequestScanSettings, dependencies: RequestScanServiceDependencies = defaultDependencies, workerId = requestScanWorkerId): Promise<RequestScanJob> {
  const settings = suppliedSettings ?? await readRequestScanSettings();
  const claimed = await claimRequestScanJob(jobId, workerId);
  if (!claimed) return getRequestScanJob(jobId);
  return processClaimedRequestScanJob(claimed, settings, dependencies);
}

export type RequestScanCycleResult = { discovered: number; processed: number; failed: number; duplicates: number; skipped: number };
const REQUEST_SCAN_MAX_JOBS_PER_CYCLE = 100;
export async function prioritizePendingRequestScanJob(id: number): Promise<RequestScanJob> { const { rows } = await pool.query("update request_scan_jobs set priority_requested_at=coalesce(priority_requested_at,now()),updated_at=now() where id=$1 and status='pending' returning *", [id]); if (rows[0]) return rows[0] as RequestScanJob; const job = await getRequestScanJob(id); if (job.status !== "pending") throw new HttpError(409, "Only queued request scans can be started."); throw new HttpError(404, "Request scan not found."); }
export async function requestStopRequestScanJob(id: number, userId: number): Promise<RequestScanJob> {
  const { rows } = await pool.query(`update request_scan_jobs set cancel_requested_at=now(),cancel_requested_by=$2,cancel_reason='manual_review_no_identifier',updated_at=now() where id=$1 and status='processing' and attachment_completed_at is null and cancel_requested_at is null and processing_stage not in ('attaching_document','moving_file','completed') returning *`, [id, userId]);
  if (!rows[0]) {
    const job = await getRequestScanJob(id);
    if (job.status === "processing" && job.cancel_requested_at && !job.attachment_completed_at && !["attaching_document", "moving_file", "completed"].includes(job.processing_stage || "")) return job;
    throw new HttpError(409, "Automatic scanning can no longer be stopped because document attachment or completion has already begun.");
  }
  const job = rows[0] as RequestScanJob;
  await logAuditEntry({ entityType: "request_scan_job", entityId: id, actionType: "request_scan_processing_stopped", newValues: { jobId: id, previousProcessingStage: job.processing_stage, reason: "manual_review_no_identifier" }, changedByUserId: userId });
  return job;
}
function emptyCycleResult(): RequestScanCycleResult { return { discovered: 0, processed: 0, failed: 0, duplicates: 0, skipped: 0 }; }
function addJobOutcome(result: RequestScanCycleResult, completed: RequestScanJob): void { if (completed.status === "processed") result.processed += 1; else if (completed.status === "duplicate") result.duplicates += 1; else if (completed.status === "failed") result.failed += 1; else result.skipped += 1; }
function addCycleResult(target: RequestScanCycleResult, source: RequestScanCycleResult): void { target.discovered += source.discovered; target.processed += source.processed; target.failed += source.failed; target.duplicates += source.duplicates; target.skipped += source.skipped; }
export async function runRequestScanJobPool(options: { limit: number; maxConcurrency: 1 | 2; shouldContinue?: () => boolean; claimNext: () => Promise<ClaimedRequestScanJob | null>; processClaimed: (claim: ClaimedRequestScanJob) => Promise<RequestScanJob> }): Promise<{ claimed: number; result: RequestScanCycleResult }> {
  if (!Number.isInteger(options.limit) || options.limit < 0) throw new Error("Request Scan cycle limit must be a non-negative integer.");
  if (options.maxConcurrency !== 1 && options.maxConcurrency !== 2) throw new Error("Request Scan concurrency must be either 1 or 2.");
  let reservations = 0;
  const reserveClaim = (): boolean => {
    if (options.shouldContinue && !options.shouldContinue()) return false;
    if (reservations >= options.limit) return false;
    reservations += 1;
    return true;
  };
  const slot = async (): Promise<{ claimed: number; result: RequestScanCycleResult; errors: unknown[] }> => {
    const result = emptyCycleResult(); let claimed = 0; const errors: unknown[] = [];
    while (reserveClaim()) {
      let claim: ClaimedRequestScanJob | null;
      try { claim = await options.claimNext(); } catch (error) { errors.push(error); break; }
      if (!claim) { reservations -= 1; break; }
      claimed += 1;
      try { addJobOutcome(result, await options.processClaimed(claim)); } catch (error) { errors.push(error); }
    }
    return { claimed, result, errors };
  };
  const slots = await Promise.all(Array.from({ length: options.maxConcurrency }, slot));
  const result = emptyCycleResult(); const errors = slots.flatMap((slotResult) => slotResult.errors);
  for (const slotResult of slots) addCycleResult(result, slotResult.result);
  if (errors.length) throw new AggregateError(errors, "Request Scan worker slot failed.");
  return { claimed: slots.reduce((total, slotResult) => total + slotResult.claimed, 0), result };
}
async function drainPendingRequestScanJobs(settings: RequestScanSettings, dependencies: RequestScanServiceDependencies, limit: number, workerId: string, options: RequestScanCycleOptions): Promise<{ claimed: number; result: RequestScanCycleResult }> {
  return runRequestScanJobPool({ limit, maxConcurrency: options.maxConcurrency ?? env.requestScanMaxConcurrency, shouldContinue: options.shouldContinue, claimNext: () => claimNextRequestScanJob(workerId), processClaimed: (claim) => processClaimedRequestScanJob(claim, settings, dependencies) });
}

export async function runRequestScanCycle(suppliedSettings?: RequestScanSettings, dependencies: RequestScanServiceDependencies = defaultDependencies, workerId = requestScanWorkerId, options: RequestScanCycleOptions = {}): Promise<RequestScanCycleResult> {
  const settings = suppliedSettings ?? await readRequestScanSettings(); if (!settings.enabled) return { discovered: 0, processed: 0, failed: 0, duplicates: 0, skipped: 0 };
  const result = emptyCycleResult(); const queuedAtStart = await drainPendingRequestScanJobs(settings, dependencies, REQUEST_SCAN_MAX_JOBS_PER_CYCLE, workerId, options); addCycleResult(result, queuedAtStart.result);
  if (options.shouldContinue && !options.shouldContinue()) return result;
  const files = await dependencies.listRequestScanFiles(settings); result.discovered = files.length;
  const discovery = { incomingFiles: files.length, activeJobs: 0, createdJobs: 0, reactivatedJobs: 0, archivePendingJobs: 0, orphanConflicts: 0, skippedYoungFiles: 0 };
  for (const file of files) {
    if (file.modifiedAt && Date.now() - file.modifiedAt.getTime() < settings.fileReadyDelaySeconds * 1000) { result.skipped += 1; discovery.skippedYoungFiles += 1; continue; }
    const reconciled = await reconcileIncomingRequestScanFile(file.filename, file.relativePath);
    if (reconciled.outcome === "active") discovery.activeJobs += 1;
    else if (reconciled.outcome === "created") discovery.createdJobs += 1;
    else if (reconciled.outcome === "reactivated") discovery.reactivatedJobs += 1;
    else if (reconciled.outcome === "archive_pending") discovery.archivePendingJobs += 1;
    else { discovery.orphanConflicts += 1; result.skipped += 1; }
  }
  dependencies.logDiagnostic?.("request_scan_discovery", discovery);
  const queuedAfterDiscovery = await drainPendingRequestScanJobs(settings, dependencies, REQUEST_SCAN_MAX_JOBS_PER_CYCLE - queuedAtStart.claimed, workerId, options); addCycleResult(result, queuedAfterDiscovery.result);
  return result;
}

const pendingRetryFields = { status: "pending" as const, error_message: null, failure_category: null, dismissed_at: null, dismissed_by: null, dismiss_reason: null, cancel_requested_at: null, cancel_requested_by: null, cancel_reason: null, completed_at: null, processing_stage: "queued", processing_started_at: null, heartbeat_at: null, worker_id: null, lease_token: null, lease_expires_at: null, progress_current: null, progress_total: null };
export async function retryRequestScanJob(id: number, overrides: Partial<RequestScanRetryDependencies> = {}): Promise<RequestScanJob> {
  const dependencies: RequestScanRetryDependencies = { readSettings: readRequestScanSettings, getJob: getRequestScanJob, moveFile: moveRequestScanFile, updateJob, ...overrides };
  const job = await dependencies.getJob(id);
  if (job.status !== "failed" || job.dismissed_at) throw new HttpError(409, "Only visible failed request scans can be retried.");
  if (job.attachment_completed_at && job.document_id) return dependencies.updateJob(id, { ...pendingRetryFields, stage_started_at: new Date().toISOString() });
  if (Object.keys(overrides).length) {
    const settings = await dependencies.readSettings(); const moved = await dependencies.moveFile(settings, job.source_relative_path, settings.incomingSubfolder, job.filename);
    return dependencies.updateJob(id, { ...pendingRetryFields, source_relative_path: moved, stage_started_at: new Date().toISOString() });
  }
  return returnRequestScanToIncoming(id);
}
export async function retryRequestScanArchive(id: number, userId: number): Promise<RequestScanJob> {
  const { rows } = await pool.query<RequestScanJob>(`update request_scan_jobs set status='pending',error_message=null,failure_category=null,archive_next_retry_at=null,processing_stage='queued',processing_started_at=null,stage_started_at=now(),heartbeat_at=null,worker_id=null,lease_token=null,lease_expires_at=null,progress_current=null,progress_total=null,updated_at=now() where id=$1 and status='failed' and dismissed_at is null and attachment_completed_at is not null and document_id is not null and source_moved_at is null returning *`, [id]);
  if (!rows[0]) throw new HttpError(409, "Only attached documents with a pending archive transfer can be retried.");
  await logAuditEntry({ entityType: "request_scan_job", entityId: id, actionType: "request_scan_archive_retry_queued", newValues: { archiveAttemptCount: rows[0].archive_attempt_count ?? 0 }, changedByUserId: userId });
  return rows[0];
}
export async function bulkRetryRequestScanArchives(ids: number[], userId: number): Promise<{ requestedCount: number; queued: RequestScanJob[]; failed: Array<{ id: number; message: string }> }> {
  const unique = [...new Set(ids)];
  if (!unique.length || unique.length > 50) throw new HttpError(400, "Select between 1 and 50 request scans.");
  const queued: RequestScanJob[] = []; const failed: Array<{ id: number; message: string }> = [];
  for (const id of unique) {
    try { queued.push(await retryRequestScanArchive(id, userId)); }
    catch (error) { failed.push({ id, message: error instanceof Error ? error.message : "Archive retry could not be queued." }); }
  }
  await logAuditEntry({ entityType: "request_scan_job", actionType: "request_scan_bulk_archive_retry_queued", newValues: { requestedCount: unique.length, queuedCount: queued.length, failedCount: failed.length }, changedByUserId: userId });
  return { requestedCount: unique.length, queued, failed };
}
function cleanDismissReason(value: unknown): string | null { const reason = String(value ?? "").trim(); if (reason.length > 500) throw new HttpError(400, "Dismiss reason must be 500 characters or fewer."); return reason || null; }
export async function dismissRequestScanJob(id: number, userId: number, reason?: unknown): Promise<RequestScanJob> { const { rows } = await pool.query("update request_scan_jobs set dismissed_at=now(),dismissed_by=$2,dismiss_reason=$3,updated_at=now() where id=$1 and status='failed' and dismissed_at is null returning *", [id, userId, cleanDismissReason(reason)]); if (!rows[0]) throw new HttpError(409, "Only visible failed request scans can be dismissed."); const job = rows[0] as RequestScanJob; await logAuditEntry({ entityType: "request_scan_job", entityId: id, actionType: "request_scan_dismissed", newValues: { failure_category: job.failure_category }, changedByUserId: userId }); return job; }
export async function restoreDismissedRequestScanJob(id: number, userId: number): Promise<RequestScanJob> { const { rows } = await pool.query("update request_scan_jobs set dismissed_at=null,dismissed_by=null,dismiss_reason=null,updated_at=now() where id=$1 and status='failed' and dismissed_at is not null returning *", [id]); if (!rows[0]) throw new HttpError(409, "Only dismissed failed request scans can be restored."); const job = rows[0] as RequestScanJob; await logAuditEntry({ entityType: "request_scan_job", entityId: id, actionType: "request_scan_restored", newValues: { failure_category: job.failure_category }, changedByUserId: userId }); return job; }
export async function bulkDismissRequestScanJobs(ids: number[], userId: number, reason?: unknown): Promise<RequestScanJob[]> { const unique = [...new Set(ids)]; if (!unique.length || unique.length > 50) throw new HttpError(400, "Select between 1 and 50 request scans."); const clean = cleanDismissReason(reason); const client = await pool.connect(); try { await client.query("begin"); const locked = await client.query("select id from request_scan_jobs where id=any($1::bigint[]) and status='failed' and dismissed_at is null for update", [unique]); if (locked.rows.length !== unique.length) throw new HttpError(409, "All selected jobs must be visible failed request scans."); const { rows } = await client.query("update request_scan_jobs set dismissed_at=now(),dismissed_by=$2,dismiss_reason=$3,updated_at=now() where id=any($1::bigint[]) returning *", [unique, userId, clean]); await client.query("commit"); await logAuditEntry({ entityType: "request_scan_job", actionType: "request_scan_bulk_dismissed", newValues: { count: rows.length }, changedByUserId: userId }); return rows as RequestScanJob[]; } catch (error) { await client.query("rollback"); throw error; } finally { client.release(); } }
export async function bulkRetryRequestScanJobs(ids: number[]): Promise<{ requestedCount: number; queued: RequestScanJob[]; failed: Array<{ id: number; message: string }> }> { const unique = [...new Set(ids)]; if (!unique.length || unique.length > 50) throw new HttpError(400, "Select between 1 and 50 request scans."); const queued: RequestScanJob[] = []; const failed: Array<{ id: number; message: string }> = []; for (const id of unique) { try { queued.push(await retryRequestScanJob(id)); } catch { failed.push({ id, message: "The source scan file could not be returned to Incoming." }); } } return { requestedCount: unique.length, queued, failed }; }
export async function auditBulkRequestScanRetry(result: { requestedCount: number; queued: RequestScanJob[]; failed: Array<{ id: number }> }, userId: number, triggerStatus: "accepted" | "already_running" | "disabled" | "not_triggered"): Promise<void> { await logAuditEntry({ entityType: "request_scan_job", actionType: "request_scan_bulk_retried", newValues: { requestedCount: result.requestedCount, queuedCount: result.queued.length, failedCount: result.failed.length, triggerStatus }, changedByUserId: userId }); }
export async function returnRequestScanToIncoming(id: number, overrides: Partial<RequestScanReturnDependencies> = {}): Promise<RequestScanJob> {
  const dependencies: RequestScanReturnDependencies = { readSettings: readRequestScanSettings, reconcileMove: reconcileRequestScanMove, triggerWorker: requestRequestScanWorkerRun, ...overrides };
  const settings = await dependencies.readSettings();
  const client = await pool.connect();
  let job: RequestScanJob;
  try {
    await client.query("begin");
    const locked = await client.query<RequestScanJob>("select * from request_scan_jobs where id=$1 for update", [id]);
    job = locked.rows[0]!;
    if (!job) throw new HttpError(404, "Request scan not found.");
    if (job.status !== "failed" || job.dismissed_at) throw new HttpError(409, "Only visible failed request scans can be returned.");
    if (job.attachment_completed_at || job.document_id) throw new HttpError(409, "This document is already attached. Use Resume archive to complete file reconciliation.");
    const filename = validateRequestScanRemoteFilename(path.basename(job.filename));
    const incoming = `${settings.incomingSubfolder.replace(/[\\/]+$/g, "")}\\${filename}`;
    const owner = await client.query("select id from request_scan_jobs where source_relative_path=$1 and id<>$2 limit 1", [incoming, id]);
    if (owner.rowCount) throw new HttpError(409, "Another Request Scan job already owns the Incoming destination.");
    const source = job.return_source_path || job.source_relative_path;
    const destinationPath = job.return_destination_path || incoming;
    const persisted = await client.query<RequestScanJob>(`update request_scan_jobs set return_requested_at=coalesce(return_requested_at,now()),return_source_path=$2,return_destination_path=$3,updated_at=now() where id=$1 returning *`, [id, source, destinationPath]);
    job = persisted.rows[0]!;
    await client.query("commit");
  } catch (error) { await client.query("rollback"); throw error; } finally { client.release(); }
  const outcome = await dependencies.reconcileMove(settings, job.return_source_path!, job.return_destination_path!, undefined, { jobId: Number(job.id) });
  if (outcome === "conflict") throw new HttpError(409, "The previous source and Incoming file have different contents. Both files were preserved for manual reconciliation.");
  if (outcome === "missing") throw new HttpError(404, "The Request Scan source and Incoming destination are both missing.");
  const { rows } = await pool.query<RequestScanJob>(`update request_scan_jobs set source_relative_path=return_destination_path,status='pending',return_completed_at=now(),error_message=null,failure_category=null,dismissed_at=null,dismissed_by=null,dismiss_reason=null,cancel_requested_at=null,cancel_requested_by=null,cancel_reason=null,completed_at=null,processing_stage='queued',processing_started_at=null,stage_started_at=now(),heartbeat_at=null,worker_id=null,lease_token=null,lease_expires_at=null,progress_current=null,progress_total=null,updated_at=now() where id=$1 and status='failed' and attachment_completed_at is null and document_id is null and return_destination_path is not null returning *`, [id]);
  if (!rows[0]) throw new HttpError(409, "The Request Scan Return checkpoint could not be completed.");
  await dependencies.triggerWorker();
  return rows[0];
}
export async function manuallyAssignRequestScan(id: number, appointmentId: number, userId: number, _suppliedSettings?: RequestScanSettings, _dependencies?: RequestScanServiceDependencies): Promise<RequestScanJob> {
  const client = await pool.connect();
  try {
    await client.query("begin");
    const jobResult = await client.query<RequestScanJob>("select * from request_scan_jobs where id=$1 for update", [id]);
    const job = jobResult.rows[0];
    if (!job || job.status !== "failed" || job.dismissed_at) throw new HttpError(409, "Restore this dismissed request scan before manual assignment.");
    if (job.attachment_completed_at || job.document_id) throw new HttpError(409, "This document is already attached and cannot be assigned again.");
    const eligible = await client.query<EligibleAppointment>(`select b.id,b.patient_id,('V2-' || lpad(b.id::text,6,'0')) as accession_number from appointments_v2.bookings b where b.id=$1 and b.status not in ('cancelled','discontinued','voided')`, [appointmentId]);
    if (!eligible.rows[0]) throw new HttpError(404, "No eligible appointment matches this selection.");
    const appointment = eligible.rows[0];
    const { rows } = await client.query<RequestScanJob>(`update request_scan_jobs set status='pending',processing_stage='queued',manual_assignment_requested_at=coalesce(manual_assignment_requested_at,now()),manual_assignment_requested_by=coalesce(manual_assignment_requested_by,$2),manual_assignment_confirmed_at=now(),manual_assignment_appointment_id=$3,appointment_id=$3,error_message=null,failure_category=null,completed_at=null,dismissed_at=null,dismissed_by=null,dismiss_reason=null,updated_at=now() where id=$1 returning *`, [id, userId, appointment.id]);
    await client.query("commit");
    await logAuditEntry({ entityType: "request_scan_job", entityId: id, actionType: "request_scan_manual_assignment_requested", newValues: { appointmentId: appointment.id, confirmed: true }, changedByUserId: userId });
    return rows[0]!;
  } catch (error) { await client.query("rollback"); throw error; } finally { client.release(); }
}
type RequestScanPreviewDependencies = { readSettings: typeof readRequestScanSettings; getJob: typeof getRequestScanJob; getDocument: typeof getDocumentById; readFile: (filePath: string) => Promise<Buffer>; downloadFile: typeof downloadRequestScanFile };
export async function downloadRequestScanJobFile(id: number, overrides: Partial<RequestScanPreviewDependencies> = {}): Promise<{ job: RequestScanJob; buffer: Buffer }> {
  const dependencies: RequestScanPreviewDependencies = { readSettings: readRequestScanSettings, getJob: getRequestScanJob, getDocument: getDocumentById, readFile: fs.readFile, downloadFile: downloadRequestScanFile, ...overrides };
  const settings = await dependencies.readSettings(); const job = await dependencies.getJob(id);
  if (job.document_id) {
    try { const document = await dependencies.getDocument(job.document_id); return { job, buffer: await dependencies.readFile(getDocumentAbsolutePath(document)) }; }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT" && !(error instanceof HttpError && error.statusCode === 404)) throw error; }
  }
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "rispro-request-scan-preview-"));
  try {
    const candidates = [...new Set([job.source_relative_path, job.intended_destination_path, job.return_destination_path].filter((value): value is string => Boolean(value)))];
    for (const [index, remotePath] of candidates.entries()) {
      const localPath = path.join(tempDir, `preview-${index}${path.extname(job.filename)}`);
      try { await dependencies.downloadFile(settings, remotePath, localPath); return { job, buffer: await dependencies.readFile(localPath) }; }
      catch (error) { if (classifyRequestScanSmbError(error) !== "source_missing") throw error; }
    }
    throw new HttpError(404, "Request Scan preview file was not found.");
  } finally { await fs.rm(tempDir, { recursive: true, force: true }); }
}

export function withSafeRequestScanFilename<T extends Pick<RequestScanJob, "filename">>(job: T): T {
  const safe = { ...job, filename: requestScanSafeDisplayFilename(job.filename) } as T & { source_relative_path?: unknown };
  delete safe.source_relative_path;
  return safe;
}
