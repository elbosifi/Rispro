// @ts-check

import { pool } from "../db/pool.js";
import { HttpError } from "../utils/http-error.js";
import { getTripoliToday, TRIPOLI_TIME_ZONE } from "../utils/date.js";
import { logAuditEntry } from "./audit-service.js";
import { scheduleWorklistSync } from "./dicom-service.js";
import { authenticateUser } from "./auth-service.js";
import {
  APPOINTMENT_NON_CANCELLABLE_STATUSES,
  APPOINTMENT_RECEPTION_ACTIVE_STATUSES,
  isListableAppointmentStatus
} from "../constants/appointment-statuses.js";

/** @typedef {import("../types/domain.js").Appointment} DomainAppointment */
/** @typedef {import("../types/domain.js").AppointmentStatus} AppointmentStatus */
/** @typedef {import("../types/http.js").UnknownRecord} UnknownRecord */
/** @typedef {import("../types/http.js").UserId} UserId */
/** @typedef {import("../types/http.js").AuthenticatedUserContext} AuthenticatedUserContext */
/** @typedef {import("../types/db.js").DbNumeric} DbNumeric */
/** @typedef {import("../types/db.js").NullableDbNumeric} NullableDbNumeric */
/** @typedef {import("../types/settings.js").CategorySettings} CategorySettings */
/** @typedef {import("../types/http.js").AuthenticatedUserContext & { id?: UserId }} AppointmentActor */

/**
 * @typedef PrintAppointmentRow
 * @property {number} id
 * @property {string} accession_number
 * @property {string} appointment_date
 * @property {string} arabic_full_name
 * @property {string | null} english_full_name
 * @property {string} modality_name_en
 * @property {string} modality_name_ar
 * @property {string | null} exam_name_en
 * @property {string | null} exam_name_ar
 * @property {string} status
 * @property {boolean} is_walk_in
 * @property {string | null} notes
 */

/**
 * @typedef AvailabilitySlot
 * @property {string} appointment_date
 * @property {number} booked_count
 * @property {number} remaining_capacity
 * @property {number | null} daily_capacity
 * @property {boolean} is_full
 */

/**
 * @typedef AppointmentFilters
 * @property {string} [dateFrom]
 * @property {string} [dateTo]
 * @property {string} [date]
 * @property {string} [modalityId]
 * @property {string} [query]
 * @property {string[]} [status]
 */

/**
 * @typedef AppointmentStatisticsFilters
 * @property {string} [dateFrom]
 * @property {string} [dateTo]
 * @property {string} [date]
 * @property {string} [modalityId]
 */

/**
 * @typedef AppointmentUpdateOptions
 * @property {string} [supervisorUsername]
 * @property {string} [supervisorPassword]
 */

/**
 * @typedef SchedulingSettingRow
 * @property {string} setting_key
 * @property {{ value?: unknown } | null} [setting_value]
 */

/**
 * @typedef AppointmentStatusRow
 * @property {number} id
 * @property {AppointmentStatus} status
 */

/**
 * @typedef SequenceRow
 * @property {NullableDbNumeric} last_daily_sequence
 */

/**
 * @typedef ModalitySlotAggregateRow
 * @property {NullableDbNumeric} booked_count
 * @property {NullableDbNumeric} last_slot_number
 */

/**
 * @typedef BookingStatsRow
 * @property {NullableDbNumeric} booked_count
 * @property {NullableDbNumeric} last_slot_number
 * @property {NullableDbNumeric} last_daily_sequence
 */

/**
 * @typedef AppointmentDbRow
 * @property {number} id
 * @property {number} patient_id
 * @property {number} modality_id
 * @property {number | null} exam_type_id
 * @property {number | null} reporting_priority_id
 * @property {string} accession_number
 * @property {string} appointment_date
 * @property {number} daily_sequence
 * @property {number | null} modality_slot_number
 * @property {AppointmentStatus} status
 * @property {string | null} notes
 * @property {string | null} overbooking_reason
 */

/**
 * @typedef PatientLookupRow
 * @property {number} id
 * @property {string | null} mrn
 * @property {string | null} national_id
 * @property {string} arabic_full_name
 * @property {string | null} english_full_name
 * @property {number} age_years
 * @property {string | null} estimated_date_of_birth
 * @property {string | null} sex
 * @property {string | null} phone_1
 * @property {string | null} phone_2
 * @property {string | null} address
 */

/**
 * @typedef ModalityRow
 * @property {number} id
 * @property {string} code
 * @property {string} name_ar
 * @property {string} name_en
 * @property {number | null} daily_capacity
 * @property {string | null} general_instruction_ar
 * @property {string | null} general_instruction_en
 * @property {boolean} is_active
 * @property {string | null} safety_warning_ar
 * @property {string | null} safety_warning_en
 * @property {boolean} safety_warning_enabled
 */

/**
 * @typedef ExamTypeRow
 * @property {number} id
 * @property {number} modality_id
 * @property {string} name_ar
 * @property {string} name_en
 * @property {string | null} specific_instruction_ar
 * @property {string | null} specific_instruction_en
 * @property {boolean} is_active
 */

/**
 * @typedef ReportingPriorityRow
 * @property {number} id
 * @property {string} code
 * @property {string} name_ar
 * @property {string} name_en
 */

/**
 * @typedef AppointmentCreateResult
 * @property {AppointmentDbRow} appointment
 * @property {UnknownRecord} patient
 * @property {UnknownRecord} modality
 * @property {UnknownRecord | null} examType
 * @property {UnknownRecord | null} priority
 * @property {string} barcodeValue
 */

