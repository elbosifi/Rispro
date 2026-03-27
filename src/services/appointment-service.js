import { pool } from "../db/pool.js";
import { HttpError } from "../utils/http-error.js";
import { logAuditEntry } from "./audit-service.js";

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

function normalizeAppointmentDate(value) {
  const raw = String(value || "").trim();

  if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
    throw new HttpError(400, "appointmentDate must be in YYYY-MM-DD format.");
  }

  return raw;
}

function buildAccessionNumber(appointmentDate, dailySequence) {
  const compactDate = appointmentDate.replaceAll("-", "");
  return `${compactDate}-${String(dailySequence).padStart(3, "0")}`;
}

function normalizeOptionalText(value) {
  return String(value || "").trim();
}

async function getAppointmentById(client, appointmentId) {
  const cleanAppointmentId = normalizePositiveInteger(appointmentId, "appointmentId");
  const { rows } = await client.query(
    `
      select *
      from appointments
      where id = $1
      limit 1
    `,
    [cleanAppointmentId]
  );

  if (!rows[0]) {
    throw new HttpError(404, "Appointment not found.");
  }

  return rows[0];
}

async function nextDailySequence(client, appointmentDate, excludeAppointmentId = null) {
  const params = [appointmentDate];
  let excludeSql = "";

  if (excludeAppointmentId) {
    params.push(excludeAppointmentId);
    excludeSql = `and id <> $${params.length}`;
  }

  const { rows } = await client.query(
    `
      select coalesce(max(daily_sequence), 0) as last_daily_sequence
      from appointments
      where appointment_date = $1::date
      ${excludeSql}
    `,
    params
  );

  return Number(rows[0]?.last_daily_sequence || 0) + 1;
}

async function nextModalitySlotNumber(client, modalityId, appointmentDate, excludeAppointmentId = null) {
  const params = [modalityId, appointmentDate];
  let excludeSql = "";

  if (excludeAppointmentId) {
    params.push(excludeAppointmentId);
    excludeSql = `and id <> $${params.length}`;
  }

  const { rows } = await client.query(
    `
      select
        count(*) filter (where status <> 'cancelled') as booked_count,
        coalesce(max(modality_slot_number), 0) as last_slot_number
      from appointments
      where modality_id = $1
        and appointment_date = $2::date
      ${excludeSql}
    `,
    params
  );

  return {
    bookedCount: Number(rows[0]?.booked_count || 0),
    slotNumber: Number(rows[0]?.last_slot_number || 0) + 1
  };
}

function normalizeDateOrToday(value) {
  if (!value) {
    return new Date().toISOString().slice(0, 10);
  }

  return normalizeAppointmentDate(value);
}

async function getPatientById(client, patientId) {
  const { rows } = await client.query(
    `
      select id, mrn, national_id, arabic_full_name, english_full_name, age_years, estimated_date_of_birth, sex, phone_1, phone_2, address
      from patients
      where id = $1
      limit 1
    `,
    [patientId]
  );

  if (!rows[0]) {
    throw new HttpError(404, "Patient not found.");
  }

  return rows[0];
}

async function getModalityById(client, modalityId) {
  const { rows } = await client.query(
    `
      select id, code, name_ar, name_en, daily_capacity, general_instruction_ar, general_instruction_en, is_active
      from modalities
      where id = $1
      limit 1
    `,
    [modalityId]
  );

  if (!rows[0] || !rows[0].is_active) {
    throw new HttpError(404, "Modality not found.");
  }

  return rows[0];
}

async function getExamTypeById(client, examTypeId, modalityId) {
  if (!examTypeId) {
    return null;
  }

  const { rows } = await client.query(
    `
      select id, modality_id, name_ar, name_en, specific_instruction_ar, specific_instruction_en, is_active
      from exam_types
      where id = $1
      limit 1
    `,
    [examTypeId]
  );

  if (!rows[0] || !rows[0].is_active) {
    throw new HttpError(404, "Exam type not found.");
  }

  if (rows[0].modality_id !== modalityId) {
    throw new HttpError(400, "The selected exam type does not belong to the selected modality.");
  }

  return rows[0];
}

