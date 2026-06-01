import type { PoolClient } from "pg";
import { pool } from "../../../../db/pool.js";
import { logAuditEntry } from "../../../../services/audit-service.js";
import { scheduleBookingWorklistSync } from "../../../../services/dicom-service.js";
import { safeEnqueuePatientNotificationEvent } from "../../../../services/patient-web-push-service.js";
import { SchedulingError } from "../../shared/errors/scheduling-error.js";
import type { BookingStatus } from "../../shared/types/common.js";
import { activateNoShowRestrictionForBooking } from "../../../../services/patient-no-show-restriction-service.js";
import type { Role } from "../../../../types/domain.js";
import { assertPatientMeetsBookingQueueRequirements } from "./patient-identifier-requirement.js";

const DEFAULT_NO_SHOW_REVIEW_TIME = "17:00";
const DEFAULT_AUTO_NO_SHOW_CLEANUP_DAYS = 1;
const MANUAL_STATUS_TARGETS = new Set<BookingStatus>([
  "scheduled",
  "arrived",
  "waiting",
  "completed",
  "no-show",
  "cancelled",
  "discontinued",
]);
const REASON_REQUIRED_STATUSES = new Set<BookingStatus>(["no-show", "cancelled", "discontinued"]);

interface SettingsRow {
  setting_key: string;
  setting_value?: { value?: unknown } | null;
}

interface BookingStatusRow {
  id: string | number;
  patient_id: string | number;
  status: BookingStatus;
  booking_date?: string;
  auto_completed_by?: string | null;
  auto_completed_at?: string | null;
  pacs_auto_completion_disabled_at?: string | null;
}

export interface QueueNoShowSettings {
  reviewTime: string;
  reviewActive: boolean;
  autoNoShowEnabled: boolean;
  manualConfirmationRequired: boolean;
  cleanupDays: number;
}

function getTripoliParts(): Record<string, string> {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Africa/Tripoli",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(new Date());

  return Object.fromEntries(parts.map((part) => [part.type, part.value]));
}

export function getTripoliToday(): string {
  const parts = getTripoliParts();
  return `${parts.year}-${parts.month}-${parts.day}`;
}

function getTripoliMinutesSinceMidnight(): number {
  const parts = getTripoliParts();
  return Number(parts.hour) * 60 + Number(parts.minute);
}

function parseTimeToMinutes(value: unknown): number {
  const raw = String(value || DEFAULT_NO_SHOW_REVIEW_TIME).trim();
  const match = raw.match(/^(\d{1,2}):(\d{2})$/);
  if (!match) return 17 * 60;
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (hour < 0 || hour > 23 || minute < 0 || minute > 59) return 17 * 60;
  return hour * 60 + minute;
}

function settingValue(rows: SettingsRow[], key: string, fallback: unknown): unknown {
  return rows.find((row) => row.setting_key === key)?.setting_value?.value ?? fallback;
}

function parseEnabled(value: unknown, fallback = true): boolean {
  const clean = String(value ?? (fallback ? "enabled" : "disabled")).trim().toLowerCase();
  return ["enabled", "on", "true", "yes", "1", "required"].includes(clean);
}

function parseCleanupDays(value: unknown): number {
  const days = Number(String(value ?? DEFAULT_AUTO_NO_SHOW_CLEANUP_DAYS).trim());
  if (!Number.isFinite(days) || days < 0) return DEFAULT_AUTO_NO_SHOW_CLEANUP_DAYS;
  return Math.floor(days);
}

export async function getQueueNoShowSettings(): Promise<QueueNoShowSettings> {
  const { rows } = await pool.query<SettingsRow>(
    `
      select setting_key, setting_value
      from system_settings
      where category = 'queue_and_arrival'
        and setting_key in ('no_show_review_time', 'auto_no_show_enabled', 'no_show_confirmation_required', 'auto_no_show_cleanup_days')
    `
  );

  const reviewTime = String(settingValue(rows, "no_show_review_time", DEFAULT_NO_SHOW_REVIEW_TIME) || DEFAULT_NO_SHOW_REVIEW_TIME);
  const manualConfirmationRequired = parseEnabled(settingValue(rows, "no_show_confirmation_required", "enabled"));
  const autoNoShowEnabled = parseEnabled(
    settingValue(rows, "auto_no_show_enabled", manualConfirmationRequired ? "disabled" : "enabled"),
    false
  );
  return {
    reviewTime,
    reviewActive: getTripoliMinutesSinceMidnight() >= parseTimeToMinutes(reviewTime),
    autoNoShowEnabled,
    manualConfirmationRequired,
    cleanupDays: parseCleanupDays(settingValue(rows, "auto_no_show_cleanup_days", DEFAULT_AUTO_NO_SHOW_CLEANUP_DAYS)),
  };
}

