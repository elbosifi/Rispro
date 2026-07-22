import { decryptBackupV3Secret, encryptBackupV3Secret } from "./backup-v3-secret-service.js";
import { validateBackupV3SmbConfig } from "./backup-v3-smb-destination.js";
import { loadSettingsMap, upsertSettings } from "./settings-service.js";
import { HttpError } from "../utils/http-error.js";
import type { UserId } from "../types/http.js";

export const REQUEST_SCAN_SETTINGS_CATEGORY = "request_scan_automation";

export type RequestScanSettings = {
  enabled: boolean;
  server: string;
  share: string;
  domain: string;
  username: string;
  password: string;
  incomingSubfolder: string;
  processedSubfolder: string;
  failedSubfolder: string;
  pollingIntervalSeconds: number;
  fileReadyDelaySeconds: number;
};

function enabled(value: unknown): boolean { return ["enabled", "true", "1", "yes", "on"].includes(String(value || "").trim().toLowerCase()); }
function positive(value: unknown, fallback: number, field: string): number {
  const parsed = Number(value ?? fallback);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 3600) throw new HttpError(400, `${field} must be between 1 and 3600 seconds.`);
  return parsed;
}

function settingsFrom(values: Record<string, string>): RequestScanSettings {
  const incomingSubfolder = String(values.incoming_subfolder || "Requests/Incoming").trim();
  const processedSubfolder = String(values.processed_subfolder || "Requests/Processed").trim();
  const failedSubfolder = String(values.failed_subfolder || "Requests/Failed").trim();
  const passwordEncrypted = String(values.password_encrypted || "");
  return {
    enabled: enabled(values.enabled), server: String(values.server || "").trim(), share: String(values.share || "").trim(),
    domain: String(values.domain || "").trim(), username: String(values.username || "").trim(),
    password: passwordEncrypted ? decryptBackupV3Secret(passwordEncrypted) : "", incomingSubfolder, processedSubfolder, failedSubfolder,
    pollingIntervalSeconds: positive(values.polling_interval_seconds, 15, "Polling interval"), fileReadyDelaySeconds: positive(values.file_ready_delay_seconds, 15, "File-ready delay"),
  };
}

export async function readRequestScanSettings(): Promise<RequestScanSettings> {
  const map = await loadSettingsMap([REQUEST_SCAN_SETTINGS_CATEGORY]);
  return settingsFrom(map[REQUEST_SCAN_SETTINGS_CATEGORY] || {});
}

export async function readRequestScanSettingsForDisplay(): Promise<Omit<RequestScanSettings, "password"> & { passwordConfigured: boolean }> {
  const map = await loadSettingsMap([REQUEST_SCAN_SETTINGS_CATEGORY]);
  const values = map[REQUEST_SCAN_SETTINGS_CATEGORY] || {};
  const value = settingsFrom(values);
  const { password: _password, ...display } = value;
  return { ...display, passwordConfigured: Boolean(values.password_encrypted) };
}

export async function saveRequestScanSettings(input: Record<string, unknown>, userId: UserId): Promise<ReturnType<typeof readRequestScanSettingsForDisplay>> {
  const currentMap = await loadSettingsMap([REQUEST_SCAN_SETTINGS_CATEGORY]);
  const current = currentMap[REQUEST_SCAN_SETTINGS_CATEGORY] || {};
  const password = typeof input.password === "string" && input.password.trim() ? input.password : "";
  const candidate = {
    enabled: input.enabled ?? current.enabled ?? "disabled", server: String(input.server ?? current.server ?? "").trim(), share: String(input.share ?? current.share ?? "").trim(),
    domain: String(input.domain ?? current.domain ?? "").trim(), username: String(input.username ?? current.username ?? "").trim(),
    incomingSubfolder: String(input.incomingSubfolder ?? input.incoming_subfolder ?? current.incoming_subfolder ?? "Requests/Incoming").trim(),
    processedSubfolder: String(input.processedSubfolder ?? input.processed_subfolder ?? current.processed_subfolder ?? "Requests/Processed").trim(),
    failedSubfolder: String(input.failedSubfolder ?? input.failed_subfolder ?? current.failed_subfolder ?? "Requests/Failed").trim(),
    pollingIntervalSeconds: positive(input.pollingIntervalSeconds ?? input.polling_interval_seconds ?? current.polling_interval_seconds, 15, "Polling interval"),
    fileReadyDelaySeconds: positive(input.fileReadyDelaySeconds ?? input.file_ready_delay_seconds ?? current.file_ready_delay_seconds, 15, "File-ready delay"),
  };
  for (const folder of [candidate.incomingSubfolder, candidate.processedSubfolder, candidate.failedSubfolder]) validateBackupV3SmbConfig({ server: candidate.server || "placeholder", share: candidate.share || "placeholder", subfolder: folder, domain: candidate.domain, timeoutSeconds: 15 });
  if (enabled(candidate.enabled) && (!candidate.server || !candidate.share || !candidate.username || !(password || current.password_encrypted))) throw new HttpError(400, "SMB server, share, username, and password are required when automation is enabled.");
  await upsertSettings(REQUEST_SCAN_SETTINGS_CATEGORY, [
    { key: "enabled", value: enabled(candidate.enabled) ? "enabled" : "disabled" }, { key: "server", value: candidate.server }, { key: "share", value: candidate.share }, { key: "domain", value: candidate.domain }, { key: "username", value: candidate.username },
    { key: "incoming_subfolder", value: candidate.incomingSubfolder }, { key: "processed_subfolder", value: candidate.processedSubfolder }, { key: "failed_subfolder", value: candidate.failedSubfolder },
    { key: "polling_interval_seconds", value: String(candidate.pollingIntervalSeconds) }, { key: "file_ready_delay_seconds", value: String(candidate.fileReadyDelaySeconds) },
    ...(password ? [{ key: "password_encrypted", value: encryptBackupV3Secret(password) }] : []),
  ], userId);
  return readRequestScanSettingsForDisplay();
}
