import fs from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";
import { execFile } from "child_process";
import { promisify } from "util";

const execFileAsync = promisify(execFile);

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, "..", "..");

// ---------------------------------------------------------------------------
// Database-first settings resolver (env fallback only)
// ---------------------------------------------------------------------------

const DEFAULTS = {
  worklistSourceDir: "storage/dicom/worklist-source",
  worklistOutputDir: "storage/dicom/worklists",
  dump2dcmCommand: "dump2dcm",
  pollMs: 3000
};

async function loadSettings() {
  // Try loading from running backend first
  const baseUrl = process.env.RISPRO_BASE_URL || "http://127.0.0.1:3000";

  try {
    const resp = await fetch(`${baseUrl}/api/settings/dicom_gateway`, {
      headers: { "accept": "application/json" }
    });

    if (resp.ok) {
      const body = await resp.json();
      // body.settings is a flat Record<string, string> from mapSettings
      const s = body.settings || {};
      return {
        sourceDir: resolvePath(s.worklist_source_dir, DEFAULTS.worklistSourceDir),
        outputDir: resolvePath(s.worklist_output_dir, DEFAULTS.worklistOutputDir),
        dump2dcmCommand: s.dump2dcm_command || DEFAULTS.dump2dcmCommand,
        pollMs: Number(s.worklist_poll_ms) || DEFAULTS.pollMs
      };
    }
  } catch {
    // Backend unavailable – fall back to env
  }

  // Environment fallback
  return {
    sourceDir: resolvePath(process.env.DICOM_WORKLIST_SOURCE_DIR, DEFAULTS.worklistSourceDir),
    outputDir: resolvePath(process.env.DICOM_WORKLIST_OUTPUT_DIR, DEFAULTS.worklistOutputDir),
    dump2dcmCommand: process.env.DICOM_DUMP2DCM_COMMAND || DEFAULTS.dump2dcmCommand,
    pollMs: Number(process.env.DICOM_WORKLIST_POLL_MS) || DEFAULTS.pollMs
  };
}

function resolvePath(value, fallback) {
  const raw = value || fallback;
  return path.isAbsolute(raw) ? raw : path.resolve(rootDir, raw);
}

// ---------------------------------------------------------------------------
// Worklist builder logic
// ---------------------------------------------------------------------------

async function ensureLayout(sourceDir, outputDir) {
  await fs.mkdir(sourceDir, { recursive: true });
  await fs.mkdir(outputDir, { recursive: true });
}

async function listFiles(directory, extension) {
  const entries = await fs.readdir(directory, { withFileTypes: true });
  return entries
    .filter((entry) => entry.isFile() && entry.name.endsWith(extension))
    .map((entry) => entry.name)
    .sort();
}

async function convertDumpFile(fileName, sourceDir, outputDir, dump2dcmCommand) {
  const sourcePath = path.join(sourceDir, fileName);
  const targetPath = path.join(outputDir, fileName.replace(/\.dump$/i, ".wl"));

  try {
    const sourceStats = await fs.stat(sourcePath);
    const targetStats = await fs.stat(targetPath).catch(() => null);

    if (targetStats && targetStats.mtimeMs >= sourceStats.mtimeMs) {
      return false;
    }

    await execFileAsync(dump2dcmCommand, [sourcePath, targetPath], {
      timeout: 10000,
      maxBuffer: 1024 * 1024
    });

    return true;
  } catch (error) {
    console.error(`Failed to convert ${fileName} into a worklist file.`, error.stderr || error.message || error);
    return false;
  }
}

async function removeStaleOutputFiles(sourceFiles, outputDir) {
  const sourceBasenames = new Set(sourceFiles.map((file) => file.replace(/\.dump$/i, "")));
  const outputFiles = await listFiles(outputDir, ".wl");

  await Promise.all(
    outputFiles
      .filter((file) => !sourceBasenames.has(file.replace(/\.wl$/i, "")))
      .map((file) => fs.rm(path.join(outputDir, file), { force: true }))
  );
}

async function runCycle(sourceDir, outputDir, dump2dcmCommand) {
  await ensureLayout(sourceDir, outputDir);
  const sourceFiles = await listFiles(sourceDir, ".dump");

  for (const fileName of sourceFiles) {
    await convertDumpFile(fileName, sourceDir, outputDir, dump2dcmCommand);
  }

  await removeStaleOutputFiles(sourceFiles, outputDir);
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  const settings = await loadSettings();
  console.log(`DICOM worklist builder watching ${settings.sourceDir} (DB-backed settings)`);

  while (true) {
    try {
      await runCycle(settings.sourceDir, settings.outputDir, settings.dump2dcmCommand);
    } catch (error) {
      console.error("Worklist builder cycle failed.", error);
    }

    await new Promise((resolve) => setTimeout(resolve, settings.pollMs));
  }
}

main().catch((error) => {
  console.error("DICOM worklist builder crashed.", error);
  process.exit(1);
});
