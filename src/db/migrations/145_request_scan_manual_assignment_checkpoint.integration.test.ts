import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";
import test from "node:test";

const base = process.env.DATABASE_URL!;
const dbName = `rispro_145_${crypto.randomUUID().replace(/-/g, "")}`;
const databaseUrl = base.replace(/\/[^/]+$/, `/${dbName}`);
const migrationPath = path.join(path.dirname(fileURLToPath(import.meta.url)), "145_request_scan_manual_assignment_checkpoint.sql");

test("migration 145 adds manual assignment checkpoints and index", async () => {
  const admin = new pg.Client({ connectionString: base }); await admin.connect(); await admin.query(`create database ${dbName}`); await admin.end();
  const client = new pg.Client({ connectionString: databaseUrl }); await client.connect();
  try {
    await client.query("create table users(id bigint primary key)"); await client.query("create schema appointments_v2"); await client.query("create table appointments_v2.bookings(id bigint primary key)"); await client.query("create table request_scan_jobs(id bigserial primary key)");
    const sql = await fs.readFile(migrationPath, "utf8"); await client.query(sql); await client.query(sql);
    const columns = await client.query("select column_name from information_schema.columns where table_name='request_scan_jobs' and column_name=any($1::text[])", [["manual_assignment_requested_at", "manual_assignment_requested_by", "manual_assignment_confirmed_at", "manual_assignment_appointment_id"]]);
    assert.equal(columns.rowCount, 4);
    const index = await client.query("select 1 from pg_indexes where tablename='request_scan_jobs' and indexname='request_scan_jobs_manual_assignment_idx'"); assert.equal(index.rowCount, 1);
  } finally { await client.end(); const cleanup = new pg.Client({ connectionString: base }); await cleanup.connect(); await cleanup.query(`drop database if exists ${dbName}`); await cleanup.end(); }
});
