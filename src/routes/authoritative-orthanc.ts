import express, { type Request, type Response } from "express";
import { requireAnyRole, requireAuth } from "../middleware/auth.js";
import { requirePageAccess } from "../middleware/page-access.js";
import { asyncRoute } from "../utils/async-route.js";
import { asUnknownRecord } from "../utils/records.js";
import { HttpError } from "../utils/http-error.js";
import { findAuthoritativeOrthancStudyForAppointment, getAuthoritativeOrthancStatus, readAuthoritativeOrthancSettingsForDisplay, saveAuthoritativeOrthancSettings, testAuthoritativeOrthancConnection } from "../services/authoritative-orthanc-service.js";
import { assertClinicalDocumentExportAppointmentAccess, listClinicalDocumentExportsForAppointment, rebuildClinicalDocumentSecondaryCaptures, retryClinicalDocumentExport } from "../services/clinical-document-export-service.js";
import { generateMissingClinicalDocumentSecondaryCaptureExports } from "../services/clinical-document-export-queue-service.js";
import {
  getAuthoritativeOrthancOperationalJobs,
  getAuthoritativeOrthancOperationalRoutes,
  getAuthoritativeOrthancOperationsSummary,
  retryAuthoritativeOrthancOperationalJob,
  searchAuthoritativeOrthancOperationalStudy,
  synchronizeAuthoritativeOrthancOperationalRoutes,
  testAllAuthoritativeOrthancOperationalRoutes,
  testAuthoritativeOrthancOperationalRoute,
} from "../services/authoritative-orthanc-operations-service.js";
import { getHistoricalPacsAdminStatus, recoverStalledHistoricalPacsSync, triggerHistoricalPacsSync } from "../services/historical-pacs-index-service.js";
import { listPatientIdentityReconciliationJobs, requestPatientIdentityReconciliationReversal } from "../services/patient-identity-reconciliation-service.js";

