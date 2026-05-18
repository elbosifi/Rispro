import test from "node:test";
import assert from "node:assert/strict";
import bcrypt from "bcryptjs";
import { pool } from "../db/pool.js";
import {
  deletePatientNotAllowedNameWord,
  listPatientNotAllowedNameWords,
  upsertPatientNotAllowedNameWord
} from "./patient-not-allowed-name-words-service.js";

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

test("not-allowed name words: add, list, and delete", async (t) => {
  if (!(await ensureDbOrSkip(t))) return;

  const suffix = uniqueSuffix();
  const username = `blocked_word_${suffix}`;
  const user = await pool.query<{ id: number }>(
    `
      insert into users (username, full_name, password_hash, role, is_active)
      values ($1, $2, $3, 'supervisor', true)
      returning id
    `,
    [username, `Blocked Word ${suffix}`, bcrypt.hashSync("test-pass", 10)]
  );
  const userId = Number(user.rows[0]?.id);
  let entryId: number | null = null;

  try {
    const entry = await upsertPatientNotAllowedNameWord({ arabicText: `اختبار${suffix}` }, userId);
    entryId = entry.id;
    assert.equal(entry.is_active, true);

    const entries = await listPatientNotAllowedNameWords();
    assert.ok(entries.some((item) => item.id === entry.id));

    const deleted = await deletePatientNotAllowedNameWord(entry.id, userId);
    entryId = null;
    assert.equal(deleted.id, entry.id);
  } finally {
    if (entryId) {
      await pool.query(`delete from patient_not_allowed_name_words where id = $1`, [entryId]);
    }
    await pool.query(`delete from audit_log where changed_by_user_id = $1`, [userId]);
    await pool.query(`delete from users where id = $1`, [userId]);
  }
});
