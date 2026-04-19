// @ts-nocheck
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
  mwlAeTitle: "RISPRO_MWL",
  dump2dcmCommand: "dump2dcm",
  pollMs: 3000
};

const REQUIRED_DUMP_TAGS = [
  "(0040,0100)",
  "(0008,0060)",
  "(0040,0001)",
  "(0040,0002)",
  "(0040,0003)",
  "(0040,0007)",
  "(0040,0009)"
];

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
        mwlAeTitle: s.mwl_ae_title || DEFAULTS.mwlAeTitle,
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
    mwlAeTitle: process.env.DICOM_MWL_AE_TITLE || DEFAULTS.mwlAeTitle,
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

async function listDirectories(directory) {
  const entries = await fs.readdir(directory, { withFileTypes: true }).catch(() => []);
  return entries.filter((entry) => entry.isDirectory()).map((entry) => entry.name).sort();
}

export function getOutputAeTitle(_fileName, fallbackAeTitle) {
  return fallbackAeTitle;
}

function getOutputStem(fileName) {
  return fileName.replace(/\.dump$/i, ".wl");
}

function getAeOutputDir(outputDir, aeTitle) {
  return path.join(outputDir, aeTitle);
}

async function ensureAeOutputLayout(aeOutputDir) {
  await fs.mkdir(aeOutputDir, { recursive: true });
  await fs.writeFile(path.join(aeOutputDir, "lockfile"), "", "utf8");
}

export async function validateDumpFile(sourcePath) {
  const dumpContents = await fs.readFile(sourcePath, "utf8");
  const missingTags = REQUIRED_DUMP_TAGS.filter((tag) => !dumpContents.includes(tag));
  return {
    ok: missingTags.length === 0,
    missingTags
  };
}

async function convertDumpFile(fileName, sourceDir, aeOutputDir, dump2dcmCommand) {
  const sourcePath = path.join(sourceDir, fileName);
  const targetPath = path.join(aeOutputDir, getOutputStem(fileName));

  try {
    const sourceStats = await fs.stat(sourcePath);
    const targetStats = await fs.stat(targetPath).catch(() => null);
    const validation = await validateDumpFile(sourcePath);

    if (!validation.ok) {
      console.error(`Skipping ${fileName}: missing required MWL dump tags ${validation.missingTags.join(", ")}`);
      return false;
    }

    if (targetStats && targetStats.mtimeMs >= sourceStats.mtimeMs) {
      return false;
    }

    await execFileAsync(dump2dcmCommand, [sourcePath, targetPath], {
      timeout: 10000,
      maxBuffer: 1024 * 1024
    });

    await fs.stat(targetPath);
    console.log(`Converted ${fileName} -> ${targetPath}`);

    return true;
  } catch (error) {
    console.error(`Failed to convert ${fileName} into a worklist file.`, error.stderr || error.message || error);
    return false;
  }
}

async function removeStaleOutputFiles(sourceFiles, outputDir) {
  const sourceBasenames = new Set(sourceFiles.map((file) => file.replace(/\.dump$/i, ".wl")));
  const outputFiles = await listFiles(outputDir, ".wl");

  await Promise.all(
    outputFiles
      .filter((file) => !sourceBasenames.has(file))
      .map((file) => fs.rm(path.join(outputDir, file), { force: true }))
  );
}

async function removeLegacyFlatOutputFiles(outputDir) {
  const outputFiles = await listFiles(outputDir, ".wl");

  await Promise.all(outputFiles.map((file) => fs.rm(path.join(outputDir, file), { force: true })));
}

export async function runCycle(sourceDir, outputDir, dump2dcmCommand, fallbackAeTitle) {
  await ensureLayout(sourceDir, outputDir);
  const sourceFiles = await listFiles(sourceDir, ".dump");
  const filesByAeTitle = new Map();

  for (const fileName of sourceFiles) {
    const aeTitle = getOutputAeTitle(fileName, fallbackAeTitle);
    const aeOutputDir = getAeOutputDir(outputDir, aeTitle);

    if (!filesByAeTitle.has(aeTitle)) {
      filesByAeTitle.set(aeTitle, []);
    }

    filesByAeTitle.get(aeTitle).push(fileName);

    await ensureAeOutputLayout(aeOutputDir);
    await convertDumpFile(fileName, sourceDir, aeOutputDir, dump2dcmCommand);
  }

  await removeLegacyFlatOutputFiles(outputDir);

  const outputDirectories = await listDirectories(outputDir);
  for (const aeTitle of outputDirectories) {
    const aeOutputDir = getAeOutputDir(outputDir, aeTitle);
    const sourceFilesForAe = filesByAeTitle.get(aeTitle) || [];
    await ensureAeOutputLayout(aeOutputDir);
    await removeStaleOutputFiles(sourceFilesForAe, aeOutputDir);
  }
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  const settings = await loadSettings();
  console.log(`DICOM worklist builder watching ${settings.sourceDir} (DB-backed settings)`);

  while (true) {
    try {
      await runCycle(settings.sourceDir, settings.outputDir, settings.dump2dcmCommand, settings.mwlAeTitle);
    } catch (error) {
      console.error("Worklist builder cycle failed.", error);
    }

    await new Promise((resolve) => setTimeout(resolve, settings.pollMs));
  }
}

function isDirectExecution() {
  const entryPath = process.argv[1];

  if (!entryPath) {
    return false;
  }

  return path.resolve(entryPath) === fileURLToPath(import.meta.url);
}

if (isDirectExecution()) {
  main().catch((error) => {
    console.error("DICOM worklist builder crashed.", error);
    process.exit(1);
  });
}
