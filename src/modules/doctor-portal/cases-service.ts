import { HttpError } from "../../utils/http-error.js";
import type { Role } from "../../types/domain.js";
import type { UserId } from "../../types/http.js";
import { requireRosterDoctor, requireRosterManager } from "./roster-service.js";
import {
  assignCaseToDoctor,
  assignCases,
  listMyCases,
  listTeamCases,
  listUnassignedCases,
  reassignCase,
} from "./cases-repository.js";

interface Actor {
  userId: UserId;
  appRole: Role;
}

export interface CaseFilters {
  dateFrom: string;
  dateTo: string;
  modalityId?: number | null;
  status?: string | null;
  requiresReport?: boolean | null;
  caseCategory?: string | null;
  rosterAssignmentId?: number | null;
}

function ensureDateRange(input: CaseFilters): CaseFilters {
  if (!input.dateFrom || !input.dateTo) throw new HttpError(400, "dateFrom and dateTo are required.");
  if (input.dateFrom > input.dateTo) throw new HttpError(400, "dateFrom must be before dateTo.");
  return input;
}

export async function getMyDoctorCases(actor: Actor, filters: CaseFilters) {
  const me = await requireRosterDoctor(actor);
  return listMyCases(me.profile!.id, ensureDateRange(filters));
}

export async function getTeamDoctorCases(actor: Actor, filters: CaseFilters) {
  await requireRosterManager(actor);
  return listTeamCases(ensureDateRange(filters));
}

export async function getUnassignedDoctorCases(actor: Actor, filters: CaseFilters) {
  await requireRosterManager(actor);
  return listUnassignedCases(ensureDateRange(filters));
}

export async function runDoctorCaseAssignment(actor: Actor, input: { dateFrom: string; dateTo: string; modalityId?: number | null }) {
  const me = await requireRosterManager(actor);
  return assignCases({ dateFrom: input.dateFrom, dateTo: input.dateTo, modalityId: input.modalityId ?? null }, {
    userId: actor.userId,
    doctorId: me.profile!.id,
  });
}

export async function correctDoctorCaseAssignment(
  actor: Actor,
  input: { appointmentId: number; rosterAssignmentId: number; reason: string }
) {
  const me = await requireRosterManager(actor);
  if (!input.reason.trim()) throw new HttpError(400, "Correction reason is required.");
  try {
    return await reassignCase(input, { userId: actor.userId, doctorId: me.profile!.id });
  } catch (error) {
    if (error instanceof Error && error.message === "appointment_not_found") {
      throw new HttpError(404, "Appointment not found.");
    }
    if (error instanceof Error && error.message === "published_roster_assignment_not_found") {
      throw new HttpError(404, "Published roster assignment not found.");
    }
    if (error instanceof Error && error.message === "active_assignment_conflict") {
      throw new HttpError(409, "Case assignment changed while reassignment was being saved. Refresh and try again.");
    }
    throw error;
  }
}

export async function assignDoctorCase(
  actor: Actor,
  input: { appointmentId: number; doctorId: number; rosterAssignmentId?: number | null; reason?: string | null }
) {
  const me = await requireRosterManager(actor);
  try {
    return await assignCaseToDoctor(input, { userId: actor.userId, doctorId: me.profile!.id });
  } catch (error) {
    if (error instanceof Error && error.message === "appointment_not_found") {
      throw new HttpError(404, "Appointment not found.");
    }
    if (error instanceof Error && error.message === "doctor_not_found") {
      throw new HttpError(404, "Active doctor profile not found.");
    }
    if (error instanceof Error && error.message === "roster_assignment_not_found") {
      throw new HttpError(404, "Roster assignment not found.");
    }
    if (error instanceof Error && error.message === "no_report_case_not_assignable") {
      throw new HttpError(400, "No-report cases cannot be assigned for reporting.");
    }
    if (error instanceof Error && error.message === "case_not_assignable") {
      throw new HttpError(400, "Cancelled or deleted cases cannot be assigned.");
    }
    if (error instanceof Error && error.message === "reassignment_reason_required") {
      throw new HttpError(400, "Reassignment reason is required.");
    }
    throw error;
  }
}
