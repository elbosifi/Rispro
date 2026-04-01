import { pool } from "../db/pool.js";
import { HttpError } from "../utils/http-error.js";
import { getTripoliToday, TRIPOLI_TIME_ZONE } from "../utils/date.js";
import { logAuditEntry } from "./audit-service.js";
import { scheduleWorklistSync } from "./dicom-service.js";
import { authenticateUser } from "./auth-service.js";

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

function normalizeAppointmentDate(value, fieldName = "appointmentDate") {
  const raw = String(value || "").trim();

  if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
    throw new HttpError(400, `${fieldName} must be in YYYY-MM-DD format.`);
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

function normalizeCapacityLimit(value) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    return null;
  }
  return parsed;
}

function normalizeDailyCapacity(value) {
  if (value === undefined || value === null || value === "") {
    return 0;
  }

  const parsed = Number(value);

  if (!Number.isInteger(parsed) || parsed < 0) {
    throw new HttpError(400, "dailyCapacity must be 0 or a positive whole number.");
  }

  return parsed;
}

function normalizeSettingToggle(value, defaultValue = true) {
  const raw = String(value || "").trim().toLowerCase();

  if (!raw) {
    return defaultValue;
  }

  if (["enabled", "on", "true", "yes", "1"].includes(raw)) {
    return true;
  }

  if (["disabled", "off", "false", "no", "0"].includes(raw)) {
    return false;
  }

  return defaultValue;
}

function normalizeIsoDate(value) {
  if (value instanceof Date) {
    return value.toISOString().slice(0, 10);
  }

  return String(value || "").slice(0, 10);
}

function getTripoliWeekday(isoDate) {
  const date = new Date(`${isoDate}T00:00:00Z`);
  const weekday = new Intl.DateTimeFormat("en-US", { timeZone: TRIPOLI_TIME_ZONE, weekday: "long" }).format(date);
  return weekday.toLowerCase();
}

export async function getAppointmentDaySettings(client = pool) {
  const { rows } = await client.query(
    `
      select setting_key, setting_value
      from system_settings
      where category = 'scheduling_and_capacity'
        and setting_key in ('allow_friday_appointments', 'allow_saturday_appointments')
    `
  );

  const values = rows.reduce((accumulator, row) => {
    accumulator[row.setting_key] = row.setting_value?.value;
    return accumulator;
  }, {});

  return {
    fridayEnabled: normalizeSettingToggle(values.allow_friday_appointments, true),
    saturdayEnabled: normalizeSettingToggle(values.allow_saturday_appointments, true)
  };
}

async function requireAppointmentDayEnabled(client, appointmentDate) {
  const settings = await getAppointmentDaySettings(client);
  const weekday = getTripoliWeekday(appointmentDate);

  if (weekday === "friday" && !settings.fridayEnabled) {
    throw new HttpError(409, "Appointments are disabled on Friday in settings.");
  }

  if (weekday === "saturday" && !settings.saturdayEnabled) {
    throw new HttpError(409, "Appointments are disabled on Saturday in settings.");
  }
}

async function getMaxCasesPerModality(client) {
  const { rows } = await client.query(
    `
      select setting_value
      from system_settings
      where category = 'scheduling_and_capacity'
        and setting_key = 'max_cases_per_modality'
      limit 1
    `
  );

  const raw = rows[0]?.setting_value?.value;
  return normalizeCapacityLimit(raw);
}

