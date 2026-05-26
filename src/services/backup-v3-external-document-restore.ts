import fs from "node:fs/promises";
import path from "node:path";
import { sha256File } from "./backup-v3-checksums.js";
import type { BackupV3FileManifestEntry, BackupV3Manifest, BackupV3StorageRoot } from "./backup-v3-types.js";
import type { BackupV3SafetyMetadata } from "./backup-v3-safety-service.js";
import { HttpError } from "../utils/http-error.js";

export interface BackupV3ExternalDocumentRestoreResult {
  ok: true;
  externalDocumentsRestored: true;
  dbRestored: false;
  storageRestored: false;
  envRestored: false;
  restoreIncomplete: true;
  filesRestored: Array<{ rootId: string; path: string; archivePath: string }>;
  safetyBackupsCreated: BackupV3SafetyMetadata;
}

export interface BackupV3ExternalDocumentPartialFailure {
  ok: false;
  externalDocumentsRestored: "partial";
  dbRestored: false;
  storageRestored: false;
  envRestored: false;
  restoreIncomplete: true;
  partialFailure: true;
  message: string;
  filesRestored: Array<{ rootId: string; path: string; archivePath: string }>;
  filesFailed: Array<{ rootId: string; archivePath: string; message: string }>;
  safetyBackupsCreated: BackupV3SafetyMetadata;
}

export class BackupV3ExternalDocumentPartialFailureError extends Error {
  constructor(readonly result: BackupV3ExternalDocumentPartialFailure) {
    super(result.message);
  }
}

interface RestoreOptions {
  manifest: BackupV3Manifest;
  stagingDir: string;
  approvedDocumentRoots: BackupV3StorageRoot[];
  safetyBackupsCreated: BackupV3SafetyMetadata;
  failAfterWrites?: number;
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
    throw new HttpError(400, `Unsafe external document path in ${label}: ${value}`);
  }
  return normalized;
}

function resolveInside(root: string, relativePath: string): string {
  const absolute = path.resolve(root, relativePath);
  if (!isSameOrInside(absolute, root)) {
    throw new HttpError(400, `External document target escapes approved root: ${relativePath}`);
  }
  return absolute;
}

function assertApprovedDocumentRoot(root: BackupV3StorageRoot): void {
  if (root.kind !== "document_storage") {
    throw new HttpError(400, `Root is not an external document root: ${root.id}`);
  }
  if (/orthanc/i.test(root.id) || /orthanc/i.test(root.archivePrefix) || /orthanc/i.test(root.absolutePath)) {
    throw new HttpError(400, `Orthanc roots are not valid external document roots: ${root.id}`);
  }
}

function externalDocumentFiles(manifest: BackupV3Manifest): BackupV3FileManifestEntry[] {
  const documentRootIds = new Set(
    manifest.storageRoots
      .filter((root) => root.kind === "document_storage")
      .map((root) => root.id)
  );
  const knownRootIds = new Set(manifest.storageRoots.map((root) => root.id));
  return manifest.files.filter((file) => {
    if (!knownRootIds.has(file.rootId)) {
      throw new HttpError(400, `Backup file references unknown document root: ${file.rootId}`);
    }
    return documentRootIds.has(file.rootId);
  });
}

function validateFileRoot(
  manifest: BackupV3Manifest,
  file: BackupV3FileManifestEntry,
  approvedRoots: Map<string, BackupV3StorageRoot>
): BackupV3StorageRoot {
  const manifestRoot = manifest.storageRoots.find((root) => root.id === file.rootId);
  if (!manifestRoot) {
    throw new HttpError(400, `Backup file references unknown document root: ${file.rootId}`);
  }
  assertApprovedDocumentRoot(manifestRoot);
  const approvedRoot = approvedRoots.get(file.rootId);
  if (!approvedRoot) {
    throw new HttpError(400, `External document root is not approved in this deployment: ${file.rootId}`);
  }
  assertApprovedDocumentRoot(approvedRoot);
  const relativePath = safeRelativePath(file.relativePath, file.archivePath);
  const expectedArchivePath = `${manifestRoot.archivePrefix.replace(/^\/+|\/+$/g, "")}/${relativePath}`;
  if (file.archivePath !== expectedArchivePath) {
    throw new HttpError(400, `External document archive path does not match its root: ${file.archivePath}`);
  }
  return approvedRoot;
}

