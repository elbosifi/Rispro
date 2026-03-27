import express from "express";
import { requireAuth, requireRecentSupervisorReauth, requireSupervisor } from "../middleware/auth.js";
import { buildBackupSnapshot, restoreBackupSnapshot } from "../services/admin-service.js";

export const adminRouter = express.Router();

adminRouter.use(requireAuth, requireSupervisor, requireRecentSupervisorReauth);

adminRouter.get("/backup", async (req, res, next) => {
  try {
    const result = await buildBackupSnapshot(req.user.sub);
    res.setHeader("Content-Disposition", `attachment; filename="${result.backupName}"`);
    res.json(result.backup);
  } catch (error) {
    next(error);
  }
});

adminRouter.post("/restore", async (req, res, next) => {
  try {
    const result = await restoreBackupSnapshot(req.body, req.user.sub);
    res.json(result);
  } catch (error) {
    next(error);
  }
});
