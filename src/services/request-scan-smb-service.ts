import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { HttpError } from "../utils/http-error.js";
import { ensureBackupV3SmbDirectory, SmbCommandError, smbQuote, splitSmbRemotePath, validateBackupV3SmbConfig, withBackupV3SmbSession, type BackupV3SmbCredentials, type BackupV3SmbDependencies, type SmbFailureCode, type SmbOperationKind } from "./backup-v3-smb-destination.js";
import type { RequestScanSettings } from "./request-scan-settings-service.js";
import { sha256File } from "./backup-v3-checksums.js";
import { getTripoliToday } from "../utils/date.js";

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
type RequestScanSmbRun = (command: string, mode?: SmbOperationKind, expectedByteSize?: number) => Promise<unknown>;
function commandInRemoteDirectory(remotePath: string, command: (quotedBasename: string) => string): string {
  const { parent, basename } = splitSmbRemotePath(remotePath);
  const operation = command(smbQuote(basename));
  return parent ? `cd ${smbQuote(parent)}; ${operation}` : operation;
}
function uploadRemoteFile(run: RequestScanSmbRun, localPath: string, remotePath: string, expectedByteSize?: number): Promise<unknown> {
  return run(commandInRemoteDirectory(remotePath, (quotedBasename) => `put ${smbQuote(localPath)} ${quotedBasename}`), "transfer", expectedByteSize);
}
function deleteRemoteFile(run: RequestScanSmbRun, remotePath: string): Promise<unknown> {
  return run(commandInRemoteDirectory(remotePath, (quotedBasename) => `del ${quotedBasename}`), "transfer");
}
function moveRemoteFile(run: RequestScanSmbRun, sourcePath: string, destinationPath: string): Promise<unknown> {
  const source = splitSmbRemotePath(sourcePath);
  const destination = splitSmbRemotePath(destinationPath);
  const destinationFromSource = source.parent === destination.parent
    ? destination.basename
    : path.win32.relative(source.parent || ".", joinRemote(destination.parent, destination.basename));
  const rename = `rename ${smbQuote(source.basename)} ${smbQuote(destinationFromSource)}`;
  return run(source.parent ? `cd ${smbQuote(source.parent)}; ${rename}` : rename, "transfer");
}
export function validateRequestScanRemoteFilename(value: string): string {
  const raw = String(value);
  if (/[\\/]/.test(raw)) throw new HttpError(400, "Network filename is unsafe.");
  const normalized = raw.normalize("NFC");
  if (!normalized || normalized === "." || normalized === ".." || /[\u0000-\u001f\u007f<>:"/\\|?*]/.test(normalized) || /[ .]$/.test(normalized) || Buffer.byteLength(normalized, "utf8") > 240) throw new HttpError(400, "Network filename is unsafe.");
  return normalized;
}
export type RequestScanMoveReconciliation = "moved" | "already_moved" | "identical_source_removed" | "conflict" | "missing";
export type RequestScanSmbDiagnosticContext = { jobId?: number; logDiagnostic?: (event: string, metadata: Record<string, string | number | boolean>) => void };
export function requestScanArchiveFilename(jobId: number, filename: string): string { if (!Number.isSafeInteger(jobId) || jobId <= 0) throw new HttpError(400, "Request Scan job ID is invalid."); const safeName = path.basename(filename).replace(/[^A-Za-z0-9._ -]/g, "_").replace(/\.\.+/g, "_"); return `${jobId}-${validateRequestScanRemoteFilename(safeName || "request-scan")}`; }
export function requestScanArchivePath(destinationFolder: string, jobId: number, filename: string): string { return joinRemote(destinationFolder, requestScanArchiveFilename(jobId, filename)); }

function smbFailureCode(error: unknown): SmbFailureCode { return error instanceof SmbCommandError ? error.smbCode : "unknown"; }
function diagnosticMetadata(error: unknown): Record<string, string> {
  return error instanceof SmbCommandError && error.nativeStatus ? { nativeStatus: error.nativeStatus } : {};
}
async function observed<T>(operation: string, context: RequestScanSmbDiagnosticContext | undefined, action: () => Promise<T>): Promise<T> {
  const started = Date.now();
  try { return await action(); }
  catch (error) { if (!(error instanceof SmbCommandError && error.smbCode === "not_found")) context?.logDiagnostic?.("request_scan_smb_failure", { operation, smbCode: smbFailureCode(error), ...diagnosticMetadata(error), elapsedMs: Date.now() - started, ...(context.jobId ? { jobId: context.jobId } : {}) }); throw error; }
}
function parseRemoteListingInfo(stdout: string, expectedBasename: string): { exists: boolean; size: number | null } {
  const expected = expectedBasename.normalize("NFC");
  for (const line of stdout.split(/\r?\n/)) {
    const match = line.match(/^\s*(.*?)\s{2,}([A-Za-z]+)\s+(\d+)\s+(.+?)\s*$/);
    if (!match || match[1]!.normalize("NFC") !== expected || match[2]!.toUpperCase().includes("D")) continue;
    return { exists: true, size: Number(match[3]) };
  }
  return { exists: false, size: null };
}
async function remoteInfo(run: RequestScanSmbRun, remotePath: string, operation: "source_probe" | "destination_probe" | "destination_verification" | "source_verification" | "fallback_verification", context?: RequestScanSmbDiagnosticContext): Promise<{ exists: boolean; size: number | null }> {
  try {
    const { basename } = splitSmbRemotePath(remotePath);
    const result = await observed(operation, context, () => run(commandInRemoteDirectory(remotePath, (quotedBasename) => `ls ${quotedBasename}`), "metadata_probe")) as { stdout?: string };
    return parseRemoteListingInfo(String(result.stdout || ""), basename);
  }
  catch (error) { if (error instanceof SmbCommandError && error.smbCode === "not_found") return { exists: false, size: null }; throw error; }
}

const REQUEST_SCAN_MAX_FILE_BYTES = 50 * 1024 * 1024;
function fallbackAllowed(error: unknown, crossDirectory: boolean): boolean {
  return error instanceof SmbCommandError && (
    error.nativeStatus === "NT_STATUS_INVALID_PARAMETER"
    || error.nativeStatus === "NT_STATUS_NOT_SUPPORTED"
    || error.nativeStatus === "NT_STATUS_NOT_SAME_DEVICE"
    || error.nativeStatus === "NT_STATUS_OBJECT_PATH_SYNTAX_BAD"
    || (crossDirectory && error.smbCode === "not_found")
    || error.smbCode === "unknown"
  );
}
function logResult(context: RequestScanSmbDiagnosticContext | undefined, result: RequestScanMoveReconciliation, started: number, fallbackUsed: boolean): void {
  context?.logDiagnostic?.("request_scan_smb_reconciliation", { result, fallbackUsed, elapsedMs: Date.now() - started, ...(context.jobId ? { jobId: context.jobId } : {}) });
}
function verificationFailure(operation: string, context: RequestScanSmbDiagnosticContext | undefined, message: string): never {
  context?.logDiagnostic?.("request_scan_smb_failure", { operation, smbCode: "unknown", elapsedMs: 0, ...(context.jobId ? { jobId: context.jobId } : {}) });
  throw new HttpError(502, message);
}

export async function reconcileRequestScanMove(settings: RequestScanSettings, sourcePath: string, destinationPath: string, dependencies?: BackupV3SmbDependencies, context?: RequestScanSmbDiagnosticContext): Promise<RequestScanMoveReconciliation> {
  const sourceParts = splitSmbRemotePath(sourcePath); const destinationParts = splitSmbRemotePath(destinationPath);
  validateRequestScanRemoteFilename(sourceParts.basename); validateRequestScanRemoteFilename(destinationParts.basename);
  return withBackupV3SmbSession(config(settings), credentials(settings), async (run, _config, tempDir, download) => {
    const started = Date.now();
    const finish = (result: RequestScanMoveReconciliation, fallbackUsed = false) => { logResult(context, result, started, fallbackUsed); return result; };
    const source = await remoteInfo(run, sourcePath, "source_probe", context); const destination = await remoteInfo(run, destinationPath, "destination_probe", context);
    if (source.exists && destination.exists) {
      if (source.size != null && destination.size != null && source.size !== destination.size) return finish("conflict");
      const sourceLocal = path.join(tempDir, "source-copy"); const destinationLocal = path.join(tempDir, "destination-copy");
      await observed("fallback_download", context, () => download(sourcePath, sourceLocal, REQUEST_SCAN_MAX_FILE_BYTES)); await observed("fallback_verification", context, () => download(destinationPath, destinationLocal, REQUEST_SCAN_MAX_FILE_BYTES));
      const [sourceDigest, destinationDigest] = await Promise.all([sha256File(sourceLocal), sha256File(destinationLocal)]);
      if (sourceDigest.byteSize !== destinationDigest.byteSize || sourceDigest.sha256 !== destinationDigest.sha256) return finish("conflict");
      const beforeDelete = await remoteInfo(run, destinationPath, "destination_verification", context);
      if (!beforeDelete.exists) verificationFailure("destination_verification", context, "SMB identical-file reconciliation verification failed.");
      await observed("source_deletion", context, () => deleteRemoteFile(run, sourcePath));
      const verifiedSource = await remoteInfo(run, sourcePath, "source_verification", context); const verifiedDestination = await remoteInfo(run, destinationPath, "destination_verification", context);
      if (!verifiedDestination.exists || verifiedSource.exists) verificationFailure(!verifiedDestination.exists ? "destination_verification" : "source_verification", context, "SMB identical-file reconciliation verification failed.");
      return finish("identical_source_removed");
    }
    if (!source.exists && !destination.exists) return finish("missing");
    if (!source.exists) return finish("already_moved");
    const destinationFolder = destinationPath.replace(/[\\/][^\\/]+$/, "");
    await observed("directory_creation", context, () => ensureBackupV3SmbDirectory(run, validateBackupV3SmbConfig(config(settings, destinationFolder))));
    try {
      await observed("rename", context, () => moveRemoteFile(run, sourcePath, destinationPath));
      const verifiedDestination = await remoteInfo(run, destinationPath, "destination_verification", context); const verifiedSource = await remoteInfo(run, sourcePath, "source_verification", context);
      if (!verifiedDestination.exists || verifiedSource.exists) verificationFailure(!verifiedDestination.exists ? "destination_verification" : "source_verification", context, "SMB move verification failed.");
      return finish("moved");
    } catch (renameError) {
      if (!fallbackAllowed(renameError, sourceParts.parent !== destinationParts.parent)) throw renameError;
      const reprobedSource = await remoteInfo(run, sourcePath, "source_probe", context);
      const reprobedDestination = await remoteInfo(run, destinationPath, "destination_probe", context);
      if (!reprobedSource.exists || reprobedDestination.exists) {
        if (!reprobedSource.exists && reprobedDestination.exists) return finish("already_moved");
        if (reprobedSource.exists && reprobedDestination.exists && renameError instanceof SmbCommandError && renameError.nativeStatus && renameError.smbCode === "unknown") return reconcileExistingPair(run, download, tempDir, sourcePath, destinationPath, context, finish);
        throw renameError;
      }
      const sourceLocal = path.join(tempDir, "fallback-source");
      const destinationLocal = path.join(tempDir, "fallback-destination");
      await observed("fallback_download", context, () => download(sourcePath, sourceLocal, REQUEST_SCAN_MAX_FILE_BYTES));
      const sourceDigest = await sha256File(sourceLocal);
      await observed("fallback_upload", context, () => uploadRemoteFile(run, sourceLocal, destinationPath, sourceDigest.byteSize));
      await observed("fallback_verification", context, () => download(destinationPath, destinationLocal, REQUEST_SCAN_MAX_FILE_BYTES));
      const destinationDigest = await sha256File(destinationLocal);
      if (sourceDigest.byteSize !== destinationDigest.byteSize || sourceDigest.sha256 !== destinationDigest.sha256) verificationFailure("fallback_verification", context, "SMB fallback upload verification failed.");
      const beforeDelete = await remoteInfo(run, destinationPath, "fallback_verification", context);
      if (!beforeDelete.exists) verificationFailure("fallback_verification", context, "SMB fallback destination disappeared before source deletion.");
      await observed("source_deletion", context, () => deleteRemoteFile(run, sourcePath));
      const verifiedSource = await remoteInfo(run, sourcePath, "source_verification", context);
      const verifiedDestination = await remoteInfo(run, destinationPath, "destination_verification", context);
      if (verifiedSource.exists || !verifiedDestination.exists) verificationFailure(verifiedSource.exists ? "source_verification" : "destination_verification", context, "SMB fallback move verification failed.");
      return finish("moved", true);
    }
  }, dependencies);
}

async function reconcileExistingPair(
  run: RequestScanSmbRun,
  download: (remote: string, local: string, maxBytes: number) => Promise<void>,
  tempDir: string,
  sourcePath: string,
  destinationPath: string,
  context: RequestScanSmbDiagnosticContext | undefined,
  finish: (result: RequestScanMoveReconciliation, fallbackUsed?: boolean) => RequestScanMoveReconciliation,
): Promise<RequestScanMoveReconciliation> {
  const sourceLocal = path.join(tempDir, "reprobe-source"); const destinationLocal = path.join(tempDir, "reprobe-destination");
  await observed("fallback_download", context, () => download(sourcePath, sourceLocal, REQUEST_SCAN_MAX_FILE_BYTES));
  await observed("fallback_verification", context, () => download(destinationPath, destinationLocal, REQUEST_SCAN_MAX_FILE_BYTES));
  const [sourceDigest, destinationDigest] = await Promise.all([sha256File(sourceLocal), sha256File(destinationLocal)]);
  if (sourceDigest.byteSize !== destinationDigest.byteSize || sourceDigest.sha256 !== destinationDigest.sha256) return finish("conflict", true);
  const beforeDelete = await remoteInfo(run, destinationPath, "fallback_verification", context);
  if (!beforeDelete.exists) verificationFailure("fallback_verification", context, "SMB fallback destination disappeared before source deletion.");
  await observed("source_deletion", context, () => deleteRemoteFile(run, sourcePath));
  const verifiedSource = await remoteInfo(run, sourcePath, "source_verification", context); const verifiedDestination = await remoteInfo(run, destinationPath, "destination_verification", context);
  if (verifiedSource.exists || !verifiedDestination.exists) verificationFailure(verifiedSource.exists ? "source_verification" : "destination_verification", context, "SMB fallback move verification failed.");
  return finish("identical_source_removed", true);
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
  validateRequestScanRemoteFilename(splitSmbRemotePath(remotePath).basename);
  await withBackupV3SmbSession(config(settings), credentials(settings), async (_run, _config, _tempDir, download) => download(remotePath, localPath, 50 * 1024 * 1024), dependencies);
}

export async function moveRequestScanFile(settings: RequestScanSettings, sourcePath: string, destinationFolder: string, filename: string, dependencies?: BackupV3SmbDependencies): Promise<string> {
  validateRequestScanRemoteFilename(splitSmbRemotePath(sourcePath).basename);
  const name = validateRequestScanRemoteFilename(path.basename(filename)); const destination = joinRemote(destinationFolder, name);
  const outcome = await reconcileRequestScanMove(settings, sourcePath, destination, dependencies);
  if (outcome === "conflict") throw new HttpError(502, "SMB destination already contains different content.");
  if (outcome === "missing") throw new SmbCommandError(502, "SMB source file was not found.", "not_found");
  return destination;
}

export async function testRequestScanSmb(settings: RequestScanSettings, dependencies?: BackupV3SmbDependencies): Promise<void> {
  if (!settings.server || !settings.share || !settings.username || !settings.password) throw new HttpError(400, "SMB server, share, username, and password are required.");
  const folders = [settings.incomingSubfolder, settings.processedSubfolder, settings.failedSubfolder]
    .map((subfolder) => validateBackupV3SmbConfig(config(settings, subfolder)));
  await withBackupV3SmbSession(folders[0]!, credentials(settings), async (run, _config, tempDir) => {
    const syntheticName = `.rispro-request-scan-workflow-${crypto.randomUUID()}.txt`;
    const sourcePath = joinRemote(folders[0]!.subfolder, syntheticName);
    const destinationPath = joinRemote(folders[1]!.subfolder, getTripoliToday(new Date()), syntheticName);
    let primaryError: unknown;
    let stage = "directory creation";
    const localPath = path.join(tempDir, "request-scan-test.txt");
    await fs.writeFile(localPath, "RISpro Request Scan SMB test");
    try {
      for (const folder of folders) {
        await ensureBackupV3SmbDirectory(run, folder);
        await run(`cd ${smbQuote(folder.subfolder)}`);
      }
      stage = "Incoming upload";
      await uploadRemoteFile(run, localPath, sourcePath);
      stage = "Incoming verification";
      if (!(await remoteInfo(run, sourcePath, "source_verification")).exists) throw new HttpError(502, "Request Scan SMB test upload verification failed.");
      stage = "archive reconciliation";
      const outcome = await reconcileRequestScanMove(settings, sourcePath, destinationPath, dependencies);
      if (!["moved", "already_moved", "identical_source_removed"].includes(outcome)) throw Object.assign(new HttpError(502, "Request Scan SMB archive test reconciliation did not complete."), { reconciliationOutcome: outcome });
      stage = "archive verification";
      const source = await remoteInfo(run, sourcePath, "source_verification");
      const destination = await remoteInfo(run, destinationPath, "destination_verification");
      if (source.exists || !destination.exists) throw new HttpError(502, "Request Scan SMB archive test verification failed.");
      stage = "archived test-file cleanup";
      await deleteRemoteFile(run, destinationPath);
      if ((await remoteInfo(run, destinationPath, "destination_verification")).exists) throw new HttpError(502, "Request Scan SMB archive test cleanup failed.");
    } catch (error) {
      primaryError = error;
      const reconciliation = (error as { reconciliationOutcome?: unknown } | null)?.reconciliationOutcome;
      throw new SmbCommandError(502, `Request Scan SMB archive workflow test failed during ${stage} (${smbFailureCode(error)}${reconciliation ? `; reconciliation=${String(reconciliation)}` : ""}).`, smbFailureCode(error), error instanceof SmbCommandError ? error.nativeStatus : undefined, error);
    } finally {
      if (primaryError) {
        await deleteRemoteFile(run, sourcePath).catch(() => undefined);
        await deleteRemoteFile(run, destinationPath).catch(() => undefined);
      }
    }
  }, dependencies);
}
