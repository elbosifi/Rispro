import { env } from "../config/env.js";
import { pool } from "../db/pool.js";
import { HttpError } from "../utils/http-error.js";
import { loadSettingsMap } from "./settings-service.js";
import { normalizeOptionalText } from "../utils/normalize.js";

export const ORTHANC_MWL_DEFAULTS: Record<string, string> = {
  enabled: "false",
  shadow_mode: "false",
  connection_mode: "external",
  base_url: "",
  username: "",
  password: "",
  timeout_seconds: "10",
  verify_tls: "true",
  worklist_target: "",
  strategy_preference: "put_first",
};

export interface ResolvedOrthancSettings {
  enabled: boolean;
  shadowMode: boolean;
  connectionMode: "internal" | "external";
  baseUrl: string;
  username: string;
  password: string;
  timeoutSeconds: number;
  verifyTls: boolean;
  worklistTarget: string;
  strategyPreference: "put_first" | "post_first";
}

export interface OrthancSettingsEntryInput {
  key: string;
  value?: unknown;
}

const ORTHANC_BOOLEAN_KEYS = new Set(["enabled", "shadow_mode", "verify_tls"]);
const ORTHANC_ALLOWED_KEYS = new Set(Object.keys(ORTHANC_MWL_DEFAULTS));
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

function extractSettingString(value: unknown): string {
  if (value && typeof value === "object" && "value" in (value as Record<string, unknown>)) {
    return String((value as Record<string, unknown>).value ?? "").trim();
  }
  return String(value ?? "").trim();
}

function normalizeWorklistTargetValue(raw: string): string {
  const normalized = raw.trim().toUpperCase();
  if (!normalized || normalized === "RISPRO_MWL") {
    return "";
  }
  return normalized;
}

function ensureBooleanLike(raw: string, key: string): void {
  const normalized = raw.toLowerCase();
  if (!normalized) return;
  if (["true", "false", "1", "0", "yes", "no", "enabled", "disabled"].includes(normalized)) return;
  throw new HttpError(400, `orthanc_mwl_sync.${key} must be a boolean-like value.`);
}

export function validateOrthancSettingsEntries(entries: OrthancSettingsEntryInput[]): void {
  if (!Array.isArray(entries) || entries.length === 0) {
    throw new HttpError(400, "orthanc_mwl_sync entries must be a non-empty array.");
  }

  const incoming = new Map<string, string>();
  for (const entry of entries) {
    const key = String(entry.key || "").trim();
    if (!key) {
      throw new HttpError(400, "Each orthanc_mwl_sync entry must include a key.");
    }
    if (!ORTHANC_ALLOWED_KEYS.has(key)) {
      throw new HttpError(400, `Unsupported orthanc_mwl_sync key: ${key}`);
    }
    incoming.set(key, extractSettingString(entry.value));
  }

  for (const key of ORTHANC_BOOLEAN_KEYS) {
    if (incoming.has(key)) {
      ensureBooleanLike(incoming.get(key) || "", key);
    }
  }

  if (incoming.has("strategy_preference")) {
    const strategy = incoming.get("strategy_preference") || "";
    if (strategy !== "put_first" && strategy !== "post_first") {
      throw new HttpError(400, `orthanc_mwl_sync.strategy_preference must be "put_first" or "post_first".`);
    }
  }

  if (incoming.has("connection_mode")) {
    const mode = incoming.get("connection_mode") || "";
    if (mode !== "internal" && mode !== "external") {
      throw new HttpError(400, `orthanc_mwl_sync.connection_mode must be "internal" or "external".`);
    }
  }

  if (incoming.has("timeout_seconds")) {
    const timeoutRaw = incoming.get("timeout_seconds") || "";
    const timeout = Number(timeoutRaw);
    if (!Number.isInteger(timeout) || timeout <= 0) {
      throw new HttpError(400, "orthanc_mwl_sync.timeout_seconds must be a positive integer.");
    }
  }

  const enabledRaw = incoming.get("enabled");
  const enabled = enabledRaw == null ? null : parseBoolean(enabledRaw, false);
  const connectionMode = incoming.get("connection_mode") || "external";
  const baseUrlRaw = incoming.get("base_url");

  if (enabled === true && connectionMode === "external" && baseUrlRaw != null && !baseUrlRaw.trim()) {
    throw new HttpError(400, "orthanc_mwl_sync.base_url is required when enabled=true.");
  }
}

