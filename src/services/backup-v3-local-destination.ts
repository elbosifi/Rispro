import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import { sha256File } from "./backup-v3-checksums.js";
import { HttpError } from "../utils/http-error.js";
import { stageBackupV3RetrievedStream, type BackupV3RetrievedCopy } from "./backup-v3-retrieval.js";

function resolvedChild(root: string, name: string): string {
  if (!name || path.basename(name) !== name || name.includes("..")) {
    throw new HttpError(400, "Backup filename is unsafe.");
  }
  const resolvedRoot = path.resolve(root);
  const resolved = path.resolve(resolvedRoot, name);
  if (!resolved.startsWith(`${resolvedRoot}${path.sep}`)) {
    throw new HttpError(400, "Backup destination path is outside its approved root.");
  }
  return resolved;
}

export async function testBackupV3LocalDestination(rootPath: string): Promise<{ freeBytes: number | null }> {
  const root = path.resolve(rootPath);
  const stat = await fsp.stat(root);
  if (!stat.isDirectory()) throw new HttpError(400, "Local backup destination is not a directory.");
  await fsp.access(root, fs.constants.R_OK | fs.constants.W_OK);
  const info = await fsp.statfs(root).catch(() => null);
  return info ? { freeBytes: Number(info.bavail) * Number(info.bsize) } : { freeBytes: null };
}

export async function copyBackupV3ToLocalDestination(input: {
  sourcePath: string;
  archiveName: string;
  rootPath: string;
  expectedSha256: string;
  expectedByteSize: number;
}): Promise<{ remotePath: string; byteSize: number; sha256: string }> {
  const destinationPath = resolvedChild(input.rootPath, input.archiveName);
  await testBackupV3LocalDestination(input.rootPath);
  const temporaryPath = `${destinationPath}.${process.pid}.${Date.now()}.partial`;
  try {
    await fsp.copyFile(input.sourcePath, temporaryPath, fs.constants.COPYFILE_EXCL);
    const digest = await sha256File(temporaryPath);
    if (digest.byteSize !== input.expectedByteSize || digest.sha256.toLowerCase() !== input.expectedSha256.toLowerCase()) {
      throw new HttpError(500, "Local destination copy verification failed.");
    }
    await fsp.rename(temporaryPath, destinationPath);
    return { remotePath: destinationPath, byteSize: digest.byteSize, sha256: digest.sha256 };
  } catch (error) {
    await fsp.rm(temporaryPath, { force: true }).catch(() => undefined);
    throw error;
  }
}

export async function retrieveBackupV3FromLocalDestination(input: { remotePath: string; archiveName: string; rootPath: string; expectedSha256: string; expectedByteSize: number; maximumByteSize: number; stagingDir: string }): Promise<BackupV3RetrievedCopy> {
  const source = resolvedChild(input.rootPath, input.archiveName);
  if (path.resolve(input.remotePath) !== source) throw new HttpError(400, "Local backup archive path is unsafe.");
  return stageBackupV3RetrievedStream({ source: fs.createReadStream(source), stagingDir: input.stagingDir, archiveName: input.archiveName, expectedByteSize: input.expectedByteSize, expectedSha256: input.expectedSha256, maximumByteSize: input.maximumByteSize });
}
