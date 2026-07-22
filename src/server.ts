import http, { type Server } from "http";
import { env } from "./config/env.js";
import { createApp } from "./app.js";
import { pool } from "./db/pool.js";
import type { DicomGatewayServer } from "./services/dicom-gateway-service.js";
import type { OrthancMwlWorker } from "./services/orthanc-mwl-worker-service.js";
import type { SanteWorklistWorker } from "./services/sante-worklist-worker-service.js";
import type { AppointmentsV2PacsAutoCompletionWorker } from "./services/appointments-v2-pacs-auto-completion-worker.js";
import type { PatientNotificationWorker } from "./services/patient-notification-worker.js";
import type { ReportingBoardBulkAssignmentWorker } from "./services/reporting-board-bulk-assignment-worker.js";
import type { ReportingBoardSonicDicomCacheWorker } from "./services/reporting-board-sonicdicom-cache-worker.js";
import type { NoShowWorker } from "./services/no-show-worker.js";
import type { DicomRemapSendWorker } from "./services/dicom-remap-send-worker.js";
import type { DicomRemapProcessingWorker } from "./services/dicom-remap-processing-worker.js";
import type { OhifRetrievalWorker } from "./modules/ohif-viewer/worker.js";
import type { BackupV3Worker } from "./services/backup-v3-worker.js";
import type { RequestScanWorker } from "./services/request-scan-worker.js";

const app = createApp();
const server: Server = http.createServer(app);
let isShuttingDown = false;
let dicomGateway: DicomGatewayServer | null = null;
let orthancMwlWorker: OrthancMwlWorker | null = null;
let santeWorklistWorker: SanteWorklistWorker | null = null;
let pacsAutoCompletionWorker: AppointmentsV2PacsAutoCompletionWorker | null = null;
let patientNotificationWorker: PatientNotificationWorker | null = null;
let reportingBoardBulkAssignmentWorker: ReportingBoardBulkAssignmentWorker | null = null;
let reportingBoardSonicDicomCacheWorker: ReportingBoardSonicDicomCacheWorker | null = null;
let noShowWorker: NoShowWorker | null = null;
let dicomRemapSendWorker: DicomRemapSendWorker | null = null;
let dicomRemapProcessingWorker: DicomRemapProcessingWorker | null = null;
let ohifRetrievalWorker: OhifRetrievalWorker | null = null;
let backupV3Worker: BackupV3Worker | null = null;
let requestScanWorker: RequestScanWorker | null = null;

function logError(error: unknown): void {
  console.error(error);
}

async function shutdown(signal: "SIGINT" | "SIGTERM"): Promise<void> {
  if (isShuttingDown) {
    return;
  }

  isShuttingDown = true;
  console.log(`Received ${signal}. Shutting down gracefully.`);

  // Stop DICOM gateway servers
  if (dicomGateway) {
    try {
      await dicomGateway.stop();
    } catch (error) {
      console.error("Failed to stop DICOM gateway servers.", error);
    }
  }

  if (orthancMwlWorker) {
    try {
      await orthancMwlWorker.stop();
    } catch (error) {
      console.error("Failed to stop Orthanc MWL worker.", error);
    }
  }

  if (santeWorklistWorker) {
    try {
      await santeWorklistWorker.stop();
    } catch (error) {
      console.error("Failed to stop Sante Worklist HL7 worker.", error);
    }
  }

  if (pacsAutoCompletionWorker) {
    try {
      await pacsAutoCompletionWorker.stop();
    } catch (error) {
      console.error("Failed to stop PACS auto-completion worker.", error);
    }
  }

  if (patientNotificationWorker) {
    try {
      await patientNotificationWorker.stop();
    } catch (error) {
      console.error("Failed to stop patient notification worker.", error);
    }
  }

  if (reportingBoardBulkAssignmentWorker) {
    try {
      await reportingBoardBulkAssignmentWorker.stop();
    } catch (error) {
      console.error("Failed to stop Reporting Board bulk assignment worker.", error);
    }
  }
  if (reportingBoardSonicDicomCacheWorker) {
    try { await reportingBoardSonicDicomCacheWorker.stop(); } catch (error) { console.error("Failed to stop Reporting Board SonicDICOM cache worker.", error); }
  }

  if (noShowWorker) {
    try { await noShowWorker.stop(); } catch (error) { console.error("Failed to stop no-show worker.", error); }
  }

  if (dicomRemapSendWorker) {
    try { await dicomRemapSendWorker.stop(); } catch (error) { console.error("Failed to stop DICOM remap send worker.", error); }
  }

  if (dicomRemapProcessingWorker) {
    try { await dicomRemapProcessingWorker.stop(); } catch (error) { console.error("Failed to stop DICOM remap processing worker.", error); }
  }

  if (ohifRetrievalWorker) {
    try { await ohifRetrievalWorker.stop(); } catch (error) { console.error("Failed to stop OHIF retrieval worker.", error); }
  }

  if (backupV3Worker) {
    try { await backupV3Worker.stop(); } catch (error) { console.error("Failed to stop Backup V3 worker.", error); }
  }
  if (requestScanWorker) { try { await requestScanWorker.stop(); } catch (error) { console.error("Failed to stop Request Scan worker.", error); } }

  server.close(async (serverError?: Error) => {
    try {
      await pool.end();
    } catch (poolError) {
      console.error("Failed to close PostgreSQL pool cleanly.");
      logError(poolError);
    }

    if (serverError) {
      console.error("HTTP server shutdown failed.");
      logError(serverError);
      process.exit(1);
    }

    process.exit(0);
  });

  setTimeout(() => {
    console.error("Forced shutdown after timeout.");
    process.exit(1);
  }, 10000).unref();
}

