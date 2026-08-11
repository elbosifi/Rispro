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
const INSTALLATION_LOCK_KEY = 9_274_019;

type PendingSetup = { userId: string; key: Buffer; createdAt: string; recoveryDownloaded: boolean; expiresAt: number; dependencies: BackupV3MasterKeyDependencies; };
type EncryptedValue = { source: "destination" | "control_secret"; id: string; value: string };
const pendingSetups = new Map<string, PendingSetup>();
let localLock: Promise<void> = Promise.resolve();

export type BackupV3MasterKeyStatus = {
  state: "fresh_setup_required" | "ready" | "restart_required" | "runtime_key_persistence_required" | "recovery_required" | "invalid_key" | "validation_unavailable" | "deliberate_reset_required";
  encryptionReady: boolean;
  setupRequired: boolean;
  restartRequired: boolean;
  setupAvailable: boolean;
  limitation?: string;
};

async function allEncryptedValues(): Promise<EncryptedValue[]> {
  const { rows } = await pool.query<EncryptedValue>(
    `select 'destination'::text as source,destination_id::text as id,encrypted_credentials as value
       from backup_destination_profiles where encrypted_credentials is not null
     union all
     select 'control_secret'::text as source,secret_name as id,encrypted_value as value
       from backup_control_secrets where encrypted_value is not null
     order by source,id`
  );
  return rows;
}

export type BackupV3MasterKeyDependencies = {
  /** Legacy test seam retained while callers migrate to the complete audit seam. */
  representativeEncryptedValue?: () => Promise<string | null>;
  encryptedValues?: () => Promise<EncryptedValue[]>;
  withInstallationLock?: <T>(action: () => Promise<T>) => Promise<T>;
  discardEncryptedValues?: () => Promise<void>;
  configBackupDir?: (envPath: string) => string;
};

async function loadEncryptedValues(dependencies: BackupV3MasterKeyDependencies): Promise<EncryptedValue[]> {
  if (dependencies.encryptedValues) return dependencies.encryptedValues();
  if (dependencies.representativeEncryptedValue) {
    const value = await dependencies.representativeEncryptedValue();
    return value ? [{ source: "control_secret", id: "representative-test-seam", value }] : [];
  }
  return allEncryptedValues();
}

function defaultEnvPath(): string {
  return process.env.RISPRO_E2E === "1"
    ? path.join(getProjectRootDir(), "e2e", ".env")
    : path.join(getProjectRootDir(), ".env");
}
function configuredRuntimeKey(): string { return String(process.env[MASTER_KEY_NAME] || "").trim(); }
function configBackupDir(envPath: string): string {
  const configured = String(process.env.RISPRO_CONFIG_BACKUP_DIR || "").trim();
  return configured || path.resolve(path.dirname(envPath), "..", "rispro-config-backups");
}

async function readEnvFile(envPath: string): Promise<string> {
  try { return await fs.readFile(envPath, "utf8"); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return ""; throw error; }
}
function configuredEnvFileKey(content: string): string { return String(dotenv.parse(content)[MASTER_KEY_NAME] || "").trim(); }

function asValidKey(value: string): string | null {
  try { return value ? validateBackupV3RecoveryKey(value) : null; } catch { return null; }
}

async function setupLimitation(envPath: string): Promise<string | undefined> {
  try {
    await fs.mkdir(path.dirname(envPath), { recursive: true });
    await fs.access(path.dirname(envPath), (await import("node:fs")).constants.W_OK);
    return undefined;
  } catch { return "This RISpro deployment cannot safely update its protected configuration file. Ask the deployment administrator to make the configuration file writable, then return here to complete Backup security setup."; }
}

