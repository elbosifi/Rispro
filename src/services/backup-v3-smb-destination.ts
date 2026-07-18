import { execFile } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { HttpError } from "../utils/http-error.js";
import { sha256File } from "./backup-v3-checksums.js";

const execFileAsync = promisify(execFile);

export interface BackupV3SmbConfig {
  server: string;
  share: string;
  subfolder: string;
  domain?: string;
  timeoutSeconds: number;
}

export interface BackupV3SmbCredentials { username: string; password: string; }

export interface BackupV3SmbDependencies {
  execFile(command: string, args: string[], options: { timeout: number; maxBuffer: number }): Promise<unknown>;
}

const defaultDependencies: BackupV3SmbDependencies = {
  execFile(command, args, options) { return execFileAsync(command, args, options); },
};

function safeRemoteSegments(value: string): string[] {
  const clean = value.trim().replace(/^\\+|\\+$/g, "").replace(/^\/+|\/+$/g, "");
  if (!clean) return [];
  const segments = clean.split(/[\\/]/);
  if (segments.some((segment) => !/^[A-Za-z0-9._ -]+$/.test(segment) || segment === "." || segment === "..")) throw new HttpError(400, "SMB subfolder contains an unsafe path.");
  return segments;
}

function safeRemoteFilename(value: string): string {
  if (!/^[A-Za-z0-9._-]+$/.test(value) || value.includes("..")) throw new HttpError(400, "Backup filename is unsafe.");
  return value;
}

function smbQuote(value: string): string {
  if (/[\r\n\0]/.test(value)) throw new HttpError(400, "SMB command contains unsafe text.");
  return `"${value.replace(/\\/g, "\\\\").replace(/"/g, "\\\"")}"`;
}

export function validateBackupV3SmbConfig(value: unknown): BackupV3SmbConfig {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new HttpError(400, "SMB configuration must be an object.");
  const config = value as Record<string, unknown>;
  const server = String(config.server || "").trim();
  const share = String(config.share || "").trim();
  const domain = String(config.domain || "").trim();
  const timeoutSeconds = Number(config.timeoutSeconds || 15);
  if (!/^[A-Za-z0-9.-]{1,253}$/.test(server)) throw new HttpError(400, "SMB server name or IP address is invalid.");
  if (!/^[A-Za-z0-9$._ -]{1,120}$/.test(share)) throw new HttpError(400, "SMB share name is invalid.");
  if (domain && !/^[A-Za-z0-9._-]{1,120}$/.test(domain)) throw new HttpError(400, "SMB domain or workgroup is invalid.");
  if (!Number.isInteger(timeoutSeconds) || timeoutSeconds < 1 || timeoutSeconds > 120) throw new HttpError(400, "SMB timeout must be between 1 and 120 seconds.");
  const subfolder = safeRemoteSegments(String(config.subfolder || "")).join("\\");
  return { server, share, subfolder, ...(domain ? { domain } : {}), timeoutSeconds };
}

type SmbOperationKind = "metadata" | "transfer";

const SMB_TRANSFER_MIN_PROCESS_TIMEOUT_MS = 10 * 60 * 1_000;
const SMB_TRANSFER_MAX_PROCESS_TIMEOUT_MS = 2 * 60 * 60 * 1_000;
const SMB_TRANSFER_ASSUMED_MIN_BYTES_PER_SECOND = 2 * 1024 * 1024;
const SMB_TRANSFER_OVERHEAD_MS = 5 * 60 * 1_000;

/**
 * The smbclient `-t` option is a network-stall timeout, not an archive deadline.
 * Allow a deliberately conservative 2 MiB/s plus five minutes for each verified
 * upload/download, with a ten minute minimum and two hour hard ceiling.
 */
export function backupV3SmbTransferProcessTimeoutMs(expectedByteSize: number): number {
  const bytes = Number.isSafeInteger(expectedByteSize) && expectedByteSize > 0 ? expectedByteSize : 0;
  return Math.min(SMB_TRANSFER_MAX_PROCESS_TIMEOUT_MS, Math.max(
    SMB_TRANSFER_MIN_PROCESS_TIMEOUT_MS,
    Math.ceil((bytes / SMB_TRANSFER_ASSUMED_MIN_BYTES_PER_SECOND) * 1_000) + SMB_TRANSFER_OVERHEAD_MS
  ));
}

