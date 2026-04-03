// @ts-check

import express from "express";
import { requireAuth } from "../middleware/auth.js";
import { asyncRoute } from "../utils/async-route.js";
import {
  cancelAppointment,
  createAppointment,
  createExamType,
  getAppointmentDaySettings,
  getAppointmentPrintDetails,
  listAppointmentStatistics,
  listAppointmentLookups,
  listAppointmentsForPrint,
  listAvailability,
  updateAppointment,
  updateAppointmentProtocol
} from "../services/appointment-service.js";

/**
 * @typedef {object} AppointmentsRequest
 * @property {Record<string, unknown>} [query]
 * @property {Record<string, unknown>} [body]
 * @property {{ appointmentId?: string }} [params]
 * @property {{ sub: number | string, role: string }} [user]
 */

export const appointmentsRouter = express.Router();

appointmentsRouter.use(requireAuth);

appointmentsRouter.get(
  "/lookups",
  asyncRoute(async (_req, res) => {
    const lookups = await listAppointmentLookups();
    res.json(lookups);
  })
);

appointmentsRouter.get(
  "/",
  asyncRoute(async (req, res) => {
    const request = /** @type {AppointmentsRequest} */ (req);
    // Parse status array from query (handles both ?status[]=x&status[]=y and ?status=x)
    let status;
    if (request.query?.["status[]"]) {
      status = Array.isArray(request.query["status[]"])
        ? request.query["status[]"]
        : [request.query["status[]"]];
    } else if (request.query?.status) {
      status = Array.isArray(request.query.status)
        ? request.query.status
        : [request.query.status];
    }

    const appointments = await listAppointmentsForPrint({
      date: request.query?.date,
      dateFrom: request.query?.dateFrom,
      dateTo: request.query?.dateTo,
      modalityId: request.query?.modalityId,
      query: request.query?.q,
      status: status
    });
    res.json({ appointments });
  })
);

appointmentsRouter.get(
  "/availability",
  asyncRoute(async (req, res) => {
    const request = /** @type {AppointmentsRequest} */ (req);
    const days = request.query?.days ? Number(request.query.days) : 14;
    const availability = await listAvailability(request.query?.modalityId, days);
    res.json({ availability });
  })
);

appointmentsRouter.get(
  "/day-settings",
  asyncRoute(async (_req, res) => {
    const settings = await getAppointmentDaySettings();
    res.json(settings);
  })
);

appointmentsRouter.get(
  "/statistics",
  asyncRoute(async (req, res) => {
    const request = /** @type {AppointmentsRequest} */ (req);
    const statistics = await listAppointmentStatistics({
      date: request.query?.date,
      dateFrom: request.query?.dateFrom,
      dateTo: request.query?.dateTo,
      modalityId: request.query?.modalityId
    });
    res.json(statistics);
  })
);

appointmentsRouter.get(
  "/:appointmentId",
  asyncRoute(async (req, res) => {
    const request = /** @type {AppointmentsRequest} */ (req);
    const appointment = await getAppointmentPrintDetails(request.params?.appointmentId);
    res.json({ appointment });
  })
);

appointmentsRouter.post(
  "/exam-types",
  asyncRoute(async (req, res) => {
    const request = /** @type {AppointmentsRequest} */ (req);
    const examType = await createExamType(request.body || {}, request.user?.sub);
    res.status(201).json({ examType });
  })
);

appointmentsRouter.post(
  "/",
  asyncRoute(async (req, res) => {
    const request = /** @type {AppointmentsRequest} */ (req);
    const body = /** @type {Record<string, unknown>} */ (request.body || {});
    const result = await createAppointment(request.body || {}, request.user, {
      supervisorUsername: String(body.supervisorUsername || ""),
      supervisorPassword: String(body.supervisorPassword || "")
    });
    res.status(201).json(result);
  })
);

appointmentsRouter.put(
  "/:appointmentId",
  asyncRoute(async (req, res) => {
    const request = /** @type {AppointmentsRequest} */ (req);
    const body = /** @type {Record<string, unknown>} */ (request.body || {});
    const appointment = await updateAppointment(request.params?.appointmentId, request.body || {}, request.user, {
      supervisorUsername: String(body.supervisorUsername || ""),
      supervisorPassword: String(body.supervisorPassword || "")
    });
    res.json({ appointment });
  })
);

appointmentsRouter.put(
  "/:appointmentId/protocol",
  asyncRoute(async (req, res) => {
    const request = /** @type {AppointmentsRequest} */ (req);
    await updateAppointmentProtocol(request.params?.appointmentId, request.body || {}, request.user);
    const appointment = await getAppointmentPrintDetails(request.params?.appointmentId);
    res.json({ appointment });
  })
);

appointmentsRouter.post(
  "/:appointmentId/cancel",
  asyncRoute(async (req, res) => {
    const request = /** @type {AppointmentsRequest} */ (req);
    const result = await cancelAppointment(request.params?.appointmentId, request.body?.cancelReason, request.user?.sub);
    res.json(result);
  })
);
