import express from "express";
import { requireAnyRole, requireAuth } from "../middleware/auth.js";
import { listModalityWorklist, markAppointmentCompleted } from "../services/modality-service.js";

export const modalityRouter = express.Router();

modalityRouter.use(requireAuth, requireAnyRole(["modality_staff", "supervisor"]));

modalityRouter.get("/worklist", async (req, res, next) => {
  try {
    const appointments = await listModalityWorklist({
      date: req.query.date,
      modalityId: req.query.modalityId
    });
    res.json({ appointments });
  } catch (error) {
    next(error);
  }
});

modalityRouter.post("/:appointmentId/complete", async (req, res, next) => {
  try {
    const result = await markAppointmentCompleted(req.params.appointmentId, req.user.sub);
    res.json(result);
  } catch (error) {
    next(error);
  }
});
