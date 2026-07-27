import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { pool } from "../db/pool.js";
import { HttpError } from "../utils/http-error.js";
import { normalizePositiveInteger } from "../utils/normalize.js";
import type { OptionalUserId, UserId } from "../types/http.js";
import { logAuditEntry } from "./audit-service.js";
import { getDocumentAbsolutePath } from "./document-service.js";
import { createClinicalDocumentDicom, createClinicalDocumentUid } from "./clinical-document-dicom.js";
import { createAuthoritativeOrthancClient, readAuthoritativeOrthancSettings, type OrthancInstanceDetails, type OrthancStudyDetails } from "./authoritative-orthanc-service.js";
import { CLINICAL_DOCUMENT_EXPORT_DESTINATION, enqueueClinicalDocumentExportsForAppointment, reconcileClinicalDocumentExports } from "./clinical-document-export-queue-service.js";

const EXPORT_LEASE_SECONDS = 300;
const DEFAULT_BATCH_SIZE = 10;
const MAX_AUTOMATIC_ATTEMPTS = 8;
const RETRY_BASE_MS = 15_000;
const RETRY_MAX_MS = 60 * 60 * 1000;

export type ClinicalDocumentExportStatus = "pending" | "exporting" | "exported" | "failed" | "blocked";

export type ClinicalDocumentExportRow = {
  id: number;
  document_id: number;
  appointment_id: number;
  destination_key: string;
  status: ClinicalDocumentExportStatus;
  attempt_count: number;
  next_retry_at: string | null;
  last_attempt_at: string | null;
  last_error: string | null;
  orthanc_study_id: string | null;
  orthanc_series_id: string | null;
  orthanc_instance_id: string | null;
  study_instance_uid: string | null;
  series_instance_uid: string | null;
  sop_instance_uid: string | null;
  exported_at: string | null;
  verified_at: string | null;
  export_lease_owner?: string | null;
  export_lease_expires_at?: string | null;
  created_at: string;
  updated_at: string;
};

type ExportWorkRow = ClinicalDocumentExportRow & {
  document_original_filename: string;
  document_stored_path: string;
  document_mime_type: string;
  document_type: string;
  appointment_status: string;
  appointment_study_instance_uid: string | null;
  appointment_accession_number: string;
  appointment_booking_date: string;
  patient_primary_id: string | null;
  patient_national_id: string | null;
  patient_mrn: string | null;
  patient_name: string | null;
  patient_birth_date: string | null;
  patient_sex: string | null;
  modality_code: string | null;
};

type AppointmentExportContext = Pick<ExportWorkRow, "appointment_id" | "appointment_status" | "appointment_study_instance_uid" | "appointment_accession_number" | "appointment_booking_date" | "patient_primary_id" | "patient_national_id" | "patient_mrn" | "patient_name" | "patient_birth_date" | "patient_sex" | "modality_code">;

class ClinicalDocumentExportBlockedError extends Error {
  constructor(public readonly code: string, message: string) {
    super(message);
    this.name = "ClinicalDocumentExportBlockedError";
  }
}

function errorCode(error: unknown): string {
  if (error instanceof HttpError && error.details && typeof error.details === "object" && "code" in error.details) return String((error.details as { code?: unknown }).code || "");
  return "";
}

function safeErrorMessage(error: unknown): string {
  const raw = error instanceof Error ? error.message : String(error);
  return raw.replace(/\b(?:password|authorization|basic)\b[^.\n]*/gi, "configuration detail").replace(/\s+/g, " ").trim().slice(0, 300) || "Clinical document export failed.";
}

function isRetryableError(error: unknown): boolean {
  const code = errorCode(error);
  if (["orthanc_unavailable", "orthanc_timeout"].includes(code)) return true;
  if (code === "orthanc_auth_failed" || code === "orthanc_invalid_response" || code === "orthanc_study_mismatch" || code === "orthanc_invalid_dicom") return false;
  return /study was not found|not available|temporarily|connection refused|timeout|fetch failed|econnrefused|enotfound/i.test(safeErrorMessage(error));
}

