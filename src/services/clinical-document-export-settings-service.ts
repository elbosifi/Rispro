import { HttpError } from "../utils/http-error.js";
import type { UserId } from "../types/http.js";
import { loadSettingsMap, upsertSettings } from "./settings-service.js";
import { listOrthancRemoteModalities } from "./orthanc-pacs-service.js";

export const CLINICAL_DOCUMENT_EXPORT_SETTINGS_CATEGORY = "clinical_document_export";
export type ClinicalDocumentExportSettings = { enabled: boolean; destinationKey: string };

function enabled(value: unknown): boolean {
  return [true, 1, "1", "true", "yes", "on", "enabled"].includes(typeof value === "string" ? value.trim().toLowerCase() : value as never);
}

export async function readClinicalDocumentExportSettings(): Promise<ClinicalDocumentExportSettings> {
  const values = await loadSettingsMap([CLINICAL_DOCUMENT_EXPORT_SETTINGS_CATEGORY]);
  const settings = values[CLINICAL_DOCUMENT_EXPORT_SETTINGS_CATEGORY] || {};
  return { enabled: enabled(settings.enabled), destinationKey: String(settings.destination_key || "").trim() };
}

export async function saveClinicalDocumentExportSettings(input: ClinicalDocumentExportSettings, userId: UserId): Promise<ClinicalDocumentExportSettings> {
  const settings = { enabled: Boolean(input.enabled), destinationKey: String(input.destinationKey || "").trim() };
  if (settings.enabled) {
    if (!settings.destinationKey) throw new HttpError(400, "A PACS destination is required when clinical document export is enabled.");
    const { modalities } = await listOrthancRemoteModalities();
    const modality = modalities.find((item) => item.key === settings.destinationKey);
    if (!modality || !modality.aet || !modality.host || modality.port == null || modality.configurationError) {
      throw new HttpError(400, "The selected PACS destination is unavailable or invalid.");
    }
  }
  await upsertSettings(CLINICAL_DOCUMENT_EXPORT_SETTINGS_CATEGORY, [
    { key: "enabled", value: settings.enabled ? "enabled" : "disabled" },
    { key: "destination_key", value: settings.destinationKey },
  ], userId);
  return settings;
}
