import { HttpError } from "../../utils/http-error.js";
import type { Role } from "../../types/domain.js";
import type { UserId } from "../../types/http.js";
import { getDoctorMe } from "./profile-service.js";
import {
  appointmentHasDoctorRosterMembership,
  createProtocol,
  getProtocolDetails,
  listProtocolTasks,
  updateProtocol,
} from "./protocol-repository.js";
import type { ProtocolInput, ProtocolStatus } from "./protocol-types.js";

interface Actor {
  userId: UserId;
  appRole: Role;
}

export interface ProtocolFilters {
  dateFrom: string;
  dateTo: string;
  modalityId?: number | null;
  protocolStatus?: string | null;
  unprotocolledOnly?: boolean;
  requiresReport?: boolean | null;
  caseCategory?: string | null;
}

function isManager(capabilities: string[]): boolean {
  return capabilities.includes("doctor_supervisor") || capabilities.includes("doctor_admin");
}

function ensureDateRange(filters: ProtocolFilters): ProtocolFilters {
  if (!filters.dateFrom || !filters.dateTo) throw new HttpError(400, "dateFrom and dateTo are required.");
  if (filters.dateFrom > filters.dateTo) throw new HttpError(400, "dateFrom must be before dateTo.");
  return filters;
}

async function requireProtocolDoctor(actor: Actor) {
  const me = await getDoctorMe(actor.userId, actor.appRole);
  if (!me.hasActiveDoctorProfile || !me.profile) throw new HttpError(403, "Active doctor profile is required.");
  if (!me.canAssignProtocols) throw new HttpError(403, "Doctor is not permitted to assign protocols.");
  return me;
}

function hasModalityProtocolPermission(me: Awaited<ReturnType<typeof getDoctorMe>>, modalityId: number): boolean {
  if (me.moduleCapabilities.includes("doctor_admin")) return true;
  return me.allowedModalities.some((permission) => permission.modalityId === modalityId && permission.canProtocol);
}

async function requireProtocolEligibility(actor: Actor, appointmentId: number) {
  const me = await requireProtocolDoctor(actor);
  const details = await getProtocolDetails(appointmentId);
  if (!details) throw new HttpError(404, "Appointment not found.");
  if (!hasModalityProtocolPermission(me, details.appointment.modalityId)) {
    throw new HttpError(403, "Doctor is not permitted to protocol this modality.");
  }
  const profile = me.profile;
  if (!profile) throw new HttpError(403, "Active doctor profile is required.");
  const manager = isManager(me.moduleCapabilities);
  if (!manager && !details.appointment.rosterAssignmentId) {
    throw new HttpError(403, "Case is not assigned to a rostered team.");
  }
  if (!manager && !(await appointmentHasDoctorRosterMembership(appointmentId, profile.id))) {
    throw new HttpError(403, "Doctor is not a member of the assigned roster team.");
  }
  return { me, details, manager };
}

export async function getProtocolTasks(actor: Actor, filters: ProtocolFilters) {
  const me = await requireProtocolDoctor(actor);
  return listProtocolTasks(me.profile!.id, isManager(me.moduleCapabilities), ensureDateRange(filters));
}

export async function getProtocolForAppointment(actor: Actor, appointmentId: number) {
  const { details } = await requireProtocolEligibility(actor, appointmentId);
  return details;
}

export async function saveProtocolForAppointment(
  actor: Actor,
  appointmentId: number,
  input: ProtocolInput & { protocolStatus?: ProtocolStatus; reason?: string | null }
) {
  const { me, details } = await requireProtocolEligibility(actor, appointmentId);
  const status = input.protocolStatus ?? "draft";
  if (status === "clarification_needed" && !input.reason?.trim()) throw new HttpError(400, "Clarification reason is required.");
  if (status === "cancelled" && !input.reason?.trim()) throw new HttpError(400, "Cancellation reason is required.");

  if (!details.protocol) {
    return createProtocol({ ...input, appointmentId, doctorId: me.profile!.id, status });
  }
  return updateProtocol(appointmentId, {
    ...input,
    doctorId: me.profile!.id,
    status,
    eventType: status === "assigned" ? "protocol_assigned" : "protocol_updated",
  });
}

export async function assignProtocolForAppointment(actor: Actor, appointmentId: number, input: ProtocolInput) {
  const { me, details } = await requireProtocolEligibility(actor, appointmentId);
  if (!details.protocol) {
    return createProtocol({ ...input, appointmentId, doctorId: me.profile!.id, status: "assigned" });
  }
  return updateProtocol(appointmentId, {
    ...input,
    doctorId: me.profile!.id,
    status: "assigned",
    eventType: "protocol_assigned",
  });
}

export async function requestProtocolClarification(actor: Actor, appointmentId: number, input: ProtocolInput & { reason: string }) {
  const { me, details } = await requireProtocolEligibility(actor, appointmentId);
  if (!input.reason.trim()) throw new HttpError(400, "Clarification reason is required.");
  if (!details.protocol) {
    return createProtocol({ ...input, appointmentId, doctorId: me.profile!.id, status: "clarification_needed" });
  }
  return updateProtocol(appointmentId, {
    ...input,
    doctorId: me.profile!.id,
    status: "clarification_needed",
    eventType: "clarification_requested",
    reason: input.reason,
  });
}

export async function cancelProtocolForAppointment(actor: Actor, appointmentId: number, input: ProtocolInput & { reason: string }) {
  const { me, details } = await requireProtocolEligibility(actor, appointmentId);
  if (!input.reason.trim()) throw new HttpError(400, "Cancellation reason is required.");
  if (!details.protocol) {
    return createProtocol({ ...input, appointmentId, doctorId: me.profile!.id, status: "cancelled" });
  }
  return updateProtocol(appointmentId, {
    ...input,
    doctorId: me.profile!.id,
    status: "cancelled",
    eventType: "protocol_cancelled",
    reason: input.reason,
  });
}
