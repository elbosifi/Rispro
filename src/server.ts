import http, { type Server } from "http";
import { env } from "./config/env.js";
import { createApp } from "./app.js";
import { pool } from "./db/pool.js";
import type { DicomGatewayServer } from "./services/dicom-gateway-service.js";

const app = createApp();
const server: Server = http.createServer(app);
let isShuttingDown = false;
let dicomGateway: DicomGatewayServer | null = null;

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
    await seedDicomGatewayDefaultsIfMissing();

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

  server.listen(env.port, async () => {
    // Print startup summary
    console.log("");
    console.log("========================================");
    console.log("  RISpro Reception - Startup Summary");
    console.log("========================================");
    console.log(`  Backend:        http://localhost:${env.port}`);
    console.log(`  Environment:    ${env.nodeEnv}`);
    console.log(`  Database:       ${env.databaseUrl.split("@")[1]?.split("/")[0] || "configured"}`);

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
