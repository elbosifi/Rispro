import express from "express";
import { requireAuth } from "../middleware/auth.js";
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

appointmentsRouter.get("/lookups", async (_req, res, next) => {
  try {
    const lookups = await listAppointmentLookups();
    res.json(lookups);
  } catch (error) {
    next(error);
  }
});

appointmentsRouter.get("/", async (req, res, next) => {
  try {
    const appointments = await listAppointmentsForPrint({
      date: req.query.date,
      dateFrom: req.query.dateFrom,
      dateTo: req.query.dateTo,
      modalityId: req.query.modalityId
    });
    res.json({ appointments });
  } catch (error) {
    next(error);
  }
});

appointmentsRouter.get("/availability", async (req, res, next) => {
  try {
    const days = req.query.days ? Number(req.query.days) : 14;
    const availability = await listAvailability(req.query.modalityId, days);
    res.json({ availability });
  } catch (error) {
    next(error);
  }
});

appointmentsRouter.get("/:appointmentId", async (req, res, next) => {
  try {
    const appointment = await getAppointmentPrintDetails(req.params.appointmentId);
    res.json({ appointment });
  } catch (error) {
    next(error);
  }
});

appointmentsRouter.post("/exam-types", async (req, res, next) => {
  try {
    const examType = await createExamType(req.body || {});
    res.status(201).json({ examType });
  } catch (error) {
    next(error);
  }
});

appointmentsRouter.post("/", async (req, res, next) => {
  try {
    const result = await createAppointment(req.body || {}, req.user);
    res.status(201).json(result);
  } catch (error) {
    next(error);
  }
});

appointmentsRouter.put("/:appointmentId", async (req, res, next) => {
  try {
    const appointment = await updateAppointment(req.params.appointmentId, req.body || {}, req.user);
    res.json({ appointment });
  } catch (error) {
    next(error);
  }
});

appointmentsRouter.put("/:appointmentId/protocol", async (req, res, next) => {
  try {
    await updateAppointmentProtocol(req.params.appointmentId, req.body || {}, req.user);
    const appointment = await getAppointmentPrintDetails(req.params.appointmentId);
    res.json({ appointment });
  } catch (error) {
    next(error);
  }
});

appointmentsRouter.post("/:appointmentId/cancel", async (req, res, next) => {
  try {
    const result = await cancelAppointment(req.params.appointmentId, req.body?.cancelReason, req.user.sub);
    res.json(result);
  } catch (error) {
    next(error);
  }
});
