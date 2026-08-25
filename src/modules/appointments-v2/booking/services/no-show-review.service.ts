import type { PoolClient } from "pg";
import { pool } from "../../../../db/pool.js";
import { logAuditEntry } from "../../../../services/audit-service.js";
import { scheduleBookingWorklistSync } from "../../../../services/dicom-service.js";
import { activateNoShowRestrictionForBooking } from "../../../../services/patient-no-show-restriction-service.js";
import { SchedulingError } from "../../shared/errors/scheduling-error.js";

const DEFAULT_REVIEW_TIME = "17:00";
const DEFAULT_GRACE_MINUTES = 30;
const DEFAULT_CLEANUP_DAYS = 1;
const MAX_BATCH_SIZE = 100;

type NoShowMode = "manual" | "automatic" | "disabled";

interface SettingRow { setting_key: string; setting_value?: { value?: unknown } | null; }
interface BookingRow {
  id: number | string; patient_id: number | string; status: string; booking_date: string;
  booking_time: string | null; arrived_at: string | null; waiting_started_at: string | null;
  accession_number?: string; arabic_full_name?: string; english_full_name?: string | null;
  phone_1?: string | null; modality_name_ar?: string; modality_name_en?: string;
  exam_name_ar?: string | null; exam_name_en?: string | null;
}

export interface NoShowSettings {
  reviewTime: string;
  reviewActive: boolean;
  graceMinutes: number;
  cleanupDays: number;
  mode: NoShowMode;
  autoNoShowEnabled: boolean;
  manualConfirmationRequired: boolean;
}

export interface NoShowEligibility { eligible: boolean; scope: "today" | "historical" | null; reasonCode: string; message: string; }

function tripoliParts(now = new Date()): Record<string, string> {
  return Object.fromEntries(new Intl.DateTimeFormat("en-CA", {
    timeZone: "Africa/Tripoli", year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", hour12: false,
  }).formatToParts(now).map((part) => [part.type, part.value]));
}

export function getTripoliToday(now = new Date()): string {
  const p = tripoliParts(now); return `${p.year}-${p.month}-${p.day}`;
}

