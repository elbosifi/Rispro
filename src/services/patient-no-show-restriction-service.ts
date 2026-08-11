import type { PoolClient } from "pg";
import { pool } from "../db/pool.js";
import { logAuditEntry } from "./audit-service.js";
import { HttpError } from "../utils/http-error.js";
import type { Role } from "../types/domain.js";

export const NO_SHOW_BOOKING_BLOCKED_MESSAGE =
  "This patient has a previous no-show appointment and cannot be booked by reception. A supervisor or super admin must authorize a new booking with a reason.";
export const NON_ONCOLOGY_NO_SHOW_SUPER_ADMIN_MESSAGE =
  "This non-oncology patient has a previous no-show appointment. Only a super admin can authorize a new booking after no-show, and a clear reason is required.";

function httpErrorWithReasonCodes(statusCode: number, message: string, reasonCodes: string[]): HttpError {
  const error = new HttpError(statusCode, message, { reasonCodes }) as HttpError & { reasonCodes?: string[] };
  error.reasonCodes = reasonCodes;
  return error;
}

export interface PatientNoShowRestriction {
  noShowCount: number;
  bookingRestricted: boolean;
  lastNoShowAppointment: {
    id: number;
    date: string;
    status: string;
    modalityName: string;
    examTypeName: string;
  } | null;
  lastAuthorizationUser: {
    id: number;
    fullName: string | null;
    username: string | null;
  } | null;
  lastAuthorizationDate: string | null;
  lastAuthorizationReason: string | null;
}

interface RestrictionRow {
  no_show_count: number | string | null;
  no_show_booking_blocked: boolean | null;
  no_show_block_reset_at: string | Date | null;
  no_show_block_reset_reason: string | null;
  reset_user_id: number | string | null;
  reset_full_name: string | null;
  reset_username: string | null;
  last_no_show_id: number | string | null;
  last_no_show_date: string | null;
  last_no_show_status: string | null;
  last_no_show_modality_name: string | null;
  last_no_show_exam_type_name: string | null;
}

function canAuthorizeNoShowBooking(role: Role | undefined): boolean {
  return role === "supervisor" || role === "super_admin";
}

function canAuthorizePatientCategory(role: Role | undefined, category: string | null): boolean {
  if (category === "non_oncology") return role === "super_admin";
  return canAuthorizeNoShowBooking(role);
}

export async function getPatientNoShowRestriction(patientId: number): Promise<PatientNoShowRestriction> {
  const result = await pool.query<RestrictionRow>(
    `
      select
        p.no_show_count,
        p.no_show_booking_blocked,
        p.no_show_block_reset_at,
        p.no_show_block_reset_reason,
        u.id as reset_user_id,
        u.full_name as reset_full_name,
        u.username as reset_username,
        last_no_show.id as last_no_show_id,
        last_no_show.booking_date as last_no_show_date,
        last_no_show.status as last_no_show_status,
        last_no_show.modality_name as last_no_show_modality_name,
        last_no_show.exam_type_name as last_no_show_exam_type_name
      from patients p
      left join users u on u.id = p.no_show_block_reset_by
      left join lateral (
        select
          b.id,
          b.booking_date::text,
          b.status,
          m.name_en as modality_name,
          coalesce(et.name_en, '') as exam_type_name
        from appointments_v2.bookings b
        join modalities m on m.id = b.modality_id
        left join exam_types et on et.id = b.exam_type_id
        where b.patient_id = p.id and b.status = 'no-show'
        order by b.booking_date desc, b.id desc
        limit 1
      ) last_no_show on true
      where p.id = $1
      limit 1
    `,
    [patientId]
  );

  const row = result.rows[0];
  if (!row) {
    throw new HttpError(404, "Patient not found.");
  }

  return {
    noShowCount: Number(row.no_show_count || 0),
    bookingRestricted: row.no_show_booking_blocked === true,
    lastNoShowAppointment: row.last_no_show_id
      ? {
          id: Number(row.last_no_show_id),
          date: String(row.last_no_show_date || ""),
          status: String(row.last_no_show_status || "no-show"),
          modalityName: String(row.last_no_show_modality_name || ""),
          examTypeName: String(row.last_no_show_exam_type_name || ""),
        }
      : null,
    lastAuthorizationUser: row.reset_user_id
      ? {
          id: Number(row.reset_user_id),
          fullName: row.reset_full_name,
          username: row.reset_username,
        }
      : null,
    lastAuthorizationDate: row.no_show_block_reset_at ? new Date(row.no_show_block_reset_at).toISOString() : null,
    lastAuthorizationReason: row.no_show_block_reset_reason,
  };
}

async function recordNoShowEvent(
  client: PoolClient,
  patientId: number,
  appointmentId: number | null,
  eventType: string,
  reason: string | null,
  userId: number | null
): Promise<void> {
  await client.query(
    `
      insert into patient_no_show_events (patient_id, appointment_id, event_type, reason, created_by)
      values ($1, $2, $3, $4, $5)
    `,
    [patientId, appointmentId, eventType, reason, userId]
  );
}

