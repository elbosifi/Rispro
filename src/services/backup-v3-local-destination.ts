import fs from "node:fs/promises";
import path from "node:path";
import { sha256File } from "./backup-v3-checksums.js";
import { HttpError } from "../utils/http-error.js";

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
  const stat = await fs.stat(root);
  if (!stat.isDirectory()) throw new HttpError(400, "Local backup destination is not a directory.");
  await fs.access(root, (await import("node:fs")).constants.R_OK | (await import("node:fs")).constants.W_OK);
  const info = await fs.statfs(root).catch(() => null);
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
    await fs.copyFile(input.sourcePath, temporaryPath, fs.constants.COPYFILE_EXCL);
    const digest = await sha256File(temporaryPath);
    if (digest.byteSize !== input.expectedByteSize || digest.sha256.toLowerCase() !== input.expectedSha256.toLowerCase()) {
      throw new HttpError(500, "Local destination copy verification failed.");
    }
    await fs.rename(temporaryPath, destinationPath);
    return { remotePath: destinationPath, byteSize: digest.byteSize, sha256: digest.sha256 };
  } catch (error) {
    await fs.rm(temporaryPath, { force: true }).catch(() => undefined);
    throw error;
  }
}
