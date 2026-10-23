import { Router } from "express";
import { requireAuth, requireAnyRole, requireRecentSupervisorReauth } from "../../middleware/auth.js";
import { asyncRoute } from "../../utils/async-route.js";
import { HttpError } from "../../utils/http-error.js";
import { env } from "../../config/env.js";
import { getDoctorMe } from "../doctor-portal/profile-service.js";
import { getMedGemmaSettings, saveMedGemmaSettings } from "./medgemma-settings-service.js";
import { generateMedGemmaText, medGemmaHealth } from "./medgemma-service.js";
import { validateDictationText } from "./medgemma-client.js";
import { isMedGemmaTask, validateMedGemmaInstructions } from "./task-instructions.js";

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
  if (!input || !isMedGemmaTask(input.task) || Object.keys(input).some((key) => !["task", "text", "instructionsOverride"].includes(key))) throw new HttpError(400, "Send a supported MedGemma task and original text.");
  validateDictationText(input.text);
  if (input.instructionsOverride !== undefined) {
    if (req.user!.role !== "super_admin") throw new HttpError(403, "Only a super administrator may override test instructions.");
    validateMedGemmaInstructions(input.instructionsOverride);
  }
  const controller = new AbortController();
  const abort = () => { if (!res.writableEnded) controller.abort(); };
  res.once("close", abort);
  try { res.json(await generateMedGemmaText(input.task, input.text, input.instructionsOverride as string | undefined, controller.signal)); }
  finally { res.off("close", abort); }
}));
