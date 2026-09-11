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
  type BelowMinimumSeriesAction,
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
import {
  applyBookingTerminalTransition,
  runBookingTerminalTransitionPostCommit,
} from "../modules/appointments-v2/booking/services/booking-terminal-transition.service.js";

const PACS_START_ELIGIBLE_STATUSES = ["scheduled", "arrived", "waiting"] as const;
const PACS_INACTIVITY_COMPLETION_MINUTES = 10;
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
  minimum_series_count: number;
  below_minimum_series_action: BelowMinimumSeriesAction;
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
  acquisition_status_source: "pacs" | "mpps" | null;
  pacs_auto_completion_disabled_at: string | null;
  pacs_last_activity_at: string | null;
  pacs_last_observed_instance_count: number | null;
  pacs_last_observed_series_count: number | null;
  pacs_last_observed_orthanc_update_at: string | null;
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
  minimum_series_count: number;
  below_minimum_series_action: BelowMinimumSeriesAction;
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
  minimumSeriesCount: number;
  belowMinimumSeriesAction: BelowMinimumSeriesAction;
  lastError: string | null;
  legacyRawAccessionFallbackUsed: boolean;
}

export interface AppointmentsV2PacsAutoCompletionWorker {
  stop(): Promise<void>;
}

let workerIntervalHandle: NodeJS.Timeout | null = null;
let workerTickRunning = false;
let workerStopped = false;
let schedulePacsStartWorklistSync: typeof scheduleBookingWorklistSync = scheduleBookingWorklistSync;

export function __setPacsStartWorklistSyncForTests(sync: typeof scheduleBookingWorklistSync): void {
  schedulePacsStartWorklistSync = sync;
}

export function __resetPacsStartWorklistSyncForTests(): void {
  schedulePacsStartWorklistSync = scheduleBookingWorklistSync;
}

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

function normalizeBelowMinimumSeriesAction(value: unknown): BelowMinimumSeriesAction {
  const clean = normalizeOptionalText(value) || "leave_unchanged";
  if (clean === "leave_unchanged" || clean === "discontinue") return clean;
  throw new HttpError(400, "belowMinimumSeriesAction must be leave_unchanged or discontinue.");
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
    minimum_series_count: row.minimum_series_count,
    below_minimum_series_action: row.below_minimum_series_action,
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
    minimumSeriesCount: Number(setting.minimum_series_count || 2),
    belowMinimumSeriesAction: setting.below_minimum_series_action,
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
        coalesce(s.minimum_series_count, 2) as minimum_series_count,
        coalesce(s.below_minimum_series_action, 'leave_unchanged') as below_minimum_series_action,
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
  const minimumSeriesCount = normalizePositive(payload.minimumSeriesCount ?? payload.minimum_series_count, "minimumSeriesCount", 2);
  const belowMinimumSeriesAction = normalizeBelowMinimumSeriesAction(payload.belowMinimumSeriesAction ?? payload.below_minimum_series_action);
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
        minimum_series_count,
        below_minimum_series_action,
        poll_interval_minutes,
        lookback_hours,
        stop_after_hours,
        updated_at
      )
      values ($1, $2, $3, nullif($4, ''), $5, $6, $7, $8, $9, $10, $11, now())
      on conflict (modality_id) do update
      set
        enabled = excluded.enabled,
        orthanc_target_type = excluded.orthanc_target_type,
        orthanc_target_key = excluded.orthanc_target_key,
        matching_strategy = excluded.matching_strategy,
        completion_threshold = excluded.completion_threshold,
        minimum_series_count = excluded.minimum_series_count,
        below_minimum_series_action = excluded.below_minimum_series_action,
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
      minimumSeriesCount,
      belowMinimumSeriesAction,
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
        b.acquisition_status_source,
        b.pacs_auto_completion_disabled_at,
        b.pacs_last_activity_at,
        b.pacs_last_observed_instance_count,
        b.pacs_last_observed_series_count,
        b.pacs_last_observed_orthanc_update_at,
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
        s.minimum_series_count,
        s.below_minimum_series_action,
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
    [modalityId, PACS_START_ELIGIBLE_STATUSES]
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
    acquisition_status_source: null,
    pacs_auto_completion_disabled_at: null,
    pacs_last_activity_at: null,
    pacs_last_observed_instance_count: null,
    pacs_last_observed_series_count: null,
    pacs_last_observed_orthanc_update_at: null,
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
    minimum_series_count: setting.minimum_series_count,
    below_minimum_series_action: setting.below_minimum_series_action,
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

function isBelowMinimumSeriesResult(result: OrthancVerificationResult): boolean {
  return result.status === "insufficient_evidence" && result.lastError === "series_count_below_minimum";
}

function isPacsStartEligible(status: string): status is typeof PACS_START_ELIGIBLE_STATUSES[number] {
  return PACS_START_ELIGIBLE_STATUSES.includes(status as typeof PACS_START_ELIGIBLE_STATUSES[number]);
}

function isSafePacsStartObservation(result: OrthancVerificationResult): boolean {
  return result.instanceCount !== 0 &&
    (result.status === "matched" || isBelowMinimumSeriesResult(result));
}

