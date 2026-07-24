import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { HttpError } from "../utils/http-error.js";
import { ensureBackupV3SmbDirectory, smbQuote, validateBackupV3SmbConfig, withBackupV3SmbSession, type BackupV3SmbCredentials, type BackupV3SmbDependencies } from "./backup-v3-smb-destination.js";
import type { RequestScanSettings } from "./request-scan-settings-service.js";

export type RequestScanRemoteFile = { relativePath: string; filename: string; modifiedAt: Date | null };
export type RequestScanSmbFailureKind = "source_missing" | "smb_storage";

export function classifyRequestScanSmbError(error: unknown): RequestScanSmbFailureKind {
  const value = error as { code?: unknown; message?: unknown; status?: unknown } | null;
  const code = String(value?.code ?? value?.status ?? "").toUpperCase();
  const message = String(value?.message ?? "").toUpperCase();
  return code === "ENOENT" || code === "STATUS_NO_SUCH_FILE" || code === "NT_STATUS_NO_SUCH_FILE" || /NO SUCH FILE|OBJECT NAME NOT FOUND|FILE NOT FOUND/.test(message) ? "source_missing" : "smb_storage";
}

function config(settings: RequestScanSettings, subfolder = "") { return { server: settings.server, share: settings.share, domain: settings.domain, subfolder, timeoutSeconds: 30 }; }
function credentials(settings: RequestScanSettings): BackupV3SmbCredentials { return { username: settings.username, password: settings.password }; }
function joinRemote(...segments: string[]): string { return segments.filter(Boolean).map((value) => value.replace(/^[\\/]+|[\\/]+$/g, "").replace(/[\\/]+/g, "\\")).join("\\"); }
function remoteFilename(value: string): string { if (!/^[A-Za-z0-9._ -]+$/.test(value) || value.includes("..")) throw new HttpError(400, "Network filename is unsafe."); return value; }
export type RequestScanMoveReconciliation = "moved" | "already_moved" | "conflict" | "missing";
export function requestScanArchiveFilename(jobId: number, filename: string): string { if (!Number.isSafeInteger(jobId) || jobId <= 0) throw new HttpError(400, "Request Scan job ID is invalid."); const safeName = path.basename(filename).replace(/[^A-Za-z0-9._ -]/g, "_").replace(/\.\.+/g, "_"); return `${jobId}-${remoteFilename(safeName || "request-scan")}`; }
export function requestScanArchivePath(destinationFolder: string, jobId: number, filename: string): string { return joinRemote(destinationFolder, requestScanArchiveFilename(jobId, filename)); }

async function remoteExists(run: (command: string, mode?: "transfer") => Promise<unknown>, remotePath: string): Promise<boolean> {
  try { await run(`allinfo ${smbQuote(remotePath)}`); return true; }
  catch (error) { if (classifyRequestScanSmbError(error) === "source_missing" || /not found/i.test(error instanceof Error ? error.message : String(error))) return false; throw error; }
}

export async function reconcileRequestScanMove(settings: RequestScanSettings, sourcePath: string, destinationPath: string, dependencies?: BackupV3SmbDependencies): Promise<RequestScanMoveReconciliation> {
  return withBackupV3SmbSession(config(settings), credentials(settings), async (run) => {
    const sourceExists = await remoteExists(run, sourcePath); const destinationExists = await remoteExists(run, destinationPath);
    if (sourceExists && destinationExists) return "conflict";
    if (!sourceExists && !destinationExists) return "missing";
    if (!sourceExists) return "already_moved";
    const destinationFolder = destinationPath.replace(/[\\/][^\\/]+$/, "");
    const parts = destinationFolder.split(/[\\/]/).filter(Boolean); let current = "";
    for (const part of parts) { current = joinRemote(current, part); await run(`mkdir ${smbQuote(current)}`).catch(async () => run(`cd ${smbQuote(current)}`)); }
    await run(`rename ${smbQuote(sourcePath)} ${smbQuote(destinationPath)}`, "transfer");
    return "moved";
  }, dependencies);
}

function parseListing(output: string, folder: string): RequestScanRemoteFile[] {
  const found: RequestScanRemoteFile[] = [];
  for (const line of output.split(/\r?\n/)) {
    const match = line.match(/^\s*(.*?)\s{2,}([A-Za-z]+)\s+\d+\s+(.+?)\s*$/);
    const attributes = match?.[2]?.toUpperCase();
    if (!match || /^(\.|\.\.)$/.test(match[1].trim()) || attributes?.includes("D")) continue;
    const filename = match[1].trim();
    if (!/\.(pdf|jpe?g)$/i.test(filename)) continue;
    const modifiedAt = new Date(match[3]);
    found.push({ filename, relativePath: joinRemote(folder, filename), modifiedAt: Number.isNaN(modifiedAt.getTime()) ? null : modifiedAt });
  }
  return found;
}

export async function listRequestScanFiles(settings: RequestScanSettings, dependencies?: BackupV3SmbDependencies): Promise<RequestScanRemoteFile[]> {
  const folder = settings.incomingSubfolder;
  return withBackupV3SmbSession(config(settings), credentials(settings), async (run) => {
    const result = await run(`cd ${smbQuote(folder)}; ls`) as { stdout?: string };
    return parseListing(String(result.stdout || ""), folder);
  }, dependencies);
}

export async function downloadRequestScanFile(settings: RequestScanSettings, remotePath: string, localPath: string): Promise<void> {
  await withBackupV3SmbSession(config(settings), credentials(settings), async (_run, _config, _tempDir, download) => download(remotePath, localPath, 50 * 1024 * 1024));
}

export async function moveRequestScanFile(settings: RequestScanSettings, sourcePath: string, destinationFolder: string, filename: string): Promise<string> {
  const name = remoteFilename(path.basename(filename)); const destination = joinRemote(destinationFolder, name);
  await withBackupV3SmbSession(config(settings), credentials(settings), async (run) => {
    const parts = destinationFolder.split(/[\\/]/).filter(Boolean); let current = "";
    for (const part of parts) { current = joinRemote(current, part); await run(`mkdir ${smbQuote(current)}`).catch(async () => run(`cd ${smbQuote(current)}`)); }
    await run(`rename ${smbQuote(sourcePath)} ${smbQuote(destination)}`, "transfer");
  });
  return destination;
}

export async function testRequestScanSmb(settings: RequestScanSettings, dependencies?: BackupV3SmbDependencies): Promise<void> {
  if (!settings.server || !settings.share || !settings.username || !settings.password) throw new HttpError(400, "SMB server, share, username, and password are required.");
  const folders = [settings.incomingSubfolder, settings.processedSubfolder, settings.failedSubfolder]
    .map((subfolder) => validateBackupV3SmbConfig(config(settings, subfolder)));
  await withBackupV3SmbSession(folders[0]!, credentials(settings), async (run, _config, tempDir) => {
    for (const folder of folders) {
      await ensureBackupV3SmbDirectory(run, folder);
      await run(`cd ${smbQuote(folder.subfolder)}`);
    }
    const localPath = path.join(tempDir, "request-scan-test.txt");
    const remotePath = joinRemote(folders[0]!.subfolder, `.rispro-request-scan-test-${crypto.randomUUID()}`);
    await fs.writeFile(localPath, "RISpro Request Scan SMB test");
    await run(`put ${smbQuote(localPath)} ${smbQuote(remotePath)}`);
    await run(`del ${smbQuote(remotePath)}`);
  }, dependencies);
}
