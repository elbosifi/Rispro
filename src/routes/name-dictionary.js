// @ts-check

import express from "express";
import { hasRecentSupervisorReauth, requireAuth, requireRecentSupervisorReauth, requireSupervisor } from "../middleware/auth.js";
import { asyncRoute } from "../utils/async-route.js";
import {
  deleteNameDictionaryEntry,
  importNameDictionaryEntries,
  listNameDictionary,
  updateNameDictionaryEntry,
  upsertNameDictionary
} from "../services/name-dictionary-service.js";

/**
 * @typedef {object} NameDictionaryRequest
 * @property {{ includeInactive?: string }} [query]
 * @property {{ sub: number | string, role: string }} [user]
 * @property {Record<string, unknown>} [body]
 * @property {{ entryId?: string }} [params]
 */

export const nameDictionaryRouter = express.Router();

nameDictionaryRouter.use(requireAuth);

nameDictionaryRouter.get(
  "/",
  asyncRoute(async (req, res) => {
    const request = /** @type {NameDictionaryRequest} */ (req);
    const canSeeInactive = req.user?.role === "supervisor" && hasRecentSupervisorReauth(req);
    const includeInactive = String(request.query?.includeInactive || "").trim() === "true" && canSeeInactive;
    const entries = await listNameDictionary({ includeInactive });
    res.json({ entries });
  })
);

nameDictionaryRouter.post(
  "/",
  requireSupervisor,
  requireRecentSupervisorReauth,
  asyncRoute(async (req, res) => {
    const entry = await upsertNameDictionary(req.body || {}, req.user.sub);
    res.status(201).json({ entry });
  })
);

nameDictionaryRouter.post(
  "/import",
  requireSupervisor,
  requireRecentSupervisorReauth,
  asyncRoute(async (req, res) => {
    const entries = await importNameDictionaryEntries(req.body?.entries || [], req.user.sub);
    res.status(201).json({ entries });
  })
);

nameDictionaryRouter.put(
  "/:entryId",
  requireSupervisor,
  requireRecentSupervisorReauth,
  asyncRoute(async (req, res) => {
    const entry = await updateNameDictionaryEntry(req.params.entryId, req.body || {}, req.user.sub);
    res.json({ entry });
  })
);

nameDictionaryRouter.delete(
  "/:entryId",
  requireSupervisor,
  requireRecentSupervisorReauth,
  asyncRoute(async (req, res) => {
    const entry = await deleteNameDictionaryEntry(req.params.entryId, req.user.sub);
    res.json({ entry });
  })
);
