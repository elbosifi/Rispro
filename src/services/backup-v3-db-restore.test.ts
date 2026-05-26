import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  getBackupV3InsertOrder,
  restoreBackupV3DatabaseOnly,
  validateBackupV3ManifestTables,
} from "./backup-v3-db-restore.js";
import type { BackupV3Manifest, BackupV3TableMetadata } from "./backup-v3-types.js";

const usersTable: BackupV3TableMetadata = {
  schema: "public",
  name: "users",
  archivePath: "database/tables/public.users.json",
  rowCount: 1,
  columns: [
    { name: "id", dataType: "bigint", udtName: "int8", isNullable: false, hasDefault: true, ordinalPosition: 1 },
    { name: "username", dataType: "text", udtName: "text", isNullable: false, hasDefault: false, ordinalPosition: 2 },
  ],
};

const patientsTable: BackupV3TableMetadata = {
  schema: "public",
  name: "patients",
  archivePath: "database/tables/public.patients.json",
  rowCount: 1,
  columns: [
    { name: "id", dataType: "bigint", udtName: "int8", isNullable: false, hasDefault: true, ordinalPosition: 1 },
    { name: "created_by_user_id", dataType: "bigint", udtName: "int8", isNullable: true, hasDefault: false, ordinalPosition: 2 },
  ],
};

function manifest(tables: BackupV3TableMetadata[] = [usersTable, patientsTable]): BackupV3Manifest {
  return {
    formatVersion: 3,
    app: { name: "rispro-reception", packageVersion: "0.1.0", gitCommit: null },
    createdAt: "2026-05-27T00:00:00.000Z",
    initiatedByUserId: null,
    database: { schemas: ["public", "appointments_v2"], migrationVersion: "test", tables },
    storageRoots: [],
    archiveEntries: [],
    files: [],
    env: { archivePath: "config/env.enc.json", variableNames: [] },
    safetyBackup: { preferredMethod: "pg_dump_custom", fallbackMethod: "v3_snapshot" },
    limits: { maxFiles: 60000, maxFileBytes: 1000, maxTotalUncompressedBytes: 1000 },
  };
}

function runtimeTables() {
  return [
    { schema: "public", name: "users", key: "public.users", qualified: "\"public\".\"users\"" },
    { schema: "public", name: "patients", key: "public.patients", qualified: "\"public\".\"patients\"" },
  ];
}

function runtimeColumns() {
  return new Map([
    ["public.users", new Set(["id", "username"])],
    ["public.patients", new Set(["id", "created_by_user_id"])],
  ]);
}

test("validateBackupV3ManifestTables rejects unknown tables and columns", () => {
  assert.throws(
    () => validateBackupV3ManifestTables(manifest([{ ...usersTable, name: "unknown" }]), runtimeTables(), runtimeColumns()),
    /unknown table/
  );
  assert.throws(
    () => validateBackupV3ManifestTables(
      manifest([{ ...usersTable, columns: [...usersTable.columns, { ...usersTable.columns[0]!, name: "bad_column" }] }]),
      [{ schema: "public", name: "users", key: "public.users", qualified: "\"public\".\"users\"" }],
      new Map([["public.users", new Set(["id", "username"])]])
    ),
    /unknown column/
  );
});

test("getBackupV3InsertOrder orders parent tables before foreign-key children", async () => {
  const fakeClient = {
    async query() {
      return {
        rows: [
          {
            table_schema: "public",
            table_name: "patients",
            foreign_table_schema: "public",
            foreign_table_name: "users",
          },
        ],
      };
    },
  };
  const order = await getBackupV3InsertOrder(fakeClient as never, runtimeTables().reverse());
  assert.deepEqual(order.map((table) => table.key), ["public.users", "public.patients"]);
});

async function writeStagedTables(rowsByPath: Record<string, unknown[]>): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "rispro-db-restore-test-"));
  for (const [archivePath, rows] of Object.entries(rowsByPath)) {
    const fullPath = path.join(dir, archivePath);
    await fs.mkdir(path.dirname(fullPath), { recursive: true });
    await fs.writeFile(fullPath, JSON.stringify(rows));
  }
  return dir;
}

