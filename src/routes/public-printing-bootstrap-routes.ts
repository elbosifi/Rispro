import express, { type Request, type Response } from "express";
import { stat } from "node:fs/promises";
import { createRateLimiter } from "../middleware/rate-limit.js";
import { getQzCertificate, getQzRootCertificate } from "../services/qz-signing-service.js";
import { getQzBootstrapManifest, QZ_INSTALLER_NAME, renderQzWindowsLauncher, renderQzWindowsScript, validateQzInstaller } from "../services/qz-bootstrap-service.js";
import { asyncRoute } from "../utils/async-route.js";

export const publicPrintingBootstrapRouter = express.Router();
const installerLimiter = createRateLimiter({ windowMs: 60_000, maxRequests: 20, message: "Too many QZ installer downloads. Try again shortly.", errorCode: "QZ_INSTALLER_RATE_LIMIT" });

type InstallerRouteDependencies = {
  manifest: typeof getQzBootstrapManifest;
  validate: typeof validateQzInstaller;
  fileStat: typeof stat;
};

function publicHeaders(_req: Request, res: Response, next: () => void): void {
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("X-Content-Type-Options", "nosniff");
  next();
}

publicPrintingBootstrapRouter.use(publicHeaders);
publicPrintingBootstrapRouter.get("/manifest", asyncRoute(async (_req, res) => res.json(await getQzBootstrapManifest())));
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
publicPrintingBootstrapRouter.get("/windows-launcher", (_req, res) => {
  res.setHeader("Content-Type", "application/octet-stream");
  res.setHeader("Content-Disposition", "attachment; filename=\"RISpro-Printing-Setup.cmd\"");
  res.send(Buffer.from(renderQzWindowsLauncher(), "utf8"));
});
async function sendQzInstaller(res: Response, next: (error?: unknown) => void, dependencies: InstallerRouteDependencies = { manifest: getQzBootstrapManifest, validate: validateQzInstaller, fileStat: stat }): Promise<void> {
  const manifest = await dependencies.manifest();
  if (manifest.ready !== true) { res.status(503).json(manifest); return; }
  const validated = await dependencies.validate();
  const current = await dependencies.fileStat(validated.path);
  if (current.size !== validated.size || current.mtimeMs !== validated.modifiedMs) {
    res.status(503).json({ schemaVersion: 1, ready: false, reason: "The pinned QZ Tray 2.2.6 installer changed before download." });
    return;
  }
  res.type("application/vnd.microsoft.portable-executable");
  res.setHeader("Content-Disposition", `attachment; filename="${QZ_INSTALLER_NAME}"`);
  res.sendFile(validated.path, (error) => { if (error) next(error); });
}

publicPrintingBootstrapRouter.get("/qz-installer", installerLimiter, asyncRoute(async (_req, res, next) => {
  await sendQzInstaller(res, next);
}));

export const __publicPrintingBootstrapTestables = { installerLimiter, publicHeaders, sendQzInstaller };
