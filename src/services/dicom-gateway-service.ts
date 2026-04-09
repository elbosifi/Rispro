import fs from "fs/promises";
import path from "path";
import net from "net";
import { spawn, type ChildProcess } from "child_process";
import { fileURLToPath } from "url";
import { pool } from "../db/pool.js";
import { resolveGatewaySettings, detectDicomTools } from "./dicom-settings-resolver.js";
import type { ResolvedGatewaySettings } from "./dicom-settings-resolver.js";
import {
  getServiceProcess,
  getServiceServer,
  getServiceStatus,
  setServiceError,
  setServiceProcess,
  setServiceStatus
} from "./dicom-gateway-registry.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const scriptsDir = path.resolve(__dirname, "..", "..", "scripts", "dicom-gateway");
type ManagedServiceName = "mwl" | "worklistBuilder";

export interface DicomGatewayServer {
  stop(): Promise<void>;
}

export async function startDicomGateway(): Promise<DicomGatewayServer | null> {
  try {
    const settings = await resolveGatewaySettings();
    const backendPort = Number(process.env.PORT || 3000) || 3000;
    const baseUrl = `http://127.0.0.1:${backendPort}`;

    if (!settings.enabled) {
      console.log("[DICOM Gateway] Disabled in settings. Not starting.");
      return null;
    }

    // Detect tools
    const tools = await detectDicomTools();

    if (tools.dump2dcm.detected && tools.dump2dcm.path) {
      await updateSettingIfDifferent("dump2dcm_command", tools.dump2dcm.path);
    }

    if (await isPortInUse(settings.bindHost, settings.mwlPort)) {
      console.log(
        `[DICOM Gateway] MWL port ${settings.bindHost}:${settings.mwlPort} is already in use. Skipping embedded gateway startup.`
      );
      return null;
    }

    const startedProcesses: Array<{ serviceName: ManagedServiceName; process: ChildProcess }> = [];
    const server: DicomGatewayServer = {
      async stop() {
        await stopManagedProcess("mwl");
        await stopManagedProcess("worklistBuilder");
      }
    };

    // wlmscpfs is the DCMTK worklist SCP that serves .wl files from a directory.
    const wlmscpfsPath = await findBinary("wlmscpfs");

    if (!wlmscpfsPath) {
      console.log("[DICOM Gateway] wlmscpfs not found. MWL SCP server disabled.");
      console.log("[DICOM Gateway] Ensure the source-built DCMTK toolchain is present in the image.");
      return null;
    }

    // Start MWL SCP server using wlmscpfs.
    const mwlProcess = await startMwlScpServer(settings, wlmscpfsPath);

    if (mwlProcess) {
      startedProcesses.push({ serviceName: "mwl", process: mwlProcess });
      console.log(`[DICOM Gateway] MWL SCP running on ${settings.bindHost}:${settings.mwlPort} (AE: ${settings.mwlAeTitle})`);
      console.log(`[DICOM Gateway] Serving worklists from: ${settings.worklistOutputDir}`);
    }

    if (tools.dump2dcm.detected && tools.dump2dcm.path) {
      const worklistBuilderProcess = await startNodeWorker("worklistBuilder", "build-worklists.mjs", {
        RISPRO_BASE_URL: baseUrl
      });
      if (worklistBuilderProcess) {
        startedProcesses.push({ serviceName: "worklistBuilder", process: worklistBuilderProcess });
        console.log("[DICOM Gateway] Worklist builder started.");
      }
    } else {
      console.log("[DICOM Gateway] dump2dcm not detected. Worklist builder disabled.");
    }

    // Register the server object so shutdown can stop all child processes.
    for (const entry of startedProcesses) {
      setServiceProcess(entry.serviceName, entry.process, server);
    }

    return server;
  } catch (error) {
    console.error("[DICOM Gateway] Failed to start:", error);
    setServiceError("mwl", error instanceof Error ? error.message : String(error));
    return null;
  }
}