/**
 * @typedef AppointmentStatsSummaryRow
 * @property {DbNumeric} total_appointments
 * @property {DbNumeric} unique_patients
 * @property {DbNumeric} unique_modalities
 * @property {DbNumeric} scheduled_count
 * @property {DbNumeric} in_queue_count
 * @property {DbNumeric} completed_count
 * @property {DbNumeric} no_show_count
 * @property {DbNumeric} cancelled_count
 * @property {DbNumeric} walk_in_count
 */

/**
 * @typedef AppointmentListRow
 * @property {number} id
 * @property {string} accession_number
 * @property {string} appointment_date
 * @property {string} created_at
 * @property {number | null} modality_slot_number
 * @property {AppointmentStatus} status
 * @property {string | null} notes
 * @property {boolean} is_walk_in
 * @property {boolean} is_overbooked
 * @property {string | null} overbooking_reason
 * @property {number} patient_id
 * @property {string | null} mrn
 * @property {string | null} national_id
 * @property {string} arabic_full_name
 * @property {string | null} english_full_name
 * @property {number} age_years
 * @property {string | null} sex
 * @property {string | null} phone_1
 * @property {string | null} address
 * @property {number} modality_id
 * @property {string} modality_code
 * @property {string} modality_name_ar
 * @property {string} modality_name_en
 * @property {string | null} general_instruction_ar
 * @property {string | null} general_instruction_en
 * @property {number | null} exam_type_id
 * @property {string | null} exam_name_ar
 * @property {string | null} exam_name_en
 * @property {string | null} specific_instruction_ar
 * @property {string | null} specific_instruction_en
 * @property {string | null} priority_name_ar
 * @property {string | null} priority_name_en
 */

/**
 * @typedef ModalityBreakdownRow
 * @property {number} modality_id
 * @property {string} modality_code
 * @property {string} modality_name_ar
 * @property {string} modality_name_en
 * @property {DbNumeric} total_count
 * @property {DbNumeric} scheduled_count
 * @property {DbNumeric} in_queue_count
 * @property {DbNumeric} completed_count
 * @property {DbNumeric} no_show_count
 * @property {DbNumeric} cancelled_count
 */

/**
 * @typedef StatusBreakdownRow
 * @property {AppointmentStatus} status
 * @property {DbNumeric} total_count
 */

/**
 * @typedef DailyBreakdownRow
 * @property {string} appointment_date
 * @property {DbNumeric} total_count
 * @property {DbNumeric} completed_count
 * @property {DbNumeric} cancelled_count
 * @property {DbNumeric} no_show_count
 */

/**
 * @param {unknown} value
 * @param {string} fieldName
 * @param {{ required?: boolean }} [options]
 * @returns {number | null}
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
 * @param {string} [fieldName]
 * @returns {string}
 */
function normalizeAppointmentDate(value, fieldName = "appointmentDate") {
  const raw = String(value || "").trim();

  if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
    throw new HttpError(400, `${fieldName} must be in YYYY-MM-DD format.`);
  }

  return raw;
}

/**
 * @param {string} appointmentDate
 * @param {number} dailySequence
 * @returns {string}
 */
function buildAccessionNumber(appointmentDate, dailySequence) {
  const compactDate = appointmentDate.replaceAll("-", "");
  return `${compactDate}-${String(dailySequence).padStart(3, "0")}`;
}

/**
 * @param {unknown} value
 * @returns {string}
 */
function normalizeOptionalText(value) {
  return String(value || "").trim();
}

/**
 * @param {unknown} value
 * @returns {number | null}
 */
function normalizeCapacityLimit(value) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    return null;
  }
  return parsed;
}

/**
 * @param {unknown} value
 * @returns {number}
 */
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

/**
 * @param {unknown} value
 * @param {boolean} [defaultValue]
 * @returns {boolean}
 */
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

/**
 * @param {unknown} value
 * @returns {string}
 */
function normalizeIsoDate(value) {
  if (value instanceof Date) {
    return value.toISOString().slice(0, 10);
  }

  return String(value || "").slice(0, 10);
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
 * @param {string} isoDate
 * @returns {string}
 */
function getTripoliWeekday(isoDate) {
  const date = new Date(`${isoDate}T00:00:00Z`);
  const weekday = new Intl.DateTimeFormat("en-US", { timeZone: TRIPOLI_TIME_ZONE, weekday: "long" }).format(date);
  return weekday.toLowerCase();
}

/**
 * @param {import("pg").Pool | import("pg").PoolClient} client
 * @returns {Promise<{ fridayEnabled: boolean, saturdayEnabled: boolean }>}
 */
export async function getAppointmentDaySettings(client = pool) {
  const { rows } = await client.query(
    `
      select setting_key, setting_value
      from system_settings
      where category = 'scheduling_and_capacity'
        and setting_key in ('allow_friday_appointments', 'allow_saturday_appointments')
    `
  );

  const settingsRows = /** @type {SchedulingSettingRow[]} */ (rows);
  const values = settingsRows.reduce((accumulator, row) => {
    accumulator[row.setting_key] = String(row.setting_value?.value ?? "");
    return accumulator;
  }, /** @type {CategorySettings} */ ({}));

  return {
    fridayEnabled: normalizeSettingToggle(values.allow_friday_appointments, true),
    saturdayEnabled: normalizeSettingToggle(values.allow_saturday_appointments, true)
  };
}

/**
 * @param {import("pg").Pool | import("pg").PoolClient} client
 * @param {string} appointmentDate
 * @returns {Promise<void>}
 */
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

/**
 * @param {import("pg").PoolClient} client
 * @returns {Promise<number | null>}
 */
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

  const settingRow = /** @type {{ setting_value?: { value?: unknown } } | undefined} */ (rows[0]);
  const raw = settingRow?.setting_value?.value;
  return normalizeCapacityLimit(raw);
}

