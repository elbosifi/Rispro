import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { fileURLToPath } from "node:url";

test("migration 220 creates isolated Teaching learner state with immutable snapshots and attempts", async (t) => {
  const [{ pool }, migrationSql] = await Promise.all([
    import("../pool.js"),
    readFile(fileURLToPath(new URL("./220_teaching_learner_sessions.sql", import.meta.url)), "utf8"),
  ]);

  try {
    await pool.query("select 1 from schema_migrations where filename = '220_teaching_learner_sessions.sql'");
  } catch {
    t.skip("The disposable PostgreSQL database has not run migration 220 yet.");
    return;
  }

  const client = await pool.connect();
  try {
    await client.query("begin");
    await client.query(migrationSql);
    await client.query(migrationSql);

    const tables = await client.query<{ table_name: string }>(
      `select table_name from information_schema.tables
       where table_schema = 'teaching' and table_name = any($1::text[]) order by table_name`,
      [["sessions", "session_questions", "attempts", "user_question_state", "bookmarks", "notes"]],
    );
    assert.deepEqual(tables.rows.map((row) => row.table_name), [
      "attempts", "bookmarks", "notes", "session_questions", "sessions", "user_question_state",
    ]);

    const publicTables = await client.query<{ table_name: string }>(
      `select table_name from information_schema.tables
       where table_schema = 'public' and table_name = any($1::text[])`,
      [["sessions", "session_questions", "attempts", "user_question_state", "bookmarks", "notes"]],
    );
    assert.deepEqual(publicTables.rows, []);

    const sessionConstraints = await client.query<{ definition: string }>(
      `select pg_get_constraintdef(item.oid) as definition from pg_constraint item
       join pg_class relation on relation.oid = item.conrelid
       join pg_namespace namespace on namespace.oid = relation.relnamespace
       where namespace.nspname = 'teaching' and relation.relname = 'sessions'`,
    );
    assert.ok(sessionConstraints.rows.some((row) => row.definition.includes("'study'")));
    assert.ok(sessionConstraints.rows.some((row) => row.definition.includes("'exam'")));
    assert.ok(sessionConstraints.rows.some((row) => row.definition.includes("'review'")));

    const indexes = await client.query<{ indexname: string }>(
      `select indexname from pg_indexes where schemaname = 'teaching'
       and indexname = any($1::text[]) order by indexname`,
      [["teaching_sessions_learner_status_activity_idx", "teaching_attempts_learner_question_idx", "teaching_user_question_state_state_idx"]],
    );
    assert.deepEqual(indexes.rows.map((row) => row.indexname), [
      "teaching_attempts_learner_question_idx", "teaching_sessions_learner_status_activity_idx", "teaching_user_question_state_state_idx",
    ]);

    const triggers = await client.query<{ trigger_name: string }>(
      `select distinct trigger_name from information_schema.triggers
       where trigger_schema = 'teaching' and trigger_name = any($1::text[]) order by trigger_name`,
      [["teaching_attempts_immutable", "teaching_session_questions_snapshot_immutable"]],
    );
    assert.deepEqual(triggers.rows.map((row) => row.trigger_name), [
      "teaching_attempts_immutable", "teaching_session_questions_snapshot_immutable",
    ]);

    const sql = migrationSql.toLowerCase();
    assert.doesNotMatch(sql, /\b(public\.)?(patients|appointments|bookings|reports|documents|studies|dicom_devices)\b/);
  } finally {
    await client.query("rollback");
    client.release();
  }
});
