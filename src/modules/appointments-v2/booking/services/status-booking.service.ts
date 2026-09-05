import type { PoolClient } from "pg";
import { pool } from "../../../../db/pool.js";
import { logAuditEntry } from "../../../../services/audit-service.js";
import { scheduleBookingWorklistSync } from "../../../../services/dicom-service.js";
import { SchedulingError } from "../../shared/errors/scheduling-error.js";
import type { BookingStatus } from "../../shared/types/common.js";
import { activateNoShowRestrictionForBooking } from "../../../../services/patient-no-show-restriction-service.js";
import type { Role } from "../../../../types/domain.js";
import { assertPatientMeetsBookingQueueRequirements } from "./patient-identifier-requirement.js";
import {
  activatePendingReportingAssignmentIntent,
  cancelPendingReportingAssignmentIntent,
  type ReportingAssignmentActivationNotification,
} from "../../../doctor-portal/reporting-assignment-intents-service.js";
import { createAdditionalImagingNotification, createAssignedToMeNotifications } from "../../../doctor-portal/reporting-board-repository.js";
import { queueClinicalDocumentExportForCompletedAppointment } from "../../../../services/clinical-document-export-service.js";
import { acquireSpecialQuotaBucketLocks } from "../repositories/bucket-mutex.repo.js";
import {
  findActiveSpecialQuotaConsumption,
  releaseActiveSpecialQuotaConsumption,
} from "../repositories/special-quota-consumption.repo.js";
import { completeComplementaryRecallForBooking, reopenComplementaryRecallForUncompletedBooking } from "../../recall/complementary-recall.service.js";

const DEFAULT_NO_SHOW_REVIEW_TIME = "17:00";
const DEFAULT_AUTO_NO_SHOW_CLEANUP_DAYS = 1;
const SAME_DAY_QUEUE_ACTIVE_STATUSES = new Set<BookingStatus>(["scheduled", "arrived", "waiting"]);
const SAME_DAY_QUEUE_ARRIVAL_STATUSES = new Set<BookingStatus>(["scheduled", "waiting"]);
const MANUAL_STATUS_TARGETS = new Set<BookingStatus>([
  "scheduled",
  "arrived",
  "waiting",
  "completed",
  "no-show",
  "cancelled",
  "discontinued",
]);
const REASON_REQUIRED_STATUSES = new Set<BookingStatus>(["no-show", "discontinued"]);
const DEDICATED_CANCELLATION_MESSAGE = "Appointment cancellation must use the dedicated cancellation workflow.";

async function notifyComplementaryRecallBookingEvent(bookingId: number, eventType: "additional_imaging_patient_arrived" | "additional_imaging_completed"): Promise<void> {
  const rows = await pool.query<{ id: number }>("select id from appointments_v2.complementary_recall_requests where recall_appointment_id=$1", [bookingId]);
  await Promise.all(rows.rows.map((row) =>
    createAdditionalImagingNotification({ recallRequestId: Number(row.id), recallAppointmentId: bookingId, eventType })
      .catch((error) => console.warn(JSON.stringify({ type: "additional_imaging_notification_failed", bookingId, eventType, error: error instanceof Error ? error.message : String(error) })))
  ));
}

async function createAssignedToMeNotificationsForReportingIntent(
  notification: ReportingAssignmentActivationNotification | null
): Promise<void> {
  if (!notification) return;
  try {
    await createAssignedToMeNotifications({
      doctorId: notification.doctorId,
      appointmentIds: [notification.bookingId],
    });
  } catch (error) {
    console.warn(JSON.stringify({
      type: "reporting_assignment_intent_notification_failed",
      bookingId: notification.bookingId,
      doctorId: notification.doctorId,
      error: error instanceof Error ? error.message : String(error),
    }));
  }
}

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

interface PatientRequirementCleanupRow extends BookingStatusRow {
  missing_phone: boolean;
  missing_identifier: boolean;
}

interface SameDayQueueBookingRow extends BookingStatusRow {
  booking_date: string;
}

export interface QueueNoShowSettings {
  reviewTime: string;
  reviewActive: boolean;
  autoNoShowEnabled: boolean;
  manualConfirmationRequired: boolean;
  cleanupDays: number;
}