export function historicalNoShowCutoff(today: string, cleanupDays: number): string | null {
  if (cleanupDays <= 0) return null;
  const date = new Date(`${today}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() - cleanupDays);
  return date.toISOString().slice(0, 10);
}

function tripoliMinutes(now = new Date()): number {
  const p = tripoliParts(now); return Number(p.hour) * 60 + Number(p.minute);
}

export function parseNoShowTime(value: unknown, fallback = DEFAULT_REVIEW_TIME): number {
  const match = String(value || fallback).trim().match(/^(\d{1,2}):(\d{2})/);
  if (!match) return parseNoShowTime(fallback, DEFAULT_REVIEW_TIME);
  const hours = Number(match[1]); const minutes = Number(match[2]);
  return hours >= 0 && hours <= 23 && minutes >= 0 && minutes <= 59 ? hours * 60 + minutes : parseNoShowTime(fallback, DEFAULT_REVIEW_TIME);
}

function settingValue(rows: SettingRow[], key: string, fallback: unknown): unknown {
  return rows.find((row) => row.setting_key === key)?.setting_value?.value ?? fallback;
}
function enabled(value: unknown, fallback = false): boolean {
  const clean = String(value ?? (fallback ? "enabled" : "disabled")).trim().toLowerCase();
  return ["enabled", "on", "true", "yes", "1", "required"].includes(clean);
}
function boundedInt(value: unknown, fallback: number, max: number): number {
  const parsed = Number(String(value ?? fallback).trim());
  return Number.isFinite(parsed) ? Math.max(0, Math.min(max, Math.floor(parsed))) : fallback;
}

/** The safe normalization is manual authority when a legacy configuration is contradictory. */
export function normalizeNoShowMode(manualRequested: boolean, automaticRequested: boolean): NoShowMode {
  if (manualRequested) return "manual";
  if (automaticRequested) return "automatic";
  return "disabled";
}

export async function getNoShowSettings(now = new Date()): Promise<NoShowSettings> {
  const { rows } = await pool.query<SettingRow>(`
    select setting_key, setting_value from system_settings
    where category = 'queue_and_arrival' and setting_key in
      ('no_show_review_time', 'auto_no_show_enabled', 'no_show_confirmation_required', 'auto_no_show_cleanup_days', 'no_show_grace_minutes')
  `);
  const reviewTime = String(settingValue(rows, "no_show_review_time", DEFAULT_REVIEW_TIME) || DEFAULT_REVIEW_TIME);
  const mode = normalizeNoShowMode(
    enabled(settingValue(rows, "no_show_confirmation_required", "enabled"), true),
    enabled(settingValue(rows, "auto_no_show_enabled", "disabled"), false),
  );
  return {
    reviewTime, reviewActive: tripoliMinutes(now) >= parseNoShowTime(reviewTime),
    graceMinutes: boundedInt(settingValue(rows, "no_show_grace_minutes", DEFAULT_GRACE_MINUTES), DEFAULT_GRACE_MINUTES, 720),
    cleanupDays: boundedInt(settingValue(rows, "auto_no_show_cleanup_days", DEFAULT_CLEANUP_DAYS), DEFAULT_CLEANUP_DAYS, 365),
    mode, autoNoShowEnabled: mode === "automatic", manualConfirmationRequired: mode === "manual",
  };
}

export function evaluateNoShowEligibility(booking: Pick<BookingRow, "status" | "booking_date" | "booking_time">, settings: NoShowSettings, now = new Date()): NoShowEligibility {
  if (booking.status === "arrived") return { eligible: false, scope: null, reasonCode: "booking_arrived", message: "The patient has arrived and cannot be marked no-show." };
  if (booking.status === "waiting") return { eligible: false, scope: null, reasonCode: "booking_waiting", message: "The patient is waiting and cannot be marked no-show." };
  if (booking.status === "completed") return { eligible: false, scope: null, reasonCode: "booking_completed", message: "Completed appointments cannot be marked no-show." };
  if (booking.status === "cancelled" || booking.status === "discontinued" || booking.status === "voided") return { eligible: false, scope: null, reasonCode: "booking_cancelled_or_closed", message: "Cancelled or closed appointments cannot be marked no-show." };
  if (booking.status === "no-show") return { eligible: false, scope: null, reasonCode: "already_no_show", message: "This appointment was already marked no-show." };
  if (booking.status !== "scheduled") return { eligible: false, scope: null, reasonCode: "booking_not_scheduled", message: "Only scheduled appointments are eligible for no-show review." };
  const today = getTripoliToday(now);
  if (booking.booking_date > today) return { eligible: false, scope: null, reasonCode: "booking_in_future", message: "Future appointments cannot be marked no-show." };
  if (booking.booking_date < today) {
    const cutoff = historicalNoShowCutoff(today, settings.cleanupDays);
    if (!cutoff) return { eligible: false, scope: "historical", reasonCode: "old_no_show_cleanup_disabled", message: "Historical no-show cleanup is disabled." };
    if (booking.booking_date > cutoff) return { eligible: false, scope: "historical", reasonCode: "cleanup_age_not_elapsed", message: "The configured historical cleanup age has not elapsed." };
    return { eligible: true, scope: "historical", reasonCode: "historical_cleanup_eligible", message: "Eligible for historical no-show cleanup." };
  }
  if (!settings.reviewActive) return { eligible: false, scope: "today", reasonCode: "no_show_review_not_open", message: `No-show review opens at ${settings.reviewTime} Africa/Tripoli time.` };
  if (booking.booking_time && tripoliMinutes(now) < parseNoShowTime(booking.booking_time) + settings.graceMinutes) {
    return { eligible: false, scope: "today", reasonCode: "booking_time_grace_not_elapsed", message: "The booking time plus the configured grace period has not elapsed." };
  }
  return { eligible: true, scope: "today", reasonCode: "eligible", message: "Eligible for no-show review." };
}

function candidateSelect(where: string): string {
  return `select b.id, b.patient_id, b.status, b.booking_date::text, b.booking_time::text, b.arrived_at::text, b.waiting_started_at::text,
    ('V2-' || lpad(b.id::text, 6, '0')) as accession_number, p.arabic_full_name, p.english_full_name, p.phone_1,
    m.name_ar as modality_name_ar, m.name_en as modality_name_en, et.name_ar as exam_name_ar, et.name_en as exam_name_en
    from appointments_v2.bookings b join patients p on p.id = b.patient_id join modalities m on m.id = b.modality_id
    left join exam_types et on et.id = b.exam_type_id ${where}`;
}

function candidateDto(row: BookingRow, eligibility: NoShowEligibility) {
  return { appointment_id: Number(row.id), accession_number: row.accession_number, appointment_date: row.booking_date,
    booking_time: row.booking_time, patient_id: Number(row.patient_id), arabic_full_name: row.arabic_full_name,
    english_full_name: row.english_full_name, phone_1: row.phone_1, modality_name_ar: row.modality_name_ar,
    modality_name_en: row.modality_name_en, exam_name_ar: row.exam_name_ar, exam_name_en: row.exam_name_en,
    arrival_status: row.status === "scheduled" ? "not_checked_in" : row.status, eligibility: eligibility.reasonCode, eligible: eligibility.eligible };
}

async function readWorkerState() {
  try {
    const { rows } = await pool.query(`select last_run_at, last_successful_run_at, last_today_processed_count, last_historical_processed_count, last_skipped_count, last_error from appointments_v2.no_show_worker_state where singleton = true`);
    return rows[0] ?? {};
  } catch (error) {
    console.error(JSON.stringify({ type: "no_show_worker_state_read_failed", error: error instanceof Error ? error.message : String(error) }));
    return {};
  }
}

export async function getNoShowReviewSnapshot(now = new Date()) {
  const settings = await getNoShowSettings(now); const today = getTripoliToday(now);
  const cutoff = historicalNoShowCutoff(today, settings.cleanupDays);
  const [todayRows, oldRows, historicalMeta, workerState] = await Promise.all([
    pool.query<BookingRow>(`${candidateSelect("where b.booking_date = $1::date and b.status = 'scheduled'")} order by b.booking_time nulls last, b.id`, [today]),
    cutoff ? pool.query<BookingRow>(`${candidateSelect("where b.booking_date <= $1::date and b.status = 'scheduled'")} order by b.booking_date, b.booking_time nulls last, b.id limit ${MAX_BATCH_SIZE}`, [cutoff]) : Promise.resolve({ rows: [] as BookingRow[] }),
    cutoff ? pool.query<{ count: string; oldest_date: string | null }>(`select count(*)::text, min(booking_date)::text as oldest_date from appointments_v2.bookings where status = 'scheduled' and booking_date <= $1::date`, [cutoff]) : Promise.resolve({ rows: [{ count: "0", oldest_date: null }] }),
    readWorkerState(),
  ]);
  const classified = todayRows.rows.map((row) => ({ row, eligibility: evaluateNoShowEligibility(row, settings, now) }));
  return {
    mode: settings.mode, review_time: settings.reviewTime, review_active: settings.reviewActive, grace_minutes: settings.graceMinutes,
    auto_no_show_enabled: settings.autoNoShowEnabled, no_show_confirmation_required: settings.manualConfirmationRequired,
    pending_count: settings.mode === "manual" ? classified.filter((item) => item.eligibility.eligible).length : 0,
    candidates: settings.mode === "manual" ? classified.filter((item) => item.eligibility.eligible).map((item) => candidateDto(item.row, item.eligibility)) : [],
    deferred_candidates: classified.filter((item) => !item.eligibility.eligible).map((item) => candidateDto(item.row, item.eligibility)),
    cleanup_days: settings.cleanupDays, historical_cutoff_date: cutoff, old_cleanup_count: Number(historicalMeta.rows[0]?.count ?? 0), oldest_old_cleanup_date: historicalMeta.rows[0]?.oldest_date ?? null,
    old_cleanup_candidates: oldRows.rows.map((row) => candidateDto(row, { eligible: true, scope: "historical", reasonCode: "historical_cleanup_eligible", message: "Historical cleanup candidate." })),
    last_automatic_run_at: workerState.last_run_at ?? null, last_automatic_today_processed_count: Number(workerState.last_today_processed_count ?? 0), last_automatic_historical_processed_count: Number(workerState.last_historical_processed_count ?? 0), last_automatic_skipped_count: Number(workerState.last_skipped_count ?? 0),
    last_automatic_error: workerState.last_error ?? null,
  };
}

async function transitionLockedBooking(client: PoolClient, booking: BookingRow, reason: string, actorUserId: number | null, actionType: string): Promise<void> {
  await client.query(`update appointments_v2.bookings set status = 'no-show', updated_at = now(), updated_by_user_id = $2 where id = $1 and status = 'scheduled'`, [booking.id, actorUserId]);
  await logAuditEntry({ entityType: "appointment_v2_booking", entityId: Number(booking.id), actionType,
    oldValues: { status: booking.status, booking_date: booking.booking_date }, newValues: { status: "no-show", reason }, changedByUserId: actorUserId }, client);
  await activateNoShowRestrictionForBooking(client, Number(booking.id), reason, actorUserId);
}

async function lockBooking(client: PoolClient, bookingId: number): Promise<BookingRow | null> {
  const { rows } = await client.query<BookingRow>(`${candidateSelect("where b.id = $1")} for update of b`, [bookingId]); return rows[0] ?? null;
}

export async function confirmManualNoShow(bookingId: number, reason: string, userId: number, now = new Date()) {
  const cleanReason = String(reason || "").trim(); if (!cleanReason) throw new SchedulingError(400, "A no-show reason is required.", ["status_reason_required"]);
  const settings = await getNoShowSettings(now); if (settings.mode !== "manual") throw new SchedulingError(409, "Manual no-show confirmation is not active.", ["manual_no_show_not_active"]);
  const client = await pool.connect();
  try { await client.query("begin"); const booking = await lockBooking(client, bookingId);
    if (!booking) throw new SchedulingError(404, "Booking not found.", ["booking_not_found"]);
    const eligibility = evaluateNoShowEligibility(booking, settings, now);
    if (!eligibility.eligible) throw new SchedulingError(409, eligibility.message, [eligibility.reasonCode]);
    await transitionLockedBooking(client, booking, cleanReason, userId, "manual_no_show_confirmation"); await client.query("commit");
  } catch (error) { await client.query("rollback"); throw error; } finally { client.release(); }
  scheduleBookingWorklistSync(bookingId); console.info(JSON.stringify({ type: "manual_no_show_confirmation", bookingId, actorUserId: userId }));
  return { confirmed: true, bookingId };
}

async function selectedBatch(ids: unknown): Promise<number[]> {
  if (!Array.isArray(ids)) throw new SchedulingError(400, "Select one or more appointments.", ["no_show_selection_required"]);
  const normalized = [...new Set(ids.map(Number).filter((id) => Number.isInteger(id) && id > 0))];
  if (!normalized.length || normalized.length > MAX_BATCH_SIZE) throw new SchedulingError(400, `Select between 1 and ${MAX_BATCH_SIZE} appointments.`, ["no_show_batch_size_invalid"]);
  return normalized;
}

export async function confirmManualNoShowBulk(ids: unknown, reason: string, userId: number, now = new Date()) {
  const bookingIds = await selectedBatch(ids); const cleanReason = String(reason || "").trim();
  if (!cleanReason) throw new SchedulingError(400, "A no-show reason is required.", ["status_reason_required"]);
  const settings = await getNoShowSettings(now); if (settings.mode !== "manual") throw new SchedulingError(409, "Manual no-show confirmation is not active.", ["manual_no_show_not_active"]);
  const results: Array<{ bookingId: number; status: "confirmed" | "skipped" | "failed"; reason: string }> = []; const confirmed: number[] = [];
  const client = await pool.connect();
  try { await client.query("begin");
    for (const bookingId of bookingIds) {
      try { const booking = await lockBooking(client, bookingId); if (!booking) { results.push({ bookingId, status: "failed", reason: "booking_not_found" }); continue; }
        const eligibility = evaluateNoShowEligibility(booking, settings, now); if (!eligibility.eligible) { results.push({ bookingId, status: "skipped", reason: eligibility.reasonCode }); continue; }
        await transitionLockedBooking(client, booking, cleanReason, userId, "manual_no_show_bulk_confirmation"); confirmed.push(bookingId); results.push({ bookingId, status: "confirmed", reason: "confirmed" });
      } catch (error) { results.push({ bookingId, status: "failed", reason: error instanceof Error ? error.message : "transition_failed" }); }
    }
    await client.query("commit");
  } catch (error) { await client.query("rollback"); throw error; } finally { client.release(); }
  confirmed.forEach(scheduleBookingWorklistSync); console.info(JSON.stringify({ type: "manual_no_show_bulk_confirmation", actorUserId: userId, confirmed: confirmed.length, selected: bookingIds.length }));
  return { results, confirmedIds: confirmed };
}

export async function confirmOldNoShowCleanup(ids: unknown, reason: string, userId: number, now = new Date()) {
  const bookingIds = await selectedBatch(ids); const cleanReason = String(reason || "").trim(); if (!cleanReason) throw new SchedulingError(400, "A no-show reason is required.", ["status_reason_required"]);
  const settings = await getNoShowSettings(now); if (settings.cleanupDays <= 0) throw new SchedulingError(409, "Old no-show cleanup is disabled.", ["old_no_show_cleanup_disabled"]);
  const results: Array<{ bookingId: number; status: "confirmed" | "skipped" | "failed"; reason: string }> = []; const confirmed: number[] = []; const client = await pool.connect();
  try { await client.query("begin");
    for (const bookingId of bookingIds) { const booking = await lockBooking(client, bookingId); if (!booking) { results.push({ bookingId, status: "failed", reason: "booking_not_found" }); continue; }
      const eligibility = evaluateNoShowEligibility(booking, settings, now);
      if (!eligibility.eligible || eligibility.scope !== "historical") { results.push({ bookingId, status: "skipped", reason: eligibility.reasonCode }); continue; }
      await transitionLockedBooking(client, booking, cleanReason, userId, "old_no_show_cleanup"); confirmed.push(bookingId); results.push({ bookingId, status: "confirmed", reason: "confirmed" }); }
    await client.query("commit");
  } catch (error) { await client.query("rollback"); throw error; } finally { client.release(); }
  confirmed.forEach(scheduleBookingWorklistSync); console.info(JSON.stringify({ type: "old_no_show_cleanup", actorUserId: userId, confirmed: confirmed.length })); return { results, confirmedIds: confirmed };
}

export async function runManualOldNoShowCleanup(reason: string, userId: number, now = new Date()) {
  const cleanReason = String(reason || "").trim();
  if (!cleanReason) throw new SchedulingError(400, "A no-show reason is required.", ["status_reason_required"]);
  const settings = await getNoShowSettings(now); const cutoff = historicalNoShowCutoff(getTripoliToday(now), settings.cleanupDays);
  if (!cutoff) throw new SchedulingError(409, "Old no-show cleanup is disabled.", ["old_no_show_cleanup_disabled"]);
  const client = await pool.connect(); const processedIds: number[] = []; const skipped: Array<{ bookingId: number; reason: string }> = [];
  try {
    await client.query("begin");
    const { rows } = await client.query<BookingRow>(`${candidateSelect("where b.status = 'scheduled' and b.booking_date <= $1::date")} order by b.booking_date, b.id limit ${MAX_BATCH_SIZE} for update of b skip locked`, [cutoff]);
    for (const booking of rows) {
      const eligibility = evaluateNoShowEligibility(booking, settings, now);
      if (!eligibility.eligible || eligibility.scope !== "historical") { skipped.push({ bookingId: Number(booking.id), reason: eligibility.reasonCode }); continue; }
      await transitionLockedBooking(client, booking, cleanReason, userId, "manual_old_no_show_cleanup_run"); processedIds.push(Number(booking.id));
    }
    await client.query("commit");
  } catch (error) { await client.query("rollback"); throw error; } finally { client.release(); }
  processedIds.forEach(scheduleBookingWorklistSync);
  const remaining = await pool.query<{ count: string; oldest_date: string | null }>(`select count(*)::text, min(booking_date)::text as oldest_date from appointments_v2.bookings where status = 'scheduled' and booking_date <= $1::date`, [cutoff]);
  console.info(JSON.stringify({ type: "manual_old_no_show_cleanup_run", actorUserId: userId, processed: processedIds.length, skipped: skipped.length }));
  return { processedIds, processedCount: processedIds.length, skipped, remainingEligibleCount: Number(remaining.rows[0]?.count ?? 0), oldestRemainingDate: remaining.rows[0]?.oldest_date ?? null, cutoffDate: cutoff };
}

export async function recordNoShowWorkerState(result: { todayProcessedCount: number; historicalProcessedCount: number; skippedCount: number; error?: string | null }) {
  try {
    await pool.query(`insert into appointments_v2.no_show_worker_state (singleton, last_run_at, last_successful_run_at, last_today_processed_count, last_historical_processed_count, last_skipped_count, last_error, updated_at)
      values (true, now(), case when $4::text is null then now() else null end, $1, $2, $3, $4::text, now()) on conflict (singleton) do update set
      last_run_at = now(), last_successful_run_at = case when $4::text is null then now() else appointments_v2.no_show_worker_state.last_successful_run_at end,
      last_today_processed_count = $1, last_historical_processed_count = $2, last_skipped_count = $3, last_error = $4::text, updated_at = now()`, [result.todayProcessedCount, result.historicalProcessedCount, result.skippedCount, result.error ?? null]);
  } catch (error) {
    console.error(JSON.stringify({ type: "no_show_worker_state_write_failed", error: error instanceof Error ? error.message : String(error) }));
  }
}

export async function runAutomaticNoShowProcessing(now = new Date()): Promise<{ processedIds: number[]; todayProcessedCount: number; historicalProcessedCount: number; skippedCount: number; remainingHistoricalCount: number }> {
  const settings = await getNoShowSettings(now);
  if (settings.mode !== "automatic") return { processedIds: [], todayProcessedCount: 0, historicalProcessedCount: 0, skippedCount: 0, remainingHistoricalCount: 0 };
  const today = getTripoliToday(now); const cutoff = historicalNoShowCutoff(today, settings.cleanupDays); const client = await pool.connect(); const processedIds: number[] = []; let todayProcessedCount = 0; let historicalProcessedCount = 0; let skippedCount = 0;
  try { await client.query("begin"); const { rows } = await client.query<BookingRow>(`${candidateSelect("where b.status = 'scheduled' and (b.booking_date = $1::date or ($2::date is not null and b.booking_date <= $2::date))")} order by b.booking_date, b.booking_time nulls last, b.id limit ${MAX_BATCH_SIZE} for update of b skip locked`, [today, cutoff]);
    for (const booking of rows) { const eligibility = evaluateNoShowEligibility(booking, settings, now); if (!eligibility.eligible) { skippedCount++; console.info(JSON.stringify({ type: "automatic_no_show_candidate_skipped", bookingId: Number(booking.id), reason: eligibility.reasonCode })); continue; }
      const historical = eligibility.scope === "historical";
      await transitionLockedBooking(client, booking, historical ? "Automatic historical no-show cleanup." : "Automatic no-show after configured review and grace period.", null, historical ? "automatic_old_no_show_cleanup" : "automatic_no_show");
      processedIds.push(Number(booking.id)); if (historical) historicalProcessedCount++; else todayProcessedCount++; }
    await client.query("commit"); await recordNoShowWorkerState({ todayProcessedCount, historicalProcessedCount, skippedCount });
  } catch (error) { await client.query("rollback"); await recordNoShowWorkerState({ todayProcessedCount: 0, historicalProcessedCount: 0, skippedCount, error: error instanceof Error ? error.message : String(error) }); throw error; } finally { client.release(); }
  processedIds.forEach(scheduleBookingWorklistSync);
  const remaining = cutoff ? await pool.query<{ count: string }>(`select count(*)::text from appointments_v2.bookings where status = 'scheduled' and booking_date <= $1::date`, [cutoff]) : { rows: [{ count: "0" }] };
  console.info(JSON.stringify({ type: "automatic_no_show_run_completed", todayProcessedCount, historicalProcessedCount, skippedCount, remainingHistoricalCount: Number(remaining.rows[0]?.count ?? 0) }));
  return { processedIds, todayProcessedCount, historicalProcessedCount, skippedCount, remainingHistoricalCount: Number(remaining.rows[0]?.count ?? 0) };
}
