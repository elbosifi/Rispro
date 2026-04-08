import fs from "fs/promises";
import { spawn, type ChildProcess } from "child_process";
import { pool } from "../db/pool.js";
import { resolveGatewaySettings, detectDicomTools } from "./dicom-settings-resolver.js";
import type { ResolvedGatewaySettings } from "./dicom-settings-resolver.js";
import { setServiceProcess, setServiceError, setServiceStatus, getServiceProcess, getServiceServer } from "./dicom-gateway-registry.js";

export interface DicomGatewayServer {
  stop(): Promise<void>;
}

export async function startDicomGateway(): Promise<DicomGatewayServer | null> {
  try {
    const settings = await resolveGatewaySettings();

    if (!settings.enabled) {
      console.log("[DICOM Gateway] Disabled in settings. Not starting.");
      return null;
    }

    // Detect tools
    const tools = await detectDicomTools();

    if (tools.dump2dcm.detected && tools.dump2dcm.path) {
      await updateSettingIfDifferent("dump2dcm_command", tools.dump2dcm.path);
    }

    if (tools.dcmdump.detected && tools.dcmdump.path) {
      await updateSettingIfDifferent("dcmdump_command", tools.dcmdump.path);
    }

    // wlmscpfs is the DCMTK worklist SCP that serves .wl files from a directory.
    const wlmscpfsPath = await findBinary("wlmscpfs");

    if (!wlmscpfsPath) {
      console.log("[DICOM Gateway] wlmscpfs not found. MWL SCP server disabled.");
      console.log("[DICOM Gateway] Install DCMTK: apt-get install -y dcmtk");
      return null;
    }

    // Start MWL SCP server using wlmscpfs
    const mwlProcess = await startMwlScpServer(settings, wlmscpfsPath);

    if (mwlProcess) {
      console.log(`[DICOM Gateway] MWL SCP running on ${settings.bindHost}:${settings.mwlPort} (AE: ${settings.mwlAeTitle})`);
      console.log(`[DICOM Gateway] Serving worklists from: ${settings.worklistOutputDir}`);
    }

    const server: DicomGatewayServer = {
      async stop() {
        if (mwlProcess) {
          mwlProcess.kill("SIGTERM");
          console.log("[DICOM Gateway] MWL SCP stopped.");
        }
      }
    };

    // Register in service registry
    setServiceProcess("mwl", mwlProcess, server);

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
    // wlmscpfs reads worklist files directly from the output directory.
    await fs.mkdir(settings.worklistOutputDir, { recursive: true });

    // Start wlmscpfs with the worklist directory and configured port.
    const args = ["-dfp", settings.worklistOutputDir, String(settings.mwlPort)];

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
