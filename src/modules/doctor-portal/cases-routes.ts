import { Router, type Request, type Response } from "express";
import { asyncRoute } from "../../utils/async-route.js";
import { asOptionalString, asString } from "../../utils/request-coercion.js";
import { asUnknownRecord } from "../../utils/records.js";
import { HttpError } from "../../utils/http-error.js";
import type { AuthenticatedUserContext } from "../../types/http.js";
import {
  correctDoctorCaseAssignment,
  getMyDoctorCases,
  getTeamDoctorCases,
  getUnassignedDoctorCases,
  runDoctorCaseAssignment,
  type CaseFilters,
} from "./cases-service.js";

const router = Router();

interface DoctorRequest extends Request {
  user?: AuthenticatedUserContext;
}

function actor(req: DoctorRequest) {
  if (!req.user) throw new HttpError(401, "Authentication required.");
  return { userId: req.user.sub, appRole: req.user.role };
}

function optionalPositiveInteger(value: unknown, field: string): number | null {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) throw new HttpError(400, `${field} must be a positive integer.`);
  return parsed;
}

function requiredPositiveInteger(value: unknown, field: string): number {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) throw new HttpError(400, `${field} must be a positive integer.`);
  return parsed;
}

function optionalBoolean(value: unknown): boolean | null {
  if (value === null || value === undefined || value === "") return null;
  if (value === "true" || value === true) return true;
  if (value === "false" || value === false) return false;
  throw new HttpError(400, "requiresReport must be true or false.");
}

function filters(req: DoctorRequest): CaseFilters {
  return {
    dateFrom: asString(req.query.dateFrom),
    dateTo: asString(req.query.dateTo),
    modalityId: optionalPositiveInteger(req.query.modalityId, "modalityId"),
    status: asOptionalString(req.query.status) ?? null,
    requiresReport: optionalBoolean(req.query.requiresReport),
    caseCategory: asOptionalString(req.query.caseCategory) ?? null,
    rosterAssignmentId: optionalPositiveInteger(req.query.rosterAssignmentId, "rosterAssignmentId"),
  };
}

router.get(
  "/my",
  asyncRoute(async (req: DoctorRequest, res: Response) => {
    const cases = await getMyDoctorCases(actor(req), filters(req));
    res.json({ cases });
  })
);

router.get(
  "/team",
  asyncRoute(async (req: DoctorRequest, res: Response) => {
    const cases = await getTeamDoctorCases(actor(req), filters(req));
    res.json({ cases });
  })
);

router.get(
  "/unassigned",
  asyncRoute(async (req: DoctorRequest, res: Response) => {
    const cases = await getUnassignedDoctorCases(actor(req), filters(req));
    res.json({ cases });
  })
);

router.post(
  "/assign",
  asyncRoute(async (req: DoctorRequest, res: Response) => {
    const body = asUnknownRecord(req.body);
    const summary = await runDoctorCaseAssignment(actor(req), {
      dateFrom: asString(body.dateFrom),
      dateTo: asString(body.dateTo),
      modalityId: optionalPositiveInteger(body.modalityId, "modalityId"),
    });
    res.json({ summary });
  })
);

router.post(
  "/:appointmentId/reassign",
  asyncRoute(async (req: DoctorRequest, res: Response) => {
    const body = asUnknownRecord(req.body);
    const result = await correctDoctorCaseAssignment(actor(req), {
      appointmentId: requiredPositiveInteger(req.params.appointmentId, "appointmentId"),
      rosterAssignmentId: requiredPositiveInteger(body.rosterAssignmentId, "rosterAssignmentId"),
      reason: asString(body.reason),
    });
    res.json(result);
  })
);

export { router as doctorCasesRouter };