function retryDelayMs(attemptCount: number): number {
  return Math.min(RETRY_MAX_MS, RETRY_BASE_MS * (2 ** Math.max(0, Math.min(attemptCount - 1, 8))));
}

function appointmentContext(row: ExportWorkRow): AppointmentExportContext {
  return {
    appointment_id: row.appointment_id,
    appointment_status: row.appointment_status,
    appointment_study_instance_uid: row.appointment_study_instance_uid,
    appointment_accession_number: row.appointment_accession_number,
    appointment_booking_date: row.appointment_booking_date,
    patient_primary_id: row.patient_primary_id,
    patient_national_id: row.patient_national_id,
    patient_mrn: row.patient_mrn,
    patient_name: row.patient_name,
    patient_birth_date: row.patient_birth_date,
    patient_sex: row.patient_sex,
    modality_code: row.modality_code,
  };
}

async function loadExportWork(id: number): Promise<ExportWorkRow | null> {
  const { rows } = await pool.query<ExportWorkRow>(
    `
      select
        e.*,
        d.original_filename as document_original_filename,
        d.stored_path as document_stored_path,
        d.mime_type as document_mime_type,
        d.document_type,
        b.status as appointment_status,
        b.study_instance_uid as appointment_study_instance_uid,
        ('V2-' || lpad(b.id::text, 6, '0')) as appointment_accession_number,
        b.booking_date::text as appointment_booking_date,
        p.identifier_value as patient_primary_id,
        p.national_id as patient_national_id,
        p.mrn as patient_mrn,
        coalesce(p.english_full_name, p.arabic_full_name) as patient_name,
        p.estimated_date_of_birth::text as patient_birth_date,
        p.sex as patient_sex,
        m.code as modality_code
      from clinical_document_exports e
      join documents d on d.id = e.document_id
      join appointments_v2.bookings b on b.id = e.appointment_id
      join patients p on p.id = b.patient_id
      left join modalities m on m.id = b.modality_id
      where e.id = $1
      limit 1
    `,
    [id],
  );
  return rows[0] || null;
}

async function resolveTargetStudy(context: AppointmentExportContext): Promise<OrthancStudyDetails> {
  const client = await createAuthoritativeOrthancClient();
  const expectedPatientIds = [context.patient_primary_id, context.patient_national_id, context.patient_mrn].filter((value): value is string => Boolean(String(value || "").trim()));
  const uidResult = context.appointment_study_instance_uid
    ? await client.findStudy({ studyInstanceUid: context.appointment_study_instance_uid, accessionNumber: context.appointment_accession_number })
    : { status: "not_found" as const, matchKey: "study_instance_uid" as const, study: null };
  const result = uidResult.status === "not_found"
    ? await client.findStudy({ accessionNumber: context.appointment_accession_number, expectedPatientIds, expectedModalityCode: context.modality_code, expectedStudyDate: context.appointment_booking_date })
    : uidResult;
  if (result.status === "ambiguous") throw new ClinicalDocumentExportBlockedError(result.reason || "ambiguous_study_match", "Orthanc study matching is ambiguous and needs review.");
  if (result.status === "not_found" || !result.study) throw new Error("Orthanc study was not found yet.");
  if (!result.study.studyInstanceUid) throw new ClinicalDocumentExportBlockedError("missing_study_instance_uid", "The matched Orthanc study has no StudyInstanceUID.");
  const expectedAccession = context.appointment_accession_number.trim();
  if (result.study.accessionNumber && result.study.accessionNumber !== expectedAccession) throw new ClinicalDocumentExportBlockedError("accession_conflict", "The matched Orthanc study accession does not match the appointment.");
  if (result.study.patientId && expectedPatientIds.length && !expectedPatientIds.some((value) => value.toUpperCase() === result.study!.patientId!.toUpperCase())) throw new ClinicalDocumentExportBlockedError("patient_identity_conflict", "The matched Orthanc study patient identity does not match the appointment.");
  return result.study;
}