function resolveEffectiveCapacity(modalityCapacity, maxCasesPerModality) {
  const modalityValue = normalizeCapacityLimit(modalityCapacity);
  const globalValue = normalizeCapacityLimit(maxCasesPerModality);

  if (modalityValue && globalValue) {
    return Math.min(modalityValue, globalValue);
  }

  return modalityValue || globalValue || 1;
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
    return getTripoliToday();
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

  if (Number(rows[0].modality_id) !== Number(modalityId)) {
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

export async function listExamTypesForSettings() {
  const [modalitiesResult, examTypesResult] = await Promise.all([
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
        select id, modality_id, name_ar, name_en, specific_instruction_ar, specific_instruction_en, is_active
        from exam_types
        where is_active = true
        order by name_en asc, name_ar asc
      `
    )
  ]);

  return {
    modalities: modalitiesResult.rows,
    examTypes: examTypesResult.rows
  };
}

export async function listAppointmentsForPrint(filters = {}) {
  const dateFrom = filters.dateFrom ? normalizeAppointmentDate(filters.dateFrom, "dateFrom") : null;
  const dateTo = filters.dateTo ? normalizeAppointmentDate(filters.dateTo, "dateTo") : null;
  const appointmentDate = !dateFrom && !dateTo ? normalizeDateOrToday(filters.date) : null;
  const query = String(filters.query || "").trim();
  const params = [];
  let dateClause = "";
  let modalityFilterSql = "";
  let queryFilterSql = "";

  if (dateFrom || dateTo) {
    const start = dateFrom || dateTo;
    const end = dateTo || dateFrom;

    if (start > end) {
      throw new HttpError(400, "dateFrom cannot be later than dateTo.");
    }

    params.push(start, end);
    dateClause = `appointments.appointment_date between $${params.length - 1}::date and $${params.length}::date`;
  } else {
    params.push(appointmentDate);
    dateClause = `appointments.appointment_date = $${params.length}::date`;
  }

  if (filters.modalityId) {
    const modalityId = normalizePositiveInteger(filters.modalityId, "modalityId");
    params.push(modalityId);
    modalityFilterSql = ` and appointments.modality_id = $${params.length}`;
  }

  if (query) {
    params.push(`%${query}%`);
    const patternIdx = params.length;
    queryFilterSql = `
      and (
        appointments.accession_number ilike $${patternIdx}
        or patients.arabic_full_name ilike $${patternIdx}
        or patients.english_full_name ilike $${patternIdx}
        or patients.phone_1 ilike $${patternIdx}
        or patients.national_id ilike $${patternIdx}
        or coalesce(patients.mrn, '') ilike $${patternIdx}
      )
    `;
  }

  const orderClause = dateFrom || dateTo ? "appointments.appointment_date asc, appointments.daily_sequence asc" : "appointments.daily_sequence asc";
  const { rows } = await pool.query(
    `
      select
        appointments.id,
        appointments.accession_number,
        appointments.appointment_date,
        appointments.created_at,
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
      where ${dateClause}
      ${modalityFilterSql}
      ${queryFilterSql}
      order by ${orderClause}
    `,
    params
  );

  return rows;
}

export async function listAppointmentStatistics(filters = {}) {
  const dateFrom = filters.dateFrom ? normalizeAppointmentDate(filters.dateFrom, "dateFrom") : null;
  const dateTo = filters.dateTo ? normalizeAppointmentDate(filters.dateTo, "dateTo") : null;
  const appointmentDate = !dateFrom && !dateTo ? normalizeDateOrToday(filters.date) : null;
  const modalityId = filters.modalityId ? normalizePositiveInteger(filters.modalityId, "modalityId") : null;
  const params = [];
  const clauses = [];

  if (dateFrom || dateTo) {
    const start = dateFrom || dateTo;
    const end = dateTo || dateFrom;

    if (start > end) {
      throw new HttpError(400, "dateFrom cannot be later than dateTo.");
    }

    params.push(start, end);
    clauses.push(`appointment_date between $${params.length - 1}::date and $${params.length}::date`);
  } else {
    params.push(appointmentDate);
    clauses.push(`appointment_date = $${params.length}::date`);
  }

  if (modalityId) {
    params.push(modalityId);
    clauses.push(`modality_id = $${params.length}`);
  }

  const whereClause = clauses.join(" and ");

  const [summaryResult, modalityResult, statusResult, dailyResult] = await Promise.all([
    pool.query(
      `
        select
          count(*) as total_appointments,
          count(distinct patient_id) as unique_patients,
          count(distinct modality_id) as unique_modalities,
          count(*) filter (where status = 'scheduled') as scheduled_count,
          count(*) filter (where status in ('arrived', 'waiting', 'in-progress')) as in_queue_count,
          count(*) filter (where status = 'completed') as completed_count,
          count(*) filter (where status = 'no-show') as no_show_count,
          count(*) filter (where status = 'cancelled') as cancelled_count,
          count(*) filter (where is_walk_in = true) as walk_in_count
        from appointments
        where ${whereClause}
      `,
      params
    ),
    pool.query(
      `
        select
          modalities.id as modality_id,
          modalities.code as modality_code,
          modalities.name_ar as modality_name_ar,
          modalities.name_en as modality_name_en,
          count(*) as total_count,
          count(*) filter (where appointments.status = 'scheduled') as scheduled_count,
          count(*) filter (where appointments.status in ('arrived', 'waiting', 'in-progress')) as in_queue_count,
          count(*) filter (where appointments.status = 'completed') as completed_count,
          count(*) filter (where appointments.status = 'no-show') as no_show_count,
          count(*) filter (where appointments.status = 'cancelled') as cancelled_count
        from appointments
        join modalities on modalities.id = appointments.modality_id
        where ${whereClause}
        group by modalities.id, modalities.code, modalities.name_ar, modalities.name_en
        order by total_count desc, modalities.name_en asc
      `,
      params
    ),
    pool.query(
      `
        select
          status,
          count(*) as total_count
        from appointments
        where ${whereClause}
        group by status
        order by total_count desc, status asc
      `,
      params
    ),
    pool.query(
      `
        select
          appointment_date,
          count(*) as total_count,
          count(*) filter (where status = 'completed') as completed_count,
          count(*) filter (where status = 'cancelled') as cancelled_count,
          count(*) filter (where status = 'no-show') as no_show_count
        from appointments
        where ${whereClause}
        group by appointment_date
        order by appointment_date asc
      `,
      params
    )
  ]);

  const summary = summaryResult.rows[0] || {};

  return {
    filters: {
      date: appointmentDate,
      dateFrom: dateFrom || "",
      dateTo: dateTo || "",
      modalityId: modalityId ? String(modalityId) : ""
    },
    summary: {
      total_appointments: Number(summary.total_appointments || 0),
      unique_patients: Number(summary.unique_patients || 0),
      unique_modalities: Number(summary.unique_modalities || 0),
      scheduled_count: Number(summary.scheduled_count || 0),
      in_queue_count: Number(summary.in_queue_count || 0),
      completed_count: Number(summary.completed_count || 0),
      no_show_count: Number(summary.no_show_count || 0),
      cancelled_count: Number(summary.cancelled_count || 0),
      walk_in_count: Number(summary.walk_in_count || 0)
    },
    modalityBreakdown: modalityResult.rows.map((row) => ({
      modality_id: row.modality_id,
      modality_code: row.modality_code,
      modality_name_ar: row.modality_name_ar,
      modality_name_en: row.modality_name_en,
      total_count: Number(row.total_count || 0),
      scheduled_count: Number(row.scheduled_count || 0),
      in_queue_count: Number(row.in_queue_count || 0),
      completed_count: Number(row.completed_count || 0),
      no_show_count: Number(row.no_show_count || 0),
      cancelled_count: Number(row.cancelled_count || 0)
    })),
    statusBreakdown: statusResult.rows.map((row) => ({
      status: row.status,
      total_count: Number(row.total_count || 0)
    })),
    dailyBreakdown: dailyResult.rows.map((row) => ({
      appointment_date: row.appointment_date,
      total_count: Number(row.total_count || 0),
      completed_count: Number(row.completed_count || 0),
      cancelled_count: Number(row.cancelled_count || 0),
      no_show_count: Number(row.no_show_count || 0)
    }))
  };
}

export async function getAppointmentPrintDetails(appointmentId) {
  const cleanAppointmentId = normalizePositiveInteger(appointmentId, "appointmentId");
  const appointments = await listAppointmentsForPrint({ date: getTripoliToday() });
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
        appointments.created_at,
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
  const daySettings = await getAppointmentDaySettings(pool);

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

  return rows
    .filter((row) => {
      const isoDate = normalizeIsoDate(row.appointment_date);
      const weekday = getTripoliWeekday(isoDate);

      if (weekday === "friday" && !daySettings.fridayEnabled) {
        return false;
      }

      if (weekday === "saturday" && !daySettings.saturdayEnabled) {
        return false;
      }

      return true;
    })
    .map((row) => {
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

export async function listModalitiesForSettings({ includeInactive = false } = {}) {
  const whereClause = includeInactive ? "" : "where is_active = true";
  const { rows } = await pool.query(
    `
      select id, code, name_ar, name_en, daily_capacity, general_instruction_ar, general_instruction_en, is_active
      from modalities
      ${whereClause}
      order by name_en asc
    `
  );

  return { modalities: rows };
}

export async function createModality(payload, currentUserId = null) {
  const code = String(payload.code || "").trim();
  const nameAr = String(payload.nameAr || "").trim();
  const nameEn = String(payload.nameEn || "").trim();
  const dailyCapacity = normalizeDailyCapacity(payload.dailyCapacity);
  const generalInstructionAr = String(payload.generalInstructionAr || "").trim();
  const generalInstructionEn = String(payload.generalInstructionEn || "").trim();
  const isActive = String(payload.isActive || "enabled") === "enabled";

  if (!code || !nameAr || !nameEn) {
    throw new HttpError(400, "code, nameAr, and nameEn are required.");
  }

  const client = await pool.connect();

  try {
    await client.query("begin");
    const { rows } = await client.query(
      `
        insert into modalities (
          code,
          name_ar,
          name_en,
          daily_capacity,
          general_instruction_ar,
          general_instruction_en,
          is_active
        )
        values ($1, $2, $3, $4, nullif($5, ''), nullif($6, ''), $7)
        returning id, code, name_ar, name_en, daily_capacity, general_instruction_ar, general_instruction_en, is_active
      `,
      [code, nameAr, nameEn, dailyCapacity, generalInstructionAr, generalInstructionEn, isActive]
    );

    if (currentUserId) {
      await logAuditEntry(
        {
          entityType: "modality",
          entityId: rows[0].id,
          actionType: "create",
          oldValues: null,
          newValues: rows[0],
          changedByUserId: currentUserId
        },
        client
      );
    }

    await client.query("commit");
    return rows[0];
  } catch (error) {
    await client.query("rollback");
    throw error;
  } finally {
    client.release();
  }
}

export async function updateModality(modalityId, payload, currentUserId) {
  const cleanModalityId = normalizePositiveInteger(modalityId, "modalityId");
  const code = String(payload.code || "").trim();
  const nameAr = String(payload.nameAr || "").trim();
  const nameEn = String(payload.nameEn || "").trim();
  const dailyCapacity = normalizeDailyCapacity(payload.dailyCapacity);
  const generalInstructionAr = String(payload.generalInstructionAr || "").trim();
  const generalInstructionEn = String(payload.generalInstructionEn || "").trim();
  const isActive = String(payload.isActive || "enabled") === "enabled";

  if (!code || !nameAr || !nameEn) {
    throw new HttpError(400, "code, nameAr, and nameEn are required.");
  }

  const client = await pool.connect();

  try {
    await client.query("begin");

    const existingResult = await client.query(
      `
        select id, code, name_ar, name_en, daily_capacity, general_instruction_ar, general_instruction_en, is_active
        from modalities
        where id = $1
        limit 1
      `,
      [cleanModalityId]
    );

    const existing = existingResult.rows[0];

    if (!existing) {
      throw new HttpError(404, "Modality not found.");
    }

    const { rows } = await client.query(
      `
        update modalities
        set
          code = $2,
          name_ar = $3,
          name_en = $4,
          daily_capacity = $5,
          general_instruction_ar = nullif($6, ''),
          general_instruction_en = nullif($7, ''),
          is_active = $8,
          updated_at = now()
        where id = $1
        returning id, code, name_ar, name_en, daily_capacity, general_instruction_ar, general_instruction_en, is_active
      `,
      [cleanModalityId, code, nameAr, nameEn, dailyCapacity, generalInstructionAr, generalInstructionEn, isActive]
    );

    await logAuditEntry(
      {
        entityType: "modality",
        entityId: cleanModalityId,
        actionType: "update",
        oldValues: existing,
        newValues: rows[0],
        changedByUserId: currentUserId
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

export async function deleteModality(modalityId, currentUserId) {
  const cleanModalityId = normalizePositiveInteger(modalityId, "modalityId");
  const client = await pool.connect();

  try {
    await client.query("begin");

    const existingResult = await client.query(
      `
        select id, code, name_ar, name_en, daily_capacity, general_instruction_ar, general_instruction_en, is_active
        from modalities
        where id = $1
        limit 1
      `,
      [cleanModalityId]
    );

    const existing = existingResult.rows[0];

    if (!existing || !existing.is_active) {
      throw new HttpError(404, "Modality not found.");
    }

    const { rows } = await client.query(
      `
        update modalities
        set
          is_active = false,
          updated_at = now()
        where id = $1
        returning id, code, name_ar, name_en, daily_capacity, general_instruction_ar, general_instruction_en, is_active
      `,
      [cleanModalityId]
    );

    await logAuditEntry(
      {
        entityType: "modality",
        entityId: cleanModalityId,
        actionType: "delete",
        oldValues: existing,
        newValues: rows[0],
        changedByUserId: currentUserId
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

export async function createExamType(payload, currentUserId = null) {
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
    await client.query("begin");
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

    if (currentUserId) {
      await logAuditEntry(
        {
          entityType: "exam_type",
          entityId: rows[0].id,
          actionType: "create",
          oldValues: null,
          newValues: rows[0],
          changedByUserId: currentUserId
        },
        client
      );
    }

    await client.query("commit");
    return rows[0];
  } catch (error) {
    await client.query("rollback");
    throw error;
  } finally {
    client.release();
  }
}

export async function updateExamType(examTypeId, payload, currentUserId) {
  const cleanExamTypeId = normalizePositiveInteger(examTypeId, "examTypeId");
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
    await client.query("begin");

    const existingResult = await client.query(
      `
        select id, modality_id, name_ar, name_en, specific_instruction_ar, specific_instruction_en, is_active
        from exam_types
        where id = $1
        limit 1
      `,
      [cleanExamTypeId]
    );

    const existing = existingResult.rows[0];

    if (!existing || !existing.is_active) {
      throw new HttpError(404, "Exam type not found.");
    }

    await getModalityById(client, modalityId);

    const { rows } = await client.query(
      `
        update exam_types
        set
          modality_id = $2,
          name_ar = $3,
          name_en = $4,
          specific_instruction_ar = nullif($5, ''),
          specific_instruction_en = nullif($6, ''),
          is_active = true,
          updated_at = now()
        where id = $1
        returning id, modality_id, name_ar, name_en, specific_instruction_ar, specific_instruction_en, is_active
      `,
      [cleanExamTypeId, modalityId, nameAr, nameEn, specificInstructionAr, specificInstructionEn]
    );

    await logAuditEntry(
      {
        entityType: "exam_type",
        entityId: cleanExamTypeId,
        actionType: "update",
        oldValues: existing,
        newValues: rows[0],
        changedByUserId: currentUserId
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

export async function deleteExamType(examTypeId, currentUserId) {
  const cleanExamTypeId = normalizePositiveInteger(examTypeId, "examTypeId");
  const client = await pool.connect();

  try {
    await client.query("begin");

    const existingResult = await client.query(
      `
        select id, modality_id, name_ar, name_en, specific_instruction_ar, specific_instruction_en, is_active
        from exam_types
        where id = $1
        limit 1
      `,
      [cleanExamTypeId]
    );

    const existing = existingResult.rows[0];

    if (!existing || !existing.is_active) {
      throw new HttpError(404, "Exam type not found.");
    }

    const { rows } = await client.query(
      `
        update exam_types
        set
          is_active = false,
          updated_at = now()
        where id = $1
        returning id, modality_id, name_ar, name_en, specific_instruction_ar, specific_instruction_en, is_active
      `,
      [cleanExamTypeId]
    );

    await logAuditEntry(
      {
        entityType: "exam_type",
        entityId: cleanExamTypeId,
        actionType: "delete",
        oldValues: existing,
        newValues: rows[0],
        changedByUserId: currentUserId
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

export async function createAppointment(payload, currentUser, options = {}) {
  const supervisorPassword = String(options.supervisorPassword || "").trim();
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
    await requireAppointmentDayEnabled(client, appointmentDate);
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

    const maxCasesPerModality = await getMaxCasesPerModality(client);
    const bookedCount = Number(bookingStats.rows[0]?.booked_count || 0);
    const nextSlotNumber = Number(bookingStats.rows[0]?.last_slot_number || 0) + 1;
    const nextDailySequence = Number(globalStats.rows[0]?.last_daily_sequence || 0) + 1;
    const capacity = resolveEffectiveCapacity(modality.daily_capacity, maxCasesPerModality);
    const isOverbooked = bookedCount >= capacity;

    if (isOverbooked && currentUser.role !== "supervisor") {
      throw new HttpError(409, "This modality is full for the selected day. A supervisor must overbook.");
    }

    if (isOverbooked && !supervisorPassword) {
      throw new HttpError(403, "Supervisor password confirmation is required before overbooking.");
    }

    if (isOverbooked && supervisorPassword) {
      await authenticateUser(currentUser.username, supervisorPassword);
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
    scheduleWorklistSync(rows[0].id);

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

export async function updateAppointment(appointmentId, payload, currentUser, options = {}) {
  const supervisorPassword = String(options.supervisorPassword || "").trim();
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

    const existingDate = normalizeIsoDate(existingAppointment.appointment_date);
    if (existingDate !== appointmentDate) {
      await requireAppointmentDayEnabled(client, appointmentDate);
    }

    await client.query("select pg_advisory_xact_lock(hashtext($1))", [`appointment-sequence:${appointmentDate}`]);
    await client.query("select pg_advisory_xact_lock(hashtext($1))", [`appointment-slot:${modalityId}:${appointmentDate}`]);

    const modality = await getModalityById(client, modalityId);
    const examType = await getExamTypeById(client, examTypeId, modalityId);
    const priority = await getPriorityById(client, reportingPriorityId);
    const slotStats = await nextModalitySlotNumber(client, modalityId, appointmentDate, cleanAppointmentId);
    const maxCasesPerModality = await getMaxCasesPerModality(client);
    const capacity = resolveEffectiveCapacity(modality.daily_capacity, maxCasesPerModality);
    const isOverbooked = slotStats.bookedCount >= capacity;

    if (isOverbooked && currentUser.role !== "supervisor") {
      throw new HttpError(409, "This modality is full for the selected day. A supervisor must overbook.");
    }

    if (isOverbooked && !supervisorPassword) {
      throw new HttpError(403, "Supervisor password confirmation is required before overbooking.");
    }

    if (isOverbooked && supervisorPassword) {
      await authenticateUser(currentUser.username, supervisorPassword);
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
    scheduleWorklistSync(cleanAppointmentId);
    return rows[0];
  } catch (error) {
    await client.query("rollback");
    throw error;
  } finally {
    client.release();
  }
}

export async function updateAppointmentProtocol(appointmentId, payload, currentUser) {
  const cleanAppointmentId = normalizePositiveInteger(appointmentId, "appointmentId");
  const examTypeId = normalizePositiveInteger(payload.examTypeId, "examTypeId", { required: false });
  const client = await pool.connect();

  try {
    await client.query("begin");
    const existingAppointment = await getAppointmentById(client, cleanAppointmentId);

    if (!["scheduled", "arrived", "waiting"].includes(existingAppointment.status)) {
      throw new HttpError(409, "Only active reception appointments can be updated.");
    }

    const examType = await getExamTypeById(client, examTypeId, existingAppointment.modality_id);

    const { rows } = await client.query(
      `
        update appointments
        set
          exam_type_id = $2,
          updated_by_user_id = $3,
          updated_at = now()
        where id = $1
        returning *
      `,
      [cleanAppointmentId, examType?.id || null, currentUser.sub]
    );

    await client.query(
      `
        insert into appointment_status_history (appointment_id, old_status, new_status, changed_by_user_id, reason)
        values ($1, $2, $2, $3, $4)
      `,
      [cleanAppointmentId, existingAppointment.status, currentUser.sub, "Protocol updated"]
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
    scheduleWorklistSync(cleanAppointmentId);
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

    if (["cancelled", "completed", "discontinued", "no-show", "in-progress"].includes(appointment.status)) {
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
    scheduleWorklistSync(cleanAppointmentId);
    return { ok: true };
  } catch (error) {
    await client.query("rollback");
    throw error;
  } finally {
    client.release();
  }
}