function isChildProcessTimeout(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const child = error as NodeJS.ErrnoException & { killed?: unknown; signal?: unknown };
  const text = error instanceof Error ? error.message : String(error);
  return child.code === "ETIMEDOUT" || (child.killed === true && typeof child.signal === "string") || /(?:process|command|child).*tim(?:e|ed)[ -]?out|ETIMEDOUT/i.test(text);
}

function classifySmbError(error: unknown, operation: SmbOperationKind): HttpError {
  if (operation === "transfer" && isChildProcessTimeout(error)) return new HttpError(504, "SMB archive transfer timed out.");
  const text = error instanceof Error ? `${error.message} ${String((error as NodeJS.ErrnoException & { stderr?: unknown }).stderr || "")}`.toUpperCase() : String(error).toUpperCase();
  if (/LOGON_FAILURE|NT_STATUS_WRONG_PASSWORD|AUTHENTICATION/.test(text)) return new HttpError(502, "SMB authentication failed.");
  if (/BAD_NETWORK_NAME|NO_SUCH_SHARE/.test(text)) return new HttpError(502, "SMB share was not found.");
  if (/ACCESS_DENIED|PERMISSION_DENIED/.test(text)) return new HttpError(502, "SMB permission was denied.");
  if (/DISK_FULL|NO_SPACE/.test(text)) return new HttpError(507, "SMB destination storage is full.");
  if (/CONNECTION_REFUSED|TIMED_OUT|NO_ROUTE|HOST_UNREACH|NETWORK_UNREACH/.test(text)) return new HttpError(502, "SMB server is unavailable.");
  return new HttpError(502, "SMB destination operation failed.");
}

async function withSmb<T>(configInput: unknown, credentials: BackupV3SmbCredentials, action: (run: (command: string, operation?: SmbOperationKind, expectedByteSize?: number) => Promise<void>, config: BackupV3SmbConfig, tempDir: string) => Promise<T>, dependencies: BackupV3SmbDependencies = defaultDependencies): Promise<T> {
  const config = validateBackupV3SmbConfig(configInput);
  if (!credentials.username || /[\r\n\0]/.test(credentials.username) || !credentials.password || /[\r\n\0]/.test(credentials.password)) throw new HttpError(400, "SMB username and password are required.");
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "rispro-backup-smb-"));
  const authPath = path.join(tempDir, "credentials");
  await fs.writeFile(authPath, `username = ${credentials.username}\npassword = ${credentials.password}\n${config.domain ? `domain = ${config.domain}\n` : ""}`, { mode: 0o600 });
  const share = `//${config.server}/${config.share}`;
  const run = async (command: string, operation: SmbOperationKind = "metadata", expectedByteSize?: number): Promise<void> => {
    const processTimeout = operation === "transfer"
      ? backupV3SmbTransferProcessTimeoutMs(expectedByteSize || 0)
      : (config.timeoutSeconds + 5) * 1_000;
    try {
      await dependencies.execFile("smbclient", [share, "-A", authPath, "-m", "SMB3", "--option=client min protocol=SMB2", "--option=client max protocol=SMB3", "-t", String(config.timeoutSeconds), "-c", command], { timeout: processTimeout, maxBuffer: 1024 * 1024 });
    } catch (error) {
      throw classifySmbError(error, operation);
    }
  };
  try { return await action(run, config, tempDir); }
  finally { await fs.rm(tempDir, { recursive: true, force: true }).catch(() => undefined); }
}

async function ensureRemoteDirectory(run: (command: string, operation?: SmbOperationKind, expectedByteSize?: number) => Promise<void>, config: BackupV3SmbConfig): Promise<void> {
  const segments = config.subfolder ? config.subfolder.split("\\") : [];
  let current = "";
  for (const segment of segments) {
    current = current ? `${current}\\${segment}` : segment;
    try { await run(`mkdir ${smbQuote(current)}`); }
    catch (error) {
      if (!(error instanceof HttpError) || !/operation failed/i.test(error.message)) throw error;
      // smbclient reports an existing directory as a generic server failure;
      // a subsequent cd proves it is a usable directory without masking access errors.
      await run(`cd ${smbQuote(current)}`);
    }
  }
}

