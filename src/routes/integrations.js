import express from "express";
import { HttpError } from "../utils/http-error.js";
import { requireAuth } from "../middleware/auth.js";
import { asyncRoute } from "../utils/async-route.js";
import { getIntegrationStatus, preparePrintJob, prepareScanSession } from "../services/integration-service.js";
import { runPacsCFind, searchPacsStudies, testPacsConnection } from "../services/pacs-service.js";
import { buildMppsEventPayload, getDicomGatewaySettings, ingestMppsEvent } from "../services/dicom-service.js";

export const integrationsRouter = express.Router();

function isLoopbackAddress(value) {
  return ["127.0.0.1", "::1", "::ffff:127.0.0.1"].includes(String(value || "").trim());
}

integrationsRouter.post(
  "/dicom/mpps-event",
  asyncRoute(async (req, res) => {
    const settings = await getDicomGatewaySettings();
    const headerSecret = String(req.headers["x-rispro-dicom-secret"] || "").trim();
    const remoteAddress = req.ip || req.socket?.remoteAddress || "";

    if (headerSecret !== settings.callbackSecret && !isLoopbackAddress(remoteAddress)) {
      throw new HttpError(403, "DICOM callback authentication failed.");
    }

    const result = await ingestMppsEvent(buildMppsEventPayload(req.body || {}));
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
    const preparation = await preparePrintJob(req.body || {}, req.user.sub);
    res.json({ preparation });
  })
);

integrationsRouter.post(
  "/scan-prepare",
  asyncRoute(async (req, res) => {
    const preparation = await prepareScanSession(req.body || {}, req.user.sub);
    res.json({ preparation });
  })
);

integrationsRouter.post(
  "/pacs-cfind",
  asyncRoute(async (req, res) => {
    const studies = await runPacsCFind({
      patientNationalId: req.body?.patientNationalId,
      currentUserId: req.user.sub
    });
    res.json({ studies });
  })
);

integrationsRouter.post(
  "/pacs-search",
  asyncRoute(async (req, res) => {
    const studies = await searchPacsStudies({
      criteria: req.body || {},
      currentUserId: req.user.sub
    });
    res.json({ studies });
  })
);

integrationsRouter.post(
  "/pacs-test",
  asyncRoute(async (req, res) => {
    await testPacsConnection({ currentUserId: req.user.sub, overrides: req.body || null });
    res.json({ ok: true });
  })
);
