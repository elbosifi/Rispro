import { Router, type Request, type Response } from "express";
import { asyncRoute } from "../../utils/async-route.js";
import { asOptionalBoolean, asOptionalString, asString } from "../../utils/request-coercion.js";
import { asUnknownRecord } from "../../utils/records.js";
import { HttpError } from "../../utils/http-error.js";
import type { AuthenticatedUserContext } from "../../types/http.js";
import type { ReportingBoardFilters, ReportingBoardNotificationSettings } from "./reporting-board-types.js";
import {
  bulkAssignNextReportingBoardCases,
  createReportingBoardSavedView,
  getReportingBoardCases,
  getReportingBoardSettings,
  listMyReportingBoardSavedViews,
  loadReportingBoardSavedViewByToken,
  putReportingBoardSettings,
  updateReportingBoardSavedView,
} from "./reporting-board-service.js";

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

function optionalNonNegativeInteger(value: unknown, field: string): number | null {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 0) throw new HttpError(400, `${field} must be zero or a positive integer.`);
  return parsed;
}

function booleanFromQuery(value: unknown): boolean | null {
  const parsed = asOptionalBoolean(value);
  return parsed ?? null;
}

function filtersFromQuery(query: Request["query"]): ReportingBoardFilters {
  return {
    dateFrom: asOptionalString(query.dateFrom) ?? null,
    dateTo: asOptionalString(query.dateTo) ?? null,
    cutoffDate: asOptionalString(query.cutoffDate) ?? null,
    modalityId: optionalPositiveInteger(query.modalityId, "modalityId"),
    modalityCode: asOptionalString(query.modalityCode) ?? null,
    assignedDoctorId: optionalPositiveInteger(query.assignedDoctorId, "assignedDoctorId"),
    assignmentStatus: (asOptionalString(query.assignmentStatus) as ReportingBoardFilters["assignmentStatus"]) ?? null,
    caseCategory: asOptionalString(query.caseCategory) ?? null,
    requiresReport: booleanFromQuery(query.requiresReport),
    reportStatus: (asOptionalString(query.reportStatus) as ReportingBoardFilters["reportStatus"]) ?? null,
    priorityCode: asOptionalString(query.priorityCode) ?? null,
    limit: optionalPositiveInteger(query.limit, "limit"),
    offset: optionalNonNegativeInteger(query.offset, "offset"),
  };
}

function filtersFromBody(value: unknown): ReportingBoardFilters {
  const body = asUnknownRecord(value);
  return {
    ...body,
    modalityId: optionalPositiveInteger(body.modalityId, "modalityId"),
    assignedDoctorId: optionalPositiveInteger(body.assignedDoctorId, "assignedDoctorId"),
    requiresReport: asOptionalBoolean(body.requiresReport) ?? null,
    limit: body.limit === undefined ? null : optionalPositiveInteger(body.limit, "limit"),
    offset: body.offset === undefined ? null : optionalNonNegativeInteger(body.offset, "offset"),
  } as ReportingBoardFilters;
}

function notificationSettings(value: unknown): ReportingBoardNotificationSettings {
  const body = asUnknownRecord(value);
  return {
    notifyNewMatchingCases: asOptionalBoolean(body.notifyNewMatchingCases) ?? false,
    notifyAssignedToMe: asOptionalBoolean(body.notifyAssignedToMe) ?? false,
    notifyReportFinal: asOptionalBoolean(body.notifyReportFinal) ?? false,
    notifyUnassignedUrgent: asOptionalBoolean(body.notifyUnassignedUrgent) ?? false,
    notifyOlderThanCutoff: asOptionalBoolean(body.notifyOlderThanCutoff) ?? false,
  };
}

router.get(
  "/settings",
  asyncRoute(async (_req: DoctorRequest, res: Response) => {
    res.json({ settings: await getReportingBoardSettings() });
  })
);

router.put(
  "/settings",
  asyncRoute(async (req: DoctorRequest, res: Response) => {
    const body = asUnknownRecord(req.body);
    res.json({ settings: await putReportingBoardSettings(actor(req), body) });
  })
);

router.get(
  "/cases",
  asyncRoute(async (req: DoctorRequest, res: Response) => {
    res.json(await getReportingBoardCases(actor(req), filtersFromQuery(req.query)));
  })
);

router.get(
  "/saved-views",
  asyncRoute(async (req: DoctorRequest, res: Response) => {
    res.json({ savedViews: await listMyReportingBoardSavedViews(actor(req)) });
  })
);

router.post(
  "/saved-views",
  asyncRoute(async (req: DoctorRequest, res: Response) => {
    const body = asUnknownRecord(req.body);
    const view = await createReportingBoardSavedView(actor(req), {
      name: asString(body.name),
      filters: filtersFromBody(body.filters ?? {}),
      notificationSettings: notificationSettings(body.notificationSettings ?? {}),
    });
    res.status(201).json({ savedView: view });
  })
);

router.patch(
  "/saved-views/:id",
  asyncRoute(async (req: DoctorRequest, res: Response) => {
    const body = asUnknownRecord(req.body);
    const view = await updateReportingBoardSavedView(actor(req), {
      id: requiredPositiveInteger(req.params.id, "id"),
      name: body.name === undefined ? undefined : asString(body.name),
      filters: body.filters === undefined ? undefined : filtersFromBody(body.filters),
      notificationSettings: body.notificationSettings === undefined ? undefined : notificationSettings(body.notificationSettings),
      active: body.active === undefined ? undefined : asOptionalBoolean(body.active),
    });
    res.json({ savedView: view });
  })
);

router.get(
  "/saved-views/token/:token",
  asyncRoute(async (req: DoctorRequest, res: Response) => {
    res.json({ savedView: await loadReportingBoardSavedViewByToken(actor(req), asString(req.params.token)) });
  })
);

router.post(
  "/bulk-assign-next",
  asyncRoute(async (req: DoctorRequest, res: Response) => {
    const body = asUnknownRecord(req.body);
    const result = await bulkAssignNextReportingBoardCases(actor(req), {
      doctorId: requiredPositiveInteger(body.doctorId, "doctorId"),
      count: requiredPositiveInteger(body.count, "count"),
      filters: body.filters === undefined ? null : filtersFromBody(body.filters),
      savedViewId: optionalPositiveInteger(body.savedViewId, "savedViewId"),
      token: asOptionalString(body.token) ?? null,
      unassignedOnly: asOptionalBoolean(body.unassignedOnly) ?? true,
      reason: asString(body.reason),
    });
    res.json(result);
  })
);

export { router as doctorReportingBoardRouter };