/**
 * @param {number | null} modalityCapacity
 * @param {number | null} maxCasesPerModality
 * @returns {number | null}
 */
function resolveEffectiveCapacity(modalityCapacity, maxCasesPerModality) {
  const modalityValue = normalizeCapacityLimit(modalityCapacity);
  const globalValue = normalizeCapacityLimit(maxCasesPerModality);

  if (modalityValue && globalValue) {
    return Math.min(modalityValue, globalValue);
  }

  return modalityValue || globalValue || 1;
}

/**
 * @param {import("pg").PoolClient} client
 * @param {number | string} appointmentId
 * @returns {Promise<AppointmentDbRow>}
 */
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

  const appointment = /** @type {AppointmentDbRow | undefined} */ (rows[0]);

  if (!appointment) {
    throw new HttpError(404, "Appointment not found.");
  }

  return appointment;
}

/**
 * @param {import("pg").Pool | import("pg").PoolClient} client
 * @param {string} appointmentDate
 * @param {number | null} [excludeAppointmentId]
 * @returns {Promise<number>}
 */
async function nextDailySequence(client, appointmentDate, excludeAppointmentId = null) {
  const params = [appointmentDate];
  let excludeSql = "";

  if (excludeAppointmentId) {
    params.push(String(excludeAppointmentId));
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

  const sequenceRow = /** @type {SequenceRow | undefined} */ (rows[0]);
  return Number(sequenceRow?.last_daily_sequence || 0) + 1;
}

/**
 * @param {import("pg").PoolClient} client
 * @param {number | string} modalityId
 * @param {string} appointmentDate
 * @param {number | null} [excludeAppointmentId]
 * @returns {Promise<{ bookedCount: number, slotNumber: number }>}
 */
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

  const aggregateRow = /** @type {ModalitySlotAggregateRow | undefined} */ (rows[0]);
  return {
    bookedCount: Number(aggregateRow?.booked_count || 0),
    slotNumber: Number(aggregateRow?.last_slot_number || 0) + 1
  };
}

/**
 * @param {unknown} value
 * @returns {string}
 */
function normalizeDateOrToday(value) {
  if (!value) {
    return getTripoliToday();
  }

  return normalizeAppointmentDate(value);
}

/**
 * @param {import("pg").PoolClient} client
 * @param {number | string} patientId
 * @returns {Promise<PatientLookupRow>}
 */
async function getPatientById(client, patientId) {
  const cleanPatientId = normalizePositiveInteger(patientId, "patientId");
  const { rows } = await client.query(
    `
      select id, mrn, national_id, arabic_full_name, english_full_name, age_years, estimated_date_of_birth, sex, phone_1, phone_2, address
      from patients
      where id = $1
      limit 1
    `,
    [cleanPatientId]
  );

  const patient = /** @type {PatientLookupRow | undefined} */ (rows[0]);

  if (!patient) {
    throw new HttpError(404, "Patient not found.");
  }

  return patient;
}

/**
 * @param {import("pg").Pool | import("pg").PoolClient} client
 * @param {number | string} modalityId
 * @returns {Promise<ModalityRow>}
 */
async function getModalityById(client, modalityId) {
  const { rows } = await client.query(
    `
      select id, code, name_ar, name_en, daily_capacity, general_instruction_ar, general_instruction_en, is_active, safety_warning_ar, safety_warning_en, safety_warning_enabled
      from modalities
      where id = $1
      limit 1
    `,
    [modalityId]
  );

  const modality = /** @type {ModalityRow | undefined} */ (rows[0]);

  if (!modality || !modality.is_active) {
    throw new HttpError(404, "Modality not found.");
  }

  return modality;
}

/**
 * @param {import("pg").Pool | import("pg").PoolClient} client
 * @param {number | string} examTypeId
 * @param {number | string} [modalityId]
 * @returns {Promise<ExamTypeRow | null>}
 */
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

  const examType = /** @type {ExamTypeRow | undefined} */ (rows[0]);

  if (!examType || !examType.is_active) {
    throw new HttpError(404, "Exam type not found.");
  }

  if (Number(examType.modality_id) !== Number(modalityId)) {
    throw new HttpError(400, "The selected exam type does not belong to the selected modality.");
  }

  return examType;
}

/**
 * @param {import("pg").Pool | import("pg").PoolClient} client
 * @param {number | string} reportingPriorityId
 * @returns {Promise<ReportingPriorityRow | null>}
 */
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

  const priority = /** @type {ReportingPriorityRow | undefined} */ (rows[0]);

  if (!priority) {
    throw new HttpError(404, "Reporting priority not found.");
  }

  return priority;
}

