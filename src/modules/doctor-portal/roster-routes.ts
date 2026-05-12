import { Router, type Request, type Response } from "express";
import { asyncRoute } from "../../utils/async-route.js";
import { asOptionalString, asString } from "../../utils/request-coercion.js";
import { asUnknownRecord } from "../../utils/records.js";
import { HttpError } from "../../utils/http-error.js";
import type { AuthenticatedUserContext } from "../../types/http.js";
import type { RosterDutyType, RosterTeamRole } from "./roster-types.js";
import { doctorRosterTemplateRouter } from "./roster-template-routes.js";
import {
  addRosterAssignment,
  addRosterMember,
  archiveRosterWeek,
  copyPreviousRosterWeek,
  createDraftRosterWeek,
  getMyRosterForDoctor,
  getRosterWeekConflicts,
  getRosterWeekForManager,
  listRosterDoctors,
  patchRosterAssignment,
  publishRosterWeek,
  removeRosterAssignment,
  removeRosterMember,
  updateDraftRosterWeek,
  validateRosterAssignment,
} from "./roster-service.js";
import {
  exportRosterWeek,
  generateRosterDraftForManager,
  getRosterWeekNotificationsForManager,
  notifyRosterWeekForManager,
} from "./roster-planning-service.js";
import {
  getRosterDutyTypesForManager,
  getRosterShiftImportMappingsForManager,
  saveRosterDutyTypeForManager,
  saveRosterShiftImportMappingForManager,
} from "./roster-config-service.js";
import {
  confirmRosterXmlImportForManager,
  previewRosterXmlImportForManager,
} from "./roster-xml-import-service.js";
import type { DoctorRole } from "./profile-repository.js";
import type { RosterBalanceStrategy, RosterExportFormat } from "./roster-planning-types.js";

const router = Router();
router.use("/templates", doctorRosterTemplateRouter);

interface DoctorRequest extends Request {
  user?: AuthenticatedUserContext;
}

const TEAM_ROLES = new Set<RosterTeamRole>(["lead", "specialist", "sho", "supervisor", "observer"]);
const BALANCE_STRATEGIES = new Set<RosterBalanceStrategy>(["simple", "preserve_previous", "least_assigned"]);
const EXPORT_FORMATS = new Set<RosterExportFormat>(["html", "csv"]);
const DOCTOR_ROLES = new Set<DoctorRole>(["consultant", "specialist", "senior_house_officer", "resident"]);

function actor(req: DoctorRequest) {
  if (!req.user) throw new HttpError(401, "Authentication required.");
  return { userId: req.user.sub, appRole: req.user.role };
}

function asPositiveInteger(value: unknown, field: string): number {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new HttpError(400, `${field} must be a positive integer.`);
  }
  return parsed;
}

function parseDutyType(value: unknown): RosterDutyType {
  const dutyType = String(value ?? "").trim();
  if (!dutyType) throw new HttpError(400, "dutyType is required.");
  return dutyType as RosterDutyType;
}

function parseDoctorRole(value: unknown): DoctorRole {
  const role = String(value ?? "").trim();
  if (!DOCTOR_ROLES.has(role as DoctorRole)) throw new HttpError(400, "defaultDoctorRole is invalid.");
  return role as DoctorRole;
}

function parseTeamRole(value: unknown): RosterTeamRole {
  const teamRole = String(value ?? "").trim();
  if (!TEAM_ROLES.has(teamRole as RosterTeamRole)) {
    throw new HttpError(400, "Unsupported teamRole.");
  }
  return teamRole as RosterTeamRole;
}

function optionalNumber(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  return asPositiveInteger(value, "modalityId");
}

function optionalNumberPatch(value: unknown): number | null | undefined {
  if (value === undefined) return undefined;
  if (value === null || value === "") return null;
  return asPositiveInteger(value, "modalityId");
}

function optionalNumberByField(value: unknown, field: string): number | null {
  if (value === null || value === undefined || value === "") return null;
  return asPositiveInteger(value, field);
}

function parseBalanceStrategy(value: unknown): RosterBalanceStrategy {
  const parsed = String(value ?? "simple").trim();
  if (!BALANCE_STRATEGIES.has(parsed as RosterBalanceStrategy)) throw new HttpError(400, "Unsupported balanceStrategy.");
  return parsed as RosterBalanceStrategy;
}

function parseExportFormat(value: unknown): RosterExportFormat {
  const parsed = String(value ?? "html").trim();
  if (!EXPORT_FORMATS.has(parsed as RosterExportFormat)) throw new HttpError(400, "Unsupported export format.");
  return parsed as RosterExportFormat;
}

router.get(
  "/weeks",
  asyncRoute(async (req: DoctorRequest, res: Response) => {
    const weekStart = String(req.query.weekStart ?? "").trim();
    if (!weekStart) throw new HttpError(400, "weekStart is required.");
    const roster = await getRosterWeekForManager(actor(req), weekStart);
    res.json(roster);
  })
);