async function auditStatusChange(
  client: PoolClient,
  booking: BookingStatusRow,
  nextStatus: BookingStatus,
  reason: string | null,
  userId: number | null,
  actionType: string
): Promise<void> {
  await logAuditEntry(
    {
      entityType: "appointment_v2_booking",
      entityId: Number(booking.id),
      actionType,
      oldValues: { status: booking.status, booking_date: booking.booking_date },
      newValues: { status: nextStatus, reason },
      changedByUserId: userId,
    },
    client
  );
}

export async function updateBookingStatusManual(
  bookingId: number,
  nextStatus: string,
  reason: string | null | undefined,
  userId: number,
  userRole?: Role
): Promise<{
  id: number;
  previousStatus: BookingStatus;
  status: BookingStatus;
  autoCompletionDisabled?: boolean;
  autoCompletionDisabledMessage?: string;
}> {
  if (!MANUAL_STATUS_TARGETS.has(nextStatus as BookingStatus)) {
    throw new SchedulingError(400, "Invalid appointment status.", ["invalid_status"]);
  }

  const cleanReason = String(reason || "").trim();
  const targetStatus = nextStatus as BookingStatus;
  if (REASON_REQUIRED_STATUSES.has(targetStatus) && !cleanReason) {
    throw new SchedulingError(400, "A reason is required for this status change.", ["status_reason_required"]);
  }

  const client = await pool.connect();
  try {
    await client.query("begin");
    const { rows } = await client.query<BookingStatusRow>(
      `
        select
          id,
          patient_id,
          status,
          booking_date::text,
          auto_completed_by,
          auto_completed_at,
          pacs_auto_completion_disabled_at
        from appointments_v2.bookings
        where id = $1
        for update
      `,
      [bookingId]
    );
    const booking = rows[0];
    if (!booking) {
      throw new SchedulingError(404, `Booking ${bookingId} not found.`, ["booking_not_found"]);
    }
    if (booking.status === "voided" || targetStatus === "voided") {
      throw new SchedulingError(409, "Voided bookings cannot be changed from manual status management.", ["manual_status_voided_rejected"]);
    }

    let autoCompletionDisabled = false;
    let autoCompletionDisabledMessage: string | undefined;

    if (booking.status !== targetStatus) {
      if (targetStatus === "arrived" || targetStatus === "waiting") {
        await assertPatientMeetsBookingQueueRequirements(client, Number(booking.patient_id), userRole);
      }

      autoCompletionDisabled =
        booking.status === "completed" &&
        targetStatus !== "completed" &&
        booking.auto_completed_by === "orthanc_pacs_auto_completion" &&
        !booking.pacs_auto_completion_disabled_at;
      autoCompletionDisabledMessage = autoCompletionDisabled
        ? "PACS auto-completion has been disabled for this booking because staff manually changed the status after Orthanc completed it."
        : undefined;

      await client.query(
        `
          update appointments_v2.bookings
          set
            status = $2,
            updated_at = now(),
            updated_by_user_id = $3,
            pacs_auto_completion_disabled_at = case when $4 then now() else pacs_auto_completion_disabled_at end,
            pacs_auto_completion_disabled_by_user_id = case when $4 then $3 else pacs_auto_completion_disabled_by_user_id end,
            pacs_auto_completion_disabled_reason = case when $4 then $5 else pacs_auto_completion_disabled_reason end
          where id = $1
        `,
        [bookingId, targetStatus, userId, autoCompletionDisabled, autoCompletionDisabledMessage ?? null]
      );
      await auditStatusChange(client, booking, targetStatus, cleanReason || null, userId, "manual_status_change");
      if (autoCompletionDisabled) {
        await logAuditEntry(
          {
            entityType: "appointment_v2_booking",
            entityId: bookingId,
            actionType: "orthanc_auto_completion_disabled",
            oldValues: {
              status: booking.status,
              auto_completed_by: booking.auto_completed_by,
              auto_completed_at: booking.auto_completed_at,
            },
            newValues: {
              status: targetStatus,
              reason: autoCompletionDisabledMessage,
              manualReason: cleanReason || null,
            },
            changedByUserId: userId,
          },
          client
        );
      }
      if (targetStatus === "no-show") {
        await activateNoShowRestrictionForBooking(client, bookingId, cleanReason || null, userId);
      }
    }

    await client.query("commit");
    scheduleBookingWorklistSync(bookingId);
    if (targetStatus === "cancelled") {
      void safeEnqueuePatientNotificationEvent({ bookingId, eventType: "appointment_cancelled" });
    }
    return {
      id: bookingId,
      previousStatus: booking.status,
      status: targetStatus,
      autoCompletionDisabled,
      autoCompletionDisabledMessage,
    };
  } catch (error) {
    await client.query("rollback");
    throw error;
  } finally {
    client.release();
  }
}