function forgetSetup(setupId: string): void { const pending = pendingSetups.get(setupId); if (pending) pending.key.fill(0); pendingSetups.delete(setupId); }
function getPendingSetup(setupId: string, userId: string): PendingSetup {
  const pending = pendingSetups.get(setupId);
  if (!pending || pending.expiresAt <= Date.now()) { forgetSetup(setupId); throw new HttpError(410, "Backup security setup expired. Generate a new recovery copy and try again."); }
  if (pending.userId !== userId) throw new HttpError(404, "Backup security setup was not found.");
  return pending;
}
function timestampForPath(): string { return new Date().toISOString().replace(/[:.]/g, "-"); }
async function writeSynced(filePath: string, content: string, exclusive = false): Promise<void> {
  const handle = await fs.open(filePath, exclusive ? "wx" : "w", 0o600);
  try { await handle.writeFile(content, "utf8"); await handle.sync(); } finally { await handle.close(); }
}
async function fsyncDirectory(directory: string): Promise<void> {
  try { const handle = await fs.open(directory, "r"); try { await handle.sync(); } finally { await handle.close(); } } catch { /* not supported everywhere */ }
}
function replaceMasterKey(content: string, key: string | null): string {
  const line = key ? `${MASTER_KEY_NAME}=${key}` : "";
  let updated = false;
  const lines = content.split(/\r?\n/).filter((entry) => {
    if (/^\s*(?:export\s+)?BACKUP_V3_MASTER_KEY\s*=/.test(entry)) { updated = true; return false; }
    return true;
  });
  if (key) { if (content.length && lines.at(-1) !== "") lines.push(line); else lines[lines.length - 1] = line; }
  return `${lines.join("\n").replace(/\n*$/, "")}\n`;
}

async function protectedConfigBackup(existing: string, envPath: string, dependencies: BackupV3MasterKeyDependencies): Promise<void> {
  const backupDir = (dependencies.configBackupDir || configBackupDir)(envPath);
  await fs.mkdir(backupDir, { recursive: true, mode: 0o700 });
  await fs.chmod(backupDir, 0o700);
  await writeSynced(path.join(backupDir, `env.${timestampForPath()}.${process.pid}.bak`), existing, true);
}
async function persistEnvKey(key: string | null, envPath: string, dependencies: BackupV3MasterKeyDependencies): Promise<void> {
  const existing = await readEnvFile(envPath);
  const envDir = path.dirname(envPath);
  await fs.mkdir(envDir, { recursive: true });
  await protectedConfigBackup(existing, envPath, dependencies);
  const temporaryPath = path.join(envDir, `.env.backup-v3-${process.pid}.${Date.now()}.tmp`);
  try { await writeSynced(temporaryPath, replaceMasterKey(existing, key), true); await fs.rename(temporaryPath, envPath); await fsyncDirectory(envDir); }
  catch (error) { await fs.rm(temporaryPath, { force: true }).catch(() => undefined); throw error; }
}

async function withLocalInstallationLock<T>(action: () => Promise<T>): Promise<T> {
  let release!: () => void;
  const prior = localLock;
  localLock = new Promise<void>((resolve) => { release = resolve; });
  await prior;
  try { return await action(); } finally { release(); }
}
async function withInstallationLock<T>(action: () => Promise<T>, dependencies: BackupV3MasterKeyDependencies): Promise<T> {
  if (dependencies.withInstallationLock) return dependencies.withInstallationLock(action);
  // Injected secret seams are unit tests; production always uses the database-wide lock.
  if (dependencies.encryptedValues || dependencies.representativeEncryptedValue) return withLocalInstallationLock(action);
  const client = await pool.connect();
  let acquired = false;
  try {
    const lock = await client.query<{ locked: boolean }>("select pg_try_advisory_lock($1) as locked", [INSTALLATION_LOCK_KEY]);
    acquired = lock.rows[0]?.locked === true;
    if (!acquired) throw new HttpError(409, "Backup credential-encryption setup is already being changed by another administrator.");
    return await action();
  } finally { if (acquired) await client.query("select pg_advisory_unlock($1)", [INSTALLATION_LOCK_KEY]).catch(() => undefined); client.release(); }
}

