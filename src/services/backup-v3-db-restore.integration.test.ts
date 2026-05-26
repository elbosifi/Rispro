import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import pg from "pg";
import { PassThrough } from "node:stream";
import type { BackupV3Manifest, BackupV3TableMetadata } from "./backup-v3-types.js";
import { BackupV3ZipWriter } from "./backup-v3-zip-writer.js";

const TEST_DB_URL = process.env.TEST_DATABASE_URL || "";
const runIntegration = process.env.BACKUP_V3_DB_RESTORE_INTEGRATION === "1" && !!TEST_DB_URL;

if (runIntegration) {
  process.env.DATABASE_URL = TEST_DB_URL;
  process.env.JWT_SECRET ||= "test-secret";
}

const maybeTest = runIntegration ? test : test.skip;

function table(schema: string, name: string, columns: string[], rowCount: number): BackupV3TableMetadata {
  return {
    schema,
    name,
    archivePath: `database/tables/${schema}.${name}.json`,
    rowCount,
    columns: columns.map((column, index) => ({
      name: column,
      dataType: column === "label" || column === "username" ? "text" : "bigint",
      udtName: column === "label" || column === "username" ? "text" : "int8",
      isNullable: column.endsWith("_id"),
      hasDefault: column === "id",
      ordinalPosition: index + 1,
    })),
  };
}

const allTables = [
  table("public", "users", ["id", "username"], 1),
  table("public", "patients", ["id", "created_by_user_id"], 1),
  table("public", "loop_a", ["id", "b_id"], 1),
  table("public", "loop_b", ["id", "a_id"], 1),
  table("public", "strict_child", ["id", "user_id"], 1),
  table("appointments_v2", "bookings", ["id", "patient_id"], 1),
];

function manifest(tables = allTables): BackupV3Manifest {
  return {
    formatVersion: 3,
    app: { name: "rispro-reception", packageVersion: "0.1.0", gitCommit: null },
    createdAt: "2026-05-27T00:00:00.000Z",
    initiatedByUserId: null,
    database: { schemas: ["public", "appointments_v2"], migrationVersion: null, tables },
    storageRoots: [],
    archiveEntries: [],
    files: [],
    env: { archivePath: "config/env.enc.json", variableNames: [] },
    safetyBackup: { preferredMethod: "pg_dump_custom", fallbackMethod: "v3_snapshot" },
    limits: { maxFiles: 60000, maxFileBytes: 1000, maxTotalUncompressedBytes: 1000 },
  };
}

async function writeStagedTables(rowsByTable: Record<string, unknown[]>): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "rispro-live-db-restore-"));
  for (const tableMeta of allTables) {
    const rows = rowsByTable[`${tableMeta.schema}.${tableMeta.name}`] || [];
    const fullPath = path.join(dir, tableMeta.archivePath);
    await fs.mkdir(path.dirname(fullPath), { recursive: true });
    await fs.writeFile(fullPath, JSON.stringify(rows));
  }
  return dir;
}

async function setupDatabase(pool: pg.Pool): Promise<void> {
  await pool.query("drop schema if exists appointments_v2 cascade");
  await pool.query("drop table if exists public.strict_child cascade");
  await pool.query("drop table if exists public.loop_a cascade");
  await pool.query("drop table if exists public.loop_b cascade");
  await pool.query("drop table if exists public.patients cascade");
  await pool.query("drop table if exists public.users cascade");
  await pool.query("create schema appointments_v2");
  await pool.query("create table public.users (id bigserial primary key, username text not null unique)");
  await pool.query("create table public.patients (id bigserial primary key, created_by_user_id bigint references public.users(id) deferrable initially immediate)");
  await pool.query("create table public.loop_a (id bigserial primary key, b_id bigint)");
  await pool.query("create table public.loop_b (id bigserial primary key, a_id bigint references public.loop_a(id) deferrable initially immediate)");
  await pool.query("alter table public.loop_a add constraint loop_a_b_fk foreign key (b_id) references public.loop_b(id) deferrable initially immediate");
  await pool.query("create table public.strict_child (id bigserial primary key, user_id bigint not null references public.users(id) not deferrable)");
  await pool.query("create table appointments_v2.bookings (id bigserial primary key, patient_id bigint references public.patients(id) deferrable initially immediate)");
  await pool.query("insert into public.users (id, username) values (10, 'old')");
  await pool.query("insert into public.patients (id, created_by_user_id) values (10, 10)");
  await pool.query("insert into public.strict_child (id, user_id) values (10, 10)");
  await pool.query("insert into appointments_v2.bookings (id, patient_id) values (10, 10)");
  await pool.query("select setval('public.users_id_seq', 10, true)");
}

async function countUsers(pool: pg.Pool): Promise<number> {
  const result = await pool.query<{ count: string }>("select count(*)::text as count from public.users");
  return Number(result.rows[0]?.count || 0);
}

