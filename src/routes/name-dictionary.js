import express from "express";
import { requireAuth } from "../middleware/auth.js";
import { listNameDictionary } from "../services/name-dictionary-service.js";

export const nameDictionaryRouter = express.Router();

nameDictionaryRouter.use(requireAuth);

nameDictionaryRouter.get("/", async (_req, res, next) => {
  try {
    const entries = await listNameDictionary({ includeInactive: false });
    res.json({ entries });
  } catch (error) {
    next(error);
  }
});
