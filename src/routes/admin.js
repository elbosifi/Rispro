// @ts-check

import express from "express";
import { requireAuth, requireRecentSupervisorReauth, requireSupervisor } from "../middleware/auth.js";
import { asyncRoute } from "../utils/async-route.js";
import { asUnknownRecord } from "../utils/records.js";
import { buildBackupSnapshot, restoreBackupSnapshot } from "../services/admin-service.js";

/** @typedef {import("../types/http.js").AuthenticatedUserContext} AuthenticatedUserContext */
/** @typedef {import("../types/http.js").UnknownRecord} UnknownRecord */

/**
 * @typedef {object} AdminRequest
 * @property {AuthenticatedUserContext} user
 * @property {UnknownRecord} [body]
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
    const payload = asUnknownRecord(request.body);
    const result = await restoreBackupSnapshot(payload, request.user.sub);
    res.json(result);
  })
);
