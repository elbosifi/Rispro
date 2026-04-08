#!/usr/bin/env node
import "dotenv/config";
import { rebuildAllDicomWorklistSources } from "../../src/services/dicom-service.js";

async function main() {
  try {
    const result = await rebuildAllDicomWorklistSources();
    console.log(`Rebuilt ${result.count} DICOM worklist source appointments.`);
  } catch (error) {
    console.error("Failed to rebuild DICOM worklist sources.", error);
    process.exit(1);
  }
}

main().catch((error) => {
  console.error("DICOM worklist source rebuild crashed.", error);
  process.exit(1);
});