/** @returns {Promise<{ modalities: ModalityRow[], examTypes: ExamTypeRow[], priorities: ReportingPriorityRow[] }>} */
export async function listAppointmentLookups() {
  const [modalitiesResult, examTypesResult, prioritiesResult] = await Promise.all([
    pool.query(
      `
        select id, code, name_ar, name_en, daily_capacity, general_instruction_ar, general_instruction_en, safety_warning_ar, safety_warning_en, safety_warning_enabled
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
    modalities: /** @type {ModalityRow[]} */ (modalitiesResult.rows),
    examTypes: /** @type {ExamTypeRow[]} */ (examTypesResult.rows),
    priorities: /** @type {ReportingPriorityRow[]} */ (prioritiesResult.rows)
  };
}

/** @returns {Promise<{ modalities: ModalityRow[], examTypes: ExamTypeRow[] }>} */
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
    modalities: /** @type {ModalityRow[]} */ (modalitiesResult.rows),
    examTypes: /** @type {ExamTypeRow[]} */ (examTypesResult.rows)
  };
}

/** @returns {Promise<AppointmentListRow[]>} */

/**
 * @param {unknown} filters
 */
/** @param {AppointmentFilters} [filters] */
export async function listAppointmentsForPrint(filters = {}) {
  const dateFrom = filters.dateFrom ? normalizeAppointmentDate(filters.dateFrom, "dateFrom") : null;
  const dateTo = filters.dateTo ? normalizeAppointmentDate(filters.dateTo, "dateTo") : null;
  const appointmentDate = !dateFrom && !dateTo ? normalizeDateOrToday(filters.date) : null;
  const query = String(filters.query || "").trim();
  const params = [];
  let dateClause = "";
  let modalityFilterSql = "";
  let queryFilterSql = "";
  let statusFilterSql = "";

  if (dateFrom || dateTo) {
    const start = dateFrom || dateTo;
    const end = dateTo || dateFrom;

    if (/** @type {string} */ (start) > /** @type {string} */ (end)) {
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

  if (filters.status && Array.isArray(filters.status) && filters.status.length > 0) {
    const validStatuses = filters.status.filter((s) => isListableAppointmentStatus(s));
    if (validStatuses.length > 0) {
      params.push(validStatuses);
      statusFilterSql = ` and appointments.status = ANY($${params.length})`;
    }
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
      ${statusFilterSql}
      order by ${orderClause}
    `,
    params
  );

  return /** @type {AppointmentListRow[]} */ (rows);
}

/** @returns {Promise<{ filters: { date: string | null, dateFrom: string, dateTo: string, modalityId: string }, summary: Record<string, number>, modalityBreakdown: ModalityBreakdownRow[], statusBreakdown: StatusBreakdownRow[], dailyBreakdown: DailyBreakdownRow[] }>} */

/**
 * @param {unknown} filters
 */
/** @param {AppointmentStatisticsFilters} [filters] */
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

    if (/** @type {string} */ (start) > /** @type {string} */ (end)) {
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

  const summary = /** @type {AppointmentStatsSummaryRow} */ (
    /** @type {AppointmentStatsSummaryRow | undefined} */ (summaryResult.rows[0]) || {
      total_appointments: 0,
      unique_patients: 0,
      unique_modalities: 0,
      scheduled_count: 0,
      in_queue_count: 0,
      completed_count: 0,
      no_show_count: 0,
      cancelled_count: 0,
      walk_in_count: 0
    }
  );

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
    modalityBreakdown: /** @type {ModalityBreakdownRow[]} */ (modalityResult.rows).map((row) => ({
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
    statusBreakdown: /** @type {StatusBreakdownRow[]} */ (statusResult.rows).map((row) => ({
      status: row.status,
      total_count: Number(row.total_count || 0)
    })),
    dailyBreakdown: /** @type {DailyBreakdownRow[]} */ (dailyResult.rows).map((row) => ({
      appointment_date: row.appointment_date,
      total_count: Number(row.total_count || 0),
      completed_count: Number(row.completed_count || 0),
      cancelled_count: Number(row.cancelled_count || 0),
      no_show_count: Number(row.no_show_count || 0)
    }))
  };
}

/**
 * @param {number | string} appointmentId
 * @returns {Promise<PrintAppointmentRow>}
 */
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

  const fallbackAppointment = /** @type {AppointmentListRow | undefined} */ (rows[0]);

  if (!fallbackAppointment) {
    throw new HttpError(404, "Appointment not found.");
  }

  return fallbackAppointment;
}

/**
 * @param {number | string} [modalityId]
 * @param {number} [days]
 * @returns {Promise<AvailabilitySlot[]>}
 */
export async function listAvailability(modalityId, days = 14) {
  const cleanModalityId = normalizePositiveInteger(modalityId, "modalityId");
  if (!cleanModalityId) {
    throw new HttpError(400, "modalityId is required.");
  }
  const windowDays = Math.min(Math.max(Number(days) || 14, 1), 31);
  const modality = await getModalityById(/** @type {any} */ (pool), cleanModalityId);
  const daySettings = await getAppointmentDaySettings(pool);
  const maxCasesPerModality = await getMaxCasesPerModality(/** @type {any} */ (pool));

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
      const capacity = resolveEffectiveCapacity(modality.daily_capacity, maxCasesPerModality);
      const bookedCount = Number(row.booked_count || 0);
      const remaining = Math.max((capacity || 0) - bookedCount, 0);

      return {
        appointment_date: row.appointment_date,
        booked_count: bookedCount,
        remaining_capacity: remaining,
        daily_capacity: capacity,
        is_full: remaining <= 0
      };
    });
}

/** @returns {Promise<{ modalities: ModalityRow[] }>} */

/**
 * @param {unknown} includeInactive
 */
/**
 * @param {{ includeInactive?: boolean }} [options]
 * @returns {Promise<{ modalities: ModalityRow[] }>}
 */
export async function listModalitiesForSettings({ includeInactive = false } = {}) {
  const whereClause = includeInactive ? "" : "where is_active = true";
  const { rows } = await pool.query(
    `
      select id, code, name_ar, name_en, daily_capacity, general_instruction_ar, general_instruction_en, is_active, safety_warning_ar, safety_warning_en, safety_warning_enabled
      from modalities
      ${whereClause}
      order by name_en asc
    `
  );

  return { modalities: rows };
}

/** @returns {Promise<ModalityRow>} */
/**
 * @param {UnknownRecord} payload
 * @param {UserId | null} [currentUserId]
 * @returns {Promise<ModalityRow>}
 */
export async function createModality(payload, currentUserId = null) {
  const code = String(payload.code || "").trim();
  const nameAr = String(payload.nameAr || "").trim();
  const nameEn = String(payload.nameEn || "").trim();
  const dailyCapacity = normalizeDailyCapacity(payload.dailyCapacity);
  const generalInstructionAr = String(payload.generalInstructionAr || "").trim();
  const generalInstructionEn = String(payload.generalInstructionEn || "").trim();
  const isActive = String(payload.isActive || "enabled") === "enabled";
  const safetyWarningAr = String(payload.safetyWarningAr || "").trim();
  const safetyWarningEn = String(payload.safetyWarningEn || "").trim();
  const safetyWarningEnabled = payload.safetyWarningEnabled !== false;

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
          is_active,
          safety_warning_ar,
          safety_warning_en,
          safety_warning_enabled
        )
        values ($1, $2, $3, $4, nullif($5, ''), nullif($6, ''), $7, nullif($8, ''), nullif($9, ''), $10)
        returning id, code, name_ar, name_en, daily_capacity, general_instruction_ar, general_instruction_en, is_active, safety_warning_ar, safety_warning_en, safety_warning_enabled
      `,
      [code, nameAr, nameEn, dailyCapacity, generalInstructionAr, generalInstructionEn, isActive, safetyWarningAr, safetyWarningEn, safetyWarningEnabled]
    );
    const createdModality = requireRow(/** @type {ModalityRow | undefined} */ (rows[0]), "Failed to create modality.");

    if (currentUserId) {
      await logAuditEntry(
        {
          entityType: "modality",
          entityId: createdModality.id,
          actionType: "create",
          oldValues: null,
          newValues: createdModality,
          changedByUserId: currentUserId
        },
        client
      );
    }

    await client.query("commit");
    return createdModality;
  } catch (error) {
    await client.query("rollback");
    throw error;
  } finally {
    client.release();
  }
}

/** @returns {Promise<ModalityRow>} */
/**
 * @param {number | string} modalityId
 * @param {UnknownRecord} payload
 * @param {UserId} currentUserId
 * @returns {Promise<ModalityRow>}
 */
export async function updateModality(modalityId, payload, currentUserId) {
  const cleanModalityId = normalizePositiveInteger(modalityId, "modalityId");
  const code = String(payload.code || "").trim();
  const nameAr = String(payload.nameAr || "").trim();
  const nameEn = String(payload.nameEn || "").trim();
  const dailyCapacity = normalizeDailyCapacity(payload.dailyCapacity);
  const generalInstructionAr = String(payload.generalInstructionAr || "").trim();
  const generalInstructionEn = String(payload.generalInstructionEn || "").trim();
  const isActive = String(payload.isActive || "enabled") === "enabled";
  const safetyWarningAr = String(payload.safetyWarningAr || "").trim();
  const safetyWarningEn = String(payload.safetyWarningEn || "").trim();
  const safetyWarningEnabled = payload.safetyWarningEnabled !== undefined ? Boolean(payload.safetyWarningEnabled) : true;

  if (!code || !nameAr || !nameEn) {
    throw new HttpError(400, "code, nameAr, and nameEn are required.");
  }

  const client = await pool.connect();

  try {
    await client.query("begin");

    const existingResult = await client.query(
      `
        select id, code, name_ar, name_en, daily_capacity, general_instruction_ar, general_instruction_en, is_active, safety_warning_ar, safety_warning_en, safety_warning_enabled
        from modalities
        where id = $1
        limit 1
      `,
      [cleanModalityId]
    );

    const existing = /** @type {ModalityRow | undefined} */ (existingResult.rows[0]);

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
          safety_warning_ar = nullif($9, ''),
          safety_warning_en = nullif($10, ''),
          safety_warning_enabled = $11,
          updated_at = now()
        where id = $1
        returning id, code, name_ar, name_en, daily_capacity, general_instruction_ar, general_instruction_en, is_active, safety_warning_ar, safety_warning_en, safety_warning_enabled
      `,
      [cleanModalityId, code, nameAr, nameEn, dailyCapacity, generalInstructionAr, generalInstructionEn, isActive, safetyWarningAr, safetyWarningEn, safetyWarningEnabled]
    );
    const updatedModality = requireRow(/** @type {ModalityRow | undefined} */ (rows[0]), "Failed to update modality.");

    await logAuditEntry(
      {
        entityType: "modality",
        entityId: cleanModalityId,
        actionType: "update",
        oldValues: existing,
        newValues: updatedModality,
        changedByUserId: currentUserId
      },
      client
    );

    await client.query("commit");
    return updatedModality;
  } catch (error) {
    await client.query("rollback");
    throw error;
  } finally {
    client.release();
  }
}

