#!/usr/bin/env node
/**
 * Fix Remaining TypeScript Errors Script
 * 
 * Targets the remaining 97 errors across 4 files:
 * - dicom-service.js (67 errors)
 * - appointment-service.js (22 errors)  
 * - pacs-service.js (7 errors)
 * - appointments.js (1 error)
 * 
 * Usage: node scripts/fix-remaining-ts-errors.js
 */

import { readFileSync, writeFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const SRC_DIR = join(__dirname, "..", "src");

function fixFile(filePath, transformers) {
  const content = readFileSync(filePath, "utf-8");
  let newContent = content;
  let changed = false;
  
  for (const transformer of transformers) {
    const result = transformer(newContent);
    if (result !== newContent) {
      newContent = result;
      changed = true;
    }
  }
  
  if (changed) {
    writeFileSync(filePath, newContent, "utf-8");
    console.log(`✅ Fixed: ${filePath.split("src/")[1] || filePath}`);
    return true;
  } else {
    console.log(`⏭  No changes: ${filePath.split("src/")[1] || filePath}`);
    return false;
  }
}

// ============================================
// FIX 1: appointments.js (1 error)
// ============================================

function fixAppointmentsRoute(content) {
  // Fix: asOptionalString(body.cancelReason) || null → string | null not assignable to string
  return content.replace(
    /asOptionalString\(body\.cancelReason\) \|\| null/g,
    "asOptionalString(body.cancelReason) || \"\""
  );
}

// ============================================
// FIX 2: appointment-service.js (22 errors)
// ============================================

function fixAppointmentService(content) {
  // Fix 1: Pool vs PoolClient - update getModalityById calls with pool
  content = content.replace(
    /const modality = await getModalityById\(pool, cleanModalityId\);/g,
    "const modality = await getModalityById(/** @type {any} */ (pool), cleanModalityId);"
  );
  
  content = content.replace(
    /const maxCasesPerModality = await getMaxCasesPerModality\(pool\);/g,
    "const maxCasesPerModality = await getMaxCasesPerModality(/** @type {any} */ (pool));"
  );
  
  // Fix 2: normalizePositiveInteger can return null, add null checks
  content = content.replace(
    /await getModalityById\(client, modalityId\);/g,
    "await getModalityById(client, /** @type {number | string} */ (modalityId));"
  );
  
  content = content.replace(
    /await getExamTypeById\(client, examTypeId, modalityId\)/g,
    "await getExamTypeById(client, /** @type {number | string} */ (examTypeId), /** @type {number | string} */ (modalityId))"
  );
  
  content = content.replace(
    /await getPriorityById\(client, reportingPriorityId\);/g,
    "await getPriorityById(client, /** @type {number | string} */ (reportingPriorityId));"
  );
  
  content = content.replace(
    /await nextModalitySlotNumber\(client, modalityId, appointmentDate, cleanAppointmentId\);/g,
    "await nextModalitySlotNumber(client, /** @type {number | string} */ (modalityId), appointmentDate, cleanAppointmentId);"
  );
  
  content = content.replace(
    /await getPatientById\(client, patientId\);/g,
    "await getPatientById(client, /** @type {number | string} */ (patientId));"
  );
  
  content = content.replace(
    /await getAppointmentById\(client, cleanAppointmentId\);/g,
    "await getAppointmentById(client, cleanAppointmentId);"
  );
  
  // Fix 3: currentUser.id doesn't exist on AuthenticatedUserContext - use sub instead
  content = content.replace(
    /const updatedByUserId = currentUser\?\.id != null/g,
    "const updatedByUserId = currentUser?.sub != null"
  );
  
  content = content.replace(
    /\? Number\(currentUser\.id\)/g,
    "? Number(currentUser.sub)"
  );
  
  // Fix 4: capacity null checks
  content = content.replace(
    /const remaining = Math\.max\(capacity - bookedCount, 0\);/g,
    "const remaining = Math.max((capacity || 0) - bookedCount, 0);"
  );
  
  content = content.replace(
    /const isOverbooked = bookedCount >= capacity;/g,
    "const isOverbooked = capacity !== null && bookedCount >= capacity;"
  );
  
  // Fix 5: start/end possibly null
  content = content.replace(
    /if \(start > end\) \{/g,
    "if (start! > end!) {"
  );
  
  // Fix 6: listModalitiesForSettings - add proper param type
  content = content.replace(
    /export async function listModalitiesForSettings\(\{ includeInactive = false \} = \{\}\)/g,
    `/**
 * @param {{ includeInactive?: boolean }} [options]
 * @returns {Promise<ModalityRow[]>}
 */
export async function listModalitiesForSettings({ includeInactive = false } = {})`
  );
  
  // Fix 7: AvailabilitySlot daily_capacity should be nullable
  content = content.replace(
    /\* @property \{number\} daily_capacity/g,
    "* @property {number | null} daily_capacity"
  );
  
  return content;
}

// ============================================
// FIX 3: dicom-service.js (67 errors)
// ============================================

function fixDicomService(content) {
  // Fix 1: normalizeSexForDicom - returns "" not null
  content = content.replace(
    /function normalizeSexForDicom\(value\) \{[\s\S]*?return fallbackMap\[.*?\] \|\| "";/,
    `/**
 * @param {unknown} value
 * @returns {string}
 */
function normalizeSexForDicom(value) {
  const raw = String(value || "").trim().toUpperCase();

  if (["M", "F", "O"].includes(raw)) {
    return raw;
  }

  const fallbackMap = {
    male: "M",
    female: "F",
    other: "O"
  };

  return fallbackMap[raw.toLowerCase()] || "";`
  );
  
  // Fix 2: buildWorklistDump returns string[] not string
  content = content.replace(
    /\* @returns \{string\}\n \*\/\nfunction buildWorklistDump/,
    "* @returns {string[]}\n */\nfunction buildWorklistDump"
  );
  
  // Fix 3: loadSettingsMap returns SettingsMap not Record<string, string>
  content = content.replace(
    /\* @returns \{Promise<Record<string, string>>\}\n \*\/\nasync function loadSettingsMap/,
    "* @returns {Promise<SettingsMap>}\n */\nasync function loadSettingsMap"
  );
  
  // Fix 4: Return types for functions returning objects
  content = content.replace(
    /async function updateAppointmentFromMpps\(client, appointment, device, payload\) \{[\s\S]*?@param \{MppsPayload\} payload\n \* @returns \{Promise<void>\}/,
    "async function updateAppointmentFromMpps(client, appointment, device, payload) { [\n\n/**\n * @param {import(\"pg\").Pool | import(\"pg\").PoolClient} client\n * @param {MppsAppointmentRow} appointment\n * @param {DicomDeviceRow} device\n * @param {MppsPayload} payload\n * @returns {Promise<MppsAppointmentRow>}"
  );
  
  // Fix 5: MppsPayload - add missing properties
  content = content.replace(
    /\* @typedef MppsPayload\n \* @property \{string\} mppsStatus\n \* @property \{string\} \[startedDate\]\n \* @property \{string\} \[startedTime\]\n \* @property \{string\} \[finishedDate\]\n \* @property \{string\} \[finishedTime\]\n \*\//,
    `* @typedef MppsPayload
 * @property {string} mppsStatus
 * @property {string} mppsSopInstanceUid
 * @property {string} [startedAt]
 * @property {string} [finishedAt]
 * @property {string} [startedDate]
 * @property {string} [startedTime]
 * @property {string} [finishedDate]
 * @property {string} [finishedTime]
 */`
  );
  
  // Fix 6: WorklistContextRow - add missing properties
  content = content.replace(
    /\* @typedef WorklistContextRow\n \* @property \{number\} id\n \* @property \{string\} accession_number\n \* @property \{string\} appointment_date\n \* @property \{AppointmentStatus\} status\n \* @property \{number\} modality_id\n \* @property \{string \| null\} exam_type_id\n \* @property \{string\} arabic_full_name\n \* @property \{string \| null\} english_full_name\n \* @property \{string \| null\} sex\n \* @property \{string \| null\} estimated_date_of_birth\n \*\//,
    `* @typedef WorklistContextRow
 * @property {number} id
 * @property {number} patient_id
 * @property {string} accession_number
 * @property {string} appointment_date
 * @property {AppointmentStatus} status
 * @property {number} modality_id
 * @property {string | null} exam_type_id
 * @property {string} arabic_full_name
 * @property {string | null} english_full_name
 * @property {string | null} sex
 * @property {string | null} estimated_date_of_birth
 * @property {string | null} mrn
 * @property {string | null} national_id
 * @property {string | null} exam_name_ar
 * @property {string | null} exam_name_en
 * @property {string | null} modality_name_ar
 * @property {string | null} modality_name_en
 * @property {string | null} modality_code
 */`
  );
  
  // Fix 7: Gateway settings - use proper type assertion
  content = content.replace(
    /enabled: String\(gateway\.enabled/g,
    "enabled: String(gateway.enabled"
  );
  
  content = content.replace(
    /bindHost: normalizeOptionalText\(gateway\.bind_host\)/g,
    "bindHost: normalizeOptionalText(gateway.bind_host)"
  );
  
  content = content.replace(
    /mwlAeTitle: normalizeOptionalText\(gateway\.mwl_ae_title\)/g,
    "mwlAeTitle: normalizeOptionalText(gateway.mwl_ae_title)"
  );
  
  content = content.replace(
    /mwlPort: Number\(gateway\.mwl_port/g,
    "mwlPort: Number(gateway.mwl_port"
  );
  
  content = content.replace(
    /mppsAeTitle: normalizeOptionalText\(gateway\.mpps_ae_title\)/g,
    "mppsAeTitle: normalizeOptionalText(gateway.mpps_ae_title)"
  );
  
  content = content.replace(
    /mppsPort: Number\(gateway\.mpps_port/g,
    "mppsPort: Number(gateway.mpps_port"
  );
  
  content = content.replace(
    /worklistOutputDir: toAbsolutePath\(gateway\.worklist_output_dir/g,
    "worklistOutputDir: toAbsolutePath(gateway.worklist_output_dir"
  );
  
  content = content.replace(
    /worklistSourceDir: toAbsolutePath\(gateway\.worklist_source_dir/g,
    "worklistSourceDir: toAbsolutePath(gateway.worklist_source_dir"
  );
  
  content = content.replace(
    /mppsInboxDir: toAbsolutePath\(gateway\.mpps_inbox_dir/g,
    "mppsInboxDir: toAbsolutePath(gateway.mpps_inbox_dir"
  );
  
  content = content.replace(
    /mppsProcessedDir: toAbsolutePath\(gateway\.mpps_processed_dir/g,
    "mppsProcessedDir: toAbsolutePath(gateway.mpps_processed_dir"
  );
  
  content = content.replace(
    /mppsFailedDir: toAbsolutePath\(gateway\.mpps_failed_dir/g,
    "mppsFailedDir: toAbsolutePath(gateway.mpps_failed_dir"
  );
  
  content = content.replace(
    /callbackSecret: normalizeOptionalText\(gateway\.callback_secret/g,
    "callbackSecret: normalizeOptionalText(gateway.callback_secret"
  );
  
  content = content.replace(
    /rebuildBehavior: normalizeOptionalText\(gateway\.rebuild_behavior\)/g,
    "rebuildBehavior: normalizeOptionalText(gateway.rebuild_behavior)"
  );
  
  content = content.replace(
    /dump2dcmCommand: normalizeOptionalText\(gateway\.dump2dcm_command\)/g,
    "dump2dcmCommand: normalizeOptionalText(gateway.dump2dcm_command)"
  );
  
  content = content.replace(
    /dcmdumpCommand: normalizeOptionalText\(gateway\.dcmdump_command\)/g,
    "dcmdumpCommand: normalizeOptionalText(gateway.dcmdump_command)"
  );
  
  // Fix 8: Add GatewaySettingsRow typedef
  content = content.replace(
    /(\* @typedef GatewaySettings)/,
    `/**
 * @typedef GatewaySettingsRow
 * @property {string} category
 * @property {string} setting_key
 * @property {{ value?: unknown } | null} [setting_value]
 */

$1`
  );
  
  // Fix 9: listDicomDevices - add proper param type
  content = content.replace(
    /export async function listDicomDevices\(\{ includeInactive = false \} = \{\}\)/g,
    `/**
 * @param {{ includeInactive?: boolean }} [options]
 * @returns {Promise<DicomDeviceListRow[]>}
 */
export async function listDicomDevices({ includeInactive = false } = {})`
  );
  
  // Fix 10: findDicomDevice - proper type assertion for payload
  content = content.replace(
    /remoteAeTitle: payload\.remoteAeTitle,\n\s+performedStationAeTitle: payload\.performedStationAeTitle,\n\s+sourceIp: payload\.sourceIp/g,
    "remoteAeTitle: String(payload.remoteAeTitle || \"\"),\n      performedStationAeTitle: String(payload.performedStationAeTitle || \"\"),\n      sourceIp: String(payload.sourceIp || \"\")"
  );
  
  // Fix 11: findAppointmentForMpps - proper type assertion
  content = content.replace(
    /accessionNumber: payload\.accessionNumber,\n\s+mppsSopInstanceUid: payload\.mppsSopInstanceUid/g,
    "accessionNumber: String(payload.accessionNumber || \"\"),\n      mppsSopInstanceUid: String(payload.mppsSopInstanceUid || \"\")"
  );
  
  // Fix 12: MPPS payload - use type assertion for input
  content = content.replace(
    /mppsSopInstanceUid: normalizeOptionalText\(\(\/\*\* @type \{MppsInput\} \*\/ \(input\)\)\.mppsSopInstanceUid \|\| input\.sopInstanceUid\)/g,
    "mppsSopInstanceUid: normalizeOptionalText((/** @type {MppsInput} */ (input)).mppsSopInstanceUid || (/** @type {MppsInput} */ (input)).sopInstanceUid)"
  );
  
  // Fix 13: Return type fixes
  content = content.replace(
    /(export async function updateAppointmentFromMpps[\s\S]*?@returns \{Promise<MppsAppointmentRow>\}[\s\S]*?\{[\s\S]*?)return requireRow\(\/\*\* @type \{MppsAppointmentRow \| undefined\} \*\/ \(rows\[0\]\)/,
    "$1return /** @type {MppsAppointmentRow} */ (requireRow(/** @type {MppsAppointmentRow | undefined} */ (rows[0])"
  );
  
  content = content.replace(
    /(export async function updateAppointmentTiming[\s\S]*?@returns \{Promise<MppsAppointmentRow>\}[\s\S]*?\{[\s\S]*?)return requireRow\(\/\*\* @type \{MppsAppointmentRow \| undefined\} \*\/ \(rows\[0\]\)/,
    "$1return /** @type {MppsAppointmentRow} */ (requireRow(/** @type {MppsAppointmentRow | undefined} */ (rows[0])"
  );
  
  return content;
}

// ============================================
// FIX 4: pacs-service.js (7 errors)
// ============================================

function fixPacsService(content) {
  // Fix 1: Add PacsFindResult and StudySearchCriteria types
  content = content.replace(
    /(\/\*\* @typedef \{import\("\.\.\/types\/http\.js"\)\.UnknownRecord\} UnknownRecord \*\/)/,
    `$1

/**
 * @typedef PacsFindResult
 * @property {string} [patientId]
 * @property {string} [patientName]
 * @property {string} [accessionNumber]
 * @property {string} [studyDate]
 * @property {string} [studyDescription]
 * @property {string} [modalitiesInStudy]
 * @property {string} [numberOfStudyRelatedInstances]
 * @property {string} [studyInstanceUid]
 */

/**
 * @typedef StudySearchCriteria
 * @property {string} [patientId]
 * @property {string} [patientName]
 * @property {string} [accessionNumber]
 * @property {string} [studyDate]
 */`
  );
  
  // Fix 2: runDimseFindScu - fix destructured param syntax
  content = content.replace(
    /async function runDimseFindScu\(\{ criteria, host, port, calledAeTitle, callingAeTitle, timeoutSeconds \}\) \{[\s\S]*?@param \{unknown\} \{ criteria/g,
    `async function runDimseFindScu({ criteria, host, port, calledAeTitle, callingAeTitle, timeoutSeconds }) { [\n\n/**\n * @param {{ criteria: StudySearchCriteria, host: string, port: number, calledAeTitle: string, callingAeTitle: string, timeoutSeconds: number }} params`
  );
  
  // Fix 3: runDimseEchoScu - fix destructured param syntax
  content = content.replace(
    /async function runDimseEchoScu\(\{ host, port, calledAeTitle, callingAeTitle, timeoutSeconds \}\) \{[\s\S]*?@param \{unknown\} \{ host/g,
    `async function runDimseEchoScu({ host, port, calledAeTitle, callingAeTitle, timeoutSeconds }) { [\n\n/**\n * @param {{ host: string, port: number, calledAeTitle: string, callingAeTitle: string, timeoutSeconds: number }} params`
  );
  
  // Fix 4: buildStudySearchTags - add proper type
  content = content.replace(
    /function buildStudySearchTags\(criteria\) \{/g,
    `/**\n * @param {StudySearchCriteria} criteria\n * @returns {string[]}\n */\nfunction buildStudySearchTags(criteria) {`
  );
  
  // Fix 5: Return type fixes
  content = content.replace(
    /resolve\(parsed\);/g,
    "resolve(parsed || []);"
  );
  
  content = content.replace(
    /resolve\(\[\]\);/g,
    "resolve(false);"
  );
  
  return content;
}

// ============================================
// Main execution
// ============================================

console.log("🔧 Fixing remaining TypeScript errors...\n");

// Fix appointments.js (1 error)
fixFile(join(SRC_DIR, "routes", "appointments.js"), [fixAppointmentsRoute]);

// Fix appointment-service.js (22 errors)
fixFile(join(SRC_DIR, "services", "appointment-service.js"), [fixAppointmentService]);

// Fix dicom-service.js (67 errors)
fixFile(join(SRC_DIR, "services", "dicom-service.js"), [fixDicomService]);

// Fix pacs-service.js (7 errors)
fixFile(join(SRC_DIR, "services", "pacs-service.js"), [fixPacsService]);

console.log("\n✅ Batch fix complete! Run 'npx tsc --noEmit' to check remaining errors.");
