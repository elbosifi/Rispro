// @ts-check

import express from "express";
import { requireAuth } from "../middleware/auth.js";
import { asyncRoute } from "../utils/async-route.js";
import {
  confirmNoShow,
  createWalkInQueueEntry,
  getQueueSnapshot,
  scanAppointmentIntoQueue
} from "../services/queue-service.js";

/**
 * @typedef {object} QueueRequest
 * @property {Record<string, unknown>} [body]
 * @property {{ sub: number | string, role: string }} user
 */

export const queueRouter = express.Router();

queueRouter.use(requireAuth);

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

/**
 * @param {unknown} value
 * @returns {number | string}
 */
function asAppointmentId(value) {
  if (typeof value === "number") {
    return value;
  }

  return String(value || "");
}

queueRouter.get(
  "/",
  asyncRoute(async (_req, res) => {
    const queue = await getQueueSnapshot();
    res.json(queue);
  })
);

queueRouter.post(
  "/scan",
  asyncRoute(async (req, res) => {
    const request = /** @type {QueueRequest} */ (req);
    const result = await scanAppointmentIntoQueue(request.body || {}, request.user);
    res.json(result);
  })
);

queueRouter.post(
  "/walk-in",
  asyncRoute(async (req, res) => {
    const request = /** @type {QueueRequest} */ (req);
    const body = /** @type {Record<string, unknown>} */ (request.body || {});
    const result = await createWalkInQueueEntry(request.body || {}, request.user, {
      supervisorUsername: asOptionalString(body.supervisorUsername),
      supervisorPassword: asOptionalString(body.supervisorPassword)
    });
    res.status(201).json(result);
  })
);

queueRouter.post(
  "/confirm-no-show",
  asyncRoute(async (req, res) => {
    const request = /** @type {QueueRequest} */ (req);
    const body = /** @type {Record<string, unknown>} */ (request.body || {});
    const result = await confirmNoShow(asAppointmentId(body.appointmentId), asOptionalString(body.reason), request.user);
    res.json(result);
  })
);
