import express, { type Request, type Response } from "express";
import { requireAnyRole, requireAuth, requireRecentSupervisorReauth } from "../middleware/auth.js";
import { asyncRoute } from "../utils/async-route.js";
import { asOptionalString } from "../utils/request-coercion.js";
import { asUnknownRecord } from "../utils/records.js";
import { getDiagnosticEvent, getDiagnosticsSummary, listDiagnosticEvents, setDiagnosticResolution } from "../services/system-diagnostics-service.js";

export const systemDiagnosticsRouter = express.Router();
systemDiagnosticsRouter.use(requireAuth, requireAnyRole(["super_admin"]), requireRecentSupervisorReauth);
function eventId(req: Request): string { const value = req.params.eventId; return Array.isArray(value) ? value[0] || "" : value; }
systemDiagnosticsRouter.get("/summary", asyncRoute(async (_req: Request, res: Response) => res.json(await getDiagnosticsSummary())));
systemDiagnosticsRouter.get("/events", asyncRoute(async (req: Request, res: Response) => { const q = asUnknownRecord(req.query); res.json(await listDiagnosticEvents({ severity: asOptionalString(q.severity), source: asOptionalString(q.source), component: asOptionalString(q.component), status: asOptionalString(q.status), dateFrom: asOptionalString(q.dateFrom), dateTo: asOptionalString(q.dateTo), requestId: asOptionalString(q.requestId), page: q.page, pageSize: q.pageSize })); }));
systemDiagnosticsRouter.get("/events/:eventId", asyncRoute(async (req: Request, res: Response) => res.json({ event: await getDiagnosticEvent(eventId(req)) })));
systemDiagnosticsRouter.post("/events/:eventId/resolve", express.json({ limit: "10kb" }), asyncRoute(async (req: Request, res: Response) => { const body = asUnknownRecord(req.body); res.json({ event: await setDiagnosticResolution(eventId(req), req.user!.sub, true, body.note) }); }));
systemDiagnosticsRouter.post("/events/:eventId/reopen", asyncRoute(async (req: Request, res: Response) => res.json({ event: await setDiagnosticResolution(eventId(req), req.user!.sub, false) })));
