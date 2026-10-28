/*
 * LEGACY APPOINTMENTS / SCHEDULING MODULE
 * This file belongs to the legacy scheduling system.
 * Do not add new scheduling features here.
 * New scheduling and booking work must go into Appointments V2.
 * Legacy code may only receive:
 * - critical bug containment
 * - temporary compatibility fixes explicitly requested
 * - reference-only maintenance
 */

import { pool } from "../db/pool.js";
import { HttpError } from "../utils/http-error.js";
import { invalidateAllCache } from "../utils/cache.js";
import { parseNaps2WebscanAllowedOrigins } from "../config/env.js";
import { configureNaps2ConnectOrigins } from "../config/naps2.js";
import { validateNaps2SetupOrigin, validateNaps2FirewallSources } from "./scanner-bootstrap-service.js";
import { logAuditEntry } from "./audit-service.js";
import type { UserId } from "../types/http.js";
import type { CategorySettings, GroupedSettings, SettingsMap } from "../types/settings.js";

export interface SettingsRow {
  id: number;
  category: string;
  setting_key: string;
  setting_value: unknown;
  updated_at: string;
}

interface SettingsMapRow {
  category: string;
  setting_key: string;
  setting_value: unknown;
}

function extractSettingScalar(settingValue: unknown): string {
  if (settingValue && typeof settingValue === "object" && !Array.isArray(settingValue)) {
    const record = settingValue as { value?: unknown };
    return String(record.value ?? "");
  }
  return String(settingValue ?? "");
}

const DOCUMENT_HA_RETENTION_MIN_HOURS = 24;
const DOCUMENT_HA_RETENTION_MAX_HOURS = 168;

function validateSettingValue(category: string, key: string, value: unknown): void {
  if (category === "fast_preview") {
    const scalar = extractSettingScalar(value).trim();
    if (key === "jpeg_quality" && /^(?:[3-8][0-9]|9[0-5])$/.test(scalar)) return;
    if (key === "maximum_image_width" && ["256", "384", "512", "768", "1024"].includes(scalar)) return;
    throw new HttpError(400, "Invalid Fast Preview setting.");
  }
  if (category === "documents_and_uploads") {
    const scalar = extractSettingScalar(value).trim();
    try {
      if (key === "scanner_source" && !["auto", "feeder", "flatbed", "duplex"].includes(scalar)) {
        throw new Error("scanner_source must be auto, feeder, flatbed or duplex.");
      }
      if (key === "scan_dpi") {
        const dpi = Number(scalar);
        if (!Number.isInteger(dpi) || dpi < 50 || dpi > 1200) {
          throw new Error("scan_dpi must be an integer between 50 and 1200.");
        }
      }
      if (key === "naps2_setup_rispro_origin" && scalar) validateNaps2SetupOrigin(scalar);
      if (key === "naps2_setup_firewall_sources") validateNaps2FirewallSources(scalar);
      if ((key === "naps2_webscan_endpoint" || key === "naps2_webscan_allowed_origins") && scalar) {
        const origins = scalar.split(",").map((origin) => origin.trim()).filter(Boolean);
        if (!origins.length || (key === "naps2_webscan_endpoint" && origins.length !== 1) || origins.some((origin) => parseNaps2WebscanAllowedOrigins(origin).length !== 1)) throw new Error("Scanner endpoints must be exact HTTP/HTTPS origins without credentials, paths or wildcards.");
      }
      if (key === "naps2_webscan_enabled" && !["enabled", "disabled"].includes(scalar.toLowerCase())) throw new Error("NAPS2 scanning must be enabled or disabled.");
    } catch (error) { throw new HttpError(400, error instanceof Error ? error.message : "Invalid NAPS2 settings."); }
  }
  if (category !== "documents_and_uploads" || key !== "ha_hot_storage_retention_hours") return;
  const parsed = Number(extractSettingScalar(value).trim());
  if (!Number.isInteger(parsed) || parsed < DOCUMENT_HA_RETENTION_MIN_HOURS || parsed > DOCUMENT_HA_RETENTION_MAX_HOURS) {
    throw new HttpError(400, `ha_hot_storage_retention_hours must be an integer between ${DOCUMENT_HA_RETENTION_MIN_HOURS} and ${DOCUMENT_HA_RETENTION_MAX_HOURS}.`);
  }
}

