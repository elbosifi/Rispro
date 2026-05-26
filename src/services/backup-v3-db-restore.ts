import fs from "node:fs/promises";
import path from "node:path";
import type { PoolClient } from "pg";
import { HttpError } from "../utils/http-error.js";
import type { UnknownRecord } from "../types/http.js";
import type { BackupV3Manifest, BackupV3TableMetadata } from "./backup-v3-types.js";

interface BackupV3TableRef {
  schema: string;
  name: string;
  key: string;
  qualified: string;
}

export interface BackupV3DbRestoreResult {
  tablesRestored: number;
  rowsRestored: number;
}

function quoteIdent(value: string): string {
  if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(value)) {
    throw new HttpError(400, `Invalid identifier: ${value}`);
  }
  return `"${value.replace(/"/g, '""')}"`;
}

function tableKey(schema: string, table: string): string {
  return `${schema}.${table}`;
}

function toTableRef(table: Pick<BackupV3TableMetadata, "schema" | "name">): BackupV3TableRef {
  return {
    schema: table.schema,
    name: table.name,
    key: tableKey(table.schema, table.name),
    qualified: `${quoteIdent(table.schema)}.${quoteIdent(table.name)}`,
  };
}

export async function listBackupV3RuntimeTables(client: PoolClient): Promise<BackupV3TableRef[]> {
  const { rows } = await client.query<{ table_schema: string; table_name: string }>(
    `
      select table_schema, table_name
      from information_schema.tables
      where table_type = 'BASE TABLE'
        and table_schema = any($1::text[])
        and table_name <> 'schema_migrations'
      order by table_schema, table_name
    `,
    [<string[]>["public", "appointments_v2"]]
  );
  return rows.map((row) => toTableRef({ schema: row.table_schema, name: row.table_name }));
}

export async function listBackupV3RuntimeColumns(client: PoolClient): Promise<Map<string, Set<string>>> {
  const { rows } = await client.query<{ table_schema: string; table_name: string; column_name: string }>(
    `
      select table_schema, table_name, column_name
      from information_schema.columns
      where table_schema = any($1::text[])
    `,
    [<string[]>["public", "appointments_v2"]]
  );
  const columns = new Map<string, Set<string>>();
  for (const row of rows) {
    const key = tableKey(row.table_schema, row.table_name);
    const tableColumns = columns.get(key) || new Set<string>();
    tableColumns.add(row.column_name);
    columns.set(key, tableColumns);
  }
  return columns;
}

async function listJsonColumns(client: PoolClient): Promise<Map<string, Set<string>>> {
  const { rows } = await client.query<{ table_schema: string; table_name: string; column_name: string }>(
    `
      select table_schema, table_name, column_name
      from information_schema.columns
      where table_schema = any($1::text[])
        and udt_name in ('json', 'jsonb')
    `,
    [<string[]>["public", "appointments_v2"]]
  );
  const columns = new Map<string, Set<string>>();
  for (const row of rows) {
    const key = tableKey(row.table_schema, row.table_name);
    const tableColumns = columns.get(key) || new Set<string>();
    tableColumns.add(row.column_name);
    columns.set(key, tableColumns);
  }
  return columns;
}

export function validateBackupV3ManifestTables(
  manifest: BackupV3Manifest,
  runtimeTables: BackupV3TableRef[],
  runtimeColumns: Map<string, Set<string>>
): BackupV3TableRef[] {
  const runtimeByKey = new Map(runtimeTables.map((table) => [table.key, table]));
  const manifestKeys = new Set<string>();
  const restoreTables: BackupV3TableRef[] = [];

  for (const table of manifest.database.tables) {
    const key = tableKey(table.schema, table.name);
    if (manifestKeys.has(key)) {
      throw new HttpError(400, `Backup contains duplicate table: ${key}`);
    }
    manifestKeys.add(key);
    const runtimeTable = runtimeByKey.get(key);
    if (!runtimeTable) {
      throw new HttpError(400, `Backup contains unknown table: ${key}`);
    }
    const columns = runtimeColumns.get(key) || new Set<string>();
    for (const column of table.columns) {
      if (!columns.has(column.name)) {
        throw new HttpError(400, `Backup contains unknown column ${key}.${column.name}`);
      }
    }
    restoreTables.push(runtimeTable);
  }

  for (const runtimeTable of runtimeTables) {
    if (!manifestKeys.has(runtimeTable.key)) {
      throw new HttpError(400, `Backup is missing required table: ${runtimeTable.key}`);
    }
  }

  return restoreTables;
}

export async function getBackupV3InsertOrder(
  client: PoolClient,
  tables: BackupV3TableRef[]
): Promise<BackupV3TableRef[]> {
  const tableByKey = new Map(tables.map((table) => [table.key, table]));
  const dependencies = new Map<string, Set<string>>();
  for (const table of tables) {
    dependencies.set(table.key, new Set());
  }

  const { rows } = await client.query<{
    table_schema: string;
    table_name: string;
    foreign_table_schema: string;
    foreign_table_name: string;
  }>(
    `
      select
        child_schema.nspname as table_schema,
        child.relname as table_name,
        parent_schema.nspname as foreign_table_schema,
        parent.relname as foreign_table_name
      from pg_constraint constraint_row
      join pg_class child on child.oid = constraint_row.conrelid
      join pg_namespace child_schema on child_schema.oid = child.relnamespace
      join pg_class parent on parent.oid = constraint_row.confrelid
      join pg_namespace parent_schema on parent_schema.oid = parent.relnamespace
      where constraint_row.contype = 'f'
        and child_schema.nspname = any($1::text[])
    `,
    [<string[]>["public", "appointments_v2"]]
  );

  for (const row of rows) {
    const key = tableKey(row.table_schema, row.table_name);
    const foreignKey = tableKey(row.foreign_table_schema, row.foreign_table_name);
    if (dependencies.has(key) && tableByKey.has(foreignKey) && key !== foreignKey) {
      dependencies.get(key)!.add(foreignKey);
    }
  }

  const ordered: BackupV3TableRef[] = [];
  const remaining = new Set(tables.map((table) => table.key));
  while (remaining.size > 0) {
    const ready = [...remaining].filter((key) => {
      const deps = dependencies.get(key) || new Set<string>();
      return [...deps].every((dependency) => !remaining.has(dependency));
    });
    if (ready.length === 0) {
      for (const key of [...remaining].sort()) {
        ordered.push(tableByKey.get(key)!);
        remaining.delete(key);
      }
      break;
    }
    ready.sort();
    for (const key of ready) {
      ordered.push(tableByKey.get(key)!);
      remaining.delete(key);
    }
  }
  return ordered;
}