async function ensureStableIdentifiers(row: ExportWorkRow, targetStudyUid: string): Promise<{ seriesInstanceUid: string; sopInstanceUid: string }> {
  const client = await pool.connect();
  try {
    await client.query("begin");
    await client.query("select pg_advisory_xact_lock($1::bigint)", [row.appointment_id]);
    const seriesResult = await client.query<{ series_instance_uid: string | null }>(
      `select distinct series_instance_uid from clinical_document_exports where appointment_id=$1 and destination_key=$2 and series_instance_uid is not null`,
      [row.appointment_id, CLINICAL_DOCUMENT_EXPORT_DESTINATION],
    );
    const seriesUids = [...new Set(seriesResult.rows.map((value) => value.series_instance_uid).filter((value): value is string => Boolean(value)))];
    if (seriesUids.length > 1) throw new ClinicalDocumentExportBlockedError("series_uid_conflict", "Multiple RISpro clinical document series identifiers exist for this appointment.");
    const seriesInstanceUid = row.series_instance_uid || seriesUids[0] || createClinicalDocumentUid();
    const sopInstanceUid = row.sop_instance_uid || createClinicalDocumentUid();
    const duplicate = await client.query<{ id: number }>(
      `select id from clinical_document_exports where appointment_id=$1 and destination_key=$2 and sop_instance_uid=$3 and id<>$4 limit 1`,
      [row.appointment_id, CLINICAL_DOCUMENT_EXPORT_DESTINATION, sopInstanceUid, row.id],
    );
    if (duplicate.rowCount) throw new ClinicalDocumentExportBlockedError("sop_uid_conflict", "The generated SOPInstanceUID is already assigned to another export.");
    const updated = await client.query(
      `update clinical_document_exports set study_instance_uid=coalesce(study_instance_uid,$2), series_instance_uid=coalesce(series_instance_uid,$3), sop_instance_uid=coalesce(sop_instance_uid,$4), updated_at=now() where id=$1 and status='exporting' and export_lease_owner=$5 returning series_instance_uid,sop_instance_uid`,
      [row.id, targetStudyUid, seriesInstanceUid, sopInstanceUid, row.export_lease_owner],
    );
    if (!updated.rows[0]) throw new Error("Clinical document export lease was lost before DICOM creation.");
    await client.query("commit");
    return { seriesInstanceUid: String(updated.rows[0].series_instance_uid), sopInstanceUid: String(updated.rows[0].sop_instance_uid) };
  } catch (error) {
    await client.query("rollback");
    throw error;
  } finally {
    client.release();
  }
}

function verifyInstance(instance: OrthancInstanceDetails, row: ExportWorkRow, study: OrthancStudyDetails, identifiers: { seriesInstanceUid: string; sopInstanceUid: string }): void {
  const expectedPatientId = study.patientId || row.patient_primary_id || row.patient_national_id || row.patient_mrn;
  if (instance.studyInstanceUid !== study.studyInstanceUid) throw new ClinicalDocumentExportBlockedError("study_instance_uid_conflict", "Orthanc returned an instance in a different study.");
  if (instance.seriesInstanceUid !== identifiers.seriesInstanceUid) throw new ClinicalDocumentExportBlockedError("series_instance_uid_conflict", "Orthanc returned an instance in a different series.");
  if (instance.sopInstanceUid !== identifiers.sopInstanceUid) throw new ClinicalDocumentExportBlockedError("sop_instance_uid_conflict", "Orthanc returned a different SOPInstanceUID.");
  if (expectedPatientId && instance.patientId && instance.patientId !== expectedPatientId) throw new ClinicalDocumentExportBlockedError("patient_identity_conflict", "Orthanc returned an instance for a different patient.");
  if (row.appointment_accession_number && instance.accessionNumber && instance.accessionNumber !== row.appointment_accession_number) throw new ClinicalDocumentExportBlockedError("accession_conflict", "Orthanc returned an instance with a different accession number.");
}

