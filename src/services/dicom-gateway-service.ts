import fs from "fs/promises";
import path from "path";
import { pool } from "../db/pool.js";
import { resolveGatewaySettings, detectDicomTools } from "./dicom-settings-resolver.js";
import type { ResolvedGatewaySettings } from "./dicom-settings-resolver.js";

// Lazy-load native DICOM module
let dimse: any = null;

function getDimseModule() {
  if (!dimse) {
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      dimse = require("dicom-dimse-native").default;
    } catch {
      throw new Error("DICOM native module not available");
    }
  }
  return dimse;
}

export interface DicomGatewayServer {
  mwlServer: any;
  mppsServer: any;
  stop(): Promise<void>;
}

export async function startDicomGateway(): Promise<DicomGatewayServer | null> {
  try {
    const settings = await resolveGatewaySettings();

    if (!settings.enabled) {
      console.log("[DICOM Gateway] Disabled in settings. Not starting.");
      return null;
    }

    // Ensure the native module is available
    let dimseModule;
    try {
      dimseModule = getDimseModule();
    } catch {
      console.log("[DICOM Gateway] Native DIMSE module not available. MWL/MPPS SCP servers disabled.");
      return null;
    }

    // Detect tools if not already configured
    const tools = await detectDicomTools();

    if (tools.dump2dcm.detected && tools.dump2dcm.path) {
      await updateSettingIfDifferent("dump2dcm_command", tools.dump2dcm.path);
    }

    if (tools.dcmdump.detected && tools.dcmdump.path) {
      await updateSettingIfDifferent("dcmdump_command", tools.dcmdump.path);
    }

    // Start MWL SCP server
    const mwlServer = startMwlScpServer(settings);

    // Start MPPS SCP server
    const mppsServer = startMppsScpServer(settings);

    console.log(`[DICOM Gateway] MWL SCP listening on ${settings.bindHost}:${settings.mwlPort} (AE: ${settings.mwlAeTitle})`);
    console.log(`[DICOM Gateway] MPPS SCP listening on ${settings.bindHost}:${settings.mppsPort} (AE: ${settings.mppsAeTitle})`);

    return {
      mwlServer,
      mppsServer,
      async stop() {
        try { mwlServer?.shutdown?.(); } catch {}
        try { mppsServer?.shutdown?.(); } catch {}
        console.log("[DICOM Gateway] Servers stopped.");
      }
    };
  } catch (error) {
    console.error("[DICOM Gateway] Failed to start:", error);
    return null;
  }
}

function startMwlScpServer(settings: ResolvedGatewaySettings) {
  const dimseModule = getDimseModule();
  const sourceIp = getLocalIpAddress();
  const worklistDir = settings.worklistOutputDir;

  const options = {
    aet: settings.mwlAeTitle,
    ip: settings.bindHost,
    port: settings.mwlPort,
    dimseTimeout: 30,
    verbose: false,
    onFindRequest: (request: any, callback: (result: any) => void) => {
      handleMwlFindRequest(request, callback, worklistDir);
    }
  };

  dimseModule.findScp(options, (result: any) => {
    if (result?.error) {
      console.error(`[DICOM MWL] Error: ${result.error}`);
    }
  });

  return { shutdown: () => {} }; // dimse-native manages lifecycle internally
}

function startMppsScpServer(settings: ResolvedGatewaySettings) {
  const dimseModule = getDimseModule();

  const options = {
    aet: settings.mppsAeTitle,
    ip: settings.bindHost,
    port: settings.mppsPort,
    dimseTimeout: 30,
    verbose: false
  };

  dimseModule.nsetScp?.(options, (result: any) => {
    if (result?.error) {
      console.error(`[DICOM MPPS] Error: ${result.error}`);
    } else if (result?.dataset) {
      handleMppsNSet(result.dataset, settings);
    }
  });

  // Fallback: if nsetScp is not available, log it
  if (!dimseModule.nsetScp) {
    console.log("[DICOM MPPS] N-SET SCP not available in dicom-dimse-native. MPPS will be processed via file drop only.");
  }

  return { shutdown: () => {} };
}

