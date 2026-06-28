import type { PoolClient } from "pg";
import { pool } from "../../db/pool.js";
import type { Role } from "../../types/domain.js";
import { HttpError } from "../../utils/http-error.js";
import { insertDoctorAuditEvent } from "./profile-repository.js";

export interface ReportingAssignmentIntentActor {
  userId: number;
  role?: Role;
}

export interface ReportingAssignmentActivationNotification {
  doctorId: number;
  bookingId: number;
  assignmentId: number;
}

interface BookingIntentRow {
  id: number;
  status: string;
  requiresReport: boolean;
  modalityId: number;
  bookingDate: string;
}

interface PendingIntentRow {
  id: number;
  appointmentId: number;
  intendedDoctorId: number;
  requestedByUserId: number | null;
  requestedByDoctorId: number | null;
  reason: string | null;
}

async function findActorDoctorId(client: PoolClient, userId: number): Promise<number | null> {
  const result = await client.query<{ id: number }>(
    `
      select id
      from doctor_portal.doctor_profiles
      where user_id = $1 and active = true
      order by id asc
      limit 1
    `,
    [userId]
  );
  return result.rows[0]?.id ?? null;
}

export async function canCreateReportingAssignmentIntent(
  client: PoolClient,
  actor: ReportingAssignmentIntentActor
): Promise<boolean> {
  if (actor.role === "super_admin" || actor.role === "supervisor") return true;
  const result = await client.query<{ id: number }>(
    `
      select id
      from doctor_portal.doctor_profiles
      where user_id = $1
        and active = true
        and can_supervise = true
      limit 1
    `,
    [actor.userId]
  );
  return result.rows.length > 0;
}

async function assertCanCreateReportingAssignmentIntent(
  client: PoolClient,
  actor: ReportingAssignmentIntentActor
): Promise<void> {
  if (await canCreateReportingAssignmentIntent(client, actor)) return;
  throw new HttpError(403, "Direct intended reporting doctor selection is not permitted.");
}

async function assertDoctorCanReportModality(
  client: PoolClient,
  doctorId: number,
  modalityId: number
): Promise<void> {
  const result = await client.query<{ id: number }>(
    `
      select dp.id
      from doctor_portal.doctor_profiles dp
      join doctor_portal.doctor_modality_permissions dmp
        on dmp.doctor_id = dp.id
       and dmp.modality_id = $2
       and dmp.can_report = true
       and dmp.active = true
      where dp.id = $1
        and dp.active = true
        and dp.can_finalize_reports = true
      limit 1
    `,
    [doctorId, modalityId]
  );
  if (result.rowCount === 0) {
    throw new HttpError(400, "Selected doctor is not eligible to report this modality.");
  }
}

function normalizeReason(value: string | null | undefined): string | null {
  const clean = String(value ?? "").trim();
  return clean || null;
}

export async function listEligibleIntendedReportingDoctors(input: {
  modalityId: number;
  actor: ReportingAssignmentIntentActor;
}): Promise<Array<{ id: number; displayName: string; canFinalizeReports: boolean }>> {
  const client = await pool.connect();
  try {
    await assertCanCreateReportingAssignmentIntent(client, input.actor);
    const result = await client.query<{ id: number; displayName: string; canFinalizeReports: boolean }>(
      `
        select dp.id, dp.display_name as "displayName", dp.can_finalize_reports as "canFinalizeReports"
        from doctor_portal.doctor_profiles dp
        join doctor_portal.doctor_modality_permissions dmp
          on dmp.doctor_id = dp.id
         and dmp.modality_id = $1
         and dmp.can_report = true
         and dmp.active = true
        where dp.active = true
          and dp.can_finalize_reports = true
        order by dp.display_name asc, dp.id asc
      `,
      [input.modalityId]
    );
    return result.rows;
  } finally {
    client.release();
  }
}

