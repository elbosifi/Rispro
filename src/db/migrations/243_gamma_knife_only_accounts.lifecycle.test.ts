import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { pool } from "../pool.js";

test("migration 243 adds a default-off Gamma Knife account restriction", async (t) => {
  const applied = await pool.query("select 1 from schema_migrations where filename='243_gamma_knife_only_accounts.sql'");
  assert.equal(applied.rowCount, 1);
  const column = await pool.query<{ column_default: string; is_nullable: string }>(
    "select column_default, is_nullable from information_schema.columns where table_schema='public' and table_name='users' and column_name='gamma_knife_only'"
  );
  assert.equal(column.rows[0]?.column_default, "false");
  assert.equal(column.rows[0]?.is_nullable, "NO");
  const client = await pool.connect();
  try {
    await client.query("begin");
    const inserted = await client.query<{ gamma_knife_only: boolean }>(
      "insert into users (username, full_name, password_hash, role) values ($1, 'Migration lifecycle fixture', 'hash', 'supervisor') returning gamma_knife_only",
      [`gk_migration_${randomUUID().replaceAll("-", "")}`],
    );
    assert.equal(inserted.rows[0]?.gamma_knife_only, false);
  } finally {
    await client.query("rollback");
    client.release();
  }
  t.diagnostic("The account restriction defaults to false for existing and newly created accounts.");
});
