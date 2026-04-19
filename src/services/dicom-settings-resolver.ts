import fs from "fs/promises";
import path from "path";
import { randomBytes } from "crypto";
import { pool } from "../db/pool.js";
import { loadSettingsMap } from "./settings-service.js";
import { normalizeOptionalText } from "../utils/normalize.js";

// ---------------------------------------------------------------------------
// Default settings for zero-configuration installation
// ---------------------------------------------------------------------------

export const DICOM_GATEWAY_DEFAULTS: Record<string, unknown> = {
  enabled: "enabled",
  bind_host: "0.0.0.0",
  mwl_ae_title: "RISPRO_MWL",
  mwl_port: "11112",
  worklist_source_dir: "storage/dicom/worklist-source",
  worklist_output_dir: "storage/dicom/worklists",
  rebuild_behavior: "incremental_on_write",
  callback_secret: "", // auto-generated on first boot
  dump2dcm_command: "dump2dcm",
  dcmdump_command: "dcmdump"
};

const DICOM_GATEWAY_KEYS = new Set(Object.keys(DICOM_GATEWAY_DEFAULTS));

export interface ResolvedGatewaySettings {
  enabled: boolean;
  bindHost: string;
  mwlAeTitle: string;
  mwlPort: number;
  worklistSourceDir: string;
  worklistOutputDir: string;
  rebuildBehavior: string;
  callbackSecret: string;
  dump2dcmCommand: string;
  dcmdumpCommand: string;
}

export interface ToolDetectionResult {
  dump2dcm: { detected: boolean; path: string | null; version: string | null };
  dcmdump: { detected: boolean; path: string | null; version: string | null };
}

export interface DirectoryHealthStatus {
  path: string;
  exists: boolean;
  writable: boolean;
  fileCount: number;
  staleFileCount: number;
}

export interface FileHealthReport {
  sourceDir: DirectoryHealthStatus;
  outputDir: DirectoryHealthStatus;
  orphanedSourceFiles: string[];
  orphanedOutputFiles: string[];
  totalStaleFiles: number;
}

// ---------------------------------------------------------------------------
// Auto-seed defaults if missing
// ---------------------------------------------------------------------------

export async function seedDicomGatewayDefaultsIfMissing(): Promise<void> {
  const { rows } = await pool.query(
    `
      select setting_key
      from system_settings
      where category = 'dicom_gateway'
    `
  );

  const existingKeys = new Set(rows.map((r) => (r as { setting_key: string }).setting_key));
  const missingKeys = Object.keys(DICOM_GATEWAY_DEFAULTS).filter((key) => !existingKeys.has(key));

  if (missingKeys.length === 0) {
    // Ensure callback_secret is populated if it exists but is empty
    const secretRow = await pool.query(
      `
        select setting_value
        from system_settings
        where category = 'dicom_gateway' and setting_key = 'callback_secret'
        limit 1
      `
    );

    const currentSecret = normalizeOptionalText((secretRow.rows[0] as any)?.setting_value?.value);

    if (!currentSecret) {
      await pool.query(
        `
          update system_settings
          set setting_value = $1::jsonb
          where category = 'dicom_gateway' and setting_key = 'callback_secret'
        `,
        [JSON.stringify({ value: generateCallbackSecret() })]
      );
    }

    return;
  }

  const client = await pool.connect();

  try {
    await client.query("begin");

    for (const key of missingKeys) {
      const defaultValue = key === "callback_secret" ? generateCallbackSecret() : DICOM_GATEWAY_DEFAULTS[key];
      await client.query(
        `
          insert into system_settings (category, setting_key, setting_value)
          values ('dicom_gateway', $1, $2::jsonb)
          on conflict (category, setting_key) do nothing
        `,
        [key, JSON.stringify({ value: String(defaultValue) })]
      );
    }

    await client.query("commit");
  } catch (error) {
    await client.query("rollback");
    throw error;
  } finally {
    client.release();
  }
}

function generateCallbackSecret(): string {
  return randomBytes(32).toString("hex");
}

// ---------------------------------------------------------------------------
// Centralized settings resolver (database-first, env fallback)
// ---------------------------------------------------------------------------

export async function resolveGatewaySettings(): Promise<ResolvedGatewaySettings> {
  const settings = await loadSettingsMap(["dicom_gateway"]);
  const gw = settings.dicom_gateway || {};

  const worklistSourceDir = resolveAbsolutePath(gw.worklist_source_dir, "storage/dicom/worklist-source");
  const worklistOutputDir = resolveAbsolutePath(gw.worklist_output_dir, "storage/dicom/worklists");

  return {
    enabled: String(gw.enabled || "enabled").trim().toLowerCase() !== "disabled",
    bindHost: normalizeOptionalText(gw.bind_host) || "127.0.0.1",
    mwlAeTitle: normalizeOptionalText(gw.mwl_ae_title) || "RISPRO_MWL",
    mwlPort: parseInt(String(gw.mwl_port || "11112"), 10) || 11112,
    worklistSourceDir,
    worklistOutputDir,
    rebuildBehavior: normalizeOptionalText(gw.rebuild_behavior) || "incremental_on_write",
    callbackSecret: normalizeOptionalText(gw.callback_secret) || generateCallbackSecret(),
    dump2dcmCommand: normalizeOptionalText(gw.dump2dcm_command) || "dump2dcm",
    dcmdumpCommand: normalizeOptionalText(gw.dcmdump_command) || "dcmdump"
  };
}

