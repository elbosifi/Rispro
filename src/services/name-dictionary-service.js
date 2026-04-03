// @ts-check

import { pool } from "../db/pool.js";
import { HttpError } from "../utils/http-error.js";
import { logAuditEntry } from "./audit-service.js";

/**
 * @typedef NameDictionaryRow
 * @property {number} id
 * @property {string} arabic_text
 * @property {string} english_text
 * @property {boolean} is_active
 * @property {string} created_at
 */

/**
 * @typedef NameDictionaryPayload
 * @property {string} [arabicText]
 * @property {string} [englishText]
 * @property {boolean | string | number | null} [isActive]
 */

/**
 * @param {unknown} value
 * @param {string} fieldName
 */
function normalizeDictionaryText(value, fieldName) {
  const clean = String(value || "").trim();

  if (!clean) {
    throw new HttpError(400, `${fieldName} is required.`);
  }

  return clean;
}

/**
 * @param {boolean | string | number | null | undefined} value
 */
function normalizeActiveFlag(value) {
  if (value === undefined || value === null || value === "") {
    return true;
  }

  if (typeof value === "boolean") {
    return value;
  }

  return String(value).trim().toLowerCase() !== "false";
}

/**
 * @param {{ includeInactive?: boolean }} [options]
 */
export async function listNameDictionary({ includeInactive = false } = {}) {
  const { rows } = await pool.query(
    `
      select id, arabic_text, english_text, is_active, created_at
      from name_dictionary
      ${includeInactive ? "" : "where is_active = true"}
      order by arabic_text asc
    `
  );

  return /** @type {NameDictionaryRow[]} */ (rows);
}

/**
 * @param {NameDictionaryPayload | null | undefined} payload
 * @param {number | string} currentUserId
 */
export async function upsertNameDictionary(payload, currentUserId) {
  const arabicText = normalizeDictionaryText(payload?.arabicText, "arabicText");
  const englishText = normalizeDictionaryText(payload?.englishText, "englishText");
  const isActive = normalizeActiveFlag(payload?.isActive);

  const { rows } = await pool.query(
    `
      insert into name_dictionary (arabic_text, english_text, is_active)
      values ($1, $2, $3)
      on conflict (arabic_text)
      do update set english_text = excluded.english_text, is_active = excluded.is_active
      returning id, arabic_text, english_text, is_active, created_at
    `,
    [arabicText, englishText, isActive]
  );

  const entry = /** @type {NameDictionaryRow} */ (rows[0]);

  await logAuditEntry({
    entityType: "name_dictionary",
    entityId: entry.id,
    actionType: "upsert",
    oldValues: null,
    newValues: entry,
    changedByUserId: currentUserId
  });

  return entry;
}

/**
 * @param {number | string} entryId
 * @param {NameDictionaryPayload | null | undefined} payload
 * @param {number | string} currentUserId
 */
export async function updateNameDictionaryEntry(entryId, payload, currentUserId) {
  const cleanEntryId = Number(entryId);

  if (!Number.isInteger(cleanEntryId) || cleanEntryId <= 0) {
    throw new HttpError(400, "entryId must be a positive whole number.");
  }

  const { rows: existingRows } = await pool.query(
    `
      select id, arabic_text, english_text, is_active, created_at
      from name_dictionary
      where id = $1
      limit 1
    `,
    [cleanEntryId]
  );

  const existing = /** @type {NameDictionaryRow | undefined} */ (existingRows[0]);

  if (!existing) {
    throw new HttpError(404, "Dictionary entry not found.");
  }

  const englishText = payload?.englishText ? normalizeDictionaryText(payload.englishText, "englishText") : existing.english_text;
  const isActive = payload?.isActive === undefined ? existing.is_active : normalizeActiveFlag(payload.isActive);

  const { rows } = await pool.query(
    `
      update name_dictionary
      set english_text = $2,
          is_active = $3
      where id = $1
      returning id, arabic_text, english_text, is_active, created_at
    `,
    [cleanEntryId, englishText, isActive]
  );

  const updated = /** @type {NameDictionaryRow} */ (rows[0]);

  await logAuditEntry({
    entityType: "name_dictionary",
    entityId: updated.id,
    actionType: "update",
    oldValues: existing,
    newValues: updated,
    changedByUserId: currentUserId
  });

  return updated;
}

/**
 * @param {number | string} entryId
 * @param {number | string} currentUserId
 */
export async function deleteNameDictionaryEntry(entryId, currentUserId) {
  const cleanEntryId = Number(entryId);

  if (!Number.isInteger(cleanEntryId) || cleanEntryId <= 0) {
    throw new HttpError(400, "entryId must be a positive whole number.");
  }

  const { rows } = await pool.query(
    `
      delete from name_dictionary
      where id = $1
      returning id, arabic_text, english_text, is_active, created_at
    `,
    [cleanEntryId]
  );

  const removed = /** @type {NameDictionaryRow | undefined} */ (rows[0]);

  if (!removed) {
    throw new HttpError(404, "Dictionary entry not found.");
  }

  await logAuditEntry({
    entityType: "name_dictionary",
    entityId: removed.id,
    actionType: "delete",
    oldValues: removed,
    newValues: null,
    changedByUserId: currentUserId
  });

  return removed;
}

/**
 * @param {Array<NameDictionaryPayload | null | undefined>} entries
 * @param {number | string} currentUserId
 */
export async function importNameDictionaryEntries(entries, currentUserId) {
  if (!Array.isArray(entries) || !entries.length) {
    throw new HttpError(400, "entries must be a non-empty array.");
  }

  const imported = [];

  for (const entry of entries) {
    const normalizedEntry = {
      arabicText: entry?.arabicText,
      englishText: entry?.englishText,
      isActive: entry?.isActive
    };
    const result = await upsertNameDictionary(normalizedEntry, currentUserId);
    imported.push(result);
  }

  return imported;
}
