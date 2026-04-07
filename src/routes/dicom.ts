import express, { Request, Response } from "express";
import { requireAuth, requireSupervisor, requireRecentSupervisorReauth } from "../middleware/auth.js";
import { asyncRoute } from "../utils/async-route.js";
import { asUnknownRecord } from "../utils/records.js";
import { HttpError } from "../utils/http-error.js";
import { pool } from "../db/pool.js";
import {
  getDicomGatewaySettings,
  getDicomGatewayOverview,
  rebuildAllDicomWorklistSources,
  syncAppointmentWorklistSources,
  ingestMppsEvent,
  buildMppsEventPayload,
  listDicomDevices
} from "../services/dicom-service.js";
import {
  resolveGatewaySettings,
  seedDicomGatewayDefaultsIfMissing,
  ensureDicomDirectoriesExist,
  detectDicomTools,
  checkDirectoryHealth
} from "../services/dicom-settings-resolver.js";
import {
  startDicomGateway,
  stopDicomGateway,
  restartDicomGateway
} from "../services/dicom-gateway-service.js";
import {
  getAllServiceStatuses,
  getServiceStatus
} from "../services/dicom-gateway-registry.js";
import { normalizeOptionalText } from "../utils/normalize.js";
import fs from "fs/promises";
import type { AuthenticatedUserContext, UnknownRecord, UserId } from "../types/http.js";

export const dicomRouter = express.Router();

// All routes require authentication and supervisor role
dicomRouter.use(requireAuth, requireSupervisor, requireRecentSupervisorReauth);

// ---------------------------------------------------------------------------
// Overview & Status
// ---------------------------------------------------------------------------

dicomRouter.get(
  "/overview",
  asyncRoute(async (_req: Request, res: Response) => {
    const [settings, overview, tools, fileHealth, serviceStatuses] = await Promise.all([
      resolveGatewaySettings(),
      getDicomGatewayOverview(),
      detectDicomTools(),
      checkDirectoryHealth(await resolveGatewaySettings()),
      Promise.resolve(getAllServiceStatuses())
    ]);

    const devices = await listDicomDevices();
    const devicesWithMwl = devices.filter((d) => d.mwl_enabled && d.is_active);
    const devicesWithMpps = devices.filter((d) => d.mpps_enabled && d.is_active);

    res.json({
      settings: {
        enabled: settings.enabled,
        bindHost: settings.bindHost,
        mwlAeTitle: settings.mwlAeTitle,
        mwlPort: settings.mwlPort,
        mppsAeTitle: settings.mppsAeTitle,
        mppsPort: settings.mppsPort,
        rebuildBehavior: settings.rebuildBehavior
      },
      status: {
        gatewayEnabled: settings.enabled,
        directoriesReady: Object.values(fileHealth).every(
          (v) => typeof v === "object" && v !== null && "exists" in v ? v.exists : true
        ),
        toolsDetected: tools.dump2dcm.detected && tools.dcmdump.detected,
        deviceCount: devices.length,
        mwlEnabledDeviceCount: devicesWithMwl.length,
        mppsEnabledDeviceCount: devicesWithMpps.length
      },
      services: serviceStatuses,
      tools,
      fileHealth,
      logSummary: overview.logSummary,
      deviceSummary: {
        total: devices.length,
        active: devices.filter((d) => d.is_active).length,
        mwlEnabled: devicesWithMwl.length,
        mppsEnabled: devicesWithMpps.length,
        devices: devices.map((d) => ({
          id: d.id,
          modalityCode: d.modality_code,
          modalityNameEn: d.modality_name_en,
          deviceName: d.device_name,
          mwlEnabled: d.mwl_enabled,
          mppsEnabled: d.mpps_enabled,
          isActive: d.is_active
        }))
      }
    });
  })
);

// ---------------------------------------------------------------------------
// Service Status & Control
// ---------------------------------------------------------------------------

dicomRouter.get(
  "/service-status",
  asyncRoute(async (_req: Request, res: Response) => {
    const services = getAllServiceStatuses();
    res.json({ services });
  })
);

