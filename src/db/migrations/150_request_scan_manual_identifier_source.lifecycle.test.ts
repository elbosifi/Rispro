import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";
import test from "node:test";

const base = process.env.DATABASE_URL!;
const dbName = `rispro_150_${crypto.randomUUID().replace(/-/g, "")}`;
const databaseUrl = base.replace(/\/[^/]+$/, `/${dbName}`);
const migrationPath = path.join(path.dirname(fileURLToPath(import.meta.url)), "150_request_scan_manual_identifier_source.sql");

test("migration 150 upgrades the identifier source constraint and is repeatable", async () => {
  const admin = new pg.Client({ connectionString: base });
  await admin.connect();
  await admin.query(`create database ${dbName}`);
  await admin.end();

  const client = new pg.Client({ connectionString: databaseUrl });
  await client.connect();
  try {
    await client.query(`
      create table request_scan_jobs(id bigint primary key);
      create table appointments_v2_bookings(id bigint primary key);
      create table request_scan_job_appointments(
        request_scan_job_id bigint not null references request_scan_jobs(id),
        appointment_id bigint not null references appointments_v2_bookings(id),
        patient_id bigint not null,
        identifier_source text not null check (identifier_source in ('accession', 'qr', 'consensus', 'filename', 'checkpoint')),
        primary key (request_scan_job_id, appointment_id)
      );
      insert into request_scan_jobs values (1);
      insert into appointments_v2_bookings values (2);
      insert into request_scan_job_appointments values (1, 2, 3, 'checkpoint');
    `);

    const sql = await fs.readFile(migrationPath, "utf8");
    await client.query(sql);
    await client.query(sql);

    const definition = await client.query<{ definition: string }>(
      "select pg_get_constraintdef(oid) as definition from pg_constraint where conrelid='request_scan_job_appointments'::regclass and conname='request_scan_job_appointments_identifier_source_check'",
    );
    assert.match(definition.rows[0]?.definition || "", /manual/);
    assert.equal((await client.query("select count(*) from request_scan_job_appointments")).rows[0].count, "1");
    await client.query("update request_scan_job_appointments set identifier_source='manual' where request_scan_job_id=1 and appointment_id=2");
  } finally {
    await client.end();
    const cleanup = new pg.Client({ connectionString: base });
    await cleanup.connect();
    await cleanup.query(`drop database if exists ${dbName}`);
    await cleanup.end();
  }
});
