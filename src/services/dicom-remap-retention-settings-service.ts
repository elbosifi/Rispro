import { HttpError } from "../utils/http-error.js";
import type { UserId } from "../types/http.js";
import { loadSettingsMap, upsertSettings } from "./settings-service.js";

let loadRetentionSettingsMap = loadSettingsMap;
let saveRetentionSettings = upsertSettings;

export const DICOM_REMAP_RETENTION_SETTINGS_CATEGORY = "dicom_remap";
export const DICOM_REMAP_SENT_SOURCE_RETENTION_DAYS_KEY = "sent_source_retention_days";
export const DEFAULT_DICOM_REMAP_SENT_SOURCE_RETENTION_DAYS = 4;
export const MIN_DICOM_REMAP_SENT_SOURCE_RETENTION_DAYS = 1;
export const MAX_DICOM_REMAP_SENT_SOURCE_RETENTION_DAYS = 30;

export type DicomRemapRetentionSettings = { sentSourceRetentionDays: number };

function normalizeRetentionDays(value: unknown): number {
  const normalized = typeof value === "string" && value.trim() !== "" ? Number(value.trim()) : value;
  if (typeof normalized !== "number" || !Number.isFinite(normalized) || !Number.isInteger(normalized) || normalized < MIN_DICOM_REMAP_SENT_SOURCE_RETENTION_DAYS || normalized > MAX_DICOM_REMAP_SENT_SOURCE_RETENTION_DAYS) {
    throw new HttpError(400, "Retention must be a whole number from 1 to 30 days.");
  }
  return normalized;
}

export async function readDicomRemapRetentionSettings(): Promise<DicomRemapRetentionSettings> {
  const map = await loadRetentionSettingsMap([DICOM_REMAP_RETENTION_SETTINGS_CATEGORY]);
  const raw = map.dicom_remap?.[DICOM_REMAP_SENT_SOURCE_RETENTION_DAYS_KEY];
  if (raw === undefined || raw === null || String(raw).trim() === "") return { sentSourceRetentionDays: DEFAULT_DICOM_REMAP_SENT_SOURCE_RETENTION_DAYS };
  try {
    return { sentSourceRetentionDays: normalizeRetentionDays(raw) };
  } catch {
    return { sentSourceRetentionDays: DEFAULT_DICOM_REMAP_SENT_SOURCE_RETENTION_DAYS };
  }
}

export async function saveDicomRemapRetentionSettings(input: DicomRemapRetentionSettings, userId: UserId): Promise<DicomRemapRetentionSettings> {
  const sentSourceRetentionDays = normalizeRetentionDays(input?.sentSourceRetentionDays);
  await saveRetentionSettings(DICOM_REMAP_RETENTION_SETTINGS_CATEGORY, [{ key: DICOM_REMAP_SENT_SOURCE_RETENTION_DAYS_KEY, value: sentSourceRetentionDays }], userId);
  return { sentSourceRetentionDays };
}

export const __dicomRemapRetentionSettingsTestables = {
  setDependencies(dependencies: { load?: typeof loadSettingsMap; save?: typeof upsertSettings }): void {
    loadRetentionSettingsMap = dependencies.load || loadSettingsMap;
    saveRetentionSettings = dependencies.save || upsertSettings;
  },
  resetDependencies(): void {
    loadRetentionSettingsMap = loadSettingsMap;
    saveRetentionSettings = upsertSettings;
  },
};
