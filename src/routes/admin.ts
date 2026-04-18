import express, { Request, Response } from "express";
import { requireAuth, requireRecentSupervisorReauth, requireSupervisor } from "../middleware/auth.js";
import { asyncRoute } from "../utils/async-route.js";
import { asOptionalString } from "../utils/request-coercion.js";
import { asUnknownRecord } from "../utils/records.js";
import { HttpError } from "../utils/http-error.js";
import { buildBackupSnapshot, restoreBackupSnapshot } from "../services/admin-service.js";
import {
  deleteDocumentsByScope,
  moveDocumentsToConfiguredStorage,
  testConfiguredStorageConnectivity,
} from "../services/document-service.js";

export const adminRouter = express.Router();

adminRouter.use(requireAuth, requireSupervisor, requireRecentSupervisorReauth);

adminRouter.get(
  "/backup",
  asyncRoute(async (req: Request, res: Response) => {
    const result = await buildBackupSnapshot(req.user!.sub);
    res.setHeader("Content-Disposition", `attachment; filename="${result.backupName}"`);
    res.json(result.backup);
  })
);

adminRouter.post(
  "/restore",
  asyncRoute(async (req: Request, res: Response) => {
    const payload = asUnknownRecord(req.body);
    const result = await restoreBackupSnapshot(payload, req.user!.sub);
    res.json(result);
  })
);

adminRouter.post(
  "/documents/delete",
  asyncRoute(async (req: Request, res: Response) => {
    const body = asUnknownRecord(req.body);
    const mode = String(body.mode || "all") as "all" | "appointment_date_range";
    if (!["all", "appointment_date_range"].includes(mode)) {
      throw new HttpError(400, "mode must be 'all' or 'appointment_date_range'.");
    }
    const result = await deleteDocumentsByScope(
      {
        mode,
        dateFrom: asOptionalString(body.dateFrom),
        dateTo: asOptionalString(body.dateTo),
      },
      req.user!.sub
    );
    res.json(result);
  })
);

adminRouter.post(
  "/documents/move-storage",
  asyncRoute(async (req: Request, res: Response) => {
    const body = asUnknownRecord(req.body);
    const mode = String(body.mode || "all") as "all" | "appointment_date_range";
    if (!["all", "appointment_date_range"].includes(mode)) {
      throw new HttpError(400, "mode must be 'all' or 'appointment_date_range'.");
    }
    const result = await moveDocumentsToConfiguredStorage(
      {
        mode,
        dateFrom: asOptionalString(body.dateFrom),
        dateTo: asOptionalString(body.dateTo),
      },
      req.user!.sub
    );
    res.json(result);
  })
);

adminRouter.post(
  "/documents/storage-test",
  asyncRoute(async (_req: Request, res: Response) => {
    const result = await testConfiguredStorageConnectivity();
    res.json(result);
  })
);
