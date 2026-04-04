// @ts-check

import express from "express";
import { requireAuth } from "../middleware/auth.js";
import { asyncRoute } from "../utils/async-route.js";
import { asOptionalString } from "../utils/request-coercion.js";
import { asUnknownRecord } from "../utils/records.js";
import {
  createPatient,
  getPatientById,
  getPatientNoShowSummary,
  mergePatients,
  searchPatients,
  updatePatient
} from "../services/patient-service.js";

/** @typedef {import("../types/http.js").AuthenticatedUserContext} AuthenticatedUserContext */
/** @typedef {import("../types/http.js").UnknownRecord} UnknownRecord */

/**
 * @typedef {object} PatientsRequest
 * @property {UnknownRecord} [query]
 * @property {UnknownRecord} [body]
 * @property {{ patientId?: string }} [params]
 * @property {AuthenticatedUserContext} user
 */

export const patientsRouter = express.Router();

patientsRouter.use(requireAuth);

patientsRouter.get(
  "/",
  asyncRoute(async (req, res) => {
    const request = /** @type {PatientsRequest} */ (req);
    const query = asUnknownRecord(request.query);
    const patients = await searchPatients(String(query.q || ""));
    res.json({ patients });
  })
);

patientsRouter.post(
  "/merge",
  asyncRoute(async (req, res) => {
    const request = /** @type {PatientsRequest} */ (req);
    const patient = await mergePatients(request.body || {}, request.user.sub);
    res.json({ patient });
  })
);

patientsRouter.post(
  "/",
  asyncRoute(async (req, res) => {
    const request = /** @type {PatientsRequest} */ (req);
    const patient = await createPatient(request.body || {}, request.user.sub);
    res.status(201).json({ patient });
  })
);

patientsRouter.get(
  "/:patientId",
  asyncRoute(async (req, res) => {
    const request = /** @type {PatientsRequest} */ (req);
    const patient = await getPatientById(asOptionalString(request.params?.patientId) || "");
    res.json({ patient });
  })
);

patientsRouter.get(
  "/:patientId/no-show",
  asyncRoute(async (req, res) => {
    const request = /** @type {PatientsRequest} */ (req);
    const summary = await getPatientNoShowSummary(asOptionalString(request.params?.patientId) || "");
    res.json(summary);
  })
);

patientsRouter.put(
  "/:patientId",
  asyncRoute(async (req, res) => {
    const request = /** @type {PatientsRequest} */ (req);
    const patient = await updatePatient(asOptionalString(request.params?.patientId) || "", request.body || {}, request.user.sub);
    res.json({ patient });
  })
);
