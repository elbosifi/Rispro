import type { PoolClient, QueryResult } from "pg";
import { pool } from "../db/pool.js";
import { HttpError } from "../utils/http-error.js";
import { requireRow } from "../utils/records.js";
import { getTripoliToday, normalizeDateValue, TRIPOLI_TIME_ZONE } from "../utils/date.js";
import { createAppointment } from "./appointment-service.js";
import { logAuditEntry } from "./audit-service.js";
import { resolveScanValueToAccession } from "./dicom-service.js";
import {
  APPOINTMENT_QUEUE_CLOSED_STATUSES,
  APPOINTMENT_STATUS_ARRIVED,
  APPOINTMENT_STATUS_NO_SHOW,
  APPOINTMENT_STATUS_SCHEDULED
} from "../constants/appointment-statuses.js";
import type { AuthenticatedUserContext, UnknownRecord, UserId } from "../types/http.js";
import type { AppointmentStatus, QueueStatus } from "../types/domain.js";
import type { DbNumeric } from "../types/db.js";

const DEFAULT_NO_SHOW_REVIEW_TIME = "17:00";

interface QueueEntryRow {
  id: number;
  queue_date: string;
  queue_number: number;
  queue_status: QueueStatus;
  scanned_at: string | null;
  appointment_id: number;
  accession_number: string;
  appointment_status: AppointmentStatus;
  is_walk_in: boolean;
  notes: string | null;
  patient_id: number;
  arabic_full_name: string;
  english_full_name: string | null;
  phone_1: string | null;
  national_id: string | null;
  modality_name_ar: string;
  modality_name_en: string;
  exam_name_ar: string | null;
  exam_name_en: string | null;
}

interface QueueSummaryRow {
  total_appointments: DbNumeric;
  scheduled_count: DbNumeric;
  waiting_count: DbNumeric;
  no_show_count: DbNumeric;
  arrived_count: DbNumeric;
}

interface NoShowCandidateRow {
  appointment_id: number;
  accession_number: string;
  appointment_date: string;
  notes: string | null;
  patient_id: number;
  arabic_full_name: string;
  english_full_name: string | null;
  phone_1: string | null;
  modality_name_ar: string;
  modality_name_en: string;
}

interface NextQueueNumberRow {
  next_queue_number?: DbNumeric;
}

interface QueueEntryStateRow {
  id: number;
  queue_date: string;
  queue_number: number;
  queue_status: QueueStatus;
  scanned_at: string | null;
}

interface AppointmentForQueueRow {
  id: number;
  appointment_date: string;
  status: AppointmentStatus;
  accession_number: string;
  is_walk_in: boolean;
  notes: string | null;
  arabic_full_name: string;
  english_full_name: string | null;
  phone_1: string | null;
  modality_name_ar: string;
  modality_name_en: string;
  exam_name_ar: string | null;
  exam_name_en: string | null;
}

interface NoShowAppointmentRow {
  id: number;
  status: AppointmentStatus;
  appointment_date: string;
}

interface QueueSnapshot {
  queueDate: string;
  reviewTime: string;
  reviewActive: boolean;
  summary: QueueSummaryRow;
  queueEntries: QueueEntryRow[];
  noShowCandidates: NoShowCandidateRow[];
}

interface QueueScanResult {
  queueEntry: QueueEntryStateRow;
  appointment: {
    id: number;
    accession_number: string;
    is_walk_in: boolean;
    notes: string | null;
    status: string;
  };
  patient: {
    arabic_full_name: string;
    english_full_name: string | null;
    phone_1: string | null;
  };
  modality: {
    name_ar: string;
    name_en: string;
  };
  examType: {
    name_ar: string | null;
    name_en: string | null;
  } | null;
}

type CurrentUser = AuthenticatedUserContext;

interface QueueScanPayload {
  scanValue?: string;
  accessionNumber?: string;
}

interface QueueWalkInOptions {
  supervisorUsername?: string;
  supervisorPassword?: string;
}

interface TripoliParts {
  year?: string;
  month?: string;
  day?: string;
  hour?: string;
  minute?: string;
  second?: string;
}

interface SettingsRow {
  setting_value?: { value?: unknown };
}

function getTripoliParts(date: Date = new Date()): TripoliParts {
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: TRIPOLI_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false
  });

  const parts = formatter.formatToParts(date).reduce<Record<string, string | undefined>>((accumulator, part) => {
    if (part.type !== "literal" && part.type !== "unknown") {
      accumulator[part.type] = part.value;
    }

    return accumulator;
  }, {});

  return parts;
}

function getTripoliMinutesSinceMidnight(): number {
  const parts = getTripoliParts();
  return Number(parts.hour) * 60 + Number(parts.minute);
}

