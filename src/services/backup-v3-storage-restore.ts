import fs from "node:fs/promises";
import path from "node:path";
import { sha256File } from "./backup-v3-checksums.js";
import type { BackupV3FileManifestEntry, BackupV3Manifest, BackupV3StorageRoot } from "./backup-v3-types.js";
import type { BackupV3SafetyMetadata } from "./backup-v3-safety-service.js";
import { HttpError } from "../utils/http-error.js";

export interface BackupV3StorageRestoreResult {
  ok: true;
  storageRestored: true;
  dbRestored: false;
  envRestored: false;
  restoreIncomplete: true;
  restoredRoots: Array<{ id: string; path: string; files: number }>;
  safetyBackupsCreated: BackupV3SafetyMetadata;
}

export interface BackupV3StorageRestorePartialFailure {
  ok: false;
  storageRestored: "partial";
  dbRestored: false;
  envRestored: false;
  restoreIncomplete: true;
  partialFailure: true;
  message: string;
  safetyBackupsCreated: BackupV3SafetyMetadata;
  restoredRoots: Array<{ id: string; path: string; files: number }>;
}

export class BackupV3StoragePartialFailureError extends Error {
  constructor(readonly result: BackupV3StorageRestorePartialFailure) {
    super(result.message);
  }
}

interface RestoreOptions {
  manifest: BackupV3Manifest;
  stagingDir: string;
  currentRoots: BackupV3StorageRoot[];
  safetyBackupsCreated: BackupV3SafetyMetadata;
  failAfterRemovingRootId?: string;
  onRemovePath?: (targetPath: string) => void;
}

function isSameOrInside(child: string, parent: string): boolean {
  const relative = path.relative(parent, child);
  return relative === "" || (!!relative && !relative.startsWith("..") && !path.isAbsolute(relative));
}

function isWindowsDrivePath(value: string): boolean {
  return /^[A-Za-z]:[\\/]/.test(value);
}

function isUncPath(value: string): boolean {
  return value.startsWith("\\\\") || value.startsWith("//");
}

function safeRelativePath(value: string, label: string): string {
  const normalized = value.replace(/\\/g, "/");
  if (
    !normalized ||
    normalized.startsWith("/") ||
    path.posix.isAbsolute(normalized) ||
    isWindowsDrivePath(value) ||
    isUncPath(value) ||
    normalized.split("/").includes("..")
  ) {
    throw new HttpError(400, `Unsafe storage restore path in ${label}: ${value}`);
  }
  return normalized;
}

function resolveInside(root: string, relativePath: string): string {
  const absolute = path.resolve(root, relativePath);
  if (!isSameOrInside(absolute, root)) {
    throw new HttpError(400, `Storage restore path escapes target root: ${relativePath}`);
  }
  return absolute;
}

function assertAllowedRoot(root: BackupV3StorageRoot): void {
  if (root.kind === "document_storage") {
    throw new HttpError(400, `External document storage root is not restored in this phase: ${root.id}`);
  }
  if (/orthanc/i.test(root.id) || /orthanc/i.test(root.archivePrefix) || /orthanc/i.test(root.absolutePath)) {
    throw new HttpError(400, `Orthanc storage roots are not restored by RISpro v3 storage restore: ${root.id}`);
  }
}

function isAppOwnedStorageRoot(root: BackupV3StorageRoot): boolean {
  return root.kind !== "document_storage";
}

function planRestoreRoots(manifest: BackupV3Manifest, currentRoots: BackupV3StorageRoot[]): BackupV3StorageRoot[] {
  const currentById = new Map(currentRoots.map((root) => [root.id, root]));
  const planned: BackupV3StorageRoot[] = [];
  for (const manifestRoot of manifest.storageRoots.filter(isAppOwnedStorageRoot)) {
    assertAllowedRoot(manifestRoot);
    const current = currentById.get(manifestRoot.id);
    if (!current) {
      throw new HttpError(400, `Backup contains unknown storage root: ${manifestRoot.id}`);
    }
    assertAllowedRoot(current);
    planned.push(current);
  }
  return planned.sort((a, b) => a.absolutePath.length - b.absolutePath.length);
}

function validateFileRoot(manifest: BackupV3Manifest, file: BackupV3FileManifestEntry, rootsById: Map<string, BackupV3StorageRoot>): BackupV3StorageRoot {
  const manifestRoot = manifest.storageRoots.find((root) => root.id === file.rootId);
  if (!manifestRoot) {
    throw new HttpError(400, `Backup file references unknown storage root: ${file.rootId}`);
  }
  assertAllowedRoot(manifestRoot);
  const currentRoot = rootsById.get(file.rootId);
  if (!currentRoot) {
    throw new HttpError(400, `Backup file root is not approved in this deployment: ${file.rootId}`);
  }
  const relativePath = safeRelativePath(file.relativePath, file.archivePath);
  const expectedArchivePath = `${manifestRoot.archivePrefix.replace(/^\/+|\/+$/g, "")}/${relativePath}`;
  if (file.archivePath !== expectedArchivePath) {
    throw new HttpError(400, `Backup file archive path does not match its storage root: ${file.archivePath}`);
  }
  return currentRoot;
}

