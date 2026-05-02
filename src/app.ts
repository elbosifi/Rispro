import express, { type Application, type Request, type Response, type NextFunction } from "express";
import cookieParser from "cookie-parser";
import path from "path";
import { fileURLToPath } from "url";
import { env } from "./config/env.js";
import { pingDatabase } from "./db/pool.js";
import { authRouter } from "./routes/auth.js";
import { usersRouter } from "./routes/users.js";
import { patientsRouter } from "./routes/patients.js";
import { queueRouter } from "./routes/queue.js";
import { documentsRouter } from "./routes/documents.js";
import { integrationsRouter } from "./routes/integrations.js";
import { adminRouter } from "./routes/admin.js";
import { modalityRouter } from "./routes/modality.js";
import { auditRouter } from "./routes/audit.js";
import { settingsRouter } from "./routes/settings.js";
import { nameDictionaryRouter } from "./routes/name-dictionary.js";
import { dicomRouter } from "./routes/dicom.js";
import { pacsRouter } from "./routes/pacs.js";
import { legacyAccessViewerRouter } from "./routes/legacy-access-viewer.js";
import { createAppointmentsV2Router } from "./modules/appointments-v2/index.js";
import { publicAppointmentsCancelRouter } from "./modules/appointments-v2/api/routes/public-appointments-cancel-routes.js";
import { errorHandler, notFoundHandler } from "./middleware/error-handler.js";
import { securityHeaders } from "./middleware/security.js";
import { cleanupStaleDicomRemapUploadTempDirs } from "./services/dicom-remap-service.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, "..");

function sendFrontendFile(fileName: string, cacheSeconds = 0) {
  return function frontendFileHandler(_req: Request, res: Response): void {
    if (cacheSeconds > 0) {
      res.setHeader("Cache-Control", `public, max-age=${cacheSeconds}`);
    } else {
      res.setHeader("Cache-Control", "no-store");
    }

    res.sendFile(path.join(rootDir, fileName));
  };
}

export function createApp(): Application {
  const app = express();

  void cleanupStaleDicomRemapUploadTempDirs().catch((error) => {
    console.error("Failed to clean stale DICOM remap upload temp directories.", error);
  });

  app.disable("x-powered-by");
  app.set("trust proxy", env.trustProxy);

  app.use(securityHeaders);

  // ---- Conditional JSON parser ------------------------------------------
  // Some upload endpoints accept base64-encoded files that can exceed the
  // normal global body limit. We skip the global parser for those endpoints
  // and let route-specific parsers apply larger limits.
  //
  // Middleware flow for /api/legacy-access-viewer/upload:
  //   1. securityHeaders          → applied
  //   2. global json parser       → SKIPPED (path excluded)
  //   3. cookieParser             → applied (needed for auth)
  //   4. legacyAccessViewerRouter → matched
  //   5. requireAuth              → reads cookie, validates JWT
  //   6. express.json({100mb})    → route-specific parser (applies here)
  //   7. handler                  → receives parsed body
  //
  // All other routes go through the normal global parser.
  // -----------------------------------------------------------------------
  const LEGACY_UPLOAD_PATH = "/api/legacy-access-viewer/upload";
  const PATIENT_IMPORT_PREFIX = "/api/settings/patient-import";
  const PACS_REMAP_UPLOAD_PATH = "/api/pacs/remap/jobs/upload";
  const PACS_REMAP_MULTIPART_UPLOAD_PATH = "/api/pacs/remap/jobs/upload-multipart";
  const PACS_REMAP_PROCESS_MULTIPART_UPLOAD_PATH = "/api/pacs/remap/jobs/process-multipart";
  app.use((req: Request, _res: Response, next: NextFunction) => {
    if (
      req.path === LEGACY_UPLOAD_PATH ||
      req.path.startsWith(PATIENT_IMPORT_PREFIX) ||
      req.path === PACS_REMAP_UPLOAD_PATH ||
      req.path === PACS_REMAP_MULTIPART_UPLOAD_PATH ||
      req.path === PACS_REMAP_PROCESS_MULTIPART_UPLOAD_PATH
    ) {
      // Let route-specific body parsers handle it.
      return next();
    }
    // Normal global parser for everything else.
    express.json({ limit: env.requestBodyLimit })(req, _res, next);
  });

  app.use(cookieParser());
  app.use("/assets", express.static(path.join(rootDir, "assets")));

  app.get("/api/health", (_req: Request, res: Response) => {
    res.json({
      ok: true,
      environment: env.nodeEnv
    });
  });

  app.get("/api/ready", async (_req: Request, res: Response, next: NextFunction) => {
    try {
      await pingDatabase();
      res.json({ ok: true });
    } catch (error) {
      next(error);
    }
  });

  app.use("/api/auth", authRouter);
  app.use("/api/users", usersRouter);
  app.use("/api/patients", patientsRouter);
  app.use("/api/queue", queueRouter);
  app.use("/api/documents", documentsRouter);
  app.use("/api/integrations", integrationsRouter);
  app.use("/api/admin", adminRouter);
  app.use("/api/modality", modalityRouter);
  app.use("/api/audit", auditRouter);
  app.use("/api/settings", settingsRouter);
  app.use("/api/name-dictionary", nameDictionaryRouter);
  app.use("/api/dicom", dicomRouter);
  app.use("/api/pacs", pacsRouter);
  app.use("/api/legacy-access-viewer", legacyAccessViewerRouter);

  // ---- Appointments V2 (parallel module) ----
  const v2Router = createAppointmentsV2Router();
  app.use("/api/v2", v2Router);
  app.use("/api/public/appointments", publicAppointmentsCancelRouter);

  app.use("/api", notFoundHandler);

  // Legacy frontend (will be removed after migration is complete)
  app.get("/legacy", sendFrontendFile("index.html"));
  app.get("/legacy/app.js", sendFrontendFile("app.js"));
  app.get("/legacy/styles.css", sendFrontendFile("styles.css", env.isProduction ? 3600 : 0));

  // New React frontend (default)
  const newFrontendDir = path.join(rootDir, "dist-frontend");
  app.use(express.static(newFrontendDir, { maxAge: env.isProduction ? "1h" : 0 }));
  app.get("/favicon.ico", (_req: Request, res: Response) => {
    res.status(204).end();
  });

  // SPA fallback for new frontend
  app.get("*", (req: Request, res: Response) => {
    res.sendFile(path.join(newFrontendDir, "index.html"));
  });

  app.use(errorHandler);

  return app;
}
