import express from "express";
import { requireAuth } from "../middleware/auth.js";
import { asyncRoute } from "../utils/async-route.js";
import {
  createPatient,
  getPatientById,
  mergePatients,
  searchPatients,
  updatePatient
} from "../services/patient-service.js";

export const patientsRouter = express.Router();

patientsRouter.use(requireAuth);

patientsRouter.get(
  "/",
  asyncRoute(async (req, res) => {
    const patients = await searchPatients(req.query.q || "");
    res.json({ patients });
  })
);

patientsRouter.post(
  "/merge",
  asyncRoute(async (req, res) => {
    const patient = await mergePatients(req.body || {}, req.user.sub);
    res.json({ patient });
  })
);

patientsRouter.post(
  "/",
  asyncRoute(async (req, res) => {
    const patient = await createPatient(req.body || {}, req.user.sub);
    res.status(201).json({ patient });
  })
);

patientsRouter.get(
  "/:patientId",
  asyncRoute(async (req, res) => {
    const patient = await getPatientById(req.params.patientId);
    res.json({ patient });
  })
);

patientsRouter.put(
  "/:patientId",
  asyncRoute(async (req, res) => {
    const patient = await updatePatient(req.params.patientId, req.body || {}, req.user.sub);
    res.json({ patient });
  })
);
