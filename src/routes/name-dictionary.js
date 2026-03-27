import express from "express";
import { hasRecentSupervisorReauth, requireAuth, requireRecentSupervisorReauth, requireSupervisor } from "../middleware/auth.js";
import {
  deleteNameDictionaryEntry,
  listNameDictionary,
  updateNameDictionaryEntry,
  upsertNameDictionary
} from "../services/name-dictionary-service.js";

export const nameDictionaryRouter = express.Router();

nameDictionaryRouter.use(requireAuth);

nameDictionaryRouter.get("/", async (req, res, next) => {
  try {
    const canSeeInactive = req.user?.role === "supervisor" && hasRecentSupervisorReauth(req);
    const includeInactive = String(req.query.includeInactive || "").trim() === "true" && canSeeInactive;
    const entries = await listNameDictionary({ includeInactive });
    res.json({ entries });
  } catch (error) {
    next(error);
  }
});

nameDictionaryRouter.post("/", requireSupervisor, requireRecentSupervisorReauth, async (req, res, next) => {
  try {
    const entry = await upsertNameDictionary(req.body || {}, req.user.sub);
    res.status(201).json({ entry });
  } catch (error) {
    next(error);
  }
});

nameDictionaryRouter.put("/:entryId", requireSupervisor, requireRecentSupervisorReauth, async (req, res, next) => {
  try {
    const entry = await updateNameDictionaryEntry(req.params.entryId, req.body || {}, req.user.sub);
    res.json({ entry });
  } catch (error) {
    next(error);
  }
});

nameDictionaryRouter.delete("/:entryId", requireSupervisor, requireRecentSupervisorReauth, async (req, res, next) => {
  try {
    const entry = await deleteNameDictionaryEntry(req.params.entryId, req.user.sub);
    res.json({ entry });
  } catch (error) {
    next(error);
  }
});
