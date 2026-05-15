import type { PoolClient } from "pg";
import { withTransaction } from "../../shared/utils/transactions.js";
import { SchedulingError } from "../../shared/errors/scheduling-error.js";
import { findBookingById, voidBooking } from "../repositories/booking.repo.js";
import type { Booking } from "../models/booking.js";
import { scheduleBookingWorklistSync } from "../../../../services/dicom-service.js";

export interface VoidBookingResult {
  booking: Booking;
  previousStatus: string;
}

export async function voidBookingByStaff(
  bookingId: number,
  userId: number,
  userRole: string | undefined,
  voidReason: string
): Promise<VoidBookingResult> {
  const result = await withTransaction(async (client) => {
    return voidBookingInternal(client, bookingId, userId, userRole, voidReason);
  });

  scheduleBookingWorklistSync(bookingId);
  return result;
}

async function voidBookingInternal(
  client: PoolClient,
  bookingId: number,
  userId: number,
  userRole: string | undefined,
  voidReason: string
): Promise<VoidBookingResult> {
  const booking = await findBookingById(client, bookingId);
  if (!booking) {
    throw new SchedulingError(404, `Booking ${bookingId} not found.`, ["booking_not_found"]);
  }

  const reason = String(voidReason || "").trim();
  if (!reason) {
    throw new SchedulingError(400, "Void reason is required.", ["void_reason_required"]);
  }

  if (userRole === "super_admin") {
    await voidBooking(client, bookingId, reason, userId);
    return {
      booking: {
        ...booking,
        status: "voided",
        voidReason: reason,
      },
      previousStatus: booking.status,
    };
  }

  if (booking.status === "voided") {
    throw new SchedulingError(409, `Booking ${bookingId} is already voided.`, ["booking_already_voided"]);
  }

  if (["completed", "no-show", "cancelled", "discontinued"].includes(booking.status)) {
    throw new SchedulingError(
      409,
      `Booking ${bookingId} has status "${booking.status}" and cannot be voided.`,
      ["booking_not_voidable"]
    );
  }

  if (booking.status === "scheduled") {
    await voidBooking(client, bookingId, reason, userId);
    return {
      booking: {
        ...booking,
        status: "voided",
        voidReason: reason,
      },
      previousStatus: booking.status,
    };
  }

  if (["arrived", "waiting"].includes(booking.status)) {
    if (!["receptionist", "supervisor", "super_admin"].includes(userRole ?? "")) {
      throw new SchedulingError(
        403,
        "Only receptionist, supervisor, or super_admin can void arrived or waiting bookings.",
        ["booking_void_supervisor_required"]
      );
    }

    await voidBooking(client, bookingId, reason, userId);
    return {
      booking: {
        ...booking,
        status: "voided",
        voidReason: reason,
      },
      previousStatus: booking.status,
    };
  }

  throw new SchedulingError(
    409,
    `Booking ${bookingId} has status "${booking.status}" and cannot be voided.`,
    ["booking_not_voidable"]
  );
}