/** @returns {Promise<ModalityRow>} */
/**
 * @param {number | string} modalityId
 * @param {UserId} currentUserId
 * @returns {Promise<ModalityRow>}
 */
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

    const existing = /** @type {ModalityRow | undefined} */ (existingResult.rows[0]);

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
    const deletedModality = requireRow(/** @type {ModalityRow | undefined} */ (rows[0]), "Failed to delete modality.");

    await logAuditEntry(
      {
        entityType: "modality",
        entityId: cleanModalityId,
        actionType: "delete",
        oldValues: existing,
        newValues: deletedModality,
        changedByUserId: currentUserId
      },
      client
    );

    await client.query("commit");
    return deletedModality;
  } catch (error) {
    await client.query("rollback");
    throw error;
  } finally {
    client.release();
  }
}

/**
 * @param {UnknownRecord} payload
 * @param {UserId | null} [currentUserId]
 * @returns {Promise<UnknownRecord>}
 */
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
    await getModalityById(client, /** @type {number | string} */ (modalityId));
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
    const createdExamType = requireRow(/** @type {ExamTypeRow | undefined} */ (rows[0]), "Failed to create exam type.");

    if (currentUserId) {
      await logAuditEntry(
        {
          entityType: "exam_type",
          entityId: createdExamType.id,
          actionType: "create",
          oldValues: null,
          newValues: createdExamType,
          changedByUserId: currentUserId
        },
        client
      );
    }

    await client.query("commit");
    return createdExamType;
  } catch (error) {
    await client.query("rollback");
    throw error;
  } finally {
    client.release();
  }
}

