import fs from "fs/promises";
import path from "path";
import { getProjectRootDir } from "./document-storage-path.js";

const FLAG_KEY = "RESTORE_V3_FULL_ENABLED";

export type BackupV3RestoreFlagStatus = {
  enabledInEnvFile: boolean;
  enabledInRuntime: boolean;
  restartRequired: boolean;
};

export type BackupV3RestoreFlagUpdateResult = BackupV3RestoreFlagStatus & {
  safetyBackupPath: string;
};

function defaultEnvPath(): string {
  return path.join(getProjectRootDir(), ".env");
}

function normalizeEnvBoolean(value: string | undefined): boolean {
  return String(value || "").trim().replace(/^['"]|['"]$/g, "").toLowerCase() === "true";
}

function readFlagFromEnvContent(content: string): boolean {
  const line = content
    .split(/\r?\n/)
    .find((entry) => /^\s*(?:export\s+)?RESTORE_V3_FULL_ENABLED\s*=/.test(entry));
  if (!line) return false;
  return normalizeEnvBoolean(line.split("=").slice(1).join("="));
}

function updateFlagInEnvContent(content: string, enabled: boolean): string {
  const nextValue = `${FLAG_KEY}=${enabled ? "true" : "false"}`;
  const lines = content.split(/\r?\n/);
  let updated = false;
  const nextLines = lines.map((line) => {
    if (/^\s*(?:export\s+)?RESTORE_V3_FULL_ENABLED\s*=/.test(line)) {
      updated = true;
      return nextValue;
    }
    return line;
  });

  if (!updated) {
    if (content.length > 0 && nextLines.at(-1) !== "") {
      nextLines.push(nextValue);
    } else {
      nextLines[nextLines.length - 1] = nextValue;
    }
  }

  return `${nextLines.join("\n").replace(/\n*$/, "")}\n`;
}

async function readExistingEnv(envPath: string): Promise<string> {
  try {
    return await fs.readFile(envPath, "utf8");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return "";
    throw err;
  }
}

async function writeFileSynced(filePath: string, content: string): Promise<void> {
  const handle = await fs.open(filePath, "w", 0o600);
  try {
    await handle.writeFile(content, "utf8");
    await handle.sync();
  } finally {
    await handle.close();
  }
}

function timestampForPath(): string {
  return new Date().toISOString().replace(/[:.]/g, "-");
}

export async function getBackupV3RestoreFlagStatus(envPath = defaultEnvPath()): Promise<BackupV3RestoreFlagStatus> {
  const content = await readExistingEnv(envPath);
  const enabledInEnvFile = readFlagFromEnvContent(content);
  const enabledInRuntime = process.env.RESTORE_V3_FULL_ENABLED === "true";
  return {
    enabledInEnvFile,
    enabledInRuntime,
    restartRequired: enabledInEnvFile !== enabledInRuntime,
  };
}

export async function updateBackupV3RestoreFlag(enabled: boolean, envPath = defaultEnvPath()): Promise<BackupV3RestoreFlagUpdateResult> {
  const content = await readExistingEnv(envPath);
  const envDir = path.dirname(envPath);
  await fs.mkdir(envDir, { recursive: true });

  const safetyBackupPath = path.join(envDir, `.env.restore-v3-full-flag.${timestampForPath()}.bak`);
  await writeFileSynced(safetyBackupPath, content);

  const tempPath = path.join(envDir, `.env.restore-v3-full-flag.${process.pid}.${Date.now()}.tmp`);
  await writeFileSynced(tempPath, updateFlagInEnvContent(content, enabled));
  await fs.rename(tempPath, envPath);

  return {
    ...(await getBackupV3RestoreFlagStatus(envPath)),
    safetyBackupPath,
  };
}