function appointmentId(value: unknown): number { const parsed = Number(value); if (!Number.isSafeInteger(parsed) || parsed < 1) throw new HttpError(400, "appointmentId must be a positive integer."); return parsed; }
function orthancErrorCode(error: HttpError): string { const details = error.details; return details && typeof details === "object" && "code" in details ? String((details as { code?: unknown }).code || "") : ""; }
export const authoritativeOrthancRouter = express.Router();
authoritativeOrthancRouter.use(requireAuth);
authoritativeOrthancRouter.get("/settings", requireAnyRole(["supervisor", "super_admin"]), asyncRoute(async (_req: Request, res: Response) => { res.json({ settings: await readAuthoritativeOrthancSettingsForDisplay() }); }));
authoritativeOrthancRouter.put("/settings", requireAnyRole(["supervisor", "super_admin"]), asyncRoute(async (req: Request, res: Response) => { res.json({ settings: await saveAuthoritativeOrthancSettings(asUnknownRecord(req.body), req.user!.sub) }); }));
authoritativeOrthancRouter.post("/test", requireAnyRole(["supervisor", "super_admin"]), asyncRoute(async (req: Request, res: Response) => { const system = await testAuthoritativeOrthancConnection(req.user!.sub); res.json({ connected: true, system, testedAt: new Date().toISOString() }); }));
authoritativeOrthancRouter.get("/status", requireAnyRole(["modality_staff", "supervisor", "super_admin"]), asyncRoute(async (_req: Request, res: Response) => { res.json(await getAuthoritativeOrthancStatus()); }));
authoritativeOrthancRouter.use("/operations", requireAnyRole(["modality_staff", "supervisor", "super_admin"]), requirePageAccess("authoritative.orthanc"));
authoritativeOrthancRouter.get("/operations/patient-identity-reconciliations",requireAnyRole(["supervisor","super_admin"]),asyncRoute(async(req:Request,res:Response)=>{res.json(await listPatientIdentityReconciliationJobs({search:String(req.query.search||""),limit:Number(req.query.limit||25),offset:Number(req.query.offset||0)}));}));
authoritativeOrthancRouter.post("/operations/patient-identity-reconciliations/:jobId/reverse",requireAnyRole(["supervisor","super_admin"]),asyncRoute(async(req:Request,res:Response)=>{res.status(202).json({job:await requestPatientIdentityReconciliationReversal(appointmentId(req.params.jobId),req.user!.sub)});}));
authoritativeOrthancRouter.get("/operations/summary", asyncRoute(async (_req: Request, res: Response) => { res.json(await getAuthoritativeOrthancOperationsSummary()); }));
authoritativeOrthancRouter.get("/operations/historical-pacs-index/status", asyncRoute(async (_req: Request, res: Response) => { res.json(await getHistoricalPacsAdminStatus()); }));
authoritativeOrthancRouter.post("/operations/historical-pacs-index/sync", requireAnyRole(["supervisor", "super_admin"]), asyncRoute(async (_req: Request, res: Response) => {
  const result = await triggerHistoricalPacsSync();
  if (!result.accepted) throw new HttpError(409, "A Historical PACS synchronization is already running.", { code: "historical_pacs_sync_already_running" });
  res.status(202).json(result);
}));
authoritativeOrthancRouter.post("/operations/historical-pacs-index/full-reconciliation", requireAnyRole(["supervisor", "super_admin"]), asyncRoute(async (_req: Request, res: Response) => {
  const result = await triggerHistoricalPacsSync({ forceFull: true });
  if (!result.accepted) throw new HttpError(409, "A Historical PACS synchronization is already running.", { code: "historical_pacs_sync_already_running" });
  res.status(202).json(result);
}));
authoritativeOrthancRouter.post("/operations/historical-pacs-index/recover-and-full-reconcile", requireAnyRole(["supervisor", "super_admin"]), asyncRoute(async (_req: Request, res: Response) => {
  const result = await recoverStalledHistoricalPacsSync();
  if (!result.accepted) {
    if (result.reason === "active_run") throw new HttpError(409, "A genuinely active Historical PACS synchronization cannot be superseded safely.", { code: "historical_pacs_sync_recovery_active_run" });
    throw new HttpError(409, "Historical PACS synchronization is not stalled and cannot be recovered.", { code: "historical_pacs_sync_not_stalled" });
  }
  res.status(202).json(result);
}));
authoritativeOrthancRouter.get("/operations/routes", asyncRoute(async (_req: Request, res: Response) => { res.json(await getAuthoritativeOrthancOperationalRoutes()); }));
authoritativeOrthancRouter.post("/operations/routes/test-all", requireAnyRole(["supervisor", "super_admin"]), asyncRoute(async (req: Request, res: Response) => { res.json(await testAllAuthoritativeOrthancOperationalRoutes(req.user!.sub)); }));
authoritativeOrthancRouter.post("/operations/routes/:alias/test", requireAnyRole(["supervisor", "super_admin"]), asyncRoute(async (req: Request, res: Response) => { res.json(await testAuthoritativeOrthancOperationalRoute(String(req.params.alias || ""), req.user!.sub)); }));
authoritativeOrthancRouter.post("/operations/routes/synchronize", requireAnyRole(["super_admin"]), asyncRoute(async (req: Request, res: Response) => { res.json({ summary: await synchronizeAuthoritativeOrthancOperationalRoutes(req.user!.sub) }); }));
authoritativeOrthancRouter.get("/operations/jobs", asyncRoute(async (_req: Request, res: Response) => { res.json(await getAuthoritativeOrthancOperationalJobs()); }));
authoritativeOrthancRouter.post("/operations/jobs/:jobId/retry", requireAnyRole(["supervisor", "super_admin"]), asyncRoute(async (req: Request, res: Response) => { res.status(202).json(await retryAuthoritativeOrthancOperationalJob(String(req.params.jobId || ""), req.user!.sub)); }));
authoritativeOrthancRouter.get("/operations/studies/search", asyncRoute(async (req: Request, res: Response) => { res.json(await searchAuthoritativeOrthancOperationalStudy({ studyInstanceUid: typeof req.query.studyInstanceUid === "string" ? req.query.studyInstanceUid : null, accessionNumber: typeof req.query.accessionNumber === "string" ? req.query.accessionNumber : null })); }));
authoritativeOrthancRouter.get("/appointments/:appointmentId/study", requireAnyRole(["modality_staff", "supervisor", "super_admin"]), asyncRoute(async (req: Request, res: Response) => { try { const result = await findAuthoritativeOrthancStudyForAppointment(appointmentId(req.params.appointmentId), req.user!.sub); res.json(result); } catch (error) { const code = error instanceof HttpError ? orthancErrorCode(error) : ""; if (code === "orthanc_disabled") { res.json({ status: "unavailable", reason: "disabled", study: null }); return; } if (code.startsWith("orthanc_")) { res.json({ status: "unavailable", reason: code, study: null }); return; } throw error; } }));
authoritativeOrthancRouter.get("/appointments/:appointmentId/document-exports", requireAnyRole(["modality_staff", "supervisor", "super_admin"]), asyncRoute(async (req: Request, res: Response) => { const id = appointmentId(req.params.appointmentId); const requestedModalityId = req.query.modalityId == null || req.query.modalityId === "" ? null : appointmentId(req.query.modalityId); await assertClinicalDocumentExportAppointmentAccess(id, req.user!.role, requestedModalityId); const exports = await listClinicalDocumentExportsForAppointment(id); res.json({ exports: exports.map((row) => ({ id: row.id, documentId: row.document_id, status: row.status, representationType: row.representation_type, totalPages: row.expected_page_count, exportedPages: row.exported_page_count, verifiedPages: row.verified_page_count, failedPageNumber: row.failed_page_number, seriesStatus: row.status, lastAttemptAt: row.last_attempt_at, nextRetryAt: row.next_retry_at, exportedAt: row.exported_at, verifiedAt: row.verified_at })) }); }));
authoritativeOrthancRouter.post("/appointments/:appointmentId/document-exports/generate-secondary-capture", requireAnyRole(["supervisor", "super_admin"]), asyncRoute(async (req: Request, res: Response) => { res.status(202).json(await generateMissingClinicalDocumentSecondaryCaptureExports(appointmentId(req.params.appointmentId), req.user!.sub)); }));
authoritativeOrthancRouter.post("/document-exports/reconcile", requireAnyRole(["super_admin"]), asyncRoute(async () => { throw new HttpError(410, "Clinical-document export reconciliation is retired; selected-PACS export is event-driven."); }));
authoritativeOrthancRouter.post("/document-exports/:exportId/retry", requireAnyRole(["supervisor", "super_admin"]), asyncRoute(async (req: Request, res: Response) => { res.status(202).json({ export: await retryClinicalDocumentExport(String(req.params.exportId || ""), req.user!.sub) }); }));
authoritativeOrthancRouter.post("/document-exports/:exportId/rebuild-secondary-capture", requireAnyRole(["supervisor", "super_admin"]), asyncRoute(async (req: Request, res: Response) => { res.status(202).json(await rebuildClinicalDocumentSecondaryCaptures(String(req.params.exportId || ""), req.user!.sub)); }));
