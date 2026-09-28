import { getPublicAppBaseUrl } from "../../../../config/public-app-url.js";

export function buildPublicAppointmentUrlForBaseUrl(token: string, publicBaseUrl: string): string {
  const cleanToken = String(token || "").trim();
  if (!cleanToken) return "";
  return `${publicBaseUrl}/public/appointment?t=${encodeURIComponent(cleanToken)}`;
}

export async function buildPublicAppointmentUrl(token: string): Promise<string> {
  return buildPublicAppointmentUrlForBaseUrl(token, await getPublicAppBaseUrl());
}
