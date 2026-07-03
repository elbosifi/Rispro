import { Router, type Request, type Response } from "express";
import { asyncRoute } from "../../utils/async-route.js";
import { asOptionalBoolean, asOptionalString, asString } from "../../utils/request-coercion.js";
import { asUnknownRecord } from "../../utils/records.js";
import { HttpError } from "../../utils/http-error.js";
import type { AuthenticatedUserContext } from "../../types/http.js";
import type { ReportingBoardFilters, ReportingBoardNotificationSettings } from "./reporting-board-types.js";
import {
  assignReportingBoardCaseToDoctor,
  bulkAssignNextReportingBoardCases,
  bulkReassignSelectedReportingBoardCases,
  bulkUnassignSelectedReportingBoardCases,
  cancelScheduledReportingBoardBulkAssignmentJob,
  createScheduledReportingBoardBulkAssignmentJob,
  createScheduledReportingBoardBulkAssignmentJobs,
  createReportingBoardSavedView,
  dismissMyReportingBoardNotification,
  getReportingBoardCases,
  getReportingBoardPushConfig,
  getReportingBoardSonicDicomStudyRedirect,
  getScheduledReportingBoardBulkAssignmentJobs,
  getReportingBoardSettings,
  getReportingBoardStats,
  getMyReportingBoardNotifications,
  listMyReportingBoardSavedViews,
  loadReportingBoardSavedViewByToken,
  markReportingBoardCaseDiscontinued,
  putReportingBoardSettings,
  readAllMyReportingBoardNotifications,
  readMyReportingBoardNotification,
  runScheduledReportingBoardBulkAssignmentJobNow,
  sendReportingBoardSavedViewTestNotification,
  subscribeReportingBoardSavedViewPush,
  unassignReportingBoardCase,
  updateReportingBoardSavedView,
} from "./reporting-board-service.js";

const router = Router();
const REPORTING_BOARD_SORT_BY = new Set([
  "priority_study_date",
  "study_date",
  "accession",
  "patient_name",
  "mrn",
  "exam_type",
  "modality",
  "assigned_doctor",
  "longest_unassigned",
  "longest_assigned_not_final",
  "oldest_completed",
]);
const REPORTING_BOARD_SORT_DIRECTIONS = new Set(["asc", "desc"]);
const REPORTING_BOARD_CASE_SOURCES = new Set(["all", "appointments", "comparisons"]);

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

function positiveIntegerArray(value: unknown, field: string): number[] {
  if (!Array.isArray(value) || value.length === 0) throw new HttpError(400, `${field} must be a non-empty array.`);
  return value.map((item) => requiredPositiveInteger(item, field));
}

function optionalPositiveIntegerArray(value: unknown, field: string): number[] {
  if (value === null || value === undefined) return [];
  if (!Array.isArray(value)) throw new HttpError(400, `${field} must be an array.`);
  return value.map((item) => requiredPositiveInteger(item, field));
}

function booleanFromQuery(value: unknown): boolean | null {
  const parsed = asOptionalBoolean(value);
  return parsed ?? null;
}

function optionalSortBy(value: unknown): ReportingBoardFilters["sortBy"] | null {
  const parsed = asOptionalString(value);
  if (!parsed) return null;
  if (!REPORTING_BOARD_SORT_BY.has(parsed)) throw new HttpError(400, "sortBy is not supported.");
  return parsed as ReportingBoardFilters["sortBy"];
}

function optionalSortDirection(value: unknown): ReportingBoardFilters["sortDirection"] | null {
  const parsed = asOptionalString(value);
  if (!parsed) return null;
  if (!REPORTING_BOARD_SORT_DIRECTIONS.has(parsed)) throw new HttpError(400, "sortDirection must be asc or desc.");
  return parsed as ReportingBoardFilters["sortDirection"];
}

