import { Router, type Request, type Response } from "express";
import { optionalAuth, requireAuth } from "../../middleware/auth.js";
import { createRateLimiter } from "../../middleware/rate-limit.js";
import { asyncRoute } from "../../utils/async-route.js";
import { asOptionalString } from "../../utils/request-coercion.js";
import { asUnknownRecord } from "../../utils/records.js";
import { HttpError } from "../../utils/http-error.js";
import type { AuthenticatedUserContext } from "../../types/http.js";
import type { ReportingBoardFilters } from "./reporting-board-types.js";
import {
  assignReportingBoardMobileCaseToMe,
  getPublicReportingBoardMobilePushConfig,
  getPublicReportingBoardMobilePushStatus,
  getPublicReportingBoardMobileCase,
  getPublicReportingBoardMobileView,
  reassignReportingBoardMobileCase,
  sendPublicReportingBoardMobileTestPush,
  subscribePublicReportingBoardMobilePush,
  unsubscribePublicReportingBoardMobilePush,
  unassignReportingBoardMobileCase,
} from "./reporting-board-service.js";

const router = Router();
const mobileLimiter = createRateLimiter({
  windowMs: 60_000,
  maxRequests: 60,
  message: "Too many saved-view requests. Please try again later.",
});

interface ReportingPublicRequest extends Request {
  user?: AuthenticatedUserContext;
}

function actor(req: ReportingPublicRequest) {
  return req.user ? { userId: req.user.sub, appRole: req.user.role } : null;
}

function requiredPositiveInteger(value: unknown, field: string): number {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) throw new HttpError(400, `${field} must be a positive integer.`);
  return parsed;
}

function optionalPositiveInteger(value: unknown, field: string): number | null {
  if (value === null || value === undefined || value === "") return null;
  return requiredPositiveInteger(value, field);
}

function optionalNonNegativeInteger(value: unknown, field: string): number | null {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 0) throw new HttpError(400, `${field} must be zero or a positive integer.`);
  return parsed;
}

function requiredReason(value: unknown, field: string): string {
  const reason = asOptionalString(value)?.trim();
  if (!reason) throw new HttpError(400, `${field} is required.`);
  return reason;
}

function caseIdentity(body: Record<string, unknown>) {
  if (body.caseType === "comparison" || body.comparisonRequestId !== undefined) {
    return {
      caseType: "comparison" as const,
      comparisonRequestId: requiredPositiveInteger(body.comparisonRequestId, "comparisonRequestId"),
    };
  }
  return {
    caseType: "appointment" as const,
    appointmentId: requiredPositiveInteger(body.appointmentId, "appointmentId"),
  };
}

function mobileFilters(query: Request["query"]): ReportingBoardFilters {
  const limit = optionalPositiveInteger(query.limit, "limit") ?? 40;
  if (limit > 100) throw new HttpError(400, "limit must be 100 or less for mobile saved views.");
  return {
    dateFrom: asOptionalString(query.dateFrom) ?? null,
    dateTo: asOptionalString(query.dateTo) ?? null,
    q: asOptionalString(query.q) ?? null,
    assignedDoctorId: optionalPositiveInteger(query.assignedDoctorId, "assignedDoctorId"),
    reportStatus: (asOptionalString(query.reportStatus) as ReportingBoardFilters["reportStatus"]) ?? null,
    priorityCode: asOptionalString(query.priorityCode) ?? null,
    urgentOrStat: asOptionalString(query.urgentOrStat) === "true",
    modalityId: optionalPositiveInteger(query.modalityId, "modalityId"),
    modalityCode: asOptionalString(query.modalityCode) ?? null,
    caseCategory: asOptionalString(query.caseCategory) ?? null,
    assignmentStatus: (asOptionalString(query.assignmentStatus) as ReportingBoardFilters["assignmentStatus"]) ?? null,
    caseSource: (asOptionalString(query.caseSource) as ReportingBoardFilters["caseSource"]) ?? null,
    sortBy: (asOptionalString(query.sortBy) as ReportingBoardFilters["sortBy"]) ?? null,
    sortDirection: (asOptionalString(query.sortDirection) as ReportingBoardFilters["sortDirection"]) ?? null,
    overdue: asOptionalString(query.overdue) === "true",
    limit,
    offset: optionalNonNegativeInteger(query.offset, "offset") ?? 0,
  };
}

