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
import {
  decideRequestScanFilenameEvidence,
  parseRequestScanFilenameIdentifiers,
  requestScanSafeDisplayFilename,
  type RequestScanFilenameDecision,
} from "./request-scan-filename-identifier.js";
import { downloadRequestScanFile, listRequestScanFiles, moveRequestScanFile } from "./request-scan-smb-service.js";
import { readRequestScanSettings, type RequestScanSettings } from "./request-scan-settings-service.js";

export type RequestScanJob = { id: number; filename: string; source_relative_path: string; mime_type: string; status: "pending" | "processing" | "processed" | "duplicate" | "failed"; barcode_value: string | null; appointment_id: number | null; document_id: number | null; error_message: string | null; attempt_count: number; created_at: string; updated_at: string; completed_at: string | null; patient_name?: string | null; modality_name?: string | null; exam_name?: string | null; accession_number?: string | null };
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

export async function listRequestScanJobs(status?: string): Promise<RequestScanJob[]> {
  const values: unknown[] = []; const where = status ? "where j.status = $1" : ""; if (status) values.push(status);
  const { rows } = await pool.query(`select j.*, ('V2-' || lpad(b.id::text, 6, '0')) as accession_number, coalesce(p.english_full_name, p.arabic_full_name) as patient_name, m.name_en as modality_name, e.name_en as exam_name from request_scan_jobs j left join appointments_v2.bookings b on b.id=j.appointment_id left join patients p on p.id=b.patient_id left join modalities m on m.id=b.modality_id left join exam_types e on e.id=b.exam_type_id ${where} order by j.created_at desc limit 250`, values);
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

export async function processRequestScanJob(jobId: number, suppliedSettings?: RequestScanSettings, dependencies: RequestScanServiceDependencies = defaultDependencies): Promise<RequestScanJob> {
  const settings = suppliedSettings ?? await readRequestScanSettings();
  let job = await getRequestScanJob(jobId); await updateJob(job.id, { status: "processing", error_message: null, attempt_count: job.attempt_count + 1 }); job = await getRequestScanJob(job.id);
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "rispro-request-scan-file-")); const localPath = path.join(tempDir, job.filename);
  const identifierStarted = Date.now();
  try {
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
      await dependencies.downloadRequestScanFile(settings, job.source_relative_path, localPath);
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
      await dependencies.downloadRequestScanFile(settings, job.source_relative_path, localPath);
      const barcode = await dependencies.extractRequestScanBarcode(localPath);
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

    if (await dependencies.automatedDocumentExists(appointment.id)) {
      const moved = await moveOutcome(dependencies, settings, job, settings.processedSubfolder, true);
      return updateJob(job.id, { status: "duplicate", barcode_value: appointment.accession_number, appointment_id: appointment.id, source_relative_path: moved, error_message: null, completed_at: new Date().toISOString() });
    }
    const buffer = await fs.readFile(localPath);
    const document = await dependencies.uploadDocument({ patientId: appointment.patient_id, appointmentId: appointment.id, appointmentRefType: "v2_booking", documentType: "appointment_request", originalFilename: job.filename, mimeType: job.mime_type, fileContentBuffer: buffer, source: "request_scan_automation" }, null);
    const moved = await moveOutcome(dependencies, settings, job, settings.processedSubfolder);
    return updateJob(job.id, { status: "processed", barcode_value: appointment.accession_number, appointment_id: appointment.id, document_id: document.id, source_relative_path: moved, error_message: null, completed_at: new Date().toISOString() });
  } catch (error) {
    const message = concise(error); let moved = job.source_relative_path;
    try { moved = await moveOutcome(dependencies, settings, job, settings.failedSubfolder); } catch { /* keep the original path so recovery can retry it */ }
    return updateJob(job.id, { status: "failed", source_relative_path: moved, error_message: message, completed_at: new Date().toISOString() });
  } finally { await fs.rm(tempDir, { recursive: true, force: true }); }
}

export type RequestScanCycleResult = { discovered: number; processed: number; failed: number; duplicates: number; skipped: number };

