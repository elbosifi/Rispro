import { pool } from "../db/pool.js";

export const PUBLIC_APP_URL_CATEGORY = "deployment_identity";
export const PUBLIC_APP_URL_KEY = "public_app_base_url";
export const PUBLIC_APP_URL_SETTING = `${PUBLIC_APP_URL_CATEGORY}.${PUBLIC_APP_URL_KEY}`;

function isPrivateOrLocalHost(hostname: string): boolean {
  const normalized = String(hostname || "").trim().toLowerCase();
  if (!normalized) return true;
  if (normalized === "localhost" || normalized === "::1" || normalized.endsWith(".local")) return true;
  if (/^127\./.test(normalized)) return true;
  if (/^10\./.test(normalized)) return true;
  if (/^192\.168\./.test(normalized)) return true;
  const private172 = normalized.match(/^172\.(\d{1,3})\./);
  if (private172) {
    const secondOctet = Number(private172[1]);
    if (secondOctet >= 16 && secondOctet <= 31) return true;
  }
  return false;
}

function parsePublicAppBaseUrl(rawValue: string, settingName = PUBLIC_APP_URL_SETTING): URL {
  const trimmed = String(rawValue || "").trim();
  if (!trimmed) throw new Error(`Missing required public base URL setting: ${settingName}`);

  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    throw new Error(`${settingName} must be an absolute URL.`);
  }

  if (parsed.username || parsed.password || parsed.search || parsed.hash || (parsed.pathname !== "/" && parsed.pathname !== "")) {
    throw new Error(`${settingName} must contain only an origin.`);
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") throw new Error(`${settingName} must use HTTP or HTTPS.`);

  const isProduction = String(process.env.NODE_ENV || "").toLowerCase() === "production";
  if (isProduction && parsed.protocol !== "https:") {
    throw new Error(`${settingName} must use https in production.`);
  }
  if (isProduction && isPrivateOrLocalHost(parsed.hostname)) {
    throw new Error(`${settingName} cannot use localhost or private IP hosts in production.`);
  }
  return parsed;
}

export function normalizePublicAppBaseUrl(rawValue: string, settingName = PUBLIC_APP_URL_SETTING): string {
  return parsePublicAppBaseUrl(rawValue, settingName).origin;
}

function settingScalar(settingValue: unknown): string {
  if (settingValue && typeof settingValue === "object" && !Array.isArray(settingValue) && "value" in settingValue) {
    return String((settingValue as { value?: unknown }).value ?? "");
  }
  return String(settingValue ?? "");
}

export async function getPublicAppBaseUrl(): Promise<string> {
  const { rows } = await pool.query<{ setting_value: unknown }>(
    `select setting_value from system_settings where category = $1 and setting_key = $2 limit 1`,
    [PUBLIC_APP_URL_CATEGORY, PUBLIC_APP_URL_KEY]
  );
  return normalizePublicAppBaseUrl(settingScalar(rows[0]?.setting_value));
}

export async function tryGetPublicAppBaseUrl(): Promise<string | null> {
  try { return await getPublicAppBaseUrl(); } catch { return null; }
}

export async function getPublicAppOrigin(options: { requireHttps?: boolean } = {}): Promise<string> {
  const origin = await getPublicAppBaseUrl();
  if (options.requireHttps && !origin.startsWith("https://")) throw new Error(`${PUBLIC_APP_URL_SETTING} must use HTTPS.`);
  return origin;
}