/** @returns {Promise<ExamTypeRow>} */
/**
 * @param {number | string} examTypeId
 * @param {UnknownRecord} payload
 * @param {UserId} currentUserId
 * @returns {Promise<ExamTypeRow>}
 */
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

    const existing = /** @type {ExamTypeRow | undefined} */ (existingResult.rows[0]);

    if (!existing || !existing.is_active) {
      throw new HttpError(404, "Exam type not found.");
    }

    await getModalityById(client, /** @type {number | string} */ (modalityId));

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
    const updatedExamType = requireRow(/** @type {ExamTypeRow | undefined} */ (rows[0]), "Failed to update exam type.");

    await logAuditEntry(
      {
        entityType: "exam_type",
        entityId: cleanExamTypeId,
        actionType: "update",
        oldValues: existing,
        newValues: updatedExamType,
        changedByUserId: currentUserId
      },
      client
    );

    await client.query("commit");
    return updatedExamType;
  } catch (error) {
    await client.query("rollback");
    throw error;
  } finally {
    client.release();
  }
}

/** @returns {Promise<ExamTypeRow>} */
/**
 * @param {number | string} examTypeId
 * @param {UserId} currentUserId
 * @returns {Promise<ExamTypeRow>}
 */
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

    const existing = /** @type {ExamTypeRow | undefined} */ (existingResult.rows[0]);

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
    const deletedExamType = requireRow(/** @type {ExamTypeRow | undefined} */ (rows[0]), "Failed to delete exam type.");

    await logAuditEntry(
      {
        entityType: "exam_type",
        entityId: cleanExamTypeId,
        actionType: "delete",
        oldValues: existing,
        newValues: deletedExamType,
        changedByUserId: currentUserId
      },
      client
    );

    await client.query("commit");
    return deletedExamType;
  } catch (error) {
    await client.query("rollback");
    throw error;
  } finally {
    client.release();
  }
}

/**
 * @param {UnknownRecord} payload
 * @param {AppointmentActor | null | undefined} currentUser
 * @param {{ supervisorUsername?: string, supervisorPassword?: string }} [options]
 * @returns {Promise<AppointmentCreateResult>}
 */
