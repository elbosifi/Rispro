import express from "express";
import { requireAuth, requireRecentSupervisorReauth, requireSupervisor } from "../middleware/auth.js";
import { getSettingsByCategory, listSettingsCatalog, upsertSettings } from "../services/settings-service.js";
import {
  deleteNameDictionaryEntry,
  listNameDictionary,
  updateNameDictionaryEntry,
  upsertNameDictionary
} from "../services/name-dictionary-service.js";

export const settingsRouter = express.Router();

settingsRouter.use(requireAuth, requireSupervisor, requireRecentSupervisorReauth);

settingsRouter.get("/", async (_req, res, next) => {
  try {
    const settings = await listSettingsCatalog();
    res.json({ settings });
  } catch (error) {
    next(error);
  }
});

settingsRouter.get("/name-dictionary", async (req, res, next) => {
  try {
    const includeInactive = String(req.query.includeInactive || "").trim() === "true";
    const entries = await listNameDictionary({ includeInactive });
    res.json({ entries });
  } catch (error) {
    next(error);
  }
});

settingsRouter.post("/name-dictionary", async (req, res, next) => {
  try {
    const entry = await upsertNameDictionary(req.body || {}, req.user.sub);
    res.status(201).json({ entry });
  } catch (error) {
    next(error);
  }
});

settingsRouter.put("/name-dictionary/:entryId", async (req, res, next) => {
  try {
    const entry = await updateNameDictionaryEntry(req.params.entryId, req.body || {}, req.user.sub);
    res.json({ entry });
  } catch (error) {
    next(error);
  }
});

settingsRouter.delete("/name-dictionary/:entryId", async (req, res, next) => {
  try {
    const entry = await deleteNameDictionaryEntry(req.params.entryId, req.user.sub);
    res.json({ entry });
  } catch (error) {
    next(error);
  }
});

settingsRouter.get("/:category", async (req, res, next) => {
  try {
    const settings = await getSettingsByCategory(req.params.category);
    res.json({ settings });
  } catch (error) {
    next(error);
  }
});

settingsRouter.put("/:category", async (req, res, next) => {
  try {
    const settings = await upsertSettings(req.params.category, req.body?.entries || [], req.user.sub);
    res.json({ settings });
  } catch (error) {
    next(error);
  }
});
