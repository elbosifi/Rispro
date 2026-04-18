/*
 * LEGACY APPOINTMENTS / SCHEDULING MODULE
 * This file belongs to the legacy scheduling system.
 * Do not add new scheduling features here.
 * New scheduling and booking work must go into Appointments V2.
 * Legacy code may only receive:
 * - critical bug containment
 * - temporary compatibility fixes explicitly requested
 * - reference-only maintenance
 */

import type { PoolClient, QueryResult, QueryResultRow } from "pg";
import type { DbExecutor } from "../types/db.js";
import { pool } from "../db/pool.js";
import { HttpError } from "../utils/http-error.js";
import { requireRow } from "../utils/records.js";
import { normalizePositiveInteger, normalizeOptionalText } from "../utils/normalize.js";
import { getTripoliToday, TRIPOLI_TIME_ZONE, validateIsoDate } from "../utils/date.js";
import { logAuditEntry } from "./audit-service.js";
import { scheduleWorklistSync } from "./dicom-service.js";
import { authenticateUser } from "./auth-service.js";
import { evaluateSchedulingCandidateWithDb } from "../domain/scheduling/service.js";
import type { UnknownRecord, UserId, AuthenticatedUserContext } from "../types/http.js";
import type { DbNumeric, NullableDbNumeric } from "../types/db.js";
import type { CategorySettings } from "../types/settings.js";
import type { AppointmentStatus } from "../types/domain.js";
import type { CaseCategory, SchedulingResult } from "../domain/scheduling/types.js";
import {
  APPOINTMENT_NON_CANCELLABLE_STATUSES,
  APPOINTMENT_RECEPTION_ACTIVE_STATUSES,
  isListableAppointmentStatus
} from "../constants/appointment-statuses.js";

// ---------------------------------------------------------------------------
// Type aliases from JSDoc typedefs
// ---------------------------------------------------------------------------

export interface PrintAppointmentRow {
  id: number;
  accession_number: string;
  appointment_date: string;
  arabic_full_name: string;
  english_full_name: string | null;
  modality_name_en: string;
  modality_name_ar: string;
  exam_name_en: string | null;
  exam_name_ar: string | null;
  status: string;
  is_walk_in: boolean;
  notes: string | null;
}

export interface AvailabilitySlot {
  appointment_date: string;
  booked_count: number;
  remaining_capacity: number;
  daily_capacity: number | null;
  is_full: boolean;
  is_bookable?: boolean;
  isAllowed?: boolean;
  requiresSupervisorOverride?: boolean;
  blockReasons?: string[];
  matchedRuleIds?: number[];
  remainingCategoryCapacity?: {
    oncology: number | null;
    nonOncology: number | null;
  };
  remainingSpecialQuota?: number | null;
  suggestedBookingMode?: "standard" | "special" | "override" | null;
  displayStatus?: "available" | "restricted" | "blocked";
}

export interface AppointmentFilters {
  dateFrom?: string;
  dateTo?: string;
  date?: string;
  modalityId?: string;
  query?: string;
  status?: string[];
}

export interface AppointmentStatisticsFilters {
  dateFrom?: string;
  dateTo?: string;
  date?: string;
  modalityId?: string;
}

export interface AppointmentUpdateOptions {
  supervisorUsername?: string;
  supervisorPassword?: string;
}

interface OverridePayload {
  supervisorUsername?: unknown;
  supervisorPassword?: unknown;
  reason?: unknown;
}

interface SchedulingSettingRow {
  setting_key: string;
  setting_value?: { value?: unknown } | null;
}

interface AppointmentStatusRow {
  id: number;
  status: AppointmentStatus;
}

interface SequenceRow {
  last_daily_sequence: NullableDbNumeric;
}

interface ModalitySlotAggregateRow {
  booked_count: NullableDbNumeric;
  last_slot_number: NullableDbNumeric;
}

interface BookingStatsRow {
  booked_count: NullableDbNumeric;
  last_slot_number: NullableDbNumeric;
  last_daily_sequence: NullableDbNumeric;
}

export interface AppointmentDbRow {
  id: number;
  patient_id: number;
  modality_id: number;
  exam_type_id: number | null;
  reporting_priority_id: number | null;
  accession_number: string;
  appointment_date: string;
  daily_sequence: number;
  modality_slot_number: number | null;
  status: AppointmentStatus;
  notes: string | null;
  overbooking_reason: string | null;
  case_category?: CaseCategory;
  uses_special_quota?: boolean;
  special_reason_code?: string | null;
  special_reason_note?: string | null;
  is_walk_in?: boolean;
  is_overbooked?: boolean;
  cancel_reason?: string | null;
  created_at?: string;
  [key: string]: unknown;
}

interface PatientLookupRow {
  id: number;
  mrn: string | null;
  national_id: string | null;
  arabic_full_name: string;
  english_full_name: string | null;
  age_years: number;
  demographics_estimated: boolean;
  estimated_date_of_birth: string | null;
  sex: string | null;
  phone_1: string | null;
  phone_2: string | null;
  address: string | null;
}

export interface ModalityRow {
  id: number;
  code: string;
  name_ar: string;
  name_en: string;
  daily_capacity: number | null;
  general_instruction_ar: string | null;
  general_instruction_en: string | null;
  is_active: boolean;
  safety_warning_ar: string | null;
  safety_warning_en: string | null;
  safety_warning_enabled: boolean;
}

export interface ExamTypeRow {
  id: number;
  modality_id: number;
  name_ar: string;
  name_en: string;
  specific_instruction_ar: string | null;
  specific_instruction_en: string | null;
  is_active: boolean;
}

interface ReportingPriorityRow {
  id: number;
  code: string;
  name_ar: string;
  name_en: string;
}

interface SpecialReasonCodeRow {
  code: string;
  label_ar: string;
  label_en: string;
  is_active: boolean;
}

export interface AppointmentCreateResult {
  appointment: AppointmentDbRow;
  patient: PatientLookupRow;
  modality: ModalityRow;
  examType: ExamTypeRow | null;
  priority: ReportingPriorityRow | null;
  barcodeValue: string;
}

interface AppointmentStatsSummaryRow {
  total_appointments: DbNumeric;
  unique_patients: DbNumeric;
  unique_modalities: DbNumeric;
  scheduled_count: DbNumeric;
  in_queue_count: DbNumeric;
  completed_count: DbNumeric;
  no_show_count: DbNumeric;
  cancelled_count: DbNumeric;
  walk_in_count: DbNumeric;
}

export interface AppointmentListRow {
  id: number;
  accession_number: string;
  appointment_date: string;
  created_at: string;
  modality_slot_number: number | null;
  status: AppointmentStatus;
  notes: string | null;
  is_walk_in: boolean;
  is_overbooked: boolean;
  overbooking_reason: string | null;
  patient_id: number;
  mrn: string | null;
  national_id: string | null;
  arabic_full_name: string;
  english_full_name: string | null;
  age_years: number;
  demographics_estimated: boolean;
  sex: string | null;
  phone_1: string | null;
  address: string | null;
  modality_id: number;
  modality_code: string;
  modality_name_ar: string;
  modality_name_en: string;
  general_instruction_ar: string | null;
  general_instruction_en: string | null;
  exam_type_id: number | null;
  exam_name_ar: string | null;
  exam_name_en: string | null;
  specific_instruction_ar: string | null;
  specific_instruction_en: string | null;
  priority_name_ar: string | null;
  priority_name_en: string | null;
}

interface ModalityBreakdownRow {
  modality_id: number;
  modality_code: string;
  modality_name_ar: string;
  modality_name_en: string;
  total_count: DbNumeric;
  scheduled_count: DbNumeric;
  in_queue_count: DbNumeric;
  completed_count: DbNumeric;
  no_show_count: DbNumeric;
  cancelled_count: DbNumeric;
}

interface StatusBreakdownRow {
  status: AppointmentStatus;
  total_count: DbNumeric;
}

interface DailyBreakdownRow {
  appointment_date: string;
  total_count: DbNumeric;
  completed_count: DbNumeric;
  cancelled_count: DbNumeric;
  no_show_count: DbNumeric;
}

// Authenticated user with optional id for appointment actor context
type AppointmentActor = AuthenticatedUserContext & { id?: UserId };

// ---------------------------------------------------------------------------
// Helper functions
// ---------------------------------------------------------------------------

