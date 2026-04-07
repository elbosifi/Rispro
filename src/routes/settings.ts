import express, { Request, Response } from "express";
import { requireAuth, requireRecentSupervisorReauth, requireSupervisor } from "../middleware/auth.js";
import { asyncRoute } from "../utils/async-route.js";
import { asBooleanFlag, asString } from "../utils/request-coercion.js";
import { asUnknownRecord } from "../utils/records.js";
import { getSettingsByCategory, listSettingsCatalog, upsertSettings } from "../services/settings-service.js";
import {
  createExamType,
  createModality,
  deleteExamType,
  deleteModality,
  listExamTypesForSettings,
  listModalitiesForSettings,
  updateExamType,
  updateModality
} from "../services/appointment-service.js";
import {
  createDicomDevice,
  deleteDicomDevice,
  listDicomDevices,
  updateDicomDevice
} from "../services/dicom-service.js";
import {
  deleteNameDictionaryEntry,
  listNameDictionary,
  updateNameDictionaryEntry,
  upsertNameDictionary
} from "../services/name-dictionary-service.js";
import type { AuthenticatedUserContext, UnknownRecord, UserId } from "../types/http.js";

interface SettingsRequest {
  query?: { includeInactive?: string };
  user: AuthenticatedUserContext;
  body?: unknown;
  params?: {
    category?: string;
    entryId?: string;
    modalityId?: string;
    examTypeId?: string;
    deviceId?: string;
  };
}

export const settingsRouter = express.Router();

// Name-dictionary routes: only require auth, not supervisor re-auth
settingsRouter.use(requireAuth);

settingsRouter.get(
  "/name-dictionary",
  asyncRoute(async (req: Request, res: Response) => {
    const request = req as SettingsRequest;
    const includeInactive = asBooleanFlag(request.query?.includeInactive);
    const entries = await listNameDictionary({ includeInactive });
    res.json({ entries });
  })
);

settingsRouter.post(
  "/name-dictionary",
  asyncRoute(async (req: Request, res: Response) => {
    const request = req as SettingsRequest;
    const entry = await upsertNameDictionary(request.body ?? undefined, request.user.sub as UserId);
    res.status(201).json({ entry });
  })
);

settingsRouter.put(
  "/name-dictionary/:entryId",
  asyncRoute(async (req: Request, res: Response) => {
    const request = req as SettingsRequest;
    const entry = await updateNameDictionaryEntry(asString(request.params?.entryId), request.body ?? undefined, request.user.sub as UserId);
    res.json({ entry });
  })
);

settingsRouter.delete(
  "/name-dictionary/:entryId",
  asyncRoute(async (req: Request, res: Response) => {
    const request = req as SettingsRequest;
    const entry = await deleteNameDictionaryEntry(asString(request.params?.entryId), request.user.sub as UserId);
    res.json({ entry });
  })
);

// Supervisor-only settings
settingsRouter.use(requireAuth, requireSupervisor, requireRecentSupervisorReauth);

settingsRouter.get(
  "/",
  asyncRoute(async (_req: Request, res: Response) => {
    const settings = await listSettingsCatalog();
    res.json({ settings });
  })
);

settingsRouter.get(
  "/modalities",
  asyncRoute(async (req: Request, res: Response) => {
    const request = req as SettingsRequest;
    const includeInactive = asBooleanFlag(request.query?.includeInactive);
    const result = await listModalitiesForSettings({ includeInactive });
    res.json(result);
  })
);

settingsRouter.post(
  "/modalities",
  asyncRoute(async (req: Request, res: Response) => {
    const request = req as SettingsRequest;
    const modality = await createModality(asUnknownRecord(request.body ?? {}), request.user.sub as UserId);
    res.status(201).json({ modality });
  })
);

settingsRouter.put(
  "/modalities/:modalityId",
  asyncRoute(async (req: Request, res: Response) => {
    const request = req as SettingsRequest;
    const modality = await updateModality(asString(request.params?.modalityId), asUnknownRecord(request.body ?? {}), request.user.sub as UserId);
    res.json({ modality });
  })
);

settingsRouter.delete(
  "/modalities/:modalityId",
  asyncRoute(async (req: Request, res: Response) => {
    const request = req as SettingsRequest;
    const modality = await deleteModality(asString(request.params?.modalityId), request.user.sub as UserId);
    res.json({ modality });
  })
);

settingsRouter.get(
  "/exam-types",
  asyncRoute(async (_req: Request, res: Response) => {
    const result = await listExamTypesForSettings();
    res.json(result);
  })
);

settingsRouter.post(
  "/exam-types",
  asyncRoute(async (req: Request, res: Response) => {
    const request = req as SettingsRequest;
    const examType = await createExamType(asUnknownRecord(request.body ?? {}), request.user.sub as UserId);
    res.status(201).json({ examType });
  })
);

settingsRouter.put(
  "/exam-types/:examTypeId",
  asyncRoute(async (req: Request, res: Response) => {
    const request = req as SettingsRequest;
    const examType = await updateExamType(asString(request.params?.examTypeId), asUnknownRecord(request.body ?? {}), request.user.sub as UserId);
    res.json({ examType });
  })
);

settingsRouter.delete(
  "/exam-types/:examTypeId",
  asyncRoute(async (req: Request, res: Response) => {
    const request = req as SettingsRequest;
    const examType = await deleteExamType(asString(request.params?.examTypeId), request.user.sub as UserId);
    res.json({ examType });
  })
);

settingsRouter.get(
  "/dicom-devices",
  asyncRoute(async (req: Request, res: Response) => {
    const request = req as SettingsRequest;
    const includeInactive = asBooleanFlag(request.query?.includeInactive);
    const devices = await listDicomDevices({ includeInactive });
    res.json({ devices });
  })
);

settingsRouter.post(
  "/dicom-devices",
  asyncRoute(async (req: Request, res: Response) => {
    const request = req as SettingsRequest;
    const device = await createDicomDevice(asUnknownRecord(request.body ?? {}), request.user.sub as UserId);
    res.status(201).json({ device });
  })
);

settingsRouter.put(
  "/dicom-devices/:deviceId",
  asyncRoute(async (req: Request, res: Response) => {
    const request = req as SettingsRequest;
    const device = await updateDicomDevice(asString(request.params?.deviceId), asUnknownRecord(request.body ?? {}), request.user.sub as UserId);
    res.json({ device });
  })
);

settingsRouter.delete(
  "/dicom-devices/:deviceId",
  asyncRoute(async (req: Request, res: Response) => {
    const request = req as SettingsRequest;
    const result = await deleteDicomDevice(asString(request.params?.deviceId), request.user.sub as UserId);
    res.json(result);
  })
);

settingsRouter.get(
  "/:category",
  asyncRoute(async (req: Request, res: Response) => {
    const request = req as SettingsRequest;
    const settings = await getSettingsByCategory(asString(request.params?.category));
    res.json({ settings });
  })
);

settingsRouter.put(
  "/:category",
  asyncRoute(async (req: Request, res: Response) => {
    const request = req as SettingsRequest;
    const body = asUnknownRecord(request.body);
    const rawEntries = body.entries;
    const entries: Array<{ key: string; value?: unknown }> = Array.isArray(rawEntries) ? rawEntries : [];
    const settings = await upsertSettings(asString(request.params?.category), entries, request.user.sub as UserId);
    res.json({ settings });
  })
);
