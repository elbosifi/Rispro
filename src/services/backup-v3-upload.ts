import Busboy from "busboy";
import { createWriteStream } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { Request } from "express";
import { DEFAULT_BACKUP_V3_ARCHIVE_LIMITS } from "./backup-v3-manifest.js";
import { HttpError } from "../utils/http-error.js";

const ACCEPTED_ARCHIVE_FIELDS = new Set(["backup", "file", "archive"]);
const ACCEPTED_TEXT_FIELDS = new Set(["passphrase", "confirmation"]);

export interface BackupV3StagedUpload {
  tempDir: string;
  archivePath: string;
  stagingDir: string;
  passphrase: string | null;
  confirmation: string | null;
  archiveFileName: string | null;
  archiveSize: number;
}

export async function cleanupBackupV3StagedUpload(staged: Pick<BackupV3StagedUpload, "tempDir">): Promise<void> {
  await rm(staged.tempDir, { recursive: true, force: true });
}

export async function stageBackupV3MultipartUpload(req: Request, tempPrefix: string): Promise<BackupV3StagedUpload> {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), tempPrefix));
  const archivePath = path.join(tempDir, "upload.rispro.zip");
  const stagingDir = path.join(tempDir, "staged");
  let passphrase: string | null = null;
  let confirmation: string | null = null;
  let archiveFileName: string | null = null;
  let receivedFile = false;
  let fileSize = 0;

  return new Promise((resolve, reject) => {
    let settled = false;
    let uploadFinished = false;
    const writes: Promise<void>[] = [];
    let busboy: ReturnType<typeof Busboy>;
    const fail = (error: unknown) => {
      if (settled) return;
      settled = true;
      try {
        req.unpipe(busboy);
        busboy.removeAllListeners();
        req.resume();
      } catch {
        // The parser may already be closed during client disconnect cleanup.
      }
      void cleanupBackupV3StagedUpload({ tempDir }).finally(() => reject(error));
    };

    busboy = Busboy({
      headers: req.headers,
      limits: {
        files: 1,
        fields: 4,
        fileSize: DEFAULT_BACKUP_V3_ARCHIVE_LIMITS.maxTotalUncompressedBytes,
      },
    });

    const interruptUpload = () => {
      if (settled || uploadFinished) return;
      const error = new HttpError(400, "Backup restore upload was interrupted.");
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
      if (!ACCEPTED_TEXT_FIELDS.has(fieldName)) {
        fail(new HttpError(400, `Unexpected restore field: ${fieldName}`));
        return;
      }
      if (fieldName === "passphrase") {
        passphrase = String(value || "");
      }
      if (fieldName === "confirmation") {
        confirmation = String(value || "");
      }
    });

    busboy.on("file", (fieldName, file, info) => {
      if (!ACCEPTED_ARCHIVE_FIELDS.has(fieldName)) {
        file.resume();
        fail(new HttpError(400, `Unexpected backup archive field: ${fieldName}`));
        return;
      }
      if (receivedFile) {
        file.resume();
        fail(new HttpError(413, "Only one backup archive can be uploaded."));
        return;
      }
      receivedFile = true;
      archiveFileName = path.basename(String(info.filename || "backup.rispro.zip"));
      const writeStream = createWriteStream(archivePath, { flags: "wx" });
      file.on("data", (chunk: Buffer) => {
        fileSize += chunk.length;
      });
      file.on("error", fail);
      file.on("limit", () => fail(new HttpError(413, "Backup archive exceeds the maximum upload size.")));
      writeStream.on("error", fail);
      file.pipe(writeStream);
      writes.push(new Promise<void>((resolveWrite, rejectWrite) => {
        writeStream.on("finish", resolveWrite);
        writeStream.on("error", rejectWrite);
      }));
    });

    busboy.on("filesLimit", () => fail(new HttpError(413, "Only one backup archive can be uploaded.")));
    busboy.on("fieldsLimit", () => fail(new HttpError(413, "Too many restore fields.")));
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
          resolve({ tempDir, archivePath, stagingDir, passphrase, confirmation, archiveFileName, archiveSize: fileSize });
        })
        .catch(fail);
    });

    req.pipe(busboy);
  });
}
