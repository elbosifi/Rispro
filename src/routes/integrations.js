import express from "express";
import { requireAuth } from "../middleware/auth.js";
import { asyncRoute } from "../utils/async-route.js";
import { getIntegrationStatus, preparePrintJob, prepareScanSession } from "../services/integration-service.js";

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
