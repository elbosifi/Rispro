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
  mppsInboxDir: "storage/dicom/mpps/inbox",
  mppsProcessedDir: "storage/dicom/mpps/processed",
  mppsFailedDir: "storage/dicom/mpps/failed",
  dcmdumpCommand: "dcmdump",
  callbackSecret: "change-me-dicom-callback",
  pollMs: 3000
};

async function loadSettings() {
  const baseUrlEnv = process.env.RISPRO_BASE_URL || "http://127.0.0.1:3000";

  try {
    const resp = await fetch(`${baseUrlEnv}/api/settings/dicom_gateway`, {
      headers: { "accept": "application/json" }
    });

    if (resp.ok) {
      const body = await resp.json();
      const s = body.settings || {};
      return {
        inboxDir: resolvePath(s.mpps_inbox_dir, DEFAULTS.mppsInboxDir),
        processedDir: resolvePath(s.mpps_processed_dir, DEFAULTS.mppsProcessedDir),
        failedDir: resolvePath(s.mpps_failed_dir, DEFAULTS.mppsFailedDir),
        dcmdumpCommand: s.dcmdump_command || DEFAULTS.dcmdumpCommand,
        callbackSecret: s.callback_secret || DEFAULTS.callbackSecret,
        baseUrl: baseUrlEnv.replace(/\/+$/, ""),
        pollMs: Number(s.mpps_poll_ms) || DEFAULTS.pollMs
      };
    }
  } catch {
    // Backend unavailable – fall back to env
  }

  // Environment fallback
  return {
    inboxDir: resolvePath(process.env.DICOM_MPPS_INBOX_DIR, DEFAULTS.mppsInboxDir),
    processedDir: resolvePath(process.env.DICOM_MPPS_PROCESSED_DIR, DEFAULTS.mppsProcessedDir),
    failedDir: resolvePath(process.env.DICOM_MPPS_FAILED_DIR, DEFAULTS.mppsFailedDir),
    dcmdumpCommand: process.env.DICOM_DCMDUMP_COMMAND || DEFAULTS.dcmdumpCommand,
    callbackSecret: process.env.DICOM_CALLBACK_SECRET || DEFAULTS.callbackSecret,
    baseUrl: (process.env.RISPRO_BASE_URL || "http://127.0.0.1:3000").replace(/\/+$/, ""),
    pollMs: Number(process.env.DICOM_MPPS_POLL_MS) || DEFAULTS.pollMs
  };
}

function resolvePath(value, fallback) {
  const raw = value || fallback;
  return path.isAbsolute(raw) ? raw : path.resolve(rootDir, raw);
}

// ---------------------------------------------------------------------------
// MPPS processor logic
// ---------------------------------------------------------------------------

const TAG_PATTERNS = {
  sopInstanceUid: /\(0008,0018\)[^\[]*\[([^\]]*)\]/i,
  accessionNumber: /\(0008,0050\)[^\[]*\[([^\]]*)\]/i,
  performedStationAeTitle: /\(0040,0241\)[^\[]*\[([^\]]*)\]/i,
  performedProcedureStepStatus: /\(0040,0252\)[^\[]*\[([^\]]*)\]/i,
  startedDate: /\(0040,0244\)[^\[]*\[([^\]]*)\]/i,
  startedTime: /\(0040,0245\)[^\[]*\[([^\]]*)\]/i,
  finishedDate: /\(0040,0250\)[^\[]*\[([^\]]*)\]/i,
  finishedTime: /\(0040,0251\)[^\[]*\[([^\]]*)\]/i
};

async function ensureLayout(inboxDir, processedDir, failedDir) {
  await Promise.all([
    fs.mkdir(inboxDir, { recursive: true }),
    fs.mkdir(processedDir, { recursive: true }),
    fs.mkdir(failedDir, { recursive: true })
  ]);
}

async function walkDirectory(directory) {
  const entries = await fs.readdir(directory, { withFileTypes: true });
  const files = [];

  for (const entry of entries) {
    const absolutePath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await walkDirectory(absolutePath)));
    } else if (entry.isFile()) {
      files.push(absolutePath);
    }
  }

  return files.sort();
}

function extractTagValue(dumpOutput, key) {
  return (dumpOutput.match(TAG_PATTERNS[key]) || [])[1] || "";
}

async function parseMppsFile(filePath, dcmdumpCommand) {
  const { stdout } = await execFileAsync(dcmdumpCommand, [filePath], {
    timeout: 10000,
    maxBuffer: 4 * 1024 * 1024
  });

  return {
    sourcePath: filePath,
    accessionNumber: extractTagValue(stdout, "accessionNumber"),
    performedStationAeTitle: extractTagValue(stdout, "performedStationAeTitle"),
    mppsSopInstanceUid: extractTagValue(stdout, "sopInstanceUid"),
    mppsStatus: extractTagValue(stdout, "performedProcedureStepStatus"),
    startedDate: extractTagValue(stdout, "startedDate"),
    startedTime: extractTagValue(stdout, "startedTime"),
    finishedDate: extractTagValue(stdout, "finishedDate"),
    finishedTime: extractTagValue(stdout, "finishedTime"),
    raw: stdout
  };
}

async function moveFile(filePath, targetDirectory) {
  const targetPath = path.join(targetDirectory, path.basename(filePath));
  await fs.mkdir(path.dirname(targetPath), { recursive: true });
  await fs.rename(filePath, targetPath).catch(async () => {
    await fs.copyFile(filePath, targetPath);
    await fs.rm(filePath, { force: true });
  });
}

async function postMppsEvent(payload, baseUrl, callbackSecret) {
  const response = await fetch(`${baseUrl}/api/integrations/dicom/mpps-event`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-rispro-dicom-secret": callbackSecret
    },
    body: JSON.stringify(payload)
  });

  if (!response.ok && response.status !== 202) {
    const body = await response.text();
    throw new Error(`RISpro callback failed with ${response.status}: ${body}`);
  }

  return response.json().catch(() => ({}));
}

async function processFile(filePath, dcmdumpCommand, baseUrl, callbackSecret, processedDir, failedDir) {
  try {
    const payload = await parseMppsFile(filePath, dcmdumpCommand);
    await postMppsEvent(payload, baseUrl, callbackSecret);
    await moveFile(filePath, processedDir);
    console.log(`Processed MPPS file ${path.basename(filePath)}`);
  } catch (error) {
    console.error(`Failed to process MPPS file ${path.basename(filePath)}.`, error.message || error);
    await moveFile(filePath, failedDir).catch((moveError) => {
      console.error(`Failed to move ${path.basename(filePath)} to failed directory.`, moveError);
    });
  }
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  const settings = await loadSettings();
  await ensureLayout(settings.inboxDir, settings.processedDir, settings.failedDir);
  console.log(`DICOM MPPS processor watching ${settings.inboxDir} (DB-backed settings)`);

  while (true) {
    try {
      const files = await walkDirectory(settings.inboxDir);
      for (const filePath of files) {
        await processFile(
          filePath,
          settings.dcmdumpCommand,
          settings.baseUrl,
          settings.callbackSecret,
          settings.processedDir,
          settings.failedDir
        );
      }
    } catch (error) {
      console.error("MPPS inbox cycle failed.", error);
    }

    await new Promise((resolve) => setTimeout(resolve, settings.pollMs));
  }
}

main().catch((error) => {
  console.error("DICOM MPPS processor crashed.", error);
  process.exit(1);
});
