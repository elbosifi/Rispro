import type { PoolClient } from "pg";
import { pool } from "../db/pool.js";
import { HttpError } from "../utils/http-error.js";
import { normalizeOptionalText, normalizePositiveInteger } from "../utils/normalize.js";
import { requireRow } from "../utils/records.js";
import { logAuditEntry } from "./audit-service.js";
import { scheduleBookingWorklistSync } from "./dicom-service.js";
import {
  listOrthancVerificationTargets,
  verifyBookingStudyWithOrthanc,
  type OrthancAutoCompletionSettingLike,
  type OrthancBookingVerificationContext,
  type OrthancCompletionThreshold,
  type OrthancMatchingStrategy,
  type OrthancVerificationResult,
  type OrthancVerificationStatus,
  type OrthancVerificationTarget,
  type OrthancVerificationTargetType,
} from "./orthanc-study-verification-service.js";
import type { UserId } from "../types/http.js";
import { formatV2AccessionNumber } from "../modules/appointments-v2/shared/utils/accession.js";

const ELIGIBLE_BOOKING_STATUSES = ["scheduled", "arrived", "waiting"] as const;
const DEFAULT_WORKER_INTERVAL_MS = 60_000;
const DEFAULT_BATCH_SIZE = 20;

export interface PacsAutoCompletionSettingRow {
  id: number;
  modality_id: number;
  enabled: boolean;
  orthanc_target_type: OrthancVerificationTargetType;
  orthanc_target_key: string | null;
  matching_strategy: OrthancMatchingStrategy;
  completion_threshold: OrthancCompletionThreshold;
  poll_interval_minutes: number;
  lookback_hours: number;
  stop_after_hours: number;
  last_check_status: OrthancVerificationStatus | null;
  last_check_result_json: unknown;
  last_error: string | null;
  last_checked_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface PacsAutoCompletionSettingListRow extends PacsAutoCompletionSettingRow {
  modality_code: string;
  modality_name_ar: string;
  modality_name_en: string;
  modality_is_active: boolean;
}

interface EligibleBookingRow extends OrthancBookingVerificationContext {
  id: number;
  modality_id: number;
  accession_number: string;
  study_instance_uid: string | null;
  appointment_date: string;
  booking_date: string;
  status: string;
  modality_code: string;
  national_id: string | null;
  mrn: string | null;
  patient_primary_id: string | null;
  setting_id: number;
  enabled: boolean;
  orthanc_target_type: OrthancVerificationTargetType;
  orthanc_target_key: string | null;
  matching_strategy: OrthancMatchingStrategy;
  completion_threshold: OrthancCompletionThreshold;
  poll_interval_minutes: number;
  lookback_hours: number;
  stop_after_hours: number;
}

interface VerificationHistoryRow {
  id: number;
  booking_id: number | null;
  modality_id: number | null;
  setting_id: number | null;
  orthanc_target_type: OrthancVerificationTargetType;
  orthanc_target_key: string | null;
  match_key: string | null;
  match_value: string | null;
  result_status: OrthancVerificationStatus;
  result_json: unknown;
  series_count: number | null;
  instance_count: number | null;
  last_error: string | null;
  completed_booking: boolean;
  created_at: string;
}

export interface PacsAutoCompletionTestDiagnostics {
  bookingId: number;
  bookingStatus: string;
  expectedAccession: string;
  studyInstanceUid: string | null;
  modalityId: number;
  modalityCode: string;
  orthancTargetType: OrthancVerificationTargetType;
  orthancTargetKey: string | null;
  orthancTargetLabel: string;
  matchKey: string | null;
  matchValue: string | null;
  candidateCount: number | null;
  completionThreshold: OrthancCompletionThreshold;
  lastError: string | null;
  legacyRawAccessionFallbackUsed: boolean;
}

export interface AppointmentsV2PacsAutoCompletionWorker {
  stop(): Promise<void>;
}

let workerIntervalHandle: NodeJS.Timeout | null = null;
let workerTickRunning = false;
let workerStopped = false;

function normalizeBoolean(value: unknown): boolean {
  return String(value ?? "").trim().toLowerCase() === "true" ||
    String(value ?? "").trim().toLowerCase() === "enabled" ||
    value === true;
}

function normalizeTargetType(value: unknown): OrthancVerificationTargetType {
  const clean = normalizeOptionalText(value).toLowerCase();
  if (clean === "remote_modality") return "remote_modality";
  if (clean === "local" || !clean) return "local";
  throw new HttpError(400, "orthancTargetType must be local or remote_modality.");
}

function normalizeMatchingStrategy(value: unknown): OrthancMatchingStrategy {
  const clean = normalizeOptionalText(value) || "study_uid_preferred_accession_fallback";
  if (clean !== "study_uid_preferred_accession_fallback") {
    throw new HttpError(400, "matchingStrategy must be study_uid_preferred_accession_fallback.");
  }
  return clean;
}

function normalizeThreshold(value: unknown): OrthancCompletionThreshold {
  const clean = normalizeOptionalText(value) || "study_exists";
  if (clean === "study_exists" || clean === "series_exists" || clean === "instance_exists") return clean;
  throw new HttpError(400, "completionThreshold must be study_exists, series_exists, or instance_exists.");
}

function normalizePositive(value: unknown, fieldName: string, fallback: number): number {
  if (value === undefined || value === null || value === "") return fallback;
  return normalizePositiveInteger(value, fieldName) ?? fallback;
}

function normalizeNonNegative(value: unknown, fieldName: string, fallback: number): number {
  if (value === undefined || value === null || value === "") return fallback;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 0) {
    throw new HttpError(400, `${fieldName} must be a non-negative integer.`);
  }
  return parsed;
}

