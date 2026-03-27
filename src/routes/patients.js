import express from "express";
import { requireAuth } from "../middleware/auth.js";
import {
  createPatient,
  getPatientById,
  mergePatients,
  searchPatients,
  updatePatient
} from "../services/patient-service.js";

export const patientsRouter = express.Router();

patientsRouter.use(requireAuth);

patientsRouter.get("/", async (req, res, next) => {
  try {
    const patients = await searchPatients(req.query.q || "");
    res.json({ patients });
  } catch (error) {
    next(error);
  }
});

patientsRouter.post("/merge", async (req, res, next) => {
  try {
    const patient = await mergePatients(req.body || {}, req.user.sub);
    res.json({ patient });
  } catch (error) {
    next(error);
  }
});

patientsRouter.post("/", async (req, res, next) => {
  try {
    const patient = await createPatient(req.body || {}, req.user.sub);
    res.status(201).json({ patient });
  } catch (error) {
    next(error);
  }
});

patientsRouter.get("/:patientId", async (req, res, next) => {
  try {
    const patient = await getPatientById(req.params.patientId);
    res.json({ patient });
  } catch (error) {
    next(error);
  }
});

patientsRouter.put("/:patientId", async (req, res, next) => {
  try {
    const patient = await updatePatient(req.params.patientId, req.body || {}, req.user.sub);
    res.json({ patient });
  } catch (error) {
    next(error);
  }
});