function isTrackablePacsObservation(result: OrthancVerificationResult): boolean {
  return result.status === "matched" || isBelowMinimumSeriesResult(result) ||
    (result.status === "insufficient_evidence" && result.lastError === "instance_count_zero");
}

function hasMeasurablePacsActivity(result: OrthancVerificationResult): boolean {
  return result.instanceCount != null || result.seriesCount != null || result.orthancLastUpdateAt != null;
}

function pacsActivityChanged(
  current: Pick<EligibleBookingRow, "pacs_last_observed_instance_count" | "pacs_last_observed_series_count" | "pacs_last_observed_orthanc_update_at">,
  result: OrthancVerificationResult
): boolean {
  return current.pacs_last_observed_instance_count !== result.instanceCount ||
    current.pacs_last_observed_series_count !== result.seriesCount ||
    !samePacsTimestamp(current.pacs_last_observed_orthanc_update_at, result.orthancLastUpdateAt);
}

function samePacsTimestamp(left: unknown, right: unknown): boolean {
  if (left == null || right == null) return left == null && right == null;
  const leftTime = new Date(left instanceof Date ? left : String(left)).getTime();
  const rightTime = new Date(right instanceof Date ? right : String(right)).getTime();
  if (Number.isFinite(leftTime) && Number.isFinite(rightTime)) return leftTime === rightTime;
  return String(left) === String(right);
}

