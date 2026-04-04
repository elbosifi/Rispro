#!/usr/bin/env node
/**
 * TypeScript Error Batch Fix Script
 * 
 * This script automatically fixes common TypeScript errors by:
 * 1. Adding missing @param type annotations
 * 2. Adding missing @returns type annotations
 * 3. Fixing common type mismatch patterns
 * 4. Adding missing type definitions
 * 
 * Usage: node scripts/fix-typescript-errors.js
 */

import { readFileSync, writeFileSync, readdirSync, statSync } from "fs";
import { join, relative, dirname } from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const SRC_DIR = join(__dirname, "..", "src");

// Files to skip
const SKIP_FILES = new Set([
  // Already fixed or complex files that need manual attention
]);

// ============================================
// PATTERN 1: Add @param types to untyped functions
// ============================================

function fixUntypedParams(content) {
  // Match function declarations without @param types
  // Pattern: function name(param1, param2) {
  const functionPattern = /((?:export )?(?:async )?function\s+\w+)\(([^)]*)\)/g;
  
  return content.replace(functionPattern, (match, funcKeyword, params) => {
    // Skip if params is empty
    if (!params.trim()) return match;
    
    // Check if there's already a @param annotation above
    const beforeMatch = content.substring(0, content.indexOf(match));
    const lastLines = beforeMatch.split("\n").slice(-5).join("\n");
    if (/@param/.test(lastLines)) return match;
    
    // Parse parameters
    const paramList = params.split(",").map(p => {
      const trimmed = p.trim();
      // Handle destructuring: { param1, param2 }
      if (trimmed.startsWith("{")) {
        const destructured = trimmed.match(/\{([^}]+)\}/);
        if (destructured) {
          return destructured[1].split(",").map(d => d.trim().split(":")[0].split("=")[0].trim());
        }
      }
      // Handle default values: param = value
      const name = trimmed.split("=")[0].split(":")[0].trim();
      return name;
    }).flat().filter(Boolean);
    
    if (paramList.length === 0) return match;
    
    // Generate @param annotations
    const paramAnnotations = paramList.map(name => 
      ` * @param {unknown} ${name}`
    ).join("\n");
    
    // Add JSDoc comment before function
    const jsdoc = `\n/**\n${paramAnnotations}\n */\n`;
    
    return jsdoc + match;
  });
}

// ============================================
// PATTERN 2: Fix specific file patterns
// ============================================

function fixAppointmentService(content) {
  // Add missing filter type annotation
  content = content.replace(
    /export async function listAppointmentsForPrint\(filters = \{\}\)/,
    `/** @param {AppointmentFilters} [filters] */\nexport async function listAppointmentsForPrint(filters = {})`
  );
  
  // Add missing filter type for statistics
  content = content.replace(
    /export async function listAppointmentStatistics\(filters = \{\}\)/,
    `/** @param {AppointmentStatisticsFilters} [filters] */\nexport async function listAppointmentStatistics(filters = {})`
  );
  
  // Fix error handling - add type guard for unknown errors
  content = content.replace(
    /console\.error\("\[updateAppointment\] ERROR:", error\.message, error\.stack\)/g,
    `console.error("[updateAppointment] ERROR:", /** @type {Error} */ (error).message, /** @type {Error} */ (error).stack)`
  );
  
  // Fix scheduleWorklistSync null argument
  content = content.replace(
    /scheduleWorklistSync\(cleanAppointmentId\)/g,
    `if (cleanAppointmentId) scheduleWorklistSync(cleanAppointmentId)`
  );
  
  // Fix null checks for capacity
  content = content.replace(
    /const isOverbooked = bookedCount >= capacity;/g,
    `const isOverbooked = capacity !== null && bookedCount >= capacity;`
  );
  
  content = content.replace(
    /const isOverbooked = modalityOrDateChanged && slotStats\.bookedCount >= capacity;/g,
    `const isOverbooked = modalityOrDateChanged && capacity !== null && slotStats.bookedCount >= capacity;`
  );
  
  // Fix approvingSupervisor null checks
  content = content.replace(
    /isOverbooked \? approvingSupervisor\.full_name : null/g,
    `isOverbooked && approvingSupervisor ? approvingSupervisor.full_name : null`
  );
  
  content = content.replace(
    /isOverbooked \? approvingSupervisor\.id : null/g,
    `isOverbooked && approvingSupervisor ? approvingSupervisor.id : null`
  );
  
  // Add missing type for cancelAppointment
  content = content.replace(
    /export async function cancelAppointment\(appointmentId, reason, currentUserId\)/,
    `/**\n * @param {number | string} appointmentId\n * @param {string} reason\n * @param {UserId} currentUserId\n * @returns {Promise<void>}\n */\nexport async function cancelAppointment(appointmentId, reason, currentUserId)`
  );
  
  return content;
}