export async function createAppointment(payload, currentUser, options = {}) {
  if (!currentUser?.sub) {
    throw new HttpError(401, "Authentication required.");
  }

  const supervisorUsername = String(options.supervisorUsername || "").trim();
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

    const patient = await getPatientById(client, /** @type {number | string} */ (patientId));
    const modality = await getModalityById(client, /** @type {number | string} */ (modalityId));
    const examType = examTypeId ? await getExamTypeById(client, /** @type {number | string} */ (examTypeId), /** @type {number | string} */ (modalityId)) : null;
    const priority = reportingPriorityId ? await getPriorityById(client, reportingPriorityId) : null;

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
    const bookingStatsRow = /** @type {BookingStatsRow | undefined} */ (bookingStats.rows[0]);
    const globalStatsRow = /** @type {SequenceRow | undefined} */ (globalStats.rows[0]);
    const bookedCount = Number(bookingStatsRow?.booked_count || 0);
    const nextSlotNumber = Number(bookingStatsRow?.last_slot_number || 0) + 1;
    const nextDailySequence = Number(globalStatsRow?.last_daily_sequence || 0) + 1;
    const capacity = resolveEffectiveCapacity(modality.daily_capacity, maxCasesPerModality);
    const isOverbooked = capacity !== null && bookedCount >= capacity;

    // Handle overbooking approval
    let approvingSupervisor = null;
    if (isOverbooked) {
      if (!supervisorUsername) {
        throw new HttpError(403, "Supervisor username is required before overbooking.");
      }
      if (!supervisorPassword) {
        throw new HttpError(403, "Supervisor password is required before overbooking.");
      }

      try {
        approvingSupervisor = await authenticateUser(supervisorUsername, supervisorPassword);
        if (!approvingSupervisor.is_active) {
          throw new HttpError(403, "Supervisor account is not active.");
        }
        if (approvingSupervisor.role !== "supervisor") {
          throw new HttpError(403, "Only an active supervisor can approve overbooking.");
        }
      } catch (error) {
        if (error instanceof HttpError) {
          throw error;
        }
        throw new HttpError(403, "Invalid supervisor credentials. Overbooking cancelled.");
      }

      if (!overbookingReason) {
        throw new HttpError(400, "overbookingReason is required when capacity is full.");
      }
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
          approved_by_user_id,
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
          $13,
          nullif($14, ''),
          $15,
          $15
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
        isOverbooked && approvingSupervisor ? approvingSupervisor.full_name : null,
        isOverbooked && approvingSupervisor ? approvingSupervisor.id : null,
        notes,
        currentUser.sub
      ]
    );
    const createdAppointment = requireRow(
      /** @type {AppointmentDbRow | undefined} */ (rows[0]),
      "Failed to create appointment."
    );

    await client.query(
      `
        insert into appointment_status_history (appointment_id, old_status, new_status, changed_by_user_id, reason)
        values ($1, null, 'scheduled', $2, $3)
      `,
      [createdAppointment.id, currentUser.sub, isOverbooked ? overbookingReason : null]
    );

    await logAuditEntry(
      {
        entityType: "appointment",
        entityId: createdAppointment.id,
        actionType: "create",
        oldValues: null,
        newValues: createdAppointment,
        changedByUserId: currentUser.sub
      },
      client
    );

    await client.query("commit");
    scheduleWorklistSync(createdAppointment.id);

    return {
      appointment: createdAppointment,
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

/**
 * @param {UserId} appointmentId
 * @param {UnknownRecord} payload
 * @param {AppointmentActor | null | undefined} currentUser
 * @param {{ supervisorUsername?: string, supervisorPassword?: string }} [options]
 */
/** @returns {Promise<AppointmentDbRow>} */
/**
 * @param {number | string} appointmentId
 * @param {UnknownRecord} payload
 * @param {AuthenticatedUserContext} currentUser
 * @param {AppointmentUpdateOptions} [options]
 * @returns {Promise<UnknownRecord>}
 */
export async function updateAppointment(appointmentId, payload, currentUser, options = {}) {
  if (!currentUser?.sub) {
    throw new HttpError(401, "Authentication required.");
  }

  const supervisorUsername = String(options.supervisorUsername || "").trim();
  const supervisorPassword = String(options.supervisorPassword || "").trim();
  const cleanAppointmentId = normalizePositiveInteger(appointmentId, "appointmentId");
  if (!cleanAppointmentId) {
    throw new HttpError(400, "appointmentId is required.");
  }
  const client = await pool.connect();

  try {
    await client.query("begin");
    const existingAppointment = await getAppointmentById(client, cleanAppointmentId);
    const existingStatus = existingAppointment.status;

    if (!APPOINTMENT_RECEPTION_ACTIVE_STATUSES.includes(existingStatus)) {
      throw new HttpError(409, "Only active reception appointments can be edited or rescheduled.");
    }

    const modalityId =
      payload.modalityId === undefined || payload.modalityId === null || payload.modalityId === ""
        ? Number(existingAppointment.modality_id)
        : normalizePositiveInteger(payload.modalityId, "modalityId");

    const examTypeId =
      payload.examTypeId === undefined || payload.examTypeId === null || payload.examTypeId === ""
        ? existingAppointment.exam_type_id
        : normalizePositiveInteger(payload.examTypeId, "examTypeId", { required: false });

    const reportingPriorityId =
      payload.reportingPriorityId === undefined || payload.reportingPriorityId === null || payload.reportingPriorityId === ""
        ? existingAppointment.reporting_priority_id
        : normalizePositiveInteger(payload.reportingPriorityId, "reportingPriorityId", { required: false });

    const appointmentDate =
      payload.appointmentDate === undefined || payload.appointmentDate === null || payload.appointmentDate === ""
        ? normalizeIsoDate(existingAppointment.appointment_date)
        : normalizeAppointmentDate(payload.appointmentDate);

    const notes =
      payload.notes === undefined || payload.notes === null || payload.notes === ""
        ? normalizeOptionalText(existingAppointment.notes)
        : normalizeOptionalText(payload.notes);

    const overbookingReason =
      payload.overbookingReason === undefined || payload.overbookingReason === null || payload.overbookingReason === ""
        ? normalizeOptionalText(existingAppointment.overbooking_reason)
        : normalizeOptionalText(payload.overbookingReason);

    const existingAppointmentDate = normalizeIsoDate(existingAppointment.appointment_date);
    if (existingAppointmentDate !== appointmentDate) {
      await requireAppointmentDayEnabled(client, appointmentDate);
    }

    await client.query("select pg_advisory_xact_lock(hashtext($1))", [`appointment-sequence:${appointmentDate}`]);
    await client.query("select pg_advisory_xact_lock(hashtext($1))", [`appointment-slot:${modalityId}:${appointmentDate}`]);

    const modality = await getModalityById(client, /** @type {number | string} */ (modalityId));
    const examType = examTypeId ? await getExamTypeById(client, /** @type {number | string} */ (examTypeId), /** @type {number | string} */ (modalityId)) : null;
    const priority = reportingPriorityId ? await getPriorityById(client, reportingPriorityId) : null;
    const slotStats = await nextModalitySlotNumber(client, /** @type {number | string} */ (modalityId), appointmentDate, cleanAppointmentId);
    const maxCasesPerModality = await getMaxCasesPerModality(client);
    const capacity = resolveEffectiveCapacity(modality.daily_capacity, maxCasesPerModality);

    const existingModalityId = Number(existingAppointment.modality_id);
    const modalityOrDateChanged = existingModalityId !== modalityId || existingAppointmentDate !== appointmentDate;

    // Only check overbooking when date or modality changes (treat as new appointment)
    // Editing fields on the same date/modality does not require supervisor approval
    const isOverbooked = modalityOrDateChanged && capacity !== null && slotStats.bookedCount >= capacity;

    // Handle overbooking approval
    let approvingSupervisor = null;
    if (isOverbooked) {
      if (!supervisorUsername) {
        throw new HttpError(403, "Supervisor username is required before overbooking.");
      }
      if (!supervisorPassword) {
        throw new HttpError(403, "Supervisor password is required before overbooking.");
      }

      try {
        approvingSupervisor = await authenticateUser(supervisorUsername, supervisorPassword);
        if (!approvingSupervisor.is_active) {
          throw new HttpError(403, "Supervisor account is not active.");
        }
        if (approvingSupervisor.role !== "supervisor") {
          throw new HttpError(403, "Only an active supervisor can approve overbooking.");
        }
      } catch (error) {
        if (error instanceof HttpError) {
          throw error;
        }
        throw new HttpError(403, "Invalid supervisor credentials. Overbooking cancelled.");
      }

      if (!overbookingReason) {
        throw new HttpError(400, "overbookingReason is required when capacity is full.");
      }
    }

    const sequence =
      existingAppointmentDate === appointmentDate
        ? existingAppointment.daily_sequence
        : await nextDailySequence(client, appointmentDate, cleanAppointmentId);

    const modalitySlotNumber = modalityOrDateChanged
      ? slotStats.slotNumber
      : Number(existingAppointment.modality_slot_number);

    const accessionNumber = buildAccessionNumber(appointmentDate, sequence);

    const approvedByUserId = isOverbooked && approvingSupervisor?.id != null
      ? Number(approvingSupervisor.id)
      : null;

    const updatedByUserId = currentUser?.sub != null
      ? Number(currentUser.sub)
      : (currentUser?.sub != null ? Number(currentUser.sub) : null);

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
          -- Explicit ::bigint casts prevent PostgreSQL type mismatch in CASE/update expressions
          approved_by_user_id = case when $9 then $12::bigint else null end,
          notes = nullif($13, ''),
          updated_by_user_id = $14::bigint,
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
        modalitySlotNumber,
        isOverbooked,
        overbookingReason,
        isOverbooked && approvingSupervisor ? approvingSupervisor.full_name : null,
        approvedByUserId,
        notes,
        updatedByUserId
      ]
    );
    const updatedAppointment = requireRow(
      /** @type {AppointmentDbRow | undefined} */ (rows[0]),
      "Failed to update appointment."
    );

    await client.query(
      `
        insert into appointment_status_history (appointment_id, old_status, new_status, changed_by_user_id, reason)
        values ($1, $2, $2, $3, $4)
      `,
      [cleanAppointmentId, existingStatus, currentUser.sub, "Appointment edited or rescheduled"]
    );

    await logAuditEntry(
      {
        entityType: "appointment",
        entityId: cleanAppointmentId,
        actionType: "update",
        oldValues: existingAppointment,
        newValues: updatedAppointment,
        changedByUserId: currentUser.sub
      },
      client
    );

    await client.query("commit");
    if (cleanAppointmentId) scheduleWorklistSync(cleanAppointmentId);
    return updatedAppointment;
  } catch (error) {
    console.error("[updateAppointment] ERROR:", /** @type {Error} */ (error).message, /** @type {Error} */ (error).stack);
    await client.query("rollback");
    throw error;
  } finally {
    client.release();
  }
}

