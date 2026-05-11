import { HttpError } from "../../utils/http-error.js";
import type { Role } from "../../types/domain.js";
import type { UserId } from "../../types/http.js";
import {
  applyRosterTemplate,
  createRosterTemplate,
  deactivateRosterTemplate,
  findRosterTemplateById,
  listRosterTemplates,
  updateRosterTemplate,
} from "./roster-template-repository.js";
import type { RosterTemplateCopyMode, RosterTemplateInput } from "./roster-template-types.js";
import { requireRosterDoctor, requireRosterManager } from "./roster-service.js";
import { pool } from "../../db/pool.js";

interface Actor {
  userId: UserId;
  appRole: Role;
}

async function requireRosterAdmin(actor: Actor) {
  const me = await requireRosterDoctor(actor);
  if (!me.moduleCapabilities.includes("doctor_admin")) {
    throw new HttpError(403, "Doctor admin access is required.");
  }
  return me;
}

export async function getRosterTemplates(actor: Actor) {
  await requireRosterManager(actor);
  return listRosterTemplates();
}

export async function getRosterTemplate(actor: Actor, templateId: number) {
  await requireRosterManager(actor);
  const template = await findRosterTemplateById(pool, templateId);
  if (!template || !template.active) throw new HttpError(404, "Roster template not found.");
  return template;
}

export async function createRosterTemplateForAdmin(actor: Actor, input: RosterTemplateInput) {
  const me = await requireRosterAdmin(actor);
  return createRosterTemplate(input, { userId: actor.userId, doctorId: me.profile!.id });
}

export async function updateRosterTemplateForAdmin(actor: Actor, templateId: number, input: Partial<RosterTemplateInput>) {
  const me = await requireRosterAdmin(actor);
  const template = await updateRosterTemplate(templateId, input, { userId: actor.userId, doctorId: me.profile!.id });
  if (!template) throw new HttpError(404, "Roster template not found.");
  return template;
}

export async function deactivateRosterTemplateForAdmin(actor: Actor, templateId: number) {
  const me = await requireRosterAdmin(actor);
  const removed = await deactivateRosterTemplate(templateId, { userId: actor.userId, doctorId: me.profile!.id });
  if (!removed) throw new HttpError(404, "Roster template not found.");
}

export async function applyRosterTemplateForManager(
  actor: Actor,
  templateId: number,
  input: {
    targetWeekStartDate: string;
    copyMode: RosterTemplateCopyMode;
    overwriteExisting: boolean;
    modalityId: number | null;
  }
) {
  const me = await requireRosterManager(actor);
  try {
    return await applyRosterTemplate(templateId, input, { userId: actor.userId, doctorId: me.profile!.id });
  } catch (error) {
    if (error instanceof Error && error.message === "template_not_found") {
      throw new HttpError(404, "Roster template not found.");
    }
    if (error instanceof Error && error.message === "target_week_not_draft") {
      throw new HttpError(409, "Template can only be applied to a draft roster week.");
    }
    throw error;
  }
}