function fakeRestoreClient(options: { failInsert?: boolean } = {}) {
  const calls: Array<{ sql: string; values?: unknown[] }> = [];
  const client = {
    calls,
    async query(sql: string, values?: unknown[]) {
      calls.push({ sql, values });
      if (/information_schema\.tables/.test(sql)) {
        return { rows: runtimeTables().map((table) => ({ table_schema: table.schema, table_name: table.name })) };
      }
      if (/information_schema\.columns/.test(sql) && /udt_name in/.test(sql)) {
        return { rows: [] };
      }
      if (/information_schema\.columns/.test(sql) && /column_name = 'id'/.test(sql)) {
        return { rowCount: 1, rows: [{ "?column?": 1 }] };
      }
      if (/information_schema\.columns/.test(sql)) {
        return {
          rows: [
            { table_schema: "public", table_name: "users", column_name: "id" },
            { table_schema: "public", table_name: "users", column_name: "username" },
            { table_schema: "public", table_name: "patients", column_name: "id" },
            { table_schema: "public", table_name: "patients", column_name: "created_by_user_id" },
          ],
        };
      }
      if (/pg_constraint/.test(sql)) {
        return {
          rows: [
            {
              table_schema: "public",
              table_name: "patients",
              foreign_table_schema: "public",
              foreign_table_name: "users",
            },
          ],
        };
      }
      if (/^insert into/.test(sql) && options.failInsert) {
        throw new Error("insert failed");
      }
      if (/coalesce\(max/.test(sql)) {
        return { rows: [{ max_id: "2" }] };
      }
      if (/pg_get_serial_sequence/.test(sql)) {
        return { rows: [{ sequence_name: "public.test_id_seq" }] };
      }
      return { rows: [], rowCount: 0 };
    },
  };
  return client;
}

test("restoreBackupV3DatabaseOnly truncates, reinserts, reseeds, and commits known tables", async () => {
  const stagingDir = await writeStagedTables({
    [usersTable.archivePath]: [{ id: 1, username: "admin" }],
    [patientsTable.archivePath]: [{ id: 2, created_by_user_id: 1 }],
  });
  const client = fakeRestoreClient();

  const result = await restoreBackupV3DatabaseOnly(client as never, manifest(), stagingDir);

  assert.equal(result.tablesRestored, 2);
  assert.equal(result.rowsRestored, 2);
  assert.ok(client.calls.some((call) => call.sql === "begin"));
  assert.ok(client.calls.some((call) => /set constraints all deferred/i.test(call.sql)));
  assert.ok(client.calls.some((call) => /truncate table "public"\."users", "public"\."patients" restart identity/.test(call.sql)));
  assert.ok(client.calls.some((call) => /^insert into "public"\."users"/.test(call.sql)));
  assert.ok(client.calls.some((call) => /^insert into "public"\."patients"/.test(call.sql)));
  assert.ok(client.calls.some((call) => /setval/.test(call.sql)));
  assert.ok(client.calls.some((call) => call.sql === "commit"));
});

test("restoreBackupV3DatabaseOnly rolls back completely on insert failure", async () => {
  const stagingDir = await writeStagedTables({
    [usersTable.archivePath]: [{ id: 1, username: "admin" }],
    [patientsTable.archivePath]: [{ id: 2, created_by_user_id: 1 }],
  });
  const client = fakeRestoreClient({ failInsert: true });

  await assert.rejects(() => restoreBackupV3DatabaseOnly(client as never, manifest(), stagingDir), /insert failed/);

  assert.ok(client.calls.some((call) => call.sql === "begin"));
  assert.ok(client.calls.some((call) => call.sql === "rollback"));
  assert.ok(!client.calls.some((call) => call.sql === "commit"));
});

test("restoreBackupV3DatabaseOnly rejects unknown row columns before transaction mutation", async () => {
  const stagingDir = await writeStagedTables({
    [usersTable.archivePath]: [{ id: 1, username: "admin", bad_column: "nope" }],
    [patientsTable.archivePath]: [{ id: 2, created_by_user_id: 1 }],
  });
  const client = fakeRestoreClient();

  await assert.rejects(
    () => restoreBackupV3DatabaseOnly(client as never, manifest(), stagingDir),
    /unknown column public\.users\.bad_column/
  );

  assert.ok(!client.calls.some((call) => call.sql === "begin"));
  assert.ok(!client.calls.some((call) => /truncate table/i.test(call.sql)));
});
