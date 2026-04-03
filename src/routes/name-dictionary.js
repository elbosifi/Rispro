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
 * @property {{ sub: number | string, role: string }} user
 * @property {Record<string, unknown>} [body]
 * @property {{ entryId?: string }} [params]
 */

export const nameDictionaryRouter = express.Router();

nameDictionaryRouter.use(requireAuth);

/**
 * @param {unknown} value
 * @returns {string}
 */
function asString(value) {
  return String(value || "");
}

nameDictionaryRouter.get(
  "/",
  asyncRoute(async (req, res) => {
    const request = /** @type {NameDictionaryRequest} */ (req);
    const canSeeInactive = request.user.role === "supervisor" && hasRecentSupervisorReauth(request);
    const includeInactive = asString(request.query?.includeInactive).trim() === "true" && canSeeInactive;
    const entries = await listNameDictionary({ includeInactive });
    res.json({ entries });
  })
);

nameDictionaryRouter.post(
  "/",
  requireSupervisor,
  requireRecentSupervisorReauth,
  asyncRoute(async (req, res) => {
    const request = /** @type {NameDictionaryRequest} */ (req);
    const entry = await upsertNameDictionary(request.body || {}, request.user.sub);
    res.status(201).json({ entry });
  })
);

nameDictionaryRouter.post(
  "/import",
  requireSupervisor,
  requireRecentSupervisorReauth,
  asyncRoute(async (req, res) => {
    const request = /** @type {NameDictionaryRequest} */ (req);
    const body = /** @type {Record<string, unknown>} */ (request.body || {});
    const entriesPayload = /** @type {Array<{ arabicText?: string, englishText?: string, isActive?: boolean | string | number | null } | null | undefined>} */ (
      Array.isArray(body.entries) ? body.entries : []
    );
    const entries = await importNameDictionaryEntries(entriesPayload, request.user.sub);
    res.status(201).json({ entries });
  })
);

nameDictionaryRouter.put(
  "/:entryId",
  requireSupervisor,
  requireRecentSupervisorReauth,
  asyncRoute(async (req, res) => {
    const request = /** @type {NameDictionaryRequest} */ (req);
    const entry = await updateNameDictionaryEntry(
      asString(request.params?.entryId),
      request.body || {},
      request.user.sub
    );
    res.json({ entry });
  })
);

nameDictionaryRouter.delete(
  "/:entryId",
  requireSupervisor,
  requireRecentSupervisorReauth,
  asyncRoute(async (req, res) => {
    const request = /** @type {NameDictionaryRequest} */ (req);
    const entry = await deleteNameDictionaryEntry(asString(request.params?.entryId), request.user.sub);
    res.json({ entry });
  })
);
