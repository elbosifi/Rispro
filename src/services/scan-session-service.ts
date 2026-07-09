import crypto from "crypto";
import { env } from "../config/env.js";
import { pool } from "../db/pool.js";
import { HttpError } from "../utils/http-error.js";
import { normalizePositiveInteger } from "../utils/normalize.js";
import { logAuditEntry } from "./audit-service.js";
import { uploadDocument, type DocumentRow } from "./document-service.js";
import { loadSettingsMap } from "./settings-service.js";
import type { OptionalUserId, UserId } from "../types/http.js";

type AppointmentRefType = "legacy_appointment" | "v2_booking";
type ScanSessionStatus = "created" | "opened" | "scanned" | "uploaded" | "expired" | "cancelled" | "failed";

interface AppointmentContextRow {
  id: number;
  patient_id: number;
  accession_number: string;
  appointment_date: string;
  modality_name: string | null;
  exam_type_name: string | null;
  arabic_full_name: string;
  english_full_name: string;
}

interface ScanSessionRow {
  id: number;
  token_hash: string;
  appointment_id: number | null;
  v2_booking_id: number | null;
  patient_id: number;
  appointment_ref_type: AppointmentRefType;
  document_type: string;
  requested_by_user_id: number | null;
  status: ScanSessionStatus;
  expires_at: string;
  opened_at: string | null;
  uploaded_at: string | null;
  cancelled_at: string | null;
  workstation_name: string | null;
  scanner_name: string | null;
  app_version: string | null;
  last_error: string | null;
  created_at: string;
  updated_at: string;
}

export interface CreateScanSessionInput {
  appointmentId?: UserId;
  appointmentRefType?: string;
  patientId?: UserId;
  documentType?: string;
  currentUserId: OptionalUserId;
}

export interface UploadScanSessionDocumentInput {
  fileBuffer: Buffer;
  originalFilename: string;
  mimeType: string;
  documentType?: string;
  pageCount?: number | null;
  scannerName?: string | null;
  workstationName?: string | null;
  appVersion?: string | null;
}

function hashScanToken(token: string): string {
  return crypto.createHmac("sha256", env.scanSessionTokenSecret).update(token).digest("hex");
}

function createRawToken(): string {
  return crypto.randomBytes(32).toString("base64url");
}

function normalizeAppointmentRefType(value: unknown): AppointmentRefType {
  const normalized = String(value || "").trim().toLowerCase();
  if (normalized === "legacy_appointment") return "legacy_appointment";
  return "v2_booking";
}

function sanitizeDocumentType(value: unknown): string {
  return String(value || "appointment_request").trim() || "appointment_request";
}

function sanitizeOptionalText(value: unknown): string | null {
  const clean = String(value || "").trim();
  return clean || null;
}

async function loadExpiryMinutes(): Promise<number> {
  const settingsMap = await loadSettingsMap(["documents_and_uploads"]);
  const raw = settingsMap.documents_and_uploads?.scan_session_expiry_minutes;
  const minutes = Number(raw || 15);
  return Number.isFinite(minutes) && minutes >= 1 && minutes <= 60 ? Math.floor(minutes) : 15;
}

async function getLegacyAppointmentContext(appointmentId: number): Promise<AppointmentContextRow | null> {
  const { rows } = await pool.query(
    `
      select
        appointments.id,
        appointments.patient_id,
        appointments.accession_number,
        appointments.appointment_date::text as appointment_date,
        modalities.name_en as modality_name,
        exam_types.name_en as exam_type_name,
        patients.arabic_full_name,
        patients.english_full_name
      from appointments
      join patients on patients.id = appointments.patient_id
      join modalities on modalities.id = appointments.modality_id
      left join exam_types on exam_types.id = appointments.exam_type_id
      where appointments.id = $1
      limit 1
    `,
    [appointmentId]
  );
  return (rows[0] as AppointmentContextRow | undefined) || null;
}

async function getV2BookingContext(bookingId: number): Promise<AppointmentContextRow | null> {
  const { rows } = await pool.query(
    `
      select
        bookings.id,
        bookings.patient_id,
        ('V2-' || lpad(bookings.id::text, 6, '0')) as accession_number,
        bookings.booking_date::text as appointment_date,
        modalities.name_en as modality_name,
        exam_types.name_en as exam_type_name,
        patients.arabic_full_name,
        patients.english_full_name
      from appointments_v2.bookings as bookings
      join patients on patients.id = bookings.patient_id
      join modalities on modalities.id = bookings.modality_id
      left join exam_types on exam_types.id = bookings.exam_type_id
      where bookings.id = $1
      limit 1
    `,
    [bookingId]
  );
  return (rows[0] as AppointmentContextRow | undefined) || null;
}

async function getAppointmentContext(appointmentId: number, refType: AppointmentRefType): Promise<AppointmentContextRow> {
  const context = refType === "legacy_appointment"
    ? await getLegacyAppointmentContext(appointmentId)
    : await getV2BookingContext(appointmentId);
  if (!context) {
    throw new HttpError(404, "Appointment not found.");
  }
  return context;
}

