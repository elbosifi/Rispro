import { createHash, randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { pool } from "../db/pool.js";
import { HttpError } from "../utils/http-error.js";
import { normalizePositiveInteger } from "../utils/normalize.js";
import type { OptionalUserId, UserId } from "../types/http.js";
import { logAuditEntry } from "./audit-service.js";
import { getDocumentAbsolutePath } from "./document-service.js";
import { createClinicalDocumentDicom, createClinicalDocumentSecondaryCapture, createClinicalDocumentUid, normalizeRisproModalityCode } from "./clinical-document-dicom.js";
import { cleanupRenderedClinicalDocument, readRenderedRgbPage, renderClinicalDocument, type RenderedClinicalDocument } from "./clinical-document-renderer.js";
import { createAuthoritativeOrthancClient, readAuthoritativeOrthancSettings, type AuthoritativeOrthancClient, type OrthancInstanceDetails, type OrthancStudyDetails } from "./authoritative-orthanc-service.js";
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
  representation_type: "encapsulated_pdf" | "secondary_capture";
  expected_page_count: number | null;
  exported_page_count: number;
  verified_page_count: number;
  series_number: number | null;
  exported_at: string | null;
  verified_at: string | null;
  export_lease_owner?: string | null;
  export_lease_expires_at?: string | null;
  created_at: string;
  updated_at: string;
};

type ClinicalDocumentExportInstanceRow = { id: number; export_id: number; page_number: number; instance_number: number; sop_instance_uid: string; series_instance_uid: string; pixel_sha256: string | null; rows: number; columns: number; status: string; orthanc_instance_id: string | null; orthanc_series_id: string | null; };