async function handleMwlFindRequest(request: any, callback: (result: any) => void, worklistDir: string) {
  try {
    const requestDataset = request?.dataset || request;
    const queryPatientName = extractTag(requestDataset, "00100010") || "";
    const queryPatientId = extractTag(requestDataset, "00100020") || "";
    const queryAccession = extractTag(requestDataset, "00080050") || "";
    const queryModality = extractTag(requestDataset, "00080060") || "";
    const queryDate = extractTag(requestDataset, "00400002") || "";

    // Load all worklist files
    const wlFiles = await listWorklistFiles(worklistDir);

    // Match against query
    const matchingFiles = wlFiles.filter((wl) => {
      if (queryPatientId && wl.patientId && !matchWildcard(queryPatientId, wl.patientId)) return false;
      if (queryAccession && wl.accessionNumber && !matchWildcard(queryAccession, wl.accessionNumber)) return false;
      if (queryModality && wl.modality && queryModality !== "*" && !matchWildcard(queryModality, wl.modality)) return false;
      if (queryDate && wl.scheduledDate && !matchWildcard(queryDate, wl.scheduledDate)) return false;
      // Patient name matching is done with wildcards on modality side typically
      if (queryPatientName && wl.patientName && !matchWildcard(queryPatientName, wl.patientName)) return false;
      return true;
    });

    if (matchingFiles.length === 0) {
      callback({ status: "success" });
      return;
    }

    // Return matching worklist entries
    for (const wlFile of matchingFiles) {
      const response = buildMwlResponse(wlFile);
      callback({ status: "pending", dataset: response });
    }

    callback({ status: "success" });
  } catch (error) {
    console.error("[DICOM MWL] Failed to handle find request:", error);
    callback({ status: "failure", error: String(error) });
  }
}

async function listWorklistFiles(directory: string): Promise<Array<Record<string, string>>> {
  try {
    const entries = await fs.readdir(directory, { withFileTypes: true });
    const files = entries.filter((e) => e.isFile() && e.name.endsWith(".wl"));

    const results: Array<Record<string, string>> = [];

    for (const file of files) {
      try {
        const wlPath = path.join(directory, file.name);
        const content = await fs.readFile(wlPath, "utf8");

        // Try to parse as JSON first (if stored as JSON manifest)
        if (content.trim().startsWith("{")) {
          const json = JSON.parse(content);
          results.push({
            patientId: json.patientId || json.patientMrn || "",
            patientName: json.patientNameEnglish || json.patientNameArabic || "",
            accessionNumber: json.accessionNumber || "",
            modality: json.modalityCode || "",
            scheduledDate: json.appointmentDate?.slice(0, 10)?.replace(/-/g, "") || ""
          });
        } else {
          // Parse DICOM dump format
          const patientId = extractDumpField(content, "(0010,0020)") || extractDumpField(content, "(0010,0021)");
          const patientName = extractDumpField(content, "(0010,0010)");
          const accessionNumber = extractDumpField(content, "(0008,0050)");
          const modality = extractDumpField(content, "(0008,0060)");
          const scheduledDate = extractDumpField(content, "(0040,0002)");

          results.push({
            patientId: cleanDumpValue(patientName),
            patientName: cleanDumpValue(patientName),
            accessionNumber: cleanDumpValue(accessionNumber),
            modality: cleanDumpValue(modality),
            scheduledDate: cleanDumpValue(scheduledDate)
          });
        }
      } catch {
        // Skip files we can't read
      }
    }

    return results;
  } catch {
    return [];
  }
}

function buildMwlResponse(wlData: Record<string, string>) {
  return {
    "00080050": wlData.accessionNumber || "",
    "00100010": wlData.patientName || "",
    "00100020": wlData.patientId || "",
    "00100021": wlData.patientId || "",
    "00100030": "",
    "00100040": "",
    "00080060": wlData.modality || "",
    "00400002": wlData.scheduledDate || "",
    "00400003": "",
    "00400100": buildScheduledProcedureStepSequence(wlData)
  };
}

function buildScheduledProcedureStepSequence(wlData: Record<string, string>) {
  return {
    vr: "SQ",
    items: [{
      "00080060": { vr: "CS", Value: [wlData.modality || ""] },
      "00400001": { vr: "AE", Value: ["RISPRO_MWL"] },
      "00400002": { vr: "DA", Value: [wlData.scheduledDate || ""] },
      "00400003": { vr: "TM", Value: ["080000"] },
      "00400006": { vr: "PN", Value: [""] },
      "00400007": { vr: "LO", Value: ["Scheduled procedure step"] },
      "00400009": { vr: "SH", Value: [wlData.accessionNumber || ""] },
      "00400010": { vr: "SH", Value: [""] },
      "00400011": { vr: "SH", Value: [""] },
      "00400020": { vr: "CS", Value: ["SCHEDULED"] }
    }]
  };
}