async function processPacsObservation({
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
  const bookingId = Number(booking.id);
  if (!Number.isInteger(bookingId) || bookingId <= 0) {
    return false;
  }

  const client = await pool.connect();
  let terminalTransition: Awaited<ReturnType<typeof applyBookingTerminalTransition>> | null = null;
  let targetStatus: "completed" | "discontinued" | null = null;
  let started = false;
  try {
    await client.query("begin");
    const { rows } = await client.query<Pick<EligibleBookingRow,
      "id" | "status" | "acquisition_status_source" | "pacs_auto_completion_disabled_at" |
      "pacs_last_activity_at" | "pacs_last_observed_instance_count" | "pacs_last_observed_series_count" |
      "pacs_last_observed_orthanc_update_at"
    > & { pacs_inactivity_elapsed: boolean }>(
      `
        select
          id,
          status,
          acquisition_status_source,
          pacs_auto_completion_disabled_at,
          pacs_last_activity_at,
          pacs_last_observed_instance_count,
          pacs_last_observed_series_count,
          pacs_last_observed_orthanc_update_at,
          (
            pacs_last_activity_at is not null
            and current_timestamp >= pacs_last_activity_at + make_interval(mins => $2::int)
          ) as pacs_inactivity_elapsed
        from appointments_v2.bookings
        where id = $1
        for update
      `,
      [bookingId, PACS_INACTIVITY_COMPLETION_MINUTES]
    );
    const current = rows[0];
    if (
      !current ||
      current.pacs_auto_completion_disabled_at
    ) {
      await client.query("commit");
      return false;
    }

    if (isPacsStartEligible(current.status)) {
      if (!isSafePacsStartObservation(result)) {
        await client.query("commit");
        return false;
      }
      await client.query(
        `
          update appointments_v2.bookings
          set
            status = 'in-progress',
            acquisition_status_source = 'pacs',
            pacs_last_activity_at = now(),
            pacs_last_observed_instance_count = $2,
            pacs_last_observed_series_count = $3,
            pacs_last_observed_orthanc_update_at = $4::timestamptz,
            pacs_study_started_at = coalesce(pacs_study_started_at, $5::timestamptz),
            pacs_first_seen_at = coalesce(pacs_first_seen_at, $6::timestamptz),
            pacs_timing_source = $7,
            pacs_timing_confidence = $8,
            pacs_timing_checked_at = now(),
            updated_at = now(),
            updated_by_user_id = null
          where id = $1
        `,
        [bookingId, result.instanceCount, result.seriesCount, result.orthancLastUpdateAt, result.studyStartedAt, result.pacsFirstSeenAt, result.timingSource, result.timingConfidence]
      );
      await logAuditEntry({
        entityType: "appointment_v2_booking",
        entityId: bookingId,
        actionType: "orthanc_auto_start",
        oldValues: { status: current.status },
        newValues: {
          status: "in-progress",
          acquisitionStatusSource: "pacs",
          matchKey: result.matchKey,
          matchValue: result.matchValue,
          studyInstanceUid: result.studyInstanceUid,
          accessionNumber: result.accessionNumber,
          seriesCount: result.seriesCount,
          instanceCount: result.instanceCount,
          orthancLastUpdateAt: result.orthancLastUpdateAt,
          verificationCheckId: historyId,
        },
        changedByUserId: null,
      }, client);
      started = true;
    } else if (current.status === "in-progress" && current.acquisition_status_source === "pacs") {
      if (!isTrackablePacsObservation(result)) {
        await client.query("commit");
        return false;
      }
      const activityChanged = pacsActivityChanged(current, result);
      await client.query(
        `
          update appointments_v2.bookings
          set
            pacs_last_activity_at = case when $2 then now() else pacs_last_activity_at end,
            pacs_last_observed_instance_count = $3,
            pacs_last_observed_series_count = $4,
            pacs_last_observed_orthanc_update_at = $5::timestamptz,
            pacs_study_started_at = coalesce(pacs_study_started_at, $6::timestamptz),
            pacs_first_seen_at = coalesce(pacs_first_seen_at, $7::timestamptz),
            pacs_timing_source = $8,
            pacs_timing_confidence = $9,
            pacs_timing_checked_at = now(),
            updated_at = now(),
            updated_by_user_id = null
          where id = $1
        `,
        [bookingId, activityChanged, result.instanceCount, result.seriesCount, result.orthancLastUpdateAt, result.studyStartedAt, result.pacsFirstSeenAt, result.timingSource, result.timingConfidence]
      );

      if (!activityChanged && hasMeasurablePacsActivity(result) && current.pacs_inactivity_elapsed) {
        targetStatus = isBelowMinimumSeriesResult(result)
          ? "discontinued"
          : result.status === "matched" && result.instanceCount !== 0
            ? "completed"
            : null;
        if (targetStatus === "discontinued" && setting.below_minimum_series_action !== "discontinue") {
          targetStatus = null;
        }
        if (targetStatus) {
          if (targetStatus === "completed") {
            await client.query(
              `
                update appointments_v2.bookings
                set
                  auto_completed_by = 'orthanc_pacs_auto_completion',
                  auto_completed_at = now(),
                  auto_completion_check_id = $2,
                  pacs_last_observed_instance_count = $3,
                  pacs_last_observed_series_count = $4,
                  pacs_last_observed_orthanc_update_at = $5::timestamptz,
                  pacs_timing_checked_at = now()
                where id = $1
              `,
              [bookingId, historyId, result.instanceCount, result.seriesCount, result.orthancLastUpdateAt]
            );
          }
          terminalTransition = await applyBookingTerminalTransition({
            client,
            bookingId,
            previousStatus: current.status,
            targetStatus,
            actorUserId: null,
            source: "pacs",
            auditReason: targetStatus === "discontinued"
              ? "Orthanc study activity remained below the configured minimum after PACS inactivity."
              : null,
            auditNewValues: {
              orthancTargetType: setting.orthanc_target_type,
              orthancTargetKey: setting.orthanc_target_key || null,
              matchKey: result.matchKey,
              matchValue: result.matchValue,
              studyInstanceUid: result.studyInstanceUid,
              accessionNumber: result.accessionNumber,
              seriesCount: result.seriesCount,
              instanceCount: result.instanceCount,
              orthancLastUpdateAt: result.orthancLastUpdateAt,
              pacsStudyStartedAt: result.studyStartedAt,
              pacsFirstSeenAt: result.pacsFirstSeenAt,
              pacsTimingSource: result.timingSource,
              pacsTimingConfidence: result.timingConfidence,
              verificationCheckId: historyId,
            },
          });
          if (targetStatus === "completed") {
            await markHistoryCompleted(historyId, client);
          }
        }
      }
    } else {
      await client.query("commit");
      return false;
    }

    await client.query("commit");
    if (started) {
      try {
        schedulePacsStartWorklistSync(bookingId);
      } catch (error) {
        console.error(JSON.stringify({
          type: "appointments_v2_pacs_auto_start_worklist_sync_schedule_failed",
          bookingId,
          error: error instanceof Error ? error.message : String(error),
        }));
      }
    }
    if (terminalTransition?.transitioned && targetStatus) {
      await runBookingTerminalTransitionPostCommit({
        bookingId,
        targetStatus,
        actorUserId: null,
        reportingIntentNotification: terminalTransition.reportingIntentNotification,
      });
      return targetStatus === "completed";
    }
    return false;
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
  const completed = await processPacsObservation({
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
          b.acquisition_status_source,
          b.pacs_auto_completion_disabled_at,
          b.pacs_last_activity_at,
          b.pacs_last_observed_instance_count,
          b.pacs_last_observed_series_count,
          b.pacs_last_observed_orthanc_update_at,
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
          s.minimum_series_count,
          s.below_minimum_series_action,
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
        b.acquisition_status_source,
        b.pacs_auto_completion_disabled_at,
        b.pacs_last_activity_at,
        b.pacs_last_observed_instance_count,
        b.pacs_last_observed_series_count,
        b.pacs_last_observed_orthanc_update_at,
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
        s.minimum_series_count,
        s.below_minimum_series_action,
        s.poll_interval_minutes,
        s.lookback_hours,
        s.stop_after_hours
      from appointments_v2.bookings b
      join patients p on p.id = b.patient_id
      join modalities m on m.id = b.modality_id
      join appointments_v2.pacs_auto_completion_settings s on s.modality_id = b.modality_id
      where s.enabled = true
        and b.pacs_auto_completion_disabled_at is null
        and (
          b.status = any($1::text[])
          or (
            b.status = 'in-progress'
            and b.acquisition_status_source = 'pacs'
          )
        )
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
    [PACS_START_ELIGIBLE_STATUSES, batchSize]
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
