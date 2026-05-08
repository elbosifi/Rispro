import express, { Request, Response, Router } from "express";
import { requireAuth } from "../middleware/auth.js";
import { requirePageAccess } from "../middleware/page-access.js";
import { asyncRoute } from "../utils/async-route.js";
import { asOptionalString } from "../utils/request-coercion.js";
import { pool } from "../db/pool.js";
import { UnknownRecord, AuthenticatedUserContext, UserId } from "../types/http.js";
import {
  listActivePatientIdentifierTypes,
  createPatient,
  deletePatient,
  getPatientById,
  getPatientDirectory,
  getPatientDirectorySummary,
  getPatientNoShowSummary,
  mergePatients,
  previewNextPatientMrn,
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
patientsRouter.use(requirePageAccess("patients"));

patientsRouter.get(
  "/identifier-types",
  asyncRoute(async (_req: Request, res: Response) => {
    const items = await listActivePatientIdentifierTypes();
    res.json({ items });
  })
);

patientsRouter.get(
  "/directory",
  asyncRoute(async (req: Request, res: Response) => {
    const request = req as PatientsRequest;
    const query = request.query as UnknownRecord;
    console.log("Directory query params:", query);
    const result = await getPatientDirectory({
      search: String(query.q ?? ""),
      category: (query.category as "oncology" | "non_oncology") || undefined,
      appointmentFilter: (query.appointmentFilter as "has_future" | "today" | "no_future") || undefined,
      sex: (query.sex as "male" | "female") || undefined,
      ageMin: query.ageMin ? Number(query.ageMin) : undefined,
      ageMax: query.ageMax ? Number(query.ageMax) : undefined,
      sortBy: (query.sortBy as "name" | "recent" | "mrn") || undefined,
      page: Number(query.page) || 1,
      pageSize: Number(query.pageSize) || 25
    });
    res.json(result);
  })
);

patientsRouter.get(
  "/sex-values",
  asyncRoute(async (_req: Request, res: Response) => {
    const { rows } = await pool.query(`SELECT DISTINCT sex, count(*)::int as cnt FROM patients WHERE sex IS NOT NULL GROUP BY sex ORDER BY cnt DESC`);
    res.json({ sexValues: rows });
  })
);

patientsRouter.get(
  "/:patientId/directory-summary",
  asyncRoute(async (req: Request, res: Response) => {
    const request = req as PatientsRequest;
    const patientId = asOptionalString(request.params?.patientId) ?? "";
    const summary = await getPatientDirectorySummary(patientId);
    res.json(summary);
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
  "/mrn-preview",
  asyncRoute(async (_req: Request, res: Response) => {
    const mrn = await previewNextPatientMrn();
    res.json({ mrn });
  })
);

patientsRouter.get(
  "/",
  asyncRoute(async (req: Request, res: Response) => {
    const request = req as PatientsRequest;
    const query = request.query as UnknownRecord;
    const patients = await searchPatients(String(query.q ?? ""));
    res.json({ patients });
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
