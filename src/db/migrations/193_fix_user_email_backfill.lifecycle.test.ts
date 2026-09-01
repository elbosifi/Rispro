import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";
import test from "node:test";

const base = process.env.DATABASE_URL!;
const dir = path.dirname(fileURLToPath(import.meta.url));

test("migration 193 backfills only null emails from email-shaped usernames", async () => {
  const dbName = `rispro_193_${crypto.randomUUID().replace(/-/g, "")}`;
  const databaseUrl = base.replace(/\/[^/]+$/, `/${dbName}`);
  const admin = new pg.Client({ connectionString: base });
  await admin.connect();
  await admin.query(`create database ${dbName}`);
  await admin.end();
  const client = new pg.Client({ connectionString: databaseUrl });
  await client.connect();
  try {
    await client.query(await fs.readFile(path.join(dir, "001_initial.sql"), "utf8"));
    await client.query("alter table users add column email text");
    await client.query(`insert into users (username, email, full_name, password_hash, role) values
      ('doctor.one@nccb.ly', null, 'Doctor One', 'hash', 'supervisor'),
      ('reception1', null, 'Reception', 'hash', 'receptionist'),
      ('doctor.two@nccb.ly', 'custom.mailbox@nccb.ly', 'Doctor Two', 'hash', 'supervisor')`);
    await client.query(await fs.readFile(path.join(dir, "193_fix_user_email_backfill.sql"), "utf8"));
    const rows = await client.query<{ username: string; email: string | null }>("select username, email from users order by username");
    assert.deepEqual(rows.rows, [
      { username: "doctor.one@nccb.ly", email: "doctor.one@nccb.ly" },
      { username: "doctor.two@nccb.ly", email: "custom.mailbox@nccb.ly" },
      { username: "reception1", email: null },
    ]);
  } finally {
    await client.end();
    const cleanup = new pg.Client({ connectionString: base });
    await cleanup.connect();
    await cleanup.query(`drop database if exists ${dbName}`);
    await cleanup.end();
  }
});
