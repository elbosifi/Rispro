import express from "express";
import { requireAnyRole, requireAuth } from "../middleware/auth.js";
import { asyncRoute } from "../utils/async-route.js";
import { listModalityWorklist, markAppointmentCompleted } from "../services/modality-service.js";

export const modalityRouter = express.Router();

modalityRouter.use(requireAuth, requireAnyRole(["modality_staff", "supervisor"]));

modalityRouter.get(
  "/worklist",
  asyncRoute(async (req, res) => {
    const appointments = await listModalityWorklist({
      date: req.query.date,
      modalityId: req.query.modalityId,
      scope: req.query.scope
    });
    res.json({ appointments });
  })
);

modalityRouter.post(
  "/:appointmentId/complete",
  asyncRoute(async (req, res) => {
    const result = await markAppointmentCompleted(req.params.appointmentId, req.user.sub);
    res.json(result);
  })
);
