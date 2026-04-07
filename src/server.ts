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
  try {
    // Auto-seed DICOM gateway defaults if missing (zero-config installation)
    const { seedDicomGatewayDefaultsIfMissing } = await import("./services/dicom-settings-resolver.js");
    await seedDicomGatewayDefaultsIfMissing();

    // Auto-create directories and rebuild worklists
    const { ensureDicomGatewayLayout, rebuildAllDicomWorklistSources } = await import("./services/dicom-service.js");
    await ensureDicomGatewayLayout();
    await rebuildAllDicomWorklistSources();

    // Start DICOM MWL/MPPS SCP servers (if native module available)
    const { startDicomGateway } = await import("./services/dicom-gateway-service.js");
    dicomGateway = await startDicomGateway();
  } catch (error) {
    console.error("DICOM gateway initialization failed. Continuing without blocking startup.");
    logError(error);
  }

  server.listen(env.port, () => {
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