export async function activateNoShowRestrictionForBooking(
  client: PoolClient,
  bookingId: number,
  reason: string | null,
  userId: number | null
): Promise<void> {
  const bookingResult = await client.query<{ patient_id: number }>(
    `
      select patient_id
      from appointments_v2.bookings
      where id = $1
      for update
    `,
    [bookingId]
  );
  const patientId = Number(bookingResult.rows[0]?.patient_id || 0);
  if (!patientId) return;

  const previous = await client.query<{ no_show_count: number; no_show_booking_blocked: boolean }>(
    `
      select no_show_count, no_show_booking_blocked
      from patients
      where id = $1
      for update
    `,
    [patientId]
  );
  const previousState = previous.rows[0];

  await client.query(
    `
      update patients
      set
        no_show_count = no_show_count + 1,
        no_show_booking_blocked = true,
        no_show_block_reset_at = null,
        no_show_block_reset_by = null,
        no_show_block_reset_reason = null,
        updated_at = now(),
        updated_by_user_id = $2
      where id = $1
    `,
    [patientId, userId]
  );

  await recordNoShowEvent(client, patientId, bookingId, "no_show_marked", reason, userId);
  await recordNoShowEvent(client, patientId, bookingId, "no_show_count_incremented", reason, userId);
  await recordNoShowEvent(client, patientId, bookingId, "booking_restriction_activated", reason, userId);
  await logAuditEntry(
    {
      entityType: "patient",
      entityId: patientId,
      actionType: "no_show_booking_restriction_activated",
      oldValues: previousState ?? null,
      newValues: {
        appointmentId: bookingId,
        reason,
        noShowCount: Number(previousState?.no_show_count || 0) + 1,
        noShowBookingBlocked: true,
      },
      changedByUserId: userId,
    },
    client
  );
}

export async function authorizeNoShowBookingRestriction(
  client: PoolClient,
  patientId: number,
  userId: number,
  reason: string,
  appointmentId: number | null = null,
  userRole?: Role
): Promise<void> {
  const cleanReason = reason.trim();
  if (!cleanReason) {
    throw new HttpError(400, "Authorization reason is required.");
  }

  const previous = await client.query<{ category: string | null }>(
    `
      select no_show_count, no_show_booking_blocked, no_show_block_reset_at, no_show_block_reset_by, no_show_block_reset_reason, category
      from patients
      where id = $1
      for update
    `,
    [patientId]
  );
  if (!previous.rows[0]) {
    throw new HttpError(404, "Patient not found.");
  }
  if (userRole && !canAuthorizePatientCategory(userRole, previous.rows[0].category)) {
    throw httpErrorWithReasonCodes(403, NON_ONCOLOGY_NO_SHOW_SUPER_ADMIN_MESSAGE, ["non_oncology_no_show_super_admin_required"]);
  }

  await client.query(
    `
      update patients
      set
        no_show_booking_blocked = false,
        no_show_block_reset_at = now(),
        no_show_block_reset_by = $2,
        no_show_block_reset_reason = $3,
        updated_at = now(),
        updated_by_user_id = $2
      where id = $1
    `,
    [patientId, userId, cleanReason]
  );
  await recordNoShowEvent(client, patientId, appointmentId, "booking_restriction_authorized", cleanReason, userId);
  await logAuditEntry(
    {
      entityType: "patient",
      entityId: patientId,
      actionType: "no_show_booking_restriction_authorized",
      oldValues: previous.rows[0],
      newValues: { appointmentId, reason: cleanReason, noShowBookingBlocked: false },
      changedByUserId: userId,
    },
    client
  );
}

export async function enforceOrAuthorizeNoShowBooking(
  client: PoolClient,
  patientId: number,
  userId: number,
  userRole: Role | undefined,
  reason: string | null | undefined
): Promise<boolean> {
  const result = await client.query<{ no_show_booking_blocked: boolean; category: string | null }>(
    `
      select no_show_booking_blocked, category
      from patients
      where id = $1
      for update
    `,
    [patientId]
  );
  const row = result.rows[0];
  if (!row) {
    throw new HttpError(404, "Patient not found.");
  }
  if (row.no_show_booking_blocked !== true) {
    return false;
  }

  if (!canAuthorizePatientCategory(userRole, row.category)) {
    throw httpErrorWithReasonCodes(
      403,
      row.category === "non_oncology" ? NON_ONCOLOGY_NO_SHOW_SUPER_ADMIN_MESSAGE : NO_SHOW_BOOKING_BLOCKED_MESSAGE,
      row.category === "non_oncology" ? ["non_oncology_no_show_super_admin_required"] : ["patient_no_show_booking_blocked"]
    );
  }

  const cleanReason = String(reason || "").trim();
  if (!cleanReason) {
    throw httpErrorWithReasonCodes(403, "No-show booking authorization reason is required.", ["no_show_authorization_reason_required"]);
  }

  await authorizeNoShowBookingRestriction(client, patientId, userId, cleanReason, null, userRole);
  return true;
}

export async function isNoShowBookingBlocked(client: PoolClient, patientId: number): Promise<boolean> {
  const result = await client.query<{ no_show_booking_blocked: boolean }>(
    `
      select no_show_booking_blocked
      from patients
      where id = $1
      limit 1
    `,
    [patientId]
  );
  return result.rows[0]?.no_show_booking_blocked === true;
}
