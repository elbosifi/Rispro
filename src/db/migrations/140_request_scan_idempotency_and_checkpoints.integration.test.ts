import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";
import test from "node:test";

const base = process.env.DATABASE_URL!;
const dbName = `rispro_140_${crypto.randomUUID().replace(/-/g, "")}`;
const databaseUrl = base.replace(/\/[^/]+$/, `/${dbName}`);
const migrationPath = path.join(path.dirname(fileURLToPath(import.meta.url)), "140_request_scan_idempotency_and_checkpoints.sql");

test("migration 140 backfills one canonical document and adds durable checkpoints idempotently", async () => {
  const admin = new pg.Client({ connectionString: base }); await admin.connect(); await admin.query(`create database ${dbName}`); await admin.end();
  const client = new pg.Client({ connectionString: databaseUrl }); await client.connect();
  try {
    await client.query("create table request_scan_jobs(id bigserial primary key)");
    await client.query("create table documents(id bigserial primary key,v2_booking_id bigint,source text,document_type text)");
    await client.query("insert into documents(v2_booking_id,source,document_type) values (41,'request_scan_automation','appointment_request'),(41,'request_scan_automation','appointment_request'),(42,'manual_upload','appointment_request')");
    const sql = await fs.readFile(migrationPath, "utf8"); await client.query(sql); await client.query(sql);
    const rows = await client.query("select id,idempotency_key from documents where v2_booking_id=41 order by id");
    assert.equal(rows.rows[0].idempotency_key, "request-scan:v2-booking:41:appointment-request"); assert.equal(rows.rows[1].idempotency_key, null);
    await assert.rejects(() => client.query("insert into documents(v2_booking_id,source,document_type,idempotency_key) values(41,'request_scan_automation','appointment_request','request-scan:v2-booking:41:appointment-request')"));
    const columns = await client.query("select column_name from information_schema.columns where table_name='request_scan_jobs' and column_name=any($1::text[])", [["attachment_completed_at","attachment_created","intended_destination_path","source_moved_at"]]);
    assert.equal(columns.rowCount, 4);
  } finally { await client.end(); const cleanup = new pg.Client({ connectionString: base }); await cleanup.connect(); await cleanup.query(`drop database if exists ${dbName}`); await cleanup.end(); }
});