server.on("error", (error: Error) => {
  console.error("Failed to start HTTP server.");
  logError(error);
  process.exit(1);
});

process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));

async function start(): Promise<void> {
  const startupSummary: Record<string, string> = {};

  try {
    // Auto-seed DICOM gateway defaults if missing (zero-config installation)
    const { seedDicomGatewayDefaultsIfMissing } = await import("./services/dicom-settings-resolver.js");
    const { seedOrthancMwlDefaultsIfMissing } = await import("./services/orthanc-settings-resolver.js");
    const { seedSanteWorklistDefaultsIfMissing } = await import("./services/sante-worklist-settings-resolver.js");
    await seedDicomGatewayDefaultsIfMissing();
    await seedOrthancMwlDefaultsIfMissing();
    await seedSanteWorklistDefaultsIfMissing();

    // Auto-create directories and rebuild worklists
    const { ensureDicomGatewayLayout, rebuildAllV2DicomWorklistSources } = await import("./services/dicom-service.js");
    await ensureDicomGatewayLayout();
    await rebuildAllV2DicomWorklistSources();

    if (process.env.RISPRO_DISABLE_EMBEDDED_DICOM_GATEWAY === "1") {
      console.log("Embedded DICOM gateway disabled by environment. Skipping in-process gateway startup.");
      startupSummary.dicom_gateway = "disabled_by_env";
    } else {
      // Start DICOM gateway services (MWL SCP and MWL worklist builder)
      const { startDicomGateway, verifyMwlScpWithEcho } = await import("./services/dicom-gateway-service.js");
      dicomGateway = await startDicomGateway();

      // Give wlmscpfs a moment to initialize, then verify with C-ECHO
      if (dicomGateway) {
        await new Promise((r) => setTimeout(r, 2000));
        const { resolveGatewaySettings } = await import("./services/dicom-settings-resolver.js");
        const settings = await resolveGatewaySettings();
        await verifyMwlScpWithEcho(settings);
      }
    }
  } catch (error) {
    console.error("DICOM gateway initialization failed. Continuing without blocking startup.");
    logError(error);
    startupSummary.dicom_gateway = "initialization_failed";
  }

  try {
    const { startNoShowWorker } = await import("./services/no-show-worker.js");
    noShowWorker = await startNoShowWorker();
    startupSummary.no_show_worker = "started";
  } catch (error) {
    console.error("No-show worker initialization failed. Continuing without blocking startup.");
    logError(error);
    startupSummary.no_show_worker = "initialization_failed";
  }

  try {
    const { startBackupV3Worker } = await import("./services/backup-v3-worker.js");
    backupV3Worker = await startBackupV3Worker();
    startupSummary.backup_v3_worker = "started";
  } catch (error) {
    console.error("Backup V3 worker initialization failed. Continuing without blocking startup.");
    logError(error);
    startupSummary.backup_v3_worker = "initialization_failed";
  }

  try {
    const { startRequestScanWorker } = await import("./services/request-scan-worker.js");
    requestScanWorker = await startRequestScanWorker();
    startupSummary.request_scan_worker = "started";
  } catch (error) {
    console.error("Request Scan worker initialization failed. Continuing without blocking startup.");
    logError(error);
    startupSummary.request_scan_worker = "initialization_failed";
  }

  try {
    const { startDicomRemapProcessingWorker } = await import("./services/dicom-remap-processing-worker.js");
    dicomRemapProcessingWorker = await startDicomRemapProcessingWorker();
    startupSummary.dicom_remap_processing_worker = "started";
  } catch (error) {
    console.error("DICOM remap processing worker initialization failed. Continuing without blocking startup.");
    logError(error);
    startupSummary.dicom_remap_processing_worker = "initialization_failed";
  }

  try {
    const { startDicomRemapSendWorker } = await import("./services/dicom-remap-send-worker.js");
    dicomRemapSendWorker = await startDicomRemapSendWorker();
    startupSummary.dicom_remap_send_worker = "started";
  } catch (error) {
    console.error("DICOM remap send worker initialization failed. Continuing without blocking startup.");
    logError(error);
    startupSummary.dicom_remap_send_worker = "initialization_failed";
  }

  try {
    const { startOrthancMwlWorker } = await import("./services/orthanc-mwl-worker-service.js");
    const { resolveOrthancSettings } = await import("./services/orthanc-settings-resolver.js");
    const orthancSettings = await resolveOrthancSettings();
    orthancMwlWorker = await startOrthancMwlWorker();
    if (orthancSettings.enabled) {
      startupSummary.orthanc_mwl = orthancSettings.shadowMode ? "enabled_shadow_mode" : "enabled_primary_mode";
    } else {
      startupSummary.orthanc_mwl = "disabled";
    }
  } catch (error) {
    console.error("Orthanc MWL worker initialization failed. Continuing without blocking startup.");
    logError(error);
    startupSummary.orthanc_mwl = "initialization_failed";
  }

  try {
    const { startSanteWorklistWorker } = await import("./services/sante-worklist-worker-service.js");
    const { resolveSanteWorklistSettings } = await import("./services/sante-worklist-settings-resolver.js");
    const santeSettings = await resolveSanteWorklistSettings();
    santeWorklistWorker = await startSanteWorklistWorker();
    startupSummary.sante_hl7 = santeSettings.enabled ? `enabled_${santeSettings.mode}` : "disabled";
  } catch (error) {
    console.error("Sante HL7 file-drop worker initialization failed. Continuing without blocking startup.");
    logError(error);
    startupSummary.sante_hl7 = "initialization_failed";
  }

  try {
    const { startAppointmentsV2PacsAutoCompletionWorker } = await import("./services/appointments-v2-pacs-auto-completion-worker.js");
    pacsAutoCompletionWorker = await startAppointmentsV2PacsAutoCompletionWorker();
    startupSummary.pacs_auto_completion = "enabled";
  } catch (error) {
    console.error("PACS auto-completion worker initialization failed. Continuing without blocking startup.");
    logError(error);
    startupSummary.pacs_auto_completion = "initialization_failed";
  }

  try {
    const { startPatientNotificationWorker } = await import("./services/patient-notification-worker.js");
    patientNotificationWorker = await startPatientNotificationWorker();
    startupSummary.patient_notifications = "started";
  } catch (error) {
    if (env.webPushEnabled) {
      console.error("Patient Web Push worker initialization failed while WEB_PUSH_ENABLED=true.");
      throw error;
    }
    console.error("Patient Web Push worker initialization failed. Continuing; patient Web Push can be reconfigured from settings.");
    logError(error);
    startupSummary.patient_notifications = "initialization_failed";
  }

  try {
    const { startReportingBoardBulkAssignmentWorker } = await import("./services/reporting-board-bulk-assignment-worker.js");
    reportingBoardBulkAssignmentWorker = await startReportingBoardBulkAssignmentWorker();
    startupSummary.reporting_board_bulk_assignments = "started";
  } catch (error) {
    console.error("Reporting Board bulk assignment worker initialization failed. Continuing without blocking startup.");
    logError(error);
    startupSummary.reporting_board_bulk_assignments = "initialization_failed";
  }

  try {
    const { startReportingBoardSonicDicomCacheWorker } = await import("./services/reporting-board-sonicdicom-cache-worker.js");
    reportingBoardSonicDicomCacheWorker = await startReportingBoardSonicDicomCacheWorker();
    startupSummary.reporting_board_sonicdicom_cache = "started";
  } catch (error) {
    console.error("Reporting Board SonicDICOM cache worker initialization failed. Continuing without blocking startup.");
    logError(error);
    startupSummary.reporting_board_sonicdicom_cache = "initialization_failed";
  }

  if (process.env.RISPRO_E2E === "1") {
    startupSummary.orthanc_pacs_modalities = "disabled_by_e2e";
  } else {
    try {
      const { syncStoredOrthancRemoteModalitiesToOrthanc } = await import("./services/orthanc-pacs-service.js");
      const result = await syncStoredOrthancRemoteModalitiesToOrthanc();
      startupSummary.orthanc_pacs_modalities = `synced_${result.synced}`;
    } catch (error) {
      console.warn("Orthanc PACS modality sync failed. Continuing startup.");
      logError(error);
      startupSummary.orthanc_pacs_modalities = "sync_failed";
    }
  }

  if (env.ohifEnabled) {
    try {
      const { startOhifRetrievalWorker } = await import("./modules/ohif-viewer/worker.js");
      ohifRetrievalWorker = await startOhifRetrievalWorker({ intervalMs: env.ohifRetrievalWorkerIntervalMs });
      startupSummary.ohif_viewer = "enabled";
    } catch (error) {
      console.error("OHIF retrieval worker initialization failed. Continuing with OHIF unavailable.");
      logError(error);
      startupSummary.ohif_viewer = "initialization_failed";
    }
  } else {
    startupSummary.ohif_viewer = "disabled";
  }

  server.listen(env.port, async () => {
    // Print startup summary
    console.log("");
    console.log("========================================");
    console.log("  NCCB Diagnostic Radiology - Startup Summary");
    console.log("========================================");
    console.log(`  Backend:        http://localhost:${env.port}`);
    console.log(`  Environment:    ${env.nodeEnv}`);
    console.log(`  Database:       ${env.databaseUrl.split("@")[1]?.split("/")[0] || "configured"}`);
    console.log(`  Deploy Modes:   DB=${env.risproDbMode} DICOM=${env.risproDicomMode} MPPS=${env.risproMppsMode}`);

    // DICOM Gateway status
    const { getAllServiceStatuses } = await import("./services/dicom-gateway-registry.js");
    const { resolveGatewaySettings } = await import("./services/dicom-settings-resolver.js");
    const services = getAllServiceStatuses();
    const settings = await resolveGatewaySettings();

    console.log("");
    console.log("  DICOM Services:");

    if (startupSummary.dicom_gateway === "disabled_by_env") {
      console.log("    MWL SCP:        disabled_by_env");
      console.log("    Worklist Bldr:  disabled_by_env");
    } else if (services.mwl?.status === "running") {
      console.log(`    MWL SCP:        running (${settings.mwlAeTitle} @ ${settings.bindHost}:${settings.mwlPort})`);
      console.log(`    Worklist Bldr:  ${services.worklistBuilder?.status === "running" ? "running" : "disabled_missing_tool"}`);
      console.log(`    Worklist Dir:   ${settings.worklistOutputDir}`);
    } else {
      console.log("    MWL SCP:        disabled_or_failed");
      console.log("    Worklist Bldr:  disabled_or_failed");
    }

    console.log("");
    console.log("  Orthanc MWL:");
    console.log(`    Mode:           ${startupSummary.orthanc_mwl || "disabled"}`);
    const { resolveOrthancSettings } = await import("./services/orthanc-settings-resolver.js");
    const orthancSettings = await resolveOrthancSettings().catch(() => null);
    if (orthancSettings?.enabled) {
      console.log(`    Base URL:       ${orthancSettings.baseUrl || "(unset)"}`);
    }

    console.log("");
    console.log("  Sante Worklist HL7:");
    console.log(`    Worker:         ${startupSummary.sante_hl7 || "disabled"}`);

    console.log("");
    console.log("  Backup V3:");
    console.log(`    Worker:         ${startupSummary.backup_v3_worker || "disabled"}`);

    console.log("");
    console.log("  Request Scan Automation:");
    console.log(`    Worker:         ${startupSummary.request_scan_worker || "disabled"}`);

    console.log("");
    console.log("  PACS Auto-Completion:");
    console.log(`    Worker:         ${startupSummary.pacs_auto_completion || "disabled"}`);

    console.log("");
    console.log("  Reporting Board SonicDICOM Cache:");
    console.log(`    Worker:         ${startupSummary.reporting_board_sonicdicom_cache || "disabled"}`);

    console.log("");
    console.log("  OHIF Viewer:");
    console.log(`    Mode:           ${startupSummary.ohif_viewer || "disabled"}`);

    console.log("");
    console.log("  Patient Web Push:");
    console.log(`    Worker:         ${startupSummary.patient_notifications || "disabled"}`);
    console.log(`    Modalities:     ${startupSummary.orthanc_pacs_modalities || "not_synced"}`);

    if (env.risproMppsMode === "internal_bridge") {
      console.log("");
      console.log("  MPPS Bridge:");
      console.log(`    AE Title:       ${env.mppsBridgeAeTitle}`);
      console.log(`    Port:           ${env.mppsBridgePort}`);
    }

    console.log("========================================");
    console.log("");
    console.log(`RISpro backend listening on http://localhost:${env.port}`);
  });
}

start().catch(async (error: unknown) => {
  console.error("RISpro failed to start.");
  logError(error);

  try {
    await pool.end();
  } catch (poolError) {
    console.error("Failed to close PostgreSQL pool after startup error.");
    logError(poolError);
  }

  process.exit(1);
});
