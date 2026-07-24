import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";
import test from "node:test";

const base = process.env.DATABASE_URL!;
const dbName = `rispro_139_${crypto.randomUUID().replace(/-/g, "")}`;
const databaseUrl = base.replace(/\/[^/]+$/, `/${dbName}`);
const dir = path.dirname(fileURLToPath(import.meta.url));

async function applyUntil(client: pg.Client, last: string): Promise<void> {
  for (const file of (await fs.readdir(dir)).filter((file) => file.endsWith(".sql") && file <= last).sort()) await client.query(await fs.readFile(path.join(dir, file), "utf8"));
}

test("migration 139 creates one durable Request Scan worker runtime row with safe sequence bounds", async () => {
  const admin = new pg.Client({ connectionString: base }); await admin.connect(); await admin.query(`create database ${dbName}`); await admin.end();
  const client = new pg.Client({ connectionString: databaseUrl }); await client.connect();
  try {
    await applyUntil(client, "138_request_scan_failed_cleanup.sql");
    await client.query(await fs.readFile(path.join(dir, "139_request_scan_worker_runtime.sql"), "utf8"));
    await client.query(await fs.readFile(path.join(dir, "139_request_scan_worker_runtime.sql"), "utf8"));
    assert.equal((await client.query("select count(*)::int as count from request_scan_worker_runtime")).rows[0]!.count, 1);
    await assert.rejects(() => client.query("update request_scan_worker_runtime set acknowledged_sequence=1 where singleton_key=1"));
    await assert.rejects(() => client.query("insert into request_scan_worker_runtime(singleton_key) values (2)"));
  } finally {
    await client.end(); const cleanup = new pg.Client({ connectionString: base }); await cleanup.connect(); await cleanup.query(`drop database if exists ${dbName}`); await cleanup.end();
  }
});