router.post(
  "/weeks",
  asyncRoute(async (req: DoctorRequest, res: Response) => {
    const body = asUnknownRecord(req.body);
    const week = await createDraftRosterWeek(actor(req), {
      weekStartDate: asString(body.weekStartDate),
      weekEndDate: asString(body.weekEndDate),
    });
    res.status(201).json({ week });
  })
);

router.patch(
  "/weeks/:id",
  asyncRoute(async (req: DoctorRequest, res: Response) => {
    const body = asUnknownRecord(req.body);
    const week = await updateDraftRosterWeek(actor(req), asPositiveInteger(req.params.id, "weekId"), {
      weekStartDate: asString(body.weekStartDate),
      weekEndDate: asString(body.weekEndDate),
    });
    res.json({ week });
  })
);

router.post(
  "/weeks/:id/copy-previous",
  asyncRoute(async (req: DoctorRequest, res: Response) => {
    const roster = await copyPreviousRosterWeek(actor(req), asPositiveInteger(req.params.id, "weekId"));
    res.json(roster);
  })
);

router.post(
  "/weeks/:id/publish",
  asyncRoute(async (req: DoctorRequest, res: Response) => {
    const week = await publishRosterWeek(actor(req), asPositiveInteger(req.params.id, "weekId"));
    res.json({ week });
  })
);

router.get(
  "/weeks/:id/conflicts",
  asyncRoute(async (req: DoctorRequest, res: Response) => {
    const conflicts = await getRosterWeekConflicts(actor(req), asPositiveInteger(req.params.id, "weekId"));
    res.json({ conflicts });
  })
);

router.get(
  "/duty-types",
  asyncRoute(async (req: DoctorRequest, res: Response) => {
    const dutyTypes = await getRosterDutyTypesForManager(actor(req), req.query.includeInactive === "true");
    res.json({ dutyTypes });
  })
);

router.post(
  "/duty-types",
  asyncRoute(async (req: DoctorRequest, res: Response) => {
    const body = asUnknownRecord(req.body);
    const dutyType = await saveRosterDutyTypeForManager(actor(req), {
      code: asString(body.code),
      label: asString(body.label),
      active: body.active !== false,
      requiresSpecialist: body.requiresSpecialist === true,
      sortOrder: body.sortOrder,
    });
    res.status(201).json({ dutyType });
  })
);

router.get(
  "/shift-import-mappings",
  asyncRoute(async (req: DoctorRequest, res: Response) => {
    const mappings = await getRosterShiftImportMappingsForManager(actor(req), req.query.includeInactive === "true");
    res.json({ mappings });
  })
);

router.post(
  "/shift-import-mappings",
  asyncRoute(async (req: DoctorRequest, res: Response) => {
    const body = asUnknownRecord(req.body);
    const mapping = await saveRosterShiftImportMappingForManager(actor(req), {
      id: optionalNumberByField(body.id, "id"),
      sourceSystem: asOptionalString(body.sourceSystem) ?? "abc",
      sourceShiftName: asOptionalString(body.sourceShiftName) ?? null,
      sourceShiftType: asOptionalString(body.sourceShiftType) ?? null,
      sourceShiftAbbreviation: asOptionalString(body.sourceShiftAbbreviation) ?? null,
      dutyTypeCode: asString(body.dutyTypeCode),
      modalityId: optionalNumberByField(body.modalityId, "modalityId"),
      teamName: asOptionalString(body.teamName) ?? null,
      active: body.active !== false,
    });
    res.status(201).json({ mapping });
  })
);

router.post(
  "/import/abc/preview",
  asyncRoute(async (req: DoctorRequest, res: Response) => {
    const body = asUnknownRecord(req.body);
    const preview = await previewRosterXmlImportForManager(actor(req), {
      fileContentBase64: asString(body.fileContentBase64),
    });
    res.json({ preview });
  })
);

router.post(
  "/import/abc/confirm",
  asyncRoute(async (req: DoctorRequest, res: Response) => {
    const body = asUnknownRecord(req.body);
    const result = await confirmRosterXmlImportForManager(actor(req), {
      fileContentBase64: asString(body.fileContentBase64),
      createMissingDoctors: body.createMissingDoctors === true,
      temporaryPassword: asString(body.temporaryPassword),
      defaultDoctorRole: parseDoctorRole(body.defaultDoctorRole),
      defaultCoreRole: body.defaultCoreRole === "supervisor" ? "supervisor" : "doctor",
      defaultTeamRole: parseTeamRole(body.defaultTeamRole),
    });
    res.json({ result });
  })
);

router.get(
  "/weeks/:id/export",
  asyncRoute(async (req: DoctorRequest, res: Response) => {
    const payload = await exportRosterWeek(
      actor(req),
      asPositiveInteger(req.params.id, "weekId"),
      parseExportFormat(req.query.format),
      req.query.scope === "full" ? "full" : "my"
    );
    res.setHeader("Content-Type", payload.contentType);
    res.setHeader("Content-Disposition", `attachment; filename="${payload.filename}"`);
    res.send(payload.body);
  })
);