function normalizeRowForInsert(
  table: BackupV3TableRef,
  row: UnknownRecord,
  jsonColumns: Map<string, Set<string>>
): UnknownRecord {
  const clone: UnknownRecord = { ...row };
  const tableJsonColumns = jsonColumns.get(table.key) || new Set<string>();
  for (const column of tableJsonColumns) {
    if (clone[column] !== null && clone[column] !== undefined && typeof clone[column] !== "string") {
      clone[column] = JSON.stringify(clone[column]);
    }
  }
  return clone;
}

async function insertRows(
  client: PoolClient,
  table: BackupV3TableRef,
  rows: UnknownRecord[],
  runtimeColumns: Map<string, Set<string>>,
  jsonColumns: Map<string, Set<string>>
): Promise<number> {
  let inserted = 0;
  const allowedColumns = runtimeColumns.get(table.key) || new Set<string>();
  for (const row of rows) {
    if (!row || typeof row !== "object" || Array.isArray(row)) {
      throw new HttpError(400, `Invalid row in backup table: ${table.key}`);
    }
    for (const column of Object.keys(row)) {
      if (!allowedColumns.has(column)) {
        throw new HttpError(400, `Backup contains unknown column ${table.key}.${column}`);
      }
    }
    const normalized = normalizeRowForInsert(table, row, jsonColumns);
    const columns = Object.keys(normalized);
    if (!columns.length) {
      continue;
    }
    const columnSql = columns.map(quoteIdent).join(", ");
    const placeholders = columns.map((_, index) => `$${index + 1}`).join(", ");
    await client.query(
      `insert into ${table.qualified} (${columnSql}) values (${placeholders})`,
      columns.map((column) => normalized[column])
    );
    inserted += 1;
  }
  return inserted;
}

async function reseedTableSequence(client: PoolClient, table: BackupV3TableRef): Promise<void> {
  const { rowCount } = await client.query(
    `
      select 1
      from information_schema.columns
      where table_schema = $1
        and table_name = $2
        and column_name = 'id'
      limit 1
    `,
    [table.schema, table.name]
  );
  if (!rowCount) {
    return;
  }
  const { rows } = await client.query<{ max_id: string }>(
    `select coalesce(max(${quoteIdent("id")}), 0) as max_id from ${table.qualified}`
  );
  const sequenceResult = await client.query<{ sequence_name: string | null }>(
    "select pg_get_serial_sequence($1, 'id') as sequence_name",
    [`${table.schema}.${table.name}`]
  );
  const sequenceName = sequenceResult.rows[0]?.sequence_name;
  if (!sequenceName) {
    return;
  }
  const maxId = BigInt(rows[0]?.max_id || "0");
  if (maxId === 0n) {
    await client.query("select setval($1::regclass, 1, false)", [sequenceName]);
    return;
  }
  await client.query("select setval($1::regclass, $2::bigint, true)", [sequenceName, maxId.toString()]);
}

async function readTableRows(stagingDir: string, table: BackupV3TableMetadata): Promise<UnknownRecord[]> {
  const fullPath = path.join(stagingDir, table.archivePath);
  const parsed = JSON.parse(await fs.readFile(fullPath, "utf8")) as unknown;
  if (!Array.isArray(parsed)) {
    throw new HttpError(400, `Invalid table data in backup: ${table.schema}.${table.name}`);
  }
  return parsed as UnknownRecord[];
}

export async function restoreBackupV3DatabaseOnly(
  client: PoolClient,
  manifest: BackupV3Manifest,
  stagingDir: string
): Promise<BackupV3DbRestoreResult> {
  const runtimeTables = await listBackupV3RuntimeTables(client);
  const runtimeColumns = await listBackupV3RuntimeColumns(client);
  const restoreTables = validateBackupV3ManifestTables(manifest, runtimeTables, runtimeColumns);
  const insertOrder = await getBackupV3InsertOrder(client, restoreTables);
  const jsonColumns = await listJsonColumns(client);
  const tableRows = new Map<string, UnknownRecord[]>();
  for (const table of manifest.database.tables) {
    tableRows.set(tableKey(table.schema, table.name), await readTableRows(stagingDir, table));
  }

  let rowsRestored = 0;
  await client.query("begin");
  try {
    await client.query("set constraints all deferred");
    await client.query(`truncate table ${restoreTables.map((table) => table.qualified).join(", ")} restart identity`);
    for (const table of insertOrder) {
      rowsRestored += await insertRows(client, table, tableRows.get(table.key) || [], runtimeColumns, jsonColumns);
    }
    for (const table of restoreTables) {
      await reseedTableSequence(client, table);
    }
    await client.query("commit");
    return { tablesRestored: restoreTables.length, rowsRestored };
  } catch (error) {
    await client.query("rollback").catch(() => undefined);
    throw error;
  }
}