function mapSetting(row: EligibleBookingRow | PacsAutoCompletionSettingRow): OrthancAutoCompletionSettingLike {
  return {
    id: Number(row.id ?? (row as EligibleBookingRow).setting_id),
    modality_id: row.modality_id,
    enabled: row.enabled,
    orthanc_target_type: row.orthanc_target_type,
    orthanc_target_key: row.orthanc_target_key,
    matching_strategy: row.matching_strategy,
    completion_threshold: row.completion_threshold,
  };
}

function mapBooking(row: EligibleBookingRow): OrthancBookingVerificationContext {
  return {
    id: row.id,
    modality_id: row.modality_id,
    accession_number: row.accession_number,
    study_instance_uid: row.study_instance_uid,
    appointment_date: row.appointment_date,
    booking_date: row.booking_date,
    modality_code: row.modality_code,
    national_id: row.national_id,
    mrn: row.mrn,
    patient_primary_id: row.patient_primary_id,
  };
}

function readCandidateCount(resultJson: unknown): number | null {
  if (!resultJson || typeof resultJson !== "object" || Array.isArray(resultJson)) return null;
  const value = (resultJson as Record<string, unknown>).candidateCount;
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function buildTestDiagnostics(booking: EligibleBookingRow, setting: PacsAutoCompletionSettingRow, result: OrthancVerificationResult): PacsAutoCompletionTestDiagnostics {
  const orthancTargetKey = setting.orthanc_target_type === "local" ? null : setting.orthanc_target_key;
  return {
    bookingId: Number(booking.id),
    bookingStatus: booking.status,
    expectedAccession: booking.accession_number,
    studyInstanceUid: booking.study_instance_uid,
    modalityId: Number(booking.modality_id),
    modalityCode: booking.modality_code,
    orthancTargetType: setting.orthanc_target_type,
    orthancTargetKey,
    orthancTargetLabel: setting.orthanc_target_type === "local" ? "Local Orthanc index" : orthancTargetKey || "Remote Orthanc modality",
    matchKey: result.matchKey,
    matchValue: result.matchValue,
    candidateCount: readCandidateCount(result.resultJson),
    completionThreshold: setting.completion_threshold,
    lastError: result.lastError,
    legacyRawAccessionFallbackUsed: Boolean(
      result.resultJson &&
      typeof result.resultJson === "object" &&
      !Array.isArray(result.resultJson) &&
      (result.resultJson as Record<string, unknown>).legacyRawAccessionFallbackUsed
    ),
  };
}

function normalizeTestBookingId(value: unknown): number | null {
  if (typeof value === "string") {
    const clean = value.trim();
    const accessionMatch = /^V2-(\d+)$/i.exec(clean);
    if (accessionMatch) {
      return normalizePositiveInteger(accessionMatch[1], "bookingId");
    }
  }
  return normalizePositiveInteger(value, "bookingId");
}

export async function listPacsAutoCompletionSettings(): Promise<PacsAutoCompletionSettingListRow[]> {
  const { rows } = await pool.query(
    `
      select
        coalesce(s.id, 0)::bigint as id,
        m.id as modality_id,
        coalesce(s.enabled, false) as enabled,
        coalesce(s.orthanc_target_type, 'local') as orthanc_target_type,
        s.orthanc_target_key,
        coalesce(s.matching_strategy, 'study_uid_preferred_accession_fallback') as matching_strategy,
        coalesce(s.completion_threshold, 'study_exists') as completion_threshold,
        coalesce(s.poll_interval_minutes, 15) as poll_interval_minutes,
        coalesce(s.lookback_hours, 24) as lookback_hours,
        coalesce(s.stop_after_hours, 72) as stop_after_hours,
        s.last_check_status,
        s.last_check_result_json,
        s.last_error,
        s.last_checked_at,
        coalesce(s.created_at, now()) as created_at,
        coalesce(s.updated_at, now()) as updated_at,
        m.code as modality_code,
        m.name_ar as modality_name_ar,
        m.name_en as modality_name_en,
        m.is_active as modality_is_active
      from modalities m
      left join appointments_v2.pacs_auto_completion_settings s on s.modality_id = m.id
      order by m.name_en asc, m.code asc
    `
  );

  return rows as PacsAutoCompletionSettingListRow[];
}

export async function upsertPacsAutoCompletionSetting(
  modalityId: number | string,
  payload: Record<string, unknown>,
  _currentUserId: UserId
): Promise<PacsAutoCompletionSettingRow> {
  const cleanModalityId = normalizePositiveInteger(modalityId, "modalityId");
  const targetType = normalizeTargetType(payload.orthancTargetType ?? payload.orthanc_target_type);
  const targetKey = targetType === "remote_modality"
    ? normalizeOptionalText(payload.orthancTargetKey ?? payload.orthanc_target_key)
    : "";
  const matchingStrategy = normalizeMatchingStrategy(payload.matchingStrategy ?? payload.matching_strategy);
  const completionThreshold = normalizeThreshold(payload.completionThreshold ?? payload.completion_threshold);
  const enabled = normalizeBoolean(payload.enabled);
  const pollIntervalMinutes = normalizePositive(payload.pollIntervalMinutes ?? payload.poll_interval_minutes, "pollIntervalMinutes", 15);
  const lookbackHours = normalizeNonNegative(payload.lookbackHours ?? payload.lookback_hours, "lookbackHours", 24);
  const stopAfterHours = normalizePositive(payload.stopAfterHours ?? payload.stop_after_hours, "stopAfterHours", 72);

  if (targetType === "remote_modality" && !targetKey) {
    throw new HttpError(400, "orthancTargetKey is required for remote modality targets.");
  }

  const { rows } = await pool.query(
    `
      insert into appointments_v2.pacs_auto_completion_settings (
        modality_id,
        enabled,
        orthanc_target_type,
        orthanc_target_key,
        matching_strategy,
        completion_threshold,
        poll_interval_minutes,
        lookback_hours,
        stop_after_hours,
        updated_at
      )
      values ($1, $2, $3, nullif($4, ''), $5, $6, $7, $8, $9, now())
      on conflict (modality_id) do update
      set
        enabled = excluded.enabled,
        orthanc_target_type = excluded.orthanc_target_type,
        orthanc_target_key = excluded.orthanc_target_key,
        matching_strategy = excluded.matching_strategy,
        completion_threshold = excluded.completion_threshold,
        poll_interval_minutes = excluded.poll_interval_minutes,
        lookback_hours = excluded.lookback_hours,
        stop_after_hours = excluded.stop_after_hours,
        updated_at = now()
      returning *
    `,
    [
      cleanModalityId,
      enabled,
      targetType,
      targetKey,
      matchingStrategy,
      completionThreshold,
      pollIntervalMinutes,
      lookbackHours,
      stopAfterHours,
    ]
  );

  return requireRow(rows[0] as PacsAutoCompletionSettingRow | undefined, "Failed to save PACS auto-completion setting.");
}

async function findLatestEligibleBookingForSetting(modalityId: number, setting: PacsAutoCompletionSettingRow): Promise<EligibleBookingRow | null> {
  const { rows } = await pool.query(
    `
      select
        b.id,
        b.modality_id,
        ('V2-' || lpad(b.id::text, 6, '0')) as accession_number,
        b.study_instance_uid,
        b.booking_date::text as appointment_date,
        b.booking_date::text as booking_date,
        b.status,
        m.code as modality_code,
        p.national_id,
        p.mrn,
        p.identifier_value as patient_primary_id,
        s.id as setting_id,
        s.enabled,
        s.orthanc_target_type,
        s.orthanc_target_key,
        s.matching_strategy,
        s.completion_threshold,
        s.poll_interval_minutes,
        s.lookback_hours,
        s.stop_after_hours
      from appointments_v2.bookings b
      join patients p on p.id = b.patient_id
      join modalities m on m.id = b.modality_id
      join appointments_v2.pacs_auto_completion_settings s on s.modality_id = b.modality_id
      where b.modality_id = $1
        and b.status = any($2::text[])
      order by b.booking_date desc, b.id desc
      limit 1
    `,
    [modalityId, ELIGIBLE_BOOKING_STATUSES]
  );

  if (rows[0]) {
    return rows[0] as EligibleBookingRow;
  }

  return {
    id: 0,
    modality_id: modalityId,
    accession_number: formatV2AccessionNumber(0),
    study_instance_uid: null,
    appointment_date: "",
    booking_date: "",
    status: "scheduled",
    modality_code: "",
    national_id: null,
    mrn: null,
    patient_primary_id: null,
    setting_id: setting.id,
    enabled: setting.enabled,
    orthanc_target_type: setting.orthanc_target_type,
    orthanc_target_key: setting.orthanc_target_key,
    matching_strategy: setting.matching_strategy,
    completion_threshold: setting.completion_threshold,
    poll_interval_minutes: setting.poll_interval_minutes,
    lookback_hours: setting.lookback_hours,
    stop_after_hours: setting.stop_after_hours,
  };
}

async function getSettingForModality(modalityId: number | string): Promise<PacsAutoCompletionSettingRow> {
  const cleanModalityId = normalizePositiveInteger(modalityId, "modalityId");
  const { rows } = await pool.query(
    `
      select *
      from appointments_v2.pacs_auto_completion_settings
      where modality_id = $1
      limit 1
    `,
    [cleanModalityId]
  );
  return requireRow(rows[0] as PacsAutoCompletionSettingRow | undefined, "PACS auto-completion is not configured for this modality.");
}

async function insertVerificationHistory({
  booking,
  setting,
  result,
  completedBooking,
  client = pool,
}: {
  booking: OrthancBookingVerificationContext;
  setting: OrthancAutoCompletionSettingLike;
  result: OrthancVerificationResult;
  completedBooking: boolean;
  client?: Pick<typeof pool, "query"> | PoolClient;
}): Promise<VerificationHistoryRow> {
  const bookingId = Number(booking.id);
  const modalityId = Number(booking.modality_id || setting.modality_id);
  const { rows } = await client.query(
    `
      insert into appointments_v2.pacs_auto_completion_verification_history (
        booking_id,
        modality_id,
        setting_id,
        orthanc_target_type,
        orthanc_target_key,
        match_key,
        match_value,
        result_status,
        result_json,
        series_count,
        instance_count,
        last_error,
        completed_booking
      )
      values ($1, $2, $3, $4, nullif($5, ''), $6, $7, $8, $9::jsonb, $10, $11, $12, $13)
      returning *
    `,
    [
      Number.isInteger(bookingId) && bookingId > 0 ? bookingId : null,
      Number.isInteger(modalityId) && modalityId > 0 ? modalityId : null,
      setting.id ?? null,
      setting.orthanc_target_type,
      setting.orthanc_target_key || "",
      result.matchKey,
      result.matchValue,
      result.status,
      JSON.stringify(result.resultJson ?? {}),
      result.seriesCount,
      result.instanceCount,
      result.lastError,
      completedBooking,
    ]
  );

  return requireRow(rows[0] as VerificationHistoryRow | undefined, "Failed to write PACS verification history.");
}

async function updateSettingLastCheck(
  settingId: number | null | undefined,
  result: OrthancVerificationResult,
  client: Pick<typeof pool, "query"> | PoolClient = pool
): Promise<void> {
  if (!settingId) return;
  await client.query(
    `
      update appointments_v2.pacs_auto_completion_settings
      set
        last_check_status = $2,
        last_check_result_json = $3::jsonb,
        last_error = $4,
        last_checked_at = now(),
        updated_at = now()
      where id = $1
    `,
    [settingId, result.status, JSON.stringify(result.resultJson ?? {}), result.lastError]
  );
}

async function markHistoryCompleted(historyId: number, client: PoolClient): Promise<void> {
  await client.query(
    `
      update appointments_v2.pacs_auto_completion_verification_history
      set completed_booking = true
      where id = $1
    `,
    [historyId]
  );
}

async function completeBookingIfStillEligible({
  booking,
  setting,
  result,
  historyId,
}: {
  booking: OrthancBookingVerificationContext;
  setting: OrthancAutoCompletionSettingLike;
  result: OrthancVerificationResult;
  historyId: number;
}): Promise<boolean> {
  if (result.status !== "matched") {
    return false;
  }

  const bookingId = Number(booking.id);
  if (!Number.isInteger(bookingId) || bookingId <= 0) {
    return false;
  }

  const client = await pool.connect();
  try {
    await client.query("begin");
    const { rows } = await client.query<{ id: number; status: string }>(
      `
        select id, status
        from appointments_v2.bookings
        where id = $1
        for update
      `,
      [bookingId]
    );
    const current = rows[0];
    if (!current || !ELIGIBLE_BOOKING_STATUSES.includes(current.status as typeof ELIGIBLE_BOOKING_STATUSES[number])) {
      await client.query("commit");
      return false;
    }

    await client.query(
      `
        update appointments_v2.bookings
        set
          status = 'completed',
          auto_completed_by = 'orthanc_pacs_auto_completion',
          auto_completed_at = now(),
          auto_completion_check_id = $2,
          updated_at = now(),
          updated_by_user_id = null
        where id = $1
      `,
      [bookingId, historyId]
    );

    await markHistoryCompleted(historyId, client);

    await logAuditEntry(
      {
        entityType: "appointments_v2_booking",
        entityId: bookingId,
        actionType: "orthanc_auto_complete",
        oldValues: { status: current.status },
        newValues: {
          status: "completed",
          orthancTargetType: setting.orthanc_target_type,
          orthancTargetKey: setting.orthanc_target_key || null,
          matchKey: result.matchKey,
          matchValue: result.matchValue,
          studyInstanceUid: result.studyInstanceUid,
          accessionNumber: result.accessionNumber,
          seriesCount: result.seriesCount,
          instanceCount: result.instanceCount,
          verificationCheckId: historyId,
        },
        changedByUserId: null,
      },
      client
    );

    await client.query("commit");
    scheduleBookingWorklistSync(bookingId);
    return true;
  } catch (error) {
    await client.query("rollback");
    throw error;
  } finally {
    client.release();
  }
}

async function runVerificationForBooking(booking: EligibleBookingRow): Promise<{ result: OrthancVerificationResult; history: VerificationHistoryRow; completed: boolean }> {
  const setting = mapSetting({ ...booking, id: booking.setting_id });
  const result = await verifyBookingStudyWithOrthanc(mapBooking(booking), setting);
  const history = await insertVerificationHistory({
    booking: mapBooking(booking),
    setting,
    result,
    completedBooking: false,
  });
  await updateSettingLastCheck(setting.id, result);
  const completed = await completeBookingIfStillEligible({
    booking: mapBooking(booking),
    setting,
    result,
    historyId: history.id,
  });

  return { result, history, completed };
}

export async function testPacsAutoCompletionForModality({
  modalityId,
  bookingId,
}: {
  modalityId: number | string;
  bookingId?: number | string | null;
}): Promise<{ result: OrthancVerificationResult; history: VerificationHistoryRow; bookingId: number | null; diagnostics: PacsAutoCompletionTestDiagnostics }> {
  const cleanModalityId = normalizePositiveInteger(modalityId, "modalityId");
  if (!cleanModalityId) {
    throw new HttpError(400, "modalityId is required.");
  }
  const setting = await getSettingForModality(cleanModalityId);

  let booking: EligibleBookingRow | null = null;
  if (bookingId) {
    const cleanBookingId = normalizeTestBookingId(bookingId);
    if (!cleanBookingId) {
      throw new HttpError(400, "bookingId is required.");
    }
    const { rows } = await pool.query(
      `
        select
          b.id,
          b.modality_id,
          ('V2-' || lpad(b.id::text, 6, '0')) as accession_number,
          b.study_instance_uid,
          b.booking_date::text as appointment_date,
          b.booking_date::text as booking_date,
          b.status,
          m.code as modality_code,
          p.national_id,
          p.mrn,
          p.identifier_value as patient_primary_id,
          s.id as setting_id,
          s.enabled,
          s.orthanc_target_type,
          s.orthanc_target_key,
          s.matching_strategy,
          s.completion_threshold,
          s.poll_interval_minutes,
          s.lookback_hours,
          s.stop_after_hours
        from appointments_v2.bookings b
        join patients p on p.id = b.patient_id
        join modalities m on m.id = b.modality_id
        join appointments_v2.pacs_auto_completion_settings s on s.modality_id = b.modality_id
        where b.id = $1
          and b.modality_id = $2
        limit 1
      `,
      [cleanBookingId, cleanModalityId]
    );
    booking = rows[0] as EligibleBookingRow | undefined ?? null;
  } else {
    booking = await findLatestEligibleBookingForSetting(cleanModalityId, setting);
  }

  if (!booking || !booking.id) {
    throw new HttpError(404, "No V2 booking is available to test for this modality.");
  }

  const result = await verifyBookingStudyWithOrthanc(mapBooking(booking), mapSetting(setting));
  const history = await insertVerificationHistory({
    booking: mapBooking(booking),
    setting: mapSetting(setting),
    result,
    completedBooking: false,
  });
  await updateSettingLastCheck(setting.id, result);

  return {
    result,
    history,
    bookingId: Number(booking.id),
    diagnostics: buildTestDiagnostics(booking, setting, result),
  };
}

export async function listPacsAutoCompletionTargets(): Promise<{ targets: OrthancVerificationTarget[] }> {
  return { targets: await listOrthancVerificationTargets() };
}

async function claimEligibleBookings(batchSize: number): Promise<EligibleBookingRow[]> {
  const { rows } = await pool.query(
    `
      select
        b.id,
        b.modality_id,
        ('V2-' || lpad(b.id::text, 6, '0')) as accession_number,
        b.study_instance_uid,
        b.booking_date::text as appointment_date,
        b.booking_date::text as booking_date,
        b.status,
        m.code as modality_code,
        p.national_id,
        p.mrn,
        p.identifier_value as patient_primary_id,
        s.id as setting_id,
        s.enabled,
        s.orthanc_target_type,
        s.orthanc_target_key,
        s.matching_strategy,
        s.completion_threshold,
        s.poll_interval_minutes,
        s.lookback_hours,
        s.stop_after_hours
      from appointments_v2.bookings b
      join patients p on p.id = b.patient_id
      join modalities m on m.id = b.modality_id
      join appointments_v2.pacs_auto_completion_settings s on s.modality_id = b.modality_id
      where s.enabled = true
        and b.status = any($1::text[])
        and b.booking_date::timestamptz <= now()
        and b.booking_date::timestamptz >= now() - make_interval(hours => s.lookback_hours)
        and b.booking_date::timestamptz >= now() - make_interval(hours => s.stop_after_hours)
        and not exists (
          select 1
          from appointments_v2.pacs_auto_completion_verification_history h
          where h.booking_id = b.id
            and h.created_at > now() - make_interval(mins => s.poll_interval_minutes)
        )
      order by b.booking_date desc, b.id desc
      limit $2
    `,
    [ELIGIBLE_BOOKING_STATUSES, batchSize]
  );

  return rows as EligibleBookingRow[];
}

export async function runAppointmentsV2PacsAutoCompletionTick(options: { batchSize?: number } = {}): Promise<{ checked: number; completed: number }> {
  if (workerTickRunning || workerStopped) {
    return { checked: 0, completed: 0 };
  }

  workerTickRunning = true;
  let completed = 0;
  try {
    const bookings = await claimEligibleBookings(Math.max(1, options.batchSize ?? DEFAULT_BATCH_SIZE));
    for (const booking of bookings) {
      try {
        const result = await runVerificationForBooking(booking);
        if (result.completed) completed += 1;
      } catch (error) {
        console.warn(
          JSON.stringify({
            type: "appointments_v2_pacs_auto_completion_check_failed",
            bookingId: booking.id,
            modalityId: booking.modality_id,
            error: error instanceof Error ? error.message : String(error),
          })
        );
      }
    }
    return { checked: bookings.length, completed };
  } finally {
    workerTickRunning = false;
  }
}

export async function startAppointmentsV2PacsAutoCompletionWorker(options?: {
  intervalMs?: number;
  batchSize?: number;
}): Promise<AppointmentsV2PacsAutoCompletionWorker> {
  const intervalMs = Math.max(10_000, options?.intervalMs ?? DEFAULT_WORKER_INTERVAL_MS);
  const batchSize = Math.max(1, options?.batchSize ?? DEFAULT_BATCH_SIZE);
  workerStopped = false;

  await runAppointmentsV2PacsAutoCompletionTick({ batchSize }).catch((error) => {
    console.warn(
      JSON.stringify({
        type: "appointments_v2_pacs_auto_completion_startup_tick_failed",
        error: error instanceof Error ? error.message : String(error),
      })
    );
  });

  workerIntervalHandle = setInterval(() => {
    void runAppointmentsV2PacsAutoCompletionTick({ batchSize }).catch((error) => {
      console.warn(
        JSON.stringify({
          type: "appointments_v2_pacs_auto_completion_tick_failed",
          error: error instanceof Error ? error.message : String(error),
        })
      );
    });
  }, intervalMs);
  workerIntervalHandle.unref();

  return {
    async stop() {
      workerStopped = true;
      if (workerIntervalHandle) {
        clearInterval(workerIntervalHandle);
        workerIntervalHandle = null;
      }
      while (workerTickRunning) {
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
    },
  };
}