export async function restartDicomGateway(): Promise<DicomGatewayServer | null> {
  console.log("[DICOM Gateway] Restarting MWL SCP server...");
  setServiceStatus("mwl", "stopping");

  const server = getServiceServer("mwl");
  if (server) {
    await server.stop();
  }

  const existingProcess = getServiceProcess("mwl");
  if (existingProcess) {
    existingProcess.kill("SIGKILL");
  }

  setServiceStatus("mwl", "starting");

  try {
    const newServer = await startDicomGateway();
    return newServer;
  } catch (error) {
    setServiceError("mwl", error instanceof Error ? error.message : String(error));
    throw error;
  }
}

export async function stopDicomGateway(): Promise<void> {
  console.log("[DICOM Gateway] Stopping MWL SCP server...");
  setServiceStatus("mwl", "stopping");

  const server = getServiceServer("mwl");
  if (server) {
    await server.stop();
    setServiceProcess("mwl", null, null);
    console.log("[DICOM Gateway] MWL SCP stopped successfully.");
  } else {
    console.log("[DICOM Gateway] MWL SCP was not running.");
    setServiceStatus("mwl", "stopped");
  }
}

async function startMwlScpServer(settings: ResolvedGatewaySettings, wlmscpfsPath: string): Promise<ChildProcess | null> {
  try {
    const aeSpecificDir = getWorklistAeOutputDir(settings.worklistOutputDir, settings.mwlAeTitle);

    // Create the AE-specific subdirectory with lockfile.
    await ensureWorklistAeDirectory(aeSpecificDir);

    // wlmscpfs serves the AE-specific subdirectory from the parent worklist directory.
    // Keep the parent directory layout so the caller AE resolves to RISPRO_MWL/.
    const args = ["-dfp", settings.worklistOutputDir, String(settings.mwlPort)];

    console.log(`[DICOM MWL] Parent worklist dir: ${settings.worklistOutputDir}`);
    console.log(`[DICOM MWL] MWL AE title: ${settings.mwlAeTitle}`);

    const proc = spawn(wlmscpfsPath, args, {
      env: { ...process.env },
      stdio: ["ignore", "pipe", "pipe"]
    });

    proc.stdout?.on("data", (data: Buffer) => {
      const line = data.toString().trim();
      if (line) {
        console.log(`[DICOM MWL] ${line}`);
      }
    });

    proc.stderr?.on("data", (data: Buffer) => {
      const line = data.toString().trim();
      if (line && !line.includes("Association Accepted") && !line.includes("Sending Store Response")) {
        console.error(`[DICOM MWL] ${line}`);
      }
    });

    proc.on("error", (error) => {
      console.error("[DICOM MWL] Process error:", error.message);
    });

    proc.on("exit", (code, signal) => {
      console.log(`[DICOM MWL] Process exited with code ${code} (signal: ${signal})`);
    });

    return proc;
  } catch (error) {
    console.error("[DICOM MWL] Failed to start wlmscpfs:", error);
    return null;
  }
}

function getWorklistAeOutputDir(worklistOutputDir: string, aeTitle: string): string {
  return path.join(worklistOutputDir, aeTitle);
}

async function ensureWorklistAeDirectory(directory: string): Promise<void> {
  await fs.mkdir(directory, { recursive: true });
  await fs.writeFile(path.join(directory, "lockfile"), "", "utf8");
}

async function isPortInUse(host: string, port: number): Promise<boolean> {
  return await new Promise<boolean>((resolve) => {
    const tester = net.createServer();

    tester.unref();
    tester.once("error", () => resolve(true));
    tester.once("listening", () => {
      tester.close(() => resolve(false));
    });

    tester.listen({ host, port, exclusive: true });
  });
}

