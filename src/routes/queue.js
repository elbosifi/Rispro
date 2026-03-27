import express from "express";
import { hasRecentSupervisorReauth, requireAuth } from "../middleware/auth.js";
import { asyncRoute } from "../utils/async-route.js";
import {
  confirmNoShow,
  createWalkInQueueEntry,
  getQueueSnapshot,
  scanAppointmentIntoQueue
} from "../services/queue-service.js";

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
    const result = await scanAppointmentIntoQueue(req.body?.accessionNumber, req.user);
    res.json(result);
  })
);

queueRouter.post(
  "/walk-in",
  asyncRoute(async (req, res) => {
    const result = await createWalkInQueueEntry(req.body || {}, req.user, {
      supervisorReauthOk: hasRecentSupervisorReauth(req)
    });
    res.status(201).json(result);
  })
);

queueRouter.post(
  "/confirm-no-show",
  asyncRoute(async (req, res) => {
    const result = await confirmNoShow(req.body?.appointmentId, req.body?.reason, req.user);
    res.json(result);
  })
);
