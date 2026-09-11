import type { PoolClient } from "pg";
import { pool } from "../../../../db/pool.js";
import { logAuditEntry } from "../../../../services/audit-service.js";
import { scheduleBookingWorklistSync } from "../../../../services/dicom-service.js";
import { queueClinicalDocumentExportForCompletedAppointment } from "../../../../services/clinical-document-export-service.js";
import {
  activatePendingReportingAssignmentIntent,
  cancelPendingReportingAssignmentIntent,
  type ReportingAssignmentActivationNotification,
} from "../../../doctor-portal/reporting-assignment-intents-service.js";
import { createAdditionalImagingNotification, createAssignedToMeNotifications } from "../../../doctor-portal/reporting-board-repository.js";
import { acquireSpecialQuotaBucketLocks } from "../repositories/bucket-mutex.repo.js";
import {
  findActiveSpecialQuotaConsumption,
  releaseActiveSpecialQuotaConsumption,
} from "../repositories/special-quota-consumption.repo.js";
import { completeComplementaryRecallForBooking, reopenComplementaryRecallForUncompletedBooking } from "../../recall/complementary-recall.service.js";

export type TerminalBookingStatus = "completed" | "discontinued";
export type TerminalTransitionSource = "manual" | "mpps" | "pacs";

export interface BookingTerminalTransitionResult {
  transitioned: boolean;
  reportingIntentNotification: ReportingAssignmentActivationNotification | null;
}

export async function applyBookingTerminalTransition(input: {
  client: PoolClient;
  bookingId: number;
  previousStatus: string;
  targetStatus: TerminalBookingStatus;
  actorUserId: number | null;
  source: TerminalTransitionSource;
  auditReason?: string | null;
  auditOldValues?: Record<string, unknown>;
  auditNewValues?: Record<string, unknown>;
}): Promise<BookingTerminalTransitionResult> {
  if (input.previousStatus === input.targetStatus) {
    return { transitioned: false, reportingIntentNotification: null };
  }

  if (input.targetStatus === "discontinued") {
    const consumption = await findActiveSpecialQuotaConsumption(input.client, input.bookingId);
    if (consumption) {
      await acquireSpecialQuotaBucketLocks(input.client, [{
        logicalKey: consumption.quotaLogicalKey,
        date: consumption.bookingDate,
      }]);
      await findActiveSpecialQuotaConsumption(input.client, input.bookingId, { forUpdate: true });
    }
  }

  await input.client.query(
    `
      update appointments_v2.bookings
      set
        status = $2,
        completed_at = case
          when $2 = 'completed' then coalesce(completed_at, now())
          else completed_at
        end,
        updated_at = now(),
        updated_by_user_id = $3
      where id = $1
    `,
    [input.bookingId, input.targetStatus, input.actorUserId]
  );

  if (input.targetStatus === "discontinued") {
    await releaseActiveSpecialQuotaConsumption(input.client, {
      bookingId: input.bookingId,
      releasedByUserId: input.actorUserId,
      releaseReason: "discontinued",
    });
  }

  await logAuditEntry(
    {
      entityType: "appointment_v2_booking",
      entityId: input.bookingId,
      actionType: input.source === "mpps"
        ? "mpps_status_update"
        : input.source === "pacs"
          ? input.targetStatus === "completed"
            ? "orthanc_auto_complete"
            : "orthanc_auto_discontinue_below_minimum_series"
          : "manual_status_change",
      oldValues: {
        status: input.previousStatus,
        ...input.auditOldValues,
      },
      newValues: {
        status: input.targetStatus,
        reason: input.auditReason ?? null,
        ...input.auditNewValues,
      },
      changedByUserId: input.actorUserId,
    },
    input.client
  );

  if (input.targetStatus === "completed") {
    await completeComplementaryRecallForBooking(input.client, input.bookingId, input.actorUserId);
    const reportingIntentNotification = await activatePendingReportingAssignmentIntent(input.client, input.bookingId, {
      actorUserId: input.actorUserId,
      actionType: input.source === "mpps"
        ? "mpps_status_completion"
        : input.source === "pacs"
          ? "orthanc_auto_complete"
          : "manual_status_completion",
    });
    return { transitioned: true, reportingIntentNotification };
  }

  await reopenComplementaryRecallForUncompletedBooking(input.client, input.bookingId, input.actorUserId, "discontinued");
  await cancelPendingReportingAssignmentIntent(input.client, input.bookingId, {
    reason: "status_discontinued",
    actorUserId: input.actorUserId,
  });
  return { transitioned: true, reportingIntentNotification: null };
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

export async function notifyComplementaryRecallBookingEvent(
  bookingId: number,
  eventType: "additional_imaging_patient_arrived" | "additional_imaging_completed"
): Promise<void> {
  let rows: { rows: Array<{ id: number }> };
  try {
    rows = await pool.query<{ id: number }>(
      "select id from appointments_v2.complementary_recall_requests where recall_appointment_id=$1",
      [bookingId]
    );
  } catch (error) {
    console.warn(JSON.stringify({
      type: "additional_imaging_notification_lookup_failed",
      bookingId,
      eventType,
      error: error instanceof Error ? error.message : String(error),
    }));
    return;
  }
  await Promise.all(
    rows.rows.map((row) =>
      createAdditionalImagingNotification({ recallRequestId: Number(row.id), recallAppointmentId: bookingId, eventType })
        .catch((error) => {
          console.warn(JSON.stringify({
            type: "additional_imaging_notification_failed",
            bookingId,
            eventType,
            error: error instanceof Error ? error.message : String(error),
          }));
        })
    )
  );
}

export async function runBookingTerminalTransitionPostCommit(input: {
  bookingId: number;
  targetStatus: TerminalBookingStatus;
  actorUserId: number | null;
  reportingIntentNotification: ReportingAssignmentActivationNotification | null;
}): Promise<void> {
  await createAssignedToMeNotificationsForReportingIntent(input.reportingIntentNotification);
  if (input.targetStatus === "completed") {
    await notifyComplementaryRecallBookingEvent(input.bookingId, "additional_imaging_completed");
    await queueClinicalDocumentExportForCompletedAppointment(input.bookingId, input.actorUserId).catch((error) => {
      console.warn(JSON.stringify({
        type: "clinical_document_export_completion_queue_failed",
        appointmentId: input.bookingId,
        error: error instanceof Error ? error.message : String(error),
      }));
    });
  }
  try {
    scheduleBookingWorklistSync(input.bookingId);
  } catch (error) {
    console.error("Booking worklist synchronization scheduling failed after commit.", error);
  }
}