async function startNodeWorker(
  serviceName: "worklistBuilder",
  scriptFileName: "build-worklists.mjs",
  envOverrides: Record<string, string>
): Promise<ChildProcess | null> {
  try {
    const scriptPath = path.join(scriptsDir, scriptFileName);
    const proc = spawn(process.execPath, [scriptPath], {
      env: { ...process.env, ...envOverrides },
      stdio: ["ignore", "pipe", "pipe"]
    });

    proc.stdout?.on("data", (data: Buffer) => {
      const line = data.toString().trim();
      if (line) {
        console.log(`[DICOM ${serviceName}] ${line}`);
      }
    });

    proc.stderr?.on("data", (data: Buffer) => {
      const line = data.toString().trim();
      if (line) {
        console.error(`[DICOM ${serviceName}] ${line}`);
      }
    });

    proc.on("error", (error) => {
      console.error(`[DICOM ${serviceName}] Process error:`, error.message);
    });

    proc.on("exit", (code, signal) => {
      console.log(`[DICOM ${serviceName}] Process exited with code ${code} (signal: ${signal})`);
      if (getServiceStatus(serviceName).status !== "stopping") {
        if (code === 0 || signal === "SIGTERM" || signal === "SIGKILL") {
          setServiceStatus(serviceName, "stopped");
        } else {
          setServiceError(serviceName, `Exited with code ${code} (signal: ${signal})`);
        }
      }
    });

    return proc;
  } catch (error) {
    console.error(`[DICOM ${serviceName}] Failed to start worker:`, error);
    return null;
  }
}

async function findBinary(name: string): Promise<string | null> {
  try {
    const { exec } = await import("child_process");
    const { promisify } = await import("util");
    const execAsync = promisify(exec);

    const whichCmd = process.platform === "win32" ? "where" : "which";
    const { stdout } = await execAsync(`${whichCmd} ${name}`);
    return stdout.trim() || null;
  } catch {
    return null;
  }
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

async function stopManagedProcess(serviceName: ManagedServiceName): Promise<void> {
  const process = getServiceProcess(serviceName);

  if (!process) {
    setServiceStatus(serviceName, "stopped");
    return;
  }

  setServiceStatus(serviceName, "stopping");
  process.kill("SIGTERM");

  await new Promise<void>((resolve) => {
    const timeout = setTimeout(() => {
      process.kill("SIGKILL");
      resolve();
    }, 5000);

    process.once("exit", () => {
      clearTimeout(timeout);
      resolve();
    });
  });

  setServiceProcess(serviceName, null, null);
}

// ---------------------------------------------------------------------------
// C-ECHO smoke test for MWL SCP
// ---------------------------------------------------------------------------

/**
 * Runs a DICOM C-ECHO against the local MWL SCP to verify it is responding.
 * Returns true on success, false on failure.
 */
export async function verifyMwlScpWithEcho(
  settings: ResolvedGatewaySettings,
  maxRetries = 10,
  retryDelayMs = 1000
): Promise<boolean> {
  const echoscuPath = await findBinary("echoscu");
  if (!echoscuPath) {
    console.log("[DICOM MWL] echoscu not found. Skipping C-ECHO verification.");
    return false;
  }

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      const { exec } = await import("child_process");
      const { promisify } = await import("util");
      const execAsync = promisify(exec);

      await execAsync(
        `${echoscuPath} -v -aec ${settings.mwlAeTitle} ${settings.bindHost} ${settings.mwlPort}`,
        { timeout: 5000 }
      );
      console.log(`[DICOM MWL] C-ECHO verification passed on attempt ${attempt}/${maxRetries}.`);
      return true;
    } catch (error) {
      if (attempt < maxRetries) {
        console.log(`[DICOM MWL] C-ECHO attempt ${attempt}/${maxRetries} failed, retrying in ${retryDelayMs}ms...`);
        await new Promise((r) => setTimeout(r, retryDelayMs));
      } else {
        console.error("[DICOM MWL] C-ECHO verification failed after all retries. Modalities may not connect.");
        console.error("[DICOM MWL] Check that wlmscpfs is running and the worklist directory structure is correct.");
      }
    }
  }

  return false;
}
