import { getPublicAppBaseUrl } from "./public-cancel-config.js";

export function buildPublicAppointmentUrl(token: string): string {
  const cleanToken = String(token || "").trim();
  if (!cleanToken) return "";
  return `${getPublicAppBaseUrl()}/public/appointment?t=${encodeURIComponent(cleanToken)}`;
}