router.post(
  "/weeks/:id/notify",
  asyncRoute(async (req: DoctorRequest, res: Response) => {
    res.status(201).json(await notifyRosterWeekForManager(actor(req), asPositiveInteger(req.params.id, "weekId")));
  })
);

router.get(
  "/weeks/:id/notifications",
  asyncRoute(async (req: DoctorRequest, res: Response) => {
    res.json({ notifications: await getRosterWeekNotificationsForManager(actor(req), asPositiveInteger(req.params.id, "weekId")) });
  })
);

router.post(
  "/weeks/:id/archive",
  asyncRoute(async (req: DoctorRequest, res: Response) => {
    const week = await archiveRosterWeek(actor(req), asPositiveInteger(req.params.id, "weekId"));
    res.json({ week });
  })
);

router.get(
  "/my",
  asyncRoute(async (req: DoctorRequest, res: Response) => {
    const weekStart = typeof req.query.weekStart === "string" ? req.query.weekStart : null;
    const roster = await getMyRosterForDoctor(actor(req), weekStart);
    res.json(roster);
  })
);

router.get(
  "/doctors",
  asyncRoute(async (req: DoctorRequest, res: Response) => {
    const profiles = await listRosterDoctors(actor(req));
    res.json({ profiles });
  })
);

router.post(
  "/generate-draft",
  asyncRoute(async (req: DoctorRequest, res: Response) => {
    const body = asUnknownRecord(req.body);
    const result = await generateRosterDraftForManager(actor(req), {
      weekStartDate: asString(body.weekStartDate),
      templateId: optionalNumberByField(body.templateId, "templateId"),
      modalityId: optionalNumberByField(body.modalityId, "modalityId"),
      includeDoctors: body.includeDoctors === true,
      balanceStrategy: parseBalanceStrategy(body.balanceStrategy),
    });
    res.status(201).json(result);
  })
);

router.post(
  "/assignments",
  asyncRoute(async (req: DoctorRequest, res: Response) => {
    const body = asUnknownRecord(req.body);
    const assignment = await addRosterAssignment(actor(req), {
      rosterWeekId: asPositiveInteger(body.rosterWeekId, "rosterWeekId"),
      date: asString(body.date),
      modalityId: optionalNumber(body.modalityId),
      dutyType: parseDutyType(body.dutyType),
      sessionName: asOptionalString(body.sessionName) ?? null,
      startTime: asOptionalString(body.startTime) ?? null,
      endTime: asOptionalString(body.endTime) ?? null,
      teamName: asString(body.teamName),
      status: asOptionalString(body.status),
    });
    res.status(201).json({ assignment });
  })
);

router.patch(
  "/assignments/:id",
  asyncRoute(async (req: DoctorRequest, res: Response) => {
    const body = asUnknownRecord(req.body);
    const assignment = await patchRosterAssignment(actor(req), asPositiveInteger(req.params.id, "assignmentId"), {
      date: asOptionalString(body.date),
      modalityId: optionalNumberPatch(body.modalityId),
      dutyType: body.dutyType === undefined ? undefined : parseDutyType(body.dutyType),
      sessionName: asOptionalString(body.sessionName) ?? null,
      startTime: asOptionalString(body.startTime) ?? null,
      endTime: asOptionalString(body.endTime) ?? null,
      teamName: asOptionalString(body.teamName),
      status: asOptionalString(body.status),
    });
    res.json({ assignment });
  })
);

router.delete(
  "/assignments/:id",
  asyncRoute(async (req: DoctorRequest, res: Response) => {
    await removeRosterAssignment(actor(req), asPositiveInteger(req.params.id, "assignmentId"));
    res.status(204).end();
  })
);

router.post(
  "/assignments/:id/members",
  asyncRoute(async (req: DoctorRequest, res: Response) => {
    const body = asUnknownRecord(req.body);
    const member = await addRosterMember(
      actor(req),
      asPositiveInteger(req.params.id, "assignmentId"),
      asPositiveInteger(body.doctorId, "doctorId"),
      parseTeamRole(body.teamRole)
    );
    res.status(201).json({ member });
  })
);

router.post(
  "/assignments/:id/validate",
  asyncRoute(async (req: DoctorRequest, res: Response) => {
    const conflicts = await validateRosterAssignment(actor(req), asPositiveInteger(req.params.id, "assignmentId"));
    res.json({ conflicts });
  })
);

router.delete(
  "/assignments/:id/members/:memberId",
  asyncRoute(async (req: DoctorRequest, res: Response) => {
    await removeRosterMember(
      actor(req),
      asPositiveInteger(req.params.id, "assignmentId"),
      asPositiveInteger(req.params.memberId, "memberId")
    );
    res.status(204).end();
  })
);

export { router as doctorRosterRouter };
