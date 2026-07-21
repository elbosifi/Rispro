import express, { Request, Response } from "express";
import { hasRecentSupervisorReauth, requireAnyRole, requireAuth, requireRecentSupervisorReauth, requireSupervisor } from "../middleware/auth.js";
import { asyncRoute } from "../utils/async-route.js";
import { asOptionalString } from "../utils/request-coercion.js";
import { asUnknownRecord } from "../utils/records.js";
import { HttpError } from "../utils/http-error.js";
import { buildBackupSnapshot, previewBackupRestore, restoreBackupSnapshot, scheduleSystemRestart } from "../services/admin-service.js";
import { streamBackupV3Archive } from "../services/backup-v3-service.js";
import { setBackupV3DownloadHeaders } from "../services/backup-v3-http.js";
import { previewBackupV3RestoreFromArchive } from "../services/backup-v3-preview-service.js";
import { cleanupBackupV3StagedUpload, stageBackupV3MultipartUpload } from "../services/backup-v3-upload.js";
import {
  requireBackupV3RestoreConfirmation,
  runBackupV3DatabaseRestoreOnly,
} from "../services/backup-v3-safety-service.js";
import { restoreBackupV3FullService } from "../services/backup-v3-full-restore.js";
import {
  appendBackupV3UploadChunk,
  cancelBackupV3UploadSession,
  claimBackupV3PreviewForRestore,
  completeBackupV3UploadSession,
  createBackupV3PreviewJob,
  createBackupV3UploadSession,
  getBackupV3PreviewJob,
  getBackupV3UploadSession,
} from "../services/backup-v3-restore-jobs-service.js";
import {
  deleteDocumentsByScope,
  moveDocumentsToConfiguredStorage,
  testConfiguredStorageConnectivity,
} from "../services/document-service.js";
import { recordDiagnosticEvent } from "../services/system-diagnostics-service.js";
import { logAuditEntry } from "../services/audit-service.js";

export const adminRouter = express.Router();

adminRouter.use(requireAuth, requireSupervisor);

adminRouter.get(
  "/restore/v3/status",
  asyncRoute(async (req: Request, res: Response) => {
    const enabled = true;
    const dbOnlyEnabled = process.env.RESTORE_V3_DB_ONLY_ENABLED === "true";
    const recentReauthSatisfied = hasRecentSupervisorReauth(req);
    const userCanExecute = req.user?.role === "super_admin";
    const disabledReason = !userCanExecute
        ? "V3 full restore requires super_admin."
        : !recentReauthSatisfied
          ? "Recent supervisor re-authentication is required."
          : undefined;

    res.json({
      enabled,
      dbOnlyEnabled,
      requiresSuperAdmin: true,
      userCanExecute,
      recentReauthRequired: true,
      recentReauthSatisfied,
      confirmationText: "RESTORE RISPRO",
      acceptedArchiveExtensions: [".rispro.zip"],
      ...(disabledReason ? { disabledReason } : {}),
    });
  })
);

adminRouter.use(requireRecentSupervisorReauth);

adminRouter.get(
  "/backup/v3",
  asyncRoute(async (req: Request, res: Response) => {
    const passphrase = req.header("x-backup-passphrase");
    const createdAt = new Date().toISOString();
    const backupName = `rispro-backup-${createdAt.replace(/[:.]/g, "-")}.rispro.zip`;
    setBackupV3DownloadHeaders(res, backupName);
    try {
      await streamBackupV3Archive({ currentUserId: req.user!.sub, passphrase, output: res, backupName });
    } catch (error) {
      recordDiagnosticEvent({ severity: "error", source: "backup_restore", component: "v3_backup", operation: "generate", requestId: req.requestId, route: req.path, httpMethod: req.method, userId: req.user!.sub, message: "V3 backup generation failed.", technicalDetails: error instanceof Error ? error.stack : error });
      throw error;
    }
  })
);

adminRouter.get(
  "/backup",
  // Deprecated compatibility route; remove after one release with zero audited use.
  requireAnyRole(["super_admin"]),
  asyncRoute(async (req: Request, res: Response) => {
    const passphrase = req.header("x-backup-passphrase");
    const result = await buildBackupSnapshot(req.user!.sub, passphrase);
    res.setHeader("Content-Disposition", `attachment; filename="${result.backupName}"`);
    await logAuditEntry({ entityType: "backup_v2", actionType: "deprecated_backup_downloaded", newValues: { deprecated: true }, changedByUserId: req.user!.sub });
    recordDiagnosticEvent({ severity: "warning", source: "backup_restore", component: "backup_v2", operation: "deprecated_backup", requestId: req.requestId, route: req.path, httpMethod: req.method, userId: req.user!.sub, message: "Deprecated V2 backup compatibility route was used." });
    res.json(result.backup);
  })
);