export type ClinicalDocumentExportWorkRow = ClinicalDocumentExportRow & {
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

export type ClinicalDocumentProcessorDependencies = Readonly<{
  createOrthancClient: () => Promise<Pick<AuthoritativeOrthancClient, "findStudy" | "findInstanceBySopInstanceUid" | "uploadDicomInstance">>;
  readDocumentBytes: (storedPath: string) => Promise<Buffer>;
  renderDocument: typeof renderClinicalDocument;
  readRenderedPage: typeof readRenderedRgbPage;
  cleanupRenderedDocument: typeof cleanupRenderedClinicalDocument;
}>;

const productionClinicalDocumentProcessorDependencies: ClinicalDocumentProcessorDependencies = Object.freeze({
  createOrthancClient: createAuthoritativeOrthancClient,
  readDocumentBytes: (storedPath) => readFile(getDocumentAbsolutePath({ stored_path: storedPath })),
  renderDocument: renderClinicalDocument,
  readRenderedPage: readRenderedRgbPage,
  cleanupRenderedDocument: cleanupRenderedClinicalDocument,
});

type AppointmentExportContext = Pick<ClinicalDocumentExportWorkRow, "appointment_id" | "appointment_status" | "appointment_study_instance_uid" | "appointment_accession_number" | "appointment_booking_date" | "patient_primary_id" | "patient_national_id" | "patient_mrn" | "patient_name" | "patient_birth_date" | "patient_sex" | "modality_code">;

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

export function sanitizeClinicalDocumentExportError(value: unknown): string {
  const raw = value instanceof Error ? value.message : String(value ?? "");
  const redacted = raw
    .replace(/(https?:\/\/)([^\s/@]+)@/gi, "$1[redacted]@")
    .replace(/([?&](?:token|access_token|api[_-]?key|apikey|password)\s*=)[^&#\s]*/gi, "$1[redacted]")
    .replace(/\b(authorization|proxy-authorization|cookie|set-cookie|x-api-key|api-key|apikey)\s*[:=]\s*[^\r\n]*/gi, "$1: [redacted]")
    .replace(/\b(?:basic|bearer|token|apikey|api[- ]?key)\s+[A-Za-z0-9._~+\/-]+=*/gi, "authentication [redacted]")
    .replace(/(?:[A-Za-z]:\\|\\\\)[^\s"']+/g, "local path")
    .replace(/\/(?:srv|home|var|tmp|opt|mnt|data)(?:\/[^\s"']*)?/gi, "local path")
    .replace(/[\r\n\t]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return redacted.slice(0, 300) || "Clinical document export failed.";
}

function logClinicalDocumentExportWorker(event: string, fields: Record<string, unknown> = {}): void {
  console.info(JSON.stringify({ type: "clinical_document_export_worker", event, ...fields }));
}

function isRetryableError(error: unknown): boolean {
  const code = errorCode(error);
  if (["orthanc_unavailable", "orthanc_timeout"].includes(code)) return true;
  if (code === "orthanc_auth_failed" || code === "orthanc_invalid_response" || code === "orthanc_study_mismatch" || code === "orthanc_invalid_dicom") return false;
  return /study was not found|not available|temporarily|connection refused|timeout|fetch failed|econnrefused|enotfound/i.test(sanitizeClinicalDocumentExportError(error));
}

function retryDelayMs(attemptCount: number): number {
  return Math.min(RETRY_MAX_MS, RETRY_BASE_MS * (2 ** Math.max(0, Math.min(attemptCount - 1, 8))));
}

function appointmentContext(row: ClinicalDocumentExportWorkRow): AppointmentExportContext {
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

async function loadExportWork(id: number): Promise<ClinicalDocumentExportWorkRow | null> {
  const { rows } = await pool.query<ClinicalDocumentExportWorkRow>(
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

async function resolveTargetStudy(context: AppointmentExportContext, dependencies: ClinicalDocumentProcessorDependencies): Promise<OrthancStudyDetails> {
  const client = await dependencies.createOrthancClient();
  const expectedPatientIds = [context.patient_primary_id, context.patient_national_id, context.patient_mrn].filter((value): value is string => Boolean(String(value || "").trim()));
  const uidResult = context.appointment_study_instance_uid
    ? await client.findStudy({ studyInstanceUid: context.appointment_study_instance_uid, accessionNumber: context.appointment_accession_number })
    : { status: "not_found" as const, matchKey: "study_instance_uid" as const, study: null };
  const modality = normalizeRisproModalityCode(context.modality_code);
  if (!modality) throw new ClinicalDocumentExportBlockedError("unmapped_modality", "The RISpro modality code cannot be mapped to a DICOM modality.");
  const result = uidResult.status === "not_found"
    ? await client.findStudy({ accessionNumber: context.appointment_accession_number, expectedPatientIds, expectedModalityCode: modality, expectedStudyDate: context.appointment_booking_date })
    : uidResult;
  if (result.status === "ambiguous") throw new ClinicalDocumentExportBlockedError(result.reason || "ambiguous_study_match", "Orthanc study matching is ambiguous and needs review.");
  if (result.status === "not_found" || !result.study) throw new Error("Orthanc study was not found yet.");
  if (!result.study.studyInstanceUid) throw new ClinicalDocumentExportBlockedError("missing_study_instance_uid", "The matched Orthanc study has no StudyInstanceUID.");
  if (result.study.modalitiesInStudy.length && !result.study.modalitiesInStudy.map((value) => value.toUpperCase()).includes(modality)) throw new ClinicalDocumentExportBlockedError("modality_conflict", "The matched Orthanc study modality does not match the appointment.");
  const expectedAccession = context.appointment_accession_number.trim();
  if (result.study.accessionNumber && result.study.accessionNumber !== expectedAccession) throw new ClinicalDocumentExportBlockedError("accession_conflict", "The matched Orthanc study accession does not match the appointment.");
  if (result.study.patientId && expectedPatientIds.length && !expectedPatientIds.some((value) => value.toUpperCase() === result.study!.patientId!.toUpperCase())) throw new ClinicalDocumentExportBlockedError("patient_identity_conflict", "The matched Orthanc study patient identity does not match the appointment.");
  return result.study;
}

async function ensureStableIdentifiers(row: ClinicalDocumentExportWorkRow, targetStudyUid: string): Promise<{ seriesInstanceUid: string; sopInstanceUid: string }> {
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

function verifyInstance(instance: OrthancInstanceDetails, row: ClinicalDocumentExportWorkRow, study: OrthancStudyDetails, identifiers: { seriesInstanceUid: string; sopInstanceUid: string }): void {
  const expectedPatientId = study.patientId || row.patient_primary_id || row.patient_national_id || row.patient_mrn;
  if (instance.studyInstanceUid !== study.studyInstanceUid) throw new ClinicalDocumentExportBlockedError("study_instance_uid_conflict", "Orthanc returned an instance in a different study.");
  if (instance.seriesInstanceUid !== identifiers.seriesInstanceUid) throw new ClinicalDocumentExportBlockedError("series_instance_uid_conflict", "Orthanc returned an instance in a different series.");
  if (instance.sopInstanceUid !== identifiers.sopInstanceUid) throw new ClinicalDocumentExportBlockedError("sop_instance_uid_conflict", "Orthanc returned a different SOPInstanceUID.");
  if (expectedPatientId && instance.patientId && instance.patientId !== expectedPatientId) throw new ClinicalDocumentExportBlockedError("patient_identity_conflict", "Orthanc returned an instance for a different patient.");
  if (row.appointment_accession_number && instance.accessionNumber && instance.accessionNumber !== row.appointment_accession_number) throw new ClinicalDocumentExportBlockedError("accession_conflict", "Orthanc returned an instance with a different accession number.");
}

function verifySecondaryCaptureInstance(instance: OrthancInstanceDetails, row: ClinicalDocumentExportWorkRow, study: OrthancStudyDetails, page: ClinicalDocumentExportInstanceRow, modality: string): void {
  verifyInstance(instance, row, study, { seriesInstanceUid: page.series_instance_uid, sopInstanceUid: page.sop_instance_uid });
  if (instance.modality !== modality) throw new ClinicalDocumentExportBlockedError("modality_conflict", "Orthanc returned an instance with a different modality.");
}

async function renewLease(row: ClinicalDocumentExportWorkRow): Promise<void> {
  const result = await pool.query("update clinical_document_exports set export_lease_expires_at=now()+($3::text || ' seconds')::interval, updated_at=now() where id=$1 and status='exporting' and export_lease_owner=$2", [row.id, row.export_lease_owner, EXPORT_LEASE_SECONDS]);
  if (result.rowCount !== 1) throw new Error("Clinical document export lease was lost.");
}

async function prepareSecondaryCapturePages(row: ClinicalDocumentExportWorkRow, studyUid: string, rendered: RenderedClinicalDocument, dependencies: ClinicalDocumentProcessorDependencies): Promise<ClinicalDocumentExportInstanceRow[]> {
  const client = await pool.connect();
  try {
    await client.query("begin"); await client.query("select pg_advisory_xact_lock($1::bigint)", [row.appointment_id]);
    const existing = await client.query<{ series_instance_uid: string | null; series_number: number | null }>("select distinct series_instance_uid,series_number from clinical_document_exports where appointment_id=$1 and destination_key=$2 and representation_type='secondary_capture' and series_instance_uid is not null", [row.appointment_id, CLINICAL_DOCUMENT_EXPORT_DESTINATION]);
    const series = [...new Set(existing.rows.map((value) => value.series_instance_uid).filter(Boolean))]; if (series.length > 1) throw new ClinicalDocumentExportBlockedError("series_uid_conflict", "Multiple RISpro scanned-document series identifiers exist for this appointment.");
    const seriesUid = row.series_instance_uid || series[0] || createClinicalDocumentUid(); const seriesNumber = row.series_number || existing.rows.find((value) => value.series_number)?.series_number || 9000;
    const max = await client.query<{ max: number | null }>("select max(i.instance_number) from clinical_document_export_instances i join clinical_document_exports e on e.id=i.export_id where e.appointment_id=$1 and i.series_instance_uid=$2", [row.appointment_id, seriesUid]);
    const start = Number(max.rows[0]?.max || 0) + 1;
    const expected = await client.query<{ expected_page_count: number | null }>("select expected_page_count from clinical_document_exports where id=$1 and status='exporting' and export_lease_owner=$2 for update", [row.id, row.export_lease_owner]);
    if (!expected.rows[0]) throw new Error("Clinical document export lease was lost before page preparation.");
    if (expected.rows[0].expected_page_count != null && Number(expected.rows[0].expected_page_count) !== rendered.pages.length) throw new ClinicalDocumentExportBlockedError("page_set_conflict", "The persisted clinical document page set does not match the rendered document.");
    const updated = await client.query("update clinical_document_exports set study_instance_uid=coalesce(study_instance_uid,$2),series_instance_uid=coalesce(series_instance_uid,$3),series_number=coalesce(series_number,$4),expected_page_count=coalesce(expected_page_count,$5),updated_at=now() where id=$1 and status='exporting' and export_lease_owner=$6", [row.id, studyUid, seriesUid, seriesNumber, rendered.pages.length, row.export_lease_owner]);
    if (updated.rowCount !== 1) throw new Error("Clinical document export lease was lost before page preparation.");
    const persisted = await client.query<ClinicalDocumentExportInstanceRow>("select * from clinical_document_export_instances where export_id=$1 order by page_number", [row.id]);
    const existingPages = new Map(persisted.rows.map((page) => [page.page_number, page]));
    for (const page of rendered.pages) {
      const pixels = await dependencies.readRenderedPage(page.path); const sha = createHash("sha256").update(pixels).digest("hex");
      const existingPage = existingPages.get(page.pageNumber);
      if (existingPage && (existingPage.rows !== page.rows || existingPage.columns !== page.columns || existingPage.pixel_sha256 !== sha || existingPage.series_instance_uid !== seriesUid)) throw new ClinicalDocumentExportBlockedError("page_set_conflict", "The persisted clinical document page set does not match the rendered document.");
      await client.query("insert into clinical_document_export_instances(export_id,page_number,instance_number,sop_instance_uid,series_instance_uid,pixel_sha256,rows,columns) values($1,$2,$3,$4,$5,$6,$7,$8) on conflict(export_id,page_number) do nothing", [row.id, page.pageNumber, start + page.pageNumber - 1, createClinicalDocumentUid(), seriesUid, sha, page.rows, page.columns]);
    }
    const pages = await client.query<ClinicalDocumentExportInstanceRow>("select * from clinical_document_export_instances where export_id=$1 order by page_number", [row.id]);
    if (pages.rowCount !== rendered.pages.length) throw new ClinicalDocumentExportBlockedError("page_set_conflict", "The persisted clinical document page set does not match the rendered document.");
    await client.query("commit"); return pages.rows;
  } catch (error) { await client.query("rollback"); throw error; } finally { client.release(); }
}

async function markSecondaryCaptureComplete(row: ClinicalDocumentExportWorkRow, study: OrthancStudyDetails): Promise<void> {
  const counts = await pool.query<{ expected: number | null; total: number; verified: number; series_id: string | null }>("select e.expected_page_count expected,count(i.*)::int total,count(i.*) filter(where i.status='verified')::int verified,max(i.orthanc_series_id) series_id from clinical_document_exports e left join clinical_document_export_instances i on i.export_id=e.id where e.id=$1 and e.status='exporting' and e.export_lease_owner=$2 group by e.expected_page_count", [row.id, row.export_lease_owner]);
  const count = counts.rows[0]; if (!count) throw new Error("Clinical document export lease was lost before completion."); if (!count.expected || count.total !== count.expected || count.verified !== count.total) throw new Error("Not every clinical document page has been verified.");
  const updated = await pool.query("update clinical_document_exports set status='exported',exported_page_count=$2,verified_page_count=$2,orthanc_study_id=$3,orthanc_series_id=$4,exported_at=coalesce(exported_at,now()),verified_at=now(),last_error=null,next_retry_at=null,export_lease_owner=null,export_lease_expires_at=null,updated_at=now() where id=$1 and status='exporting' and export_lease_owner=$5", [row.id, count.total, study.orthancStudyId, count.series_id, row.export_lease_owner]);
  if (updated.rowCount !== 1) throw new Error("Clinical document export lease was lost during completion.");
  await logAuditEntry({ entityType: "clinical_document_export", entityId: row.id, actionType: "clinical_document_export_succeeded", oldValues: { status: "exporting" }, newValues: { status: "exported", representationType: "secondary_capture", pageCount: count.total, orthancSeriesId: count.series_id }, changedByUserId: null });
}

async function processSecondaryCaptureExport(row: ClinicalDocumentExportWorkRow, study: OrthancStudyDetails, dependencies: ClinicalDocumentProcessorDependencies): Promise<void> {
  const modality = normalizeRisproModalityCode(row.modality_code); if (!modality) throw new ClinicalDocumentExportBlockedError("unmapped_modality", "The RISpro modality code cannot be mapped to a DICOM modality.");
  let rendered: RenderedClinicalDocument | null = null;
  let activePage: ClinicalDocumentExportInstanceRow | null = null;
  try {
    await renewLease(row); const source = await dependencies.readDocumentBytes(row.document_stored_path); rendered = await dependencies.renderDocument(source, row.document_mime_type, { onProgress: async () => renewLease(row) });
    const pages = await prepareSecondaryCapturePages(row, study.studyInstanceUid!, rendered, dependencies); const client = await dependencies.createOrthancClient();
    for (const page of pages) {
      activePage = page;
      await renewLease(row); let instance = await client.findInstanceBySopInstanceUid(page.sop_instance_uid);
      if (!instance) {
        const renderedPage = rendered.pages[page.page_number - 1]!; const pixels = await dependencies.readRenderedPage(renderedPage.path);
        const dicom = await createClinicalDocumentSecondaryCapture(pixels, page.rows, page.columns, { studyInstanceUid: study.studyInstanceUid!, seriesInstanceUid: page.series_instance_uid, sopInstanceUid: page.sop_instance_uid, modality, seriesNumber: row.series_number || 9000, instanceNumber: page.instance_number, patientId: study.patientId || row.patient_primary_id || row.patient_national_id || row.patient_mrn || "UNKNOWN", patientName: study.patientName || row.patient_name || "UNKNOWN", patientBirthDate: study.patientBirthDate || row.patient_birth_date, patientSex: study.patientSex || row.patient_sex, studyDate: study.studyDate || row.appointment_booking_date, accessionNumber: row.appointment_accession_number });
        try { instance = await client.uploadDicomInstance(dicom, study.studyInstanceUid!); } catch (error) { instance = await client.findInstanceBySopInstanceUid(page.sop_instance_uid).catch(() => null); if (!instance) throw error; }
      }
      verifySecondaryCaptureInstance(instance, row, study, page, modality);
      const verified = await pool.query("update clinical_document_export_instances i set status='verified',orthanc_instance_id=$2,orthanc_series_id=$3,exported_at=coalesce(exported_at,now()),verified_at=now(),last_error=null,updated_at=now() where i.id=$1 and exists(select 1 from clinical_document_exports e where e.id=i.export_id and e.status='exporting' and e.export_lease_owner=$4)", [page.id, instance.orthancInstanceId, instance.orthancSeriesId, row.export_lease_owner]);
      if (verified.rowCount !== 1) throw new Error("Clinical document export lease was lost after page upload; the next worker will reconcile the persisted SOPInstanceUID.");
      await pool.query("update clinical_document_exports set exported_page_count=(select count(*) from clinical_document_export_instances where export_id=$1 and exported_at is not null),verified_page_count=(select count(*) from clinical_document_export_instances where export_id=$1 and status='verified'),updated_at=now() where id=$1", [row.id]);
      activePage = null;
    }
    await markSecondaryCaptureComplete(row, study);
  } catch (error) {
    if (activePage) await pool.query("update clinical_document_export_instances i set status=$2,last_error=$3,updated_at=now() where i.id=$1 and i.status<>'verified' and exists(select 1 from clinical_document_exports e where e.id=i.export_id and e.status='exporting' and e.export_lease_owner=$4)", [activePage.id, error instanceof ClinicalDocumentExportBlockedError ? "blocked" : "failed", sanitizeClinicalDocumentExportError(error), row.export_lease_owner]).catch(() => undefined);
    throw error;
  } finally { await dependencies.cleanupRenderedDocument(rendered); }
}

async function markExported(row: ClinicalDocumentExportWorkRow, study: OrthancStudyDetails, instance: OrthancInstanceDetails): Promise<void> {
  const result = await pool.query(
    `update clinical_document_exports set status='exported', next_retry_at=null, last_error=null, orthanc_study_id=$2, orthanc_series_id=$3, orthanc_instance_id=$4, study_instance_uid=$5, series_instance_uid=$6, sop_instance_uid=$7, exported_at=coalesce(exported_at,now()), verified_at=now(), export_lease_owner=null, export_lease_expires_at=null, updated_at=now() where id=$1 and status='exporting' and export_lease_owner=$8`,
    [row.id, instance.orthancStudyId || study.orthancStudyId, instance.orthancSeriesId, instance.orthancInstanceId, study.studyInstanceUid, instance.seriesInstanceUid, instance.sopInstanceUid, row.export_lease_owner],
  );
  if (result.rowCount !== 1) return;
  await logAuditEntry({ entityType: "clinical_document_export", entityId: row.id, actionType: "clinical_document_export_succeeded", oldValues: { status: "exporting" }, newValues: { status: "exported", orthancStudyId: instance.orthancStudyId, orthancSeriesId: instance.orthancSeriesId, orthancInstanceId: instance.orthancInstanceId }, changedByUserId: null });
}

async function markFailure(row: ClinicalDocumentExportWorkRow, error: unknown): Promise<void> {
  const message = sanitizeClinicalDocumentExportError(error);
  const retryable = isRetryableError(error);
  const exhausted = retryable && row.attempt_count >= MAX_AUTOMATIC_ATTEMPTS;
  const nextRetryAt = !retryable || exhausted ? null : new Date(Date.now() + retryDelayMs(row.attempt_count)).toISOString();
  const status: ClinicalDocumentExportStatus = retryable ? "failed" : "blocked";
  const updated = await pool.query(
    `update clinical_document_exports set status=$2, next_retry_at=$3, last_error=$4, export_lease_owner=null, export_lease_expires_at=null, updated_at=now() where id=$1 and status='exporting' and export_lease_owner=$5`,
    [row.id, status, nextRetryAt, exhausted ? "Automatic retry limit reached. Manual retry is required." : message, row.export_lease_owner],
  );
  if (updated.rowCount !== 1) return;
  await logAuditEntry({ entityType: "clinical_document_export", entityId: row.id, actionType: status === "blocked" ? "clinical_document_export_blocked" : "clinical_document_export_failed", oldValues: { status: "exporting" }, newValues: { status, retryable, nextRetryAt, error: exhausted ? "automatic_retry_limit_reached" : message, code: error instanceof ClinicalDocumentExportBlockedError ? error.code : errorCode(error) }, changedByUserId: null });
  if (error instanceof ClinicalDocumentExportBlockedError && ["patient_identity_conflict", "study_instance_uid_conflict", "accession_conflict"].includes(error.code)) await logAuditEntry({ entityType: "clinical_document_export", entityId: row.id, actionType: "clinical_document_export_identity_conflict", oldValues: null, newValues: { code: error.code }, changedByUserId: null });
}

/** Internal worker processor. Tests may inject only external I/O; SQL, lease, audit, and retry semantics remain real. */
export async function processClaimedClinicalDocumentExport(row: ClinicalDocumentExportWorkRow, dependencies: ClinicalDocumentProcessorDependencies = productionClinicalDocumentProcessorDependencies): Promise<void> {
  if (row.appointment_status !== "completed") {
    await pool.query(`update clinical_document_exports set status='pending', next_retry_at=null, export_lease_owner=null, export_lease_expires_at=null, updated_at=now() where id=$1 and export_lease_owner=$2`, [row.id, row.export_lease_owner]);
    return;
  }
  try {
    const study = await resolveTargetStudy(appointmentContext(row), dependencies);
    if (row.study_instance_uid && row.study_instance_uid !== study.studyInstanceUid) throw new ClinicalDocumentExportBlockedError("study_instance_uid_conflict", "The resolved Orthanc study differs from the study persisted for this export.");
    if (row.representation_type === "secondary_capture") { await processSecondaryCaptureExport(row, study, dependencies); return; }
    const identifiers = await ensureStableIdentifiers(row, study.studyInstanceUid!);
    const client = await dependencies.createOrthancClient();
    let instance = await client.findInstanceBySopInstanceUid(identifiers.sopInstanceUid);
    if (instance) {
      verifyInstance(instance, row, study, identifiers);
    } else {
      const source = await dependencies.readDocumentBytes(row.document_stored_path);
      const dicom = await createClinicalDocumentDicom(source, row.document_mime_type, { studyInstanceUid: study.studyInstanceUid!, seriesInstanceUid: identifiers.seriesInstanceUid, sopInstanceUid: identifiers.sopInstanceUid, patientId: study.patientId || row.patient_primary_id || row.patient_national_id || row.patient_mrn || "UNKNOWN", patientName: study.patientName || row.patient_name || "UNKNOWN", patientBirthDate: study.patientBirthDate || row.patient_birth_date, patientSex: study.patientSex || row.patient_sex, studyDate: study.studyDate || row.appointment_booking_date, accessionNumber: row.appointment_accession_number, documentTitle: row.document_type || row.document_original_filename, originalFilename: row.document_original_filename, instanceNumber: String(row.id) });
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

export async function claimNextClinicalDocumentExport(workerId: string, leaseSeconds = EXPORT_LEASE_SECONDS): Promise<ClinicalDocumentExportWorkRow | null> {
  const safeLeaseSeconds = Math.max(30, Math.min(Math.floor(leaseSeconds), 3600));
  const { rows } = await pool.query<ClinicalDocumentExportWorkRow>(
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

export async function runClinicalDocumentExportTick(options: { batchSize?: number; shouldStop?: () => boolean } = {}): Promise<{ reconciled: number; processed: number; exported: number; failed: number }> {
  let reconciled: number;
  try { reconciled = await reconcileClinicalDocumentExports(); }
  catch (error) { console.warn(JSON.stringify({ type: "clinical_document_export_reconciliation_failed", error: sanitizeClinicalDocumentExportError(error) })); throw error; }
  const settings = await readAuthoritativeOrthancSettings();
  if (!settings.enabled) return { reconciled, processed: 0, exported: 0, failed: 0 };
  const workerId = `clinical-document-export-${randomUUID()}`;
  let processed = 0;
  let exported = 0;
  let failed = 0;
  for (let index = 0; index < Math.max(1, options.batchSize ?? DEFAULT_BATCH_SIZE); index += 1) {
    if (options.shouldStop?.()) break;
    const row = await claimNextClinicalDocumentExport(workerId);
    if (!row) break;
    logClinicalDocumentExportWorker("export_claimed", { exportId: row.id, appointmentId: row.appointment_id, documentId: row.document_id });
    processed += 1;
    try { await processClaimedClinicalDocumentExport(row); } catch (error) { console.warn(JSON.stringify({ type: "clinical_document_export_processing_error", exportId: row.id, error: sanitizeClinicalDocumentExportError(error) })); }
    const latest = await loadExportWork(row.id);
    if (latest?.status === "exported") exported += 1;
    else if (latest?.status === "failed" || latest?.status === "blocked") failed += 1;
    if (latest?.status === "exported") logClinicalDocumentExportWorker("export_succeeded", { exportId: latest.id, appointmentId: latest.appointment_id, documentId: latest.document_id });
    else if (latest?.status === "failed") logClinicalDocumentExportWorker("export_retry_scheduled", { exportId: latest.id, appointmentId: latest.appointment_id, documentId: latest.document_id, nextRetryAt: latest.next_retry_at, error: sanitizeClinicalDocumentExportError(latest.last_error) });
    else if (latest?.status === "blocked") logClinicalDocumentExportWorker("export_blocked", { exportId: latest.id, appointmentId: latest.appointment_id, documentId: latest.document_id, error: sanitizeClinicalDocumentExportError(latest.last_error) });
  }
  if (reconciled > 0) logClinicalDocumentExportWorker("exports_reconciled", { count: reconciled });
  return { reconciled, processed, exported, failed };
}

export interface ClinicalDocumentExportWorker { stop(): Promise<void> }
let workerInterval: NodeJS.Timeout | null = null;
let workerRunning = false;
let workerStopped = false;

export async function startClinicalDocumentExportWorker(options: { intervalMs?: number; batchSize?: number } = {}): Promise<ClinicalDocumentExportWorker> {
  if (workerInterval) return { stop: async () => { workerStopped = true; if (workerInterval) { clearInterval(workerInterval); workerInterval = null; } while (workerRunning) await new Promise((resolve) => setTimeout(resolve, 100)); } };
  const intervalMs = Math.max(5_000, options.intervalMs ?? 15_000);
  workerStopped = false;
  workerRunning = true;
  logClinicalDocumentExportWorker("worker_started", { intervalMs, batchSize: options.batchSize ?? DEFAULT_BATCH_SIZE });
  void runClinicalDocumentExportTick({ batchSize: options.batchSize, shouldStop: () => workerStopped }).catch((error) => console.warn(JSON.stringify({ type: "clinical_document_export_startup_tick_failed", error: sanitizeClinicalDocumentExportError(error) }))).finally(() => { workerRunning = false; });
  workerInterval = setInterval(() => {
    if (workerRunning || workerStopped) return;
    workerRunning = true;
    void runClinicalDocumentExportTick({ batchSize: options.batchSize, shouldStop: () => workerStopped }).catch((error) => console.warn(JSON.stringify({ type: "clinical_document_export_tick_failed", error: sanitizeClinicalDocumentExportError(error) }))).finally(() => { workerRunning = false; });
  }, intervalMs);
  workerInterval.unref();
  return { async stop() { workerStopped = true; if (workerInterval) { clearInterval(workerInterval); workerInterval = null; } while (workerRunning) await new Promise((resolve) => setTimeout(resolve, 100)); } };
}

export async function listClinicalDocumentExportsForAppointment(appointmentId: number): Promise<Array<ClinicalDocumentExportRow & { failed_page_number: number | null }>> {
  const { rows } = await pool.query<ClinicalDocumentExportRow & { failed_page_number: number | null }>(`select e.*, (select i.page_number from clinical_document_export_instances i where i.export_id=e.id and i.status in ('failed','blocked') order by i.page_number limit 1) failed_page_number from clinical_document_exports e where e.appointment_id=$1 order by e.created_at asc, e.id asc`, [appointmentId]);
  return rows;
}

export async function assertClinicalDocumentExportAppointmentAccess(appointmentId: number, role: string, modalityId: number | null): Promise<void> {
  const { rows } = await pool.query<{ modality_id: number | null }>(`select modality_id from appointments_v2.bookings where id=$1 limit 1`, [appointmentId]);
  if (!rows[0]) throw new HttpError(404, "Appointment not found.");
  if (role === "modality_staff" && (!modalityId || Number(rows[0].modality_id) !== modalityId)) throw new HttpError(403, "This appointment is outside the requested modality scope.");
}

export async function retryClinicalDocumentExport(exportId: UserId, changedByUserId: UserId): Promise<ClinicalDocumentExportRow> {
  const id = normalizePositiveInteger(exportId, "exportId");
  const { rows } = await pool.query<ClinicalDocumentExportRow & { previous_status: "failed" | "blocked" }>(`
    with target as (
      select id, status as previous_status
      from clinical_document_exports
      where id=$1 and status in ('failed','blocked')
      for update
    )
    update clinical_document_exports e
    set status='pending', attempt_count=0, next_retry_at=null, last_error=null, export_lease_owner=null, export_lease_expires_at=null, updated_at=now()
    from target
    where e.id=target.id
    returning e.*, target.previous_status
  `, [id]);
  const row = rows[0];
  if (!row) throw new HttpError(409, "Only failed or blocked clinical document exports can be retried.");
  await logAuditEntry({ entityType: "clinical_document_export", entityId: row.id, actionType: "clinical_document_export_manual_retry_requested", oldValues: { status: row.previous_status }, newValues: { status: "pending" }, changedByUserId });
  return row;
}

export async function reconcileClinicalDocumentExportsManually(changedByUserId: OptionalUserId): Promise<{ queued: number }> {
  const queued = await reconcileClinicalDocumentExports(changedByUserId);
  return { queued };
}

export async function queueClinicalDocumentExportForCompletedAppointment(appointmentId: number, changedByUserId: OptionalUserId = null): Promise<number[]> {
  return enqueueClinicalDocumentExportsForAppointment(appointmentId, changedByUserId);
}
