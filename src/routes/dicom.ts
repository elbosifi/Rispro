import express, { Request, Response } from "express";
import * as crypto from "crypto";
import { requireAuth, requireSupervisor, requireRecentSupervisorReauth } from "../middleware/auth.js";
import { asyncRoute } from "../utils/async-route.js";
import { asUnknownRecord } from "../utils/records.js";
import { HttpError } from "../utils/http-error.js";
import { pool } from "../db/pool.js";
import { env } from "../config/env.js";
import {
  getDicomGatewayOverview,
  rebuildAllV2DicomWorklistSources,
  syncBookingWorklistSources,
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
  getOrthancMwlSyncSummary,
  reconcileOrthancMwlProjection,
  resetOrthancMwlWindow
} from "../services/orthanc-mwl-reconcile-service.js";
import { enqueueOrthancSyncForBooking } from "../services/mwl-sync-service.js";
import {
  getSanteHl7Summary,
  forceResyncSanteHl7Window,
  reconcileSanteHl7Window,
  retrySanteOutbox,
  sendSyntheticSanteTestFile,
} from "../services/sante-hl7-outbox-service.js";
import { getWorklistMonitorEntries } from "../services/worklist-monitor-service.js";
import { logAuditEntry } from "../services/audit-service.js";
import { resolveSanteWorklistSettings, testSanteOutputFolderAccess } from "../services/sante-worklist-settings-resolver.js";
import {
  getAllServiceStatuses,
  getServiceStatus
} from "../services/dicom-gateway-registry.js";
import { ingestMppsEvent } from "../services/mpps-service.js";
import fs from "fs/promises";
import type { AuthenticatedUserContext, UserId } from "../types/http.js";

export const dicomRouter = express.Router();

function requireSuperAdminUser(request: Request & { user?: AuthenticatedUserContext }): void {
  if (request.user?.role !== "super_admin") {
    throw new HttpError(403, "Super admin access required for this action.");
  }
}

function hasValidInternalMppsSecret(req: Request): boolean {
  const provided = String(req.headers["x-rispro-mpps-secret"] || "");
  const expected = String(env.jwtSecret || "");

  if (!provided || !expected) {
    return false;
  }

  const providedBuffer = Buffer.from(provided);
  const expectedBuffer = Buffer.from(expected);
  if (providedBuffer.length !== expectedBuffer.length) {
    return false;
  }

  return crypto.timingSafeEqual(providedBuffer, expectedBuffer);
}

