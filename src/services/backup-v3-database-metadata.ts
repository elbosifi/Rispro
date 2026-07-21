import type { PoolClient } from "pg";
import {
  BACKUP_V3_EXCLUDED_TABLES,
  BACKUP_V3_TABLE_SCHEMAS,
  type BackupV3ColumnMetadata,
  type BackupV3SchemaMetadata,
  type BackupV3TableMetadata,
} from "./backup-v3-types.js";

function tableArchivePath(schema: string, table: string): string {
  return `database/tables/${schema}.${table}.json`;
}

export async function buildBackupV3DatabaseMetadata(client: PoolClient): Promise<BackupV3SchemaMetadata> {
  const { rows: tableRows } = await client.query<{
    table_schema: string;
    table_name: string;
    row_count: string;
  }>(
    `
      select
        t.table_schema,
        t.table_name,
        (xpath('/row/count/text()', query_to_xml(format('select count(*) from %I.%I', t.table_schema, t.table_name), false, true, '')))[1]::text as row_count
      from information_schema.tables t
      where t.table_type = 'BASE TABLE'
        and t.table_schema = any($1::text[])
        and t.table_name <> all($2::text[])
      order by t.table_schema, t.table_name
    `,
    [[...BACKUP_V3_TABLE_SCHEMAS], [...BACKUP_V3_EXCLUDED_TABLES]]
  );

  const { rows: columnRows } = await client.query<{
    table_schema: string;
    table_name: string;
    column_name: string;
    data_type: string;
    udt_name: string;
    is_nullable: "YES" | "NO";
    column_default: string | null;
    ordinal_position: number;
  }>(
    `
      select
        table_schema,
        table_name,
        column_name,
        data_type,
        udt_name,
        is_nullable,
        column_default,
        ordinal_position
      from information_schema.columns
      where table_schema = any($1::text[])
      order by table_schema, table_name, ordinal_position
    `,
    [[...BACKUP_V3_TABLE_SCHEMAS]]
  );

  const columnsByTable = new Map<string, BackupV3ColumnMetadata[]>();
  for (const row of columnRows) {
    if ((BACKUP_V3_EXCLUDED_TABLES as readonly string[]).includes(row.table_name)) {
      continue;
    }
    const key = `${row.table_schema}.${row.table_name}`;
    const columns = columnsByTable.get(key) || [];
    columns.push({
      name: row.column_name,
      dataType: row.data_type,
      udtName: row.udt_name,
      isNullable: row.is_nullable === "YES",
      hasDefault: row.column_default !== null,
      ordinalPosition: row.ordinal_position,
    });
    columnsByTable.set(key, columns);
  }

  const tables: BackupV3TableMetadata[] = tableRows.map((row) => ({
    schema: row.table_schema,
    name: row.table_name,
    archivePath: tableArchivePath(row.table_schema, row.table_name),
    rowCount: Number(row.row_count || 0),
    columns: columnsByTable.get(`${row.table_schema}.${row.table_name}`) || [],
  }));

  const migrationHistory = await readMigrationHistory(client);
  const postgres = await readPostgresMetadata(client);
  return {
    schemas: [...BACKUP_V3_TABLE_SCHEMAS],
    migrationVersion: migrationHistory.at(-1) || null,
    migrationHistory,
    postgres,
    tables,
  };
}

async function readMigrationHistory(client: PoolClient): Promise<string[]> {
  const exists = await client.query<{ exists: boolean }>(`select to_regclass('public.schema_migrations') is not null as exists`);
  if (!exists.rows[0]?.exists) return [];
  const rows = await client.query<{ filename: string }>(`select filename from public.schema_migrations order by applied_at, filename`);
  return rows.rows.map((row) => row.filename);
}

async function readPostgresMetadata(client: PoolClient) {
  const database = await client.query<{ server_version_num: string; encoding: string; locale: string; collation: string }>(`select current_setting('server_version_num') as server_version_num, pg_encoding_to_char(encoding) as encoding, datcollate as collation, datcollate as locale from pg_database where datname=current_database()`);
  const extensions = await client.query<{ extname: string }>(`select extname from pg_extension order by extname`);
  const row = database.rows[0];
  return { serverMajor: row ? Math.floor(Number(row.server_version_num) / 10000) : null, pgDumpVersion: null, encoding: row?.encoding || null, locale: row?.locale || null, collation: row?.collation || null, extensions: extensions.rows.map((entry) => entry.extname) };
}

async function readMigrationVersion(client: PoolClient): Promise<string | null> {
  const { rows: tableRows } = await client.query<{ exists: boolean }>(
    `select to_regclass('public.schema_migrations') is not null as exists`
  );
  if (!tableRows[0]?.exists) {
    return null;
  }

  const { rows: columnRows } = await client.query<{ column_name: string }>(
    `
      select column_name
      from information_schema.columns
      where table_schema = 'public'
        and table_name = 'schema_migrations'
        and column_name in ('version', 'filename')
      order by case column_name when 'version' then 0 else 1 end
    `
  );
  const migrationColumn = columnRows[0]?.column_name;
  if (!migrationColumn) {
    return null;
  }

  const { rows } = await client.query<{ version: string }>(
    `
      select ${migrationColumn}::text as version
      from public.schema_migrations
      order by ${migrationColumn} desc
      limit 1
    `
  );
  return rows[0]?.version || null;
}
