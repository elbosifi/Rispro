import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import dotenv from "dotenv";
import { HttpError } from "../utils/http-error.js";
import { getProjectRootDir } from "./document-storage-path.js";
import { pool } from "../db/pool.js";
import { decryptBackupV3SecretWithKey, validateBackupV3RecoveryKey } from "./backup-v3-secret-service.js";

const MASTER_KEY_NAME = "BACKUP_V3_MASTER_KEY";
const SETUP_TTL_MS = 30 * 60 * 1_000;

type PendingSetup = {
  userId: string;
  key: Buffer;
  createdAt: string;
  recoveryDownloaded: boolean;
  expiresAt: number;
};

const pendingSetups = new Map<string, PendingSetup>();

export type BackupV3MasterKeyStatus = {
  state: "fresh_setup_required" | "ready" | "restart_required" | "recovery_required" | "invalid_key" | "deliberate_reset_required";
  encryptionReady: boolean;
  setupRequired: boolean;
  restartRequired: boolean;
  setupAvailable: boolean;
  limitation?: string;
};

async function representativeEncryptedValue(): Promise<string | null> {
  const { rows } = await pool.query<{ value: string | null }>(
    `select encrypted_credentials as value from backup_destination_profiles where encrypted_credentials is not null
     union all select encrypted_value as value from backup_control_secrets where encrypted_value is not null limit 1`
  );
  return rows[0]?.value || null;
}

export type BackupV3MasterKeyDependencies = {
  representativeEncryptedValue?: () => Promise<string | null>;
};

async function loadRepresentativeEncryptedValue(dependencies: BackupV3MasterKeyDependencies): Promise<string | null> {
  return (dependencies.representativeEncryptedValue || representativeEncryptedValue)();
}

function defaultEnvPath(): string {
  return path.join(getProjectRootDir(), ".env");
}

function configuredRuntimeKey(): boolean {
  return Boolean(String(process.env[MASTER_KEY_NAME] || "").trim());
}

