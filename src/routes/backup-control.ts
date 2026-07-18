import express, { type Request, type Response } from "express";
import { requireAnyRole, requireAuth, requireRecentSupervisorReauth } from "../middleware/auth.js";
import { asyncRoute } from "../utils/async-route.js";
import { asUnknownRecord } from "../utils/records.js";
import {
  createBackupDestinationProfile,
  createBackupSchedule,
  cancelQueuedBackupJob,
  deleteBackupDestinationProfile,
  deleteBackupSchedule,
  getBackupArtifactForDownload,
  getBackupControlCenterSummary,
  listBackupDestinationProfiles,
  listBackupJobs,
  queueBackupJob,
  retryBackupJob,
  testBackupDestinationProfile,
  listBackupSchedules,
  updateBackupDestinationProfile,
  updateBackupSchedule,
  updateBackupArchivePassphrase,
} from "../services/backup-v3-control-center-service.js";
import { listBackupV3RestoreVerifications, queueManualBackupV3RestoreVerification, retryFailedBackupV3RestoreVerification } from "../services/backup-v3-restore-verification-queue-service.js";
import { executeBackupV3Retention, previewLocalBackupV3Retention } from "../services/backup-v3-retention-service.js";
import { beginBackupV3MasterKeySetup, confirmBackupV3MasterKeySetup, consumeBackupV3MasterKeyRecovery } from "../services/backup-v3-master-key-setup-service.js";
import { logAuditEntry } from "../services/audit-service.js";
import { recordDiagnosticEvent } from "../services/system-diagnostics-service.js";

/** Routine backup operations are deliberately separate from destructive restore controls. */
export const backupControlRouter = express.Router();
backupControlRouter.use(requireAuth, requireAnyRole(["supervisor", "super_admin"]));

backupControlRouter.get("/summary", asyncRoute(async (_req: Request, res: Response) => res.json(await getBackupControlCenterSummary())));
backupControlRouter.get("/destinations", asyncRoute(async (_req: Request, res: Response) => res.json({ destinations: await listBackupDestinationProfiles() })));
backupControlRouter.get("/jobs", asyncRoute(async (req: Request, res: Response) => res.json({ jobs: await listBackupJobs(Number(req.query.limit || 50)) })));
backupControlRouter.get("/schedules", asyncRoute(async (_req: Request, res: Response) => res.json({ schedules: await listBackupSchedules() })));
backupControlRouter.get("/restore-verifications", asyncRoute(async (req: Request, res: Response) => res.json({ verifications: await listBackupV3RestoreVerifications(Number(req.query.limit || 50)) })));

backupControlRouter.post(
  "/run-now",
  express.json({ limit: "20kb" }),
  asyncRoute(async (req: Request, res: Response) => {
    const body = asUnknownRecord(req.body);
    const destinationIds = Array.isArray(body.destinationIds) ? body.destinationIds.filter((value): value is string => typeof value === "string") : [];
    const job = await queueBackupJob({ initiatedByUserId: req.user!.sub, destinationIds });
    res.status(202).json({ job });
  })
);

backupControlRouter.post(
  "/jobs/:jobId/retry",
  express.json({ limit: "20kb" }),
  asyncRoute(async (req: Request, res: Response) => {
    const jobId = Array.isArray(req.params.jobId) ? req.params.jobId[0] || "" : req.params.jobId || "";
    const body = asUnknownRecord(req.body);
    const destinationIds = Array.isArray(body.destinationIds) ? body.destinationIds.filter((value): value is string => typeof value === "string") : undefined;
    res.status(202).json({ job: await retryBackupJob(jobId, { initiatedByUserId: req.user!.sub, destinationIds }) });
  })
);

backupControlRouter.post(
  "/jobs/:jobId/cancel",
  asyncRoute(async (req: Request, res: Response) => {
    const jobId = Array.isArray(req.params.jobId) ? req.params.jobId[0] || "" : req.params.jobId || "";
    await cancelQueuedBackupJob(jobId, req.user!.sub);
    res.status(204).end();
  })
);

backupControlRouter.get(
  "/jobs/:jobId/download",
  asyncRoute(async (req: Request, res: Response) => {
    const jobId = Array.isArray(req.params.jobId) ? req.params.jobId[0] || "" : req.params.jobId || "";
    const artifact = await getBackupArtifactForDownload(jobId);
    res.attachment(artifact.archiveName);
    res.sendFile(artifact.filePath);
  })
);

