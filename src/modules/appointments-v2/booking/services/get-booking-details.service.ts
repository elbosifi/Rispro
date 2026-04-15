/**
 * Appointments V2 — Get booking details service.
 *
 * Read-only details endpoint used by print/details flows.
 */

import { pool } from "../../../../db/pool.js";
import { SchedulingError } from "../../shared/errors/scheduling-error.js";
import {
  findBookingPrintDetailsById,
  type BookingPrintDetailsRow,
} from "../repositories/booking.repo.js";

export async function getBookingDetails(
  bookingId: number
): Promise<BookingPrintDetailsRow> {
  const booking = await findBookingPrintDetailsById(pool, bookingId);

  if (!booking) {
    throw new SchedulingError(404, `Booking ${bookingId} not found.`, ["booking_not_found"]);
  }

  return booking;
}
