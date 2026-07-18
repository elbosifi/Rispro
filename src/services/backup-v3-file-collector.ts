import fs from "node:fs/promises";
import path from "node:path";
import { sha256File } from "./backup-v3-checksums.js";
import type { BackupV3ArchiveLimits, BackupV3FileManifestEntry, BackupV3StorageRoot } from "./backup-v3-types.js";
import { HttpError } from "../utils/http-error.js";

export interface CollectedBackupV3StorageFile extends BackupV3FileManifestEntry {
  stagedPath: string;
}

function normalizeArchiveRelativePath(relativePath: string): string {
  return relativePath.split(path.sep).join("/");
}

function isSameOrInside(child: string, parent: string): boolean {
  const relative = path.relative(parent, child);
  return relative === "" || (!!relative && !relative.startsWith("..") && !path.isAbsolute(relative));
}

export async function collectBackupV3StorageFiles(
  roots: BackupV3StorageRoot[],
  limits: BackupV3ArchiveLimits,
  stagingDir?: string
): Promise<CollectedBackupV3StorageFile[]> {
  const files: CollectedBackupV3StorageFile[] = [];
  let totalBytes = 0;
  const seenArchivePaths = new Set<string>();
  // project-storage is the complete application storage tree. Backup internals
  // must never become backup input, regardless of their current child names.
  const excludedBackupRoots = roots
    .filter((root) => root.id === "project-storage" || root.kind === "project_storage")
    .map((root) => path.resolve(root.absolutePath, "backups"));

  async function walk(root: BackupV3StorageRoot, currentPath: string): Promise<void> {
    if (excludedBackupRoots.some((excludedRoot) => isSameOrInside(path.resolve(currentPath), excludedRoot))) {
      return;
    }
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
      const relativePath = normalizeArchiveRelativePath(path.relative(root.absolutePath, absolutePath));
      const archivePath = `${root.archivePrefix}/${relativePath}`;
      if (seenArchivePaths.has(archivePath)) {
        continue;
      }
      seenArchivePaths.add(archivePath);
      const stagedPath = stagingDir ? path.join(stagingDir, archivePath) : absolutePath;
      if (stagingDir) {
        await fs.mkdir(path.dirname(stagedPath), { recursive: true });
        await fs.copyFile(absolutePath, stagedPath);
      }
      const digest = await sha256File(stagedPath);
      if (digest.byteSize > limits.maxFileBytes) {
        throw new HttpError(413, `Backup file exceeds max file size after staging: ${absolutePath}`);
      }
      if (files.length + 1 > limits.maxFiles) {
        throw new HttpError(413, "Backup contains too many files.");
      }
      totalBytes += digest.byteSize;
      if (totalBytes > limits.maxTotalUncompressedBytes) {
        throw new HttpError(413, "Backup exceeds max total uncompressed size.");
      }
      files.push({
        archivePath,
        rootId: root.id,
        relativePath,
        byteSize: digest.byteSize,
        sha256: digest.sha256,
        crc32: digest.crc32,
        stagedPath,
      });
    }
  }

  for (const root of roots) {
    await walk(root, root.absolutePath);
  }

  return files.sort((a, b) => a.archivePath.localeCompare(b.archivePath));
}
