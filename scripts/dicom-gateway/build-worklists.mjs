import fs from "fs/promises";
import path from "path";
import { execFile } from "child_process";
import { promisify } from "util";

const execFileAsync = promisify(execFile);

const sourceDir = path.resolve(process.env.DICOM_WORKLIST_SOURCE_DIR || "storage/dicom/worklist-source");
const outputDir = path.resolve(process.env.DICOM_WORKLIST_OUTPUT_DIR || "storage/dicom/worklists");
const dump2dcmCommand = process.env.DICOM_DUMP2DCM_COMMAND || "dump2dcm";
const pollMs = Number(process.env.DICOM_WORKLIST_POLL_MS || 3000);

async function ensureLayout() {
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

async function convertDumpFile(fileName) {
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

async function removeStaleOutputFiles(sourceFiles) {
  const sourceBasenames = new Set(sourceFiles.map((file) => file.replace(/\.dump$/i, "")));
  const outputFiles = await listFiles(outputDir, ".wl");

  await Promise.all(
    outputFiles
      .filter((file) => !sourceBasenames.has(file.replace(/\.wl$/i, "")))
      .map((file) => fs.rm(path.join(outputDir, file), { force: true }))
  );
}

async function runCycle() {
  await ensureLayout();
  const sourceFiles = await listFiles(sourceDir, ".dump");

  for (const fileName of sourceFiles) {
    await convertDumpFile(fileName);
  }

  await removeStaleOutputFiles(sourceFiles);
}

async function main() {
  console.log(`DICOM worklist builder watching ${sourceDir}`);

  while (true) {
    try {
      await runCycle();
    } catch (error) {
      console.error("Worklist builder cycle failed.", error);
    }

    await new Promise((resolve) => setTimeout(resolve, pollMs));
  }
}

main().catch((error) => {
  console.error("DICOM worklist builder crashed.", error);
  process.exit(1);
});