export async function finalizeAutoNoShowsForQueue(settings: QueueNoShowSettings, today: string): Promise<{ autoMarkedIds: number[] }> {
  const autoMarkedIds: number[] = [];
  if (!settings.reviewActive || !settings.autoNoShowEnabled) {
    return { autoMarkedIds };
  }

  const client = await pool.connect();
  try {
    await client.query("begin");
    const todayResult = await client.query<BookingStatusRow>(
      `
        update appointments_v2.bookings
        set status = 'no-show', updated_at = now(), updated_by_user_id = null
        where booking_date = $1::date
          and status = 'scheduled'
        returning id, 'scheduled'::text as status, booking_date::text
      `,
      [today]
    );

    for (const booking of todayResult.rows) {
      autoMarkedIds.push(Number(booking.id));
      await auditStatusChange(client, booking, "no-show", "Auto no-show after configured review time.", null, "auto_no_show");
      await activateNoShowRestrictionForBooking(client, Number(booking.id), "Auto no-show after configured review time.", null);
    }

    await client.query("commit");
  } catch (error) {
    await client.query("rollback");
    throw error;
  } finally {
    client.release();
  }

  for (const bookingId of autoMarkedIds) {
    scheduleBookingWorklistSync(bookingId);
  }

  return { autoMarkedIds };
}

export async function markOldNoShowCandidates(reason: string, userId: number | null): Promise<{ markedIds: number[] }> {
  const settings = await getQueueNoShowSettings();
  const today = getTripoliToday();
  const cleanReason = String(reason || "").trim();
  if (!cleanReason) {
    throw new SchedulingError(400, "A reason is required.", ["status_reason_required"]);
  }
  if (settings.cleanupDays <= 0) {
    return { markedIds: [] };
  }

  const markedIds: number[] = [];
  const client = await pool.connect();
  try {
    await client.query("begin");
    const result = await client.query<BookingStatusRow>(
      `
        with candidates as (
          select id
          from appointments_v2.bookings
          where booking_date < ($1::date - ($2::int * interval '1 day'))
            and status = 'scheduled'
          order by booking_date asc, created_at asc, id asc
          limit 200
        )
        update appointments_v2.bookings
        set status = 'no-show', updated_at = now(), updated_by_user_id = $3
        where id in (select id from candidates)
        returning id, 'scheduled'::text as status, booking_date::text
      `,
      [today, settings.cleanupDays, userId]
    );

    for (const booking of result.rows) {
      markedIds.push(Number(booking.id));
      await auditStatusChange(client, booking, "no-show", cleanReason, userId, "old_no_show_bulk_confirm");
      await activateNoShowRestrictionForBooking(client, Number(booking.id), cleanReason, userId);
    }

    await client.query("commit");
  } catch (error) {
    await client.query("rollback");
    throw error;
  } finally {
    client.release();
  }

  for (const bookingId of markedIds) {
    scheduleBookingWorklistSync(bookingId);
  }

  return { markedIds };
}