async function markExported(row: ExportWorkRow, study: OrthancStudyDetails, instance: OrthancInstanceDetails): Promise<void> {
  const result = await pool.query(
    `update clinical_document_exports set status='exported', next_retry_at=null, last_error=null, orthanc_study_id=$2, orthanc_series_id=$3, orthanc_instance_id=$4, study_instance_uid=$5, series_instance_uid=$6, sop_instance_uid=$7, exported_at=coalesce(exported_at,now()), verified_at=now(), export_lease_owner=null, export_lease_expires_at=null, updated_at=now() where id=$1 and status='exporting' and export_lease_owner=$8`,
    [row.id, instance.orthancStudyId || study.orthancStudyId, instance.orthancSeriesId, instance.orthancInstanceId, study.studyInstanceUid, instance.seriesInstanceUid, instance.sopInstanceUid, row.export_lease_owner],
  );
  if (result.rowCount !== 1) return;
  await logAuditEntry({ entityType: "clinical_document_export", entityId: row.id, actionType: "clinical_document_export_succeeded", oldValues: { status: "exporting" }, newValues: { status: "exported", orthancStudyId: instance.orthancStudyId, orthancSeriesId: instance.orthancSeriesId, orthancInstanceId: instance.orthancInstanceId }, changedByUserId: null });
}

async function markFailure(row: ExportWorkRow, error: unknown): Promise<void> {
  const message = safeErrorMessage(error);
  const retryable = isRetryableError(error);
  const exhausted = retryable && row.attempt_count >= MAX_AUTOMATIC_ATTEMPTS;
  const nextRetryAt = !retryable || exhausted ? null : new Date(Date.now() + retryDelayMs(row.attempt_count)).toISOString();
  const status: ClinicalDocumentExportStatus = retryable ? "failed" : "blocked";
  await pool.query(
    `update clinical_document_exports set status=$2, next_retry_at=$3, last_error=$4, export_lease_owner=null, export_lease_expires_at=null, updated_at=now() where id=$1 and status='exporting' and export_lease_owner=$5`,
    [row.id, status, nextRetryAt, exhausted ? "Automatic retry limit reached. Manual retry is required." : message, row.export_lease_owner],
  );
  await logAuditEntry({ entityType: "clinical_document_export", entityId: row.id, actionType: status === "blocked" ? "clinical_document_export_blocked" : "clinical_document_export_failed", oldValues: { status: "exporting" }, newValues: { status, retryable, nextRetryAt, error: exhausted ? "automatic_retry_limit_reached" : message, code: error instanceof ClinicalDocumentExportBlockedError ? error.code : errorCode(error) }, changedByUserId: null });
  if (error instanceof ClinicalDocumentExportBlockedError && ["patient_identity_conflict", "study_instance_uid_conflict", "accession_conflict"].includes(error.code)) await logAuditEntry({ entityType: "clinical_document_export", entityId: row.id, actionType: "clinical_document_export_identity_conflict", oldValues: null, newValues: { code: error.code }, changedByUserId: null });
}

