import { pool } from "../../db/pool.js";
import type { UserId } from "../../types/http.js";
import { insertDoctorAuditEvent } from "./profile-repository.js";
import type {
  AvailabilityStatus,
  DoctorAvailabilityRow,
  DoctorLeaveRequestRow,
  LeaveStatus,
  LeaveType,
} from "./availability-types.js";

const AVAILABILITY_SELECT = `
  select
    da.id,
    da.doctor_id as "doctorId",
    dp.display_name as "doctorName",
    da.date::text as "date",
    da.start_time::text as "startTime",
    da.end_time::text as "endTime",
    da.availability_status as "availabilityStatus",
    da.note,
    da.created_by as "createdBy",
    da.created_at as "createdAt",
    da.updated_at as "updatedAt"
  from doctor_portal.doctor_availability da
  join doctor_portal.doctor_profiles dp on dp.id = da.doctor_id
`;

const LEAVE_SELECT = `
  select
    dl.id,
    dl.doctor_id as "doctorId",
    dp.display_name as "doctorName",
    dl.start_date::text as "startDate",
    dl.end_date::text as "endDate",
    dl.leave_type as "leaveType",
    dl.status,
    dl.reason,
    dl.approved_by as "approvedBy",
    dl.approved_at as "approvedAt",
    dl.created_at as "createdAt",
    dl.updated_at as "updatedAt"
  from doctor_portal.doctor_leave_requests dl
  join doctor_portal.doctor_profiles dp on dp.id = dl.doctor_id
`;

export async function listAvailability(input: {
  doctorId?: number;
  dateFrom: string;
  dateTo: string;
}): Promise<DoctorAvailabilityRow[]> {
  const params: unknown[] = [input.dateFrom, input.dateTo];
  const doctorFilter = input.doctorId ? "and da.doctor_id = $3" : "";
  if (input.doctorId) params.push(input.doctorId);
  const result = await pool.query<DoctorAvailabilityRow>(
    `
      ${AVAILABILITY_SELECT}
      where da.date between $1::date and $2::date
        ${doctorFilter}
      order by da.date asc, da.start_time asc nulls first, dp.display_name asc, da.id asc
    `,
    params
  );
  return result.rows;
}

export async function createAvailability(
  input: {
    doctorId: number;
    date: string;
    startTime: string | null;
    endTime: string | null;
    availabilityStatus: AvailabilityStatus;
    note: string | null;
  },
  actor: { userId: UserId; doctorId: number }
): Promise<DoctorAvailabilityRow> {
  const result = await pool.query<DoctorAvailabilityRow>(
    `
      insert into doctor_portal.doctor_availability (
        doctor_id, date, start_time, end_time, availability_status, note, created_by
      )
      values ($1, $2::date, $3::time, $4::time, $5, $6, $7)
      returning id, doctor_id as "doctorId", null::text as "doctorName", date::text as "date",
        start_time::text as "startTime", end_time::text as "endTime",
        availability_status as "availabilityStatus", note, created_by as "createdBy",
        created_at as "createdAt", updated_at as "updatedAt"
    `,
    [input.doctorId, input.date, input.startTime, input.endTime, input.availabilityStatus, input.note, actor.userId]
  );
  const row = result.rows[0];
  await insertDoctorAuditEvent(pool, {
    actorUserId: actor.userId,
    actorDoctorId: actor.doctorId,
    eventType: "availability_created",
    targetType: "doctor_availability",
    targetId: row.id,
    metadata: { doctorId: row.doctorId, date: row.date, availabilityStatus: row.availabilityStatus },
    reason: null,
  });
  return row;
}

export async function deleteAvailability(
  availabilityId: number,
  actor: { userId: UserId; doctorId: number },
  options: { doctorId?: number } = {}
): Promise<boolean> {
  const params: unknown[] = [availabilityId];
  const doctorFilter = options.doctorId ? "and doctor_id = $2" : "";
  if (options.doctorId) params.push(options.doctorId);
  const result = await pool.query<{ id: number; doctor_id: number }>(
    `
      delete from doctor_portal.doctor_availability
      where id = $1
        ${doctorFilter}
      returning id, doctor_id
    `,
    params
  );
  const removed = result.rows[0];
  if (!removed) return false;
  await insertDoctorAuditEvent(pool, {
    actorUserId: actor.userId,
    actorDoctorId: actor.doctorId,
    eventType: "availability_deleted",
    targetType: "doctor_availability",
    targetId: removed.id,
    metadata: { doctorId: Number(removed.doctor_id) },
    reason: null,
  });
  return true;
}

