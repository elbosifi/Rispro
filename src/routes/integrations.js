// @ts-check

import express from "express";
import { HttpError } from "../utils/http-error.js";
import { requireAuth } from "../middleware/auth.js";
import { asyncRoute } from "../utils/async-route.js";
import { asOptionalString, asOptionalUserId } from "../utils/request-coercion.js";
import { asUnknownRecord } from "../utils/records.js";
import { getIntegrationStatus, preparePrintJob, prepareScanSession } from "../services/integration-service.js";
import { runPacsCFind, searchPacsStudies, testPacsConnection } from "../services/pacs-service.js";
import { buildMppsEventPayload, getDicomGatewaySettings, ingestMppsEvent } from "../services/dicom-service.js";

/** @typedef {import("../types/http.js").AuthenticatedUserContext} AuthenticatedUserContext */
/** @typedef {import("../types/http.js").UnknownRecord} UnknownRecord */
/** @typedef {import("../types/http.js").UserId} UserId */

export const integrationsRouter = express.Router();

/**
 * @typedef {object} IntegrationsCallbackRequest
 * @property {UnknownRecord} [headers]
 * @property {string} [ip]
 * @property {{ remoteAddress?: string }} [socket]
 * @property {UnknownRecord} [body]
 */

/**
 * @typedef {object} IntegrationsAuthRequest
 * @property {UnknownRecord} [body]
 * @property {AuthenticatedUserContext} user
 */

/**
 * @param {unknown} value
 * @returns {boolean}
 */
function isLoopbackAddress(value) {
  return ["127.0.0.1", "::1", "::ffff:127.0.0.1"].includes(String(value || "").trim());
}

/**
 * @param {IntegrationsAuthRequest} request
 * @returns {UserId}
 */
function requireUserSub(request) {
  if (!request.user.sub) {
    throw new HttpError(401, "Authentication required.");
  }

  return request.user.sub;
}

integrationsRouter.post(
  "/dicom/mpps-event",
  asyncRoute(async (req, res) => {
    const request = /** @type {IntegrationsCallbackRequest} */ (req);
    const settings = await getDicomGatewaySettings();
    const headerSecret = String(request.headers?.["x-rispro-dicom-secret"] || "").trim();
    const remoteAddress = request.ip || request.socket?.remoteAddress || "";

    if (headerSecret !== settings.callbackSecret && !isLoopbackAddress(remoteAddress)) {
      throw new HttpError(403, "DICOM callback authentication failed.");
    }

    const result = await ingestMppsEvent(buildMppsEventPayload(asUnknownRecord(request.body)));
    res.status(result.ok ? 200 : 202).json(result);
  })
);

integrationsRouter.use(requireAuth);

integrationsRouter.get(
  "/status",
  asyncRoute(async (_req, res) => {
    const status = await getIntegrationStatus();
    res.json({ status });
  })
);

integrationsRouter.post(
  "/print-prepare",
  asyncRoute(async (req, res) => {
    const request = /** @type {IntegrationsAuthRequest} */ (req);
    const body = asUnknownRecord(request.body);
    const preparation = await preparePrintJob(
      {
        appointmentId: asOptionalUserId(body.appointmentId),
        outputType: asOptionalString(body.outputType)
      },
      requireUserSub(request)
    );
    res.json({ preparation });
  })
);

integrationsRouter.post(
  "/scan-prepare",
  asyncRoute(async (req, res) => {
    const request = /** @type {IntegrationsAuthRequest} */ (req);
    const body = asUnknownRecord(request.body);
    const preparation = await prepareScanSession(
      {
        appointmentId: asOptionalUserId(body.appointmentId),
        patientId: asOptionalUserId(body.patientId),
        documentType: asOptionalString(body.documentType)
      },
      requireUserSub(request)
    );
    res.json({ preparation });
  })
);

integrationsRouter.post(
  "/pacs-cfind",
  asyncRoute(async (req, res) => {
    const request = /** @type {IntegrationsAuthRequest} */ (req);
    const body = asUnknownRecord(request.body);
    const studies = await runPacsCFind({
      patientNationalId: asOptionalString(body.patientNationalId),
      currentUserId: requireUserSub(request)
    });
    res.json({ studies });
  })
);

integrationsRouter.post(
  "/pacs-search",
  asyncRoute(async (req, res) => {
    const request = /** @type {IntegrationsAuthRequest} */ (req);
    const body = asUnknownRecord(request.body);
    const studies = await searchPacsStudies({
      criteria: body,
      currentUserId: requireUserSub(request)
    });
    res.json({ studies });
  })
);

integrationsRouter.post(
  "/pacs-test",
  asyncRoute(async (req, res) => {
    const request = /** @type {IntegrationsAuthRequest} */ (req);
    const body = asUnknownRecord(request.body);
    await testPacsConnection({ currentUserId: requireUserSub(request), overrides: body });
    res.json({ ok: true });
  })
);
