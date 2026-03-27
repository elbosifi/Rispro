import { pool } from "../db/pool.js";
import { HttpError } from "../utils/http-error.js";

export async function listSettingsCatalog() {
  const { rows } = await pool.query(
    `
      select category, setting_key, setting_value, updated_at
      from system_settings
      order by category asc, setting_key asc
    `
  );

  const grouped = rows.reduce((accumulator, row) => {
    if (!accumulator[row.category]) {
      accumulator[row.category] = [];
    }

    accumulator[row.category].push(row);
    return accumulator;
  }, {});

  return grouped;
}

export async function getSettingsByCategory(category) {
  const { rows } = await pool.query(
    `
      select category, setting_key, setting_value, updated_at
      from system_settings
      where category = $1
      order by setting_key asc
    `,
    [category]
  );

  return rows;
}

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

      const { rows } = await client.query(
        `
          insert into system_settings (category, setting_key, setting_value, updated_by_user_id)
          values ($1, $2, $3::jsonb, $4)
          on conflict (category, setting_key)
          do update set
            setting_value = excluded.setting_value,
            updated_by_user_id = excluded.updated_by_user_id,
            updated_at = now()
          returning category, setting_key, setting_value, updated_at
        `,
        [category, entry.key, JSON.stringify(entry.value ?? {}), updatedByUserId]
      );

      results.push(rows[0]);
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
