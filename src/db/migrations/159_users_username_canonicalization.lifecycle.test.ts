import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";
import { describe, it } from "node:test";

const base = process.env.DATABASE_URL!;
const dir = path.dirname(fileURLToPath(import.meta.url));

async function withMigration159(run: (client: pg.Client, migrationSql: string) => Promise<void>): Promise<void> {
  const dbName = `rispro_159_${crypto.randomUUID().replace(/-/g, "")}`;
  const databaseUrl = base.replace(/\/[^/]+$/, `/${dbName}`);
  const admin = new pg.Client({ connectionString: base });
  await admin.connect();
  await admin.query(`create database ${dbName}`);
  await admin.end();
  const client = new pg.Client({ connectionString: databaseUrl });
  await client.connect();
  try {
    await client.query(await fs.readFile(path.join(dir, "001_initial.sql"), "utf8"));
    await run(client, await fs.readFile(path.join(dir, "159_users_username_canonicalization.sql"), "utf8"));
  } finally {
    await client.end();
    const cleanup = new pg.Client({ connectionString: base });
    await cleanup.connect();
    await cleanup.query(`drop database if exists ${dbName}`);
    await cleanup.end();
  }
}

describe("migration 159 username canonicalization", () => {
  it("rejects whitespace-only existing usernames before normalization", async () => {
    await withMigration159(async (client, sql) => {
      await client.query(`insert into users (username, full_name, password_hash, role) values ('   ', 'Empty', 'hash', 'supervisor')`);
      await assert.rejects(client.query(sql), /empty or whitespace-only usernames exist/);
      assert.equal((await client.query<{ username: string }>(`select username from users`)).rows[0].username, "   ");
    });
  });

  it("canonicalizes mixed-case usernames with surrounding whitespace", async () => {
    await withMigration159(async (client, sql) => {
      await client.query(`insert into users (username, full_name, password_hash, role) values ('  Doctor.One  ', 'Doctor', 'hash', 'supervisor')`);
      await client.query(sql);
      assert.equal((await client.query<{ username: string }>(`select username from users`)).rows[0].username, "doctor.one");
    });
  });

  it("stops safely on case-variant duplicates", async () => {
    await withMigration159(async (client, sql) => {
      await client.query(`insert into users (username, full_name, password_hash, role) values ('Doctor', 'One', 'hash', 'supervisor'), ('doctor', 'Two', 'hash', 'supervisor')`);
      await assert.rejects(client.query(sql), /case or surrounding-whitespace duplicates exist/);
      assert.deepEqual((await client.query<{ username: string }>(`select username from users order by id`)).rows.map((row) => row.username), ["Doctor", "doctor"]);
    });
  });

  it("accepts canonical nonempty usernames and enforces the invariant", async () => {
    await withMigration159(async (client, sql) => {
      await client.query(`insert into users (username, full_name, password_hash, role) values ('doctor', 'Doctor', 'hash', 'supervisor')`);
      await client.query(sql);
      await assert.rejects(client.query(`insert into users (username, full_name, password_hash, role) values (' Mixed ', 'Mixed', 'hash', 'supervisor')`), /users_username_canonical_check/);
      await assert.rejects(client.query(`insert into users (username, full_name, password_hash, role) values ('', 'Empty', 'hash', 'supervisor')`), /users_username_canonical_check/);
      assert.equal((await client.query(`select 1 from users where username = 'doctor'`)).rowCount, 1);
    });
  });
});