router.get(
  "/saved-views/public/:token/mobile",
  mobileLimiter,
  optionalAuth,
  asyncRoute(async (req: ReportingPublicRequest, res: Response) => {
    res.json(await getPublicReportingBoardMobileView(actor(req), String(req.params.token || ""), mobileFilters(req.query)));
  })
);

router.get(
  "/saved-views/public/:token/mobile/cases",
  mobileLimiter,
  optionalAuth,
  asyncRoute(async (req: ReportingPublicRequest, res: Response) => {
    res.json(await getPublicReportingBoardMobileView(actor(req), String(req.params.token || ""), mobileFilters(req.query)));
  })
);

router.get(
  "/saved-views/public/:token/mobile/cases/:caseId",
  mobileLimiter,
  optionalAuth,
  asyncRoute(async (req: ReportingPublicRequest, res: Response) => {
    res.json(await getPublicReportingBoardMobileCase(
      actor(req),
      String(req.params.token || ""),
      { caseType: "appointment", appointmentId: requiredPositiveInteger(req.params.caseId, "caseId") },
      mobileFilters(req.query)
    ));
  })
);

router.get(
  "/saved-views/public/:token/mobile/push-config",
  mobileLimiter,
  asyncRoute(async (req: ReportingPublicRequest, res: Response) => {
    res.json({ config: await getPublicReportingBoardMobilePushConfig(String(req.params.token || "")) });
  })
);

router.post(
  "/saved-views/public/:token/mobile/push-subscribe",
  mobileLimiter,
  asyncRoute(async (req: ReportingPublicRequest, res: Response) => {
    const body = asUnknownRecord(req.body);
    res.json(await subscribePublicReportingBoardMobilePush(String(req.params.token || ""), {
      subscription: asUnknownRecord(body.subscription ?? body),
      userAgent: req.get("user-agent") ?? null,
    }));
  })
);

router.post(
  "/saved-views/public/:token/mobile/push-unsubscribe",
  mobileLimiter,
  asyncRoute(async (req: ReportingPublicRequest, res: Response) => {
    const body = asUnknownRecord(req.body);
    res.json(await unsubscribePublicReportingBoardMobilePush(String(req.params.token || ""), asUnknownRecord(body.subscription ?? body)));
  })
);

router.post(
  "/saved-views/public/:token/mobile/push-status",
  mobileLimiter,
  asyncRoute(async (req: ReportingPublicRequest, res: Response) => {
    const body = asUnknownRecord(req.body);
    res.json(await getPublicReportingBoardMobilePushStatus(String(req.params.token || ""), asUnknownRecord(body.subscription ?? body)));
  })
);

router.post(
  "/saved-views/public/:token/mobile/test-push",
  mobileLimiter,
  asyncRoute(async (req: ReportingPublicRequest, res: Response) => {
    res.json(await sendPublicReportingBoardMobileTestPush(String(req.params.token || "")));
  })
);

router.post(
  "/saved-views/public/:token/mobile/assign-to-me",
  requireAuth,
  asyncRoute(async (req: ReportingPublicRequest, res: Response) => {
    const body = (req.body ?? {}) as Record<string, unknown>;
    res.json(await assignReportingBoardMobileCaseToMe(
      actor(req)!,
      String(req.params.token || ""),
      caseIdentity(body),
      asOptionalString(body.reason) ?? null
    ));
  })
);

router.post(
  "/saved-views/public/:token/mobile/reassign",
  requireAuth,
  asyncRoute(async (req: ReportingPublicRequest, res: Response) => {
    const body = (req.body ?? {}) as Record<string, unknown>;
    res.json(await reassignReportingBoardMobileCase(
      actor(req)!,
      String(req.params.token || ""),
      caseIdentity(body),
      requiredPositiveInteger(body.doctorId, "doctorId"),
      requiredReason(body.reason, "reason")
    ));
  })
);

router.post(
  "/saved-views/public/:token/mobile/unassign",
  requireAuth,
  asyncRoute(async (req: ReportingPublicRequest, res: Response) => {
    const body = (req.body ?? {}) as Record<string, unknown>;
    res.json(await unassignReportingBoardMobileCase(
      actor(req)!,
      String(req.params.token || ""),
      caseIdentity(body),
      requiredReason(body.reason, "reason")
    ));
  })
);

router.post(
  "/saved-views/public/:token/mobile/batch-reassign",
  requireAuth,
  asyncRoute(async (_req: ReportingPublicRequest, _res: Response) => {
    throw new HttpError(501, "Batch reassignment is not available from mobile saved views yet.");
  })
);

export { router as reportingBoardPublicRouter };