export async function createPendingReportingAssignmentIntent(
  client: PoolClient,
  input: {
    bookingId: number;
    intendedDoctorId: number;
    actor: ReportingAssignmentIntentActor;
    reason?: string | null;
    createdFromContext: string;
  }
): Promise<number> {
  await assertCanCreateReportingAssignmentIntent(client, input.actor);
  const bookingResult = await client.query<BookingIntentRow>(
    `
      select
        id,
        status,
        requires_report as "requiresReport",
        modality_id as "modalityId",
        booking_date::text as "bookingDate"
      from appointments_v2.bookings
      where id = $1
      limit 1
    `,
    [input.bookingId]
  );
  const booking = bookingResult.rows[0];
  if (!booking) throw new HttpError(404, "Booking not found.");
  if (booking.requiresReport !== true) {
    throw new HttpError(400, "An intended reporting doctor requires requiresReport=true.");
  }

  await assertDoctorCanReportModality(client, input.intendedDoctorId, booking.modalityId);
  const actorDoctorId = await findActorDoctorId(client, input.actor.userId);
  const reason = normalizeReason(input.reason);
  const inserted = await client.query<{ id: number }>(
    `
      insert into doctor_portal.reporting_assignment_intents (
        appointment_id,
        intended_doctor_id,
        status,
        requested_by_user_id,
        requested_by_doctor_id,
        reason,
        created_from_context
      )
      values ($1, $2, 'pending', $3, $4, $5, $6)
      returning id
    `,
    [input.bookingId, input.intendedDoctorId, input.actor.userId, actorDoctorId, reason, input.createdFromContext]
  );
  const intentId = Number(inserted.rows[0].id);
  await insertDoctorAuditEvent(client, {
    actorUserId: input.actor.userId,
    actorDoctorId,
    eventType: "reporting_assignment_intent_created",
    targetType: "reporting_assignment_intent",
    targetId: intentId,
    metadata: {
      appointmentId: input.bookingId,
      intendedDoctorId: input.intendedDoctorId,
      createdFromContext: input.createdFromContext,
    },
    reason,
  });
  return intentId;
}

async function markIntentFailed(
  client: PoolClient,
  intent: PendingIntentRow,
  failureReason: string
): Promise<void> {
  await client.query(
    `
      update doctor_portal.reporting_assignment_intents
      set status = 'failed', failed_at = now(), failure_reason = $2, updated_at = now()
      where id = $1 and status = 'pending'
    `,
    [intent.id, failureReason]
  );
  await insertDoctorAuditEvent(client, {
    actorUserId: intent.requestedByUserId,
    actorDoctorId: intent.requestedByDoctorId,
    eventType: "reporting_assignment_intent_failed",
    targetType: "reporting_assignment_intent",
    targetId: intent.id,
    metadata: {
      appointmentId: intent.appointmentId,
      intendedDoctorId: intent.intendedDoctorId,
      failureReason,
    },
    reason: failureReason,
  });
}

