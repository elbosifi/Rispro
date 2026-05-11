import { Router, type Request, type Response } from "express";
import { asyncRoute } from "../../utils/async-route.js";
import { asOptionalString, asString } from "../../utils/request-coercion.js";
import { asUnknownRecord } from "../../utils/records.js";
import { HttpError } from "../../utils/http-error.js";
import type { AuthenticatedUserContext } from "../../types/http.js";
import { addWorkloadCatalogRule, getTeamWorkloadSummary, getWorkloadCatalog, runWorkloadCalculation } from "./workload-service.js";
import type { CaseAssignmentType } from "./case-assignment-rules.js";

const router = Router();
const ASSIGNMENT_TYPES = new Set<CaseAssignmentType>(["imaging", "protocol", "reporting", "ultrasound_operator", "mammography_episode"]);

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
  const parsed = optionalPositiveInteger(value, field);
  if (parsed === null) throw new HttpError(400, `${field} is required.`);
  return parsed;
}

function optionalBoolean(value: unknown): boolean | null {
  if (value === null || value === undefined || value === "") return null;
  if (value === true || value === "true") return true;
  if (value === false || value === "false") return false;
  throw new HttpError(400, "requiresReport must be true or false.");
}

function assignmentType(value: unknown): CaseAssignmentType {
  const parsed = String(value ?? "");
  if (!ASSIGNMENT_TYPES.has(parsed as CaseAssignmentType)) throw new HttpError(400, "Unsupported assignmentType.");
  return parsed as CaseAssignmentType;
}

function numberValue(value: unknown, field: string): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) throw new HttpError(400, `${field} must be a non-negative number.`);
  return parsed;
}

router.get(
  "/summary",
  asyncRoute(async (req: DoctorRequest, res: Response) => {
    const summary = await getTeamWorkloadSummary(actor(req), {
      startDate: asString(req.query.startDate),
      endDate: asString(req.query.endDate),
      modalityId: optionalPositiveInteger(req.query.modalityId, "modalityId"),
      rosterAssignmentId: optionalPositiveInteger(req.query.rosterAssignmentId, "rosterAssignmentId"),
      teamName: asOptionalString(req.query.teamName) ?? null,
      caseCategory: asOptionalString(req.query.caseCategory) ?? null,
      requiresReport: optionalBoolean(req.query.requiresReport),
    });
    res.json({ summary });
  })
);

router.post(
  "/calculate",
  asyncRoute(async (req: DoctorRequest, res: Response) => {
    const body = asUnknownRecord(req.body);
    const summary = await runWorkloadCalculation(actor(req), {
      startDate: asString(body.startDate),
      endDate: asString(body.endDate),
      modalityId: optionalPositiveInteger(body.modalityId, "modalityId"),
    });
    res.json({ summary });
  })
);

router.get(
  "/catalog",
  asyncRoute(async (req: DoctorRequest, res: Response) => {
    const catalog = await getWorkloadCatalog(actor(req));
    res.json({ catalog });
  })
);

router.post(
  "/catalog",
  asyncRoute(async (req: DoctorRequest, res: Response) => {
    const body = asUnknownRecord(req.body);
    const rule = await addWorkloadCatalogRule(actor(req), {
      modalityId: requiredPositiveInteger(body.modalityId, "modalityId"),
      examTypeId: optionalPositiveInteger(body.examTypeId, "examTypeId"),
      caseCategory: asOptionalString(body.caseCategory) ?? null,
      assignmentType: assignmentType(body.assignmentType),
      baseUnits: numberValue(body.baseUnits, "baseUnits"),
      reportRequiredMultiplier: numberValue(body.reportRequiredMultiplier ?? 1, "reportRequiredMultiplier"),
      noReportUnits: numberValue(body.noReportUnits ?? 0, "noReportUnits"),
      effectiveFrom: asString(body.effectiveFrom),
      effectiveTo: asOptionalString(body.effectiveTo) ?? null,
    });
    res.status(201).json({ rule });
  })
);

export { router as doctorWorkloadRouter };