async function copyToTempAndVerify(source: string, tempPath: string, expected: BackupV3FileManifestEntry): Promise<void> {
  const sourceStat = await fs.lstat(source);
  if (sourceStat.isSymbolicLink() || !sourceStat.isFile()) {
    throw new HttpError(400, `External document staged entry is not a regular file: ${expected.archivePath}`);
  }
  const digest = await sha256File(source);
  if (digest.byteSize !== expected.byteSize || digest.sha256.toLowerCase() !== expected.sha256.toLowerCase()) {
    throw new HttpError(400, `External document checksum or size mismatch: ${expected.archivePath}`);
  }
  await fs.mkdir(path.dirname(tempPath), { recursive: true });
  await fs.copyFile(source, tempPath);
  const copied = await sha256File(tempPath);
  if (copied.byteSize !== expected.byteSize || copied.sha256.toLowerCase() !== expected.sha256.toLowerCase()) {
    throw new HttpError(400, `External document temp verification failed: ${expected.archivePath}`);
  }
}

async function assertNoSymlinkInExistingPath(root: string, target: string): Promise<void> {
  const rootResolved = path.resolve(root);
  const targetParent = path.dirname(path.resolve(target));
  const relativeParent = path.relative(rootResolved, targetParent);
  const segments = relativeParent ? relativeParent.split(path.sep).filter(Boolean) : [];
  let current = rootResolved;

  for (const segment of segments) {
    current = path.join(current, segment);
    try {
      const stat = await fs.lstat(current);
      if (stat.isSymbolicLink()) {
        throw new HttpError(400, `External document target path contains a symlink: ${current}`);
      }
      if (!stat.isDirectory()) {
        throw new HttpError(400, `External document target parent is not a directory: ${current}`);
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        return;
      }
      throw error;
    }
  }
}

async function atomicReplaceFile(root: string, source: string, target: string): Promise<void> {
  await assertNoSymlinkInExistingPath(root, target);
  await fs.mkdir(path.dirname(target), { recursive: true });
  const tempTarget = path.join(path.dirname(target), `.restore-${process.pid}-${Date.now()}-${path.basename(target)}.tmp`);
  await fs.copyFile(source, tempTarget);
  await fs.rename(tempTarget, target);
}

export async function restoreBackupV3ExternalDocumentsOnly(
  options: RestoreOptions
): Promise<BackupV3ExternalDocumentRestoreResult> {
  const approvedRoots = new Map(options.approvedDocumentRoots.map((root) => {
    assertApprovedDocumentRoot(root);
    return [root.id, root];
  }));
  const tempRoot = await fs.mkdtemp(path.join(path.dirname(options.approvedDocumentRoots[0]?.absolutePath || process.cwd()), ".rispro-external-doc-restore-"));
  const filesRestored: BackupV3ExternalDocumentRestoreResult["filesRestored"] = [];
  const filesFailed: BackupV3ExternalDocumentPartialFailure["filesFailed"] = [];

  try {
    const prepared: Array<{ file: BackupV3FileManifestEntry; root: BackupV3StorageRoot; tempPath: string; targetPath: string }> = [];
    for (const file of externalDocumentFiles(options.manifest)) {
      const root = validateFileRoot(options.manifest, file, approvedRoots);
      const relativePath = safeRelativePath(file.relativePath, file.archivePath);
      const source = resolveInside(options.stagingDir, file.archivePath);
      const tempPath = resolveInside(tempRoot, `${root.id}/${relativePath}`);
      const targetPath = resolveInside(root.absolutePath, relativePath);
      await copyToTempAndVerify(source, tempPath, file);
      prepared.push({ file, root, tempPath, targetPath });
    }

    for (const item of prepared) {
      try {
        if (options.failAfterWrites !== undefined && filesRestored.length >= options.failAfterWrites) {
          throw new Error(`Injected external document restore failure after ${filesRestored.length} writes`);
        }
        await atomicReplaceFile(item.root.absolutePath, item.tempPath, item.targetPath);
        filesRestored.push({ rootId: item.root.id, path: item.targetPath, archivePath: item.file.archivePath });
      } catch (error) {
        filesFailed.push({
          rootId: item.root.id,
          archivePath: item.file.archivePath,
          message: error instanceof Error ? error.message : String(error),
        });
        throw new BackupV3ExternalDocumentPartialFailureError({
          ok: false,
          externalDocumentsRestored: "partial",
          dbRestored: false,
          storageRestored: false,
          envRestored: false,
          restoreIncomplete: true,
          partialFailure: true,
          message: filesFailed[0]!.message,
          filesRestored,
          filesFailed,
          safetyBackupsCreated: options.safetyBackupsCreated,
        });
      }
    }

    return {
      ok: true,
      externalDocumentsRestored: true,
      dbRestored: false,
      storageRestored: false,
      envRestored: false,
      restoreIncomplete: true,
      filesRestored,
      safetyBackupsCreated: options.safetyBackupsCreated,
    };
  } finally {
    await fs.rm(tempRoot, { recursive: true, force: true }).catch(() => undefined);
  }
}
