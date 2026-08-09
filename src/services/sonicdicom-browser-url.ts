import { isIP } from "node:net";
import { HttpError } from "../utils/http-error.js";
import type { SonicDicomReportSettings } from "./sonicdicom-report-settings.js";

export function isLocalSonicDicomRequestHostname(hostname: string): boolean {
  const normalized = String(hostname || "").trim().toLowerCase();
  const unbracketed = normalized.startsWith("[") && normalized.endsWith("]")
    ? normalized.slice(1, -1)
    : normalized;
  return unbracketed === "localhost" || isIP(unbracketed) !== 0;
}

function validatedBrowserBaseUrl(value: string, label: string): string {
  const trimmed = String(value || "").trim();
  if (!trimmed) throw new HttpError(503, `${label} is not configured.`);
  try {
    const parsed = new URL(trimmed);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") throw new Error("Unsupported protocol");
    return parsed.toString().replace(/\/$/, "");
  } catch {
    throw new HttpError(503, `${label} is malformed.`);
  }
}

export function resolveSonicDicomBrowserBaseUrl(
  hostname: string,
  settings: SonicDicomReportSettings
): string {
  const useLocal = isLocalSonicDicomRequestHostname(hostname) && settings.sonicDicomLocalBaseUrl.trim();
  return useLocal
    ? validatedBrowserBaseUrl(settings.sonicDicomLocalBaseUrl, "Local SonicDICOM browser URL")
    : validatedBrowserBaseUrl(settings.sonicDicomPublicBaseUrl, "Public SonicDICOM browser URL");
}
