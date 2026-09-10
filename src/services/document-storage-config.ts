import { HttpError } from "../utils/http-error.js";
import { loadSettingsMap } from "./settings-service.js";

export interface DocumentStorageConfig {
  storagePath: string;
  authUsername: string;
  authPassword: string;
  authDomain: string;
  fallbackEnabled: boolean;
}

export function isTruthyDocumentStorageFlag(raw: unknown): boolean {
  return ["true", "1", "yes", "enabled", "on"].includes(String(raw || "").trim().toLowerCase());
}

export async function loadDocumentStorageConfig(): Promise<DocumentStorageConfig> {
  const settingsMap = await loadSettingsMap(["documents_and_uploads"]);
  const settings = settingsMap.documents_and_uploads || {};
  return {
    storagePath: String(settings.storage_path || "").trim(),
    authUsername: String(settings.storage_auth_username || "").trim(),
    authPassword: String(settings.storage_auth_password || ""),
    authDomain: String(settings.storage_auth_domain || "").trim(),
    fallbackEnabled: isTruthyDocumentStorageFlag(settings.storage_fallback_enabled || "true"),
  };
}

export function buildNetworkAuthUsername(config: DocumentStorageConfig): string {
  if (!config.authUsername) return "";
  if (!config.authDomain) return config.authUsername;
  return `${config.authDomain}\\${config.authUsername}`;
}

export function ensureNetworkAuthIfNeeded(config: DocumentStorageConfig): void {
  const rawPath = String(config.storagePath || "");
  if (!rawPath || (!rawPath.startsWith("\\\\") && !rawPath.startsWith("//"))) return;
  if (!config.authUsername || !config.authPassword) {
    throw new HttpError(503, "Network storage path requires authentication credentials.");
  }
}
