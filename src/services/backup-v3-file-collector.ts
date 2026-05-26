import fs from "node:fs/promises";
import path from "node:path";
import { sha256File } from "./backup-v3-checksums.js";
import type { BackupV3ArchiveLimits, BackupV3FileManifestEntry, BackupV3StorageRoot } from "./backup-v3-types.js";
import { HttpError } from "../utils/http-error.js";

function normalizeArchiveRelativePath(relativePath: string): string {
  return relativePath.split(path.sep).join("/");
}

export async function collectBackupV3StorageFiles(
  roots: BackupV3StorageRoot[],
  limits: BackupV3ArchiveLimits
): Promise<BackupV3FileManifestEntry[]> {
  const files: BackupV3FileManifestEntry[] = [];
  let totalBytes = 0;
  const seenArchivePaths = new Set<string>();

  async function walk(root: BackupV3StorageRoot, currentPath: string): Promise<void> {
    let entries: Array<import("node:fs").Dirent>;
    try {
      entries = await fs.readdir(currentPath, { withFileTypes: true });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        return;
      }
      throw error;
    }

    for (const entry of entries) {
      const absolutePath = path.join(currentPath, entry.name);
      if (entry.isSymbolicLink()) {
        continue;
      }
      if (entry.isDirectory()) {
        await walk(root, absolutePath);
        continue;
      }
      if (!entry.isFile()) {
        continue;
      }

      const stat = await fs.lstat(absolutePath);
      if (stat.size > limits.maxFileBytes) {
        throw new HttpError(413, `Backup file exceeds max file size: ${absolutePath}`);
      }
      if (files.length + 1 > limits.maxFiles) {
        throw new HttpError(413, "Backup contains too many files.");
      }
      totalBytes += stat.size;
      if (totalBytes > limits.maxTotalUncompressedBytes) {
        throw new HttpError(413, "Backup exceeds max total uncompressed size.");
      }

      const relativePath = normalizeArchiveRelativePath(path.relative(root.absolutePath, absolutePath));
      const archivePath = `${root.archivePrefix}/${relativePath}`;
      if (seenArchivePaths.has(archivePath)) {
        continue;
      }
      seenArchivePaths.add(archivePath);
      const digest = await sha256File(absolutePath);
      files.push({
        archivePath,
        rootId: root.id,
        relativePath,
        byteSize: digest.byteSize,
        sha256: digest.sha256,
        crc32: digest.crc32,
      });
    }
  }

  for (const root of roots) {
    await walk(root, root.absolutePath);
  }

  return files.sort((a, b) => a.archivePath.localeCompare(b.archivePath));
}
