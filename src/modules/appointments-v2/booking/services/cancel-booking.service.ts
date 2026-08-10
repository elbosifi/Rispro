/**
 * Appointments V2 — Cancel booking service.
 *
 * Transactional: finds the booking, updates status to 'cancelled', and releases
 * any durable Special Quota consumption under the logical pool/date mutex.
 */

import type { PoolClient } from "pg";
import { withTransaction } from "../../shared/utils/transactions.js";
import { SchedulingError } from "../../shared/errors/scheduling-error.js";
import { findBookingByIdForUpdate, updateBookingStatus } from "../repositories/booking.repo.js";
import type { Booking } from "../models/booking.js";
import { CANCELLABLE_STATUSES } from "../../shared/types/common.js";
import { scheduleBookingWorklistSync } from "../../../../services/dicom-service.js";
import { safeEnqueuePatientNotificationEvent } from "../../../../services/patient-web-push-service.js";
import { cancelPendingReportingAssignmentIntent } from "../../../doctor-portal/reporting-assignment-intents-service.js";
import { acquireSpecialQuotaBucketLocks } from "../repositories/bucket-mutex.repo.js";
import {
  findActiveSpecialQuotaConsumption,
  releaseActiveSpecialQuotaConsumption,
} from "../repositories/special-quota-consumption.repo.js";

export interface CancelBookingResult {
  booking: Booking;
  previousStatus: string;
}

export async function cancelBooking(
  bookingId: number,
  userId: number
): Promise<CancelBookingResult> {
  const result = await withTransaction(async (client) => {
    return cancelBookingInternal(client, bookingId, userId);
  });

  scheduleBookingWorklistSync(bookingId);
  void safeEnqueuePatientNotificationEvent({ bookingId, eventType: "appointment_cancelled" });
  return result;
}

async function cancelBookingInternal(
  client: PoolClient,
  bookingId: number,
  userId: number
): Promise<CancelBookingResult> {
  // Serialize all mutations of this booking before locking its quota pool.
  const booking = await findBookingByIdForUpdate(client, bookingId);
  if (!booking) {
    throw new SchedulingError(404, `Booking ${bookingId} not found.`, ["booking_not_found"]);
  }

  if (booking.status === "cancelled") {
    throw new SchedulingError(
      409,
      `Booking ${bookingId} is already cancelled.`,
      ["booking_already_cancelled"]
    );
  }

  // Validate that the booking is in a cancellable status
  if (!CANCELLABLE_STATUSES.includes(booking.status as typeof CANCELLABLE_STATUSES[number])) {
    throw new SchedulingError(
      409,
      `Booking ${bookingId} has status "${booking.status}" and cannot be cancelled.`,
      ["booking_not_cancellable"]
    );
  }

  const previousStatus = booking.status;

  const consumptionBeforeLock = await findActiveSpecialQuotaConsumption(client, bookingId);
  if (consumptionBeforeLock) {
    await acquireSpecialQuotaBucketLocks(client, [{
      logicalKey: consumptionBeforeLock.quotaLogicalKey,
      date: consumptionBeforeLock.bookingDate,
    }]);
    await findActiveSpecialQuotaConsumption(client, bookingId, { forUpdate: true });
  }

  // 2. Update status to cancelled
  await updateBookingStatus(client, bookingId, "cancelled", userId);
  await releaseActiveSpecialQuotaConsumption(client, {
    bookingId,
    releasedByUserId: userId,
    releaseReason: "cancelled",
  });
  await cancelPendingReportingAssignmentIntent(client, bookingId, {
    reason: 'status", "cancelled"',
    actorUserId: userId,
  });

  // 3. Record a cancellation audit event (not an override, just a record)
  // Note: This is a lightweight record — no override needed for cancellation.

  // Normal capacity is released by booking status; Special Quota capacity is
  // released explicitly above while retaining durable consumption history.

  return {
    booking: {
      ...booking,
      status: "cancelled" as Booking["status"],
    },
    previousStatus,
  };
}
