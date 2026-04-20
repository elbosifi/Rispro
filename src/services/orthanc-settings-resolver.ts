import { env } from "../config/env.js";
import { pool } from "../db/pool.js";
import { loadSettingsMap } from "./settings-service.js";
import { normalizeOptionalText } from "../utils/normalize.js";

export const ORTHANC_MWL_DEFAULTS: Record<string, string> = {
  enabled: "false",
  shadow_mode: "false",
  base_url: "",
  username: "",
  password: "",
  timeout_seconds: "10",
  verify_tls: "true",
  worklist_target: "",
};

export interface ResolvedOrthancSettings {
  enabled: boolean;
  shadowMode: boolean;
  baseUrl: string;
  username: string;
  password: string;
  timeoutSeconds: number;
  verifyTls: boolean;
  worklistTarget: string;
}

function parseBoolean(value: string | undefined, fallback: boolean): boolean {
  const normalized = String(value ?? "").trim().toLowerCase();
  if (!normalized) return fallback;
  if (["true", "1", "yes", "enabled"].includes(normalized)) return true;
  if (["false", "0", "no", "disabled"].includes(normalized)) return false;
  return fallback;
}

function parsePositiveInteger(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) return fallback;
  return parsed;
}

export async function seedOrthancMwlDefaultsIfMissing(): Promise<void> {
  const { rows } = await pool.query(
    `
      select setting_key
      from system_settings
      where category = 'orthanc_mwl_sync'
    `
  );
  const existing = new Set(rows.map((row) => String((row as { setting_key: string }).setting_key)));
  const missingKeys = Object.keys(ORTHANC_MWL_DEFAULTS).filter((key) => !existing.has(key));

  if (missingKeys.length === 0) {
    return;
  }

  const client = await pool.connect();
  try {
    await client.query("begin");
    for (const key of missingKeys) {
      await client.query(
        `
          insert into system_settings (category, setting_key, setting_value)
          values ('orthanc_mwl_sync', $1, $2::jsonb)
          on conflict (category, setting_key) do nothing
        `,
        [key, JSON.stringify({ value: ORTHANC_MWL_DEFAULTS[key] })]
      );
    }
    await client.query("commit");
  } catch (error) {
    await client.query("rollback");
    throw error;
  } finally {
    client.release();
  }
}

export async function resolveOrthancSettings(): Promise<ResolvedOrthancSettings> {
  const map = await loadSettingsMap(["orthanc_mwl_sync"]);
  const db = map.orthanc_mwl_sync || {};
  const enabled = parseBoolean(db.enabled, env.orthancMwlEnabled);
  const baseUrl = normalizeOptionalText(db.base_url) || env.orthancBaseUrl;

  if (enabled && !baseUrl) {
    throw new Error("Orthanc MWL is enabled but base_url is empty.");
  }

  return {
    enabled,
    shadowMode: parseBoolean(db.shadow_mode, env.orthancMwlShadowMode),
    baseUrl,
    username: normalizeOptionalText(db.username) || env.orthancUsername,
    password: normalizeOptionalText(db.password) || env.orthancPassword,
    timeoutSeconds: parsePositiveInteger(db.timeout_seconds, env.orthancTimeoutSeconds),
    verifyTls: parseBoolean(db.verify_tls, env.orthancVerifyTls),
    worklistTarget: normalizeOptionalText(db.worklist_target) || env.orthancWorklistTarget,
  };
}
