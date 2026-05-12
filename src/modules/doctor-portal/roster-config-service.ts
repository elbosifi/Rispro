import { HttpError } from "../../utils/http-error.js";
import type { Role } from "../../types/domain.js";
import type { UserId } from "../../types/http.js";
import { requireRosterManager } from "./roster-service.js";
import {
  listRosterDutyTypes,
  listRosterShiftImportMappings,
  upsertRosterDutyType,
  upsertRosterShiftImportMapping,
} from "./roster-config-repository.js";

interface Actor {
  userId: UserId;
  appRole: Role;
}

function cleanSortOrder(value: unknown): number {
  const parsed = Number(value ?? 100);
  if (!Number.isInteger(parsed)) throw new HttpError(400, "sortOrder must be an integer.");
  return parsed;
}

export async function getRosterDutyTypesForManager(actor: Actor, includeInactive = false) {
  await requireRosterManager(actor);
  return listRosterDutyTypes(includeInactive);
}

export async function saveRosterDutyTypeForManager(actor: Actor, input: {
  code: string;
  label: string;
  active: boolean;
  requiresSpecialist: boolean;
  sortOrder: unknown;
}) {
  const me = await requireRosterManager(actor);
  try {
    return await upsertRosterDutyType({
      code: input.code,
      label: input.label,
      active: input.active,
      requiresSpecialist: input.requiresSpecialist,
      sortOrder: cleanSortOrder(input.sortOrder),
    }, { userId: actor.userId, doctorId: me.profile!.id });
  } catch (error) {
    if (error instanceof Error && error.message === "invalid_roster_duty_type") {
      throw new HttpError(400, "Duty type code and label are required.");
    }
    throw error;
  }
}

export async function getRosterShiftImportMappingsForManager(actor: Actor, includeInactive = false) {
  await requireRosterManager(actor);
  return listRosterShiftImportMappings(includeInactive);
}

export async function saveRosterShiftImportMappingForManager(actor: Actor, input: {
  id?: number | null;
  sourceSystem: string;
  sourceShiftName: string | null;
  sourceShiftType: string | null;
  sourceShiftAbbreviation: string | null;
  dutyTypeCode: string;
  modalityId: number | null;
  teamName: string | null;
  active: boolean;
}) {
  const me = await requireRosterManager(actor);
  return upsertRosterShiftImportMapping(input, { userId: actor.userId, doctorId: me.profile!.id });
}
