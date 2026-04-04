// @ts-check

import express from "express";
import { requireAnyRole, requireAuth } from "../middleware/auth.js";
import { asyncRoute } from "../utils/async-route.js";
import { asOptionalString } from "../utils/request-coercion.js";
import { asUnknownRecord } from "../utils/records.js";
import { listModalityWorklist, markAppointmentCompleted } from "../services/modality-service.js";

/** @typedef {import("../types/http.js").AuthenticatedUserContext} AuthenticatedUserContext */
/** @typedef {import("../types/http.js").UnknownRecord} UnknownRecord */

/**
 * @typedef {object} ModalityRequest
 * @property {UnknownRecord} [query]
 * @property {{ appointmentId?: string }} [params]
 * @property {AuthenticatedUserContext} user
 */

export const modalityRouter = express.Router();

modalityRouter.use(requireAuth, requireAnyRole(["modality_staff", "supervisor"]));

modalityRouter.get(
  "/worklist",
  asyncRoute(async (req, res) => {
    const request = /** @type {ModalityRequest} */ (req);
    const query = asUnknownRecord(request.query);
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