function parseTimeToMinutes(value: unknown): number {
  const raw = String(value || DEFAULT_NO_SHOW_REVIEW_TIME).trim();
  const match = raw.match(/^(\d{1,2}):(\d{2})$/);

  if (!match) {
    return 17 * 60;
  }

  return Number(match[1]) * 60 + Number(match[2]);
}

async function getNoShowReviewTime(): Promise<string> {
  const { rows } = await pool.query(
    `
      select setting_value
      from system_settings
      where category = 'queue_and_arrival'
        and setting_key = 'no_show_review_time'
      limit 1
    `
  );

  const firstRow = rows[0] as SettingsRow | undefined;
  const value = firstRow?.setting_value?.value;
  return typeof value === "string" && value ? value : DEFAULT_NO_SHOW_REVIEW_TIME;
}

async function isWalkInQueueEnabled(): Promise<boolean> {
  const { rows } = await pool.query(
    `
      select setting_value
      from system_settings
      where category = 'queue_and_arrival'
        and setting_key = 'walk_in_queue'
      limit 1
    `
  );

  const firstRow = rows[0] as SettingsRow | undefined;
  const value = String(firstRow?.setting_value?.value ?? "enabled").trim().toLowerCase();
  return ["enabled", "on", "true", "yes", "1"].includes(value);
}

async function getQueueEntries(queueDate: string): Promise<QueueEntryRow[]> {
  const { rows } = await pool.query(
    `
      select
        queue_entries.id,
        queue_entries.queue_date,
        queue_entries.queue_number,
        queue_entries.queue_status,
        queue_entries.scanned_at,
        appointments.id as appointment_id,
        appointments.accession_number,
        appointments.status as appointment_status,
        appointments.is_walk_in,
        appointments.notes,
        patients.id as patient_id,
        patients.arabic_full_name,
        patients.english_full_name,
        patients.phone_1,
        patients.national_id,
        modalities.name_ar as modality_name_ar,
        modalities.name_en as modality_name_en,
        exam_types.name_ar as exam_name_ar,
        exam_types.name_en as exam_name_en
      from queue_entries
      join appointments on appointments.id = queue_entries.appointment_id
      join patients on patients.id = appointments.patient_id
      join modalities on modalities.id = appointments.modality_id
      left join exam_types on exam_types.id = appointments.exam_type_id
      where queue_entries.queue_date = $1::date
      order by queue_entries.queue_number asc
    `,
    [queueDate]
  );

  return rows as QueueEntryRow[];
}

async function getQueueSummary(queueDate: string): Promise<QueueSummaryRow> {
  const { rows } = await pool.query(
    `
      select
        count(*) as total_appointments,
        count(*) filter (where status = 'scheduled') as scheduled_count,
        count(*) filter (where status in ('waiting', 'arrived', 'in-progress')) as waiting_count,
        count(*) filter (where status = 'no-show') as no_show_count,
        count(*) filter (where arrived_at is not null) as arrived_count
      from appointments
      where appointment_date = $1::date
    `,
    [queueDate]
  );

  return (rows[0] as QueueSummaryRow | undefined) || {
    total_appointments: 0,
    scheduled_count: 0,
    waiting_count: 0,
    no_show_count: 0,
    arrived_count: 0
  };
}

async function getNoShowCandidates(queueDate: string, reviewActive: boolean): Promise<NoShowCandidateRow[]> {
  if (!reviewActive) {
    return [];
  }

  const { rows } = await pool.query(
    `
      select
        appointments.id as appointment_id,
        appointments.accession_number,
        appointments.appointment_date,
        appointments.notes,
        patients.id as patient_id,
        patients.arabic_full_name,
        patients.english_full_name,
        patients.phone_1,
        modalities.name_ar as modality_name_ar,
        modalities.name_en as modality_name_en
      from appointments
      join patients on patients.id = appointments.patient_id
      join modalities on modalities.id = appointments.modality_id
      where appointments.appointment_date = $1::date
        and appointments.status = 'scheduled'
      order by appointments.daily_sequence asc
    `,
    [queueDate]
  );

  return rows as NoShowCandidateRow[];
}

async function getAppointmentForQueue(client: PoolClient, identifier: string): Promise<AppointmentForQueueRow> {
  const { rows } = await client.query(
    `
      select
        appointments.*,
        patients.arabic_full_name,
        patients.english_full_name,
        patients.phone_1,
        modalities.name_ar as modality_name_ar,
        modalities.name_en as modality_name_en,
        exam_types.name_ar as exam_name_ar,
        exam_types.name_en as exam_name_en
      from appointments
      join patients on patients.id = appointments.patient_id
      join modalities on modalities.id = appointments.modality_id
      left join exam_types on exam_types.id = appointments.exam_type_id
      where appointments.accession_number = $1
      limit 1
    `,
    [identifier]
  );

  if (!rows[0]) {
    throw new HttpError(404, "Appointment not found for this accession number.");
  }

  return requireRow(rows[0] as AppointmentForQueueRow | undefined, "Failed to load appointment.");
}

