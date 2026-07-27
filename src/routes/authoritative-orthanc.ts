import express, { type Request, type Response } from "express";
import { requireAnyRole, requireAuth } from "../middleware/auth.js";
import { asyncRoute } from "../utils/async-route.js";
import { asUnknownRecord } from "../utils/records.js";
import { HttpError } from "../utils/http-error.js";
import { findAuthoritativeOrthancStudyForAppointment, getAuthoritativeOrthancStatus, readAuthoritativeOrthancSettingsForDisplay, saveAuthoritativeOrthancSettings, testAuthoritativeOrthancConnection } from "../services/authoritative-orthanc-service.js";

function appointmentId(value: unknown): number { const parsed = Number(value); if (!Number.isSafeInteger(parsed) || parsed < 1) throw new HttpError(400, "appointmentId must be a positive integer."); return parsed; }
function orthancErrorCode(error: HttpError): string { const details = error.details; return details && typeof details === "object" && "code" in details ? String((details as { code?: unknown }).code || "") : ""; }
export const authoritativeOrthancRouter = express.Router();
authoritativeOrthancRouter.use(requireAuth);
authoritativeOrthancRouter.get("/settings", requireAnyRole(["supervisor", "super_admin"]), asyncRoute(async (_req: Request, res: Response) => { res.json({ settings: await readAuthoritativeOrthancSettingsForDisplay() }); }));
authoritativeOrthancRouter.put("/settings", requireAnyRole(["supervisor", "super_admin"]), asyncRoute(async (req: Request, res: Response) => { res.json({ settings: await saveAuthoritativeOrthancSettings(asUnknownRecord(req.body), req.user!.sub) }); }));
authoritativeOrthancRouter.post("/test", requireAnyRole(["supervisor", "super_admin"]), asyncRoute(async (req: Request, res: Response) => { const system = await testAuthoritativeOrthancConnection(req.user!.sub); res.json({ connected: true, system, testedAt: new Date().toISOString() }); }));
authoritativeOrthancRouter.get("/status", requireAnyRole(["modality_staff", "supervisor", "super_admin"]), asyncRoute(async (_req: Request, res: Response) => { res.json(await getAuthoritativeOrthancStatus()); }));
authoritativeOrthancRouter.get("/appointments/:appointmentId/study", requireAnyRole(["modality_staff", "supervisor", "super_admin"]), asyncRoute(async (req: Request, res: Response) => { try { const result = await findAuthoritativeOrthancStudyForAppointment(appointmentId(req.params.appointmentId), req.user!.sub); res.json(result); } catch (error) { const code = error instanceof HttpError ? orthancErrorCode(error) : ""; if (code === "orthanc_disabled") { res.json({ status: "unavailable", reason: "disabled", study: null }); return; } if (code.startsWith("orthanc_")) { res.json({ status: "unavailable", reason: code, study: null }); return; } throw error; } }));
