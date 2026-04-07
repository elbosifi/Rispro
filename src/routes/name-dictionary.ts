import express, { Request, Response } from "express";
import { type AuthRequest, hasRecentSupervisorReauth, requireAuth, requireRecentSupervisorReauth, requireSupervisor } from "../middleware/auth.js";
import { asyncRoute } from "../utils/async-route.js";
import { asString } from "../utils/request-coercion.js";
import { asUnknownRecord } from "../utils/records.js";
import {
  deleteNameDictionaryEntry,
  importNameDictionaryEntries,
  listNameDictionary,
  updateNameDictionaryEntry,
  upsertNameDictionary
} from "../services/name-dictionary-service.js";
import type { UnknownRecord, UserId } from "../types/http.js";

export const nameDictionaryRouter = express.Router();

nameDictionaryRouter.use(requireAuth);

nameDictionaryRouter.get(
  "/",
  asyncRoute(async (req: Request, res: Response) => {
    const request = req as AuthRequest;
    const canSeeInactive = request.user!.role === "supervisor" && hasRecentSupervisorReauth(request);
    const includeInactive = asString(request.query?.includeInactive).trim() === "true" && canSeeInactive;
    const entries = await listNameDictionary({ includeInactive });
    res.json({ entries });
  })
);

nameDictionaryRouter.post(
  "/",
  requireSupervisor,
  requireRecentSupervisorReauth,
  asyncRoute(async (req: Request, res: Response) => {
    const request = req as AuthRequest;
    const entry = await upsertNameDictionary(request.body ?? undefined, request.user!.sub as UserId);
    res.status(201).json({ entry });
  })
);

nameDictionaryRouter.post(
  "/import",
  requireSupervisor,
  requireRecentSupervisorReauth,
  asyncRoute(async (req: Request, res: Response) => {
    const request = req as AuthRequest;
    const body = asUnknownRecord(request.body);
    const entriesPayload: Array<{ arabicText?: string; englishText?: string; isActive?: boolean | string | number | null } | null | undefined> =
      Array.isArray(body.entries) ? body.entries : [];
    const entries = await importNameDictionaryEntries(entriesPayload, request.user!.sub as UserId);
    res.status(201).json({ entries });
  })
);

nameDictionaryRouter.put(
  "/:entryId",
  requireSupervisor,
  requireRecentSupervisorReauth,
  asyncRoute(async (req: Request, res: Response) => {
    const request = req as AuthRequest;
    const entry = await updateNameDictionaryEntry(
      asString(request.params?.entryId),
      request.body ?? undefined,
      request.user!.sub as UserId
    );
    res.json({ entry });
  })
);

nameDictionaryRouter.delete(
  "/:entryId",
  requireSupervisor,
  requireRecentSupervisorReauth,
  asyncRoute(async (req: Request, res: Response) => {
    const request = req as AuthRequest;
    const entry = await deleteNameDictionaryEntry(asString(request.params?.entryId), request.user!.sub as UserId);
    res.json({ entry });
  })
);
