import { Router } from "express";
import { requireAuth, requireAnyRole, requireRecentSupervisorReauth } from "../../middleware/auth.js";
import { asyncRoute } from "../../utils/async-route.js";
import { HttpError } from "../../utils/http-error.js";
import { env } from "../../config/env.js";
import { getDoctorMe } from "../doctor-portal/profile-service.js";
import { getMedGemmaSettings, saveMedGemmaSettings } from "./medgemma-settings-service.js";
import { generateMedGemmaText, medGemmaHealth } from "./medgemma-service.js";
import { validateDictationText } from "./medgemma-client.js";

export const medGemmaRouter = Router();
medGemmaRouter.use(requireAuth, (_req, res, next) => { res.setHeader("Cache-Control", "no-store"); next(); });
const admin = requireAnyRole(["super_admin"]);
medGemmaRouter.get("/settings", admin, asyncRoute(async (_req, res) => res.json({ settings: await getMedGemmaSettings() })));
medGemmaRouter.put("/settings", admin, requireRecentSupervisorReauth, asyncRoute(async (req, res) => res.json({ settings: await saveMedGemmaSettings(req.body, req.user!.sub) })));
medGemmaRouter.post("/test-connection", admin, requireRecentSupervisorReauth, asyncRoute(async (_req, res) => res.json(await medGemmaHealth())));
medGemmaRouter.use(asyncRoute(async (req, _res, next) => {
  if (!env.doctorPortalEnabled || !(await getDoctorMe(req.user!.sub, req.user!.role)).canAccessClinicalDoctorPortal) throw new HttpError(403, "Active clinical Doctor Workspace access is required.");
  next();
}));
medGemmaRouter.get("/health", asyncRoute(async (_req, res) => res.json(await medGemmaHealth())));
medGemmaRouter.post("/generate", asyncRoute(async (req, res) => {
  const input = req.body as Record<string, unknown> | null;
  if (!input || input.task !== "cleanup_dictation" || Object.keys(input).some((key) => key !== "task" && key !== "text")) throw new HttpError(400, "Send only task cleanup_dictation and original text.");
  validateDictationText(input.text);
  const controller = new AbortController();
  const abort = () => { if (!res.writableEnded) controller.abort(); };
  res.once("close", abort);
  try { res.json(await generateMedGemmaText(input.text, controller.signal)); }
  finally { res.off("close", abort); }
}));