adminRouter.post(
  "/restore/v3/upload-sessions",
  express.json({ limit: "64kb" }),
  asyncRoute(async (req: Request, res: Response) => {
    const body = asUnknownRecord(req.body);
    res.status(201).json(await createBackupV3UploadSession({ userId: req.user!.sub, archiveName: body.archiveName, expectedSizeBytes: body.expectedSizeBytes, expectedSha256: body.expectedSha256 }));
  })
);

adminRouter.get("/restore/v3/upload-sessions/:uploadSessionId", asyncRoute(async (req, res) => res.json(await getBackupV3UploadSession(String(req.params.uploadSessionId)))));
adminRouter.put("/restore/v3/upload-sessions/:uploadSessionId/chunks", asyncRoute(async (req, res) => res.json(await appendBackupV3UploadChunk(String(req.params.uploadSessionId), req.header("x-upload-offset"), req))));
adminRouter.post("/restore/v3/upload-sessions/:uploadSessionId/complete", asyncRoute(async (req, res) => res.json(await completeBackupV3UploadSession(String(req.params.uploadSessionId)))));
adminRouter.delete("/restore/v3/upload-sessions/:uploadSessionId", asyncRoute(async (req, res) => res.json(await cancelBackupV3UploadSession(String(req.params.uploadSessionId)))));

adminRouter.post(
  "/restore/v3/preview",
  express.json({ limit: "64kb" }),
  asyncRoute(async (req: Request, res: Response) => {
    const body = asUnknownRecord(req.body); const source = asUnknownRecord(body.source);
    const type = String(source.type || "");
    const selected = type === "artifact" ? { type, artifactId: String(source.artifactId || "") } : type === "destination_copy" ? { type, copyAttemptId: String(source.copyAttemptId || "") } : type === "upload_session" ? { type, uploadSessionId: String(source.uploadSessionId || "") } : null;
    if (!selected) throw new HttpError(400, "Preview source must be an artifact, verified destination copy, or completed upload session.");
    const job = await createBackupV3PreviewJob({ userId: req.user!.sub, source: selected as never, passphrase: body.passphrase });
    recordDiagnosticEvent({ severity: "info", source: "backup_restore", component: "v3_preview", operation: "queued", requestId: req.requestId, route: req.path, httpMethod: req.method, userId: req.user!.sub, message: "V3 restore preview queued.", metadata: { previewJobId: job.previewJobId, sourceType: type } });
    res.status(202).json(job);
  })
);
adminRouter.get("/restore/v3/preview/:previewJobId", asyncRoute(async (req, res) => res.json(await getBackupV3PreviewJob(String(req.params.previewJobId)))));

adminRouter.post(
  "/restore/v3/db-only",
  asyncRoute(async (req: Request, res: Response) => {
    if (process.env.RESTORE_V3_DB_ONLY_ENABLED !== "true") {
      throw new HttpError(403, "V3 DB-only restore is experimental and disabled by configuration.");
    }
    const staged = await stageBackupV3MultipartUpload(req, "rispro-restore-v3-");
    try {
      requireBackupV3RestoreConfirmation(staged.confirmation);
      if (!staged.passphrase) {
        throw new HttpError(400, "Backup passphrase is required.");
      }
      const preview = await previewBackupV3RestoreFromArchive(staged.archivePath, staged.stagingDir, staged.passphrase);
      if (!preview.ok) {
        throw new HttpError(400, `Backup is not safe to restore: ${preview.errors.join("; ")}`);
      }
      const result = await runBackupV3DatabaseRestoreOnly({
        currentUserId: req.user!.sub,
        uploadedArchivePath: staged.archivePath,
        uploadedArchiveName: staged.archiveFileName,
        passphrase: staged.passphrase,
        stagingDir: staged.stagingDir,
      });
      res.json(result);
    } finally {
      await cleanupBackupV3StagedUpload(staged).catch(() => undefined);
    }
  })
);

