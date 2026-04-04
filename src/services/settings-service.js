// @ts-check

import { pool } from "../db/pool.js";
import { HttpError } from "../utils/http-error.js";
import { logAuditEntry } from "./audit-service.js";

/** @typedef {import("../types/http.js").UserId} UserId */
/** @typedef {import("../types/settings.js").GroupedSettings<SettingsRow>} SettingsCatalog */

/**
 * @typedef SettingsRow
 * @property {number} id
 * @property {string} category
 * @property {string} setting_key
 * @property {unknown} setting_value
 * @property {string} updated_at
 */

/**
 * @typedef SettingsEntryInput
 * @property {string} key
 * @property {unknown} [value]
 */

/** @returns {Promise<SettingsCatalog>} */
export async function listSettingsCatalog() {
  const { rows } = await pool.query(
    `
      select id, category, setting_key, setting_value, updated_at
      from system_settings
      order by category asc, setting_key asc
    `
  );
  const settingsRows = /** @type {SettingsRow[]} */ (rows);

  const grouped = settingsRows.reduce((accumulator, row) => {
    if (!accumulator[row.category]) {
      accumulator[row.category] = [];
    }

    accumulator[row.category].push(row);
    return accumulator;
  }, /** @type {SettingsCatalog} */ ({}));

  return grouped;
}

/**
 * @param {string} category
 * @returns {Promise<SettingsRow[]>}
 */
export async function getSettingsByCategory(category) {
  const { rows } = await pool.query(
    `
      select id, category, setting_key, setting_value, updated_at
      from system_settings
      where category = $1
      order by setting_key asc
    `,
    [category]
  );

  return /** @type {SettingsRow[]} */ (rows);
}

/**
 * @param {string} category
 * @param {SettingsEntryInput[]} entries
 * @param {UserId} updatedByUserId
 * @returns {Promise<SettingsRow[]>}
 */
export async function upsertSettings(category, entries, updatedByUserId) {
  if (!Array.isArray(entries) || entries.length === 0) {
    throw new HttpError(400, "entries must be a non-empty array.");
  }

  const client = await pool.connect();

  try {
    await client.query("begin");

    const results = [];

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

      const previousSetting = /** @type {SettingsRow | null} */ (previousResult.rows[0] || null);

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
      const savedRow = /** @type {SettingsRow | undefined} */ (rows[0]);

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
    return results;
  } catch (error) {
    await client.query("rollback");
    throw error;
  } finally {
    client.release();
  }
}