async function enqueueAppointmentRecord(
  client: PoolClient,
  appointment: AppointmentForQueueRow,
  currentUserId: UserId,
  queueDate: string
): Promise<QueueEntryStateRow> {
  const existingEntry = await client.query(
    `
      select id, queue_date, queue_number, queue_status, scanned_at
      from queue_entries
      where appointment_id = $1
      limit 1
    `,
    [appointment.id]
  );

  const existingQueueEntry = existingEntry.rows[0] as QueueEntryStateRow | undefined;
  if (existingQueueEntry) {
    return existingQueueEntry;
  }

  await client.query("select pg_advisory_xact_lock(hashtext($1))", [`queue-number:${queueDate}`]);

  const nextQueueNumberResult = await client.query(
    `
      select coalesce(max(queue_number), 0) + 1 as next_queue_number
      from queue_entries
      where queue_date = $1::date
    `,
    [queueDate]
  );

  const nextQueueNumberRow = nextQueueNumberResult.rows[0] as NextQueueNumberRow | undefined;
  const nextQueueNumber = Number(nextQueueNumberRow?.next_queue_number || 1);
  const insertResult = await client.query(
    `
      insert into queue_entries (
        appointment_id,
        queue_date,
        queue_number,
        queue_status,
        queued_by_user_id
      )
      values ($1, $2::date, $3, 'waiting', $4)
      returning id, queue_date, queue_number, queue_status, scanned_at
    `,
    [appointment.id, queueDate, nextQueueNumber, currentUserId]
  );

  return requireRow(insertResult.rows[0] as QueueEntryStateRow | undefined, "Failed to create queue entry.");
}

async function updateAppointmentStatus(
  client: PoolClient,
  appointmentId: UserId,
  oldStatus: string,
  newStatus: string,
  currentUserId: UserId,
  reason: string | null = null
): Promise<void> {
  await client.query(
    `
      update appointments
      set
        status = $2,
        arrived_at = case when $2 in ('arrived', 'waiting') then coalesce(arrived_at, now()) else arrived_at end,
        updated_by_user_id = $3,
        updated_at = now()
      where id = $1
    `,
    [appointmentId, newStatus, currentUserId]
  );

  await client.query(
    `
      insert into appointment_status_history (appointment_id, old_status, new_status, changed_by_user_id, reason)
      values ($1, $2, $3, $4, $5)
    `,
    [appointmentId, oldStatus, newStatus, currentUserId, reason]
  );
}

export async function getQueueSnapshot(): Promise<QueueSnapshot> {
  const queueDate = getTripoliToday();
  const reviewTime = await getNoShowReviewTime();
  const reviewActive = getTripoliMinutesSinceMidnight() >= parseTimeToMinutes(reviewTime);
  const [summary, queueEntries, noShowCandidates] = await Promise.all([
    getQueueSummary(queueDate),
    getQueueEntries(queueDate),
    getNoShowCandidates(queueDate, reviewActive)
  ]);

  return {
    queueDate,
    reviewTime,
    reviewActive,
    summary,
    queueEntries,
    noShowCandidates
  };
}

export async function scanAppointmentIntoQueue(
  payload: QueueScanPayload,
  currentUser: CurrentUser | null | undefined
): Promise<QueueScanResult> {
  if (!currentUser?.sub) {
    throw new HttpError(401, "Authentication required.");
  }

  const cleanAccession = await resolveScanValueToAccession(payload?.scanValue, payload?.accessionNumber);

  const queueDate = getTripoliToday();
  const client = await pool.connect();

  try {
    await client.query("begin");
    const appointment = await getAppointmentForQueue(client, cleanAccession);

    if (normalizeDateValue(appointment.appointment_date) !== queueDate) {
      throw new HttpError(409, "Only today's appointments can be scanned into the queue.");
    }

    if (APPOINTMENT_QUEUE_CLOSED_STATUSES.includes(appointment.status)) {
      throw new HttpError(409, `This appointment is already marked as ${appointment.status}.`);
    }

    const queueEntry = await enqueueAppointmentRecord(client, appointment, currentUser.sub, queueDate);

    if (appointment.status !== APPOINTMENT_STATUS_ARRIVED) {
      await updateAppointmentStatus(client, appointment.id, appointment.status, APPOINTMENT_STATUS_ARRIVED, currentUser.sub);
    }

    await logAuditEntry(
      {
        entityType: "queue_entry",
        entityId: appointment.id,
        actionType: "scan_into_queue",
        oldValues: { status: appointment.status },
        newValues: { status: APPOINTMENT_STATUS_ARRIVED, accession_number: appointment.accession_number },
        changedByUserId: currentUser.sub
      },
      client
    );

    await client.query("commit");

    return {
      queueEntry,
      appointment: {
        id: appointment.id,
        accession_number: appointment.accession_number,
        is_walk_in: appointment.is_walk_in,
        notes: appointment.notes,
        status: APPOINTMENT_STATUS_ARRIVED
      },
      patient: {
        arabic_full_name: appointment.arabic_full_name,
        english_full_name: appointment.english_full_name,
        phone_1: appointment.phone_1
      },
      modality: {
        name_ar: appointment.modality_name_ar,
        name_en: appointment.modality_name_en
      },
      examType: appointment.exam_name_ar
        ? {
            name_ar: appointment.exam_name_ar,
            name_en: appointment.exam_name_en
          }
        : null
    };
  } catch (error) {
    await client.query("rollback");
    throw error;
  } finally {
    client.release();
  }
}

