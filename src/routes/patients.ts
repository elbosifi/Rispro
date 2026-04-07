import express, { Request, Response, Router } from "express";
import { requireAuth } from "../middleware/auth.js";
import { asyncRoute } from "../utils/async-route.js";
import { asOptionalString } from "../utils/request-coercion.js";
import { UnknownRecord, AuthenticatedUserContext, UserId } from "../types/http.js";
import {
  createPatient,
  deletePatient,
  getPatientById,
  getPatientNoShowSummary,
  mergePatients,
  searchPatients,
  updatePatient
} from "../services/patient-service.js";

type PatientsRequest = Request & {
  query: UnknownRecord;
  body: UnknownRecord;
  params: { patientId?: string };
  user: AuthenticatedUserContext;
};

export const patientsRouter: Router = express.Router();

patientsRouter.use(requireAuth);

patientsRouter.get(
  "/",
  asyncRoute(async (req: Request, res: Response) => {
    const request = req as PatientsRequest;
    const query = request.query as UnknownRecord;
    const patients = await searchPatients(String(query.q ?? ""));
    res.json({ patients });
  })
);

patientsRouter.post(
  "/merge",
  asyncRoute(async (req: Request, res: Response) => {
    const request = req as PatientsRequest;
    const userId: UserId = request.user.sub;
    const patient = await mergePatients(request.body ?? {}, userId);
    res.json({ patient });
  })
);

patientsRouter.post(
  "/",
  asyncRoute(async (req: Request, res: Response) => {
    const request = req as PatientsRequest;
    const userId: UserId = request.user.sub;
    const patient = await createPatient(request.body ?? {}, userId);
    res.status(201).json({ patient });
  })
);

patientsRouter.get(
  "/:patientId",
  asyncRoute(async (req: Request, res: Response) => {
    const request = req as PatientsRequest;
    const patientId = asOptionalString(request.params?.patientId) ?? "";
    const patient = await getPatientById(patientId);
    res.json({ patient });
  })
);

patientsRouter.get(
  "/:patientId/no-show",
  asyncRoute(async (req: Request, res: Response) => {
    const request = req as PatientsRequest;
    const patientId = asOptionalString(request.params?.patientId) ?? "";
    const summary = await getPatientNoShowSummary(patientId);
    res.json(summary);
  })
);

patientsRouter.put(
  "/:patientId",
  asyncRoute(async (req: Request, res: Response) => {
    const request = req as PatientsRequest;
    const patientId = asOptionalString(request.params?.patientId) ?? "";
    const userId: UserId = request.user.sub;
    const patient = await updatePatient(patientId, request.body ?? {}, userId);
    res.json({ patient });
  })
);

patientsRouter.delete(
  "/:patientId",
  asyncRoute(async (req: Request, res: Response) => {
    const request = req as PatientsRequest;
    const patientId = asOptionalString(request.params?.patientId) ?? "";
    const userId: UserId = request.user.sub;
    const result = await deletePatient(patientId, userId);
    res.json(result);
  })
);