async function getPriorityById(client, reportingPriorityId) {
  if (!reportingPriorityId) {
    return null;
  }

  const { rows } = await client.query(
    `
      select id, code, name_ar, name_en
      from reporting_priorities
      where id = $1
      limit 1
    `,
    [reportingPriorityId]
  );

  if (!rows[0]) {
    throw new HttpError(404, "Reporting priority not found.");
  }

  return rows[0];
}

export async function listAppointmentLookups() {
  const [modalitiesResult, examTypesResult, prioritiesResult] = await Promise.all([
    pool.query(
      `
        select id, code, name_ar, name_en, daily_capacity, general_instruction_ar, general_instruction_en
        from modalities
        where is_active = true
        order by name_en asc
      `
    ),
    pool.query(
      `
        select id, modality_id, name_ar, name_en, specific_instruction_ar, specific_instruction_en
        from exam_types
        where is_active = true
        order by name_en asc
      `
    ),
    pool.query(
      `
        select id, code, name_ar, name_en, sort_order
        from reporting_priorities
        order by sort_order asc, name_en asc
      `
    )
  ]);

  return {
    modalities: modalitiesResult.rows,
    examTypes: examTypesResult.rows,
    priorities: prioritiesResult.rows
  };
}

export async function listAppointmentsForPrint(filters = {}) {
  const appointmentDate = normalizeDateOrToday(filters.date);
  const params = [appointmentDate];
  let modalityFilterSql = "";

  if (filters.modalityId) {
    const modalityId = normalizePositiveInteger(filters.modalityId, "modalityId");
    params.push(modalityId);
    modalityFilterSql = ` and appointments.modality_id = $${params.length}`;
  }

  const { rows } = await pool.query(
    `
      select
        appointments.id,
        appointments.accession_number,
        appointments.appointment_date,
        appointments.modality_slot_number,
        appointments.status,
        appointments.notes,
        appointments.is_walk_in,
        appointments.is_overbooked,
        appointments.overbooking_reason,
        patients.id as patient_id,
        patients.mrn,
        patients.national_id,
        patients.arabic_full_name,
        patients.english_full_name,
        patients.age_years,
        patients.sex,
        patients.phone_1,
        patients.address,
        modalities.id as modality_id,
        modalities.code as modality_code,
        modalities.name_ar as modality_name_ar,
        modalities.name_en as modality_name_en,
        modalities.general_instruction_ar,
        modalities.general_instruction_en,
        exam_types.id as exam_type_id,
        exam_types.name_ar as exam_name_ar,
        exam_types.name_en as exam_name_en,
        exam_types.specific_instruction_ar,
        exam_types.specific_instruction_en,
        reporting_priorities.name_ar as priority_name_ar,
        reporting_priorities.name_en as priority_name_en
      from appointments
      join patients on patients.id = appointments.patient_id
      join modalities on modalities.id = appointments.modality_id
      left join exam_types on exam_types.id = appointments.exam_type_id
      left join reporting_priorities on reporting_priorities.id = appointments.reporting_priority_id
      where appointments.appointment_date = $1::date
      ${modalityFilterSql}
      order by appointments.daily_sequence asc
    `,
    params
  );

  return rows;
}

export async function getAppointmentPrintDetails(appointmentId) {
  const cleanAppointmentId = normalizePositiveInteger(appointmentId, "appointmentId");
  const appointments = await listAppointmentsForPrint({ date: new Date().toISOString().slice(0, 10) });
  const appointment = appointments.find((item) => item.id === cleanAppointmentId);

  if (appointment) {
    return appointment;
  }

  const { rows } = await pool.query(
    `
      select
        appointments.id,
        appointments.accession_number,
        appointments.appointment_date,
        appointments.modality_slot_number,
        appointments.status,
        appointments.notes,
        appointments.is_walk_in,
        appointments.is_overbooked,
        appointments.overbooking_reason,
        patients.id as patient_id,
        patients.mrn,
        patients.national_id,
        patients.arabic_full_name,
        patients.english_full_name,
        patients.age_years,
        patients.sex,
        patients.phone_1,
        patients.address,
        modalities.id as modality_id,
        modalities.code as modality_code,
        modalities.name_ar as modality_name_ar,
        modalities.name_en as modality_name_en,
        modalities.general_instruction_ar,
        modalities.general_instruction_en,
        exam_types.id as exam_type_id,
        exam_types.name_ar as exam_name_ar,
        exam_types.name_en as exam_name_en,
        exam_types.specific_instruction_ar,
        exam_types.specific_instruction_en,
        reporting_priorities.name_ar as priority_name_ar,
        reporting_priorities.name_en as priority_name_en
      from appointments
      join patients on patients.id = appointments.patient_id
      join modalities on modalities.id = appointments.modality_id
      left join exam_types on exam_types.id = appointments.exam_type_id
      left join reporting_priorities on reporting_priorities.id = appointments.reporting_priority_id
      where appointments.id = $1
      limit 1
    `,
    [cleanAppointmentId]
  );

  if (!rows[0]) {
    throw new HttpError(404, "Appointment not found.");
  }

  return rows[0];
}

