import express from "express";
import cookieParser from "cookie-parser";
import path from "path";
import { fileURLToPath } from "url";
import { env } from "./config/env.js";
import { pingDatabase } from "./db/pool.js";
import { authRouter } from "./routes/auth.js";
import { usersRouter } from "./routes/users.js";
import { patientsRouter } from "./routes/patients.js";
import { appointmentsRouter } from "./routes/appointments.js";
import { queueRouter } from "./routes/queue.js";
import { documentsRouter } from "./routes/documents.js";
import { integrationsRouter } from "./routes/integrations.js";
import { adminRouter } from "./routes/admin.js";
import { modalityRouter } from "./routes/modality.js";
import { auditRouter } from "./routes/audit.js";
import { settingsRouter } from "./routes/settings.js";
import { errorHandler, notFoundHandler } from "./middleware/error-handler.js";
import { securityHeaders } from "./middleware/security.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, "..");

function sendFrontendFile(fileName, cacheSeconds = 0) {
  return function frontendFileHandler(_req, res) {
    if (cacheSeconds > 0) {
      res.setHeader("Cache-Control", `public, max-age=${cacheSeconds}`);
    } else {
      res.setHeader("Cache-Control", "no-store");
    }

    res.sendFile(path.join(rootDir, fileName));
  };
}

export function createApp() {
  const app = express();

  app.disable("x-powered-by");
  app.set("trust proxy", env.trustProxy);

  app.use(securityHeaders);
  app.use(express.json({ limit: env.requestBodyLimit }));
  app.use(cookieParser());

  app.get("/api/health", (_req, res) => {
    res.json({
      ok: true,
      environment: env.nodeEnv
    });
  });

  app.get("/api/ready", async (_req, res, next) => {
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
  app.use("/api/appointments", appointmentsRouter);
  app.use("/api/queue", queueRouter);
  app.use("/api/documents", documentsRouter);
  app.use("/api/integrations", integrationsRouter);
  app.use("/api/admin", adminRouter);
  app.use("/api/modality", modalityRouter);
  app.use("/api/audit", auditRouter);
  app.use("/api/settings", settingsRouter);
  app.use("/api", notFoundHandler);

  app.get("/", sendFrontendFile("index.html"));
  app.get("/app.js", sendFrontendFile("app.js"));
  app.get("/styles.css", sendFrontendFile("styles.css", env.isProduction ? 3600 : 0));
  app.get("/favicon.ico", (_req, res) => {
    res.status(204).end();
  });
  app.get("*", sendFrontendFile("index.html"));

  app.use(errorHandler);

  return app;
}