async function makeTraversalArchive(): Promise<{ archivePath: string; stagingDir: string }> {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "rispro-live-invalid-zip-"));
  const archivePath = path.join(tempDir, "bad.rispro.zip");
  const stagingDir = path.join(tempDir, "staged");
  const output = new PassThrough();
  const chunks: Buffer[] = [];
  output.on("data", (chunk: Buffer) => chunks.push(chunk));
  const done = new Promise<void>((resolve) => output.on("end", resolve));
  const writer = new BackupV3ZipWriter(output);
  await writer.addBuffer("../escape.txt", Buffer.from("nope"));
  await writer.finish();
  output.end();
  await done;
  await fs.writeFile(archivePath, Buffer.concat(chunks));
  return { archivePath, stagingDir };
}

maybeTest("live v3 DB restore validates before mutation, restores, reseeds, defers constraints, and rolls back", async () => {
  const { restoreBackupV3DatabaseOnly } = await import("./backup-v3-db-restore.js");
  const { previewBackupV3RestoreFromArchive } = await import("./backup-v3-preview-service.js");
  const pool = new pg.Pool({ connectionString: TEST_DB_URL });
  try {
    await setupDatabase(pool);
    const beforeInvalidPreview = await countUsers(pool);
    const invalidArchive = await makeTraversalArchive();
    await assert.rejects(
      () => previewBackupV3RestoreFromArchive(invalidArchive.archivePath, invalidArchive.stagingDir, "passphrase"),
      /path traversal/
    );
    assert.equal(await countUsers(pool), beforeInvalidPreview);

    const validStaging = await writeStagedTables({
      "public.users": [{ id: 1, username: "new" }],
      "public.patients": [{ id: 1, created_by_user_id: 1 }],
      "public.loop_a": [{ id: 1, b_id: 1 }],
      "public.loop_b": [{ id: 1, a_id: 1 }],
      "public.strict_child": [{ id: 1, user_id: 1 }],
      "appointments_v2.bookings": [{ id: 1, patient_id: 1 }],
    });
    const client = await pool.connect();
    try {
      const result = await restoreBackupV3DatabaseOnly(client, manifest(), validStaging);
      assert.equal(result.tablesRestored, allTables.length);
      assert.equal(result.rowsRestored, allTables.length);
    } finally {
      client.release();
    }
    assert.equal(await countUsers(pool), 1);
    const nextId = await pool.query<{ id: string }>("insert into public.users (username) values ('after') returning id::text as id");
    assert.equal(Number(nextId.rows[0]?.id), 2);

    await setupDatabase(pool);
    const badTable = manifest([{ ...allTables[0]!, name: "not_runtime" }, ...allTables.slice(1)]);
    const badClient = await pool.connect();
    try {
      await assert.rejects(() => restoreBackupV3DatabaseOnly(badClient, badTable, validStaging), /unknown table/);
    } finally {
      badClient.release();
    }
    assert.equal(await countUsers(pool), 1);

    const badColumn = manifest([{ ...allTables[0]!, columns: [...allTables[0]!.columns, { ...allTables[0]!.columns[0]!, name: "bad_column" }] }, ...allTables.slice(1)]);
    const badColumnClient = await pool.connect();
    try {
      await assert.rejects(() => restoreBackupV3DatabaseOnly(badColumnClient, badColumn, validStaging), /unknown column/);
    } finally {
      badColumnClient.release();
    }
    assert.equal(await countUsers(pool), 1);

    const missingTable = manifest(allTables.slice(0, -1));
    const missingClient = await pool.connect();
    try {
      await assert.rejects(() => restoreBackupV3DatabaseOnly(missingClient, missingTable, validStaging), /missing required table/);
    } finally {
      missingClient.release();
    }
    assert.equal(await countUsers(pool), 1);

    const failingStaging = await writeStagedTables({
      "public.users": [{ id: 1, username: "new" }],
      "public.patients": [{ id: 1, created_by_user_id: 1 }],
      "public.loop_a": [{ id: 1, b_id: 1 }],
      "public.loop_b": [{ id: 1, a_id: 1 }],
      "public.strict_child": [{ id: 1, user_id: 999 }],
      "appointments_v2.bookings": [{ id: 1, patient_id: 1 }],
    });
    const oldRows = await pool.query("select id, username from public.users order by id");
    const failClient = await pool.connect();
    try {
      await assert.rejects(() => restoreBackupV3DatabaseOnly(failClient, manifest(), failingStaging), /violates foreign key/);
    } finally {
      failClient.release();
    }
    const afterRows = await pool.query("select id, username from public.users order by id");
    assert.deepEqual(afterRows.rows, oldRows.rows);
  } finally {
    await pool.end();
  }
});
