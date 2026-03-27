import express from "express";
import { requireAuth, requireRecentSupervisorReauth, requireSupervisor } from "../middleware/auth.js";
import { asyncRoute } from "../utils/async-route.js";
import { buildBackupSnapshot, restoreBackupSnapshot } from "../services/admin-service.js";

export const adminRouter = express.Router();

adminRouter.use(requireAuth, requireSupervisor, requireRecentSupervisorReauth);

adminRouter.get(
  "/backup",
  asyncRoute(async (req, res) => {
    const result = await buildBackupSnapshot(req.user.sub);
    res.setHeader("Content-Disposition", `attachment; filename="${result.backupName}"`);
    res.json(result.backup);
  })
);

adminRouter.post(
  "/restore",
  asyncRoute(async (req, res) => {
    const result = await restoreBackupSnapshot(req.body, req.user.sub);
    res.json(result);
  })
);
