// @ts-check

import express from "express";
import { requireAuth } from "../middleware/auth.js";
import { asyncRoute } from "../utils/async-route.js";
import { asOptionalString, asStringArray } from "../utils/request-coercion.js";
import { asUnknownRecord } from "../utils/records.js";
import {
  cancelAppointment,
  createAppointment,
  createExamType,
  getAppointmentDaySettings,
  getAppointmentPrintDetails,
  listAppointmentStatistics,
  listAppointmentLookups,
  listAppointmentsForPrint,
  listAppointmentsCalendarSummary,
  listAppointmentsByDate,
  listAvailability,
  updateAppointment,
  updateAppointmentProtocol
} from "../services/appointment-service.js";

/** @typedef {import("../types/http.js").AuthenticatedUserContext} AuthenticatedUserContext */
/** @typedef {import("../types/http.js").UnknownRecord} UnknownRecord */

/**
 * @typedef {object} AppointmentsRequest
 * @property {UnknownRecord} [query]
 * @property {UnknownRecord} [body]
 * @property {{ appointmentId?: string }} [params]
 * @property {AuthenticatedUserContext} user
 */

export const appointmentsRouter = express.Router();

appointmentsRouter.use(requireAuth);

// Calendar routes first — before any parameterized routes like /:appointmentId
appointmentsRouter.get(
  "/calendar-summary",
  asyncRoute(async (req, res) => {
    const request = /** @type {AppointmentsRequest} */ (req);
    const query = asUnknownRecord(request.query);
    const summary = await listAppointmentsCalendarSummary({
      dateFrom: asOptionalString(query.dateFrom) || "",
      dateTo: asOptionalString(query.dateTo) || "",
      modalityId: asOptionalString(query.modalityId)
    });
    res.json(summary);
  })
);

appointmentsRouter.get(
  "/by-date",
  asyncRoute(async (req, res) => {
    const request = /** @type {AppointmentsRequest} */ (req);
    const query = asUnknownRecord(request.query);
    const appointments = await listAppointmentsByDate({
      date: asOptionalString(query.date) || "",
      modalityId: asOptionalString(query.modalityId)
    });
    res.json({ appointments });
  })
);

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
    const query = asUnknownRecord(request.query);
    // Parse status array from query (handles both ?status[]=x&status[]=y and ?status=x)
    let status;
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
      status: status
    });
    res.json({ appointments });
  })
);

appointmentsRouter.get(
  "/availability",
  asyncRoute(async (req, res) => {
    const request = /** @type {AppointmentsRequest} */ (req);
    const query = asUnknownRecord(request.query);
    const days = query.days ? Number(query.days) : 14;
    const availability = await listAvailability(asOptionalString(query.modalityId), days);
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
    const query = asUnknownRecord(request.query);
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
  asyncRoute(async (req, res) => {
    const request = /** @type {AppointmentsRequest} */ (req);
    const appointment = await getAppointmentPrintDetails(String(request.params?.appointmentId || ""));
    res.json({ appointment });
  })
);

appointmentsRouter.post(
  "/exam-types",
  asyncRoute(async (req, res) => {
    const request = /** @type {AppointmentsRequest} */ (req);
    const examType = await createExamType(request.body || {}, request.user.sub);
    res.status(201).json({ examType });
  })
);

appointmentsRouter.post(
  "/",
  asyncRoute(async (req, res) => {
    const request = /** @type {AppointmentsRequest} */ (req);
    const body = asUnknownRecord(request.body);
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
    const body = asUnknownRecord(request.body);
    const appointment = await updateAppointment(String(request.params?.appointmentId || ""), request.body || {}, request.user, {
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
    await updateAppointmentProtocol(String(request.params?.appointmentId || ""), request.body || {}, request.user);
    const appointment = await getAppointmentPrintDetails(String(request.params?.appointmentId || ""));
    res.json({ appointment });
  })
);

appointmentsRouter.post(
  "/:appointmentId/cancel",
  asyncRoute(async (req, res) => {
    const request = /** @type {AppointmentsRequest} */ (req);
    const body = asUnknownRecord(request.body);
    const result = await cancelAppointment(
      String(request.params?.appointmentId || ""),
      asOptionalString(body.cancelReason) || "",
      request.user.sub
    );
    res.json(result);
  })
);
