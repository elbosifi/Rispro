// @ts-check

import { pool } from "../db/pool.js";
import { HttpError } from "../utils/http-error.js";
import { getTripoliToday } from "../utils/date.js";
import { logAuditEntry } from "./audit-service.js";
import { scheduleWorklistSync } from "./dicom-service.js";
import {
  APPOINTMENT_QUEUE_WORKING_STATUSES,
  APPOINTMENT_STATUS_COMPLETED
} from "../constants/appointment-statuses.js";

/** @typedef {import("../types/http.js").NullableUserId} NullableUserId */
/** @typedef {import("../types/http.js").UserId} UserId */
/** @typedef {import("../types/domain.js").AppointmentStatus} AppointmentStatus */

/**
 * @typedef ModalityWorklistRow
 * @property {number} id
 * @property {string} accession_number
 * @property {string} appointment_date
 * @property {AppointmentStatus} status
 * @property {string | null} notes
 * @property {string | null} arrived_at
 * @property {string | null} completed_at
 * @property {number | null} modality_slot_number
 * @property {number} patient_id
 * @property {string | null} mrn
 * @property {string | null} national_id
 * @property {string} arabic_full_name
 * @property {string | null} english_full_name
 * @property {number} age_years
 * @property {string} sex
 * @property {number} modality_id
 * @property {string} modality_name_ar
 * @property {string} modality_name_en
 * @property {string | null} exam_name_ar
 * @property {string | null} exam_name_en
 * @property {string | null} priority_name_ar
 * @property {string | null} priority_name_en
 */

/**
 * @typedef AppointmentStatusRow
 * @property {number} id
 * @property {AppointmentStatus} status
 */

/**
 * @param {unknown} value
 * @param {string} fieldName
 * @param {{ required?: boolean }} [options]
 */
function normalizePositiveInteger(value, fieldName, { required = true } = {}) {
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

/**
 * @param {unknown} value
 */
function normalizeDate(value) {
  const raw = String(value || getTripoliToday()).trim();

  if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
    throw new HttpError(400, "date must be in YYYY-MM-DD format.");
  }

  return raw;
}

/**
 * @template T
 * @param {T | undefined} row
 * @param {string} message
 * @returns {T}
 */
function requireRow(row, message) {
  if (!row) {
    throw new HttpError(500, message);
  }

  return row;
}

/**
 * @param {{ scope?: string, modalityId?: UserId, date?: string }} [filters]
 * @returns {Promise<ModalityWorklistRow[]>}
 */
export async function listModalityWorklist(filters = {}) {
  const scope = String(filters.scope || "").trim();
  const useAllDates = scope === "all";
  const params = [];
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

  const { rows } = await pool.query(
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
  );

  return /** @type {ModalityWorklistRow[]} */ (rows);
}

/**
 * @param {UserId} appointmentId
 * @param {NullableUserId} currentUserId
 * @returns {Promise<{ ok: true }>}
 */
export async function markAppointmentCompleted(appointmentId, currentUserId) {
  const cleanAppointmentId = normalizePositiveInteger(appointmentId, "appointmentId");
  const client = await pool.connect();

  try {
    await client.query("begin");
    const { rows } = await client.query(
      `
        select id, status
        from appointments
        where id = $1
        limit 1
      `,
      [cleanAppointmentId]
    );

    const appointment = /** @type {AppointmentStatusRow | undefined} */ (rows[0]);

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
    scheduleWorklistSync(cleanAppointmentId);
    return { ok: true };
  } catch (error) {
    await client.query("rollback");
    throw error;
  } finally {
    client.release();
  }
}
