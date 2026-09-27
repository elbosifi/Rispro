import { getPublicAppBaseUrl } from "../../../../config/public-app-url.js";

export function buildPublicAppointmentUrl(token: string): string {
  const cleanToken = String(token || "").trim();
  if (!cleanToken) return "";
  return `${getPublicAppBaseUrl()}/public/appointment?t=${encodeURIComponent(cleanToken)}`;
}