export async function listAvailability(modalityId, days = 14) {
  const cleanModalityId = normalizePositiveInteger(modalityId, "modalityId");
  const windowDays = Math.min(Math.max(Number(days) || 14, 1), 31);
  const modality = await getModalityById(pool, cleanModalityId);

  const { rows } = await pool.query(
    `
      with calendar as (
        select (current_date + offset_day)::date as appointment_date
        from generate_series(0, $2::int - 1) as offset_day
      ),
      bookings as (
        select
          appointment_date,
          count(*) filter (where status <> 'cancelled') as booked_count,
          max(modality_slot_number) as last_slot_number
        from appointments
        where modality_id = $1
          and appointment_date between current_date and (current_date + ($2::int - 1))
        group by appointment_date
      )
      select
        calendar.appointment_date,
        coalesce(bookings.booked_count, 0) as booked_count,
        coalesce(bookings.last_slot_number, 0) as last_slot_number
      from calendar
      left join bookings on bookings.appointment_date = calendar.appointment_date
      order by calendar.appointment_date asc
    `,
    [cleanModalityId, windowDays]
  );

  return rows.map((row) => {
    const capacity = Number(modality.daily_capacity || 0);
    const bookedCount = Number(row.booked_count || 0);
    const remaining = Math.max(capacity - bookedCount, 0);

    return {
      appointment_date: row.appointment_date,
      booked_count: bookedCount,
      remaining_capacity: remaining,
      daily_capacity: capacity,
      is_full: remaining <= 0
    };
  });
}

export async function createExamType(payload) {
  const modalityId = normalizePositiveInteger(payload.modalityId, "modalityId");
  const nameAr = String(payload.nameAr || "").trim();
  const nameEn = String(payload.nameEn || "").trim();
  const specificInstructionAr = String(payload.specificInstructionAr || "").trim();
  const specificInstructionEn = String(payload.specificInstructionEn || "").trim();

  if (!nameAr || !nameEn) {
    throw new HttpError(400, "nameAr and nameEn are required.");
  }

  const client = await pool.connect();

  try {
    await getModalityById(client, modalityId);
    const { rows } = await client.query(
      `
        insert into exam_types (
          modality_id,
          name_ar,
          name_en,
          specific_instruction_ar,
          specific_instruction_en
        )
        values ($1, $2, $3, nullif($4, ''), nullif($5, ''))
        returning id, modality_id, name_ar, name_en, specific_instruction_ar, specific_instruction_en, is_active
      `,
      [modalityId, nameAr, nameEn, specificInstructionAr, specificInstructionEn]
    );

    return rows[0];
  } finally {
    client.release();
  }
}