/**
 * @param {number | string} appointmentId
 * @param {UnknownRecord} payload
 * @param {AuthenticatedUserContext} currentUser
 * @returns {Promise<UnknownRecord>}
 */
export async function updateAppointmentProtocol(appointmentId, payload, currentUser) {
  if (!currentUser?.sub) {
    throw new HttpError(401, "Authentication required.");
  }

  const cleanAppointmentId = normalizePositiveInteger(appointmentId, "appointmentId");
  if (!cleanAppointmentId) {
    throw new HttpError(400, "appointmentId is required.");
  }
  const examTypeId = normalizePositiveInteger(payload.examTypeId, "examTypeId", { required: false });
  const client = await pool.connect();

  try {
    await client.query("begin");
    const existingAppointment = await getAppointmentById(client, cleanAppointmentId);
    const existingStatus = existingAppointment.status;

    if (!APPOINTMENT_RECEPTION_ACTIVE_STATUSES.includes(existingStatus)) {
      throw new HttpError(409, "Only active reception appointments can be updated.");
    }

    const examType = examTypeId ? await getExamTypeById(client, examTypeId, existingAppointment.modality_id) : null;

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
    const protocolUpdatedAppointment = requireRow(
      /** @type {AppointmentDbRow | undefined} */ (rows[0]),
      "Failed to update appointment protocol."
    );

    await client.query(
      `
        insert into appointment_status_history (appointment_id, old_status, new_status, changed_by_user_id, reason)
        values ($1, $2, $2, $3, $4)
      `,
      [cleanAppointmentId, existingStatus, currentUser.sub, "Protocol updated"]
    );

    await logAuditEntry(
      {
        entityType: "appointment",
        entityId: cleanAppointmentId,
        actionType: "update",
        oldValues: existingAppointment,
        newValues: protocolUpdatedAppointment,
        changedByUserId: currentUser.sub
      },
      client
    );

    await client.query("commit");
    if (cleanAppointmentId) scheduleWorklistSync(cleanAppointmentId);
    return protocolUpdatedAppointment;
  } catch (error) {
    await client.query("rollback");
    throw error;
  } finally {
    client.release();
  }
}

/** @returns {Promise<{ ok: true }>} */

/**
 * @param {unknown} appointmentId
 * @param {unknown} reason
 * @param {unknown} currentUserId
 */
/**
 * @param {number | string} appointmentId
 * @param {string} reason
 * @param {UserId} currentUserId
 * @returns {Promise<{ ok: boolean }>}
 */
export async function cancelAppointment(appointmentId, reason, currentUserId) {
  const cleanAppointmentId = normalizePositiveInteger(appointmentId, "appointmentId");
  if (!cleanAppointmentId) {
    throw new HttpError(400, "appointmentId is required.");
  }
  const cleanReason = normalizeOptionalText(reason);

  if (!cleanReason) {
    throw new HttpError(400, "cancelReason is required.");
  }

  const client = await pool.connect();

  try {
    await client.query("begin");
    const appointment = await getAppointmentById(client, cleanAppointmentId);
    const appointmentStatus = appointment.status;

    if (APPOINTMENT_NON_CANCELLABLE_STATUSES.includes(appointmentStatus)) {
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
      [cleanAppointmentId, appointmentStatus, currentUserId, cleanReason]
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
    if (cleanAppointmentId) scheduleWorklistSync(cleanAppointmentId);
    return { ok: true };
  } catch (error) {
    await client.query("rollback");
    throw error;
  } finally {
    client.release();
  }
}
