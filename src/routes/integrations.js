import express from "express";
import { requireAuth } from "../middleware/auth.js";
import { asyncRoute } from "../utils/async-route.js";
import { getIntegrationStatus, preparePrintJob, prepareScanSession } from "../services/integration-service.js";
import { runPacsCFind, testPacsConnection } from "../services/pacs-service.js";

export const integrationsRouter = express.Router();

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
  "/pacs-test",
  asyncRoute(async (req, res) => {
    await testPacsConnection({ currentUserId: req.user.sub });
    res.json({ ok: true });
  })
);
