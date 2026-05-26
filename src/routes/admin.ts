import express, { Request, Response } from "express";
import { requireAuth, requireRecentSupervisorReauth, requireSupervisor } from "../middleware/auth.js";
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
import {
  deleteDocumentsByScope,
  moveDocumentsToConfiguredStorage,
  testConfiguredStorageConnectivity,
} from "../services/document-service.js";

export const adminRouter = express.Router();

adminRouter.use(requireAuth, requireSupervisor, requireRecentSupervisorReauth);

adminRouter.get(
  "/backup/v3",
  asyncRoute(async (req: Request, res: Response) => {
    const passphrase = req.header("x-backup-passphrase") || req.query.passphrase;
    const createdAt = new Date().toISOString();
    const backupName = `rispro-backup-${createdAt.replace(/[:.]/g, "-")}.rispro.zip`;
    setBackupV3DownloadHeaders(res, backupName);
    await streamBackupV3Archive({ currentUserId: req.user!.sub, passphrase, output: res, backupName });
  })
);

adminRouter.get(
  "/backup",
  asyncRoute(async (req: Request, res: Response) => {
    const passphrase = req.header("x-backup-passphrase") || req.query.passphrase;
    const result = await buildBackupSnapshot(req.user!.sub, passphrase);
    res.setHeader("Content-Disposition", `attachment; filename="${result.backupName}"`);
    res.json(result.backup);
  })
);

adminRouter.post(
  "/restore/v3/preview",
  asyncRoute(async (req: Request, res: Response) => {
    const staged = await stageBackupV3MultipartUpload(req, "rispro-restore-v3-preview-");
    try {
      const result = await previewBackupV3RestoreFromArchive(staged.archivePath, staged.stagingDir, staged.passphrase);
      res.json(result);
    } finally {
      await cleanupBackupV3StagedUpload(staged).catch(() => undefined);
    }
  })
);

adminRouter.post(
  "/restore/v3",
  asyncRoute(async (req: Request, res: Response) => {
    const staged = await stageBackupV3MultipartUpload(req, "rispro-restore-v3-");
    try {
      requireBackupV3RestoreConfirmation(staged.confirmation);
      const preview = await previewBackupV3RestoreFromArchive(staged.archivePath, staged.stagingDir, staged.passphrase);
      if (!preview.ok) {
        throw new HttpError(400, `Backup is not safe to restore: ${preview.errors.join("; ")}`);
      }
      const result = await runBackupV3DatabaseRestoreOnly({
        currentUserId: req.user!.sub,
        uploadedArchivePath: staged.archivePath,
        uploadedArchiveName: staged.archiveFileName,
        passphrase: String(staged.passphrase || ""),
        stagingDir: staged.stagingDir,
      });
      res.json(result);
    } finally {
      await cleanupBackupV3StagedUpload(staged).catch(() => undefined);
    }
  })
);

adminRouter.post(
  "/restore/preview",
  express.json({ limit: "500mb" }),
  asyncRoute(async (req: Request, res: Response) => {
    const body = asUnknownRecord(req.body);
    const result = await previewBackupRestore(body.backup, body.passphrase);
    res.json(result);
  })
);

adminRouter.post(
  "/restore",
  express.json({ limit: "500mb" }),
  asyncRoute(async (req: Request, res: Response) => {
    const body = asUnknownRecord(req.body);
    const result = await restoreBackupSnapshot(body.backup, req.user!.sub, body.passphrase, body.confirmation);
    res.json(result);
  })
);

adminRouter.post(
  "/system/restart",
  asyncRoute(async (req: Request, res: Response) => {
    const result = await scheduleSystemRestart(req.user!.sub);
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