async function processClaimedExport(row: ExportWorkRow): Promise<void> {
  if (row.appointment_status !== "completed") {
    await pool.query(`update clinical_document_exports set status='pending', next_retry_at=null, export_lease_owner=null, export_lease_expires_at=null, updated_at=now() where id=$1 and export_lease_owner=$2`, [row.id, row.export_lease_owner]);
    return;
  }
  try {
    const study = await resolveTargetStudy(appointmentContext(row));
    if (row.study_instance_uid && row.study_instance_uid !== study.studyInstanceUid) throw new ClinicalDocumentExportBlockedError("study_instance_uid_conflict", "The resolved Orthanc study differs from the study persisted for this export.");
    const identifiers = await ensureStableIdentifiers(row, study.studyInstanceUid!);
    const client = await createAuthoritativeOrthancClient();
    let instance = await client.findInstanceBySopInstanceUid(identifiers.sopInstanceUid);
    if (instance) {
      verifyInstance(instance, row, study, identifiers);
    } else {
      const source = await readFile(getDocumentAbsolutePath({ stored_path: row.document_stored_path }));
      const dicom = await createClinicalDocumentDicom(source, row.document_mime_type, { studyInstanceUid: study.studyInstanceUid!, seriesInstanceUid: identifiers.seriesInstanceUid, sopInstanceUid: identifiers.sopInstanceUid, patientId: study.patientId || row.patient_primary_id || row.patient_national_id || row.patient_mrn || "UNKNOWN", patientName: study.patientName || row.patient_name || "UNKNOWN", patientBirthDate: study.patientBirthDate || row.patient_birth_date, patientSex: study.patientSex || row.patient_sex, accessionNumber: row.appointment_accession_number, documentTitle: row.document_type || row.document_original_filename, originalFilename: row.document_original_filename });
      try {
        instance = await client.uploadDicomInstance(dicom, study.studyInstanceUid!);
      } catch (error) {
        const recovered = await client.findInstanceBySopInstanceUid(identifiers.sopInstanceUid).catch(() => null);
        if (!recovered) throw error;
        instance = recovered;
      }
      verifyInstance(instance, row, study, identifiers);
    }
    await markExported(row, study, instance);
  } catch (error) {
    await markFailure(row, error);
  }
}

export async function claimNextClinicalDocumentExport(workerId: string, leaseSeconds = EXPORT_LEASE_SECONDS): Promise<ExportWorkRow | null> {
  const safeLeaseSeconds = Math.max(30, Math.min(Math.floor(leaseSeconds), 3600));
  const { rows } = await pool.query<ExportWorkRow>(
    `
      with candidate as (
        select e.id, e.status as previous_status
        from clinical_document_exports e
        join appointments_v2.bookings b on b.id=e.appointment_id
        where b.status='completed'
          and (
            (e.status in ('pending','failed') and (e.next_retry_at is null or e.next_retry_at <= now()))
            or (e.status='exporting' and e.export_lease_expires_at < now())
          )
        order by e.created_at asc, e.id asc
        for update of e skip locked
        limit 1
      )
      update clinical_document_exports e
      set status='exporting', attempt_count=e.attempt_count+1, last_attempt_at=now(), last_error=null, next_retry_at=null, export_lease_owner=$1, export_lease_expires_at=now()+($2::text || ' seconds')::interval, updated_at=now()
      from candidate
      where e.id=candidate.id
      returning e.*
    `,
    [workerId, safeLeaseSeconds],
  );
  const row = rows[0] || null;
  if (row) await logAuditEntry({ entityType: "clinical_document_export", entityId: row.id, actionType: "clinical_document_export_started", oldValues: { status: "pending" }, newValues: { status: "exporting", attemptCount: row.attempt_count }, changedByUserId: null });
  return row ? await loadExportWork(row.id) : null;
}

export async function runClinicalDocumentExportTick(options: { batchSize?: number } = {}): Promise<{ reconciled: number; processed: number; exported: number; failed: number }> {
  const reconciled = await reconcileClinicalDocumentExports();
  const settings = await readAuthoritativeOrthancSettings();
  if (!settings.enabled) return { reconciled, processed: 0, exported: 0, failed: 0 };
  const workerId = `clinical-document-export-${randomUUID()}`;
  let processed = 0;
  let exported = 0;
  let failed = 0;
  for (let index = 0; index < Math.max(1, options.batchSize ?? DEFAULT_BATCH_SIZE); index += 1) {
    const row = await claimNextClinicalDocumentExport(workerId);
    if (!row) break;
    processed += 1;
    try { await processClaimedExport(row); } catch (error) { console.warn(JSON.stringify({ type: "clinical_document_export_processing_error", exportId: row.id, error: safeErrorMessage(error) })); }
    const latest = await loadExportWork(row.id);
    if (latest?.status === "exported") exported += 1;
    else if (latest?.status === "failed" || latest?.status === "blocked") failed += 1;
  }
  return { reconciled, processed, exported, failed };
}

