import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { HttpError } from "../utils/http-error.js";
import { ensureBackupV3SmbDirectory, smbQuote, validateBackupV3SmbConfig, withBackupV3SmbSession, type BackupV3SmbCredentials, type BackupV3SmbDependencies } from "./backup-v3-smb-destination.js";
import type { RequestScanSettings } from "./request-scan-settings-service.js";
import { sha256File } from "./backup-v3-checksums.js";

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
export function validateRequestScanRemoteFilename(value: string): string {
  const raw = String(value);
  if (/[\\/]/.test(raw)) throw new HttpError(400, "Network filename is unsafe.");
  const normalized = raw.normalize("NFC");
  if (!normalized || normalized === "." || normalized === ".." || /[\u0000-\u001f\u007f<>:"/\\|?*]/.test(normalized) || /[ .]$/.test(normalized) || Buffer.byteLength(normalized, "utf8") > 240) throw new HttpError(400, "Network filename is unsafe.");
  return normalized;
}
export type RequestScanMoveReconciliation = "moved" | "already_moved" | "identical_source_removed" | "conflict" | "missing";
export function requestScanArchiveFilename(jobId: number, filename: string): string { if (!Number.isSafeInteger(jobId) || jobId <= 0) throw new HttpError(400, "Request Scan job ID is invalid."); const safeName = path.basename(filename).replace(/[^A-Za-z0-9._ -]/g, "_").replace(/\.\.+/g, "_"); return `${jobId}-${validateRequestScanRemoteFilename(safeName || "request-scan")}`; }
export function requestScanArchivePath(destinationFolder: string, jobId: number, filename: string): string { return joinRemote(destinationFolder, requestScanArchiveFilename(jobId, filename)); }

async function remoteInfo(run: (command: string, mode?: "transfer") => Promise<unknown>, remotePath: string): Promise<{ exists: boolean; size: number | null }> {
  try { const result = await run(`allinfo ${smbQuote(remotePath)}`) as { stdout?: string }; const match = String(result.stdout || "").match(/\bsize\s*:\s*(\d+)/i); return { exists: true, size: match ? Number(match[1]) : null }; }
  catch (error) { if (classifyRequestScanSmbError(error) === "source_missing" || /not found/i.test(error instanceof Error ? error.message : String(error))) return { exists: false, size: null }; throw error; }
}

export async function reconcileRequestScanMove(settings: RequestScanSettings, sourcePath: string, destinationPath: string, dependencies?: BackupV3SmbDependencies): Promise<RequestScanMoveReconciliation> {
  validateRequestScanRemoteFilename(path.basename(sourcePath.replace(/\\/g, "/"))); validateRequestScanRemoteFilename(path.basename(destinationPath.replace(/\\/g, "/")));
  return withBackupV3SmbSession(config(settings), credentials(settings), async (run, _config, tempDir, download) => {
    const source = await remoteInfo(run, sourcePath); const destination = await remoteInfo(run, destinationPath);
    if (source.exists && destination.exists) {
      if (source.size != null && destination.size != null && source.size !== destination.size) return "conflict";
      const sourceLocal = path.join(tempDir, "source-copy"); const destinationLocal = path.join(tempDir, "destination-copy");
      await download(sourcePath, sourceLocal, 50 * 1024 * 1024); await download(destinationPath, destinationLocal, 50 * 1024 * 1024);
      const [sourceDigest, destinationDigest] = await Promise.all([sha256File(sourceLocal), sha256File(destinationLocal)]);
      if (sourceDigest.byteSize !== destinationDigest.byteSize || sourceDigest.sha256 !== destinationDigest.sha256) return "conflict";
      await run(`del ${smbQuote(sourcePath)}`, "transfer");
      const verifiedDestination = await remoteInfo(run, destinationPath); const verifiedSource = await remoteInfo(run, sourcePath);
      if (!verifiedDestination.exists || verifiedSource.exists) throw new HttpError(502, "SMB identical-file reconciliation verification failed.");
      return "identical_source_removed";
    }
    if (!source.exists && !destination.exists) return "missing";
    if (!source.exists) return "already_moved";
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
    let filename: string; try { filename = validateRequestScanRemoteFilename(match[1].trim()); } catch { continue; }
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

export async function downloadRequestScanFile(settings: RequestScanSettings, remotePath: string, localPath: string, dependencies?: BackupV3SmbDependencies): Promise<void> {
  validateRequestScanRemoteFilename(path.basename(remotePath.replace(/\\/g, "/")));
  await withBackupV3SmbSession(config(settings), credentials(settings), async (_run, _config, _tempDir, download) => download(remotePath, localPath, 50 * 1024 * 1024), dependencies);
}

export async function moveRequestScanFile(settings: RequestScanSettings, sourcePath: string, destinationFolder: string, filename: string, dependencies?: BackupV3SmbDependencies): Promise<string> {
  validateRequestScanRemoteFilename(path.basename(sourcePath.replace(/\\/g, "/")));
  const name = validateRequestScanRemoteFilename(path.basename(filename)); const destination = joinRemote(destinationFolder, name);
  await withBackupV3SmbSession(config(settings), credentials(settings), async (run) => {
    const parts = destinationFolder.split(/[\\/]/).filter(Boolean); let current = "";
    for (const part of parts) { current = joinRemote(current, part); await run(`mkdir ${smbQuote(current)}`).catch(async () => run(`cd ${smbQuote(current)}`)); }
    await run(`rename ${smbQuote(sourcePath)} ${smbQuote(destination)}`, "transfer");
  }, dependencies);
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
