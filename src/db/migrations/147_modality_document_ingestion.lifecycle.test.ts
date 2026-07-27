import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";
import test from "node:test";

const base = process.env.DATABASE_URL!;
const dbName = `rispro_147_${crypto.randomUUID().replace(/-/g, "")}`;
const databaseUrl = base.replace(/\/[^/]+$/, `/${dbName}`);
const dir = path.dirname(fileURLToPath(import.meta.url));

async function applyUntil(client: pg.Client, last: string) {
  for (const file of (await fs.readdir(dir)).filter((name) => name.endsWith(".sql") && name <= last).sort()) {
    await client.query(await fs.readFile(path.join(dir, file), "utf8"));
  }
}

test("migration 147 safely upgrades legacy Reception jobs and enforces modality context", async () => {
  const admin = new pg.Client({ connectionString: base });
  await admin.connect();
  await admin.query(`create database ${dbName}`);
  await admin.end();
  const client = new pg.Client({ connectionString: databaseUrl });
  await client.connect();
  try {
    await applyUntil(client, "146_request_scan_filename_confirmation.sql");
    const legacy = await client.query<{ id: number }>(
      "insert into request_scan_jobs(filename,source_relative_path,mime_type,status) values('legacy.jpg','Requests\\Incoming\\legacy.jpg','image/jpeg','pending') returning id",
    );
    await client.query("begin");
    await client.query(await fs.readFile(path.join(dir, "147_modality_document_ingestion.sql"), "utf8"));
    await client.query("commit");

    assert.deepEqual(
      (await client.query("select workflow_source,modality_id from request_scan_jobs where id=$1", [legacy.rows[0]!.id])).rows[0],
      { workflow_source: "reception", modality_id: null },
    );
    assert.deepEqual(
      (await client.query("select setting_value from system_settings where category='request_scan_automation' and setting_key='modality_documents_root_subfolder'")).rows[0]!.setting_value,
      { value: "ModalityDocuments" },
    );
    const modality = await client.query<{ id: number }>(
      "insert into modalities(code,name_ar,name_en,daily_capacity,is_active) values('M147','اختبار','Migration 147',20,true) returning id",
    );
    const modalityId = Number(modality.rows[0]!.id);
    await assert.rejects(() => client.query(
      "insert into request_scan_jobs(filename,source_relative_path,mime_type,status,workflow_source) values('missing.jpg','missing','image/jpeg','pending','modality')",
    ));
    await assert.rejects(() => client.query(
      "insert into request_scan_jobs(filename,source_relative_path,mime_type,status,workflow_source,modality_id) values('wrong.jpg','wrong','image/jpeg','pending','reception',$1)",
      [modalityId],
    ));
    await client.query(
      "insert into request_scan_jobs(filename,source_relative_path,mime_type,status,workflow_source,modality_id) values('valid.jpg','ModalityDocuments\\M147\\Incoming\\valid.jpg','image/jpeg','pending','modality',$1)",
      [modalityId],
    );
    await assert.rejects(() => client.query("delete from modalities where id=$1", [modalityId]));
    const index = await client.query("select 1 from pg_indexes where indexname='idx_request_scan_jobs_workflow_modality_status'");
    assert.equal(index.rowCount, 1);
    const sourceConstraint = await client.query<{ definition: string }>(
      "select pg_get_constraintdef(oid) definition from pg_constraint where conname='documents_source_check'",
    );
    assert.match(sourceConstraint.rows[0]!.definition, /modality_scan_automation/);
  } finally {
    await client.end();
    const cleanup = new pg.Client({ connectionString: base });
    await cleanup.connect();
    await cleanup.query(`drop database if exists ${dbName}`);
    await cleanup.end();
  }
});
