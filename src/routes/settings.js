import express from "express";
import { requireAuth, requireSupervisor } from "../middleware/auth.js";
import { getSettingsByCategory, upsertSettings } from "../services/settings-service.js";

export const settingsRouter = express.Router();

settingsRouter.use(requireAuth, requireSupervisor);

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