export async function createWalkInQueueEntry(
  payload: UnknownRecord,
  currentUser: CurrentUser,
  options: QueueWalkInOptions = {}
): Promise<QueueScanResult & { createdAppointment: UnknownRecord }> {
  const walkInEnabled = await isWalkInQueueEnabled();
  if (!walkInEnabled) {
    throw new HttpError(409, "Walk-in queue is disabled in settings.");
  }

  const queueDate = getTripoliToday();
  const appointmentResult = await createAppointment(
    {
      ...payload,
      appointmentDate: queueDate,
      isWalkIn: true
    },
    currentUser,
    options
  );

  const scanResult = await scanAppointmentIntoQueue(
    { scanValue: appointmentResult.barcodeValue },
    currentUser
  );

  return {
    ...scanResult,
    createdAppointment: appointmentResult.appointment
  };
}

export async function confirmNoShow(
  appointmentId: UserId,
  reason: string | null | undefined,
  currentUser: CurrentUser | null | undefined
): Promise<{ ok: true }> {
  if (!currentUser?.sub) {
    throw new HttpError(401, "Authentication required.");
  }

  const cleanReason = String(reason || "").trim();

  if (!cleanReason) {
    throw new HttpError(400, "A no-show reason is required.");
  }

  const cleanAppointmentId = Number(appointmentId);

  if (!Number.isInteger(cleanAppointmentId) || cleanAppointmentId <= 0) {
    throw new HttpError(400, "appointmentId must be a valid number.");
  }

  const queueDate = getTripoliToday();
  const reviewTime = await getNoShowReviewTime();

  if (getTripoliMinutesSinceMidnight() < parseTimeToMinutes(reviewTime)) {
    throw new HttpError(409, "No-show confirmation opens after the configured review time.");
  }

  const client = await pool.connect();

  try {
    await client.query("begin");

    const { rows } = await client.query(
      `
        select id, status, appointment_date
        from appointments
        where id = $1
        limit 1
      `,
      [cleanAppointmentId]
    );

    const appointment = rows[0] as NoShowAppointmentRow | undefined;

    if (!appointment) {
      throw new HttpError(404, "Appointment not found.");
    }

    if (normalizeDateValue(appointment.appointment_date) !== queueDate) {
      throw new HttpError(409, "Only today's appointments can be confirmed as no-show here.");
    }

    if (appointment.status !== APPOINTMENT_STATUS_SCHEDULED) {
      throw new HttpError(409, "Only scheduled appointments can be confirmed as no-show.");
    }

    await client.query(
      `
        update appointments
        set
          status = 'no-show',
          no_show_reason = $2,
          updated_by_user_id = $3,
          updated_at = now()
        where id = $1
      `,
      [cleanAppointmentId, cleanReason, currentUser.sub]
    );

    await client.query(
      `
        insert into appointment_status_history (appointment_id, old_status, new_status, changed_by_user_id, reason)
        values ($1, 'scheduled', 'no-show', $2, $3)
      `,
      [cleanAppointmentId, currentUser.sub, cleanReason]
    );

    await logAuditEntry(
      {
        entityType: "appointment",
        entityId: cleanAppointmentId,
        actionType: "confirm_no_show",
        oldValues: appointment,
        newValues: { status: APPOINTMENT_STATUS_NO_SHOW, no_show_reason: cleanReason },
        changedByUserId: currentUser.sub
      },
      client
    );

    await client.query("commit");
    return { ok: true };
  } catch (error) {
    await client.query("rollback");
    throw error;
  } finally {
    client.release();
  }
}
