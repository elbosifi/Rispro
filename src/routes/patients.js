// @ts-check

import express from "express";
import { requireAuth } from "../middleware/auth.js";
import { asyncRoute } from "../utils/async-route.js";
import {
  createPatient,
  getPatientById,
  getPatientNoShowSummary,
  mergePatients,
  searchPatients,
  updatePatient
} from "../services/patient-service.js";

/**
 * @typedef {object} PatientsRequest
 * @property {Record<string, unknown>} [query]
 * @property {Record<string, unknown>} [body]
 * @property {{ patientId?: string }} [params]
 * @property {{ sub: number | string, role: string }} [user]
 */

export const patientsRouter = express.Router();

patientsRouter.use(requireAuth);

patientsRouter.get(
  "/",
  asyncRoute(async (req, res) => {
    const request = /** @type {PatientsRequest} */ (req);
    const patients = await searchPatients(String(request.query?.q || ""));
    res.json({ patients });
  })
);

patientsRouter.post(
  "/merge",
  asyncRoute(async (req, res) => {
    const request = /** @type {PatientsRequest} */ (req);
    const patient = await mergePatients(request.body || {}, request.user?.sub);
    res.json({ patient });
  })
);

patientsRouter.post(
  "/",
  asyncRoute(async (req, res) => {
    const request = /** @type {PatientsRequest} */ (req);
    const patient = await createPatient(request.body || {}, request.user?.sub);
    res.status(201).json({ patient });
  })
);

patientsRouter.get(
  "/:patientId",
  asyncRoute(async (req, res) => {
    const request = /** @type {PatientsRequest} */ (req);
    const patient = await getPatientById(request.params?.patientId);
    res.json({ patient });
  })
);

patientsRouter.get(
  "/:patientId/no-show",
  asyncRoute(async (req, res) => {
    const request = /** @type {PatientsRequest} */ (req);
    const summary = await getPatientNoShowSummary(request.params?.patientId);
    res.json(summary);
  })
);

patientsRouter.put(
  "/:patientId",
  asyncRoute(async (req, res) => {
    const request = /** @type {PatientsRequest} */ (req);
    const patient = await updatePatient(request.params?.patientId, request.body || {}, request.user?.sub);
    res.json({ patient });
  })
);