backupControlRouter.use(requireAnyRole(["super_admin"]), requireRecentSupervisorReauth);

backupControlRouter.post(
  "/encryption-setup",
  asyncRoute(async (req: Request, res: Response) => {
    try {
      const result = await beginBackupV3MasterKeySetup(String(req.user!.sub));
      recordDiagnosticEvent({ severity: "info", source: "backup_restore", component: "backup_master_key", operation: "setup_generated", requestId: req.requestId, route: req.path, httpMethod: req.method, userId: req.user!.sub, message: "Backup security recovery copy generated." });
      res.status(201).json(result);
    } catch (error) {
      recordDiagnosticEvent({ severity: "error", source: "backup_restore", component: "backup_master_key", operation: "setup_generation_failed", requestId: req.requestId, route: req.path, httpMethod: req.method, userId: req.user!.sub, message: "Backup security setup could not be generated." });
      throw error;
    }
  })
);

backupControlRouter.get(
  "/encryption-setup/:setupId/recovery",
  asyncRoute(async (req: Request, res: Response) => {
    const setupId = Array.isArray(req.params.setupId) ? req.params.setupId[0] || "" : req.params.setupId || "";
    const recovery = consumeBackupV3MasterKeyRecovery(setupId, String(req.user!.sub));
    res.type("text/plain").attachment("rispro-backup-v3-encryption-key-recovery.txt").send(recovery);
  })
);

backupControlRouter.post(
  "/encryption-setup/:setupId/confirm",
  asyncRoute(async (req: Request, res: Response) => {
    const setupId = Array.isArray(req.params.setupId) ? req.params.setupId[0] || "" : req.params.setupId || "";
    try {
      const result = await confirmBackupV3MasterKeySetup(setupId, String(req.user!.sub));
      await logAuditEntry({ entityType: "backup_configuration", actionType: "backup_master_key_initialized", newValues: { outcome: "success", restartRequired: true }, changedByUserId: req.user!.sub });
      recordDiagnosticEvent({ severity: "info", source: "backup_restore", component: "backup_master_key", operation: "setup_saved", requestId: req.requestId, route: req.path, httpMethod: req.method, userId: req.user!.sub, message: "Backup security setup was saved and requires restart.", metadata: { restartRequired: true } });
      res.json(result);
    } catch (error) {
      await logAuditEntry({ entityType: "backup_configuration", actionType: "backup_master_key_initialization_failed", newValues: { outcome: "failed" }, changedByUserId: req.user!.sub }).catch(() => undefined);
      recordDiagnosticEvent({ severity: "error", source: "backup_restore", component: "backup_master_key", operation: "setup_save_failed", requestId: req.requestId, route: req.path, httpMethod: req.method, userId: req.user!.sub, message: "Backup security setup could not be saved." });
      throw error;
    }
  })
);

backupControlRouter.post(
  "/destinations",
  express.json({ limit: "100kb" }),
  asyncRoute(async (req: Request, res: Response) => {
    const body = asUnknownRecord(req.body);
    res.status(201).json({ destination: await createBackupDestinationProfile({ name: body.name, destinationType: body.destinationType, enabled: body.enabled, config: body.config, credentials: body.credentials }, req.user!.sub) });
  })
);

backupControlRouter.patch(
  "/destinations/:destinationId",
  express.json({ limit: "100kb" }),
  asyncRoute(async (req: Request, res: Response) => {
    const destinationId = Array.isArray(req.params.destinationId) ? req.params.destinationId[0] || "" : req.params.destinationId || "";
    const body = asUnknownRecord(req.body);
    res.json({ destination: await updateBackupDestinationProfile(destinationId, { name: body.name, destinationType: body.destinationType, enabled: body.enabled, config: body.config, credentials: Object.hasOwn(body, "credentials") ? body.credentials : undefined }, req.user!.sub) });
  })
);

backupControlRouter.delete(
  "/destinations/:destinationId",
  asyncRoute(async (req: Request, res: Response) => {
    const destinationId = Array.isArray(req.params.destinationId) ? req.params.destinationId[0] || "" : req.params.destinationId || "";
    await deleteBackupDestinationProfile(destinationId, req.user!.sub);
    res.status(204).end();
  })
);

