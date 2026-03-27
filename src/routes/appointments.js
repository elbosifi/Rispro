import express from "express";
import { requireAuth } from "../middleware/auth.js";
import { asyncRoute } from "../utils/async-route.js";
import {
  cancelAppointment,
  createAppointment,
  createExamType,
  getAppointmentPrintDetails,
  listAppointmentLookups,
  listAppointmentsForPrint,
  listAvailability,
  updateAppointment,
  updateAppointmentProtocol
} from "../services/appointment-service.js";

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
    const appointments = await listAppointmentsForPrint({
      date: req.query.date,
      dateFrom: req.query.dateFrom,
      dateTo: req.query.dateTo,
      modalityId: req.query.modalityId,
      query: req.query.q
    });
    res.json({ appointments });
  })
);

appointmentsRouter.get(
  "/availability",
  asyncRoute(async (req, res) => {
    const days = req.query.days ? Number(req.query.days) : 14;
    const availability = await listAvailability(req.query.modalityId, days);
    res.json({ availability });
  })
);

appointmentsRouter.get(
  "/:appointmentId",
  asyncRoute(async (req, res) => {
    const appointment = await getAppointmentPrintDetails(req.params.appointmentId);
    res.json({ appointment });
  })
);

appointmentsRouter.post(
  "/exam-types",
  asyncRoute(async (req, res) => {
    const examType = await createExamType(req.body || {}, req.user.sub);
    res.status(201).json({ examType });
  })
);

appointmentsRouter.post(
  "/",
  asyncRoute(async (req, res) => {
    const result = await createAppointment(req.body || {}, req.user);
    res.status(201).json(result);
  })
);

appointmentsRouter.put(
  "/:appointmentId",
  asyncRoute(async (req, res) => {
    const appointment = await updateAppointment(req.params.appointmentId, req.body || {}, req.user);
    res.json({ appointment });
  })
);

appointmentsRouter.put(
  "/:appointmentId/protocol",
  asyncRoute(async (req, res) => {
    await updateAppointmentProtocol(req.params.appointmentId, req.body || {}, req.user);
    const appointment = await getAppointmentPrintDetails(req.params.appointmentId);
    res.json({ appointment });
  })
);

appointmentsRouter.post(
  "/:appointmentId/cancel",
  asyncRoute(async (req, res) => {
    const result = await cancelAppointment(req.params.appointmentId, req.body?.cancelReason, req.user.sub);
    res.json(result);
  })
);
