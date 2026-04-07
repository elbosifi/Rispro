import express, { Request, Response, Router } from "express";
import { requireAuth } from "../middleware/auth.js";
import { asyncRoute } from "../utils/async-route.js";
import { asOptionalString, asStringArray } from "../utils/request-coercion.js";
import { UnknownRecord, AuthenticatedUserContext } from "../types/http.js";
import {
  cancelAppointment,
  createAppointment,
  createExamType,
  deleteAppointment,
  getAppointmentDaySettings,
  getAppointmentPrintDetails,
  listAppointmentStatistics,
  listAppointmentLookups,
  listAppointmentsForPrint,
  listAvailability,
  updateAppointment,
  updateAppointmentProtocol
} from "../services/appointment-service.js";

export const appointmentsRouter: Router = express.Router();

appointmentsRouter.use(requireAuth);

appointmentsRouter.get(
  "/lookups",
  asyncRoute(async (_req: Request, res: Response) => {
    const lookups = await listAppointmentLookups();
    res.json(lookups);
  })
);

appointmentsRouter.get(
  "/",
  asyncRoute(async (req: Request, res: Response) => {
    const query = req.query as UnknownRecord;
    // Parse status array from query (handles both ?status[]=x&status[]=y and ?status=x)
    let status: string[] | undefined;
    if (query["status[]"]) {
      status = asStringArray(query["status[]"]);
    } else if (query.status) {
      status = asStringArray(query.status);
    }

    const appointments = await listAppointmentsForPrint({
      date: asOptionalString(query.date),
      dateFrom: asOptionalString(query.dateFrom),
      dateTo: asOptionalString(query.dateTo),
      modalityId: asOptionalString(query.modalityId),
      query: asOptionalString(query.q),
      status
    });
    res.json({ appointments });
  })
);

appointmentsRouter.get(
  "/availability",
  asyncRoute(async (req: Request, res: Response) => {
    const query = req.query as UnknownRecord;
    const days = query.days ? Number(query.days) : 14;
    const offset = query.offset ? Number(query.offset) : 0;
    const availability = await listAvailability(asOptionalString(query.modalityId), days, offset);
    res.json({ availability });
  })
);

appointmentsRouter.get(
  "/day-settings",
  asyncRoute(async (_req: Request, res: Response) => {
    const settings = await getAppointmentDaySettings();
    res.json(settings);
  })
);

appointmentsRouter.get(
  "/statistics",
  asyncRoute(async (req: Request, res: Response) => {
    const query = req.query as UnknownRecord;
    const statistics = await listAppointmentStatistics({
      date: asOptionalString(query.date),
      dateFrom: asOptionalString(query.dateFrom),
      dateTo: asOptionalString(query.dateTo),
      modalityId: asOptionalString(query.modalityId)
    });
    res.json(statistics);
  })
);

appointmentsRouter.get(
  "/:appointmentId",
  asyncRoute(async (req: Request, res: Response) => {
    const params = req.params as { appointmentId?: string };
    const appointment = await getAppointmentPrintDetails(String(params?.appointmentId || ""));
    res.json({ appointment });
  })
);

appointmentsRouter.post(
  "/exam-types",
  asyncRoute(async (req: Request, res: Response) => {
    const typedReq = req as Request & { user: AuthenticatedUserContext };
    const examType = await createExamType(req.body || {}, typedReq.user.sub);
    res.status(201).json({ examType });
  })
);

appointmentsRouter.post(
  "/",
  asyncRoute(async (req: Request, res: Response) => {
    const typedReq = req as Request & { user: AuthenticatedUserContext; body: Record<string, unknown> };
    const body = typedReq.body as UnknownRecord;
    const result = await createAppointment(typedReq.body || {}, typedReq.user, {
      supervisorUsername: String(body.supervisorUsername || ""),
      supervisorPassword: String(body.supervisorPassword || "")
    });
    res.status(201).json(result);
  })
);

appointmentsRouter.put(
  "/:appointmentId",
  asyncRoute(async (req: Request, res: Response) => {
    const typedReq = req as Request & { user: AuthenticatedUserContext; body: Record<string, unknown>; params: { appointmentId?: string } };
    const body = typedReq.body as UnknownRecord;
    const appointment = await updateAppointment(String(typedReq.params?.appointmentId || ""), typedReq.body || {}, typedReq.user, {
      supervisorUsername: String(body.supervisorUsername || ""),
      supervisorPassword: String(body.supervisorPassword || "")
    });
    res.json({ appointment });
  })
);

appointmentsRouter.put(
  "/:appointmentId/protocol",
  asyncRoute(async (req: Request, res: Response) => {
    const typedReq = req as Request & { user: AuthenticatedUserContext; body: Record<string, unknown>; params: { appointmentId?: string } };
    await updateAppointmentProtocol(String(typedReq.params?.appointmentId || ""), typedReq.body || {}, typedReq.user);
    const appointment = await getAppointmentPrintDetails(String(typedReq.params?.appointmentId || ""));
    res.json({ appointment });
  })
);

appointmentsRouter.post(
  "/:appointmentId/cancel",
  asyncRoute(async (req: Request, res: Response) => {
    const typedReq = req as Request & { user: AuthenticatedUserContext; body: Record<string, unknown>; params: { appointmentId?: string } };
    const body = typedReq.body as UnknownRecord;
    const result = await cancelAppointment(
      String(typedReq.params?.appointmentId || ""),
      asOptionalString(body.cancelReason) || "",
      typedReq.user.sub
    );
    res.json(result);
  })
);

appointmentsRouter.delete(
  "/:appointmentId",
  asyncRoute(async (req: Request, res: Response) => {
    const typedReq = req as Request & { user: AuthenticatedUserContext; params: { appointmentId?: string } };
    const result = await deleteAppointment(String(typedReq.params?.appointmentId || ""), typedReq.user.sub);
    res.json(result);
  })
);
