import express from "express";
import { requireAuth } from "../middleware/auth.js";
import { createPatient, searchPatients } from "../services/patient-service.js";

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

patientsRouter.post("/", async (req, res, next) => {
  try {
    const patient = await createPatient(req.body || {}, req.user.sub);
    res.status(201).json({ patient });
  } catch (error) {
    next(error);
  }
});