export interface SameDayQueueArrivalResult {
  bookingId: number;
  patientId: number;
  bookingDate: string;
  updatedBookingIds: number[];
  alreadyArrivedBookingIds: number[];
  relatedBookingIds: number[];
  sameDayAppointmentCount: number;
  hasMultipleAppointments: boolean;
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

export async function arriveSameDayQueueBookings(
  client: PoolClient,
  bookingId: number,
  today: string,
  userId: number,
  userRole?: Role
): Promise<SameDayQueueArrivalResult> {
  const selectedResult = await client.query<SameDayQueueBookingRow>(
    `
      select id, patient_id, booking_date::text, status
      from appointments_v2.bookings
      where id = $1
      limit 1
    `,
    [bookingId]
  );
  const selected = selectedResult.rows[0];
  if (
    !selected ||
    selected.booking_date !== today ||
    !SAME_DAY_QUEUE_ACTIVE_STATUSES.has(selected.status)
  ) {
    throw new SchedulingError(409, "Booking is not eligible for scan/arrival.", ["queue_scan_booking_not_eligible"]);
  }

  await assertPatientMeetsBookingQueueRequirements(client, Number(selected.patient_id), userRole);

  const lockedResult = await client.query<SameDayQueueBookingRow>(
    `
      select id, patient_id, booking_date::text, status
      from appointments_v2.bookings
      where patient_id = $1
        and booking_date = $2::date
      order by id asc
      for update
    `,
    [selected.patient_id, selected.booking_date]
  );

  const lockedRows = lockedResult.rows;
  const lockedSelected = lockedRows.find((row) => Number(row.id) === bookingId);
  if (
    !lockedSelected ||
    lockedSelected.booking_date !== today ||
    !SAME_DAY_QUEUE_ACTIVE_STATUSES.has(lockedSelected.status)
  ) {
    throw new SchedulingError(409, "Booking is not eligible for scan/arrival.", ["queue_scan_booking_not_eligible"]);
  }

  const activeRows = lockedRows.filter((row) => SAME_DAY_QUEUE_ACTIVE_STATUSES.has(row.status));
  const updatedBookingIds = activeRows
    .filter((row) => SAME_DAY_QUEUE_ARRIVAL_STATUSES.has(row.status))
    .map((row) => Number(row.id));
  const alreadyArrivedBookingIds = activeRows
    .filter((row) => row.status === "arrived")
    .map((row) => Number(row.id));
  const relatedBookingIds = activeRows.map((row) => Number(row.id));

  if (updatedBookingIds.length > 0) {
    await client.query(
      `
        update appointments_v2.bookings
        set status = 'arrived', arrived_at = coalesce(arrived_at, now()), updated_at = now(), updated_by_user_id = $2
        where id = any($1::bigint[])
          and status in ('scheduled', 'waiting')
      `,
      [updatedBookingIds, userId]
    );
  }

  return {
    bookingId,
    patientId: Number(selected.patient_id),
    bookingDate: selected.booking_date,
    updatedBookingIds,
    alreadyArrivedBookingIds,
    relatedBookingIds,
    sameDayAppointmentCount: relatedBookingIds.length,
    hasMultipleAppointments: relatedBookingIds.length > 1,
  };
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

function parseRequiredSetting(value: unknown, fallback: "required" | "optional"): boolean {
  return String(value ?? fallback).trim().toLowerCase() !== "optional";
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

async function getPatientRequirementSettings(client: PoolClient): Promise<{
  phoneRequired: boolean;
  identifierRequired: boolean;
}> {
  const { rows } = await client.query<SettingsRow>(
    `
      select setting_key, setting_value
      from system_settings
      where category = 'patient_registration'
        and setting_key in ('phone1_required', 'national_id_required')
    `
  );

  return {
    phoneRequired: parseRequiredSetting(settingValue(rows, "phone1_required", "required"), "required"),
    identifierRequired: parseRequiredSetting(settingValue(rows, "national_id_required", "required"), "required"),
  };
}

export async function cleanupActiveQueuePatientRequirementViolations(
  today: string,
  userId: number | null
): Promise<{ cleanedIds: number[] }> {
  const cleanedIds: number[] = [];
  const client = await pool.connect();
  try {
    await client.query("begin");
    const settings = await getPatientRequirementSettings(client);
    if (!settings.phoneRequired && !settings.identifierRequired) {
      await client.query("commit");
      return { cleanedIds };
    }

    const result = await client.query<PatientRequirementCleanupRow>(
      `
        with invalid_bookings as (
          select
            b.id,
            b.status,
            b.booking_date::text,
            b.patient_id,
            ($2::boolean and nullif(trim(coalesce(p.phone_1, '')), '') is null) as missing_phone,
            (
              $3::boolean
              and coalesce(
                nullif(trim(primary_identifier.value), ''),
                nullif(trim(p.identifier_value), ''),
                nullif(trim(p.national_id), '')
              ) is null
            ) as missing_identifier
          from appointments_v2.bookings b
          join patients p on p.id = b.patient_id
          left join lateral (
            select pi.value
            from patient_identifiers pi
            where pi.patient_id = p.id
              and pi.is_primary = true
            order by pi.id asc
            limit 1
          ) primary_identifier on true
          where b.booking_date = $1::date
            and b.status in ('arrived', 'waiting')
          for update of b
        )
        update appointments_v2.bookings b
        set status = 'scheduled', updated_at = now(), updated_by_user_id = $4
        from invalid_bookings invalid
        where b.id = invalid.id
          and (invalid.missing_phone or invalid.missing_identifier)
        returning
          b.id,
          invalid.patient_id,
          invalid.status,
          invalid.booking_date,
          invalid.missing_phone,
          invalid.missing_identifier
      `,
      [today, settings.phoneRequired, settings.identifierRequired, userId]
    );

    for (const booking of result.rows) {
      const reasonCodes = [
        booking.missing_phone ? "patient_phone_required" : null,
        booking.missing_identifier ? "patient_primary_identifier_required" : null,
      ].filter(Boolean);
      cleanedIds.push(Number(booking.id));
      await auditStatusChange(
        client,
        booking,
        "scheduled",
        `Removed from active worklist because required patient data is missing: ${reasonCodes.join(", ")}.`,
        userId,
        "active_queue_patient_requirements_cleanup"
      );
    }

    await client.query("commit");
  } catch (error) {
    await client.query("rollback");
    throw error;
  } finally {
    client.release();
  }

  for (const bookingId of cleanedIds) {
    scheduleBookingWorklistSync(bookingId);
  }

  return { cleanedIds };
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
  if (targetStatus === "cancelled") {
    throw new SchedulingError(403, DEDICATED_CANCELLATION_MESSAGE, ["appointment_cancel_dedicated_workflow_required"]);
  }
  if (REASON_REQUIRED_STATUSES.has(targetStatus) && !cleanReason) {
    throw new SchedulingError(400, "A reason is required for this status change.", ["status_reason_required"]);
  }

  const client = await pool.connect();
  let reportingIntentNotification: ReportingAssignmentActivationNotification | null = null;
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
    if (booking.status === "discontinued" && targetStatus !== "discontinued") {
      throw new SchedulingError(409, "Discontinued bookings cannot be reactivated through manual status management.", ["booking_discontinued_terminal"]);
    }
    if (booking.status === "completed" && targetStatus === "arrived" && !cleanReason) {
      throw new SchedulingError(400, "A reason is required to reopen a completed booking.", ["completed_reopen_reason_required"]);
    }

    let autoCompletionDisabled = false;
    let autoCompletionDisabledMessage: string | undefined;

    if (booking.status !== targetStatus) {
      if (targetStatus === "arrived" || targetStatus === "waiting" || targetStatus === "completed") {
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

      if (targetStatus === "discontinued") {
        const consumption = await findActiveSpecialQuotaConsumption(client, bookingId);
        if (consumption) {
          await acquireSpecialQuotaBucketLocks(client, [{
            logicalKey: consumption.quotaLogicalKey,
            date: consumption.bookingDate,
          }]);
          await findActiveSpecialQuotaConsumption(client, bookingId, { forUpdate: true });
        }
      }

      await client.query(
        `
          update appointments_v2.bookings
          set
            status = $2,
            arrived_at = case
              when $2 in ('arrived', 'waiting') then coalesce(arrived_at, now())
              else arrived_at
            end,
            waiting_started_at = case
              when $2 = 'waiting' then coalesce(waiting_started_at, now())
              else waiting_started_at
            end,
            completed_at = case
              when $2 = 'completed' then coalesce(completed_at, now())
              else completed_at
            end,
            -- A direct completion does not prove the patient entered the queue.
            -- Preserve arrived_at unless the workflow already recorded arrival/waiting.
            updated_at = now(),
            updated_by_user_id = $3,
            pacs_auto_completion_disabled_at = case when $4 then now() else pacs_auto_completion_disabled_at end,
            pacs_auto_completion_disabled_by_user_id = case when $4 then $3 else pacs_auto_completion_disabled_by_user_id end,
            pacs_auto_completion_disabled_reason = case when $4 then $5 else pacs_auto_completion_disabled_reason end
          where id = $1
        `,
        [bookingId, targetStatus, userId, autoCompletionDisabled, autoCompletionDisabledMessage ?? null]
      );
      if (targetStatus === "discontinued") {
        await releaseActiveSpecialQuotaConsumption(client, {
          bookingId,
          releasedByUserId: userId,
          releaseReason: "discontinued",
        });
      }
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
        await reopenComplementaryRecallForUncompletedBooking(client, bookingId, userId, "no-show");
      }
      if (targetStatus === "completed") {
        await completeComplementaryRecallForBooking(client, bookingId, userId);
        reportingIntentNotification = await activatePendingReportingAssignmentIntent(client, bookingId, {
          actorUserId: userId,
          actionType: "manual_status_completion",
        });
      } else if (targetStatus === "discontinued") {
        await reopenComplementaryRecallForUncompletedBooking(client, bookingId, userId, "discontinued");
        await cancelPendingReportingAssignmentIntent(client, bookingId, {
          reason: "status_discontinued",
          actorUserId: userId,
        });
      }
    }

    await client.query("commit");
    await createAssignedToMeNotificationsForReportingIntent(reportingIntentNotification);
    if (targetStatus === "arrived") await notifyComplementaryRecallBookingEvent(bookingId, "additional_imaging_patient_arrived");
    if (targetStatus === "completed") await notifyComplementaryRecallBookingEvent(bookingId, "additional_imaging_completed");
    if (targetStatus === "completed") {
      await queueClinicalDocumentExportForCompletedAppointment(bookingId, userId).catch((error) => {
        console.warn(JSON.stringify({ type: "clinical_document_export_completion_queue_failed", appointmentId: bookingId, error: error instanceof Error ? error.message : String(error) }));
      });
    }
    scheduleBookingWorklistSync(bookingId);
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
  // Compatibility export retained for older callers. Automatic processing now runs only in no-show-worker.
  // A Queue GET must never invoke this legacy helper.
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