export function normalizeOrthancSettingsEntries(entries: OrthancSettingsEntryInput[]): OrthancSettingsEntryInput[] {
  return entries.map((entry) => {
    const key = String(entry.key || "").trim();
    if (key === "worklist_target") {
      const current = extractSettingString(entry.value);
      const normalized = normalizeWorklistTargetValue(current);
      return {
        ...entry,
        value: { value: normalized },
      };
    }

    if (key === "connection_mode") {
      const current = extractSettingString(entry.value).toLowerCase();
      return {
        ...entry,
        value: { value: current === "internal" ? "internal" : "external" },
      };
    }

    return entry;
  });
}

function parseStrategyPreference(value: string | undefined, fallback: "put_first" | "post_first"): "put_first" | "post_first" {
  const normalized = String(value ?? "").trim().toLowerCase();
  if (normalized === "post_first") return "post_first";
  if (normalized === "put_first") return "put_first";
  return fallback;
}

function parseConnectionMode(value: string | undefined, fallback: "internal" | "external"): "internal" | "external" {
  const normalized = String(value ?? "").trim().toLowerCase();
  if (normalized === "internal") return "internal";
  if (normalized === "external") return "external";
  return fallback;
}

export async function resolveOrthancSettings(): Promise<ResolvedOrthancSettings> {
  const map = await loadSettingsMap(["orthanc_mwl_sync"]);
  const db = map.orthanc_mwl_sync || {};
  const enabled = parseBoolean(db.enabled, env.orthancMwlEnabled);
  const defaultConnectionMode = env.risproDicomMode === "orthanc_internal" ? "internal" : "external";
  const connectionMode = parseConnectionMode(db.connection_mode, defaultConnectionMode);
  const internalBaseUrl = normalizeOptionalText(env.orthancBaseUrl) || "http://orthanc:8042";
  const externalBaseUrlFallback = env.risproDicomMode === "orthanc_external" ? env.orthancBaseUrl : "";
  const baseUrl = connectionMode === "internal"
    ? internalBaseUrl
    : (normalizeOptionalText(db.base_url) || externalBaseUrlFallback);

  if (enabled && connectionMode === "internal" && env.risproDicomMode !== "orthanc_internal") {
    throw new Error("Orthanc MWL is set to internal mode but RISPRO_DICOM_MODE is not orthanc_internal.");
  }

  if (enabled && !baseUrl) {
    throw new Error("Orthanc MWL is enabled but base_url is empty.");
  }

  return {
    enabled,
    shadowMode: parseBoolean(db.shadow_mode, env.orthancMwlShadowMode),
    connectionMode,
    baseUrl,
    username: connectionMode === "external" && env.orthancAuthEnabled ? normalizeOptionalText(db.username) || env.orthancUsername : "",
    password: connectionMode === "external" && env.orthancAuthEnabled ? normalizeOptionalText(db.password) || env.orthancPassword : "",
    timeoutSeconds: parsePositiveInteger(db.timeout_seconds, env.orthancTimeoutSeconds),
    verifyTls: parseBoolean(db.verify_tls, env.orthancVerifyTls),
    worklistTarget: normalizeWorklistTargetValue(normalizeOptionalText(db.worklist_target) || env.orthancWorklistTarget),
    strategyPreference: parseStrategyPreference(db.strategy_preference, "put_first"),
  };
}