export async function createAppointment(payload, currentUser) {
  const patientId = normalizePositiveInteger(payload.patientId, "patientId");
  const modalityId = normalizePositiveInteger(payload.modalityId, "modalityId");
  const examTypeId = normalizePositiveInteger(payload.examTypeId, "examTypeId", { required: false });
  const reportingPriorityId = normalizePositiveInteger(payload.reportingPriorityId, "reportingPriorityId", {
    required: false
  });
  const appointmentDate = normalizeAppointmentDate(payload.appointmentDate);
  const notes = String(payload.notes || "").trim();
  const overbookingReason = String(payload.overbookingReason || "").trim();
  const isWalkIn = Boolean(payload.isWalkIn);
  const client = await pool.connect();

  try {
    await client.query("begin");
    await client.query("select pg_advisory_xact_lock(hashtext($1))", [`appointment-sequence:${appointmentDate}`]);
    await client.query("select pg_advisory_xact_lock(hashtext($1))", [`appointment-slot:${modalityId}:${appointmentDate}`]);

    const patient = await getPatientById(client, patientId);
    const modality = await getModalityById(client, modalityId);
    const examType = await getExamTypeById(client, examTypeId, modalityId);
    const priority = await getPriorityById(client, reportingPriorityId);

    const bookingStats = await client.query(
      `
        select
          count(*) filter (where status <> 'cancelled') as booked_count,
          coalesce(max(modality_slot_number), 0) as last_slot_number,
          coalesce(max(daily_sequence), 0) as last_daily_sequence
        from appointments
        where modality_id = $1
          and appointment_date = $2::date
      `,
      [modalityId, appointmentDate]
    );

    const globalStats = await client.query(
      `
        select coalesce(max(daily_sequence), 0) as last_daily_sequence
        from appointments
        where appointment_date = $1::date
      `,
      [appointmentDate]
    );

    const bookedCount = Number(bookingStats.rows[0]?.booked_count || 0);
    const nextSlotNumber = Number(bookingStats.rows[0]?.last_slot_number || 0) + 1;
    const nextDailySequence = Number(globalStats.rows[0]?.last_daily_sequence || 0) + 1;
    const capacity = Number(modality.daily_capacity || 0);
    const isOverbooked = bookedCount >= capacity;

    if (isOverbooked && currentUser.role !== "supervisor") {
      throw new HttpError(409, "This modality is full for the selected day. A supervisor must overbook.");
    }

    if (isOverbooked && !overbookingReason) {
      throw new HttpError(400, "overbookingReason is required when capacity is full.");
    }

    const accessionNumber = buildAccessionNumber(appointmentDate, nextDailySequence);
    const { rows } = await client.query(
      `
        insert into appointments (
          patient_id,
          modality_id,
          exam_type_id,
          reporting_priority_id,
          accession_number,
          appointment_date,
          daily_sequence,
          modality_slot_number,
          status,
          is_walk_in,
          is_overbooked,
          overbooking_reason,
          approved_by_name,
          notes,
          created_by_user_id,
          updated_by_user_id
        )
        values (
          $1,
          $2,
          $3,
          $4,
          $5,
          $6::date,
          $7,
          $8,
          'scheduled',
          $9,
          $10,
          nullif($11, ''),
          $12,
          nullif($13, ''),
          $14,
          $14
        )
        returning *
      `,
      [
        patientId,
        modalityId,
        examType?.id || null,
        priority?.id || null,
        accessionNumber,
        appointmentDate,
        nextDailySequence,
        nextSlotNumber,
        isWalkIn,
        isOverbooked,
        overbookingReason,
        isOverbooked ? currentUser.fullName : null,
        notes,
        currentUser.sub
      ]
    );

    await client.query(
      `
        insert into appointment_status_history (appointment_id, old_status, new_status, changed_by_user_id, reason)
        values ($1, null, 'scheduled', $2, $3)
      `,
      [rows[0].id, currentUser.sub, isOverbooked ? overbookingReason : null]
    );

    await logAuditEntry(
      {
        entityType: "appointment",
        entityId: rows[0].id,
        actionType: "create",
        oldValues: null,
        newValues: rows[0],
        changedByUserId: currentUser.sub
      },
      client
    );

    await client.query("commit");

    return {
      appointment: rows[0],
      patient,
      modality,
      examType,
      priority,
      barcodeValue: accessionNumber
    };
  } catch (error) {
    await client.query("rollback");
    throw error;
  } finally {
    client.release();
  }
}

