import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { fileURLToPath } from "node:url";

test("migration 216 creates an idempotent Teaching identity and permission foundation", async (t) => {
  const [{ pool }, migrationSql] = await Promise.all([
    import("../pool.js"),
    readFile(fileURLToPath(new URL("./216_teaching_identity_foundation.sql", import.meta.url)), "utf8"),
  ]);

  try {
    await pool.query("select 1 from schema_migrations limit 1");
  } catch {
    t.skip("PostgreSQL is not reachable at the configured disposable DATABASE_URL.");
    return;
  }

  assert.equal(
    (await pool.query("select 1 from schema_migrations where filename = '216_teaching_identity_foundation.sql'")).rowCount,
    1,
  );

  const client = await pool.connect();
  try {
    await client.query("begin");
    await client.query(migrationSql);
    await client.query(migrationSql);

    const tables = await client.query<{ relation: string | null }>(
      `select to_regclass('teaching.user_profiles')::text as relation
       union all
       select to_regclass('teaching.user_permissions')::text as relation`,
    );
    assert.deepEqual(tables.rows.map((row) => row.relation), ["teaching.user_profiles", "teaching.user_permissions"]);

    const profileColumns = await client.query<{ column_name: string; is_nullable: string }>(
      `select column_name, is_nullable
       from information_schema.columns
       where table_schema = 'teaching' and table_name = 'user_profiles'`,
    );
    const columns = new Map(profileColumns.rows.map((row) => [row.column_name, row.is_nullable]));
    assert.equal(columns.get("identity_issuer"), "NO");
    assert.equal(columns.get("identity_subject"), "NO");
    assert.equal(columns.get("display_name"), "NO");
    assert.equal(columns.get("specialty"), "YES");
    assert.equal(columns.get("training_level"), "YES");

    const suffix = `migration-${Date.now()}-${Math.random().toString(16).slice(2)}`;
    await client.query(
      `insert into teaching.user_profiles (identity_issuer, identity_subject, display_name)
       values ('migration-test', $1, 'Teaching Migration Test')`,
      [suffix],
    );
    await client.query(
      `insert into teaching.user_permissions (identity_issuer, identity_subject, permission)
       values ('migration-test', $1, 'teaching.learn')`,
      [suffix],
    );
    await assert.rejects(
      client.query(
        `insert into teaching.user_permissions (identity_issuer, identity_subject, permission)
         values ('migration-test', $1, 'teaching.learn')`,
        [suffix],
      ),
      (error: unknown) => typeof error === "object" && error !== null && "code" in error && error.code === "23505",
    );
  } finally {
    await client.query("rollback");
    client.release();
  }
});
