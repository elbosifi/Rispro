import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { pool } from "../pool.js";

test("migration 224 seeds the deployment identity public URL without overwriting an existing value", async () => {
  const client = await pool.connect();
  const migrationPath = path.join(path.dirname(fileURLToPath(import.meta.url)), "224_deployment_identity_public_app_url.sql");
  try {
    await client.query("begin");
    await client.query("delete from system_settings where category = 'deployment_identity' and setting_key = 'public_app_base_url'");
    const migration = await readFile(migrationPath, "utf8");
    await client.query(migration);
    let result = await client.query<{ setting_value: { value: string } }>("select setting_value from system_settings where category = 'deployment_identity' and setting_key = 'public_app_base_url'");
    assert.equal(result.rows[0]?.setting_value.value, "https://rispro.nccb.com.ly");
    await client.query("update system_settings set setting_value = '{\"value\":\"https://existing.example.test\"}'::jsonb where category = 'deployment_identity' and setting_key = 'public_app_base_url'");
    await client.query(migration);
    result = await client.query("select setting_value from system_settings where category = 'deployment_identity' and setting_key = 'public_app_base_url'");
    assert.equal(result.rows[0]?.setting_value.value, "https://existing.example.test");
  } finally {
    await client.query("rollback").catch(() => undefined);
    client.release();
  }
});