export async function updateAppointment(appointmentId, payload, currentUser) {
  const cleanAppointmentId = normalizePositiveInteger(appointmentId, "appointmentId");
  const modalityId = normalizePositiveInteger(payload.modalityId, "modalityId");
  const examTypeId = normalizePositiveInteger(payload.examTypeId, "examTypeId", { required: false });
  const reportingPriorityId = normalizePositiveInteger(payload.reportingPriorityId, "reportingPriorityId", {
    required: false
  });
  const appointmentDate = normalizeAppointmentDate(payload.appointmentDate);
  const notes = normalizeOptionalText(payload.notes);
  const overbookingReason = normalizeOptionalText(payload.overbookingReason);
  const client = await pool.connect();

  try {
    await client.query("begin");
    const existingAppointment = await getAppointmentById(client, cleanAppointmentId);

    if (!["scheduled", "arrived", "waiting"].includes(existingAppointment.status)) {
      throw new HttpError(409, "Only active reception appointments can be edited or rescheduled.");
    }

    await client.query("select pg_advisory_xact_lock(hashtext($1))", [`appointment-sequence:${appointmentDate}`]);
    await client.query("select pg_advisory_xact_lock(hashtext($1))", [`appointment-slot:${modalityId}:${appointmentDate}`]);

    const modality = await getModalityById(client, modalityId);
    const examType = await getExamTypeById(client, examTypeId, modalityId);
    const priority = await getPriorityById(client, reportingPriorityId);
    const slotStats = await nextModalitySlotNumber(client, modalityId, appointmentDate, cleanAppointmentId);
    const capacity = Number(modality.daily_capacity || 0);
    const isOverbooked = slotStats.bookedCount >= capacity;

    if (isOverbooked && currentUser.role !== "supervisor") {
      throw new HttpError(409, "This modality is full for the selected day. A supervisor must overbook.");
    }

    if (isOverbooked && !overbookingReason) {
      throw new HttpError(400, "overbookingReason is required when capacity is full.");
    }

    const sequence =
      existingAppointment.appointment_date?.toISOString?.().slice(0, 10) === appointmentDate
        ? existingAppointment.daily_sequence
        : await nextDailySequence(client, appointmentDate, cleanAppointmentId);
    const accessionNumber = buildAccessionNumber(appointmentDate, sequence);

    const { rows } = await client.query(
      `
        update appointments
        set
          modality_id = $2,
          exam_type_id = $3,
          reporting_priority_id = $4,
          accession_number = $5,
          appointment_date = $6::date,
          daily_sequence = $7,
          modality_slot_number = $8,
          is_overbooked = $9,
          overbooking_reason = nullif($10, ''),
          approved_by_name = case when $9 then $11 else null end,
          notes = nullif($12, ''),
          updated_by_user_id = $13,
          updated_at = now()
        where id = $1
        returning *
      `,
      [
        cleanAppointmentId,
        modalityId,
        examType?.id || null,
        priority?.id || null,
        accessionNumber,
        appointmentDate,
        sequence,
        slotStats.slotNumber,
        isOverbooked,
        overbookingReason,
        isOverbooked ? currentUser.fullName : null,
        notes,
        currentUser.sub
      ]
    );

    await client.query(
      `
        insert into appointment_status_history (appointment_id, old_status, new_status, changed_by_user_id, reason)
        values ($1, $2, $2, $3, $4)
      `,
      [cleanAppointmentId, existingAppointment.status, currentUser.sub, "Appointment edited or rescheduled"]
    );

    await logAuditEntry(
      {
        entityType: "appointment",
        entityId: cleanAppointmentId,
        actionType: "update",
        oldValues: existingAppointment,
        newValues: rows[0],
        changedByUserId: currentUser.sub
      },
      client
    );

    await client.query("commit");
    return rows[0];
  } catch (error) {
    await client.query("rollback");
    throw error;
  } finally {
    client.release();
  }
}

export async function cancelAppointment(appointmentId, reason, currentUserId) {
  const cleanAppointmentId = normalizePositiveInteger(appointmentId, "appointmentId");
  const cleanReason = normalizeOptionalText(reason);

  if (!cleanReason) {
    throw new HttpError(400, "cancelReason is required.");
  }

  const client = await pool.connect();

  try {
    await client.query("begin");
    const appointment = await getAppointmentById(client, cleanAppointmentId);

    if (["cancelled", "completed", "no-show"].includes(appointment.status)) {
      throw new HttpError(409, "This appointment can no longer be cancelled.");
    }

    await client.query(
      `
        update appointments
        set
          status = 'cancelled',
          cancel_reason = $2,
          updated_by_user_id = $3,
          updated_at = now()
        where id = $1
      `,
      [cleanAppointmentId, cleanReason, currentUserId]
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
        values ($1, $2, 'cancelled', $3, $4)
      `,
      [cleanAppointmentId, appointment.status, currentUserId, cleanReason]
    );

    await logAuditEntry(
      {
        entityType: "appointment",
        entityId: cleanAppointmentId,
        actionType: "cancel",
        oldValues: appointment,
        newValues: { status: "cancelled", cancel_reason: cleanReason },
        changedByUserId: currentUserId
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
