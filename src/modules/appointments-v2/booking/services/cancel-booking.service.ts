/**
 * Appointments V2 — Cancel booking service.
 *
 * Transactional: finds the booking, updates status to 'cancelled'.
 * Capacity is implicitly released because capacity queries exclude cancelled bookings.
 */

import type { PoolClient } from "pg";
import { withTransaction } from "../../shared/utils/transactions.js";
import { SchedulingError } from "../../shared/errors/scheduling-error.js";
import { findBookingById, updateBookingStatus } from "../repositories/booking.repo.js";
import type { Booking } from "../models/booking.js";
import { CANCELLABLE_STATUSES } from "../../shared/types/common.js";
import { scheduleBookingWorklistSync } from "../../../../services/dicom-service.js";

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
  return result;
}

async function cancelBookingInternal(
  client: PoolClient,
  bookingId: number,
  userId: number
): Promise<CancelBookingResult> {
  // 1. Find the booking
  const booking = await findBookingById(client, bookingId);
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

  // 2. Update status to cancelled
  await updateBookingStatus(client, bookingId, "cancelled", userId);

  // 3. Record a cancellation audit event (not an override, just a record)
  // Note: This is a lightweight record — no override needed for cancellation.

  // Capacity is implicitly released: capacity queries use `WHERE status <> 'cancelled'`

  return {
    booking: {
      ...booking,
      status: "cancelled" as Booking["status"],
    },
    previousStatus,
  };
}