dicomRouter.post(
  "/service/:serviceName/start",
  asyncRoute(async (req: Request, res: Response) => {
    const { serviceName } = req.params;

    if (!["mwl", "mpps", "worklistBuilder", "mppsProcessor"].includes(serviceName)) {
      throw new HttpError(400, `Unknown service: ${serviceName}`);
    }

    if (serviceName === "mwl") {
      const server = await startDicomGateway();
      if (!server) {
        throw new HttpError(500, "Failed to start DICOM gateway service");
      }
    } else {
      throw new HttpError(501, `Service ${serviceName} start not implemented yet`);
    }

    const status = getServiceStatus(serviceName as any);
    res.json({ ok: true, service: serviceName, status });
  })
);

dicomRouter.post(
  "/service/:serviceName/stop",
  asyncRoute(async (req: Request, res: Response) => {
    const { serviceName } = req.params;

    if (!["mwl", "mpps", "worklistBuilder", "mppsProcessor"].includes(serviceName)) {
      throw new HttpError(400, `Unknown service: ${serviceName}`);
    }

    if (serviceName === "mwl") {
      await stopDicomGateway();
    } else {
      throw new HttpError(501, `Service ${serviceName} stop not implemented yet`);
    }

    const status = getServiceStatus(serviceName as any);
    res.json({ ok: true, service: serviceName, status });
  })
);

dicomRouter.post(
  "/service/:serviceName/restart",
  asyncRoute(async (req: Request, res: Response) => {
    const { serviceName } = req.params;

    if (!["mwl", "mpps", "worklistBuilder", "mppsProcessor"].includes(serviceName)) {
      throw new HttpError(400, `Unknown service: ${serviceName}`);
    }

    if (serviceName === "mwl") {
      const server = await restartDicomGateway();
      if (!server) {
        throw new HttpError(500, "Failed to restart DICOM gateway service");
      }
    } else {
      throw new HttpError(501, `Service ${serviceName} restart not implemented yet`);
    }

    const status = getServiceStatus(serviceName as any);
    res.json({ ok: true, service: serviceName, status });
  })
);

// ---------------------------------------------------------------------------
// Logs
// ---------------------------------------------------------------------------

dicomRouter.get(
  "/logs",
  asyncRoute(async (req: Request, res: Response) => {
    const query = req.query as Record<string, string | undefined>;
    const limit = Math.min(parseInt(query.limit || "50", 10) || 50, 200);
    const status = query.status;
    const accession = query.accession;
    const device = query.device;
    const eventType = query.eventType;

    const whereClauses: string[] = [];
    const params: unknown[] = [];

    if (status) {
      params.push(status);
      whereClauses.push(`processing_status = $${params.length}`);
    }

    if (accession) {
      params.push(`%${accession}%`);
      whereClauses.push(`accession_number ILIKE $${params.length}`);
    }

    if (device) {
      params.push(parseInt(device, 10));
      whereClauses.push(`device_id = $${params.length}`);
    }

    if (eventType) {
      params.push(eventType);
      whereClauses.push(`event_type = $${params.length}`);
    }

    const whereSql = whereClauses.length > 0 ? `where ${whereClauses.join(" and ")}` : "";

    const { rows } = await pool.query(
      `
        select
          dicom_message_log.*,
          dicom_devices.device_name as device_name,
          dicom_devices.modality_ae_title as device_ae_title
        from dicom_message_log
        left join dicom_devices on dicom_devices.id = dicom_message_log.device_id
        ${whereSql}
        order by dicom_message_log.created_at desc
        limit $${params.length + 1}
      `,
      [...params, limit]
    );

    res.json({ logs: rows, limit });
  })
);

// ---------------------------------------------------------------------------
// Rebuild Operations
// ---------------------------------------------------------------------------

dicomRouter.post(
  "/rebuild",
  asyncRoute(async (_req: Request, res: Response) => {
    const result = await rebuildAllDicomWorklistSources();
    res.json({ ok: true, count: result.count, message: `Rebuilt ${result.count} worklist(s).` });
  })
);

