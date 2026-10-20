import express from "express";
import { requireAuth, requireAnyRole } from "../middleware/auth.js";
import { env } from "../config/env.js";
import { naps2ConnectOrigins } from "../config/naps2.js";
import { HttpError } from "../utils/http-error.js";
import { renderNaps2WindowsSetup } from "../services/scanner-bootstrap-service.js";
import { loadSettingsMap } from "../services/settings-service.js";
import { asyncRoute } from "../utils/async-route.js";

export const scannerBootstrapRouter = express.Router();
scannerBootstrapRouter.use(requireAuth, requireAnyRole(["receptionist", "supervisor", "modality_staff", "doctor", "super_admin"]));
scannerBootstrapRouter.use((_req, res, next) => {
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("X-Content-Type-Options", "nosniff");
  next();
});
scannerBootstrapRouter.get("/windows-setup", asyncRoute(async (req, res) => {
  const settings = await loadSettingsMap(["documents_and_uploads"]);
  let endpoint = env.naps2WebscanEndpoint || String(settings.documents_and_uploads?.naps2_webscan_endpoint || "").trim();
  if (req.query.endpoint !== undefined) {
    // Select a server-approved origin; never interpolate arbitrary request content.
    const approved = naps2ConnectOrigins().find((origin) => origin === req.query.endpoint);
    if (!approved) throw new HttpError(400, "The workstation scanner endpoint must be an exact server CSP-approved origin.");
    endpoint = approved;
  }
  const script = renderNaps2WindowsSetup({ endpoint });
  res.setHeader("Content-Type", "application/octet-stream");
  res.setHeader("Content-Disposition", 'attachment; filename="RISpro-NAPS2-Setup.cmd"');
  res.send(Buffer.from(script, "utf8"));
}));
