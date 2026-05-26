import express, { Request, Response } from "express";
import Busboy from "busboy";
import { createWriteStream } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { requireAuth, requireRecentSupervisorReauth, requireSupervisor } from "../middleware/auth.js";
import { asyncRoute } from "../utils/async-route.js";
import { asOptionalString } from "../utils/request-coercion.js";
import { asUnknownRecord } from "../utils/records.js";
import { HttpError } from "../utils/http-error.js";
import { buildBackupSnapshot, previewBackupRestore, restoreBackupSnapshot, scheduleSystemRestart } from "../services/admin-service.js";
import { streamBackupV3Archive } from "../services/backup-v3-service.js";
import { setBackupV3DownloadHeaders } from "../services/backup-v3-http.js";
import { previewBackupV3RestoreFromArchive } from "../services/backup-v3-preview-service.js";
import { DEFAULT_BACKUP_V3_ARCHIVE_LIMITS } from "../services/backup-v3-manifest.js";
import {
  deleteDocumentsByScope,
  moveDocumentsToConfiguredStorage,
  testConfiguredStorageConnectivity,
} from "../services/document-service.js";

export const adminRouter = express.Router();

adminRouter.use(requireAuth, requireSupervisor, requireRecentSupervisorReauth);

async function stageBackupV3RestorePreviewUpload(req: Request): Promise<{
  tempDir: string;
  archivePath: string;
  stagingDir: string;
  passphrase: string | null;
}> {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "rispro-restore-v3-preview-"));
  const archivePath = path.join(tempDir, "upload.rispro.zip");
  const stagingDir = path.join(tempDir, "staged");
  let passphrase: string | null = null;
  let receivedFile = false;
  let fileSize = 0;

  return new Promise((resolve, reject) => {
    let settled = false;
    let uploadFinished = false;
    const writes: Promise<void>[] = [];
    const fail = (error: unknown) => {
      if (settled) return;
      settled = true;
      void rm(tempDir, { recursive: true, force: true }).finally(() => reject(error));
    };

    const busboy = Busboy({
      headers: req.headers,
      limits: {
        files: 1,
        fileSize: DEFAULT_BACKUP_V3_ARCHIVE_LIMITS.maxTotalUncompressedBytes,
      },
    });

    const interruptUpload = () => {
      if (settled || uploadFinished) return;
      req.unpipe(busboy);
      const error = new HttpError(400, "Backup restore preview upload was interrupted.");
      busboy.destroy(error);
      fail(error);
    };

    req.on("aborted", interruptUpload);
    req.on("close", () => {
      const requestComplete = Boolean((req as Request & { complete?: boolean }).complete);
      if (!requestComplete && !uploadFinished) {
        interruptUpload();
      }
    });

    busboy.on("field", (fieldName, value) => {
      if (fieldName === "passphrase") {
        passphrase = String(value || "");
      }
    });

    busboy.on("file", (fieldName, file) => {
      if (receivedFile || !["backup", "file", "archive"].includes(fieldName)) {
        file.resume();
        return;
      }
      receivedFile = true;
      const writeStream = createWriteStream(archivePath, { flags: "wx" });
      file.on("data", (chunk: Buffer) => {
        fileSize += chunk.length;
      });
      file.on("error", fail);
      writeStream.on("error", fail);
      file.pipe(writeStream);
      writes.push(new Promise<void>((resolveWrite, rejectWrite) => {
        writeStream.on("finish", resolveWrite);
        writeStream.on("error", rejectWrite);
      }));
    });

    busboy.on("filesLimit", () => fail(new HttpError(413, "Only one backup archive can be uploaded.")));
    busboy.on("error", fail);
    busboy.on("finish", () => {
      uploadFinished = true;
      Promise.all(writes)
        .then(() => {
          if (settled) return;
          if (!receivedFile || fileSize === 0) {
            throw new HttpError(400, "A backup archive file is required.");
          }
          settled = true;
          resolve({ tempDir, archivePath, stagingDir, passphrase });
        })
        .catch(fail);
    });

    req.pipe(busboy);
  });
}

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
    const staged = await stageBackupV3RestorePreviewUpload(req);
    try {
      const result = await previewBackupV3RestoreFromArchive(staged.archivePath, staged.stagingDir, staged.passphrase);
      res.json(result);
    } finally {
      await rm(staged.tempDir, { recursive: true, force: true }).catch(() => undefined);
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
