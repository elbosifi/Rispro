import fs from "node:fs/promises";
import path from "node:path";
import dotenv from "dotenv";
import {
  decryptBackupV3EnvPayload,
  isBackupV3ManagedEnvKey,
  type BackupV3EncryptedEnvBundle,
} from "./backup-v3-env.js";
import { HttpError } from "../utils/http-error.js";

const ENV_KEY_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/;

export interface BackupV3EnvRestoreResult {
  ok: true;
  envRestored: true;
  dbRestored: false;
  storageRestored: false;
  externalDocumentsRestored: false;
  restartRequired: true;
  restoreIncomplete: true;
  envVarsRestored: Array<{ name: string; isSecret: boolean; value: string }>;
  safetyBackupPath: string | null;
}

interface RestoreOptions {
  stagingDir: string;
  passphrase: string;
  envPath: string;
  safetyBackupPath?: string | null;
  failBeforeRename?: boolean;
}

function isSecretEnvKey(name: string): boolean {
  return /(SECRET|PASSWORD|TOKEN|PRIVATE|KEY|DATABASE_URL|AUTH|COOKIE|VAPID)/i.test(name);
}

function maskEnvValue(name: string): string {
  return isSecretEnvKey(name) ? "********" : "<restored>";
}

function formatEnvValue(value: string): string {
  if (value === "") {
    return '""';
  }
  if (!/[\s#"'`$\\\n\r]/.test(value)) {
    return value;
  }
  if (!value.includes("'")) {
    return `'${value}'`;
  }
  if (!value.includes("`")) {
    return `\`${value}\``;
  }
  if (!/["\\\n\r]/.test(value)) {
    return `"${value}"`;
  }
  throw new HttpError(400, "Env value cannot be serialized safely for dotenv.");
}

function validateEnvKeyNames(variables: Record<string, string>): void {
  for (const name of Object.keys(variables)) {
    if (!ENV_KEY_PATTERN.test(name)) {
      throw new HttpError(400, `Backup contains malformed env variable name: ${name}`);
    }
  }
}

function parseDotEnv(content: string): Map<string, string> {
  return new Map(Object.entries(dotenv.parse(content)));
}

async function readExistingEnv(envPath: string): Promise<string> {
  try {
    return await fs.readFile(envPath, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return "";
    }
    throw error;
  }
}

async function createSafetyBackup(envPath: string, existing: string, providedPath: string | null | undefined): Promise<string | null> {
  if (providedPath) {
    return providedPath;
  }
  if (existing === "") {
    return null;
  }
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const safetyPath = path.join(path.dirname(envPath), `.env.pre-restore-${timestamp}`);
  await fs.writeFile(safetyPath, existing, { flag: "wx" });
  return safetyPath;
}

async function fsyncFile(filePath: string): Promise<void> {
  const handle = await fs.open(filePath, "r+");
  try {
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
    // Directory fsync is best-effort and is not supported consistently on Windows.
  }
}

async function readEnvBundle(stagingDir: string): Promise<BackupV3EncryptedEnvBundle> {
  const bundlePath = path.resolve(stagingDir, "config/env.enc.json");
  if (!bundlePath.startsWith(path.resolve(stagingDir) + path.sep)) {
    throw new HttpError(400, "Invalid staged env bundle path.");
  }
  return JSON.parse(await fs.readFile(bundlePath, "utf8")) as BackupV3EncryptedEnvBundle;
}

export async function restoreBackupV3EnvOnly(options: RestoreOptions): Promise<BackupV3EnvRestoreResult> {
  const bundle = await readEnvBundle(options.stagingDir);
  let payload;
  try {
    payload = decryptBackupV3EnvPayload(bundle, options.passphrase);
  } catch {
    throw new HttpError(400, "Could not decrypt env bundle. Check the backup passphrase.");
  }
  validateEnvKeyNames(payload.variables);

  const restoredVariables = Object.fromEntries(
    Object.entries(payload.variables).filter(([name]) => isBackupV3ManagedEnvKey(name))
  );
  const existing = await readExistingEnv(options.envPath);
  const safetyBackupPath = await createSafetyBackup(options.envPath, existing, options.safetyBackupPath);
  const values = parseDotEnv(existing);
  for (const [name, value] of Object.entries(restoredVariables).sort(([a], [b]) => a.localeCompare(b))) {
    values.set(name, value);
  }

  const content = [...values.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([name, value]) => `${name}=${formatEnvValue(value)}`)
    .join("\n") + "\n";
  await fs.mkdir(path.dirname(options.envPath), { recursive: true });
  const tempPath = path.join(path.dirname(options.envPath), `.env.restore-${process.pid}-${Date.now()}.tmp`);
  await fs.writeFile(tempPath, content, { flag: "wx", mode: 0o600 });
  await fsyncFile(tempPath);
  if (options.failBeforeRename) {
    await fs.rm(tempPath, { force: true }).catch(() => undefined);
    throw new Error("Injected env restore failure before rename");
  }
  await fs.rename(tempPath, options.envPath);
  await fsyncDirectory(path.dirname(options.envPath));

  return {
    ok: true,
    envRestored: true,
    dbRestored: false,
    storageRestored: false,
    externalDocumentsRestored: false,
    restartRequired: true,
    restoreIncomplete: true,
    envVarsRestored: Object.keys(restoredVariables)
      .sort((a, b) => a.localeCompare(b))
      .map((name) => ({ name, isSecret: isSecretEnvKey(name), value: maskEnvValue(name) })),
    safetyBackupPath,
  };
}
