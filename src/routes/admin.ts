import express, { Request, Response } from "express";
import { requireAuth, requireRecentSupervisorReauth, requireSupervisor } from "../middleware/auth.js";
import { asyncRoute } from "../utils/async-route.js";
import { asUnknownRecord } from "../utils/records.js";
import { buildBackupSnapshot, restoreBackupSnapshot } from "../services/admin-service.js";

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
