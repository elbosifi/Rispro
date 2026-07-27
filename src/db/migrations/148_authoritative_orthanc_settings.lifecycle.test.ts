import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";
import test from "node:test";

const base = process.env.DATABASE_URL!;
const dbName = `rispro_148_${crypto.randomUUID().replace(/-/g, "")}`;
const databaseUrl = base.replace(/\/[^/]+$/, `/${dbName}`);
const dir = path.dirname(fileURLToPath(import.meta.url));

test("migration 148 seeds disabled authoritative Orthanc settings without overwriting values", async () => {
  const admin = new pg.Client({ connectionString: base });
  await admin.connect();
  await admin.query(`create database ${dbName}`);
  await admin.end();
  const client = new pg.Client({ connectionString: databaseUrl });
  await client.connect();
  try {
    for (const file of (await fs.readdir(dir)).filter((name) => name.endsWith(".sql") && name <= "147_modality_document_ingestion.sql").sort()) await client.query(await fs.readFile(path.join(dir, file), "utf8"));
    await client.query("insert into system_settings(category,setting_key,setting_value) values('authoritative_orthanc','base_url','{\"value\":\"https://configured.example\"}')");
    await client.query(await fs.readFile(path.join(dir, "148_authoritative_orthanc_settings.sql"), "utf8"));
    const { rows } = await client.query<{ setting_key: string; setting_value: { value: string } }>("select setting_key,setting_value from system_settings where category='authoritative_orthanc' order by setting_key");
    assert.equal(rows.length, 7);
    assert.equal(rows.find((row) => row.setting_key === "enabled")?.setting_value.value, "disabled");
    assert.equal(rows.find((row) => row.setting_key === "verify_tls")?.setting_value.value, "true");
    assert.equal(rows.find((row) => row.setting_key === "base_url")?.setting_value.value, "https://configured.example");
  } finally {
    await client.end();
    const cleanup = new pg.Client({ connectionString: base });
    await cleanup.connect();
    await cleanup.query(`drop database if exists ${dbName}`);
    await cleanup.end();
  }
});