async function copyVerifiedFile(source: string, target: string, expected: BackupV3FileManifestEntry): Promise<void> {
  const digest = await sha256File(source);
  if (digest.byteSize !== expected.byteSize || digest.sha256.toLowerCase() !== expected.sha256.toLowerCase()) {
    throw new HttpError(400, `Storage file checksum or size mismatch: ${expected.archivePath}`);
  }
  await fs.mkdir(path.dirname(target), { recursive: true });
  await fs.copyFile(source, target);
  const copied = await sha256File(target);
  if (copied.byteSize !== expected.byteSize || copied.sha256.toLowerCase() !== expected.sha256.toLowerCase()) {
    throw new HttpError(400, `Restored storage file verification failed: ${expected.archivePath}`);
  }
}

async function assertNoSymlinks(root: string): Promise<void> {
  let entries: Array<import("node:fs").Dirent>;
  try {
    entries = await fs.readdir(root, { withFileTypes: true });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return;
    }
    throw error;
  }
  for (const entry of entries) {
    const fullPath = path.join(root, entry.name);
    if (entry.isSymbolicLink()) {
      throw new HttpError(400, `Symlink found in staged storage restore: ${fullPath}`);
    }
    if (entry.isDirectory()) {
      await assertNoSymlinks(fullPath);
    }
  }
}

async function moveExistingAside(targetRoot: string): Promise<string | null> {
  try {
    await fs.access(targetRoot);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return null;
    }
    throw error;
  }
  const aside = `${targetRoot}.restore-swap-${process.pid}-${Date.now()}`;
  await fs.rename(targetRoot, aside);
  return aside;
}

function nestedBoundariesFor(root: BackupV3StorageRoot, roots: BackupV3StorageRoot[]): string[] {
  return roots
    .filter((candidate) => candidate.id !== root.id && isSameOrInside(candidate.absolutePath, root.absolutePath))
    .map((candidate) => candidate.absolutePath)
    .sort((a, b) => a.length - b.length);
}

function hasParentRestoreRoot(root: BackupV3StorageRoot, roots: BackupV3StorageRoot[]): boolean {
  return roots.some((candidate) => candidate.id !== root.id && isSameOrInside(root.absolutePath, candidate.absolutePath));
}

function isBoundaryPath(targetPath: string, boundaries: string[]): boolean {
  return boundaries.some((boundary) => path.resolve(targetPath) === path.resolve(boundary));
}

function containsBoundaryPath(targetPath: string, boundaries: string[]): boolean {
  return boundaries.some((boundary) => isSameOrInside(path.resolve(boundary), path.resolve(targetPath)));
}

async function removeDirectoryContents(targetRoot: string, boundaries: string[], onRemovePath?: (targetPath: string) => void): Promise<void> {
  let entries: Array<import("node:fs").Dirent>;
  try {
    entries = await fs.readdir(targetRoot, { withFileTypes: true });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      await fs.mkdir(targetRoot, { recursive: true });
      return;
    }
    throw error;
  }
  for (const entry of entries) {
    const target = path.join(targetRoot, entry.name);
    if (entry.isDirectory() && isBoundaryPath(target, boundaries)) {
      continue;
    }
    if (entry.isDirectory() && containsBoundaryPath(target, boundaries)) {
      await removeDirectoryContents(target, boundaries, onRemovePath);
      continue;
    }
    onRemovePath?.(target);
    try {
      await fs.rm(target, { recursive: true, force: true });
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (entry.isDirectory() && (code === "EBUSY" || code === "EPERM" || code === "ENOTEMPTY") && isBoundaryPath(target, boundaries)) {
        continue;
      }
      throw error;
    }
  }
}

async function copyDirectoryContents(sourceRoot: string, targetRoot: string, boundaries: string[] = []): Promise<void> {
  await fs.mkdir(targetRoot, { recursive: true });
  let entries: Array<import("node:fs").Dirent>;
  try {
    entries = await fs.readdir(sourceRoot, { withFileTypes: true });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return;
    }
    throw error;
  }
  for (const entry of entries) {
    const source = path.join(sourceRoot, entry.name);
    const target = path.join(targetRoot, entry.name);
    if (entry.isDirectory() && isBoundaryPath(target, boundaries)) {
      continue;
    }
    if (entry.isDirectory() && containsBoundaryPath(target, boundaries)) {
      await copyDirectoryContents(source, target, boundaries);
      continue;
    }
    if (entry.isDirectory()) {
      await copyDirectoryContents(source, target, boundaries);
      continue;
    }
    if (entry.isFile()) {
      await fs.copyFile(source, target);
    }
  }
}