dicomRouter.post(
  "/rebuild/:appointmentId",
  asyncRoute(async (req: Request, res: Response) => {
    const appointmentId = parseInt(req.params.appointmentId, 10);

    if (isNaN(appointmentId) || appointmentId <= 0) {
      throw new HttpError(400, "Invalid appointment ID.");
    }

    const result = await syncAppointmentWorklistSources(appointmentId);
    res.json({
      ok: true,
      files: result.files?.length || 0,
      message: result.removedOnly ? "Worklist artifacts removed." : `Generated ${result.files?.length || 0} worklist file(s).`
    });
  })
);

// ---------------------------------------------------------------------------
// Test Operations
// ---------------------------------------------------------------------------

dicomRouter.post(
  "/test-mpps",
  asyncRoute(async (req: Request, res: Response) => {
    const body = asUnknownRecord(req.body);
    const payload = buildMppsEventPayload({
      sourcePath: "test-mpps-synthetic",
      sourceIp: "127.0.0.1",
      remoteAeTitle: String(body.remoteAeTitle || "TEST_MWL").toUpperCase(),
      performedStationAeTitle: String(body.performedStationAeTitle || "TEST_STATION").toUpperCase(),
      accessionNumber: normalizeOptionalText(body.accessionNumber),
      mppsSopInstanceUid: normalizeOptionalText(body.mppsSopInstanceUid) || `1.2.840.10008.${Date.now()}.1`,
      mppsStatus: String(body.mppsStatus || "IN PROGRESS").toUpperCase(),
      startedAt: body.startedAt ? new Date(body.startedAt as string).toISOString() : new Date().toISOString(),
      finishedAt: body.finishedAt ? new Date(body.finishedAt as string).toISOString() : null,
      raw: body
    });

    const result = await ingestMppsEvent(payload);

    if (!result.ok) {
      res.status(202).json({ ok: false, reason: result.reason, message: "MPPS event processed but did not match any appointment." });
      return;
    }

    res.json({ ok: true, message: "Test MPPS event processed successfully.", appointment: result.appointment });
  })
);

dicomRouter.post(
  "/test-worklist/:appointmentId",
  asyncRoute(async (req: Request, res: Response) => {
    const appointmentId = parseInt(req.params.appointmentId, 10);

    if (isNaN(appointmentId) || appointmentId <= 0) {
      throw new HttpError(400, "Invalid appointment ID.");
    }

    const result = await syncAppointmentWorklistSources(appointmentId);

    res.json({
      ok: result.ok,
      files: result.files?.map((f) => ({
        deviceId: f.deviceId,
        manifestPath: f.manifestPath,
        dumpPath: f.dumpPath
      })) || [],
      removedOnly: result.removedOnly,
      message: result.removedOnly
        ? "Appointment is not active or has no devices. Worklist artifacts removed."
        : `Generated ${result.files?.length || 0} worklist file(s).`
    });
  })
);

// ---------------------------------------------------------------------------
// Tool Detection & Validation
// ---------------------------------------------------------------------------

dicomRouter.post(
  "/detect-tools",
  asyncRoute(async (_req: Request, res: Response) => {
    const tools = await detectDicomTools();

    // Update settings if tools detected
    const updates: Array<{ key: string; value: { value: string } }> = [];

    if (tools.dump2dcm.detected && tools.dump2dcm.path) {
      updates.push({ key: "dump2dcm_command", value: { value: tools.dump2dcm.path } });
    }

    if (tools.dcmdump.detected && tools.dcmdump.path) {
      updates.push({ key: "dcmdump_command", value: { value: tools.dcmdump.path } });
    }

    if (updates.length > 0) {
      const client = await pool.connect();

      try {
        await client.query("begin");

        for (const update of updates) {
          await client.query(
            `
              update system_settings
              set setting_value = $2::jsonb, updated_at = now()
              where category = 'dicom_gateway' and setting_key = $1
            `,
            [update.key, JSON.stringify(update.value)]
          );
        }

        await client.query("commit");
      } catch (error) {
        await client.query("rollback");
        throw error;
      } finally {
        client.release();
      }
    }

    res.json({
      ok: true,
      tools,
      updated: updates.map((u) => u.key),
      message: updates.length > 0
        ? "Tools detected and settings updated."
        : "Tools not found in PATH. Configure manually in settings."
    });
  })
);

