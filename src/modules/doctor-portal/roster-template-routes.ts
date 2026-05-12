import { Router, type Request, type Response } from "express";
import { asyncRoute } from "../../utils/async-route.js";
import { asOptionalBoolean, asOptionalString, asString } from "../../utils/request-coercion.js";
import { asUnknownRecord } from "../../utils/records.js";
import { HttpError } from "../../utils/http-error.js";
import type { AuthenticatedUserContext } from "../../types/http.js";
import type { RosterDutyType, RosterTeamRole } from "./roster-types.js";
import type { RosterTemplateAssignmentInput, RosterTemplateCopyMode, RosterTemplateInput, RosterTemplateType } from "./roster-template-types.js";
import {
  applyRosterTemplateForManager,
  createRosterTemplateForAdmin,
  deactivateRosterTemplateForAdmin,
  getRosterTemplate,
  getRosterTemplates,
  updateRosterTemplateForAdmin,
} from "./roster-template-service.js";

interface DoctorRequest extends Request {
  user?: AuthenticatedUserContext;
}

const TEMPLATE_TYPES = new Set<RosterTemplateType>(["ct_weekly", "mri_weekly", "ultrasound_weekly", "mammography_weekly", "mixed_weekly", "custom"]);
const COPY_MODES = new Set<RosterTemplateCopyMode>(["structure_only", "structure_with_named_doctors"]);
const TEAM_ROLES = new Set<RosterTeamRole>(["lead", "specialist", "sho", "supervisor", "observer"]);

function actor(req: DoctorRequest) {
  if (!req.user) throw new HttpError(401, "Authentication required.");
  return { userId: req.user.sub, appRole: req.user.role };
}

function asPositiveInteger(value: unknown, field: string): number {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) throw new HttpError(400, `${field} must be a positive integer.`);
  return parsed;
}

function asOptionalNumber(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  return asPositiveInteger(value, "modalityId");
}

function parseTemplateType(value: unknown): RosterTemplateType {
  const templateType = String(value ?? "").trim();
  if (!TEMPLATE_TYPES.has(templateType as RosterTemplateType)) throw new HttpError(400, "Unsupported templateType.");
  return templateType as RosterTemplateType;
}

function parseCopyMode(value: unknown): RosterTemplateCopyMode {
  const copyMode = String(value ?? "structure_only").trim();
  if (!COPY_MODES.has(copyMode as RosterTemplateCopyMode)) throw new HttpError(400, "Unsupported copyMode.");
  return copyMode as RosterTemplateCopyMode;
}

function parseDutyType(value: unknown): RosterDutyType {
  const dutyType = String(value ?? "").trim();
  if (!dutyType) throw new HttpError(400, "dutyType is required.");
  return dutyType as RosterDutyType;
}

function parseTeamRole(value: unknown): RosterTeamRole {
  const teamRole = String(value ?? "").trim();
  if (!TEAM_ROLES.has(teamRole as RosterTeamRole)) throw new HttpError(400, "Unsupported teamRole.");
  return teamRole as RosterTeamRole;
}

function parseTemplateAssignments(value: unknown): RosterTemplateAssignmentInput[] {
  if (!Array.isArray(value)) return [];
  return value.map((item, index) => {
    const row = asUnknownRecord(item);
    const dayOfWeek = Number(row.dayOfWeek);
    if (!Number.isInteger(dayOfWeek) || dayOfWeek < 1 || dayOfWeek > 7) throw new HttpError(400, "dayOfWeek must be 1 through 7.");
    const members = Array.isArray(row.members) ? row.members.map((member) => {
      const memberRow = asUnknownRecord(member);
      return {
        doctorId: asOptionalNumber(memberRow.doctorId),
        teamRole: parseTeamRole(memberRow.teamRole),
        placeholderLabel: asOptionalString(memberRow.placeholderLabel) ?? null,
        requiredRole: asOptionalString(memberRow.requiredRole) ?? null,
      };
    }) : [];
    return {
      dayOfWeek,
      modalityId: asOptionalNumber(row.modalityId),
      dutyType: parseDutyType(row.dutyType),
      sessionName: asOptionalString(row.sessionName) ?? null,
      startTime: asOptionalString(row.startTime) ?? null,
      endTime: asOptionalString(row.endTime) ?? null,
      teamName: asOptionalString(row.teamName) ?? `Template team ${index + 1}`,
      sortOrder: Number.isInteger(Number(row.sortOrder)) ? Number(row.sortOrder) : index,
      members,
    };
  });
}

function parseTemplateInput(body: Record<string, unknown>): RosterTemplateInput {
  return {
    name: asString(body.name),
    description: asOptionalString(body.description) ?? null,
    modalityId: asOptionalNumber(body.modalityId),
    templateType: parseTemplateType(body.templateType),
    assignments: parseTemplateAssignments(body.assignments),
  };
}

const router = Router();

router.get(
  "/",
  asyncRoute(async (req: DoctorRequest, res: Response) => {
    res.json({ templates: await getRosterTemplates(actor(req)) });
  })
);

router.get(
  "/:id",
  asyncRoute(async (req: DoctorRequest, res: Response) => {
    res.json({ template: await getRosterTemplate(actor(req), asPositiveInteger(req.params.id, "templateId")) });
  })
);

router.post(
  "/",
  asyncRoute(async (req: DoctorRequest, res: Response) => {
    const template = await createRosterTemplateForAdmin(actor(req), parseTemplateInput(asUnknownRecord(req.body)));
    res.status(201).json({ template });
  })
);

router.patch(
  "/:id",
  asyncRoute(async (req: DoctorRequest, res: Response) => {
    const body = asUnknownRecord(req.body);
    const template = await updateRosterTemplateForAdmin(actor(req), asPositiveInteger(req.params.id, "templateId"), {
      ...(body.name !== undefined && { name: asString(body.name) }),
      ...(body.description !== undefined && { description: asOptionalString(body.description) ?? null }),
      ...(body.modalityId !== undefined && { modalityId: asOptionalNumber(body.modalityId) }),
      ...(body.templateType !== undefined && { templateType: parseTemplateType(body.templateType) }),
      ...(body.assignments !== undefined && { assignments: parseTemplateAssignments(body.assignments) }),
    });
    res.json({ template });
  })
);

router.delete(
  "/:id",
  asyncRoute(async (req: DoctorRequest, res: Response) => {
    await deactivateRosterTemplateForAdmin(actor(req), asPositiveInteger(req.params.id, "templateId"));
    res.status(204).end();
  })
);

router.post(
  "/:id/apply",
  asyncRoute(async (req: DoctorRequest, res: Response) => {
    const body = asUnknownRecord(req.body);
    const result = await applyRosterTemplateForManager(actor(req), asPositiveInteger(req.params.id, "templateId"), {
      targetWeekStartDate: asString(body.target_week_start_date ?? body.targetWeekStartDate),
      copyMode: parseCopyMode(body.copy_mode ?? body.copyMode),
      overwriteExisting: asOptionalBoolean(body.overwrite_existing ?? body.overwriteExisting) ?? false,
      modalityId: asOptionalNumber(body.modality_id ?? body.modalityId),
    });
    res.json(result);
  })
);

export { router as doctorRosterTemplateRouter };

