// @ts-check

import express from "express";
import { requireAuth, requireRecentSupervisorReauth, requireSupervisor } from "../middleware/auth.js";
import { asyncRoute } from "../utils/async-route.js";
import { buildBackupSnapshot, restoreBackupSnapshot } from "../services/admin-service.js";

/**
 * @typedef {object} AdminRequest
 * @property {{ sub: number | string, role: string }} user
 * @property {Record<string, unknown>} [body]
 */

export const adminRouter = express.Router();

adminRouter.use(requireAuth, requireSupervisor, requireRecentSupervisorReauth);

adminRouter.get(
  "/backup",
  asyncRoute(async (req, res) => {
    const request = /** @type {AdminRequest} */ (req);
    const result = await buildBackupSnapshot(request.user.sub);
    res.setHeader("Content-Disposition", `attachment; filename="${result.backupName}"`);
    res.json(result.backup);
  })
);

adminRouter.post(
  "/restore",
  asyncRoute(async (req, res) => {
    const request = /** @type {AdminRequest} */ (req);
    const payload = request.body || {};
    const result = await restoreBackupSnapshot(payload, request.user.sub);
    res.json(result);
  })
);
