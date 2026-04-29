import { normalizePublicBaseUrl } from "./public-cancel-config.js";

export interface PublicAppointmentUrlSettings {
  risproPublicBaseUrl: string;
}

export function buildPublicAppointmentUrlFromSettings(
  token: string,
  settings: PublicAppointmentUrlSettings
): string {
  const cleanToken = String(token || "").trim();
  if (!cleanToken) return "";
  const configuredBaseUrl = String(settings.risproPublicBaseUrl || "").trim();
  const fallbackBaseUrl = String(process.env.PUBLIC_APP_BASE_URL || "").trim();
  const baseUrl = normalizePublicBaseUrl(configuredBaseUrl || fallbackBaseUrl, "risproPublicBaseUrl or PUBLIC_APP_BASE_URL");
  return `${baseUrl}/public/appointment?t=${encodeURIComponent(cleanToken)}`;
}
