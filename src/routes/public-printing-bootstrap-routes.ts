import express, { type Request, type Response } from "express";
import { createRateLimiter } from "../middleware/rate-limit.js";
import { getQzCertificate, getQzRootCertificate } from "../services/qz-signing-service.js";
import { getQzBootstrapManifest, qzInstallerPath, QZ_INSTALLER_NAME, renderQzWindowsScript } from "../services/qz-bootstrap-service.js";

export const publicPrintingBootstrapRouter = express.Router();
const installerLimiter = createRateLimiter({ windowMs: 60_000, maxRequests: 20, message: "Too many QZ installer downloads. Try again shortly.", errorCode: "QZ_INSTALLER_RATE_LIMIT" });

function publicHeaders(_req: Request, res: Response, next: () => void): void {
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("X-Content-Type-Options", "nosniff");
  next();
}

publicPrintingBootstrapRouter.use(publicHeaders);
publicPrintingBootstrapRouter.get("/manifest", (_req, res) => res.json(getQzBootstrapManifest()));
publicPrintingBootstrapRouter.get("/root-certificate", (_req, res) => {
  res.type("text/plain; charset=utf-8");
  res.setHeader("Content-Disposition", "attachment; filename=\"NCCB-RISpro-QZ-Root-CA.crt\"");
  res.send(getQzRootCertificate());
});
publicPrintingBootstrapRouter.get("/signing-certificate", (_req, res) => {
  res.type("text/plain; charset=utf-8");
  res.setHeader("Content-Disposition", "attachment; filename=\"NCCB-RISpro-QZ-Signing-Certificate.pem\"");
  res.send(getQzCertificate());
});
publicPrintingBootstrapRouter.get("/windows-script", (_req, res) => {
  res.type("text/plain; charset=utf-8");
  res.setHeader("Content-Disposition", "attachment; filename=\"RISpro-Printing-Setup.ps1\"");
  res.send(renderQzWindowsScript());
});
publicPrintingBootstrapRouter.get("/qz-installer", installerLimiter, (_req, res, next) => {
  const manifest = getQzBootstrapManifest();
  if (manifest.ready !== true) { res.status(503).json(manifest); return; }
  res.type("application/vnd.microsoft.portable-executable");
  res.setHeader("Content-Disposition", `attachment; filename="${QZ_INSTALLER_NAME}"`);
  res.sendFile(qzInstallerPath(), (error) => { if (error) next(error); });
});

export const __publicPrintingBootstrapTestables = { installerLimiter, publicHeaders };
