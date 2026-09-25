import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const moduleDirectory = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const clinicalModulePath = /(?:^|\/)modules\/(?:patients?|appointments?(?:-v2)?|scheduling|queues?|registrations?|modalities?|reporting|comparisons?|pacs|mwl|incidents?|sops?|clinical-documents|doctor-portal|dicom-remap|ohif-viewer|mobile-widget)(?:\/|$)/i;
const clinicalDomainFile = /(?:^|\/)(?:patients?|appointments?|scheduling|queues?|registrations?|modalities?|reporting|comparisons?|pacs|mwl|incidents?|sops?|clinical-documents?|documents?|dicom|orthanc)(?:-[^/]+)?(?:\/|$)/i;
const sharedStoragePathHelper = /(?:^|\/)document-storage-path(?:\.[^/]+)?$/i;
const clinicalTableReference = /\b(?:from|join|update|into)\s+(?:(?:public)\.)?(?:patients|patient_identifiers|appointments|bookings|reports|report|modalities|sops|documents|pacs|incidents|registrations|queue|studies|dicom_devices)\b|\b(?:appointments_v2|doctor_portal|clinical_documents|mwl)\s*\./i;

function isClinicalImport(specifier: string): boolean {
  const normalized = specifier.replaceAll("\\", "/");
  if (sharedStoragePathHelper.test(normalized)) return false;
  return clinicalModulePath.test(normalized) || clinicalDomainFile.test(normalized);
}

test("Teaching dependency guard recognizes common clinical module and service imports", () => {
  for (const specifier of [
    "../../../modules/patients/patient-service.js",
    "../../../modules/appointments-v2/booking/service.js",
    "../../../modules/doctor-portal/reporting-board-service.js",
    "../../../services/appointment-acquisition-summary.js",
    "../../../services/scheduling-service.js",
    "../../../services/pacs-service.js",
    "../../../services/document-service.js",
    "../../../services/clinical-document-service.js",
  ]) assert.equal(isClinicalImport(specifier), true, `${specifier} must remain outside Teaching`);
  assert.equal(isClinicalImport("../../../services/document-storage-path.js"), false, "the path-only storage helper is shared infrastructure");
  assert.equal(isClinicalImport("../../../db/pool.js"), false, "generic database infrastructure remains allowed");
  for (const sql of [
    "select * from patients",
    "select * from appointments_v2.bookings",
    "select * from doctor_portal.case_assignments",
  ]) assert.equal(clinicalTableReference.test(sql), true, `${sql} must remain outside Teaching`);
});

test("Teaching production modules do not import clinical domain modules or workflow services", async () => {
  const sourceFiles = await collectTypeScriptFiles(moduleDirectory);
  const violations: string[] = [];
  const tableViolations: string[] = [];

  for (const file of sourceFiles.filter((candidate) => !candidate.includes(`${path.sep}tests${path.sep}`) && !/\.(?:test|spec)\.tsx?$/.test(candidate))) {
    const source = await readFile(file, "utf8");
    if (clinicalTableReference.test(source)) tableViolations.push(path.relative(moduleDirectory, file));
    const importPattern = /(?:from\s+|import\s*\()\s*["']([^"']+)["']/g;
    for (const match of source.matchAll(importPattern)) {
      const specifier = match[1];
      if (specifier && isClinicalImport(specifier)) {
        violations.push(`${path.relative(moduleDirectory, file)} -> ${specifier}`);
      }
    }
  }

  assert.deepEqual(violations, []);
  assert.deepEqual(tableViolations, [], "Teaching SQL must not query or write clinical tables.");
});

async function collectTypeScriptFiles(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const nested = await Promise.all(entries.map(async (entry) => {
    const entryPath = path.join(directory, entry.name);
    if (entry.isDirectory()) return collectTypeScriptFiles(entryPath);
    return entry.isFile() && /\.tsx?$/.test(entry.name) ? [entryPath] : [];
  }));
  return nested.flat();
}