function normalizeAppointmentDate(value: unknown, fieldName = "appointmentDate"): string {
  return validateIsoDate(value, fieldName);
}

function buildAccessionNumber(appointmentDate: string, dailySequence: number): string {
  const compactDate = appointmentDate.replaceAll("-", "");
  return `${compactDate}-${String(dailySequence).padStart(3, "0")}`;
}

function normalizeCapacityLimit(value: unknown): number | null {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    return null;
  }
  return parsed;
}

function normalizeDailyCapacity(value: unknown): number {
  if (value === undefined || value === null || value === "") {
    return 0;
  }

  const parsed = Number(value);

  if (!Number.isInteger(parsed) || parsed < 0) {
    throw new HttpError(400, "dailyCapacity must be 0 or a positive whole number.");
  }

  return parsed;
}

function normalizeSettingToggle(value: unknown, defaultValue = true): boolean {
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

function normalizeIsoDate(value: unknown): string {
  if (value instanceof Date) {
    return value.toISOString().slice(0, 10);
  }

  return String(value || "").slice(0, 10);
}

function normalizeCaseCategory(value: unknown): CaseCategory {
  const normalized = String(value || "non_oncology").trim().toLowerCase();
  if (normalized === "oncology") return "oncology";
  return "non_oncology";
}

function normalizeOverridePayload(payload: UnknownRecord, options: AppointmentUpdateOptions): {
  username: string;
  password: string;
  reason: string;
} {
  const nested = (payload.override as OverridePayload | undefined) || {};
  const username = String(nested.supervisorUsername ?? options.supervisorUsername ?? payload.supervisorUsername ?? "").trim();
  const password = String(nested.supervisorPassword ?? options.supervisorPassword ?? payload.supervisorPassword ?? "").trim();
  const reason = String(nested.reason ?? payload.overrideReason ?? payload.overbookingReason ?? "").trim();
  return { username, password, reason };
}

async function getSchedulingEngineFlags(client: DbExecutor = pool): Promise<{
  enabled: boolean;
  shadowMode: boolean;
}> {
  const { rows } = await client.query<SchedulingSettingRow>(
    `
      select setting_key, setting_value
      from system_settings
      where category = 'scheduling_and_capacity'
        and setting_key in ('scheduling_engine_enabled', 'scheduling_engine_shadow_mode')
    `
  );
  const map = rows.reduce<Record<string, string>>((acc, row) => {
    acc[row.setting_key] = String(row.setting_value?.value ?? "");
    return acc;
  }, {});
  return {
    enabled: normalizeSettingToggle(map.scheduling_engine_enabled, false),
    shadowMode: normalizeSettingToggle(map.scheduling_engine_shadow_mode, true)
  };
}

async function persistQuotaConsumption(
  client: PoolClient,
  appointment: AppointmentDbRow,
  consumptionMode: SchedulingResult["consumedCapacityMode"],
  currentUserId: UserId
): Promise<void> {
  if (!consumptionMode || consumptionMode === "standard") return;
  await client.query(
    `
      insert into appointment_quota_consumptions (
        appointment_id,
        appointment_date,
        modality_id,
        exam_type_id,
        case_category,
        consumption_mode,
        consumed_slots,
        created_by_user_id,
        updated_by_user_id
      )
      values ($1, $2::date, $3, $4, $5, $6, 1, $7, $7)
      on conflict (appointment_id, consumption_mode)
      do update set
        appointment_date = excluded.appointment_date,
        modality_id = excluded.modality_id,
        exam_type_id = excluded.exam_type_id,
        case_category = excluded.case_category,
        released_at = null,
        updated_by_user_id = excluded.updated_by_user_id,
        updated_at = now()
    `,
    [
      appointment.id,
      appointment.appointment_date,
      appointment.modality_id,
      appointment.exam_type_id,
      appointment.case_category || "non_oncology",
      consumptionMode,
      currentUserId
    ]
  );
}

async function releaseQuotaConsumptions(client: PoolClient, appointmentId: number): Promise<void> {
  await client.query(
    `
      update appointment_quota_consumptions
      set released_at = coalesce(released_at, now()), updated_at = now()
      where appointment_id = $1 and released_at is null
    `,
    [appointmentId]
  );
}

async function logOverrideEvent(
  client: DbExecutor,
  {
    appointmentId = null,
    patientId = null,
    modalityId = null,
    examTypeId = null,
    appointmentDate = null,
    requestingUserId = null,
    supervisorUserId = null,
    overrideReason = "",
    evaluationSnapshot = {},
    outcome
  }: {
    appointmentId?: number | null;
    patientId?: number | null;
    modalityId?: number | null;
    examTypeId?: number | null;
    appointmentDate?: string | null;
    requestingUserId?: number | null;
    supervisorUserId?: number | null;
    overrideReason?: string;
    evaluationSnapshot?: unknown;
    outcome: "approved_and_booked" | "approved_but_failed" | "denied" | "cancelled";
  }
): Promise<void> {
  await client.query(
    `
      insert into scheduling_override_audit_events (
        appointment_id,
        patient_id,
        modality_id,
        exam_type_id,
        appointment_date,
        requesting_user_id,
        supervisor_user_id,
        override_reason,
        evaluation_snapshot,
        outcome
      )
      values ($1, $2, $3, $4, $5::date, $6, $7, nullif($8, ''), $9::jsonb, $10)
    `,
    [
      appointmentId,
      patientId,
      modalityId,
      examTypeId,
      appointmentDate,
      requestingUserId,
      supervisorUserId,
      overrideReason,
      JSON.stringify(evaluationSnapshot || {}),
      outcome
    ]
  );
}

function getTripoliWeekday(isoDate: string): string {
  const date = new Date(`${isoDate}T00:00:00Z`);
  const weekday = new Intl.DateTimeFormat("en-US", {
    timeZone: TRIPOLI_TIME_ZONE,
    weekday: "long"
  }).format(date);
  return weekday.toLowerCase();
}

// ---------------------------------------------------------------------------
// Exported functions
// ---------------------------------------------------------------------------

export async function getAppointmentDaySettings(
  client: DbExecutor = pool
): Promise<{ fridayEnabled: boolean; saturdayEnabled: boolean; sundayEnabled: boolean }> {
  const { rows } = await client.query<{
    setting_key: string;
    setting_value: { value?: unknown } | null;
  }>(`
    select setting_key, setting_value
    from system_settings
    where category = 'scheduling_and_capacity'
      and setting_key in ('allow_friday_appointments', 'allow_saturday_appointments', 'allow_sunday_appointments')
  `);

  const settingsRows = rows as unknown as SchedulingSettingRow[];
  const values = settingsRows.reduce<Record<string, string>>((accumulator, row) => {
    accumulator[row.setting_key] = String(row.setting_value?.value ?? "");
    return accumulator;
  }, {});

  return {
    fridayEnabled: normalizeSettingToggle(values.allow_friday_appointments, true),
    saturdayEnabled: normalizeSettingToggle(values.allow_saturday_appointments, true),
    sundayEnabled: normalizeSettingToggle(values.allow_sunday_appointments, true)
  };
}

async function requireAppointmentDayEnabled(
  client: DbExecutor,
  appointmentDate: string
): Promise<void> {
  const settings = await getAppointmentDaySettings(client);
  const weekday = getTripoliWeekday(appointmentDate);

  if (weekday === "friday" && !settings.fridayEnabled) {
    throw new HttpError(409, "Appointments are disabled on Friday in settings.");
  }

  if (weekday === "saturday" && !settings.saturdayEnabled) {
    throw new HttpError(409, "Appointments are disabled on Saturday in settings.");
  }

  if (weekday === "sunday" && !settings.sundayEnabled) {
    throw new HttpError(409, "Appointments are disabled on Sunday in settings.");
  }
}

async function getMaxCasesPerModality(client: DbExecutor): Promise<number | null> {
  const { rows } = await client.query(`
    select setting_value
    from system_settings
    where category = 'scheduling_and_capacity'
      and setting_key = 'max_cases_per_modality'
    limit 1
  `);

  const settingRow = rows[0] as { setting_value?: { value?: unknown } } | undefined;
  const raw = settingRow?.setting_value?.value;
  return normalizeCapacityLimit(raw);
}

function resolveEffectiveCapacity(
  modalityCapacity: number | null,
  maxCasesPerModality: number | null
): number | null {
  const modalityValue = normalizeCapacityLimit(modalityCapacity);
  const globalValue = normalizeCapacityLimit(maxCasesPerModality);

  if (modalityValue && globalValue) {
    return Math.min(modalityValue, globalValue);
  }

  return modalityValue || globalValue || 1;
}

async function getAppointmentById(
  client: DbExecutor,
  appointmentId: number | string
): Promise<AppointmentDbRow> {
  const cleanAppointmentId = normalizePositiveInteger(
    appointmentId,
    "appointmentId"
  ) as number;
  const { rows } = await client.query(
    `
      select *
      from appointments
      where id = $1
      limit 1
    `,
    [cleanAppointmentId]
  );

  const appointment = rows[0] as AppointmentDbRow | undefined;

  if (!appointment) {
    throw new HttpError(404, "Appointment not found.");
  }

  return appointment;
}

async function nextDailySequence(
  client: DbExecutor,
  appointmentDate: string,
  excludeAppointmentId: number | null = null
): Promise<number> {
  const params: unknown[] = [appointmentDate];
  let excludeSql = "";

  if (excludeAppointmentId) {
    params.push(String(excludeAppointmentId));
    excludeSql = `and id <> $${params.length}`;
  }

  const { rows } = await client.query(`
    select coalesce(max(daily_sequence), 0) as last_daily_sequence
    from appointments
    where appointment_date = $1::date
    ${excludeSql}
  `, params);

  const sequenceRow = rows[0] as unknown as SequenceRow | undefined;
  return Number(sequenceRow?.last_daily_sequence || 0) + 1;
}

async function nextModalitySlotNumber(
  client: DbExecutor,
  modalityId: number | string,
  appointmentDate: string,
  excludeAppointmentId: number | null = null
): Promise<{ bookedCount: number; slotNumber: number }> {
  const params: unknown[] = [modalityId, appointmentDate];
  let excludeSql = "";

  if (excludeAppointmentId) {
    params.push(excludeAppointmentId);
    excludeSql = `and id <> $${params.length}`;
  }

  const { rows } = await client.query(`
    select
      count(*) filter (where status <> 'cancelled') as booked_count,
      coalesce(max(modality_slot_number), 0) as last_slot_number
    from appointments
    where modality_id = $1
      and appointment_date = $2::date
    ${excludeSql}
  `, params);

  const aggregateRow = rows[0] as unknown as ModalitySlotAggregateRow | undefined;
  return {
    bookedCount: Number(aggregateRow?.booked_count || 0),
    slotNumber: Number(aggregateRow?.last_slot_number || 0) + 1
  };
}

function normalizeDateOrToday(value: unknown): string {
  if (!value) {
    return getTripoliToday();
  }

  return normalizeAppointmentDate(value);
}

function pgErrorCode(error: unknown): string {
  if (typeof error !== "object" || error === null || !("code" in error)) {
    return "";
  }
  return String((error as { code?: unknown }).code || "");
}

export function toSchedulingConflictError(error: unknown): HttpError | null {
  const code = pgErrorCode(error);
  if (code === "40001") {
    return new HttpError(409, "Scheduling conflict detected. Please retry booking.");
  }
  if (code === "55P03") {
    return new HttpError(409, "Scheduling lock conflict. Please retry booking.");
  }
  if (code === "23505") {
    return new HttpError(409, "A concurrent booking changed availability. Please retry.");
  }
  return null;
}

type OverrideFailureReason =
  | "missing_username"
  | "missing_password"
  | "invalid_credentials"
  | "missing_reason";

export function overrideOutcomeForFailure(reason: OverrideFailureReason): "denied" | "cancelled" {
  if (reason === "invalid_credentials") {
    return "denied";
  }
  return "cancelled";
}

async function getPatientById(
  client: DbExecutor,
  patientId: number | string
): Promise<PatientLookupRow> {
  const cleanPatientId = normalizePositiveInteger(patientId, "patientId") as number;
  const { rows } = await client.query(
    `
      select id, mrn, national_id, arabic_full_name, english_full_name, age_years, demographics_estimated, estimated_date_of_birth, sex, phone_1, phone_2, address
      from patients
      where id = $1
      limit 1
    `,
    [cleanPatientId]
  );

  const patient = rows[0] as unknown as PatientLookupRow | undefined;

  if (!patient) {
    throw new HttpError(404, "Patient not found.");
  }

  return patient;
}

async function getModalityById(
  client: DbExecutor,
  modalityId: number | string
): Promise<ModalityRow> {
  const { rows } = await client.query(
    `
      select id, code, name_ar, name_en, daily_capacity, general_instruction_ar, general_instruction_en, is_active, safety_warning_ar, safety_warning_en, safety_warning_enabled
      from modalities
      where id = $1
      limit 1
    `,
    [modalityId]
  );

  const modality = rows[0] as unknown as ModalityRow | undefined;

  if (!modality || !modality.is_active) {
    throw new HttpError(404, "Modality not found.");
  }

  return modality;
}

async function getExamTypeById(
  client: DbExecutor,
  examTypeId: number | string,
  modalityId?: number | string
): Promise<ExamTypeRow | null> {
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

  const examType = rows[0] as unknown as ExamTypeRow | undefined;

  if (!examType || !examType.is_active) {
    throw new HttpError(404, "Exam type not found.");
  }

  if (Number(examType.modality_id) !== Number(modalityId)) {
    throw new HttpError(400, "The selected exam type does not belong to the selected modality.");
  }

  return examType;
}

async function getPriorityById(
  client: DbExecutor,
  reportingPriorityId: number | string
): Promise<ReportingPriorityRow | null> {
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

  const priority = rows[0] as unknown as ReportingPriorityRow | undefined;

  if (!priority) {
    throw new HttpError(404, "Reporting priority not found.");
  }

  return priority;
}

export async function listAppointmentLookups(): Promise<{
  modalities: ModalityRow[];
  examTypes: ExamTypeRow[];
  priorities: ReportingPriorityRow[];
  specialReasons: SpecialReasonCodeRow[];
}> {
  const [modalitiesResult, examTypesResult, prioritiesResult, specialReasonsResult] = await Promise.all([
    pool.query(`
      select id, code, name_ar, name_en, daily_capacity, general_instruction_ar, general_instruction_en, safety_warning_ar, safety_warning_en, safety_warning_enabled
      from modalities
      where is_active = true
      order by name_en asc
    `),
    pool.query(`
      select id, modality_id, name_ar, name_en, specific_instruction_ar, specific_instruction_en
      from exam_types
      where is_active = true
      order by name_en asc
    `),
    pool.query(`
      select id, code, name_ar, name_en, sort_order
      from reporting_priorities
      order by sort_order asc, name_en asc
    `),
    pool.query(`
      select code, label_ar, label_en, is_active
      from special_reason_codes
      where is_active = true
      order by code asc
    `)
  ]);

  return {
    modalities: modalitiesResult.rows as unknown as ModalityRow[],
    examTypes: examTypesResult.rows as unknown as ExamTypeRow[],
    priorities: prioritiesResult.rows as unknown as ReportingPriorityRow[],
    specialReasons: specialReasonsResult.rows as unknown as SpecialReasonCodeRow[]
  };
}

export async function listExamTypesForSettings(): Promise<{
  modalities: ModalityRow[];
  examTypes: ExamTypeRow[];
}> {
  const [modalitiesResult, examTypesResult] = await Promise.all([
    pool.query(`
      select id, code, name_ar, name_en, daily_capacity, general_instruction_ar, general_instruction_en
      from modalities
      where is_active = true
      order by name_en asc
    `),
    pool.query(`
      select id, modality_id, name_ar, name_en, specific_instruction_ar, specific_instruction_en, is_active
      from exam_types
      where is_active = true
      order by name_en asc, name_ar asc
    `)
  ]);

  return {
    modalities: modalitiesResult.rows as unknown as ModalityRow[],
    examTypes: examTypesResult.rows as unknown as ExamTypeRow[]
  };
}

export async function listAppointmentsForPrint(
  filters: AppointmentFilters = {}
): Promise<AppointmentListRow[]> {
  const dateFrom = filters.dateFrom ? normalizeAppointmentDate(filters.dateFrom, "dateFrom") : null;
  const dateTo = filters.dateTo ? normalizeAppointmentDate(filters.dateTo, "dateTo") : null;
  const appointmentDate = !dateFrom && !dateTo ? normalizeDateOrToday(filters.date) : null;
  const query = String(filters.query || "").trim();
  const params: unknown[] = [];
  let dateClause = "";
  let modalityFilterSql = "";
  let queryFilterSql = "";
  let statusFilterSql = "";

  if (dateFrom || dateTo) {
    const start = (dateFrom || dateTo) as string;
    const end = (dateTo || dateFrom) as string;

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

  if (filters.status && Array.isArray(filters.status) && filters.status.length > 0) {
    const validStatuses = filters.status.filter((s) => isListableAppointmentStatus(s));
    if (validStatuses.length > 0) {
      params.push(validStatuses);
      statusFilterSql = ` and appointments.status = ANY($${params.length})`;
    }
  }

  const orderClause =
    dateFrom || dateTo
      ? "appointments.appointment_date asc, appointments.daily_sequence asc"
      : "appointments.daily_sequence asc";

  const { rows } = await pool.query(`
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
      patients.demographics_estimated,
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
  `, params);

  return rows as unknown as AppointmentListRow[];
}

export async function listAppointmentStatistics(
  filters: AppointmentStatisticsFilters = {}
): Promise<{
  filters: {
    date: string | null;
    dateFrom: string;
    dateTo: string;
    modalityId: string;
  };
  summary: Record<string, number>;
  modalityBreakdown: Array<{
    modality_id: number;
    modality_code: string;
    modality_name_ar: string;
    modality_name_en: string;
    total_count: number;
    scheduled_count: number;
    in_queue_count: number;
    completed_count: number;
    no_show_count: number;
    cancelled_count: number;
  }>;
  statusBreakdown: Array<{ status: AppointmentStatus; total_count: number }>;
  dailyBreakdown: Array<{
    appointment_date: string;
    total_count: number;
    completed_count: number;
    cancelled_count: number;
    no_show_count: number;
  }>;
}> {
  const dateFrom = filters.dateFrom ? normalizeAppointmentDate(filters.dateFrom, "dateFrom") : null;
  const dateTo = filters.dateTo ? normalizeAppointmentDate(filters.dateTo, "dateTo") : null;
  const appointmentDate = !dateFrom && !dateTo ? normalizeDateOrToday(filters.date) : null;
  const modalityId = filters.modalityId ? normalizePositiveInteger(filters.modalityId, "modalityId") : null;
  const params: unknown[] = [];
  const clauses: string[] = [];

  if (dateFrom || dateTo) {
    const start = (dateFrom || dateTo) as string;
    const end = (dateTo || dateFrom) as string;

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
    pool.query(`
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
    `, params),
    pool.query(`
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
    `, params),
    pool.query(`
      select
        status,
        count(*) as total_count
      from appointments
      where ${whereClause}
      group by status
      order by total_count desc, status asc
    `, params),
    pool.query(`
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
    `, params)
  ]);

  const summary = (summaryResult.rows[0] as AppointmentStatsSummaryRow | undefined) || {
    total_appointments: 0,
    unique_patients: 0,
    unique_modalities: 0,
    scheduled_count: 0,
    in_queue_count: 0,
    completed_count: 0,
    no_show_count: 0,
    cancelled_count: 0,
    walk_in_count: 0
  };

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
    modalityBreakdown: (modalityResult.rows as unknown as ModalityBreakdownRow[]).map((row) => ({
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
    statusBreakdown: (statusResult.rows as unknown as StatusBreakdownRow[]).map((row) => ({
      status: row.status,
      total_count: Number(row.total_count || 0)
    })),
    dailyBreakdown: (dailyResult.rows as unknown as DailyBreakdownRow[]).map((row) => ({
      appointment_date: row.appointment_date,
      total_count: Number(row.total_count || 0),
      completed_count: Number(row.completed_count || 0),
      cancelled_count: Number(row.cancelled_count || 0),
      no_show_count: Number(row.no_show_count || 0)
    }))
  };
}

export async function getAppointmentPrintDetails(
  appointmentId: number | string
): Promise<PrintAppointmentRow> {
  const cleanAppointmentId = normalizePositiveInteger(appointmentId, "appointmentId") as number;

  const { rows } = await pool.query(`
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
      patients.demographics_estimated,
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
  `, [cleanAppointmentId]);

  const appointment = rows[0] as AppointmentListRow | undefined;

  if (!appointment) {
    throw new HttpError(404, "Appointment not found.");
  }

  return appointment as unknown as PrintAppointmentRow;
}

export async function listAvailability(
  modalityId: number | string | undefined,
  days = 14,
  offset = 0,
  options: {
    examTypeId?: number | string | null;
    caseCategory?: unknown;
    useSpecialQuota?: boolean;
    specialReasonCode?: string | null;
    includeOverrideCandidates?: boolean;
    requestedByUserId?: number | null;
  } = {}
): Promise<AvailabilitySlot[]> {
  const cleanModalityId = normalizePositiveInteger(modalityId, "modalityId");
  if (!cleanModalityId) {
    throw new HttpError(400, "modalityId is required.");
  }
  const cleanExamTypeId = normalizePositiveInteger(options.examTypeId, "examTypeId", { required: false });
  const windowDays = Math.min(Math.max(Number(days) || 14, 1), 365);
  const dayOffset = Math.max(Number(offset) || 0, 0);
  const caseCategory = normalizeCaseCategory(options.caseCategory);
  const includeOverrideCandidates = Boolean(options.includeOverrideCandidates);
  const requestedByUserId = Number(options.requestedByUserId || 0) || 0;

  // Fetch all required data in parallel
  const [modality, daySettings, maxCasesPerModality, flags] = await Promise.all([
    getModalityById(pool, cleanModalityId),
    getAppointmentDaySettings(pool),
    getMaxCasesPerModality(pool),
    getSchedulingEngineFlags(pool)
  ]);

  const { rows } = await pool.query(`
    with calendar as (
      select (current_date + offset_day)::date as appointment_date
      from generate_series($2::int, ($2::int + $3::int - 1)) as offset_day
    ),
    bookings as (
      select
        appointment_date,
        count(*) filter (where status <> 'cancelled') as booked_count,
        max(modality_slot_number) as last_slot_number
      from appointments
      where modality_id = $1
        and appointment_date between (current_date + $2::int) and (current_date + ($2::int + $3::int - 1))
      group by appointment_date
    )
    select
      calendar.appointment_date,
      coalesce(bookings.booked_count, 0) as booked_count,
      coalesce(bookings.last_slot_number, 0) as last_slot_number
    from calendar
    left join bookings on bookings.appointment_date = calendar.appointment_date
    order by calendar.appointment_date asc
  `, [cleanModalityId, dayOffset, windowDays]);

  const baseRows = rows
    .filter((row) => {
      const isoDate = normalizeIsoDate(row.appointment_date);
      const weekday = getTripoliWeekday(isoDate);

      if (weekday === "friday" && !daySettings.fridayEnabled) {
        return false;
      }

      if (weekday === "saturday" && !daySettings.saturdayEnabled) {
        return false;
      }

      if (weekday === "sunday" && !daySettings.sundayEnabled) {
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

  if (!flags.enabled) {
    return baseRows;
  }

  const enhancedRows = await Promise.all(
    baseRows.map(async (row) => {
      const evaluation = await evaluateSchedulingCandidateWithDb(
        {
          patientId: null,
          modalityId: cleanModalityId,
          examTypeId: cleanExamTypeId ? Number(cleanExamTypeId) : null,
          scheduledDate: normalizeIsoDate(row.appointment_date),
          caseCategory,
          requestedByUserId,
          useSpecialQuota: Boolean(options.useSpecialQuota),
          specialReasonCode: options.specialReasonCode || null,
          specialReasonNote: null,
          includeOverrideEvaluation: includeOverrideCandidates
        },
        pool
      );

      return {
        ...row,
        isAllowed: evaluation.isAllowed,
        requiresSupervisorOverride: evaluation.requiresSupervisorOverride,
        blockReasons: evaluation.blockReasons,
        matchedRuleIds: evaluation.matchedRuleIds,
        remainingCategoryCapacity: evaluation.remainingCategoryCapacity,
        remainingSpecialQuota: evaluation.remainingSpecialQuota,
        suggestedBookingMode: evaluation.suggestedBookingMode,
        displayStatus: evaluation.displayStatus,
        is_full: row.is_full,
        is_bookable: evaluation.isAllowed
      };
    })
  );

  return enhancedRows;
}

export async function listSuggestedAppointments(
  modalityId: number | string | undefined,
  days = 30,
  options: {
    examTypeId?: number | string | null;
    caseCategory?: unknown;
    useSpecialQuota?: boolean;
    specialReasonCode?: string | null;
    includeOverrideCandidates?: boolean;
    requestedByUserId?: number | null;
  } = {}
): Promise<AvailabilitySlot[]> {
  const availability = await listAvailability(modalityId, days, 0, options);
  return availability
    .filter((slot) => {
      // When scheduling engine is enabled, use its evaluation.
      if ("isAllowed" in slot) {
        if (options.includeOverrideCandidates) {
          return slot.isAllowed || slot.requiresSupervisorOverride;
        }
        return slot.isAllowed === true;
      }
      // Fallback: when engine is disabled, suggest based on capacity.
      return !slot.is_full;
    })
    .map((slot) => ({
      ...slot,
      is_bookable: "isAllowed" in slot ? slot.isAllowed : !slot.is_full
    }))
    .slice(0, 20);
}

export async function listModalitiesForSettings({
  includeInactive = false
}: { includeInactive?: boolean } = {}): Promise<{ modalities: ModalityRow[] }> {
  const whereClause = includeInactive ? "" : "where is_active = true";
  const { rows } = await pool.query(`
    select id, code, name_ar, name_en, daily_capacity, general_instruction_ar, general_instruction_en, is_active, safety_warning_ar, safety_warning_en, safety_warning_enabled
    from modalities
    ${whereClause}
    order by name_en asc
  `);

  return { modalities: rows as unknown as ModalityRow[] };
}

export async function createModality(
  payload: UnknownRecord,
  currentUserId: UserId | null = null
): Promise<ModalityRow> {
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
    const createdModality = requireRow<ModalityRow>(
      rows[0] as ModalityRow | undefined,
      "Failed to create modality."
    );

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
    const mapped = toSchedulingConflictError(error);
    throw mapped || error;
  } finally {
    client.release();
  }
}

export async function updateModality(
  modalityId: number | string,
  payload: UnknownRecord,
  currentUserId: UserId
): Promise<ModalityRow> {
  const cleanModalityId = normalizePositiveInteger(modalityId, "modalityId") as number;
  const code = String(payload.code || "").trim();
  const nameAr = String(payload.nameAr || "").trim();
  const nameEn = String(payload.nameEn || "").trim();
  const dailyCapacity = normalizeDailyCapacity(payload.dailyCapacity);
  const generalInstructionAr = String(payload.generalInstructionAr || "").trim();
  const generalInstructionEn = String(payload.generalInstructionEn || "").trim();
  const isActive = String(payload.isActive || "enabled") === "enabled";
  const safetyWarningAr = String(payload.safetyWarningAr || "").trim();
  const safetyWarningEn = String(payload.safetyWarningEn || "").trim();
  const safetyWarningEnabled =
    payload.safetyWarningEnabled !== undefined ? Boolean(payload.safetyWarningEnabled) : true;

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

    const existing = existingResult.rows[0] as ModalityRow | undefined;

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
    const updatedModality = requireRow<ModalityRow>(
      rows[0] as ModalityRow | undefined,
      "Failed to update modality."
    );

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
    const mapped = toSchedulingConflictError(error);
    throw mapped || error;
  } finally {
    client.release();
  }
}

export async function deleteModality(
  modalityId: number | string,
  currentUserId: UserId
): Promise<ModalityRow> {
  const cleanModalityId = normalizePositiveInteger(modalityId, "modalityId") as number;
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

    const existing = existingResult.rows[0] as ModalityRow | undefined;

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
    const deletedModality = requireRow<ModalityRow>(
      rows[0] as ModalityRow | undefined,
      "Failed to delete modality."
    );

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

export async function createExamType(
  payload: UnknownRecord,
  currentUserId: UserId | null = null
): Promise<ExamTypeRow> {
  const modalityId = normalizePositiveInteger(payload.modalityId, "modalityId") as number;
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
    const createdExamType = requireRow<ExamTypeRow>(
      rows[0] as ExamTypeRow | undefined,
      "Failed to create exam type."
    );

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

export async function updateExamType(
  examTypeId: number | string,
  payload: UnknownRecord,
  currentUserId: UserId
): Promise<ExamTypeRow> {
  const cleanExamTypeId = normalizePositiveInteger(examTypeId, "examTypeId") as number;
  const modalityId = normalizePositiveInteger(payload.modalityId, "modalityId") as number;
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

    const existing = existingResult.rows[0] as ExamTypeRow | undefined;

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
    const updatedExamType = requireRow<ExamTypeRow>(
      rows[0] as ExamTypeRow | undefined,
      "Failed to update exam type."
    );

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

export async function deleteExamType(
  examTypeId: number | string,
  currentUserId: UserId
): Promise<ExamTypeRow> {
  const cleanExamTypeId = normalizePositiveInteger(examTypeId, "examTypeId") as number;
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

    const existing = existingResult.rows[0] as ExamTypeRow | undefined;

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
    const deletedExamType = requireRow<ExamTypeRow>(
      rows[0] as ExamTypeRow | undefined,
      "Failed to delete exam type."
    );

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

export async function createAppointment(
  payload: UnknownRecord,
  currentUser: AppointmentActor | null | undefined,
  options: AppointmentUpdateOptions = {}
): Promise<AppointmentCreateResult> {
  if (!currentUser?.sub) {
    throw new HttpError(401, "Authentication required.");
  }

  const { username: supervisorUsername, password: supervisorPassword, reason: overrideReason } =
    normalizeOverridePayload(payload, options);
  const patientId = normalizePositiveInteger(payload.patientId, "patientId") as number;
  const modalityId = normalizePositiveInteger(payload.modalityId, "modalityId") as number;
  const examTypeId = normalizePositiveInteger(payload.examTypeId, "examTypeId", {
    required: false
  });
  const reportingPriorityId = normalizePositiveInteger(payload.reportingPriorityId, "reportingPriorityId", {
    required: false
  });
  const appointmentDate = normalizeAppointmentDate(payload.appointmentDate);
  const notes = String(payload.notes || "").trim();
  const caseCategory = normalizeCaseCategory(payload.caseCategory);
  const useSpecialQuota = Boolean(payload.useSpecialQuota);
  const specialReasonCode = String(payload.specialReasonCode || "").trim() || null;
  const specialReasonNote = String(payload.specialReasonNote || "").trim() || null;
  const isWalkIn = Boolean(payload.isWalkIn);
  let overrideFailureAuditContext: {
    appointmentId: number | null;
    patientId: number;
    modalityId: number;
    examTypeId: number | null;
    appointmentDate: string;
    requestingUserId: number;
    supervisorUserId: number | null;
    overrideReason: string;
    evaluationSnapshot: unknown;
  } | null = null;
  const client = await pool.connect();

  try {
    await client.query("begin");
    await requireAppointmentDayEnabled(client, appointmentDate);
    await client.query("select pg_advisory_xact_lock(hashtext($1))", [
      `appointment-sequence:${appointmentDate}`
    ]);
    await client.query("select pg_advisory_xact_lock(hashtext($1))", [
      `appointment-slot:${modalityId}:${appointmentDate}`
    ]);
    await client.query("select pg_advisory_xact_lock(hashtext($1))", [
      `appointment-category:${modalityId}:${appointmentDate}:${caseCategory}`
    ]);
    if (examTypeId) {
      await client.query("select pg_advisory_xact_lock(hashtext($1))", [
        `appointment-exam-quota:${modalityId}:${appointmentDate}:${examTypeId}`
      ]);
    }

    const patient = await getPatientById(client, patientId);
    const modality = await getModalityById(client, modalityId);
    const examType = examTypeId
      ? await getExamTypeById(client, examTypeId, modalityId)
      : null;
    const priority = reportingPriorityId
      ? await getPriorityById(client, reportingPriorityId)
      : null;
    const flags = await getSchedulingEngineFlags(client);
    const includeOverrideEvaluation = Boolean(supervisorUsername && supervisorPassword);
    let evaluation: SchedulingResult | null = null;
    let schedulingOverbooked = false;

    const bookingStats = await client.query(`
      select
        count(*) filter (where status <> 'cancelled') as booked_count,
        coalesce(max(modality_slot_number), 0) as last_slot_number,
        coalesce(max(daily_sequence), 0) as last_daily_sequence
      from appointments
      where modality_id = $1
        and appointment_date = $2::date
    `, [modalityId, appointmentDate]);

    const globalStats = await client.query(`
      select coalesce(max(daily_sequence), 0) as last_daily_sequence
      from appointments
      where appointment_date = $1::date
    `, [appointmentDate]);

    const bookingStatsRow = bookingStats.rows[0] as BookingStatsRow | undefined;
    const globalStatsRow = globalStats.rows[0] as SequenceRow | undefined;
    const nextSlotNumber = Number(bookingStatsRow?.last_slot_number || 0) + 1;
    const nextDailySequence = Number(globalStatsRow?.last_daily_sequence || 0) + 1;
    const maxCasesPerModality = await getMaxCasesPerModality(client);
    const bookedCount = Number(bookingStatsRow?.booked_count || 0);
    const capacity = resolveEffectiveCapacity(modality.daily_capacity, maxCasesPerModality);
    const legacyOverbooked = capacity !== null && bookedCount >= capacity;

    if (flags.enabled || flags.shadowMode) {
      evaluation = await evaluateSchedulingCandidateWithDb(
        {
          patientId,
          modalityId,
          examTypeId: examType?.id || null,
          scheduledDate: appointmentDate,
          scheduledTime: null,
          caseCategory,
          requestedByUserId: Number(currentUser.sub),
          useSpecialQuota,
          specialReasonCode,
          specialReasonNote,
          includeOverrideEvaluation,
          appointmentId: null
        },
        client
      );

      if (flags.shadowMode && !flags.enabled) {
        await logAuditEntry(
          {
            entityType: "scheduling_shadow_evaluation",
            entityId: null,
            actionType: "evaluate_create",
            oldValues: null,
            newValues: evaluation.evaluationSnapshot,
            changedByUserId: currentUser.sub
          },
          client
        );
      }
    }

    if (flags.enabled && evaluation && !evaluation.isAllowed) {
      throw new HttpError(409, `Scheduling blocked: ${evaluation.blockReasons.join(", ") || "rule_violation"}`);
    }

    if (flags.enabled && evaluation?.requiresSupervisorOverride && !includeOverrideEvaluation) {
      throw new HttpError(403, "Supervisor override credentials are required for this scheduling decision.");
    }

    // Handle supervisor approval (legacy overbooking and scheduling override).
    let approvingSupervisor: AuthUserRow | null = null;
    if ((flags.enabled && evaluation?.requiresSupervisorOverride) || (!flags.enabled && legacyOverbooked)) {
      if (!supervisorUsername) {
        if (flags.enabled && evaluation) {
          await logOverrideEvent(client, {
            appointmentId: null,
            patientId,
            modalityId,
            examTypeId: examType?.id || null,
            appointmentDate,
            requestingUserId: Number(currentUser.sub),
            supervisorUserId: null,
            overrideReason,
            evaluationSnapshot: evaluation.evaluationSnapshot,
            outcome: overrideOutcomeForFailure("missing_username")
          });
        }
        throw new HttpError(403, "Supervisor username is required before overbooking.");
      }
      if (!supervisorPassword) {
        if (flags.enabled && evaluation) {
          await logOverrideEvent(client, {
            appointmentId: null,
            patientId,
            modalityId,
            examTypeId: examType?.id || null,
            appointmentDate,
            requestingUserId: Number(currentUser.sub),
            supervisorUserId: null,
            overrideReason,
            evaluationSnapshot: evaluation.evaluationSnapshot,
            outcome: overrideOutcomeForFailure("missing_password")
          });
        }
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
        if (flags.enabled && evaluation) {
          await logOverrideEvent(client, {
            appointmentId: null,
            patientId,
            modalityId,
            examTypeId: examType?.id || null,
            appointmentDate,
            requestingUserId: Number(currentUser.sub),
            supervisorUserId: null,
            overrideReason,
            evaluationSnapshot: evaluation.evaluationSnapshot,
            outcome: overrideOutcomeForFailure("invalid_credentials")
          });
        }
        if (error instanceof HttpError) {
          throw error;
        }
        throw new HttpError(403, "Invalid supervisor credentials. Overbooking cancelled.");
      }

      if (!overrideReason) {
        if (flags.enabled && evaluation) {
          await logOverrideEvent(client, {
            appointmentId: null,
            patientId,
            modalityId,
            examTypeId: examType?.id || null,
            appointmentDate,
            requestingUserId: Number(currentUser.sub),
            supervisorUserId: approvingSupervisor ? Number(approvingSupervisor.id) : null,
            overrideReason,
            evaluationSnapshot: evaluation.evaluationSnapshot,
            outcome: overrideOutcomeForFailure("missing_reason")
          });
        }
        throw new HttpError(400, "A supervisor reason is required for override/overbooking.");
      }
      overrideFailureAuditContext = {
        appointmentId: null,
        patientId,
        modalityId,
        examTypeId: examType?.id || null,
        appointmentDate,
        requestingUserId: Number(currentUser.sub),
        supervisorUserId: approvingSupervisor ? Number(approvingSupervisor.id) : null,
        overrideReason,
        evaluationSnapshot:
          flags.enabled && evaluation
            ? evaluation.evaluationSnapshot
            : {
                mode: "legacy_overbooking"
              }
      };
      schedulingOverbooked = true;
    } else {
      schedulingOverbooked = Boolean(flags.enabled && evaluation?.consumedCapacityMode === "override");
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
          case_category,
          uses_special_quota,
          special_reason_code,
          special_reason_note,
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
          $16,
          nullif($17, ''),
          nullif($18, ''),
          $19,
          $19
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
        schedulingOverbooked,
        overrideReason,
        schedulingOverbooked && approvingSupervisor ? approvingSupervisor.full_name : null,
        schedulingOverbooked && approvingSupervisor ? approvingSupervisor.id : null,
        notes,
        caseCategory,
        useSpecialQuota,
        specialReasonCode,
        specialReasonNote,
        currentUser.sub
      ]
    );
    const createdAppointment = requireRow<AppointmentDbRow>(
      rows[0] as AppointmentDbRow | undefined,
      "Failed to create appointment."
    );

    await client.query(
      `
        insert into appointment_status_history (appointment_id, old_status, new_status, changed_by_user_id, reason)
        values ($1, null, 'scheduled', $2, $3)
      `,
      [createdAppointment.id, currentUser.sub, schedulingOverbooked ? overrideReason : null]
    );

    if (flags.enabled && evaluation) {
      await persistQuotaConsumption(client, createdAppointment, evaluation.consumedCapacityMode, Number(currentUser.sub));
      if (evaluation.requiresSupervisorOverride || evaluation.consumedCapacityMode === "override") {
        await logOverrideEvent(client, {
          appointmentId: Number(createdAppointment.id),
          patientId,
          modalityId,
          examTypeId: examType?.id || null,
          appointmentDate,
          requestingUserId: Number(currentUser.sub),
          supervisorUserId: approvingSupervisor ? Number(approvingSupervisor.id) : null,
          overrideReason,
          evaluationSnapshot: evaluation.evaluationSnapshot,
          outcome: "approved_and_booked"
        });
      }
    } else if (!flags.enabled && legacyOverbooked) {
      await logOverrideEvent(client, {
        appointmentId: Number(createdAppointment.id),
        patientId,
        modalityId,
        examTypeId: examType?.id || null,
        appointmentDate,
        requestingUserId: Number(currentUser.sub),
        supervisorUserId: approvingSupervisor ? Number(approvingSupervisor.id) : null,
        overrideReason,
        evaluationSnapshot: {
          mode: "legacy_overbooking"
        },
        outcome: "approved_and_booked"
      });
    }

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
    if (overrideFailureAuditContext) {
      try {
        await logOverrideEvent(pool, {
          ...overrideFailureAuditContext,
          outcome: "approved_but_failed"
        });
      } catch {
        // Best-effort failure audit.
      }
    }
    const mapped = toSchedulingConflictError(error);
    throw mapped || error;
  } finally {
    client.release();
  }
}

// AuthUserRow type for authenticateUser return value
interface AuthUserRow {
  id: UserId;
  username: string;
  full_name: string;
  role: string;
  password_hash: string;
  is_active: boolean;
}

export async function updateAppointment(
  appointmentId: number | string,
  payload: UnknownRecord,
  currentUser: AuthenticatedUserContext,
  options: AppointmentUpdateOptions = {}
): Promise<UnknownRecord> {
  if (!currentUser?.sub) {
    throw new HttpError(401, "Authentication required.");
  }

  const { username: supervisorUsername, password: supervisorPassword, reason: overrideReason } =
    normalizeOverridePayload(payload, options);
  const cleanAppointmentId = normalizePositiveInteger(appointmentId, "appointmentId");
  if (!cleanAppointmentId) {
    throw new HttpError(400, "appointmentId is required.");
  }
  let overrideFailureAuditContext: {
    appointmentId: number;
    patientId: number;
    modalityId: number;
    examTypeId: number | null;
    appointmentDate: string;
    requestingUserId: number;
    supervisorUserId: number | null;
    overrideReason: string;
    evaluationSnapshot: unknown;
  } | null = null;
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
        : (normalizePositiveInteger(payload.modalityId, "modalityId") as number);

    const examTypeId =
      payload.examTypeId === undefined || payload.examTypeId === null || payload.examTypeId === ""
        ? existingAppointment.exam_type_id
        : normalizePositiveInteger(payload.examTypeId, "examTypeId", { required: false });

    const reportingPriorityId =
      payload.reportingPriorityId === undefined ||
      payload.reportingPriorityId === null ||
      payload.reportingPriorityId === ""
        ? existingAppointment.reporting_priority_id
        : normalizePositiveInteger(payload.reportingPriorityId, "reportingPriorityId", {
            required: false
          });

    const appointmentDate =
      payload.appointmentDate === undefined ||
      payload.appointmentDate === null ||
      payload.appointmentDate === ""
        ? normalizeIsoDate(existingAppointment.appointment_date)
        : normalizeAppointmentDate(payload.appointmentDate);

    const notes =
      payload.notes === undefined || payload.notes === null || payload.notes === ""
        ? normalizeOptionalText(existingAppointment.notes)
        : normalizeOptionalText(payload.notes);

    const caseCategory =
      payload.caseCategory === undefined || payload.caseCategory === null || payload.caseCategory === ""
        ? normalizeCaseCategory(existingAppointment.case_category)
        : normalizeCaseCategory(payload.caseCategory);
    const useSpecialQuota =
      payload.useSpecialQuota === undefined
        ? Boolean(existingAppointment.uses_special_quota)
        : Boolean(payload.useSpecialQuota);
    const specialReasonCode =
      payload.specialReasonCode === undefined || payload.specialReasonCode === null || payload.specialReasonCode === ""
        ? String(existingAppointment.special_reason_code || "").trim() || null
        : String(payload.specialReasonCode || "").trim() || null;
    const specialReasonNote =
      payload.specialReasonNote === undefined || payload.specialReasonNote === null || payload.specialReasonNote === ""
        ? String(existingAppointment.special_reason_note || "").trim() || null
        : String(payload.specialReasonNote || "").trim() || null;

    const existingAppointmentDate = normalizeIsoDate(existingAppointment.appointment_date);
    if (existingAppointmentDate !== appointmentDate) {
      await requireAppointmentDayEnabled(client, appointmentDate);
    }

    await client.query("select pg_advisory_xact_lock(hashtext($1))", [
      `appointment-sequence:${appointmentDate}`
    ]);
    await client.query("select pg_advisory_xact_lock(hashtext($1))", [
      `appointment-slot:${modalityId}:${appointmentDate}`
    ]);
    await client.query("select pg_advisory_xact_lock(hashtext($1))", [
      `appointment-category:${modalityId}:${appointmentDate}:${caseCategory}`
    ]);
    if (examTypeId) {
      await client.query("select pg_advisory_xact_lock(hashtext($1))", [
        `appointment-exam-quota:${modalityId}:${appointmentDate}:${examTypeId}`
      ]);
    }

    const modality = await getModalityById(client, modalityId);
    const examType = examTypeId
      ? await getExamTypeById(client, examTypeId, modalityId)
      : null;
    const priority = reportingPriorityId
      ? await getPriorityById(client, reportingPriorityId)
      : null;
    const flags = await getSchedulingEngineFlags(client);
    const includeOverrideEvaluation = Boolean(supervisorUsername && supervisorPassword);
    let evaluation: SchedulingResult | null = null;
    const slotStats = await nextModalitySlotNumber(
      client,
      modalityId,
      appointmentDate,
      cleanAppointmentId
    );
    const maxCasesPerModality = await getMaxCasesPerModality(client);
    const capacity = resolveEffectiveCapacity(modality.daily_capacity, maxCasesPerModality);

    const existingModalityId = Number(existingAppointment.modality_id);
    const modalityOrDateChanged =
      existingModalityId !== modalityId || existingAppointmentDate !== appointmentDate;

    // Only check overbooking when date or modality changes (treat as new appointment)
    // Editing fields on the same date/modality does not require supervisor approval
    const legacyOverbooked =
      modalityOrDateChanged && capacity !== null && slotStats.bookedCount >= capacity;

    if (flags.enabled || flags.shadowMode) {
      evaluation = await evaluateSchedulingCandidateWithDb(
        {
          patientId: Number(existingAppointment.patient_id),
          modalityId,
          examTypeId: examType?.id || null,
          scheduledDate: appointmentDate,
          scheduledTime: null,
          caseCategory,
          requestedByUserId: Number(currentUser.sub),
          useSpecialQuota,
          specialReasonCode,
          specialReasonNote,
          includeOverrideEvaluation,
          appointmentId: Number(cleanAppointmentId)
        },
        client
      );
      if (flags.shadowMode && !flags.enabled) {
        await logAuditEntry(
          {
            entityType: "scheduling_shadow_evaluation",
            entityId: cleanAppointmentId,
            actionType: "evaluate_update",
            oldValues: null,
            newValues: evaluation.evaluationSnapshot,
            changedByUserId: currentUser.sub
          },
          client
        );
      }
    }

    if (flags.enabled && evaluation && !evaluation.isAllowed) {
      throw new HttpError(409, `Scheduling blocked: ${evaluation.blockReasons.join(", ") || "rule_violation"}`);
    }

    if (flags.enabled && evaluation?.requiresSupervisorOverride && !includeOverrideEvaluation) {
      throw new HttpError(403, "Supervisor override credentials are required for this scheduling decision.");
    }

    // Handle overbooking approval
    let approvingSupervisor: AuthUserRow | null = null;
    const requiresApproval =
      (flags.enabled && Boolean(evaluation?.requiresSupervisorOverride)) ||
      (!flags.enabled && legacyOverbooked);

    if (requiresApproval) {
      if (!supervisorUsername) {
        if (flags.enabled && evaluation) {
          await logOverrideEvent(client, {
            appointmentId: Number(cleanAppointmentId),
            patientId: Number(existingAppointment.patient_id),
            modalityId,
            examTypeId: examType?.id || null,
            appointmentDate,
            requestingUserId: Number(currentUser.sub),
            supervisorUserId: null,
            overrideReason,
            evaluationSnapshot: evaluation.evaluationSnapshot,
            outcome: overrideOutcomeForFailure("missing_username")
          });
        }
        throw new HttpError(403, "Supervisor username is required before overbooking.");
      }
      if (!supervisorPassword) {
        if (flags.enabled && evaluation) {
          await logOverrideEvent(client, {
            appointmentId: Number(cleanAppointmentId),
            patientId: Number(existingAppointment.patient_id),
            modalityId,
            examTypeId: examType?.id || null,
            appointmentDate,
            requestingUserId: Number(currentUser.sub),
            supervisorUserId: null,
            overrideReason,
            evaluationSnapshot: evaluation.evaluationSnapshot,
            outcome: overrideOutcomeForFailure("missing_password")
          });
        }
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
        if (flags.enabled && evaluation) {
          await logOverrideEvent(client, {
            appointmentId: Number(cleanAppointmentId),
            patientId: Number(existingAppointment.patient_id),
            modalityId,
            examTypeId: examType?.id || null,
            appointmentDate,
            requestingUserId: Number(currentUser.sub),
            supervisorUserId: null,
            overrideReason,
            evaluationSnapshot: evaluation.evaluationSnapshot,
            outcome: overrideOutcomeForFailure("invalid_credentials")
          });
        }
        if (error instanceof HttpError) {
          throw error;
        }
        throw new HttpError(403, "Invalid supervisor credentials. Overbooking cancelled.");
      }

      if (!overrideReason) {
        if (flags.enabled && evaluation) {
          await logOverrideEvent(client, {
            appointmentId: Number(cleanAppointmentId),
            patientId: Number(existingAppointment.patient_id),
            modalityId,
            examTypeId: examType?.id || null,
            appointmentDate,
            requestingUserId: Number(currentUser.sub),
            supervisorUserId: approvingSupervisor ? Number(approvingSupervisor.id) : null,
            overrideReason,
            evaluationSnapshot: evaluation.evaluationSnapshot,
            outcome: overrideOutcomeForFailure("missing_reason")
          });
        }
        throw new HttpError(400, "A supervisor reason is required for override/overbooking.");
      }
      overrideFailureAuditContext = {
        appointmentId: Number(cleanAppointmentId),
        patientId: Number(existingAppointment.patient_id),
        modalityId,
        examTypeId: examType?.id || null,
        appointmentDate,
        requestingUserId: Number(currentUser.sub),
        supervisorUserId: approvingSupervisor ? Number(approvingSupervisor.id) : null,
        overrideReason,
        evaluationSnapshot:
          flags.enabled && evaluation
            ? evaluation.evaluationSnapshot
            : {
                mode: "legacy_overbooking_update"
              }
      };
    }

    const sequence =
      existingAppointmentDate === appointmentDate
        ? existingAppointment.daily_sequence
        : await nextDailySequence(client, appointmentDate, cleanAppointmentId);

    const modalitySlotNumber = modalityOrDateChanged
      ? slotStats.slotNumber
      : Number(existingAppointment.modality_slot_number);

    const accessionNumber = buildAccessionNumber(appointmentDate, sequence);
    const isOverbooked = requiresApproval || Boolean(flags.enabled && evaluation?.consumedCapacityMode === "override");

    const approvedByUserId =
      isOverbooked && approvingSupervisor?.id != null
        ? Number(approvingSupervisor.id)
        : null;

    const updatedByUserId =
      currentUser?.sub != null ? Number(currentUser.sub) : null;

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
          case_category = $14,
          uses_special_quota = $15,
          special_reason_code = nullif($16, ''),
          special_reason_note = nullif($17, ''),
          updated_by_user_id = $18::bigint,
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
        overrideReason,
        isOverbooked && approvingSupervisor ? approvingSupervisor.full_name : null,
        approvedByUserId,
        notes,
        caseCategory,
        useSpecialQuota,
        specialReasonCode,
        specialReasonNote,
        updatedByUserId
      ]
    );
    const updatedAppointment = requireRow<AppointmentDbRow>(
      rows[0] as AppointmentDbRow | undefined,
      "Failed to update appointment."
    );

    // Only insert status history entry when status actually changed
    const newStatus = updatedAppointment.status as string;
    if (newStatus !== existingStatus) {
      await client.query(
        `
          insert into appointment_status_history (appointment_id, old_status, new_status, changed_by_user_id, reason)
          values ($1, $2, $3, $4, $5)
        `,
        [cleanAppointmentId, existingStatus, newStatus, currentUser.sub, "Appointment edited or rescheduled"]
      );
    }

    if (flags.enabled && evaluation) {
      await releaseQuotaConsumptions(client, cleanAppointmentId);
      await persistQuotaConsumption(client, updatedAppointment, evaluation.consumedCapacityMode, Number(currentUser.sub));
      if (evaluation.requiresSupervisorOverride || evaluation.consumedCapacityMode === "override") {
        await logOverrideEvent(client, {
          appointmentId: Number(updatedAppointment.id),
          patientId: Number(updatedAppointment.patient_id),
          modalityId,
          examTypeId: examType?.id || null,
          appointmentDate,
          requestingUserId: Number(currentUser.sub),
          supervisorUserId: approvingSupervisor ? Number(approvingSupervisor.id) : null,
          overrideReason,
          evaluationSnapshot: evaluation.evaluationSnapshot,
          outcome: "approved_and_booked"
        });
      }
    } else if (!flags.enabled && legacyOverbooked) {
      await logOverrideEvent(client, {
        appointmentId: Number(updatedAppointment.id),
        patientId: Number(updatedAppointment.patient_id),
        modalityId,
        examTypeId: examType?.id || null,
        appointmentDate,
        requestingUserId: Number(currentUser.sub),
        supervisorUserId: approvingSupervisor ? Number(approvingSupervisor.id) : null,
        overrideReason,
        evaluationSnapshot: {
          mode: "legacy_overbooking_update"
        },
        outcome: "approved_and_booked"
      });
    }

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
    return updatedAppointment as unknown as UnknownRecord;
  } catch (error) {
    console.error(
      "[updateAppointment] ERROR:",
      (error as Error).message,
      (error as Error).stack
    );
    await client.query("rollback");
    if (overrideFailureAuditContext) {
      try {
        await logOverrideEvent(pool, {
          ...overrideFailureAuditContext,
          outcome: "approved_but_failed"
        });
      } catch {
        // Best-effort failure audit.
      }
    }
    const mapped = toSchedulingConflictError(error);
    throw mapped || error;
  } finally {
    client.release();
  }
}

export async function updateAppointmentProtocol(
  appointmentId: number | string,
  payload: UnknownRecord,
  currentUser: AuthenticatedUserContext
): Promise<UnknownRecord> {
  if (!currentUser?.sub) {
    throw new HttpError(401, "Authentication required.");
  }

  const cleanAppointmentId = normalizePositiveInteger(appointmentId, "appointmentId");
  if (!cleanAppointmentId) {
    throw new HttpError(400, "appointmentId is required.");
  }
  const examTypeId = normalizePositiveInteger(payload.examTypeId, "examTypeId", {
    required: false
  });
  const client = await pool.connect();

  try {
    await client.query("begin");
    const existingAppointment = await getAppointmentById(client, cleanAppointmentId);
    const existingStatus = existingAppointment.status;

    if (!APPOINTMENT_RECEPTION_ACTIVE_STATUSES.includes(existingStatus)) {
      throw new HttpError(409, "Only active reception appointments can be updated.");
    }

    const examType = examTypeId
      ? await getExamTypeById(client, examTypeId, existingAppointment.modality_id)
      : null;

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
    const protocolUpdatedAppointment = requireRow<AppointmentDbRow>(
      rows[0] as AppointmentDbRow | undefined,
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
    return protocolUpdatedAppointment as unknown as UnknownRecord;
  } catch (error) {
    await client.query("rollback");
    throw error;
  } finally {
    client.release();
  }
}

export async function cancelAppointment(
  appointmentId: number | string,
  reason: string,
  currentUserId: UserId
): Promise<{ ok: boolean }> {
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

    await releaseQuotaConsumptions(client, cleanAppointmentId);

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

export async function deleteAppointment(
  appointmentId: number | string,
  currentUserId: UserId
): Promise<{ ok: boolean }> {
  const cleanAppointmentId = normalizePositiveInteger(
    appointmentId,
    "appointmentId"
  ) as number;
  const client = await pool.connect();

  try {
    await client.query("begin");
    const appointment = await getAppointmentById(client, cleanAppointmentId);

    await releaseQuotaConsumptions(client, cleanAppointmentId);

    await client.query(`delete from queue_entries where appointment_id = $1`, [
      cleanAppointmentId
    ]);
    await client.query(`delete from documents where appointment_id = $1`, [
      cleanAppointmentId
    ]);
    await client.query(
      `delete from appointment_status_history where appointment_id = $1`,
      [cleanAppointmentId]
    );
    await client.query(`delete from appointments where id = $1`, [
      cleanAppointmentId
    ]);

    await logAuditEntry(
      {
        entityType: "appointment",
        entityId: cleanAppointmentId,
        actionType: "delete",
        oldValues: appointment,
        newValues: null,
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