export async function activatePendingReportingAssignmentIntent(
  client: PoolClient,
  bookingId: number,
  options: { actorUserId?: number | null; actionType?: string } = {}
): Promise<ReportingAssignmentActivationNotification | null> {
  const bookingResult = await client.query<BookingIntentRow>(
    `
      select
        id,
        status,
        requires_report as "requiresReport",
        modality_id as "modalityId",
        booking_date::text as "bookingDate"
      from appointments_v2.bookings
      where id = $1
      for update
    `,
    [bookingId]
  );
  const booking = bookingResult.rows[0];
  if (!booking || booking.status !== "completed") return null;

  const intentResult = await client.query<PendingIntentRow>(
    `
      select
        id,
        appointment_id as "appointmentId",
        intended_doctor_id as "intendedDoctorId",
        requested_by_user_id as "requestedByUserId",
        requested_by_doctor_id as "requestedByDoctorId",
        reason
      from doctor_portal.reporting_assignment_intents
      where appointment_id = $1
        and status = 'pending'
      order by id desc
      limit 1
      for update
    `,
    [bookingId]
  );
  const intent = intentResult.rows[0];
  if (!intent) return null;

  if (booking.requiresReport !== true) {
    await cancelPendingReportingAssignmentIntent(client, bookingId, {
      reason: "requires_report=false",
      actorUserId: options.actorUserId ?? null,
    });
    return null;
  }

  const existingAssignment = await client.query<{ id: number }>(
    `
      select id
      from doctor_portal.case_team_assignments
      where appointment_id = $1
        and assignment_type = 'reporting'
        and status = 'active'
      limit 1
      for update
    `,
    [bookingId]
  );
  if (existingAssignment.rows[0]) {
    await client.query(
      `
        update doctor_portal.reporting_assignment_intents
        set status = 'superseded', cancelled_at = now(), cancelled_reason = 'active_reporting_assignment_exists', updated_at = now()
        where id = $1 and status = 'pending'
      `,
      [intent.id]
    );
    return null;
  }

  try {
    await assertDoctorCanReportModality(client, intent.intendedDoctorId, booking.modalityId);
  } catch (error) {
    await markIntentFailed(client, intent, error instanceof Error ? error.message : "doctor_validation_failed");
    return null;
  }

  const inserted = await client.query<{ id: number }>(
    `
      insert into doctor_portal.case_team_assignments (
        appointment_id,
        roster_assignment_id,
        assigned_doctor_id,
        modality_id,
        assignment_type,
        expected_reporting_date,
        status
      )
      values ($1, null, $2, $3, 'reporting', $4::date, 'active')
      returning id
    `,
    [bookingId, intent.intendedDoctorId, booking.modalityId, booking.bookingDate]
  );
  const assignmentId = Number(inserted.rows[0].id);
  await client.query(
    `
      update doctor_portal.reporting_assignment_intents
      set status = 'activated', activated_assignment_id = $2, activated_at = now(), updated_at = now()
      where id = $1 and status = 'pending'
    `,
    [intent.id, assignmentId]
  );
  await insertDoctorAuditEvent(client, {
    actorUserId: options.actorUserId ?? intent.requestedByUserId,
    actorDoctorId: intent.requestedByDoctorId,
    eventType: "reporting_assignment_intent_activated",
    targetType: "case_team_assignment",
    targetId: assignmentId,
    metadata: {
      appointmentId: bookingId,
      intendedDoctorId: intent.intendedDoctorId,
      actionType: options.actionType ?? "booking_completed",
    },
    reason: intent.reason,
  });
  return { doctorId: intent.intendedDoctorId, bookingId, assignmentId };
}

export async function cancelPendingReportingAssignmentIntent(
  client: PoolClient,
  bookingId: number,
  input: { reason: string; actorUserId?: number | null }
): Promise<void> {
  const result = await client.query<PendingIntentRow>(
    `
      update doctor_portal.reporting_assignment_intents
      set status = 'cancelled', cancelled_at = now(), cancelled_reason = $2, updated_at = now()
      where appointment_id = $1
        and status = 'pending'
      returning
        id,
        appointment_id as "appointmentId",
        intended_doctor_id as "intendedDoctorId",
        requested_by_user_id as "requestedByUserId",
        requested_by_doctor_id as "requestedByDoctorId",
        reason
    `,
    [bookingId, input.reason]
  );
  for (const intent of result.rows) {
    await insertDoctorAuditEvent(client, {
      actorUserId: input.actorUserId ?? intent.requestedByUserId,
      actorDoctorId: intent.requestedByDoctorId,
      eventType: "reporting_assignment_intent_cancelled",
      targetType: "reporting_assignment_intent",
      targetId: intent.id,
      metadata: {
        appointmentId: bookingId,
        intendedDoctorId: intent.intendedDoctorId,
      },
      reason: input.reason,
    });
  }
}
