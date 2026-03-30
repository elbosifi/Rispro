import fs from "fs/promises";
import path from "path";
import { execFile } from "child_process";
import { promisify } from "util";

const execFileAsync = promisify(execFile);

const inboxDir = path.resolve(process.env.DICOM_MPPS_INBOX_DIR || "storage/dicom/mpps/inbox");
const processedDir = path.resolve(process.env.DICOM_MPPS_PROCESSED_DIR || "storage/dicom/mpps/processed");
const failedDir = path.resolve(process.env.DICOM_MPPS_FAILED_DIR || "storage/dicom/mpps/failed");
const dcmdumpCommand = process.env.DICOM_DCMDUMP_COMMAND || "dcmdump";
const baseUrl = (process.env.RISPRO_BASE_URL || "http://127.0.0.1:3000").replace(/\/+$/, "");
const callbackSecret = process.env.DICOM_CALLBACK_SECRET || "change-me-dicom-callback";
const pollMs = Number(process.env.DICOM_MPPS_POLL_MS || 3000);

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

async function ensureLayout() {
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

async function parseMppsFile(filePath) {
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

async function postMppsEvent(payload) {
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

async function processFile(filePath) {
  try {
    const payload = await parseMppsFile(filePath);
    await postMppsEvent(payload);
    await moveFile(filePath, processedDir);
    console.log(`Processed MPPS file ${path.basename(filePath)}`);
  } catch (error) {
    console.error(`Failed to process MPPS file ${path.basename(filePath)}.`, error.message || error);
    await moveFile(filePath, failedDir).catch((moveError) => {
      console.error(`Failed to move ${path.basename(filePath)} to failed directory.`, moveError);
    });
  }
}

async function main() {
  await ensureLayout();
  console.log(`DICOM MPPS processor watching ${inboxDir}`);

  while (true) {
    try {
      const files = await walkDirectory(inboxDir);
      for (const filePath of files) {
        await processFile(filePath);
      }
    } catch (error) {
      console.error("MPPS inbox cycle failed.", error);
    }

    await new Promise((resolve) => setTimeout(resolve, pollMs));
  }
}

main().catch((error) => {
  console.error("DICOM MPPS processor crashed.", error);
  process.exit(1);
});
