// @ts-check

import express from "express";
import { requireAuth, requireRecentSupervisorReauth, requireSupervisor } from "../middleware/auth.js";
import { asyncRoute } from "../utils/async-route.js";
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

/**
 * @typedef {object} SettingsRequest
 * @property {{ includeInactive?: string }} [query]
 * @property {{ sub: number | string, role: string }} [user]
 * @property {Record<string, unknown>} [body]
 * @property {{
 *   category?: string,
 *   entryId?: string,
 *   modalityId?: string,
 *   examTypeId?: string,
 *   deviceId?: string
 * }} [params]
 */

export const settingsRouter = express.Router();

settingsRouter.use(requireAuth, requireSupervisor, requireRecentSupervisorReauth);

settingsRouter.get(
  "/",
  asyncRoute(async (_req, res) => {
    const settings = await listSettingsCatalog();
    res.json({ settings });
  })
);

settingsRouter.get(
  "/name-dictionary",
  asyncRoute(async (req, res) => {
    const request = /** @type {SettingsRequest} */ (req);
    const includeInactive = String(request.query?.includeInactive || "").trim() === "true";
    const entries = await listNameDictionary({ includeInactive });
    res.json({ entries });
  })
);

settingsRouter.post(
  "/name-dictionary",
  asyncRoute(async (req, res) => {
    const entry = await upsertNameDictionary(req.body || {}, req.user.sub);
    res.status(201).json({ entry });
  })
);

settingsRouter.put(
  "/name-dictionary/:entryId",
  asyncRoute(async (req, res) => {
    const entry = await updateNameDictionaryEntry(req.params.entryId, req.body || {}, req.user.sub);
    res.json({ entry });
  })
);

settingsRouter.delete(
  "/name-dictionary/:entryId",
  asyncRoute(async (req, res) => {
    const entry = await deleteNameDictionaryEntry(req.params.entryId, req.user.sub);
    res.json({ entry });
  })
);

settingsRouter.get(
  "/modalities",
  asyncRoute(async (req, res) => {
    const request = /** @type {SettingsRequest} */ (req);
    const includeInactive = String(request.query?.includeInactive || "").trim() === "true";
    const result = await listModalitiesForSettings({ includeInactive });
    res.json(result);
  })
);

settingsRouter.post(
  "/modalities",
  asyncRoute(async (req, res) => {
    const modality = await createModality(req.body || {}, req.user.sub);
    res.status(201).json({ modality });
  })
);

settingsRouter.put(
  "/modalities/:modalityId",
  asyncRoute(async (req, res) => {
    const modality = await updateModality(req.params.modalityId, req.body || {}, req.user.sub);
    res.json({ modality });
  })
);

settingsRouter.delete(
  "/modalities/:modalityId",
  asyncRoute(async (req, res) => {
    const modality = await deleteModality(req.params.modalityId, req.user.sub);
    res.json({ modality });
  })
);

settingsRouter.get(
  "/exam-types",
  asyncRoute(async (_req, res) => {
    const result = await listExamTypesForSettings();
    res.json(result);
  })
);

settingsRouter.post(
  "/exam-types",
  asyncRoute(async (req, res) => {
    const examType = await createExamType(req.body || {}, req.user.sub);
    res.status(201).json({ examType });
  })
);

settingsRouter.put(
  "/exam-types/:examTypeId",
  asyncRoute(async (req, res) => {
    const examType = await updateExamType(req.params.examTypeId, req.body || {}, req.user.sub);
    res.json({ examType });
  })
);

settingsRouter.delete(
  "/exam-types/:examTypeId",
  asyncRoute(async (req, res) => {
    const examType = await deleteExamType(req.params.examTypeId, req.user.sub);
    res.json({ examType });
  })
);

settingsRouter.get(
  "/dicom-devices",
  asyncRoute(async (req, res) => {
    const request = /** @type {SettingsRequest} */ (req);
    const includeInactive = String(request.query?.includeInactive || "").trim() === "true";
    const devices = await listDicomDevices({ includeInactive });
    res.json({ devices });
  })
);

settingsRouter.post(
  "/dicom-devices",
  asyncRoute(async (req, res) => {
    const device = await createDicomDevice(req.body || {}, req.user.sub);
    res.status(201).json({ device });
  })
);

settingsRouter.put(
  "/dicom-devices/:deviceId",
  asyncRoute(async (req, res) => {
    const device = await updateDicomDevice(req.params.deviceId, req.body || {}, req.user.sub);
    res.json({ device });
  })
);

settingsRouter.delete(
  "/dicom-devices/:deviceId",
  asyncRoute(async (req, res) => {
    const result = await deleteDicomDevice(req.params.deviceId, req.user.sub);
    res.json(result);
  })
);

settingsRouter.get(
  "/:category",
  asyncRoute(async (req, res) => {
    const settings = await getSettingsByCategory(req.params.category);
    res.json({ settings });
  })
);

settingsRouter.put(
  "/:category",
  asyncRoute(async (req, res) => {
    const settings = await upsertSettings(req.params.category, req.body?.entries || [], req.user.sub);
    res.json({ settings });
  })
);
