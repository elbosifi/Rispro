/**
 * Legacy Access Viewer Router
 *
 * API endpoints for the read-only legacy Access appointment viewer.
 * Requires normal authentication (not supervisor-only).
 * Fully isolated from PostgreSQL and existing RISPro workflows.
 */

import express, { Request, Response } from "express";
import { requireAuth } from "../middleware/auth.js";
import { asyncRoute } from "../utils/async-route.js";
import { asUnknownRecord } from "../utils/records.js";
import {
  loadMdbFile,
  getMdbStatus,
  queryLegacyAppointments,
  computeSummaryCounters,
  type LegacyAppointmentFilters
} from "../services/legacy-access-viewer-service.js";

export const legacyAccessViewerRouter = express.Router();

// Normal authentication — same as every other route in the app.
legacyAccessViewerRouter.use(requireAuth);

/**
 * POST /api/legacy-access-viewer/upload
 */
legacyAccessViewerRouter.post(
  "/upload",
  asyncRoute(async (_req: Request, res: Response) => {
    const body = asUnknownRecord(_req.body || {});
    const fileContent = String(body.fileContentBase64 || "");
    const fileName = String(body.fileName || "database.mdb");

    if (!fileContent) {
      res.status(400).json({ error: "لم يتم إرسال محتوى الملف" });
      return;
    }

    const status = await loadMdbFile(fileContent, fileName);
    res.status(200).json({ status });
  })
);

/**
 * GET /api/legacy-access-viewer/status
 */
legacyAccessViewerRouter.get(
  "/status",
  asyncRoute(async (_req: Request, res: Response) => {
    const status = await getMdbStatus();
    res.json({ status });
  })
);

/**
 * GET /api/legacy-access-viewer/appointments
 */
legacyAccessViewerRouter.get(
  "/appointments",
  asyncRoute(async (_req: Request, res: Response) => {
    const query = asUnknownRecord(_req.query || {});

    const filters: LegacyAppointmentFilters = {};
    if (typeof query.fromDate === "string" && query.fromDate) filters.fromDate = query.fromDate;
    if (typeof query.toDate === "string" && query.toDate) filters.toDate = query.toDate;
    if (typeof query.patientName === "string" && query.patientName) filters.patientName = query.patientName;
    if (typeof query.modality === "string" && query.modality) filters.modality = query.modality;
    if (typeof query.exam === "string" && query.exam) filters.exam = query.exam;

    const appointments = await queryLegacyAppointments(filters);
    res.json({ appointments });
  })
);

/**
 * GET /api/legacy-access-viewer/summary
 */
legacyAccessViewerRouter.get(
  "/summary",
  asyncRoute(async (_req: Request, res: Response) => {
    const summary = await computeSummaryCounters();
    res.json({ summary });
  })
);
