import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";
import { describe, it } from "node:test";

const base = process.env.DATABASE_URL!;
const dir = path.dirname(fileURLToPath(import.meta.url));

async function withMigration160(run: (client: pg.Client, migrationSql: string) => Promise<void>): Promise<void> {
  const dbName = `rispro_160_${crypto.randomUUID().replace(/-/g, "")}`;
  const databaseUrl = base.replace(/\/[^/]+$/, `/${dbName}`);
  const admin = new pg.Client({ connectionString: base });
  await admin.connect();
  await admin.query(`create database ${dbName}`);
  await admin.end();
  const client = new pg.Client({ connectionString: databaseUrl });
  await client.connect();
  try {
    await client.query(await fs.readFile(path.join(dir, "001_initial.sql"), "utf8"));
    await run(client, await fs.readFile(path.join(dir, "160_sonicdicom_local_browser_url.sql"), "utf8"));
  } finally {
    await client.end();
    const cleanup = new pg.Client({ connectionString: base });
    await cleanup.connect();
    await cleanup.query(`drop database if exists ${dbName}`);
    await cleanup.end();
  }
}

describe("migration 160 SonicDICOM local browser URL", () => {
  it("adds an empty local browser URL without changing existing public/internal values", async () => {
    await withMigration160(async (client, sql) => {
      const original = {
        value: {
          sonicDicomPublicBaseUrl: "https://public.example/viewer",
          sonicDicomInternalBaseUrl: "http://sonic-backend/internal",
        },
      };
      await client.query(`insert into system_settings (category, setting_key, setting_value) values ('sonicdicom_reports', 'config', $1::jsonb)`, [JSON.stringify(original)]);
      await client.query(sql);
      const result = await client.query<{ setting_value: typeof original & { value: { sonicDicomLocalBaseUrl?: string } } }>(`select setting_value from system_settings where category = 'sonicdicom_reports' and setting_key = 'config'`);
      assert.equal(result.rows[0].setting_value.value.sonicDicomLocalBaseUrl, "");
      assert.equal(result.rows[0].setting_value.value.sonicDicomPublicBaseUrl, "https://public.example/viewer");
      assert.equal(result.rows[0].setting_value.value.sonicDicomInternalBaseUrl, "http://sonic-backend/internal");
    });
  });

  it("preserves an already configured local browser URL and is idempotent", async () => {
    await withMigration160(async (client, sql) => {
      await client.query(`insert into system_settings (category, setting_key, setting_value) values ('sonicdicom_reports', 'config', $1::jsonb)`, [JSON.stringify({ value: { sonicDicomLocalBaseUrl: "http://192.168.1.30/viewer" } })]);
      await client.query(sql);
      await client.query(sql);
      const result = await client.query<{ setting_value: { value: { sonicDicomLocalBaseUrl: string } } }>(`select setting_value from system_settings where category = 'sonicdicom_reports' and setting_key = 'config'`);
      assert.equal(result.rows[0].setting_value.value.sonicDicomLocalBaseUrl, "http://192.168.1.30/viewer");
    });
  });
});
