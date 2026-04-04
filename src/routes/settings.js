// @ts-check

import express from "express";
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

/** @typedef {import("../types/http.js").AuthenticatedUserContext} AuthenticatedUserContext */
/** @typedef {import("../types/http.js").UnknownRecord} UnknownRecord */

/**
 * @typedef {object} SettingsRequest
 * @property {{ includeInactive?: string }} [query]
 * @property {AuthenticatedUserContext} user
 * @property {UnknownRecord} [body]
 * @property {{
 *   category?: string,
 *   entryId?: string,
 *   modalityId?: string,
 *   examTypeId?: string,
 *   deviceId?: string
 * }} [params]
 */

export const settingsRouter = express.Router();

// Name-dictionary routes: only require auth, not supervisor re-auth
settingsRouter.use(requireAuth);

settingsRouter.get(
  "/name-dictionary",
  asyncRoute(async (req, res) => {
    const request = /** @type {SettingsRequest} */ (req);
    const includeInactive = asBooleanFlag(request.query?.includeInactive);
    const entries = await listNameDictionary({ includeInactive });
    res.json({ entries });
  })
);

settingsRouter.post(
  "/name-dictionary",
  asyncRoute(async (req, res) => {
    const request = /** @type {SettingsRequest} */ (req);
    const entry = await upsertNameDictionary(request.body || {}, request.user.sub);
    res.status(201).json({ entry });
  })
);

settingsRouter.put(
  "/name-dictionary/:entryId",
  asyncRoute(async (req, res) => {
    const request = /** @type {SettingsRequest} */ (req);
    const entry = await updateNameDictionaryEntry(asString(request.params?.entryId), request.body || {}, request.user.sub);
    res.json({ entry });
  })
);

settingsRouter.delete(
  "/name-dictionary/:entryId",
  asyncRoute(async (req, res) => {
    const request = /** @type {SettingsRequest} */ (req);
    const entry = await deleteNameDictionaryEntry(asString(request.params?.entryId), request.user.sub);
    res.json({ entry });
  })
);

// Supervisor-only settings
settingsRouter.use(requireAuth, requireSupervisor, requireRecentSupervisorReauth);

settingsRouter.get(
  "/",
  asyncRoute(async (_req, res) => {
    const settings = await listSettingsCatalog();
    res.json({ settings });
  })
);

settingsRouter.get(
  "/modalities",
  asyncRoute(async (req, res) => {
    const request = /** @type {SettingsRequest} */ (req);
    const includeInactive = asBooleanFlag(request.query?.includeInactive);
    const result = await listModalitiesForSettings({ includeInactive });
    res.json(result);
  })
);

settingsRouter.post(
  "/modalities",
  asyncRoute(async (req, res) => {
    const request = /** @type {SettingsRequest} */ (req);
    const modality = await createModality(request.body || {}, request.user.sub);
    res.status(201).json({ modality });
  })
);

settingsRouter.put(
  "/modalities/:modalityId",
  asyncRoute(async (req, res) => {
    const request = /** @type {SettingsRequest} */ (req);
    const modality = await updateModality(asString(request.params?.modalityId), request.body || {}, request.user.sub);
    res.json({ modality });
  })
);

settingsRouter.delete(
  "/modalities/:modalityId",
  asyncRoute(async (req, res) => {
    const request = /** @type {SettingsRequest} */ (req);
    const modality = await deleteModality(asString(request.params?.modalityId), request.user.sub);
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
    const request = /** @type {SettingsRequest} */ (req);
    const examType = await createExamType(request.body || {}, request.user.sub);
    res.status(201).json({ examType });
  })
);

settingsRouter.put(
  "/exam-types/:examTypeId",
  asyncRoute(async (req, res) => {
    const request = /** @type {SettingsRequest} */ (req);
    const examType = await updateExamType(asString(request.params?.examTypeId), request.body || {}, request.user.sub);
    res.json({ examType });
  })
);

settingsRouter.delete(
  "/exam-types/:examTypeId",
  asyncRoute(async (req, res) => {
    const request = /** @type {SettingsRequest} */ (req);
    const examType = await deleteExamType(asString(request.params?.examTypeId), request.user.sub);
    res.json({ examType });
  })
);

settingsRouter.get(
  "/dicom-devices",
  asyncRoute(async (req, res) => {
    const request = /** @type {SettingsRequest} */ (req);
    const includeInactive = asBooleanFlag(request.query?.includeInactive);
    const devices = await listDicomDevices({ includeInactive });
    res.json({ devices });
  })
);

settingsRouter.post(
  "/dicom-devices",
  asyncRoute(async (req, res) => {
    const request = /** @type {SettingsRequest} */ (req);
    const device = await createDicomDevice(request.body || {}, request.user.sub);
    res.status(201).json({ device });
  })
);

settingsRouter.put(
  "/dicom-devices/:deviceId",
  asyncRoute(async (req, res) => {
    const request = /** @type {SettingsRequest} */ (req);
    const device = await updateDicomDevice(asString(request.params?.deviceId), request.body || {}, request.user.sub);
    res.json({ device });
  })
);

settingsRouter.delete(
  "/dicom-devices/:deviceId",
  asyncRoute(async (req, res) => {
    const request = /** @type {SettingsRequest} */ (req);
    const result = await deleteDicomDevice(asString(request.params?.deviceId), request.user.sub);
    res.json(result);
  })
);

settingsRouter.get(
  "/:category",
  asyncRoute(async (req, res) => {
    const request = /** @type {SettingsRequest} */ (req);
    const settings = await getSettingsByCategory(asString(request.params?.category));
    res.json({ settings });
  })
);

settingsRouter.put(
  "/:category",
  asyncRoute(async (req, res) => {
    const request = /** @type {SettingsRequest} */ (req);
    const body = asUnknownRecord(request.body);
    const rawEntries = body.entries;
    const entries = /** @type {{ key: string, value?: unknown }[]} */ (Array.isArray(rawEntries) ? rawEntries : []);
    const settings = await upsertSettings(asString(request.params?.category), entries, request.user.sub);
    res.json({ settings });
  })
);