async function loadSessionByToken(token: string): Promise<ScanSessionRow> {
  const cleanToken = String(token || "").trim();
  if (!cleanToken) {
    throw new HttpError(401, "Scan token is required.");
  }

  const { rows } = await pool.query(
    `
      select *
      from scan_sessions
      where token_hash = $1
      limit 1
    `,
    [hashScanToken(cleanToken)]
  );
  const session = rows[0] as ScanSessionRow | undefined;
  if (!session) {
    throw new HttpError(401, "Invalid scan token.");
  }

  if (new Date(session.expires_at).getTime() <= Date.now() && session.status !== "uploaded") {
    await pool.query(
      `
        update scan_sessions
        set status = 'expired', updated_at = now()
        where id = $1 and status in ('created', 'opened', 'scanned')
      `,
      [session.id]
    );
    throw new HttpError(410, "Scan session has expired.");
  }

  return session;
}

function assertUsableSession(session: ScanSessionRow): void {
  if (session.status === "cancelled") throw new HttpError(409, "Scan session was cancelled.");
  if (session.status === "failed") throw new HttpError(409, "Scan session failed.");
  if (session.status === "expired") throw new HttpError(410, "Scan session has expired.");
}

export async function createScanSession(input: CreateScanSessionInput): Promise<{
  launchUrl: string;
  expiresAt: string;
  fallbackUploadAllowed: true;
}> {
  const appointmentId = normalizePositiveInteger(input.appointmentId, "appointmentId");
  const patientId = normalizePositiveInteger(input.patientId, "patientId");
  if (!appointmentId) {
    throw new HttpError(400, "appointmentId is required.");
  }
  if (!patientId) {
    throw new HttpError(400, "patientId is required.");
  }

  const appointmentRefType = normalizeAppointmentRefType(input.appointmentRefType);
  const appointment = await getAppointmentContext(appointmentId, appointmentRefType);
  if (Number(appointment.patient_id) !== Number(patientId)) {
    throw new HttpError(400, "Appointment does not belong to patient.");
  }

  const token = createRawToken();
  const tokenHash = hashScanToken(token);
  const expiryMinutes = await loadExpiryMinutes();
  const documentType = sanitizeDocumentType(input.documentType);
  const { rows } = await pool.query(
    `
      insert into scan_sessions (
        token_hash,
        appointment_id,
        v2_booking_id,
        patient_id,
        appointment_ref_type,
        document_type,
        requested_by_user_id,
        expires_at
      )
      values ($1, $2, $3, $4, $5, $6, $7, now() + ($8::int * interval '1 minute'))
      returning *
    `,
    [
      tokenHash,
      appointmentRefType === "legacy_appointment" ? appointment.id : null,
      appointmentRefType === "v2_booking" ? appointment.id : null,
      patientId,
      appointmentRefType,
      documentType,
      input.currentUserId,
      expiryMinutes,
    ]
  );
  const session = rows[0] as ScanSessionRow;

  await logAuditEntry({
    entityType: "scan_session",
    entityId: session.id,
    actionType: "scan_session_created",
    oldValues: null,
    newValues: {
      appointmentId: session.appointment_id,
      v2BookingId: session.v2_booking_id,
      patientId: session.patient_id,
      appointmentRefType: session.appointment_ref_type,
      documentType: session.document_type,
      expiresAt: session.expires_at,
    },
    changedByUserId: input.currentUserId,
  });

  return {
    launchUrl: `rispro-scanner://scan?token=${encodeURIComponent(token)}`,
    expiresAt: session.expires_at,
    fallbackUploadAllowed: true,
  };
}

export async function getScanSessionContextByToken(token: string): Promise<{
  sessionId: number;
  status: ScanSessionStatus;
  expiresAt: string;
  documentType: string;
  patient: { id: number; arabicFullName: string; englishFullName: string };
  appointment: {
    id: number;
    refType: AppointmentRefType;
    accessionNumber: string;
    appointmentDate: string;
    modalityName: string;
    examTypeName: string;
  };
}> {
  const session = await loadSessionByToken(token);
  assertUsableSession(session);
  if (session.status === "uploaded") {
    throw new HttpError(409, "Scan session was already uploaded.");
  }
  const appointmentId = session.appointment_ref_type === "legacy_appointment" ? session.appointment_id : session.v2_booking_id;
  if (!appointmentId) throw new HttpError(500, "Scan session is missing appointment context.");
  const appointment = await getAppointmentContext(appointmentId, session.appointment_ref_type);

  return {
    sessionId: Number(session.id),
    status: session.status,
    expiresAt: session.expires_at,
    documentType: session.document_type,
    patient: {
      id: Number(session.patient_id),
      arabicFullName: appointment.arabic_full_name,
      englishFullName: appointment.english_full_name,
    },
    appointment: {
      id: Number(appointment.id),
      refType: session.appointment_ref_type,
      accessionNumber: appointment.accession_number,
      appointmentDate: appointment.appointment_date,
      modalityName: appointment.modality_name || "",
      examTypeName: appointment.exam_type_name || "",
    },
  };
}