function fixDicomService(content) {
  // Add MppsInput interface
  const mppsInputTypedef = `/**
 * @typedef MppsInput
 * @property {string} [sourcePath]
 * @property {string} [sourceIp]
 * @property {string} [remoteAeTitle]
 * @property {string} [performedStationAeTitle]
 * @property {string} [accessionNumber]
 * @property {string} [mppsSopInstanceUid]
 * @property {string} [sopInstanceUid]
 * @property {string} [mppsStatus]
 * @property {string} [startedAt]
 * @property {string} [startedDate]
 * @property {string} [startedTime]
 * @property {string} [finishedAt]
 * @property {string} [finishedDate]
 * @property {string} [finishedTime]
 * @property {Record<string, unknown>} [raw]
 */
`;
  
  // Add MppsInput typedef near the top after other typedefs
  content = content.replace(
    /(\/\*\* @typedef \{import\("\.\.\/types\/http\.js"\)\.UserId\} UserId \*\/)/,
    `$1\n\n${mppsInputTypedef}`
  );
  
  // Fix normalizePositiveInteger
  content = content.replace(
    /function normalizePositiveInteger\(value, fieldName, \{ required = true \} = \{\}\)/,
    `/**\n * @param {unknown} value\n * @param {string} fieldName\n * @param {{ required?: boolean }} [options]\n * @returns {number | null}\n */\nfunction normalizePositiveInteger(value, fieldName, { required = true } = {})`
  );
  
  // Fix normalizeOptionalText
  content = content.replace(
    /function normalizeOptionalText\(value\)/,
    `/**\n * @param {unknown} value\n * @returns {string}\n */\nfunction normalizeOptionalText(value)`
  );
  
  // Fix normalizeBooleanFlag
  content = content.replace(
    /function normalizeBooleanFlag\(value, fieldName\)/,
    `/**\n * @param {unknown} value\n * @param {string} fieldName\n * @returns {boolean}\n */\nfunction normalizeBooleanFlag(value, fieldName)`
  );
  
  // Fix normalizeIpAddress
  content = content.replace(
    /function normalizeIpAddress\(value, fieldName\)/,
    `/**\n * @param {unknown} value\n * @param {string} fieldName\n * @returns {string}\n */\nfunction normalizeIpAddress(value, fieldName)`
  );
  
  // Fix normalizeDateForDicom
  content = content.replace(
    /function normalizeDateForDicom\(value\)/,
    `/**\n * @param {unknown} value\n * @returns {string}\n */\nfunction normalizeDateForDicom(value)`
  );
  
  // Fix normalizeTimeForDicom
  content = content.replace(
    /function normalizeTimeForDicom\(value, fallback = "080000"\)/,
    `/**\n * @param {unknown} value\n * @param {string} [fallback]\n * @returns {string}\n */\nfunction normalizeTimeForDicom(value, fallback = "080000")`
  );
  
  // Fix normalizeSexForDicom
  content = content.replace(
    /function normalizeSexForDicom\(value\)/,
    `/**\n * @param {unknown} value\n * @returns {string}\n */\nfunction normalizeSexForDicom(value)`
  );
  
  // Fix normalizeQrOrAccession
  content = content.replace(
    /function normalizeQrOrAccession\(scanValue\)/,
    `/**\n * @param {unknown} scanValue\n * @returns {string}\n */\nfunction normalizeQrOrAccession(scanValue)`
  );
  
  // Fix toAbsolutePath
  content = content.replace(
    /function toAbsolutePath\(value, fallback\)/,
    `/**\n * @param {unknown} value\n * @param {string} fallback\n * @returns {string}\n */\nfunction toAbsolutePath(value, fallback)`
  );
  
  // Fix sanitizeFileToken
  content = content.replace(
    /function sanitizeFileToken\(value, fallback = "unknown"\)/,
    `/**\n * @param {unknown} value\n * @param {string} [fallback]\n * @returns {string}\n */\nfunction sanitizeFileToken(value, fallback = "unknown")`
  );
  
  // Fix formatDicomPersonName
  content = content.replace(
    /function formatDicomPersonName\(englishName, arabicName\)/,
    `/**\n * @param {string} englishName\n * @param {string} arabicName\n * @returns {string}\n */\nfunction formatDicomPersonName(englishName, arabicName)`
  );
  
  // Fix formatDicomString
  content = content.replace(
    /function formatDicomString\(value, fallback = ""\)/,
    `/**\n * @param {unknown} value\n * @param {string} [fallback]\n * @returns {string}\n */\nfunction formatDicomString(value, fallback = "")`
  );
  
  // Fix quoteDicomValue
  content = content.replace(
    /function quoteDicomValue\(value\)/,
    `/**\n * @param {unknown} value\n * @returns {string}\n */\nfunction quoteDicomValue(value)`
  );
  
  // Fix buildSequenceDump
  content = content.replace(
    /function buildSequenceDump\(tag, lines\)/,
    `/**\n * @param {string} tag\n * @param {string[]} lines\n * @returns {string}\n */\nfunction buildSequenceDump(tag, lines)`
  );
  
  // Fix mapAppointmentToScheduledProcedureStepStatus
  content = content.replace(
    /function mapAppointmentToScheduledProcedureStepStatus\(status\)/,
    `/**\n * @param {string} status\n * @returns {string}\n */\nfunction mapAppointmentToScheduledProcedureStepStatus(status)`
  );
  
  // Fix parseDicomTimestamp
  content = content.replace(
    /function parseDicomTimestamp\(dateValue, timeValue\)/,
    `/**\n * @param {string} dateValue\n * @param {string} timeValue\n * @returns {string | null}\n */\nfunction parseDicomTimestamp(dateValue, timeValue)`
  );
  
  // Fix loadSettingsMap
  content = content.replace(
    /async function loadSettingsMap\(categories\)/,
    `/**\n * @param {string[]} categories\n * @returns {Promise<Record<string, string>>}\n */\nasync function loadSettingsMap(categories)`
  );
  
  // Fix listDevicesForModality
  content = content.replace(
    /async function listDevicesForModality\(client, modalityId\)/,
    `/**\n * @param {import("pg").Pool | import("pg").PoolClient} client\n * @param {number | string} modalityId\n * @returns {Promise<DicomDeviceRow[]>}\n */\nasync function listDevicesForModality(client, modalityId)`
  );
  
  // Fix getAppointmentWorklistContext
  content = content.replace(
    /async function getAppointmentWorklistContext\(client, appointmentId\)/,
    `/**\n * @param {import("pg").Pool | import("pg").PoolClient} client\n * @param {number | string} appointmentId\n * @returns {Promise<WorklistContextRow>}\n */\nasync function getAppointmentWorklistContext(client, appointmentId)`
  );
  
  // Fix removeMatchingFiles
  content = content.replace(
    /async function removeMatchingFiles\(directory, prefix\)/,
    `/**\n * @param {string} directory\n * @param {string} prefix\n * @returns {Promise<void>}\n */\nasync function removeMatchingFiles(directory, prefix)`
  );
  
  // Fix error.code check
  content = content.replace(
    /if \(error\.code !== "ENOENT"\)/g,
    `if (/** @type {NodeJS.ErrnoException} */ (error).code !== "ENOENT")`
  );
  
  // Fix buildWorklistDump
  content = content.replace(
    /function buildWorklistDump\(\{ appointment, device \}\)/,
    `/**\n * @param {{ appointment: WorklistContextRow, device: DicomDeviceRow }} params\n * @returns {string}\n */\nfunction buildWorklistDump({ appointment, device })`
  );
  
  // Fix scheduledProcedureStepDescription
  content = content.replace(
    /function scheduledProcedureStepDescription\(appointment\)/,
    `/**\n * @param {WorklistContextRow} appointment\n * @returns {string}\n */\nfunction scheduledProcedureStepDescription(appointment)`
  );
  
  // Fix buildWorklistManifest
  content = content.replace(
    /function buildWorklistManifest\(\{ appointment, device \}\)/,
    `/**\n * @param {{ appointment: WorklistContextRow, device: DicomDeviceRow }} params\n * @returns {Record<string, string>}\n */\nfunction buildWorklistManifest({ appointment, device })`
  );
  
  // Fix ensureDicomGatewayLayout - make it accept the settings object
  content = content.replace(
    /async function ensureDicomGatewayLayout\(_settings\)/,
    `/**\n * @param {GatewaySettings | null | undefined} [_settings]\n * @returns {Promise<void>}\n */\nasync function ensureDicomGatewayLayout(_settings)`
  );
  
  // Fix updateDicomMessageLog
  content = content.replace(
    /async function updateDicomMessageLog\(client, logId, patch\)/,
    `/**\n * @param {import("pg").Pool | import("pg").PoolClient} client\n * @param {number | string} logId\n * @param {Record<string, unknown>} patch\n * @returns {Promise<void>}\n */\nasync function updateDicomMessageLog(client, logId, patch)`
  );
  
  // Fix findDicomDevice
  content = content.replace(
    /async function findDicomDevice\(client, \{ remoteAeTitle, performedStationAeTitle, sourceIp \}\)/,
    `/**\n * @param {import("pg").Pool | import("pg").PoolClient} client\n * @param {{ remoteAeTitle?: string, performedStationAeTitle?: string, sourceIp?: string }} params\n * @returns {Promise<DicomDeviceRow | null>}\n */\nasync function findDicomDevice(client, { remoteAeTitle, performedStationAeTitle, sourceIp })`
  );
  
  // Fix findAppointmentForMpps
  content = content.replace(
    /async function findAppointmentForMpps\(client, \{ accessionNumber, mppsSopInstanceUid \}\)/,
    `/**\n * @param {import("pg").Pool | import("pg").PoolClient} client\n * @param {{ accessionNumber: string, mppsSopInstanceUid: string }} params\n * @returns {Promise<MppsAppointmentRow | null>}\n */\nasync function findAppointmentForMpps(client, { accessionNumber, mppsSopInstanceUid })`
  );
  
  // Fix updateAppointmentFromMpps
  content = content.replace(
    /async function updateAppointmentFromMpps\(client, appointment, device, payload\)/,
    `/**\n * @param {import("pg").Pool | import("pg").PoolClient} client\n * @param {MppsAppointmentRow} appointment\n * @param {DicomDeviceRow} device\n * @param {MppsPayload} payload\n * @returns {Promise<void>}\n */\nasync function updateAppointmentFromMpps(client, appointment, device, payload)`
  );
  
  // Fix createDicomDevice
  content = content.replace(
    /export async function createDicomDevice\(payload, currentUserId\)/,
    `/**\n * @param {UnknownRecord} payload\n * @param {UserId} currentUserId\n * @returns {Promise<DicomDeviceRow>}\n */\nexport async function createDicomDevice(payload, currentUserId)`
  );
  
  // Fix updateDicomDevice
  content = content.replace(
    /export async function updateDicomDevice\(deviceId, payload, currentUserId\)/,
    `/**\n * @param {number | string} deviceId\n * @param {UnknownRecord} payload\n * @param {UserId} currentUserId\n * @returns {Promise<DicomDeviceRow>}\n */\nexport async function updateDicomDevice(deviceId, payload, currentUserId)`
  );
  
  // Fix deleteDicomDevice
  content = content.replace(
    /export async function deleteDicomDevice\(deviceId, currentUserId\)/,
    `/**\n * @param {number | string} deviceId\n * @param {UserId} currentUserId\n * @returns {Promise<void>}\n */\nexport async function deleteDicomDevice(deviceId, currentUserId)`
  );
  
  // Fix syncAppointmentWorklistSources
  content = content.replace(
    /export async function syncAppointmentWorklistSources\(appointmentId\)/,
    `/**\n * @param {number | string} appointmentId\n * @returns {Promise<void>}\n */\nexport async function syncAppointmentWorklistSources(appointmentId)`
  );
  
  // Fix resolveScanValueToAccession
  content = content.replace(
    /export async function resolveScanValueToAccession\(scanValue, accessionNumber\)/,
    `/**\n * @param {unknown} scanValue\n * @param {unknown} accessionNumber\n * @returns {Promise<string>}\n */\nexport async function resolveScanValueToAccession(scanValue, accessionNumber)`
  );
  
  // Fix ingestMppsEvent
  content = content.replace(
    /export async function ingestMppsEvent\(payload\)/,
    `/**\n * @param {UnknownRecord} payload\n * @returns {Promise<void>}\n */\nexport async function ingestMppsEvent(payload)`
  );
  
  // Fix parseMppsTimestamp
  content = content.replace(
    /export function parseMppsTimestamp\(dateValue, timeValue\)/,
    `/**\n * @param {string} dateValue\n * @param {string} timeValue\n * @returns {string | null}\n */\nexport function parseMppsTimestamp(dateValue, timeValue)`
  );
  
  // Fix createGatewayCallbackToken
  content = content.replace(
    /export function createGatewayCallbackToken\(secret\)/,
    `/**\n * @param {string} secret\n * @returns {string}\n */\nexport function createGatewayCallbackToken(secret)`
  );
  
  // Fix normalizeSexForDicom index access
  content = content.replace(
    /return fallbackMap\[raw\.toLowerCase\(\)\] \|\| "";/,
    `return fallbackMap[/** @type {keyof typeof fallbackMap} */ (raw.toLowerCase())] || "";`
  );
  
  // Fix MppsInput property access - add type assertion
  content = content.replace(
    /normalizeOptionalText\(input\./g,
    `normalizeOptionalText((/** @type {MppsInput} */ (input)).`
  );
  
  content = content.replace(
    /String\(input\.mppsStatus \|\| ""\)/g,
    `String((/** @type {MppsInput} */ (input)).mppsStatus || "")`
  );
  
  content = content.replace(
    /parseDicomTimestamp\(input\.startedDate, input\.startedTime\)/g,
    `parseDicomTimestamp((/** @type {MppsInput} */ (input)).startedDate || "", (/** @type {MppsInput} */ (input)).startedTime || "")`
  );
  
  content = content.replace(
    /parseDicomTimestamp\(input\.finishedDate, input\.finishedTime\)/g,
    `parseDicomTimestamp((/** @type {MppsInput} */ (input)).finishedDate || "", (/** @type {MppsInput} */ (input)).finishedTime || "")`
  );
  
  content = content.replace(
    /input\.raw \|\| \{\}/g,
    `(/** @type {MppsInput} */ (input)).raw || {}`
  );
  
  // Add GatewaySettings typedef
  const gatewaySettingsTypedef = `/**
 * @typedef GatewaySettings
 * @property {boolean} enabled
 * @property {string} bindHost
 * @property {string} mwlAeTitle
 * @property {number} mwlPort
 * @property {string} mppsAeTitle
 * @property {number} mppsPort
 * @property {string} worklistOutputDir
 * @property {string} worklistSourceDir
 * @property {string} mppsInboxDir
 * @property {string} [logDir]
 * @property {string} [dcmCommand]
 * @property {string} [dcmdumpCommand]
 */
`;
  
  content = content.replace(
    /(\/\*\* @typedef MppsInput)/,
    `${gatewaySettingsTypedef}\n$1`
  );
  
  return content;
}

function fixPacsService(content) {
  // Fix runDimseFindScu
  content = content.replace(
    /async function runDimseFindScu\(\{ criteria, host, port, calledAeTitle, callingAeTitle, timeoutSeconds \}\)/,
    `/**\n * @param {{ criteria: Record<string, unknown>, host: string, port: number, calledAeTitle: string, callingAeTitle: string, timeoutSeconds: number }} params\n * @returns {Promise<PacsFindResult[]>}\n */\nasync function runDimseFindScu({ criteria, host, port, calledAeTitle, callingAeTitle, timeoutSeconds })`
  );
  
  // Fix runDimseEchoScu
  content = content.replace(
    /async function runDimseEchoScu\(\{ host, port, calledAeTitle, callingAeTitle, timeoutSeconds \}\)/,
    `/**\n * @param {{ host: string, port: number, calledAeTitle: string, callingAeTitle: string, timeoutSeconds: number }} params\n * @returns {Promise<boolean>}\n */\nasync function runDimseEchoScu({ host, port, calledAeTitle, callingAeTitle, timeoutSeconds })`
  );
  
  return content;
}

function fixDocumentService(content) {
  // Fix Buffer.from issue
  content = content.replace(
    /return Buffer\.from\(normalized, "base64"\);/,
    `return Buffer.from(normalized || "", "base64");`
  );
  
  return content;
}

function fixIntegrationService(content) {
  // Fix UserId | undefined issue
  content = content.replace(
    /await getAppointmentSummary\(payload\.appointmentId\)/,
    `await getAppointmentSummary(payload.appointmentId || "")`
  );
  
  return content;
}

function fixModalityService(content) {
  // Fix scheduleWorklistSync null argument
  content = content.replace(
    /scheduleWorklistSync\(cleanAppointmentId\);/,
    `if (cleanAppointmentId) scheduleWorklistSync(cleanAppointmentId);`
  );
  
  return content;
}

// ============================================
// Main execution
// ============================================

function processFile(filePath) {
  const relativePath = relative(SRC_DIR, filePath);
  
  if (SKIP_FILES.has(relativePath)) {
    console.log(`⏭  Skipping: ${relativePath}`);
    return;
  }
  
  let content = readFileSync(filePath, "utf-8");
  const originalContent = content;
  
  // Apply general fixes
  content = fixUntypedParams(content);
  
  // Apply file-specific fixes
  if (filePath.includes("appointment-service.js")) {
    content = fixAppointmentService(content);
  } else if (filePath.includes("dicom-service.js")) {
    content = fixDicomService(content);
  } else if (filePath.includes("pacs-service.js")) {
    content = fixPacsService(content);
  } else if (filePath.includes("document-service.js")) {
    content = fixDocumentService(content);
  } else if (filePath.includes("integration-service.js")) {
    content = fixIntegrationService(content);
  } else if (filePath.includes("modality-service.js")) {
    content = fixModalityService(content);
  }
  
  if (content !== originalContent) {
    writeFileSync(filePath, content, "utf-8");
    console.log(`✅ Fixed: ${relativePath}`);
  } else {
    console.log(`⏭  No changes: ${relativePath}`);
  }
}

// Process all JS files in src/
function processDirectory(dir) {
  const files = readdirSync(dir);
  
  for (const file of files) {
    const filePath = join(dir, file);
    const stat = statSync(filePath);
    
    if (stat.isDirectory()) {
      processDirectory(filePath);
    } else if (file.endsWith(".js")) {
      processFile(filePath);
    }
  }
}

console.log("🔧 Starting TypeScript error batch fix...\n");
processDirectory(SRC_DIR);
console.log("\n✅ Batch fix complete! Run 'npx tsc --noEmit' to check remaining errors.");