export interface ClinicalDocumentExportWorker { stop(): Promise<void> }
let workerInterval: NodeJS.Timeout | null = null;
let workerRunning = false;
let workerStopped = false;

export async function startClinicalDocumentExportWorker(options: { intervalMs?: number; batchSize?: number } = {}): Promise<ClinicalDocumentExportWorker> {
  const intervalMs = Math.max(5_000, options.intervalMs ?? 15_000);
  workerStopped = false;
  await runClinicalDocumentExportTick({ batchSize: options.batchSize }).catch((error) => console.warn(JSON.stringify({ type: "clinical_document_export_startup_tick_failed", error: safeErrorMessage(error) })));
  workerInterval = setInterval(() => {
    if (workerRunning || workerStopped) return;
    workerRunning = true;
    void runClinicalDocumentExportTick({ batchSize: options.batchSize }).catch((error) => console.warn(JSON.stringify({ type: "clinical_document_export_tick_failed", error: safeErrorMessage(error) }))).finally(() => { workerRunning = false; });
  }, intervalMs);
  workerInterval.unref();
  return { async stop() { workerStopped = true; if (workerInterval) { clearInterval(workerInterval); workerInterval = null; } while (workerRunning) await new Promise((resolve) => setTimeout(resolve, 100)); } };
}

export async function listClinicalDocumentExportsForAppointment(appointmentId: number): Promise<ClinicalDocumentExportRow[]> {
  const { rows } = await pool.query<ClinicalDocumentExportRow>(`select * from clinical_document_exports where appointment_id=$1 order by created_at asc, id asc`, [appointmentId]);
  return rows;
}

export async function assertClinicalDocumentExportAppointmentAccess(appointmentId: number, role: string, modalityId: number | null): Promise<void> {
  const { rows } = await pool.query<{ modality_id: number | null }>(`select modality_id from appointments_v2.bookings where id=$1 limit 1`, [appointmentId]);
  if (!rows[0]) throw new HttpError(404, "Appointment not found.");
  if (role === "modality_staff" && (!modalityId || Number(rows[0].modality_id) !== modalityId)) throw new HttpError(403, "This appointment is outside the requested modality scope.");
}

export async function retryClinicalDocumentExport(exportId: UserId, changedByUserId: UserId): Promise<ClinicalDocumentExportRow> {
  const id = normalizePositiveInteger(exportId, "exportId");
  const { rows } = await pool.query<ClinicalDocumentExportRow>(`update clinical_document_exports set status='pending', attempt_count=0, next_retry_at=now(), last_error=null, export_lease_owner=null, export_lease_expires_at=null, updated_at=now() where id=$1 and status='failed' returning *`, [id]);
  const row = rows[0];
  if (!row) throw new HttpError(409, "Only failed clinical document exports can be retried.");
  await logAuditEntry({ entityType: "clinical_document_export", entityId: row.id, actionType: "clinical_document_export_manual_retry_requested", oldValues: { status: "failed" }, newValues: { status: "pending" }, changedByUserId });
  return row;
}

export async function reconcileClinicalDocumentExportsManually(changedByUserId: OptionalUserId): Promise<{ queued: number }> {
  const queued = await reconcileClinicalDocumentExports(changedByUserId);
  return { queued };
}

export async function queueClinicalDocumentExportForCompletedAppointment(appointmentId: number, changedByUserId: OptionalUserId = null): Promise<number[]> {
  return enqueueClinicalDocumentExportsForAppointment(appointmentId, changedByUserId);
}
