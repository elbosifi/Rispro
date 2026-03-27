import express from "express";
import { requireAuth } from "../middleware/auth.js";
import {
  confirmNoShow,
  createWalkInQueueEntry,
  getQueueSnapshot,
  scanAppointmentIntoQueue
} from "../services/queue-service.js";

export const queueRouter = express.Router();

queueRouter.use(requireAuth);

queueRouter.get("/", async (_req, res, next) => {
  try {
    const queue = await getQueueSnapshot();
    res.json(queue);
  } catch (error) {
    next(error);
  }
});

queueRouter.post("/scan", async (req, res, next) => {
  try {
    const result = await scanAppointmentIntoQueue(req.body?.accessionNumber, req.user);
    res.json(result);
  } catch (error) {
    next(error);
  }
});

queueRouter.post("/walk-in", async (req, res, next) => {
  try {
    const result = await createWalkInQueueEntry(req.body || {}, req.user);
    res.status(201).json(result);
  } catch (error) {
    next(error);
  }
});

queueRouter.post("/confirm-no-show", async (req, res, next) => {
  try {
    const result = await confirmNoShow(req.body?.appointmentId, req.body?.reason, req.user);
    res.json(result);
  } catch (error) {
    next(error);
  }
});
