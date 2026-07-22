import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { HttpError } from "../utils/http-error.js";
import { ensureBackupV3SmbDirectory, smbQuote, validateBackupV3SmbConfig, withBackupV3SmbSession, type BackupV3SmbCredentials, type BackupV3SmbDependencies } from "./backup-v3-smb-destination.js";
import type { RequestScanSettings } from "./request-scan-settings-service.js";

export type RequestScanRemoteFile = { relativePath: string; filename: string; modifiedAt: Date | null };

function config(settings: RequestScanSettings, subfolder = "") { return { server: settings.server, share: settings.share, domain: settings.domain, subfolder, timeoutSeconds: 30 }; }
function credentials(settings: RequestScanSettings): BackupV3SmbCredentials { return { username: settings.username, password: settings.password }; }
function joinRemote(...segments: string[]): string { return segments.filter(Boolean).map((value) => value.replace(/^[\\/]+|[\\/]+$/g, "").replace(/[\\/]+/g, "\\")).join("\\"); }
function remoteFilename(value: string): string { if (!/^[A-Za-z0-9._ -]+$/.test(value) || value.includes("..")) throw new HttpError(400, "Network filename is unsafe."); return value; }

function parseListing(output: string, folder: string): RequestScanRemoteFile[] {
  const found: RequestScanRemoteFile[] = [];
  for (const line of output.split(/\r?\n/)) {
    const match = line.match(/^\s*(.*?)\s{2,}([A-Z]+)\s+\d+/);
    if (!match || /^(\.|\.\.)$/.test(match[1].trim()) || match[2].includes("D")) continue;
    const filename = match[1].trim();
    if (!/\.(pdf|jpe?g)$/i.test(filename)) continue;
    found.push({ filename, relativePath: joinRemote(folder, filename), modifiedAt: null });
  }
  return found;
}

export async function listRequestScanFiles(settings: RequestScanSettings, dependencies?: BackupV3SmbDependencies): Promise<RequestScanRemoteFile[]> {
  const folder = settings.incomingSubfolder;
  return withBackupV3SmbSession(config(settings), credentials(settings), async (run) => {
    const result = await run(`cd ${smbQuote(folder)}; ls`) as { stdout?: string };
    const files = parseListing(String(result.stdout || ""), folder);
    for (const file of files) {
      const info = await run(`allinfo ${smbQuote(file.relativePath)}`) as { stdout?: string };
      const timestamp = String(info.stdout || "").match(/(?:write_time|mtime)\s*:\s*(.+)$/im)?.[1]?.trim();
      const parsed = timestamp ? new Date(timestamp) : null;
      file.modifiedAt = parsed && !Number.isNaN(parsed.getTime()) ? parsed : null;
    }
    return files;
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