dicomRouter.post(
  "/mpps/events",
  asyncRoute(async (req: Request, res: Response) => {
    if (!hasValidInternalMppsSecret(req)) {
      throw new HttpError(401, "Invalid internal MPPS secret.");
    }

    const body = asUnknownRecord(req.body);
    const result = await ingestMppsEvent(body);
    res.status(202).json({ ok: true, result });
  })
);

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

    res.json({
      settings: {
        enabled: settings.enabled,
        bindHost: settings.bindHost,
        mwlAeTitle: settings.mwlAeTitle,
        mwlPort: settings.mwlPort,
        rebuildBehavior: settings.rebuildBehavior
      },
      status: {
        gatewayEnabled: settings.enabled,
        gatewayStatus: serviceStatuses.mwl?.status || (settings.enabled ? "starting" : "stopped"),
        gatewayPid: serviceStatuses.mwl?.pid || null,
        gatewayLastError: serviceStatuses.mwl?.lastError || null,
        directoriesReady: Object.values(fileHealth).every(
          (v) => typeof v === "object" && v !== null && "exists" in v ? v.exists : true
        ),
        toolsDetected: tools.dump2dcm.detected && tools.dcmdump.detected,
        deviceCount: devices.length,
        mwlEnabledDeviceCount: devicesWithMwl.length
      },
      services: serviceStatuses,
      tools,
      fileHealth,
      logSummary: overview.logSummary,
      deviceSummary: {
        total: devices.length,
        active: devices.filter((d) => d.is_active).length,
        mwlEnabled: devicesWithMwl.length,
        devices: devices.map((d) => ({
          id: d.id,
          modalityCode: d.modality_code,
          modalityNameEn: d.modality_name_en,
          deviceName: d.device_name,
          mwlEnabled: d.mwl_enabled,
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

dicomRouter.get(
  "/orthanc-sync/summary",
  asyncRoute(async (_req: Request, res: Response) => {
    const summary = await getOrthancMwlSyncSummary();
    res.json({ ok: true, summary });
  })
);

dicomRouter.get(
  "/worklist-monitor/entries",
  asyncRoute(async (req: Request, res: Response) => {
    const result = await getWorklistMonitorEntries(req.query as Record<string, unknown>);
    res.json({ ok: true, ...result });
  })
);

dicomRouter.post(
  "/orthanc-sync/reconcile",
  asyncRoute(async (req: Request, res: Response) => {
    const request = req as Request & { user: AuthenticatedUserContext };
    const body = asUnknownRecord(req.body);
    const dateFrom = String(body.dateFrom || "").trim();
    const dateTo = String(body.dateTo || "").trim();
    const apply = String(body.apply || "").trim().toLowerCase() === "true" || body.apply === true;
    const limitRaw = Number(body.limit);
    const limit = Number.isInteger(limitRaw) && limitRaw > 0 ? limitRaw : 5000;

    if (!dateFrom || !dateTo) {
      throw new HttpError(400, "dateFrom and dateTo are required (YYYY-MM-DD).");
    }
    if (apply) {
      requireSuperAdminUser(request);
    }

    const result = await reconcileOrthancMwlProjection({
      dateFrom,
      dateTo,
      apply,
      limit
    });

    await logAuditEntry({
      entityType: "orthanc_mwl",
      actionType: apply ? "reconcile_apply" : "reconcile_dry_run",
      newValues: { dateFrom, dateTo, apply, limit, result },
      changedByUserId: request.user.sub as UserId,
    });

    res.json({ ok: true, result });
  })
);

dicomRouter.post(
  "/orthanc-sync/reset-window",
  asyncRoute(async (req: Request, res: Response) => {
    const request = req as Request & { user: AuthenticatedUserContext };
    requireSuperAdminUser(request);
    const body = asUnknownRecord(req.body);
    const dateFrom = String(body.dateFrom || "").trim();
    const dateTo = String(body.dateTo || "").trim();
    const limitRaw = Number(body.limit);
    const limit = Number.isInteger(limitRaw) && limitRaw > 0 ? limitRaw : 5000;

    if (!dateFrom || !dateTo) {
      throw new HttpError(400, "dateFrom and dateTo are required (YYYY-MM-DD).");
    }

    const result = await resetOrthancMwlWindow({
      dateFrom,
      dateTo,
      limit,
    });

    await logAuditEntry({
      entityType: "orthanc_mwl",
      actionType: "reset_window",
      newValues: { dateFrom, dateTo, limit, result },
      changedByUserId: request.user.sub as UserId,
    });

    res.json({ ok: true, result });
  })
);

dicomRouter.post(
  "/orthanc-sync/retry/:bookingId",
  asyncRoute(async (req: Request, res: Response) => {
    const request = req as Request & { user: AuthenticatedUserContext };
    const bookingId = Number(req.params.bookingId);
    if (!Number.isInteger(bookingId) || bookingId <= 0) {
      throw new HttpError(400, "bookingId must be a positive integer.");
    }
    const result = await enqueueOrthancSyncForBooking(bookingId);
    await logAuditEntry({
      entityType: "orthanc_mwl",
      entityId: bookingId as UserId,
      actionType: "retry_booking",
      newValues: result,
      changedByUserId: request.user.sub as UserId,
    });
    res.json({ ok: true, result });
  })
);

dicomRouter.get(
  "/sante-hl7/summary",
  asyncRoute(async (_req: Request, res: Response) => {
    const summary = await getSanteHl7Summary();
    res.json({ ok: true, summary });
  })
);

dicomRouter.post(
  "/sante-hl7/test-folder",
  asyncRoute(async (req: Request, res: Response) => {
    const settings = await resolveSanteWorklistSettings();
    if (settings.deliveryMethod !== "file_drop") {
      throw new HttpError(400, "Sante HL7 test folder is only available for file_drop delivery.");
    }
    const body = asUnknownRecord(req.body ?? {});
    const result = await testSanteOutputFolderAccess(String(body.outputFolderPath || "").trim());
    res.json(result);
  })
);

dicomRouter.post(
  "/sante-hl7/test-file",
  asyncRoute(async (req: Request, res: Response) => {
    const request = req as Request & { user: AuthenticatedUserContext };
    const result = await sendSyntheticSanteTestFile(request.user.sub as UserId);
    res.status(202).json({ ok: true, synthetic: true, ...result });
  })
);

dicomRouter.post(
  "/sante-hl7/retry/:outboxId",
  asyncRoute(async (req: Request, res: Response) => {
    const request = req as Request & { user: AuthenticatedUserContext };
    const outboxId = Number(req.params.outboxId);
    const result = await retrySanteOutbox(outboxId, request.user.sub as UserId);
    res.json(result);
  })
);

dicomRouter.post(
  "/sante-hl7/reconcile",
  asyncRoute(async (req: Request, res: Response) => {
    const request = req as Request & { user: AuthenticatedUserContext };
    const body = asUnknownRecord(req.body ?? {});
    const dateFrom = String(body.dateFrom || "").trim();
    const dateTo = String(body.dateTo || "").trim();
    const modalityCode = String(body.modalityCode || "").trim() || undefined;
    const apply = body.apply === true || String(body.apply || "").toLowerCase() === "true";
    const limitRaw = Number(body.limit);
    if (!dateFrom || !dateTo) throw new HttpError(400, "dateFrom and dateTo are required.");
    if (apply) {
      requireSuperAdminUser(request);
    }
    const result = await reconcileSanteHl7Window({
      dateFrom,
      dateTo,
      modalityCode,
      apply,
      limit: Number.isInteger(limitRaw) && limitRaw > 0 ? limitRaw : 5000,
    });
    await logAuditEntry({
      entityType: "integration",
      actionType: apply ? "sante_hl7_reconcile_apply" : "sante_hl7_reconcile_dry_run",
      newValues: { dateFrom, dateTo, modalityCode: modalityCode || null, apply, result },
      changedByUserId: request.user.sub as UserId,
    });
    res.json({ ok: true, result });
  })
);

dicomRouter.post(
  "/sante-hl7/force-resync",
  asyncRoute(async (req: Request, res: Response) => {
    const request = req as Request & { user: AuthenticatedUserContext };
    requireSuperAdminUser(request);
    const body = asUnknownRecord(req.body ?? {});
    const dateFrom = String(body.dateFrom || "").trim();
    const dateTo = String(body.dateTo || "").trim();
    const modalityCode = String(body.modalityCode || "").trim() || undefined;
    const limitRaw = Number(body.limit);
    if (!dateFrom || !dateTo) throw new HttpError(400, "dateFrom and dateTo are required.");
    const result = await forceResyncSanteHl7Window({
      dateFrom,
      dateTo,
      modalityCode,
      limit: Number.isInteger(limitRaw) && limitRaw > 0 ? limitRaw : 5000,
      currentUserId: request.user.sub as UserId,
    });
    res.json({ ok: true, result });
  })
);

dicomRouter.post(
  "/service/:serviceName/start",
  asyncRoute(async (req: Request, res: Response) => {
    const serviceName = String(req.params.serviceName || "");

    if (!["mwl", "worklistBuilder"].includes(serviceName)) {
      throw new HttpError(400, `Unknown service: ${serviceName}`);
    }

    const validServiceName = serviceName as "mwl" | "worklistBuilder";

    if (validServiceName === "mwl") {
      const server = await startDicomGateway();
      if (!server) {
        throw new HttpError(500, "Failed to start DICOM gateway service");
      }
    } else {
      throw new HttpError(501, `Service ${validServiceName} start not implemented yet`);
    }

    const status = getServiceStatus(validServiceName);
    res.json({ ok: true, service: validServiceName, status });
  })
);

dicomRouter.post(
  "/service/:serviceName/stop",
  asyncRoute(async (req: Request, res: Response) => {
    const serviceName = String(req.params.serviceName || "");

    if (!["mwl", "worklistBuilder"].includes(serviceName)) {
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
    const serviceName = String(req.params.serviceName || "");

    if (!["mwl", "worklistBuilder"].includes(serviceName)) {
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
    const result = await rebuildAllV2DicomWorklistSources();
    res.json({ ok: true, count: result.count, message: `Rebuilt ${result.count} booking worklist(s).` });
  })
);

dicomRouter.post(
  "/rebuild/:bookingId",
  asyncRoute(async (req: Request, res: Response) => {
    const bookingId = parseInt(String(req.params.bookingId || ""), 10);

    if (isNaN(bookingId) || bookingId <= 0) {
      throw new HttpError(400, "Invalid booking ID.");
    }

    const result = await syncBookingWorklistSources(bookingId);
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
  "/test-worklist/:bookingId",
  asyncRoute(async (req: Request, res: Response) => {
    const bookingId = parseInt(String(req.params.bookingId || ""), 10);

    if (isNaN(bookingId) || bookingId <= 0) {
      throw new HttpError(400, "Invalid booking ID.");
    }

    const result = await syncBookingWorklistSources(bookingId);

    res.json({
      ok: result.ok,
      files: result.files?.map((f) => ({
        deviceId: f.deviceId,
        manifestPath: f.manifestPath,
        dumpPath: f.dumpPath
      })) || [],
      removedOnly: result.removedOnly,
      message: result.removedOnly
        ? "Booking is not active or has no devices. Worklist artifacts removed."
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

    // Validate MWL port
    const mwlPort = parseInt(String(body.mwl_port || ""), 10);

    if (isNaN(mwlPort) || mwlPort < 1 || mwlPort > 65535) {
      errors.push("MWL port must be a number between 1 and 65535.");
    }

    // Validate AE title
    const mwlAeTitle = String(body.mwl_ae_title || "").trim();

    if (mwlAeTitle && (mwlAeTitle.length > 16 || !/^[A-Z0-9_]+$/.test(mwlAeTitle))) {
      errors.push("MWL AE title must be uppercase alphanumeric (max 16 characters).");
    }

    // Validate directories
    const dirs = ["worklist_source_dir", "worklist_output_dir"];

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
  asyncRoute(async (_req: Request, res: Response) => {
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