export async function markScanSessionOpened(
  token: string,
  metadata: { workstationName?: string | null; appVersion?: string | null }
): Promise<{ opened: true }> {
  const session = await loadSessionByToken(token);
  assertUsableSession(session);
  if (session.status === "uploaded") throw new HttpError(409, "Scan session was already uploaded.");

  await pool.query(
    `
      update scan_sessions
      set
        status = case when status = 'created' then 'opened' else status end,
        opened_at = coalesce(opened_at, now()),
        workstation_name = coalesce($2, workstation_name),
        app_version = coalesce($3, app_version),
        updated_at = now()
      where id = $1
    `,
    [session.id, sanitizeOptionalText(metadata.workstationName), sanitizeOptionalText(metadata.appVersion)]
  );

  await logAuditEntry({
    entityType: "scan_session",
    entityId: session.id,
    actionType: "scan_session_opened",
    oldValues: { status: session.status },
    newValues: {
      workstationName: sanitizeOptionalText(metadata.workstationName),
      appVersion: sanitizeOptionalText(metadata.appVersion),
    },
    changedByUserId: session.requested_by_user_id,
  });

  return { opened: true };
}

export async function uploadScanSessionDocument(token: string, input: UploadScanSessionDocumentInput): Promise<{
  sessionId: number;
  document: DocumentRow;
}> {
  const session = await loadSessionByToken(token);
  assertUsableSession(session);
  if (session.status === "uploaded") {
    throw new HttpError(409, "Scan session was already uploaded.");
  }

  const appointmentId = session.appointment_ref_type === "legacy_appointment" ? session.appointment_id : session.v2_booking_id;
  if (!appointmentId) throw new HttpError(500, "Scan session is missing appointment context.");

  const document = await uploadDocument(
    {
      patientId: session.patient_id,
      appointmentId,
      appointmentRefType: session.appointment_ref_type,
      documentType: sanitizeDocumentType(input.documentType || session.document_type),
      originalFilename: input.originalFilename,
      mimeType: input.mimeType,
      fileContentBuffer: input.fileBuffer,
      source: "scanner_app",
      scanSessionId: session.id,
      pageCount: input.pageCount,
      scannerName: input.scannerName,
      workstationName: input.workstationName,
      appVersion: input.appVersion,
    },
    session.requested_by_user_id
  );

  await pool.query(
    `
      update scan_sessions
      set
        status = 'uploaded',
        uploaded_at = now(),
        scanner_name = coalesce($2, scanner_name),
        workstation_name = coalesce($3, workstation_name),
        app_version = coalesce($4, app_version),
        updated_at = now()
      where id = $1
    `,
    [
      session.id,
      sanitizeOptionalText(input.scannerName),
      sanitizeOptionalText(input.workstationName),
      sanitizeOptionalText(input.appVersion),
    ]
  );

  await logAuditEntry({
    entityType: "scan_session",
    entityId: session.id,
    actionType: "scan_document_uploaded",
    oldValues: { status: session.status },
    newValues: {
      documentId: document.id,
      patientId: document.patient_id,
      appointmentId: document.appointment_id,
      v2BookingId: document.v2_booking_id,
      pageCount: document.page_count,
      scannerName: document.scanner_name,
      workstationName: document.workstation_name,
      appVersion: document.app_version,
    },
    changedByUserId: session.requested_by_user_id,
  });

  return { sessionId: Number(session.id), document };
}

export async function cancelScanSession(
  token: string,
  metadata: { lastError?: string | null } = {}
): Promise<{ cancelled: true }> {
  const session = await loadSessionByToken(token);
  assertUsableSession(session);
  if (session.status === "uploaded") throw new HttpError(409, "Scan session was already uploaded.");

  const lastError = sanitizeOptionalText(metadata.lastError);
  await pool.query(
    `
      update scan_sessions
      set status = 'cancelled', cancelled_at = now(), last_error = $2, updated_at = now()
      where id = $1
    `,
    [session.id, lastError]
  );

  await logAuditEntry({
    entityType: "scan_session",
    entityId: session.id,
    actionType: "scan_session_cancelled",
    oldValues: { status: session.status },
    newValues: { lastError },
    changedByUserId: session.requested_by_user_id,
  });

  return { cancelled: true };
}

export async function expireOldScanSessions(): Promise<number> {
  const { rowCount } = await pool.query(
    `
      update scan_sessions
      set status = 'expired', updated_at = now()
      where status in ('created', 'opened', 'scanned')
        and expires_at <= now()
    `
  );
  return Number(rowCount || 0);
}
