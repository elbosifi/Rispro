import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";
import test from "node:test";

const base = process.env.DATABASE_URL!;
const dbName = `rispro_138_${crypto.randomUUID().replace(/-/g, "")}`;
const databaseUrl = base.replace(/\/[^/]+$/, `/${dbName}`);
const dir = path.dirname(fileURLToPath(import.meta.url));

async function applyUntil(client: pg.Client, last: string) { for (const file of (await fs.readdir(dir)).filter((x) => x.endsWith(".sql") && x <= last).sort()) await client.query(await fs.readFile(path.join(dir, file), "utf8")); }

test("migration 138 upgrades a 137 database, backfills safely, and preserves dismissed jobs after user deletion", async () => {
  const admin = new pg.Client({ connectionString: base }); await admin.connect(); await admin.query(`create database ${dbName}`); await admin.end();
  const client = new pg.Client({ connectionString: databaseUrl }); await client.connect();
  try {
    await applyUntil(client, "137_request_scan_queue_priority.sql");
    const rows = [
      ["No valid appointment identifier could be confirmed.", "recognition"], ["Multiple conflicting appointment identifiers", "identifier_conflict"], ["SMB destination operation failed.", "smb_storage"], ["The source scan file could not be found.", "source_missing"], ["Processing was interrupted repeatedly.", "processing_interrupted"], ["legacy mystery", "unknown"],
    ];
    for (const [message] of rows) await client.query("insert into request_scan_jobs(filename,source_relative_path,mime_type,status,error_message) values($1,$2,'image/jpeg','failed',$3)", [`${message}.jpg`, `Requests\\Failed\\${message}.jpg`, message]);
    await client.query("insert into request_scan_jobs(filename,source_relative_path,mime_type,status,error_message) values('processed.jpg','processed-x','image/jpeg','processed','legacy mystery')");
    await client.query(await fs.readFile(path.join(dir, "138_request_scan_failed_cleanup.sql"), "utf8"));
    const found = await client.query<{ error_message:string; failure_category:string | null }>("select error_message,failure_category from request_scan_jobs where status='failed' order by id");
    assert.deepEqual(found.rows.map((x) => x.failure_category), rows.map((x) => x[1])); assert.equal((await client.query("select failure_category from request_scan_jobs where status='processed'")).rows[0]!.failure_category, null);
    await assert.rejects(() => client.query("update request_scan_jobs set failure_category='invalid' where status='failed'"));
    const user = await client.query<{id:number}>("insert into users(username,full_name,password_hash,role,is_active) values('migration138user','Migration 138','x','supervisor',true) returning id");
    const job = await client.query<{id:number}>("insert into request_scan_jobs(filename,source_relative_path,mime_type,status,error_message,failure_category,dismissed_at,dismissed_by,dismiss_reason) values('dismissed.jpg','dismissed-x','image/jpeg','failed','safe','recognition',now(),$1,'reviewed') returning id", [user.rows[0]!.id]);
    await client.query("delete from users where id=$1", [user.rows[0]!.id]); const dismissed = await client.query("select dismissed_by,dismiss_reason,failure_category,error_message from request_scan_jobs where id=$1", [job.rows[0]!.id]); assert.deepEqual(dismissed.rows[0], { dismissed_by:null,dismiss_reason:"reviewed",failure_category:"recognition",error_message:"safe" });
  } finally { await client.end(); const cleanup = new pg.Client({ connectionString: base }); await cleanup.connect(); await cleanup.query(`drop database if exists ${dbName}`); await cleanup.end(); }
});