dicomRouter.post(
  "/validate-settings",
  asyncRoute(async (req: Request, res: Response) => {
    const body = asUnknownRecord(req.body);
    const errors: string[] = [];
    const warnings: string[] = [];

    // Validate ports
    const mwlPort = parseInt(String(body.mwl_port || ""), 10);
    const mppsPort = parseInt(String(body.mpps_port || ""), 10);

    if (isNaN(mwlPort) || mwlPort < 1 || mwlPort > 65535) {
      errors.push("MWL port must be a number between 1 and 65535.");
    }

    if (isNaN(mppsPort) || mppsPort < 1 || mppsPort > 65535) {
      errors.push("MPPS port must be a number between 1 and 65535.");
    }

    // Validate AE titles
    const mwlAeTitle = String(body.mwl_ae_title || "").trim();
    const mppsAeTitle = String(body.mpps_ae_title || "").trim();

    if (mwlAeTitle && (mwlAeTitle.length > 16 || !/^[A-Z0-9_]+$/.test(mwlAeTitle))) {
      errors.push("MWL AE title must be uppercase alphanumeric (max 16 characters).");
    }

    if (mppsAeTitle && (mppsAeTitle.length > 16 || !/^[A-Z0-9_]+$/.test(mppsAeTitle))) {
      errors.push("MPPS AE title must be uppercase alphanumeric (max 16 characters).");
    }

    // Validate directories
    const dirs = ["worklist_source_dir", "worklist_output_dir", "mpps_inbox_dir", "mpps_processed_dir", "mpps_failed_dir"];

    for (const dirKey of dirs) {
      const dirPath = String(body[dirKey] || "").trim();

      if (dirPath) {
        try {
          await fs.access(dirPath, fs.constants.W_OK);
        } catch {
          warnings.push(`Directory ${dirKey} is not writable: ${dirPath}`);
        }
      }
    }

    // Check device conflicts
    const devices = await listDicomDevices({ includeInactive: false });
    const aeTitleConflicts = new Map<string, number>();

    for (const device of devices) {
      const key = `${device.modality_ae_title}-${device.scheduled_station_ae_title}`;

      if (aeTitleConflicts.has(key)) {
        warnings.push(`Device conflict: ${device.device_name} and device #${aeTitleConflicts.get(key)} have overlapping AE titles.`);
      } else {
        aeTitleConflicts.set(key, device.id);
      }
    }

    res.json({
      valid: errors.length === 0,
      errors,
      warnings
    });
  })
);

// ---------------------------------------------------------------------------
// Secret Rotation
// ---------------------------------------------------------------------------

dicomRouter.post(
  "/rotate-secret",
  asyncRoute(async (req: Request, res: Response) => {
    const request = req as { user: AuthenticatedUserContext };
    const { randomBytes } = await import("crypto");
    const newSecret = randomBytes(32).toString("hex");

    await pool.query(
      `
        update system_settings
        set setting_value = $2::jsonb, updated_at = now()
        where category = 'dicom_gateway' and setting_key = 'callback_secret'
      `,
      [JSON.stringify({ value: newSecret })]
    );

    res.json({ ok: true, message: "Callback secret rotated successfully." });
  })
);

// ---------------------------------------------------------------------------
// Reset to Defaults
// ---------------------------------------------------------------------------

dicomRouter.post(
  "/reset-defaults",
  asyncRoute(async (_req: Request, res: Response) => {
    await seedDicomGatewayDefaultsIfMissing();
    const settings = await resolveGatewaySettings();
    await ensureDicomDirectoriesExist(settings);

    res.json({ ok: true, message: "DICOM gateway settings reset to defaults." });
  })
);

// ---------------------------------------------------------------------------
// File Health Check
// ---------------------------------------------------------------------------

dicomRouter.get(
  "/file-health",
  asyncRoute(async (_req: Request, res: Response) => {
    const settings = await resolveGatewaySettings();
    const health = await checkDirectoryHealth(settings);
    res.json(health);
  })
);
