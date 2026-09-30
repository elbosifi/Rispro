import test from "node:test";
import assert from "node:assert/strict";
import bcrypt from "bcryptjs";
import { pool } from "../db/pool.js";
import { invalidateCache } from "../utils/cache.js";
import { loadPatientNameDictionary } from "./patient-search-query.js";
import {
  deleteNameDictionaryEntry,
  updateNameDictionaryEntry,
  upsertNameDictionary
} from "./name-dictionary-service.js";

function uniqueSuffix(): string {
  return `${Date.now()}_${Math.floor(Math.random() * 100000)}`;
}

async function ensureDbOrSkip(t: { skip: (message?: string) => void }): Promise<boolean> {
  try {
    await pool.query("select 1");
    return true;
  } catch {
    t.skip("PostgreSQL is not reachable at configured DATABASE_URL.");
    return false;
  }
}

test("name dictionary mutations invalidate the patient-name dictionary cache", async (t) => {
  if (!(await ensureDbOrSkip(t))) return;

  const suffix = uniqueSuffix();
  const arabicToken = `اختبارذاكرة${suffix}`;
  const userRes = await pool.query<{ id: number }>(
    `
      insert into users (username, full_name, password_hash, role, is_active)
      values ($1, $2, $3, 'supervisor', true)
      returning id
    `,
    [`dictionary_cache_${suffix}`, `Dictionary Cache ${suffix}`, bcrypt.hashSync("test-pass", 10)]
  );
  const userId = Number(userRes.rows[0]?.id);
  let entryId = 0;

  try {
    await pool.query(`delete from name_dictionary where arabic_text = $1`, [arabicToken]);
    invalidateCache("name_dictionary");

    const beforeUpsert = await loadPatientNameDictionary();
    assert.equal(beforeUpsert.some((entry) => entry.arabic_text === arabicToken), false);

    const inserted = await upsertNameDictionary({ arabicText: arabicToken, englishText: "Initial" }, userId);
    entryId = Number(inserted.id);

    const afterUpsert = await loadPatientNameDictionary();
    assert.equal(afterUpsert.find((entry) => entry.arabic_text === arabicToken)?.english_text, "Initial");

    await updateNameDictionaryEntry(entryId, { englishText: "Updated", isActive: true }, userId);
    const afterUpdate = await loadPatientNameDictionary();
    assert.equal(afterUpdate.find((entry) => entry.arabic_text === arabicToken)?.english_text, "Updated");

    await deleteNameDictionaryEntry(entryId, userId);
    entryId = 0;
    const afterDelete = await loadPatientNameDictionary();
    assert.equal(afterDelete.some((entry) => entry.arabic_text === arabicToken), false);
  } finally {
    if (entryId > 0) {
      await pool.query(`delete from name_dictionary where id = $1`, [entryId]).catch(() => undefined);
    }
    invalidateCache("name_dictionary");
    await pool.query(`delete from audit_log where changed_by_user_id = $1`, [userId]).catch(() => undefined);
    await pool.query(`delete from users where id = $1`, [userId]).catch(() => undefined);
  }
});
