import { pool } from "../db/pool.js";
import { HttpError } from "../utils/http-error.js";
import { getTripoliToday } from "../utils/date.js";
import { logAuditEntry } from "./audit-service.js";
import { scheduleWorklistSync } from "./dicom-service.js";
import {
  APPOINTMENT_QUEUE_WORKING_STATUSES,
  APPOINTMENT_STATUS_COMPLETED
} from "../constants/appointment-statuses.js";
import type { NullableUserId, UserId } from "../types/http.js";
import type { AppointmentStatus } from "../types/domain.js";
import type { DbQueryResult } from "../types/db.js";

export interface ModalityWorklistRow {
  id: number;
  accession_number: string;
  appointment_date: string;
  status: AppointmentStatus;
  notes: string | null;
  arrived_at: string | null;
  completed_at: string | null;
  modality_slot_number: number | null;
  patient_id: number;
  mrn: string | null;
  national_id: string | null;
  arabic_full_name: string;
  english_full_name: string | null;
  age_years: number;
  sex: string;
  modality_id: number;
  modality_name_ar: string;
  modality_name_en: string;
  exam_name_ar: string | null;
  exam_name_en: string | null;
  priority_name_ar: string | null;
  priority_name_en: string | null;
}

interface AppointmentStatusRow {
  id: number;
  status: AppointmentStatus;
}

interface ModalityFilters {
  scope?: string;
  modalityId?: UserId;
  date?: string;
}

function normalizePositiveInteger(
  value: unknown,
  fieldName: string,
  { required = true }: { required?: boolean } = {}
): number | null {
  if (value === undefined || value === null || value === "") {
    if (required) {
      throw new HttpError(400, `${fieldName} is required.`);
    }

    return null;
  }

  const parsed = Number(value);

  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new HttpError(400, `${fieldName} must be a positive whole number.`);
  }

  return parsed;
}

function normalizeDate(value: unknown): string {
  const raw = String(value || getTripoliToday()).trim();

  if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
    throw new HttpError(400, "date must be in YYYY-MM-DD format.");
  }

  return raw;
}

function requireRow<T>(row: T | undefined, message: string): T {
  if (!row) {
    throw new HttpError(500, message);
  }

  return row;
}

export async function listModalityWorklist(
  filters: ModalityFilters = {}
): Promise<ModalityWorklistRow[]> {
  const scope = String(filters.scope || "").trim();
  const useAllDates = scope === "all";
  const params: unknown[] = [];
  let modalityFilterSql = "";

  if (filters.modalityId) {
    params.push(normalizePositiveInteger(filters.modalityId, "modalityId"));
    modalityFilterSql = `and appointments.modality_id = $${params.length}`;
  }

  if (!useAllDates) {
    const workDate = normalizeDate(filters.date);
    params.unshift(workDate);
    if (modalityFilterSql) {
      modalityFilterSql = modalityFilterSql.replace("$1", "$2");
    }
  }

  const dateClause = useAllDates ? "1=1" : "appointments.appointment_date = $1::date";
  const orderClause = useAllDates
    ? "appointments.appointment_date desc, appointments.daily_sequence desc"
    : "modality_name_en asc, appointments.modality_slot_number asc nulls last, appointments.daily_sequence asc";
  const limitClause = useAllDates ? "limit 200" : "";

  const { rows } = (await pool.query(
    `
      select
        appointments.id,
        appointments.accession_number,
        appointments.appointment_date,
        appointments.status,
        appointments.notes,
        appointments.arrived_at,
        appointments.completed_at,
        appointments.modality_slot_number,
        patients.id as patient_id,
        patients.mrn,
        patients.national_id,
        patients.arabic_full_name,
        patients.english_full_name,
        patients.age_years,
        patients.sex,
        modalities.id as modality_id,
        modalities.name_ar as modality_name_ar,
        modalities.name_en as modality_name_en,
        exam_types.name_ar as exam_name_ar,
        exam_types.name_en as exam_name_en,
        reporting_priorities.name_ar as priority_name_ar,
        reporting_priorities.name_en as priority_name_en
      from appointments
      join patients on patients.id = appointments.patient_id
      join modalities on modalities.id = appointments.modality_id
      left join exam_types on exam_types.id = appointments.exam_type_id
      left join reporting_priorities on reporting_priorities.id = appointments.reporting_priority_id
      where ${dateClause}
        ${modalityFilterSql}
      order by ${orderClause}
      ${limitClause}
    `,
    params
  )) as DbQueryResult<ModalityWorklistRow>;

  return rows;
}

export async function markAppointmentCompleted(
  appointmentId: UserId,
  currentUserId: NullableUserId
): Promise<{ ok: true }> {
  const cleanAppointmentId = normalizePositiveInteger(appointmentId, "appointmentId");
  const client = await pool.connect();

  try {
    await client.query("begin");
    const { rows } = (await client.query(
      `
        select id, status
        from appointments
        where id = $1
        limit 1
      `,
      [cleanAppointmentId]
    )) as DbQueryResult<AppointmentStatusRow>;

    const appointment = rows[0];

    if (!appointment) {
      throw new HttpError(404, "Appointment not found.");
    }
    const currentAppointment = requireRow(appointment, "Failed to load appointment state.");

    if (currentAppointment.status === APPOINTMENT_STATUS_COMPLETED) {
      throw new HttpError(409, "This appointment is already completed.");
    }

    if (!APPOINTMENT_QUEUE_WORKING_STATUSES.includes(currentAppointment.status)) {
      throw new HttpError(409, "Only arrived, waiting, or in-progress appointments can be completed.");
    }

    await client.query(
      `
        update appointments
        set
          status = 'completed',
          scan_finished_at = coalesce(scan_finished_at, now()),
          completed_at = now(),
          updated_by_user_id = $2,
          updated_at = now()
        where id = $1
      `,
      [cleanAppointmentId, currentUserId]
    );

    await client.query(
      `
        update queue_entries
        set queue_status = 'removed', updated_at = now()
        where appointment_id = $1
      `,
      [cleanAppointmentId]
    );

    await client.query(
      `
        insert into appointment_status_history (appointment_id, old_status, new_status, changed_by_user_id, reason)
        values ($1, $2, 'completed', $3, 'Marked completed by modality staff')
      `,
      [cleanAppointmentId, currentAppointment.status, currentUserId]
    );

    await logAuditEntry(
      {
        entityType: "appointment",
        entityId: cleanAppointmentId,
        actionType: "complete",
        oldValues: currentAppointment,
        newValues: { status: APPOINTMENT_STATUS_COMPLETED },
        changedByUserId: currentUserId
      },
      client
    );

    await client.query("commit");
    if (cleanAppointmentId) scheduleWorklistSync(cleanAppointmentId);
    return { ok: true };
  } catch (error) {
    await client.query("rollback");
    throw error;
  } finally {
    client.release();
  }
}