backupControlRouter.post(
  "/jobs/:jobId/verify",
  asyncRoute(async (req: Request, res: Response) => {
    const jobId = Array.isArray(req.params.jobId) ? req.params.jobId[0] || "" : req.params.jobId || "";
    res.status(202).json({ restoreVerificationJobId: await queueManualBackupV3RestoreVerification(jobId, req.user!.sub) });
  })
);

backupControlRouter.post(
  "/restore-verifications/:restoreVerificationJobId/retry",
  asyncRoute(async (req: Request, res: Response) => {
    const restoreVerificationJobId = Array.isArray(req.params.restoreVerificationJobId) ? req.params.restoreVerificationJobId[0] || "" : req.params.restoreVerificationJobId || "";
    res.status(202).json({ restoreVerificationJobId: await retryFailedBackupV3RestoreVerification(restoreVerificationJobId, req.user!.sub) });
  })
);

backupControlRouter.patch(
  "/schedules/:scheduleId",
  express.json({ limit: "100kb" }),
  asyncRoute(async (req: Request, res: Response) => {
    const scheduleId = Array.isArray(req.params.scheduleId) ? req.params.scheduleId[0] || "" : req.params.scheduleId || "";
    const body = asUnknownRecord(req.body);
    res.json({ schedule: await updateBackupSchedule(scheduleId, { name: body.name, frequency: body.frequency, timeOfDay: body.timeOfDay, timezone: body.timezone, selectedWeekdays: body.selectedWeekdays, selectedDayOfMonth: body.selectedDayOfMonth, destinationIds: body.destinationIds, retentionPolicy: body.retentionPolicy, restoreVerificationFrequency: body.restoreVerificationFrequency, enabled: body.enabled }, req.user!.sub) });
  })
);

backupControlRouter.delete(
  "/schedules/:scheduleId",
  asyncRoute(async (req: Request, res: Response) => {
    const scheduleId = Array.isArray(req.params.scheduleId) ? req.params.scheduleId[0] || "" : req.params.scheduleId || "";
    await deleteBackupSchedule(scheduleId, req.user!.sub);
    res.status(204).end();
  })
);

backupControlRouter.post(
  "/destinations/:destinationId/test",
  asyncRoute(async (req: Request, res: Response) => {
    const destinationId = Array.isArray(req.params.destinationId) ? req.params.destinationId[0] || "" : req.params.destinationId || "";
    res.json(await testBackupDestinationProfile(destinationId));
  })
);

backupControlRouter.post(
  "/destinations/:destinationId/retention/preview",
  express.json({ limit: "20kb" }),
  asyncRoute(async (req: Request, res: Response) => {
    const destinationId = Array.isArray(req.params.destinationId) ? req.params.destinationId[0] || "" : req.params.destinationId || "";
    const body = asUnknownRecord(req.body);
    res.json({ plan: await previewLocalBackupV3Retention(destinationId, body.policy) });
  })
);

backupControlRouter.post(
  "/destinations/:destinationId/retention/execute",
  express.json({ limit: "20kb" }),
  asyncRoute(async (req: Request, res: Response) => {
    const destinationId = Array.isArray(req.params.destinationId) ? req.params.destinationId[0] || "" : req.params.destinationId || "";
    const body = asUnknownRecord(req.body);
    res.json(await executeBackupV3Retention({ destinationId, policy: body.policy, performedByUserId: req.user!.sub }));
  })
);

backupControlRouter.post(
  "/encryption-passphrase",
  express.json({ limit: "20kb" }),
  asyncRoute(async (req: Request, res: Response) => {
    const body = asUnknownRecord(req.body);
    await updateBackupArchivePassphrase(body.passphrase, req.user!.sub);
    res.status(204).end();
  })
);

backupControlRouter.post(
  "/schedules",
  express.json({ limit: "100kb" }),
  asyncRoute(async (req: Request, res: Response) => {
    const body = asUnknownRecord(req.body);
    res.status(201).json({ schedule: await createBackupSchedule({ name: body.name, frequency: body.frequency, timeOfDay: body.timeOfDay, timezone: body.timezone, selectedWeekdays: body.selectedWeekdays, selectedDayOfMonth: body.selectedDayOfMonth, destinationIds: body.destinationIds, retentionPolicy: body.retentionPolicy, restoreVerificationFrequency: body.restoreVerificationFrequency, enabled: body.enabled }, req.user!.sub) });
  })
);