export async function listLeaveRequests(input: {
  doctorId?: number;
  dateFrom: string;
  dateTo: string;
}): Promise<DoctorLeaveRequestRow[]> {
  const params: unknown[] = [input.dateFrom, input.dateTo];
  const doctorFilter = input.doctorId ? "and dl.doctor_id = $3" : "";
  if (input.doctorId) params.push(input.doctorId);
  const result = await pool.query<DoctorLeaveRequestRow>(
    `
      ${LEAVE_SELECT}
      where dl.start_date <= $2::date
        and dl.end_date >= $1::date
        ${doctorFilter}
      order by dl.start_date asc, dp.display_name asc, dl.id asc
    `,
    params
  );
  return result.rows;
}

export async function createLeaveRequest(
  input: {
    doctorId: number;
    startDate: string;
    endDate: string;
    leaveType: LeaveType;
    reason: string | null;
    status: LeaveStatus;
    approvedBy: UserId | null;
  },
  actor: { userId: UserId; doctorId: number }
): Promise<DoctorLeaveRequestRow> {
  const result = await pool.query<DoctorLeaveRequestRow>(
    `
      insert into doctor_portal.doctor_leave_requests (
        doctor_id, start_date, end_date, leave_type, status, reason, approved_by, approved_at
      )
      values ($1, $2::date, $3::date, $4, $5, $6, $7, case when $5 = 'approved' then now() else null end)
      returning id, doctor_id as "doctorId", null::text as "doctorName", start_date::text as "startDate",
        end_date::text as "endDate", leave_type as "leaveType", status, reason,
        approved_by as "approvedBy", approved_at as "approvedAt", created_at as "createdAt", updated_at as "updatedAt"
    `,
    [input.doctorId, input.startDate, input.endDate, input.leaveType, input.status, input.reason, input.approvedBy]
  );
  const row = result.rows[0];
  await insertDoctorAuditEvent(pool, {
    actorUserId: actor.userId,
    actorDoctorId: actor.doctorId,
    eventType: "leave_created",
    targetType: "doctor_leave_request",
    targetId: row.id,
    metadata: { doctorId: row.doctorId, startDate: row.startDate, endDate: row.endDate, leaveType: row.leaveType, status: row.status },
    reason: row.reason,
  });
  return row;
}

export async function updateLeaveStatus(
  leaveId: number,
  status: LeaveStatus,
  actor: { userId: UserId; doctorId: number }
): Promise<DoctorLeaveRequestRow | null> {
  const result = await pool.query<DoctorLeaveRequestRow>(
    `
      update doctor_portal.doctor_leave_requests
      set status = $2,
          approved_by = case when $2 = 'approved' then $3 else approved_by end,
          approved_at = case when $2 = 'approved' then now() else approved_at end,
          updated_at = now()
      where id = $1
      returning id, doctor_id as "doctorId", null::text as "doctorName", start_date::text as "startDate",
        end_date::text as "endDate", leave_type as "leaveType", status, reason,
        approved_by as "approvedBy", approved_at as "approvedAt", created_at as "createdAt", updated_at as "updatedAt"
    `,
    [leaveId, status, actor.userId]
  );
  const row = result.rows[0] ?? null;
  if (!row) return null;
  await insertDoctorAuditEvent(pool, {
    actorUserId: actor.userId,
    actorDoctorId: actor.doctorId,
    eventType: status === "approved" ? "leave_approved" : status === "rejected" ? "leave_rejected" : "leave_updated",
    targetType: "doctor_leave_request",
    targetId: row.id,
    metadata: { doctorId: row.doctorId, status: row.status },
    reason: null,
  });
  return row;
}

