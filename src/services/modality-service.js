import { pool } from "../db/pool.js";
import { HttpError } from "../utils/http-error.js";
import { getTripoliToday } from "../utils/date.js";
import { logAuditEntry } from "./audit-service.js";
import { scheduleWorklistSync } from "./dicom-service.js";

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

function normalizeDate(value) {
  const raw = String(value || getTripoliToday()).trim();

  if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
    throw new HttpError(400, "date must be in YYYY-MM-DD format.");
  }

  return raw;
}

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

  return rows;
}

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

    const appointment = rows[0];

    if (!appointment) {
      throw new HttpError(404, "Appointment not found.");
    }

    if (appointment.status === "completed") {
      throw new HttpError(409, "This appointment is already completed.");
    }

    if (!["waiting", "arrived", "in-progress"].includes(appointment.status)) {
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
      [cleanAppointmentId, appointment.status, currentUserId]
    );

    await logAuditEntry(
      {
        entityType: "appointment",
        entityId: cleanAppointmentId,
        actionType: "complete",
        oldValues: appointment,
        newValues: { status: "completed" },
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
