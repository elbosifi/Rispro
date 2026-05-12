import { HttpError } from "../../utils/http-error.js";
import type { Role } from "../../types/domain.js";
import type { UserId } from "../../types/http.js";
import { getDoctorMe } from "./profile-service.js";
import { calculateWorkloadUnits, createCatalogRule, deactivateCatalogRule, listCatalogRules, listWorkloadSummary, updateCatalogRule } from "./workload-repository.js";
import type { CaseAssignmentType } from "./case-assignment-rules.js";

interface Actor {
  userId: UserId;
  appRole: Role;
}

function isManager(capabilities: string[]): boolean {
  return capabilities.includes("doctor_supervisor") || capabilities.includes("doctor_admin");
}

async function requireWorkloadDoctor(actor: Actor) {
  const me = await getDoctorMe(actor.userId, actor.appRole);
  if (!me.hasActiveDoctorProfile || !me.profile) throw new HttpError(403, "Active doctor profile is required.");
  return me;
}

async function requireWorkloadManager(actor: Actor) {
  const me = await requireWorkloadDoctor(actor);
  if (!isManager(me.moduleCapabilities)) throw new HttpError(403, "Doctor supervisor access is required.");
  return me;
}

async function requireWorkloadAdmin(actor: Actor) {
  const me = await requireWorkloadDoctor(actor);
  if (!me.moduleCapabilities.includes("doctor_admin")) throw new HttpError(403, "Doctor admin access is required.");
  return me;
}

function ensureRange(startDate: string, endDate: string) {
  if (!startDate || !endDate) throw new HttpError(400, "startDate and endDate are required.");
  if (startDate > endDate) throw new HttpError(400, "startDate must be before endDate.");
}

export async function getTeamWorkloadSummary(actor: Actor, filters: {
  startDate: string;
  endDate: string;
  modalityId?: number | null;
  rosterAssignmentId?: number | null;
  teamName?: string | null;
  caseCategory?: string | null;
  requiresReport?: boolean | null;
}) {
  ensureRange(filters.startDate, filters.endDate);
  const me = await requireWorkloadDoctor(actor);
  return listWorkloadSummary(me.profile!.id, isManager(me.moduleCapabilities), filters);
}

export async function runWorkloadCalculation(actor: Actor, input: { startDate: string; endDate: string; modalityId?: number | null }) {
  ensureRange(input.startDate, input.endDate);
  const me = await requireWorkloadManager(actor);
  return calculateWorkloadUnits({ startDate: input.startDate, endDate: input.endDate, modalityId: input.modalityId ?? null }, {
    userId: actor.userId,
    doctorId: me.profile!.id,
  });
}

export async function getWorkloadCatalog(actor: Actor) {
  await requireWorkloadManager(actor);
  return listCatalogRules();
}

export async function addWorkloadCatalogRule(actor: Actor, input: {
  modalityId: number;
  examTypeId: number | null;
  caseCategory: string | null;
  assignmentType: CaseAssignmentType;
  baseUnits: number;
  reportRequiredMultiplier: number;
  noReportUnits: number;
  effectiveFrom: string;
  effectiveTo: string | null;
}) {
  await requireWorkloadAdmin(actor);
  return createCatalogRule({ ...input, actorUserId: actor.userId });
}

export async function editWorkloadCatalogRule(actor: Actor, id: number, input: {
  modalityId?: number;
  examTypeId?: number | null;
  caseCategory?: string | null;
  assignmentType?: CaseAssignmentType;
  baseUnits?: number;
  reportRequiredMultiplier?: number;
  noReportUnits?: number;
  active?: boolean;
  effectiveFrom?: string;
  effectiveTo?: string | null;
}) {
  await requireWorkloadAdmin(actor);
  const rule = await updateCatalogRule({ id, ...input, actorUserId: actor.userId });
  if (!rule) throw new HttpError(404, "Workload catalog rule not found.");
  return rule;
}

export async function removeWorkloadCatalogRule(actor: Actor, id: number) {
  await requireWorkloadAdmin(actor);
  const rule = await deactivateCatalogRule(id, actor.userId);
  if (!rule) throw new HttpError(404, "Workload catalog rule not found.");
  return rule;
}