function auditKey(key: string, encryptedValues: EncryptedValue[]): boolean {
  try { for (const secret of encryptedValues) decryptBackupV3SecretWithKey(secret.value, key); return true; } catch { return false; }
}

export async function getBackupV3MasterKeyStatus(envPath = defaultEnvPath(), dependencies: BackupV3MasterKeyDependencies = {}): Promise<BackupV3MasterKeyStatus> {
  const runtimeRaw = configuredRuntimeKey();
  let envRaw = "";
  let limitation: string | undefined;
  try { envRaw = configuredEnvFileKey(await readEnvFile(envPath)); }
  catch { limitation = "RISpro could not read its protected configuration file. Backup security setup cannot continue until the deployment configuration is accessible."; }
  let encryptedValues: EncryptedValue[];
  try { encryptedValues = await loadEncryptedValues(dependencies); }
  catch { return { state: "validation_unavailable", encryptionReady: false, setupRequired: false, restartRequired: false, setupAvailable: false, limitation: "RISpro could not safely inspect all encrypted backup credentials. Backup security changes are unavailable until the database is reachable." }; }
  const runtime = asValidKey(runtimeRaw);
  const envFile = asValidKey(envRaw);
  if ((runtimeRaw && !runtime) || (envRaw && !envFile)) return { state: "invalid_key", encryptionReady: false, setupRequired: false, restartRequired: false, setupAvailable: false };
  if (!runtime && !envFile && encryptedValues.length) return { state: "recovery_required", encryptionReady: false, setupRequired: false, restartRequired: false, setupAvailable: false };
  if (runtime && envFile && runtime !== envFile) return { state: encryptedValues.length ? "recovery_required" : "deliberate_reset_required", encryptionReady: false, setupRequired: false, restartRequired: false, setupAvailable: false };
  if (runtime && !auditKey(runtime, encryptedValues)) return { state: "invalid_key", encryptionReady: false, setupRequired: false, restartRequired: false, setupAvailable: false };
  if (!runtime && envFile) {
    if (!auditKey(envFile, encryptedValues)) return { state: "invalid_key", encryptionReady: false, setupRequired: false, restartRequired: false, setupAvailable: false };
    return { state: "restart_required", encryptionReady: false, setupRequired: false, restartRequired: true, setupAvailable: false };
  }
  if (runtime && !envFile) return { state: "runtime_key_persistence_required", encryptionReady: false, setupRequired: false, restartRequired: false, setupAvailable: false };
  if (runtime && envFile) return { state: "ready", encryptionReady: true, setupRequired: false, restartRequired: false, setupAvailable: false };
  if (!limitation) limitation = await setupLimitation(envPath);
  return { state: "fresh_setup_required", encryptionReady: false, setupRequired: true, restartRequired: false, setupAvailable: !limitation, ...(limitation ? { limitation } : {}) };
}

export async function beginBackupV3MasterKeySetup(userId: string, envPath = defaultEnvPath(), dependencies: BackupV3MasterKeyDependencies = {}): Promise<{ setupId: string; createdAt: string; recoveryAvailable: true }> {
  return withInstallationLock(async () => {
    const status = await getBackupV3MasterKeyStatus(envPath, dependencies);
    if (status.state !== "fresh_setup_required") throw new HttpError(409, "Backup credential encryption is already configured or requires recovery. Restore the original installation key or use the deliberate reset workflow.");
    if (!status.setupAvailable) throw new HttpError(503, status.limitation || "Backup security setup is unavailable in this deployment.");
    if ([...pendingSetups.values()].some((pending) => pending.expiresAt > Date.now())) throw new HttpError(409, "Backup security setup is already in progress for this installation.");
    const setupId = crypto.randomUUID(); const createdAt = new Date().toISOString();
    pendingSetups.set(setupId, { userId, key: crypto.randomBytes(32), createdAt, recoveryDownloaded: false, expiresAt: Date.now() + SETUP_TTL_MS, dependencies });
    return { setupId, createdAt, recoveryAvailable: true };
  }, dependencies);
}

