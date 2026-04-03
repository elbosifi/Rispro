// @ts-check

import express from "express";
import { requireAnyRole, requireAuth } from "../middleware/auth.js";
import { asyncRoute } from "../utils/async-route.js";
import { listModalityWorklist, markAppointmentCompleted } from "../services/modality-service.js";

/**
 * @typedef {object} ModalityRequest
 * @property {{ date?: string, modalityId?: string, scope?: string }} [query]
 * @property {{ appointmentId?: string }} params
 * @property {{ sub: number | string, role: string }} user
 */

export const modalityRouter = express.Router();

modalityRouter.use(requireAuth, requireAnyRole(["modality_staff", "supervisor"]));

modalityRouter.get(
  "/worklist",
  asyncRoute(async (req, res) => {
    const request = /** @type {ModalityRequest} */ (req);
    const appointments = await listModalityWorklist({
      date: request.query?.date,
      modalityId: request.query?.modalityId,
      scope: request.query?.scope
    });
    res.json({ appointments });
  })
);

modalityRouter.post(
  "/:appointmentId/complete",
  asyncRoute(async (req, res) => {
    const request = /** @type {ModalityRequest} */ (req);
    const result = await markAppointmentCompleted(request.params.appointmentId || "", request.user.sub);
    res.json(result);
  })
);
