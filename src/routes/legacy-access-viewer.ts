/**
 * Legacy Access Viewer Router
 *
 * API endpoints for the read-only legacy Access appointment viewer.
 * Fully isolated from PostgreSQL and existing RISPro workflows.
 */

import express, { Request, Response } from "express";
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

// No authentication — this module is intentionally open and isolated.

/**
 * POST /api/legacy-access-viewer/upload
 *
 * Upload and activate an MDB file.  The file content is base64-encoded
 * in the JSON body.  Only one file is active at a time (process-scoped).
 */
legacyAccessViewerRouter.post(
  "/upload",
  asyncRoute(async (req: Request, res: Response) => {
    const body = asUnknownRecord(req.body || {});
    const fileContent = String(body.fileContentBase64 || "");
    const fileName = String(body.fileName || "database.mdb");

    if (!fileContent) {
      res.status(400).json({ error: "لم يتم إرسال محتوى الملف" }); // "No file content sent"
      return;
    }

    const status = loadMdbFile(fileContent, fileName);
    res.status(200).json({ status });
  })
);

/**
 * GET /api/legacy-access-viewer/status
 *
 * Check whether an MDB file is currently active.
 */
legacyAccessViewerRouter.get(
  "/status",
  asyncRoute(async (req: Request, res: Response) => {
    const status = getMdbStatus();
    res.json({ status });
  })
);

/**
 * GET /api/legacy-access-viewer/appointments
 *
 * Query legacy appointments with optional filters.
 * Query params: fromDate, toDate, patientName, modality, exam
 */
legacyAccessViewerRouter.get(
  "/appointments",
  asyncRoute(async (req: Request, res: Response) => {
    const query = asUnknownRecord(req.query || {});

    const filters: LegacyAppointmentFilters = {};
    if (typeof query.fromDate === "string" && query.fromDate) filters.fromDate = query.fromDate;
    if (typeof query.toDate === "string" && query.toDate) filters.toDate = query.toDate;
    if (typeof query.patientName === "string" && query.patientName) filters.patientName = query.patientName;
    if (typeof query.modality === "string" && query.modality) filters.modality = query.modality;
    if (typeof query.exam === "string" && query.exam) filters.exam = query.exam;

    const appointments = queryLegacyAppointments(filters);
    res.json({ appointments });
  })
);

/**
 * GET /api/legacy-access-viewer/summary
 *
 * Get summary counters (today, tomorrow, this week).
 */
legacyAccessViewerRouter.get(
  "/summary",
  asyncRoute(async (req: Request, res: Response) => {
    const summary = computeSummaryCounters();
    res.json({ summary });
  })
);
