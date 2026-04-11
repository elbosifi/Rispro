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
  setting_value: { value?: unknown } | null;
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

    accumulator[row.category][row.setting_key] = String(row.setting_value?.value ?? "");
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
        [category, entry.key, JSON.stringify(entry.value ?? {}), updatedByUserId]
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

    await client.query("commit");
    
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