adminRouter.post(
  "/restore/v3",
  requireAnyRole(["super_admin"]),
  express.json({ limit: "64kb" }),
  asyncRoute(async (req: Request, res: Response) => {
    recordDiagnosticEvent({ severity: "info", source: "backup_restore", component: "full_restore", operation: "started", requestId: req.requestId, route: req.path, httpMethod: req.method, userId: req.user!.sub, message: "V3 full restore started." });
    const body = asUnknownRecord(req.body);
    try {
      requireBackupV3RestoreConfirmation(body.confirmation);
      const passphrase = String(body.passphrase || "");
      if (!passphrase) {
        throw new HttpError(400, "Backup passphrase is required.");
      }
      const preview = await claimBackupV3PreviewForRestore(String(body.previewJobId || ""));
      const result = await restoreBackupV3FullService({
        currentUserId: req.user!.sub,
        uploadedArchivePath: preview.archivePath,
        uploadedArchiveName: null,
        passphrase,
        stagingDir: preview.stagingDir,
        expectedArchiveDigest: { sha256: preview.archiveSha256, byteSize: preview.archiveSizeBytes },
      });
      recordDiagnosticEvent({ severity: result.ok ? "info" : "error", source: "backup_restore", component: "full_restore", operation: result.ok ? "succeeded" : "partial_failure", requestId: req.requestId, route: req.path, httpMethod: req.method, userId: req.user!.sub, message: result.ok ? "V3 full restore succeeded." : "V3 full restore completed with a partial failure.", metadata: { partialComponent: result.partialFailure?.component } });
      res.json(result);
    } catch (error) {
      recordDiagnosticEvent({ severity: "error", source: "backup_restore", component: "full_restore", operation: "failed", requestId: req.requestId, route: req.path, httpMethod: req.method, userId: req.user!.sub, message: "V3 full restore failed.", technicalDetails: error instanceof Error ? error.stack : error });
      throw error;
    }
  })
);

adminRouter.post(
  "/restore/preview",
  requireAnyRole(["super_admin"]),
  express.json({ limit: "500mb" }),
  asyncRoute(async (req: Request, res: Response) => {
    const body = asUnknownRecord(req.body);
    const result = await previewBackupRestore(body.backup, body.passphrase);
    res.json(result);
  })
);

adminRouter.post(
  "/restore",
  // Deprecated compatibility route; preserve historical V2 restores temporarily.
  requireAnyRole(["super_admin"]),
  express.json({ limit: "500mb" }),
  asyncRoute(async (req: Request, res: Response) => {
    const body = asUnknownRecord(req.body);
    const result = await restoreBackupSnapshot(body.backup, req.user!.sub, body.passphrase, body.confirmation);
    await logAuditEntry({ entityType: "backup_v2", actionType: "deprecated_restore_executed", newValues: { deprecated: true }, changedByUserId: req.user!.sub });
    recordDiagnosticEvent({ severity: "warning", source: "backup_restore", component: "backup_v2", operation: "deprecated_restore", requestId: req.requestId, route: req.path, httpMethod: req.method, userId: req.user!.sub, message: "Deprecated V2 restore compatibility route was used." });
    res.json(result);
  })
);

adminRouter.post(
  "/system/restart",
  asyncRoute(async (req: Request, res: Response) => {
    let result;
    try { result = await scheduleSystemRestart(req.user!.sub); } catch (error) {
      recordDiagnosticEvent({ severity: "error", source: "backup_restore", component: "restart_scheduling", operation: "failed", requestId: req.requestId, route: req.path, httpMethod: req.method, userId: req.user!.sub, message: "Restart scheduling failed.", technicalDetails: error instanceof Error ? error.stack : error });
      throw error;
    }
    res.json(result);
  })
);

adminRouter.post(
  "/documents/delete",
  asyncRoute(async (req: Request, res: Response) => {
    const body = asUnknownRecord(req.body);
    const mode = String(body.mode || "all") as "all" | "appointment_date_range";
    if (!["all", "appointment_date_range"].includes(mode)) {
      throw new HttpError(400, "mode must be 'all' or 'appointment_date_range'.");
    }
    const result = await deleteDocumentsByScope(
      {
        mode,
        dateFrom: asOptionalString(body.dateFrom),
        dateTo: asOptionalString(body.dateTo),
      },
      req.user!.sub
    );
    res.json(result);
  })
);

adminRouter.post(
  "/documents/move-storage",
  asyncRoute(async (req: Request, res: Response) => {
    const body = asUnknownRecord(req.body);
    const mode = String(body.mode || "all") as "all" | "appointment_date_range";
    if (!["all", "appointment_date_range"].includes(mode)) {
      throw new HttpError(400, "mode must be 'all' or 'appointment_date_range'.");
    }
    const result = await moveDocumentsToConfiguredStorage(
      {
        mode,
        dateFrom: asOptionalString(body.dateFrom),
        dateTo: asOptionalString(body.dateTo),
      },
      req.user!.sub
    );
    res.json(result);
  })
);

adminRouter.post(
  "/documents/storage-test",
  asyncRoute(async (_req: Request, res: Response) => {
    const result = await testConfiguredStorageConnectivity();
    res.json(result);
  })
);