/** Audits every encrypted row before atomically persisting a historical recovery key. */
export async function recoverBackupV3MasterKey(recoveryValue: string, envPath = defaultEnvPath(), dependencies: BackupV3MasterKeyDependencies = {}): Promise<{ restartRequired: true }> {
  return withInstallationLock(async () => {
    const key = validateBackupV3RecoveryKey(recoveryValue);
    const encryptedValues = await loadEncryptedValues(dependencies);
    if (!encryptedValues.length) throw new HttpError(409, "No encrypted backup credentials were found; use fresh installation key setup instead.");
    if (!auditKey(key, encryptedValues)) throw new HttpError(409, "The supplied installation credential-encryption key cannot decrypt every existing backup credential.");
    const existing = await readEnvFile(envPath);
    const existingKey = configuredEnvFileKey(existing);
    const runtimeKey = configuredRuntimeKey();
    if ((existingKey && existingKey !== key) || (runtimeKey && runtimeKey !== key)) throw new HttpError(409, "A different installation key is configured. Use deliberate reset only when existing encrypted credentials are intentionally being discarded.");
    await persistEnvKey(key, envPath, dependencies);
    return { restartRequired: true };
  }, dependencies);
}

export function consumeBackupV3MasterKeyRecovery(setupId: string, userId: string, installationIdentity = "RISpro installation"): string {
  const pending = getPendingSetup(setupId, userId);
  if (pending.recoveryDownloaded) throw new HttpError(410, "The Backup security recovery copy was already downloaded and cannot be shown again.");
  pending.recoveryDownloaded = true;
  return ["RISpro Backup V3 encryption-key recovery copy", `Created: ${pending.createdAt}`, `Installation: ${installationIdentity}`, "", `${MASTER_KEY_NAME}=${pending.key.toString("base64url")}`, "", "Store this copy separately from the RISpro server.", "Losing this key makes saved backup destination credentials and automated backup passphrases unreadable."].join("\n") + "\n";
}

export async function confirmBackupV3MasterKeySetup(setupId: string, userId: string, envPath = defaultEnvPath(), dependencies?: BackupV3MasterKeyDependencies): Promise<{ restartRequired: true }> {
  const pending = getPendingSetup(setupId, userId);
  const effectiveDependencies = dependencies || pending.dependencies;
  return withInstallationLock(async () => {
    const current = getPendingSetup(setupId, userId);
    if (!current.recoveryDownloaded) throw new HttpError(409, "Download and save the one-time recovery copy before confirming Backup security setup.");
    try {
      const status = await getBackupV3MasterKeyStatus(envPath, effectiveDependencies);
      if (status.state !== "fresh_setup_required") throw new HttpError(409, "Backup credential encryption is already configured or requires recovery.");
      await persistEnvKey(current.key.toString("base64url"), envPath, effectiveDependencies);
    } finally { forgetSetup(setupId); }
    return { restartRequired: true };
  }, effectiveDependencies);
}

/** Destructive escape hatch. Route-level authority and confirmation are mandatory. */
export async function deliberatelyResetBackupV3MasterKey(envPath = defaultEnvPath(), dependencies: BackupV3MasterKeyDependencies = {}): Promise<{ restartRequired: true }> {
  return withInstallationLock(async () => {
    const discard = dependencies.discardEncryptedValues || (async () => {
      const client = await pool.connect();
      try { await client.query("begin"); await client.query("update backup_destination_profiles set encrypted_credentials=null,updated_at=now() where encrypted_credentials is not null"); await client.query("delete from backup_control_secrets where encrypted_value is not null"); await client.query("commit"); }
      catch (error) { await client.query("rollback").catch(() => undefined); throw error; } finally { client.release(); }
    });
    await discard();
    await persistEnvKey(null, envPath, dependencies);
    return { restartRequired: true };
  }, dependencies);
}