export async function loadSettingsMap(categories: string[]): Promise<SettingsMap> {
  const { rows } = await pool.query(
    `
      select category, setting_key, setting_value
      from system_settings
      where category = any($1::text[])
    `,
    [categories]
  );

  const settingRows = rows as SettingsMapRow[];

  return settingRows.reduce((accumulator, row) => {
    if (!accumulator[row.category]) {
      accumulator[row.category] = {} as CategorySettings;
    }

    accumulator[row.category][row.setting_key] = extractSettingScalar(row.setting_value);
    return accumulator;
  }, {} as SettingsMap);
}

export interface SettingsEntryInput {
  key: string;
  value?: unknown;
}

export async function listSettingsCatalog(): Promise<GroupedSettings<SettingsRow>> {
  const { rows } = await pool.query(
    `
      select id, category, setting_key, setting_value, updated_at
      from system_settings
      where category not in ('medgemma','gamma_knife')
      order by category asc, setting_key asc
    `
  );
  const settingsRows = rows as SettingsRow[];

  const grouped = settingsRows.reduce((accumulator: GroupedSettings<SettingsRow>, row: SettingsRow) => {
    if (!accumulator[row.category]) {
      accumulator[row.category] = [];
    }

    accumulator[row.category].push(row);
    return accumulator;
  }, {} as GroupedSettings<SettingsRow>);

  return grouped;
}

export async function getSettingsByCategory(category: string): Promise<SettingsRow[]> {
  if (category === "medgemma") throw new HttpError(404, "MedGemma settings have a dedicated endpoint.");
  if (category === 'gamma_knife') throw new HttpError(404, 'Gamma Knife settings have a dedicated endpoint.');
  const { rows } = await pool.query(
    `
      select id, category, setting_key, setting_value, updated_at
      from system_settings
      where category = $1
      order by setting_key asc
    `,
    [category]
  );

  return rows as SettingsRow[];
}

export async function upsertSettings(
  category: string,
  entries: SettingsEntryInput[],
  updatedByUserId: UserId
): Promise<SettingsRow[]> {
  if (category === "medgemma") throw new HttpError(404, "MedGemma settings have a dedicated endpoint.");
  if (category === 'gamma_knife') throw new HttpError(404, 'Gamma Knife settings have a dedicated endpoint.');
  if (!Array.isArray(entries) || entries.length === 0) {
    throw new HttpError(400, "entries must be a non-empty array.");
  }

  const client = await pool.connect();

  try {
    await client.query("begin");

    const results: SettingsRow[] = [];

    for (const entry of entries) {
      if (!entry.key) {
        throw new HttpError(400, "Each settings entry must include a key.");
      }
      validateSettingValue(category, entry.key, entry.value);

      const previousResult = await client.query(
        `
          select id, category, setting_key, setting_value, updated_at
          from system_settings
          where category = $1 and setting_key = $2
          limit 1
        `,
        [category, entry.key]
      );

      const previousSetting = (previousResult.rows[0] as SettingsRow) || null;

      const { rows } = await client.query(
        `
          insert into system_settings (category, setting_key, setting_value, updated_by_user_id)
          values ($1, $2, $3::jsonb, $4)
          on conflict (category, setting_key)
          do update set
            setting_value = excluded.setting_value,
            updated_by_user_id = excluded.updated_by_user_id,
            updated_at = now()
          returning id, category, setting_key, setting_value, updated_at
        `,
        [
          category,
          entry.key,
          JSON.stringify(
            entry.value && typeof entry.value === "object" && !Array.isArray(entry.value) && "value" in (entry.value as Record<string, unknown>)
              ? entry.value
              : { value: entry.value ?? "" }
          ),
          updatedByUserId
        ]
      );
      const savedRow = rows[0] as SettingsRow | undefined;

      if (!savedRow) {
        throw new HttpError(500, "Failed to save setting.");
      }

      await logAuditEntry(
        {
          entityType: "system_setting",
          entityId: savedRow.id,
          actionType: "upsert",
          oldValues: previousSetting,
          newValues: savedRow,
          changedByUserId: updatedByUserId
        },
        client
      );

      results.push(savedRow);
    }

    let scannerSettings: CategorySettings | undefined;
    if (category === "documents_and_uploads") {
      const snapshot = await client.query<SettingsMapRow>("select category, setting_key, setting_value from system_settings where category = $1", [category]);
      scannerSettings = Object.fromEntries(snapshot.rows.map((row) => [row.setting_key, extractSettingScalar(row.setting_value)]));
    }
    await client.query("commit");
    if (scannerSettings) configureNaps2ConnectOrigins(scannerSettings);
    
    // Invalidate cache when settings are updated
    invalidateAllCache();
    
    return results;
  } catch (error) {
    await client.query("rollback");
    throw error;
  } finally {
    client.release();
  }
}
