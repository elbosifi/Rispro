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

const router = Router();
router.use("/templates", doctorRosterTemplateRouter);

interface DoctorRequest extends Request {
  user?: AuthenticatedUserContext;
}

const DUTY_TYPES = new Set<RosterDutyType>([
  "ct_protocol_day",
  "ct_reporting_day",
  "mri_supervision_reporting",
  "ultrasound_term_1",
  "ultrasound_term_2",
  "ultrasound_term_3",
  "mammography_session",
  "general_reporting",
  "on_call",
  "leave",
  "admin",
  "teaching",
]);

const TEAM_ROLES = new Set<RosterTeamRole>(["lead", "specialist", "sho", "supervisor", "observer"]);

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
  if (!DUTY_TYPES.has(dutyType as RosterDutyType)) {
    throw new HttpError(400, "Unsupported dutyType.");
  }
  return dutyType as RosterDutyType;
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