function optionalCaseSource(value: unknown): ReportingBoardFilters["caseSource"] | null {
  const parsed = asOptionalString(value);
  if (!parsed) return null;
  if (!REPORTING_BOARD_CASE_SOURCES.has(parsed)) throw new HttpError(400, "caseSource must be all, appointments, or comparisons.");
  return parsed as ReportingBoardFilters["caseSource"];
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
    q: asOptionalString(query.q) ?? null,
    caseSource: optionalCaseSource(query.caseSource),
    sortBy: optionalSortBy(query.sortBy),
    sortDirection: optionalSortDirection(query.sortDirection),
    pinUrgentToTop: booleanFromQuery(query.pinUrgentToTop),
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
    caseSource: optionalCaseSource(body.caseSource),
    sortBy: optionalSortBy(body.sortBy),
    sortDirection: optionalSortDirection(body.sortDirection),
    pinUrgentToTop: asOptionalBoolean(body.pinUrgentToTop) ?? null,
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
  asyncRoute(async (req: DoctorRequest, res: Response) => {
    res.json({ settings: await getReportingBoardSettings(actor(req)) });
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
  "/cases/:appointmentId/open-sonicdicom",
  asyncRoute(async (req: DoctorRequest, res: Response) => {
    const result = await getReportingBoardSonicDicomStudyRedirect(
      actor(req),
      requiredPositiveInteger(req.params.appointmentId, "appointmentId"),
      asOptionalString(req.query.scope)
    );
    res.redirect(302, result.redirectUrl);
  })
);

router.post(
  "/cases/:appointmentId/discontinue",
  asyncRoute(async (req: DoctorRequest, res: Response) => {
    const body = asUnknownRecord(req.body);
    res.json(await markReportingBoardCaseDiscontinued(
      actor(req),
      requiredPositiveInteger(req.params.appointmentId, "appointmentId"),
      asString(body.reason)
    ));
  })
);

router.get(
  "/stats",
  asyncRoute(async (req: DoctorRequest, res: Response) => {
    res.json(await getReportingBoardStats(actor(req), filtersFromQuery(req.query)));
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
  "/push-config",
  asyncRoute(async (req: DoctorRequest, res: Response) => {
    res.json({ config: await getReportingBoardPushConfig(actor(req)) });
  })
);

router.post(
  "/saved-views/:id/push-subscribe",
  asyncRoute(async (req: DoctorRequest, res: Response) => {
    const body = asUnknownRecord(req.body);
    res.json(await subscribeReportingBoardSavedViewPush(actor(req), {
      savedViewId: requiredPositiveInteger(req.params.id, "id"),
      subscription: asUnknownRecord(body.subscription ?? body),
      userAgent: req.get("user-agent") ?? null,
    }));
  })
);

router.post(
  "/saved-views/:id/test-push",
  asyncRoute(async (req: DoctorRequest, res: Response) => {
    res.json(await sendReportingBoardSavedViewTestNotification(actor(req), requiredPositiveInteger(req.params.id, "id")));
  })
);

router.get(
  "/saved-views/token/:token",
  asyncRoute(async (req: DoctorRequest, res: Response) => {
    res.json({ savedView: await loadReportingBoardSavedViewByToken(actor(req), asString(req.params.token)) });
  })
);

router.post(
  "/:appointmentId/assign-doctor",
  asyncRoute(async (req: DoctorRequest, res: Response) => {
    const body = asUnknownRecord(req.body);
    const result = await assignReportingBoardCaseToDoctor(actor(req), {
      appointmentId: requiredPositiveInteger(req.params.appointmentId, "appointmentId"),
      doctorId: requiredPositiveInteger(body.doctorId, "doctorId"),
      reason: asOptionalString(body.reason) ?? null,
    });
    res.json(result);
  })
);

router.post(
  "/:appointmentId/unassign",
  asyncRoute(async (req: DoctorRequest, res: Response) => {
    const body = asUnknownRecord(req.body);
    const result = await unassignReportingBoardCase(actor(req), {
      appointmentId: requiredPositiveInteger(req.params.appointmentId, "appointmentId"),
      reason: asOptionalString(body.reason) ?? null,
    });
    res.json(result);
  })
);

router.get(
  "/notifications",
  asyncRoute(async (req: DoctorRequest, res: Response) => {
    res.json({ notifications: await getMyReportingBoardNotifications(actor(req)) });
  })
);

router.post(
  "/notifications/read-all",
  asyncRoute(async (req: DoctorRequest, res: Response) => {
    res.json({ count: await readAllMyReportingBoardNotifications(actor(req)) });
  })
);

router.post(
  "/notifications/:id/read",
  asyncRoute(async (req: DoctorRequest, res: Response) => {
    res.json({ notification: await readMyReportingBoardNotification(actor(req), requiredPositiveInteger(req.params.id, "id")) });
  })
);

router.post(
  "/notifications/:id/dismiss",
  asyncRoute(async (req: DoctorRequest, res: Response) => {
    res.json({ notification: await dismissMyReportingBoardNotification(actor(req), requiredPositiveInteger(req.params.id, "id")) });
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
      reason: asOptionalString(body.reason) ?? null,
    });
    res.json(result);
  })
);

function scheduledJobInput(value: unknown) {
  const body = asUnknownRecord(value);
  return {
    scheduledFor: asString(body.scheduledFor),
    doctorId: requiredPositiveInteger(body.doctorId, "doctorId"),
    count: requiredPositiveInteger(body.count, "count"),
    filters: filtersFromBody(body.filters ?? {}),
    savedViewId: optionalPositiveInteger(body.savedViewId, "savedViewId"),
    savedViewName: asOptionalString(body.savedViewName) ?? null,
    reason: asOptionalString(body.reason) ?? null,
  };
}

router.get(
  "/bulk-assignment-jobs",
  asyncRoute(async (req: DoctorRequest, res: Response) => {
    res.json({ jobs: await getScheduledReportingBoardBulkAssignmentJobs(actor(req)) });
  })
);

router.post(
  "/bulk-assignment-jobs",
  asyncRoute(async (req: DoctorRequest, res: Response) => {
    const job = await createScheduledReportingBoardBulkAssignmentJob(actor(req), scheduledJobInput(req.body));
    res.status(201).json({ job });
  })
);

router.post(
  "/bulk-assignment-jobs/batch",
  asyncRoute(async (req: DoctorRequest, res: Response) => {
    const body = asUnknownRecord(req.body);
    if (!Array.isArray(body.jobs)) throw new HttpError(400, "jobs must be an array.");
    const jobs = await createScheduledReportingBoardBulkAssignmentJobs(actor(req), {
      jobs: body.jobs.map((item) => scheduledJobInput(item)),
    });
    res.status(201).json({ jobs });
  })
);

router.post(
  "/bulk-assignment-jobs/:id/cancel",
  asyncRoute(async (req: DoctorRequest, res: Response) => {
    const job = await cancelScheduledReportingBoardBulkAssignmentJob(actor(req), requiredPositiveInteger(req.params.id, "id"));
    res.json({ job });
  })
);

router.post(
  "/bulk-assignment-jobs/:id/run-now",
  asyncRoute(async (req: DoctorRequest, res: Response) => {
    const requestActor = actor(req);
    const job = await runScheduledReportingBoardBulkAssignmentJobNow(
      requestActor,
      requiredPositiveInteger(req.params.id, "id"),
      `api:${requestActor.userId}`
    );
    res.json({ job });
  })
);

router.post(
  "/bulk-reassign-selected",
  asyncRoute(async (req: DoctorRequest, res: Response) => {
    const body = asUnknownRecord(req.body);
    const result = await bulkReassignSelectedReportingBoardCases(actor(req), {
      appointmentIds: optionalPositiveIntegerArray(body.appointmentIds, "appointmentIds"),
      comparisonRequestIds: optionalPositiveIntegerArray(body.comparisonRequestIds, "comparisonRequestIds"),
      doctorId: requiredPositiveInteger(body.doctorId, "doctorId"),
      reason: asOptionalString(body.reason) ?? null,
      allowFinal: asOptionalBoolean(body.allowFinal) ?? false,
    });
    res.json(result);
  })
);

router.post(
  "/bulk-unassign-selected",
  asyncRoute(async (req: DoctorRequest, res: Response) => {
    const body = asUnknownRecord(req.body);
    const result = await bulkUnassignSelectedReportingBoardCases(actor(req), {
      appointmentIds: optionalPositiveIntegerArray(body.appointmentIds, "appointmentIds"),
      comparisonRequestIds: optionalPositiveIntegerArray(body.comparisonRequestIds, "comparisonRequestIds"),
      reason: asOptionalString(body.reason) ?? null,
      allowFinal: asOptionalBoolean(body.allowFinal) ?? false,
    });
    res.json(result);
  })
);

export { router as doctorReportingBoardRouter };