export async function testBackupV3SmbDestination(config: unknown, credentials: BackupV3SmbCredentials, dependencies?: BackupV3SmbDependencies): Promise<void> {
  await withSmb(config, credentials, async (run, parsed, tempDir) => {
    await ensureRemoteDirectory(run, parsed);
    const localPath = path.join(tempDir, "write-test.bin");
    const remoteName = `.rispro-write-test-${crypto.randomUUID()}`;
    const remotePath = parsed.subfolder ? `${parsed.subfolder}\\${remoteName}` : remoteName;
    await fs.writeFile(localPath, "RISpro backup destination test");
    await run(`put ${smbQuote(localPath)} ${smbQuote(remotePath)}`);
    await run(`del ${smbQuote(remotePath)}`);
  }, dependencies);
}

export async function copyBackupV3ToSmbDestination(input: {
  sourcePath: string;
  archiveName: string;
  expectedSha256: string;
  expectedByteSize: number;
  config: unknown;
  credentials: BackupV3SmbCredentials;
  dependencies?: BackupV3SmbDependencies;
}): Promise<{ remotePath: string; byteSize: number; sha256: string }> {
  const archiveName = safeRemoteFilename(input.archiveName);
  return withSmb(input.config, input.credentials, async (run, config, tempDir) => {
    const source = await sha256File(input.sourcePath);
    if (source.byteSize !== input.expectedByteSize || source.sha256 !== input.expectedSha256) throw new HttpError(500, "Local backup archive changed before upload.");
    await ensureRemoteDirectory(run, config);
    const temporaryName = `.${archiveName}.${crypto.randomUUID()}.partial`;
    const remoteTemp = config.subfolder ? `${config.subfolder}\\${temporaryName}` : temporaryName;
    const remoteFinal = config.subfolder ? `${config.subfolder}\\${archiveName}` : archiveName;
    const readBackPath = path.join(tempDir, "read-back.bin");
    try {
      await run(`put ${smbQuote(input.sourcePath)} ${smbQuote(remoteTemp)}`, "transfer", input.expectedByteSize);
      await run(`get ${smbQuote(remoteTemp)} ${smbQuote(readBackPath)}`, "transfer", input.expectedByteSize);
      const readBack = await sha256File(readBackPath);
      if (readBack.byteSize !== input.expectedByteSize || readBack.sha256 !== input.expectedSha256) throw new HttpError(500, "SMB upload verification failed.");
      await run(`rename ${smbQuote(remoteTemp)} ${smbQuote(remoteFinal)}`);
      return { remotePath: remoteFinal, byteSize: readBack.byteSize, sha256: readBack.sha256 };
    } catch (error) {
      let cleanupFailed = false;
      await run(`del ${smbQuote(remoteTemp)}`).catch(() => { cleanupFailed = true; });
      if (cleanupFailed && error instanceof HttpError) {
        throw new HttpError(error.statusCode, `${error.message} Remote temporary-file cleanup also failed.`);
      }
      throw error;
    }
  }, input.dependencies);
}

/** Deletes only a filename under the configured SMB backup subfolder. */
export async function deleteBackupV3SmbDestinationCopy(input: { remotePath: string; config: unknown; credentials: BackupV3SmbCredentials; dependencies?: BackupV3SmbDependencies }): Promise<void> {
  const name = input.remotePath.split(/[\\/]/).filter(Boolean).pop() || "";
  const archiveName = safeRemoteFilename(name);
  if (!archiveName.endsWith(".rispro.zip")) throw new HttpError(400, "Remote backup archive path is unsafe.");
  await withSmb(input.config, input.credentials, async (run, config) => {
    const target = config.subfolder ? `${config.subfolder}\\${archiveName}` : archiveName;
    await run(`del ${smbQuote(target)}`);
  }, input.dependencies);
}