function resolveAbsolutePath(value: string | undefined, fallback: string): string {
  const raw = normalizeOptionalText(value) || fallback;

  if (path.isAbsolute(raw)) {
    return raw;
  }

  // Relative to project root
  const rootDir = path.resolve(process.cwd());
  return path.join(rootDir, raw);
}

// ---------------------------------------------------------------------------
// Directory auto-creation
// ---------------------------------------------------------------------------

export async function ensureDicomDirectoriesExist(settings: ResolvedGatewaySettings): Promise<void> {
  const directories = [
    settings.worklistSourceDir,
    settings.worklistOutputDir
  ].filter((d): d is string => typeof d === "string" && d.length > 0);

  await Promise.all(
    directories.map(async (directory) => {
      try {
        await fs.mkdir(directory, { recursive: true });
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "EEXIST") {
          console.error(`[DICOM] Failed to create directory ${directory}:`, error);
          throw error;
        }
      }
    })
  );
}

// ---------------------------------------------------------------------------
// Tool detection
// ---------------------------------------------------------------------------

export async function detectDicomTools(): Promise<ToolDetectionResult> {
  const [dump2dcm, dcmdump] = await Promise.all([
    detectBinary("dump2dcm"),
    detectBinary("dcmdump")
  ]);

  return { dump2dcm, dcmdump };
}

async function detectBinary(command: string): Promise<{ detected: boolean; path: string | null; version: string | null }> {
  try {
    const { exec } = await import("child_process");
    const { promisify } = await import("util");
    const execAsync = promisify(exec);

    // Try to find the binary in PATH
    const whichCommand = process.platform === "win32" ? "where" : "which";
    const { stdout } = await execAsync(`${whichCommand} ${command}`);
    const binaryPath = stdout.trim();

    if (!binaryPath) {
      return { detected: false, path: null, version: null };
    }

    // Try to get version
    let version = null;

    try {
      const { stdout: versionOutput } = await execAsync(`${command} --version`);
      const versionMatch = versionOutput.match(/(\d+\.\d+\.\d+)/);
      if (versionMatch) {
        version = versionMatch[1];
      }
    } catch {
      // Version detection failed, but binary exists
    }

    return { detected: true, path: binaryPath, version };
  } catch {
    return { detected: false, path: null, version: null };
  }
}

// ---------------------------------------------------------------------------
// Directory health check
// ---------------------------------------------------------------------------

export async function checkDirectoryHealth(settings: ResolvedGatewaySettings): Promise<FileHealthReport> {
  const [sourceDir, outputDir] = await Promise.all([
    checkDirectoryStatus(settings.worklistSourceDir),
    checkDirectoryStatus(settings.worklistOutputDir)
  ]);

  // Find orphaned files
  const orphanedSourceFiles = await findOrphanedSourceFiles(settings);
  const orphanedOutputFiles = await findOrphanedOutputFiles(settings);

  const totalStaleFiles = sourceDir.staleFileCount + outputDir.staleFileCount;

  return {
    sourceDir,
    outputDir,
    orphanedSourceFiles,
    orphanedOutputFiles,
    totalStaleFiles
  };
}

async function checkDirectoryStatus(directoryPath: string): Promise<DirectoryHealthStatus> {
  try {
    const exists = await fs.access(directoryPath).then(() => true).catch(() => false);

    if (!exists) {
      return { path: directoryPath, exists: false, writable: false, fileCount: 0, staleFileCount: 0 };
    }

    // Check writable
    const writable = await fs.access(directoryPath, fs.constants.W_OK).then(() => true).catch(() => false);

    // Count files
    const files = await fs.readdir(directoryPath);
    const fileCount = files.length;

    // Stale files (older than 30 days)
    const thirtyDaysAgo = Date.now() - 30 * 24 * 60 * 60 * 1000;
    let staleFileCount = 0;

    for (const file of files) {
      try {
        const stat = await fs.stat(path.join(directoryPath, file));
        if (stat.mtimeMs < thirtyDaysAgo) {
          staleFileCount++;
        }
      } catch {
        // Skip files we can't stat
      }
    }

    return { path: directoryPath, exists, writable, fileCount, staleFileCount };
  } catch {
    return { path: directoryPath, exists: false, writable: false, fileCount: 0, staleFileCount: 0 };
  }
}

async function findOrphanedSourceFiles(settings: ResolvedGatewaySettings): Promise<string[]> {
  try {
    const files = await fs.readdir(settings.worklistSourceDir);
    // Orphaned: .dump files without matching .json manifest
    const dumpFiles = files.filter((f) => f.endsWith(".dump"));
    const jsonFiles = new Set(files.filter((f) => f.endsWith(".json")).map((f) => f.replace(".json", ".dump")));

    return dumpFiles.filter((f) => !jsonFiles.has(f));
  } catch {
    return [];
  }
}

async function findOrphanedOutputFiles(settings: ResolvedGatewaySettings): Promise<string[]> {
  try {
    const files = await fs.readdir(settings.worklistOutputDir);
    // Orphaned: .wl files without matching source .dump
    const wlFiles = files.filter((f) => f.endsWith(".wl"));

    try {
      const sourceFiles = await fs.readdir(settings.worklistSourceDir);
      const sourceBaseNames = new Set(sourceFiles.map((f) => f.replace(/\.(dump|json)$/, "")));

      return wlFiles.filter((f) => !sourceBaseNames.has(f.replace(".wl", "")));
    } catch {
      return wlFiles;
    }
  } catch {
    return [];
  }
}
