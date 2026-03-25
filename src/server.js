import express from "express";
import cookieParser from "cookie-parser";
import path from "path";
import { fileURLToPath } from "url";
import { env } from "./config/env.js";
import { authRouter } from "./routes/auth.js";
import { usersRouter } from "./routes/users.js";
import { patientsRouter } from "./routes/patients.js";
import { settingsRouter } from "./routes/settings.js";
import { errorHandler, notFoundHandler } from "./middleware/error-handler.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, "..");

const app = express();

app.use(express.json());
app.use(cookieParser());

app.get("/api/health", (_req, res) => {
  res.json({ ok: true });
});

app.use("/api/auth", authRouter);
app.use("/api/users", usersRouter);
app.use("/api/patients", patientsRouter);
app.use("/api/settings", settingsRouter);

app.use(express.static(rootDir));

app.get("*", (_req, res) => {
  res.sendFile(path.join(rootDir, "index.html"));
});

app.use(notFoundHandler);
app.use(errorHandler);

app.listen(env.port, () => {
  console.log(`RISpro backend listening on http://localhost:${env.port}`);
});
