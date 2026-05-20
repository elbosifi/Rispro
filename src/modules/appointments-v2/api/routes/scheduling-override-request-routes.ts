import { Router, Request, Response } from "express";
import { requireAuth } from "../../../../middleware/auth.js";
import { asyncRoute } from "../../../../utils/async-route.js";
import type { AuthenticatedUserContext } from "../../../../types/http.js";
import {
  approveSchedulingOverrideRequest,
  cancelSchedulingOverrideRequest,
  createSchedulingOverrideRequest,
  getSchedulingOverrideRequestForUser,
  listSchedulingOverrideRequestsForUser,
  parseSchedulingOverrideRequestFilters,
  rejectSchedulingOverrideRequest,
} from "../../scheduling-override-requests/services/scheduling-override-request.service.js";
import { SchedulingError } from "../../shared/errors/scheduling-error.js";

interface AuthenticatedRequest extends Request {
  user?: AuthenticatedUserContext;
}

function userId(req: AuthenticatedRequest): number {
  return Number(req.user?.sub ?? 0);
}

function requestId(req: Request): number {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) {
    throw new SchedulingError(400, "Invalid scheduling override request ID.", ["invalid_override_request_id"]);
  }
  return id;
}

export const schedulingOverrideRequestRouter = Router();
schedulingOverrideRequestRouter.use(requireAuth);

schedulingOverrideRequestRouter.post(
  "/",
  asyncRoute(async (req: AuthenticatedRequest, res: Response) => {
    const body = (req.body ?? {}) as Record<string, unknown>;
    const request = await createSchedulingOverrideRequest(
      {
        requestType: String(body.requestType ?? body.request_type ?? ""),
        bookingId: body.bookingId == null ? null : Number(body.bookingId),
        requestPayload: (body.requestPayload ?? body.request_payload ?? {}) as Record<string, unknown>,
        requesterReason: String(body.requesterReason ?? body.requester_reason ?? ""),
        createdFromContext: body.createdFromContext == null ? null : String(body.createdFromContext),
      },
      userId(req),
      req.user?.role
    );
    res.status(201).json({ request });
  })
);

schedulingOverrideRequestRouter.get(
  "/",
  asyncRoute(async (req: AuthenticatedRequest, res: Response) => {
    const filters = parseSchedulingOverrideRequestFilters(req.query as Record<string, unknown>);
    const requests = await listSchedulingOverrideRequestsForUser(filters, userId(req), req.user?.role);
    res.json({ requests });
  })
);

schedulingOverrideRequestRouter.get(
  "/:id",
  asyncRoute(async (req: AuthenticatedRequest, res: Response) => {
    const id = requestId(req);
    const request = await getSchedulingOverrideRequestForUser(id, userId(req), req.user?.role);
    res.json({ request });
  })
);

schedulingOverrideRequestRouter.post(
  "/:id/approve",
  asyncRoute(async (req: AuthenticatedRequest, res: Response) => {
    const id = requestId(req);
    const body = (req.body ?? {}) as Record<string, unknown>;
    const result = await approveSchedulingOverrideRequest(
      id,
      userId(req),
      req.user?.role,
      body.approverReason == null ? null : String(body.approverReason)
    );
    res.json(result);
  })
);

schedulingOverrideRequestRouter.post(
  "/:id/reject",
  asyncRoute(async (req: AuthenticatedRequest, res: Response) => {
    const id = requestId(req);
    const body = (req.body ?? {}) as Record<string, unknown>;
    const request = await rejectSchedulingOverrideRequest(
      id,
      userId(req),
      req.user?.role,
      String(body.approverReason ?? "")
    );
    res.json({ request });
  })
);

schedulingOverrideRequestRouter.post(
  "/:id/cancel",
  asyncRoute(async (req: AuthenticatedRequest, res: Response) => {
    const id = requestId(req);
    const request = await cancelSchedulingOverrideRequest(id, userId(req), req.user?.role);
    res.json({ request });
  })
);
