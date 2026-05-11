import { HttpError } from "../../utils/http-error.js";
import type { Role } from "../../types/domain.js";
import type { UserId } from "../../types/http.js";
import { getDoctorMe } from "./profile-service.js";
import {
  createAvailability,
  createLeaveRequest,
  deleteAvailability,
  listAvailability,
  listLeaveRequests,
  updateLeaveStatus,
} from "./availability-repository.js";
import type { AvailabilityStatus, LeaveStatus, LeaveType } from "./availability-types.js";

interface Actor {
  userId: UserId;
  appRole: Role;
}

function defaultDateRange() {
  const today = new Date();
  const dateFrom = today.toISOString().slice(0, 10);
  today.setUTCDate(today.getUTCDate() + 6);
  return { dateFrom, dateTo: today.toISOString().slice(0, 10) };
}

function requireDateRange(input: { dateFrom?: string | null; dateTo?: string | null }) {
  const fallback = defaultDateRange();
  return {
    dateFrom: input.dateFrom || fallback.dateFrom,
    dateTo: input.dateTo || fallback.dateTo,
  };
}

async function requireDoctor(actor: Actor) {
  const me = await getDoctorMe(actor.userId, actor.appRole);
  if (!me.hasActiveDoctorProfile || !me.profile) {
    throw new HttpError(403, "Active doctor profile is required.");
  }
  return me;
}

async function requireManager(actor: Actor) {
  const me = await requireDoctor(actor);
  if (!me.moduleCapabilities.includes("doctor_supervisor") && !me.moduleCapabilities.includes("doctor_admin")) {
    throw new HttpError(403, "Doctor supervisor access is required.");
  }
  return me;
}

export async function getMyAvailability(actor: Actor, input: { dateFrom?: string | null; dateTo?: string | null }) {
  const me = await requireDoctor(actor);
  return listAvailability({ doctorId: me.profile!.id, ...requireDateRange(input) });
}

export async function createMyAvailability(
  actor: Actor,
  input: {
    date: string;
    startTime: string | null;
    endTime: string | null;
    availabilityStatus: AvailabilityStatus;
    note: string | null;
  }
) {
  const me = await requireDoctor(actor);
  return createAvailability({ ...input, doctorId: me.profile!.id }, { userId: actor.userId, doctorId: me.profile!.id });
}

export async function getTeamAvailability(actor: Actor, input: { dateFrom?: string | null; dateTo?: string | null }) {
  await requireManager(actor);
  return listAvailability(requireDateRange(input));
}

export async function createTeamAvailability(
  actor: Actor,
  input: {
    doctorId: number;
    date: string;
    startTime: string | null;
    endTime: string | null;
    availabilityStatus: AvailabilityStatus;
    note: string | null;
  }
) {
  const me = await requireManager(actor);
  return createAvailability(input, { userId: actor.userId, doctorId: me.profile!.id });
}

export async function removeAvailability(actor: Actor, availabilityId: number) {
  const me = await requireDoctor(actor);
  const manager = me.moduleCapabilities.includes("doctor_supervisor") || me.moduleCapabilities.includes("doctor_admin");
  const removed = await deleteAvailability(
    availabilityId,
    { userId: actor.userId, doctorId: me.profile!.id },
    manager ? {} : { doctorId: me.profile!.id }
  );
  if (!removed) throw new HttpError(404, "Availability entry not found.");
}

export async function getMyLeave(actor: Actor, input: { dateFrom?: string | null; dateTo?: string | null }) {
  const me = await requireDoctor(actor);
  return listLeaveRequests({ doctorId: me.profile!.id, ...requireDateRange(input) });
}

export async function createMyLeave(
  actor: Actor,
  input: { startDate: string; endDate: string; leaveType: LeaveType; reason: string | null }
) {
  const me = await requireDoctor(actor);
  return createLeaveRequest(
    { ...input, doctorId: me.profile!.id, status: "pending", approvedBy: null },
    { userId: actor.userId, doctorId: me.profile!.id }
  );
}

export async function getTeamLeave(actor: Actor, input: { dateFrom?: string | null; dateTo?: string | null }) {
  await requireManager(actor);
  return listLeaveRequests(requireDateRange(input));
}

export async function patchLeaveStatus(actor: Actor, leaveId: number, status: LeaveStatus) {
  const me = await requireManager(actor);
  const leave = await updateLeaveStatus(leaveId, status, { userId: actor.userId, doctorId: me.profile!.id });
  if (!leave) throw new HttpError(404, "Leave request not found.");
  return leave;
}

