import { pool } from "../db/pool.js";
import { HttpError } from "../utils/http-error.js";

export const PASSKEY_SETTINGS_CATEGORY = "passkey";

export interface PasskeyConfiguration {
  rpName: string;
  rpId: string;
  origin: string;
}

function scalar(value: unknown): string {
  if (value && typeof value === "object" && !Array.isArray(value) && "value" in value) {
    return String((value as Record<string, unknown>).value ?? "").trim();
  }
  return String(value ?? "").trim();
}

export function validatePasskeyConfiguration(value: unknown): PasskeyConfiguration {
  const input = value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
  const rpName = String(input.rpName ?? "").trim();
  const origin = String(input.origin ?? "").trim();
  if (!rpName || rpName.length > 120) throw new HttpError(400, "Passkey relying-party name is required.");

  let parsedOrigin: URL;
  try {
    parsedOrigin = new URL(origin);
  } catch {
    throw new HttpError(400, "Passkey origin must be a valid HTTPS address.");
  }
  const localhost = parsedOrigin.hostname === "localhost" || parsedOrigin.hostname === "127.0.0.1" || parsedOrigin.hostname === "::1";
  if ((parsedOrigin.protocol !== "https:" && !localhost) || parsedOrigin.username || parsedOrigin.password || parsedOrigin.pathname !== "/" || parsedOrigin.search || parsedOrigin.hash) {
    throw new HttpError(400, "Passkey origin must be an HTTPS site address without a path.");
  }
  const rpId = parsedOrigin.hostname.toLowerCase();
  if (!rpId) throw new HttpError(400, "Passkey relying-party ID could not be determined from the origin.");
  return { rpName, rpId, origin: parsedOrigin.origin };
}

export async function readPasskeyConfiguration(): Promise<PasskeyConfiguration | null> {
  const { rows } = await pool.query<{ setting_key: string; setting_value: unknown }>(
    "select setting_key, setting_value from system_settings where category = $1",
    [PASSKEY_SETTINGS_CATEGORY]
  );
  const values = new Map(rows.map((row) => [row.setting_key, scalar(row.setting_value)]));
  if (!values.get("rp_name") || !values.get("origin")) return null;
  return validatePasskeyConfiguration({ rpName: values.get("rp_name"), origin: values.get("origin") });
}

export async function requirePasskeyConfiguration(): Promise<PasskeyConfiguration> {
  const configuration = await readPasskeyConfiguration();
  if (!configuration) throw new HttpError(503, "Passkeys are not configured. A super administrator must configure them in Settings.");
  return configuration;
}
