import express, { Request, Response, Router } from "express";
import { requireAuth } from "../middleware/auth.js";
import { asyncRoute } from "../utils/async-route.js";
import { asOptionalString, asUserId } from "../utils/request-coercion.js";
import { UnknownRecord, AuthenticatedUserContext } from "../types/http.js";
import {
  confirmNoShow,
  createWalkInQueueEntry,
  getQueueSnapshot,
  scanAppointmentIntoQueue
} from "../services/queue-service.js";

interface QueueRequest extends Request {
  body: Record<string, unknown>;
  user: AuthenticatedUserContext;
}

export const queueRouter: Router = express.Router();

queueRouter.use(requireAuth);

queueRouter.get(
  "/",
  asyncRoute(async (_req: Request, res: Response) => {
    const queue = await getQueueSnapshot();
    res.json(queue);
  })
);

queueRouter.post(
  "/scan",
  asyncRoute(async (req: Request, res: Response) => {
    const request = req as QueueRequest;
    const result = await scanAppointmentIntoQueue(request.body || {}, request.user);
    res.json(result);
  })
);

queueRouter.post(
  "/walk-in",
  asyncRoute(async (req: Request, res: Response) => {
    const request = req as QueueRequest;
    const body = request.body as UnknownRecord;
    const result = await createWalkInQueueEntry(request.body || {}, request.user, {
      supervisorUsername: asOptionalString(body.supervisorUsername),
      supervisorPassword: asOptionalString(body.supervisorPassword)
    });
    res.status(201).json(result);
  })
);

queueRouter.post(
  "/confirm-no-show",
  asyncRoute(async (req: Request, res: Response) => {
    const request = req as QueueRequest;
    const body = request.body as UnknownRecord;
    const result = await confirmNoShow(asUserId(body.appointmentId), asOptionalString(body.reason), request.user);
    res.json(result);
  })
);
