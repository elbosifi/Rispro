import { Router, type Request } from "express";
import Busboy from "busboy";
import { requireAuth, requireAnyRole, requireRecentSupervisorReauth } from "../../middleware/auth.js";
import { asyncRoute } from "../../utils/async-route.js";
import { HttpError } from "../../utils/http-error.js";
import { env } from "../../config/env.js";
import { getDoctorMe } from "../doctor-portal/profile-service.js";
import { getMedicalDictationSettings, saveMedicalDictationSettings } from "./medical-dictation-settings-service.js";
import { medicalDictationHealth, transcribeMedicalDictation } from "./medical-dictation-service.js";
import { MAX_AUDIO_BYTES, validateAudio, type DictationAudio } from "./medasr-client.js";

function readAudio(req: Request): Promise<DictationAudio> {
  return new Promise((resolve, reject) => {
    let parser: ReturnType<typeof Busboy>;
    try { parser = Busboy({ headers: req.headers, limits: { files: 1, fileSize: MAX_AUDIO_BYTES + 1, fields: 0, parts: 2 } }); }
    catch { reject(new HttpError(400, "A multipart audio file is required.")); return; }
    const chunks: Buffer[] = [];
    let size = 0;
    let mimeType = "";
    let failure: HttpError | undefined;
    const fail = (error: HttpError) => { failure ??= error; };
    const aborted = () => { parser.destroy(); reject(new HttpError(400, "Audio upload was interrupted.")); };
    req.once("aborted", aborted);
    parser.on("file", (field, stream, info) => {
      if (field !== "file") { fail(new HttpError(400, "Audio field must be named file.")); stream.resume(); return; }
      mimeType = info.mimeType;
      stream.on("data", (chunk: Buffer) => { size += chunk.length; if (size <= MAX_AUDIO_BYTES) chunks.push(chunk); else fail(new HttpError(413, "Audio exceeds the 15 MB limit.")); });
      stream.on("limit", () => fail(new HttpError(413, "Audio exceeds the 15 MB limit.")));
      stream.on("error", () => fail(new HttpError(400, "Invalid audio upload.")));
    });
    for (const event of ["filesLimit", "fieldsLimit", "partsLimit"] as const) parser.on(event, () => fail(new HttpError(400, "Upload exactly one audio file without additional fields.")));
    parser.on("error", () => { req.off("aborted", aborted); reject(new HttpError(400, "Invalid multipart audio upload.")); });
    parser.on("finish", () => {
      req.off("aborted", aborted);
      if (failure) { reject(failure); return; }
      try { const audio = { buffer: Buffer.concat(chunks), mimeType }; validateAudio(audio); resolve(audio); } catch (error) { reject(error); }
    });
    req.pipe(parser);
  });
}

export const medicalDictationRouter = Router();
medicalDictationRouter.use(requireAuth, (_req, res, next) => { res.setHeader("Cache-Control", "no-store"); next(); });
const admin = requireAnyRole(["super_admin"]);
medicalDictationRouter.get("/settings", admin, asyncRoute(async (_req, res) => res.json({ settings: await getMedicalDictationSettings() })));
medicalDictationRouter.put("/settings", admin, requireRecentSupervisorReauth, asyncRoute(async (req, res) => res.json({ settings: await saveMedicalDictationSettings(req.body, req.user!.sub) })));
medicalDictationRouter.post("/test-connection", admin, requireRecentSupervisorReauth, asyncRoute(async (_req, res) => res.json(await medicalDictationHealth())));
medicalDictationRouter.use(asyncRoute(async (req, _res, next) => {
  if (!env.doctorPortalEnabled || !(await getDoctorMe(req.user!.sub, req.user!.role)).canAccessClinicalDoctorPortal) throw new HttpError(403, "Active clinical Doctor Workspace access is required.");
  next();
}));
medicalDictationRouter.get("/health", asyncRoute(async (_req, res) => res.json(await medicalDictationHealth())));
medicalDictationRouter.post("/transcribe", asyncRoute(async (req, res) => {
  const controller = new AbortController();
  const abort = () => { if (!res.writableEnded) controller.abort(); };
  res.once("close", abort);
  try { const audio = await readAudio(req); res.json(await transcribeMedicalDictation(audio, controller.signal)); }
  finally { res.off("close", abort); }
}));
