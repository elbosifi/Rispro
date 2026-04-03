// @ts-check

import express from "express";
import { requireAnyRole, requireAuth } from "../middleware/auth.js";
import { asyncRoute } from "../utils/async-route.js";
import { listModalityWorklist, markAppointmentCompleted } from "../services/modality-service.js";

/**
 * @typedef {object} ModalityRequest
 * @property {Record<string, unknown>} [query]
 * @property {{ appointmentId?: string }} [params]
 * @property {{ sub: number | string, role: string }} user
 */

export const modalityRouter = express.Router();

modalityRouter.use(requireAuth, requireAnyRole(["modality_staff", "supervisor"]));

/**
 * @param {unknown} value
 * @returns {string | undefined}
 */
function asOptionalString(value) {
  if (value === null || value === undefined || value === "") {
    return undefined;
  }

  return String(value);
}

modalityRouter.get(
  "/worklist",
  asyncRoute(async (req, res) => {
    const request = /** @type {ModalityRequest} */ (req);
    const query = /** @type {Record<string, unknown>} */ (request.query || {});
    const appointments = await listModalityWorklist({
      date: asOptionalString(query.date),
      modalityId: asOptionalString(query.modalityId),
      scope: asOptionalString(query.scope)
    });
    res.json({ appointments });
  })
);

modalityRouter.post(
  "/:appointmentId/complete",
  asyncRoute(async (req, res) => {
    const request = /** @type {ModalityRequest} */ (req);
    const result = await markAppointmentCompleted(asOptionalString(request.params?.appointmentId) || "", request.user.sub);
    res.json(result);
  })
);
