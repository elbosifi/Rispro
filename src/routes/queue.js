// @ts-check

import express from "express";
import { requireAuth } from "../middleware/auth.js";
import { asyncRoute } from "../utils/async-route.js";
import { asOptionalString, asUserId } from "../utils/request-coercion.js";
import { asUnknownRecord } from "../utils/records.js";
import {
  confirmNoShow,
  createWalkInQueueEntry,
  getQueueSnapshot,
  scanAppointmentIntoQueue
} from "../services/queue-service.js";

/** @typedef {import("../types/http.js").AuthenticatedUserContext} AuthenticatedUserContext */
/** @typedef {import("../types/http.js").UnknownRecord} UnknownRecord */
/** @typedef {import("../types/http.js").UserId} UserId */

/**
 * @typedef {object} QueueRequest
 * @property {UnknownRecord} [body]
 * @property {AuthenticatedUserContext} user
 */

export const queueRouter = express.Router();

queueRouter.use(requireAuth);

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
    const body = asUnknownRecord(request.body);
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
    const body = asUnknownRecord(request.body);
    const result = await confirmNoShow(asUserId(body.appointmentId), asOptionalString(body.reason), request.user);
    res.json(result);
  })
);