async function removeAside(aside: string | null): Promise<void> {
  if (aside) {
    await fs.rm(aside, { recursive: true, force: true });
  }
}

function fileTargetsNestedRoot(root: BackupV3StorageRoot, file: BackupV3FileManifestEntry, roots: BackupV3StorageRoot[]): boolean {
  const target = resolveInside(root.absolutePath, safeRelativePath(file.relativePath, file.archivePath));
  return roots.some((candidate) => candidate.id !== root.id && isSameOrInside(candidate.absolutePath, root.absolutePath) && isSameOrInside(target, candidate.absolutePath));
}

export async function restoreBackupV3AppOwnedStorageOnly(
  options: RestoreOptions
): Promise<BackupV3StorageRestoreResult> {
  const plannedRoots = planRestoreRoots(options.manifest, options.currentRoots);
  const rootsById = new Map(plannedRoots.map((root) => [root.id, root]));
  const tempRoot = await fs.mkdtemp(path.join(path.dirname(plannedRoots[0]?.absolutePath || process.cwd()), ".rispro-storage-restore-"));
  const filesByRoot = new Map<string, BackupV3FileManifestEntry[]>();
  const restoredRoots: Array<{ id: string; path: string; files: number }> = [];

  try {
    for (const file of options.manifest.files) {
      const manifestRoot = options.manifest.storageRoots.find((root) => root.id === file.rootId);
      if (!manifestRoot) {
        throw new HttpError(400, `Backup file references unknown storage root: ${file.rootId}`);
      }
      if (manifestRoot?.kind === "document_storage") {
        continue;
      }
      if (!rootsById.has(file.rootId)) {
        continue;
      }
      const currentRoot = validateFileRoot(options.manifest, file, rootsById);
      if (fileTargetsNestedRoot(currentRoot, file, plannedRoots)) {
        continue;
      }
      const relativePath = safeRelativePath(file.relativePath, file.archivePath);
      const stagedSource = resolveInside(options.stagingDir, file.archivePath);
      const replacementRoot = path.join(tempRoot, currentRoot.id);
      const replacementTarget = resolveInside(replacementRoot, relativePath);
      await copyVerifiedFile(stagedSource, replacementTarget, file);
      const rootFiles = filesByRoot.get(currentRoot.id) || [];
      rootFiles.push(file);
      filesByRoot.set(currentRoot.id, rootFiles);
    }

    for (const root of plannedRoots) {
      await assertNoSymlinks(path.join(tempRoot, root.id));
    }

    for (const root of plannedRoots) {
      const replacementRoot = path.join(tempRoot, root.id);
      await fs.mkdir(replacementRoot, { recursive: true });
      const boundaries = nestedBoundariesFor(root, plannedRoots);
      let aside: string | null = null;
      let replaceMountedRoot = boundaries.length > 0 || hasParentRestoreRoot(root, plannedRoots);
      try {
        if (!replaceMountedRoot) {
          aside = await moveExistingAside(root.absolutePath);
        }
      } catch (error) {
        const code = (error as NodeJS.ErrnoException).code;
        if (code !== "EBUSY" && code !== "EPERM" && code !== "ENOTEMPTY") {
          throw error;
        }
        replaceMountedRoot = true;
      }
      try {
        if (options.failAfterRemovingRootId === root.id) {
          throw new Error(`Injected storage restore failure after removing ${root.id}`);
        }
        if (replaceMountedRoot) {
          await removeDirectoryContents(root.absolutePath, boundaries, options.onRemovePath);
          await copyDirectoryContents(replacementRoot, root.absolutePath, boundaries);
        } else {
          await fs.mkdir(path.dirname(root.absolutePath), { recursive: true });
          await fs.rename(replacementRoot, root.absolutePath);
        }
        await removeAside(aside);
        restoredRoots.push({ id: root.id, path: root.absolutePath, files: filesByRoot.get(root.id)?.length || 0 });
      } catch (error) {
        if (aside) {
          await fs.rename(aside, root.absolutePath).catch(() => undefined);
        }
        throw new BackupV3StoragePartialFailureError({
          ok: false,
          storageRestored: "partial",
          dbRestored: false,
          envRestored: false,
          restoreIncomplete: true,
          partialFailure: true,
          message: error instanceof Error ? error.message : String(error),
          safetyBackupsCreated: options.safetyBackupsCreated,
          restoredRoots,
        });
      }
    }

    return {
      ok: true,
      storageRestored: true,
      dbRestored: false,
      envRestored: false,
      restoreIncomplete: true,
      restoredRoots,
      safetyBackupsCreated: options.safetyBackupsCreated,
    };
  } finally {
    await fs.rm(tempRoot, { recursive: true, force: true }).catch(() => undefined);
  }
}
