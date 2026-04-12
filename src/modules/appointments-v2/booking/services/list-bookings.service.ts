/**
 * Appointments V2 — List bookings service.
 *
 * Returns existing bookings for a modality within a date range.
 * Read-only — uses pool directly, no transaction needed.
 */

import { pool } from "../../../../db/pool.js";
import { listBookings, type BookingWithPatientInfo } from "../repositories/booking.repo.js";

export interface ListBookingsParams {
  modalityId: number;
  dateFrom: string; // ISO yyyy-mm-dd
  dateTo: string;   // ISO yyyy-mm-dd
  limit?: number;
  offset?: number;
  includeCancelled?: boolean;
}

export async function listBookingsService(
  params: ListBookingsParams
): Promise<BookingWithPatientInfo[]> {
  const limit = params.limit ?? 50;
  const offset = params.offset ?? 0;
  const includeCancelled = params.includeCancelled ?? false;

  const bookings = await listBookings(pool, {
    modalityId: params.modalityId,
    dateFrom: params.dateFrom,
    dateTo: params.dateTo,
    limit,
    offset,
    includeCancelled,
  });

  return bookings;
}