async function handleMppsNSet(dataset: any, settings: ResolvedGatewaySettings) {
  try {
    // Extract MPPS data from the N-SET request
    const accessionNumber = extractTag(dataset, "00080050") || "";
    const mppsStatus = extractTag(dataset, "00400252") || "";
    const startedDate = extractTag(dataset, "00400244") || "";
    const startedTime = extractTag(dataset, "00400245") || "";
    const finishedDate = extractTag(dataset, "00400250") || "";
    const finishedTime = extractTag(dataset, "00400251") || "";

    if (!accessionNumber || !mppsStatus) {
      console.log("[DICOM MPPS] Skipping incomplete MPPS N-SET");
      return;
    }

    // Call the existing MPPS endpoint
    const baseUrl = `http://127.0.0.1:${process.env.PORT || 3000}`;
    const response = await fetch(`${baseUrl}/api/integrations/dicom/mpps-event`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Rispro-Dicom-Secret": settings.callbackSecret
      },
      body: JSON.stringify({
        sourcePath: "mpps-nset-scp",
        accessionNumber,
        mppsStatus: mppsStatus.toUpperCase(),
        startedDate,
        startedTime,
        finishedDate,
        finishedTime
      })
    });

    if (response.ok) {
      console.log(`[DICOM MPPS] Processed N-SET for accession ${accessionNumber} (${mppsStatus})`);
    } else {
      console.error(`[DICOM MPPS] Failed to process N-SET for accession ${accessionNumber}: ${response.status}`);
    }
  } catch (error) {
    console.error("[DICOM MPPS] Error handling N-SET:", error);
  }
}

function extractTag(dataset: any, tag: string): string {
  if (!dataset || typeof dataset !== "object") return "";
  const value = dataset[tag];
  if (typeof value === "string") return value;
  if (value?.Value?.[0]) return String(value.Value[0]);
  if (Array.isArray(value) && value[0]) return String(value[0]);
  return "";
}

function extractDumpField(content: string, tag: string): string {
  const lines = content.split("\n");
  const tagLower = tag.toLowerCase();

  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.toLowerCase().startsWith(tagLower)) {
      const match = trimmed.match(/\[(.*?)\]/);
      return match ? match[1] : "";
    }
  }

  return "";
}

function cleanDumpValue(value: string | undefined): string {
  if (!value) return "";
  return value.replace(/^"|"$/g, "").trim();
}

function matchWildcard(pattern: string, value: string): boolean {
  if (!pattern || pattern === "*" || pattern === value) return true;

  // Convert DICOM wildcard pattern to regex
  const regexPattern = pattern
    .replace(/[.+?^${}()|[\]\\]/g, "\\$&") // Escape regex special chars
    .replace(/\*/g, ".*") // * matches anything
    .replace(/\?/g, "."); // ? matches single char

  const regex = new RegExp(`^${regexPattern}$`, "i");
  return regex.test(value);
}

function getLocalIpAddress(): string {
  const os = require("os");
  const interfaces = os.networkInterfaces();

  for (const name of Object.keys(interfaces)) {
    for (const iface of interfaces[name]) {
      if (iface.family === "IPv4" && !iface.internal) {
        return iface.address;
      }
    }
  }

  return "127.0.0.1";
}

async function updateSettingIfDifferent(key: string, newValue: string): Promise<void> {
  try {
    const { rows } = await pool.query(
      `select setting_value->>'value' as current_value from system_settings where category = 'dicom_gateway' and setting_key = $1 limit 1`,
      [key]
    );

    const currentValue = rows[0]?.current_value || "";

    if (currentValue !== newValue) {
      await pool.query(
        `update system_settings set setting_value = $2::jsonb where category = 'dicom_gateway' and setting_key = $1`,
        [key, JSON.stringify({ value: newValue })]
      );
      console.log(`[DICOM Gateway] Updated ${key} to ${newValue}`);
    }
  } catch (error) {
    console.error(`[DICOM Gateway] Failed to update ${key}:`, error);
  }
}
