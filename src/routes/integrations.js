import express from "express";
import { requireAuth } from "../middleware/auth.js";
import { getIntegrationStatus, preparePrintJob, prepareScanSession } from "../services/integration-service.js";

export const integrationsRouter = express.Router();

integrationsRouter.use(requireAuth);

integrationsRouter.get("/status", async (_req, res, next) => {
  try {
    const status = await getIntegrationStatus();
    res.json({ status });
  } catch (error) {
    next(error);
  }
});

integrationsRouter.post("/print-prepare", async (req, res, next) => {
  try {
    const preparation = await preparePrintJob(req.body || {}, req.user.sub);
    res.json({ preparation });
  } catch (error) {
    next(error);
  }
});

integrationsRouter.post("/scan-prepare", async (req, res, next) => {
  try {
    const preparation = await prepareScanSession(req.body || {}, req.user.sub);
    res.json({ preparation });
  } catch (error) {
    next(error);
  }
});