export async function runRequestScanCycle(suppliedSettings?: RequestScanSettings, dependencies: RequestScanServiceDependencies = defaultDependencies): Promise<RequestScanCycleResult> {
  const settings = suppliedSettings ?? await readRequestScanSettings(); if (!settings.enabled) return { discovered: 0, processed: 0, failed: 0, duplicates: 0, skipped: 0 };
  const files = await dependencies.listRequestScanFiles(settings); const result: RequestScanCycleResult = { discovered: files.length, processed: 0, failed: 0, duplicates: 0, skipped: 0 };
  for (const file of files) {
    if (file.modifiedAt && Date.now() - file.modifiedAt.getTime() < settings.fileReadyDelaySeconds * 1000) { result.skipped += 1; continue; }
    const job = await createOrGetJob(file.filename, file.relativePath); if (!["pending", "failed"].includes(job.status)) { result.skipped += 1; continue; }
    const completed = await processRequestScanJob(job.id, settings, dependencies); if (completed.status === "processed") result.processed += 1; else if (completed.status === "duplicate") result.duplicates += 1; else result.failed += 1;
  }
  return result;
}

export async function retryRequestScanJob(id: number): Promise<RequestScanJob> { const settings = await readRequestScanSettings(); const job = await getRequestScanJob(id); if (job.status !== "failed") throw new HttpError(409, "Only failed request scans can be retried."); const moved = await moveRequestScanFile(settings, job.source_relative_path, settings.incomingSubfolder, job.filename); const pending = await updateJob(id, { status: "pending", source_relative_path: moved, error_message: null, completed_at: null }); return processRequestScanJob(pending.id, settings); }
export async function returnRequestScanToIncoming(id: number): Promise<RequestScanJob> { const settings = await readRequestScanSettings(); const job = await getRequestScanJob(id); if (job.status !== "failed") throw new HttpError(409, "Only failed request scans can be returned."); const moved = await moveRequestScanFile(settings, job.source_relative_path, settings.incomingSubfolder, job.filename); return updateJob(id, { status: "pending", source_relative_path: moved, error_message: null, completed_at: null }); }
export async function manuallyAssignRequestScan(id: number, appointmentId: number, userId: number, suppliedSettings?: RequestScanSettings, dependencies: RequestScanServiceDependencies = defaultDependencies): Promise<RequestScanJob> { const settings = suppliedSettings ?? await readRequestScanSettings(); const job = await getRequestScanJob(id); if (job.status !== "failed") throw new HttpError(409, "Only failed request scans can be assigned manually."); const appointment = await findEligibleRequestScanAppointment(`V2-${String(appointmentId).padStart(6, "0")}`); const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "rispro-request-scan-manual-")); try { const localPath = path.join(tempDir, job.filename); await dependencies.downloadRequestScanFile(settings, job.source_relative_path, localPath); const document = await dependencies.uploadDocument({ patientId: appointment.patient_id, appointmentId: appointment.id, appointmentRefType: "v2_booking", documentType: "appointment_request", originalFilename: job.filename, mimeType: job.mime_type, fileContentBuffer: await fs.readFile(localPath), source: "request_scan_automation" }, userId); const moved = await moveOutcome(dependencies, settings, job, settings.processedSubfolder); return updateJob(id, { status: "processed", appointment_id: appointment.id, document_id: document.id, source_relative_path: moved, error_message: null, completed_at: new Date().toISOString() }); } finally { await fs.rm(tempDir, { recursive: true, force: true }); } }
export async function downloadRequestScanJobFile(id: number): Promise<{ job: RequestScanJob; buffer: Buffer }> { const settings = await readRequestScanSettings(); const job = await getRequestScanJob(id); const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "rispro-request-scan-preview-")); try { const localPath = path.join(tempDir, job.filename); await downloadRequestScanFile(settings, job.source_relative_path, localPath); return { job, buffer: await fs.readFile(localPath) }; } finally { await fs.rm(tempDir, { recursive: true, force: true }); } }

export function withSafeRequestScanFilename<T extends Pick<RequestScanJob, "filename">>(job: T): T {
  const safe = { ...job, filename: requestScanSafeDisplayFilename(job.filename) } as T & { source_relative_path?: unknown };
  delete safe.source_relative_path;
  return safe;
}