async function readEnvFile(envPath: string): Promise<string> {
  try {
    return await fs.readFile(envPath, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return "";
    throw error;
  }
}

function configuredEnvFileKey(content: string): boolean {
  return Boolean(String(dotenv.parse(content)[MASTER_KEY_NAME] || "").trim());
}

async function setupLimitation(envPath: string): Promise<string | undefined> {
  try {
    await fs.mkdir(path.dirname(envPath), { recursive: true });
    await fs.access(path.dirname(envPath), (await import("node:fs")).constants.W_OK);
    return undefined;
  } catch {
    return "This RISpro deployment cannot safely update its protected configuration file. Ask the deployment administrator to make the configuration file writable, then return here to complete Backup security setup.";
  }
}

function forgetSetup(setupId: string): void {
  const pending = pendingSetups.get(setupId);
  if (pending) pending.key.fill(0);
  pendingSetups.delete(setupId);
}

function getPendingSetup(setupId: string, userId: string): PendingSetup {
  const pending = pendingSetups.get(setupId);
  if (!pending || pending.expiresAt <= Date.now()) {
    forgetSetup(setupId);
    throw new HttpError(410, "Backup security setup expired. Generate a new recovery copy and try again.");
  }
  if (pending.userId !== userId) throw new HttpError(404, "Backup security setup was not found.");
  return pending;
}

function timestampForPath(): string {
  return new Date().toISOString().replace(/[:.]/g, "-");
}

async function writeSynced(filePath: string, content: string, exclusive = false): Promise<void> {
  const handle = await fs.open(filePath, exclusive ? "wx" : "w", 0o600);
  try {
    await handle.writeFile(content, "utf8");
    await handle.sync();
  } finally {
    await handle.close();
  }
}

async function fsyncDirectory(directory: string): Promise<void> {
  try {
    const handle = await fs.open(directory, "r");
    try {
      await handle.sync();
    } finally {
      await handle.close();
    }
  } catch {
    // Directory fsync is not consistently supported on Windows.
  }
}

function replaceMasterKey(content: string, key: string): string {
  const line = `${MASTER_KEY_NAME}=${key}`;
  let updated = false;
  const lines = content.split(/\r?\n/).map((entry) => {
    if (/^\s*(?:export\s+)?BACKUP_V3_MASTER_KEY\s*=/.test(entry)) {
      updated = true;
      return line;
    }
    return entry;
  });
  if (!updated) {
    if (content.length && lines.at(-1) !== "") lines.push(line);
    else lines[lines.length - 1] = line;
  }
  return `${lines.join("\n").replace(/\n*$/, "")}\n`;
}

async function persistMasterKey(key: Buffer, envPath: string): Promise<void> {
  const existing = await readEnvFile(envPath);
  if (configuredEnvFileKey(existing) || configuredRuntimeKey()) {
    throw new HttpError(409, "Backup credential encryption is already configured and cannot be replaced through setup.");
  }
  const envDir = path.dirname(envPath);
  await fs.mkdir(envDir, { recursive: true });
  const safetyPath = path.join(envDir, `.env.backup-v3-master-key.${timestampForPath()}.bak`);
  await writeSynced(safetyPath, existing, true);
  const temporaryPath = path.join(envDir, `.env.backup-v3-master-key.${process.pid}.${Date.now()}.tmp`);
  try {
    await writeSynced(temporaryPath, replaceMasterKey(existing, key.toString("base64url")), true);
    await fs.rename(temporaryPath, envPath);
    await fsyncDirectory(envDir);
  } catch (error) {
    await fs.rm(temporaryPath, { force: true }).catch(() => undefined);
    throw error;
  }
}

export async function getBackupV3MasterKeyStatus(envPath = defaultEnvPath(), dependencies: BackupV3MasterKeyDependencies = {}): Promise<BackupV3MasterKeyStatus> {
  const runtime = configuredRuntimeKey();
  let envFile = false;
  let limitation: string | undefined;
  try {
    envFile = configuredEnvFileKey(await readEnvFile(envPath));
  } catch {
    limitation = "RISpro could not read its protected configuration file. Backup security setup cannot continue until the deployment configuration is accessible.";
  }
  let encryptedValue: string | null = null;
  let encryptedStateUnknown = false;
  try { encryptedValue = await loadRepresentativeEncryptedValue(dependencies); }
  catch {
    encryptedStateUnknown = true;
    limitation = "RISpro could not safely inspect existing encrypted backup credentials. Backup security setup is unavailable until the database is reachable.";
  }
  if (!runtime && !envFile && !limitation) limitation = await setupLimitation(envPath);
  const invalidKey = Boolean(runtime && encryptedValue && (() => { try { decryptBackupV3SecretWithKey(encryptedValue!, String(process.env[MASTER_KEY_NAME] || "")); return false; } catch { return true; } })());
  const state = invalidKey ? "invalid_key"
    : runtime ? "ready"
      : envFile ? "restart_required"
        : encryptedStateUnknown ? "recovery_required"
        : encryptedValue ? "recovery_required"
          : "fresh_setup_required";
  return {
    state,
    encryptionReady: runtime && !invalidKey,
    setupRequired: state === "fresh_setup_required",
    restartRequired: state === "restart_required",
    setupAvailable: state === "fresh_setup_required" && !limitation,
    ...(limitation ? { limitation } : {}),
  };
}

export async function beginBackupV3MasterKeySetup(userId: string, envPath = defaultEnvPath(), dependencies: BackupV3MasterKeyDependencies = {}): Promise<{ setupId: string; createdAt: string; recoveryAvailable: true }> {
  const status = await getBackupV3MasterKeyStatus(envPath, dependencies);
  if (status.state !== "fresh_setup_required") throw new HttpError(409, "This installation already contains encrypted backup credentials. Restore the original installation key. Generating a new key will not recover them.");
  if (!status.setupAvailable) throw new HttpError(503, status.limitation || "Backup security setup is unavailable in this deployment.");
  const setupId = crypto.randomUUID();
  const createdAt = new Date().toISOString();
  pendingSetups.set(setupId, { userId, key: crypto.randomBytes(32), createdAt, recoveryDownloaded: false, expiresAt: Date.now() + SETUP_TTL_MS });
  return { setupId, createdAt, recoveryAvailable: true };
}

/** Validates a historical recovery key against encrypted database values before persisting it. */
export async function recoverBackupV3MasterKey(recoveryValue: string, envPath = defaultEnvPath(), dependencies: BackupV3MasterKeyDependencies = {}): Promise<{ restartRequired: true }> {
  const key = validateBackupV3RecoveryKey(recoveryValue);
  const encryptedValue = await loadRepresentativeEncryptedValue(dependencies);
  if (!encryptedValue) throw new HttpError(409, "No encrypted backup credentials were found; use fresh installation key setup instead.");
  try { decryptBackupV3SecretWithKey(encryptedValue, key); }
  catch { throw new HttpError(409, "The supplied installation credential-encryption key cannot decrypt existing backup credentials."); }
  const existing = await readEnvFile(envPath);
  if (configuredEnvFileKey(existing) || configuredRuntimeKey()) throw new HttpError(409, "A configured installation key cannot be replaced through recovery. Use the deliberate reset workflow if recovery is impossible.");
  const envDir = path.dirname(envPath);
  await fs.mkdir(envDir, { recursive: true });
  const safetyPath = path.join(envDir, `.env.backup-v3-recovery.${timestampForPath()}.bak`);
  await writeSynced(safetyPath, existing, true);
  const temporaryPath = path.join(envDir, `.env.backup-v3-recovery.${process.pid}.${Date.now()}.tmp`);
  try {
    await writeSynced(temporaryPath, replaceMasterKey(existing, key), true);
    await fs.rename(temporaryPath, envPath);
    await fsyncDirectory(envDir);
  } catch (error) { await fs.rm(temporaryPath, { force: true }).catch(() => undefined); throw error; }
  return { restartRequired: true };
}

export function consumeBackupV3MasterKeyRecovery(setupId: string, userId: string, installationIdentity = "RISpro installation"): string {
  const pending = getPendingSetup(setupId, userId);
  if (pending.recoveryDownloaded) throw new HttpError(410, "The Backup security recovery copy was already downloaded and cannot be shown again.");
  pending.recoveryDownloaded = true;
  return [
    "RISpro Backup V3 encryption-key recovery copy",
    `Created: ${pending.createdAt}`,
    `Installation: ${installationIdentity}`,
    "",
    `${MASTER_KEY_NAME}=${pending.key.toString("base64url")}`,
    "",
    "Store this copy separately from the RISpro server.",
    "Losing this key makes saved backup destination credentials and automated backup passphrases unreadable.",
  ].join("\n") + "\n";
}

export async function confirmBackupV3MasterKeySetup(setupId: string, userId: string, envPath = defaultEnvPath()): Promise<{ restartRequired: true }> {
  const pending = getPendingSetup(setupId, userId);
  if (!pending.recoveryDownloaded) throw new HttpError(409, "Download and save the one-time recovery copy before confirming Backup security setup.");
  try {
    await persistMasterKey(pending.key, envPath);
  } finally {
    forgetSetup(setupId);
  }
  return { restartRequired: true };
}
