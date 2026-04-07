import express, { Request, Response, Router } from "express";
import { requireAnyRole, requireAuth } from "../middleware/auth.js";
import { asyncRoute } from "../utils/async-route.js";
import { asOptionalString } from "../utils/request-coercion.js";
import { UnknownRecord, AuthenticatedUserContext } from "../types/http.js";
import { listModalityWorklist, markAppointmentCompleted } from "../services/modality-service.js";

export const modalityRouter: Router = express.Router();

modalityRouter.use(requireAuth, requireAnyRole(["modality_staff", "supervisor"]));

modalityRouter.get(
  "/worklist",
  asyncRoute(async (req: Request, res: Response) => {
    const query = req.query as UnknownRecord;
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
  asyncRoute(async (req: Request, res: Response) => {
    const typedReq = req as Request & { user: AuthenticatedUserContext; params: { appointmentId?: string } };
    const result = await markAppointmentCompleted(asOptionalString(typedReq.params?.appointmentId) || "", typedReq.user.sub);
    res.json(result);
  })
);
