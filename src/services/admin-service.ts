import crypto from "node:crypto";
import fs from "fs/promises";
import path from "node:path";
import type { PoolClient } from "pg";
import { pool } from "../db/pool.js";
import { HttpError } from "../utils/http-error.js";
import { logAuditEntry } from "./audit-service.js";
import { getProjectRootDir, resolveStoredPath } from "./document-storage-path.js";
import type { NullableUserId, UnknownRecord } from "../types/http.js";

const BACKUP_VERSION = 2;
const RESTORE_CONFIRMATION = "RESTORE RISPRO";
const RESTORE_LOCK_KEY = "rispro_restore_v2";
const ENV_KDF = "scrypt";
const ENV_CIPHER = "aes-256-gcm";
const ENV_SALT_BYTES = 16;
const ENV_IV_BYTES = 12;
const ENV_KEY_BYTES = 32;

const BACKUP_SCHEMAS = ["public", "appointments_v2"] as const;
const EXCLUDED_TABLES = new Set(["schema_migrations"]);

const ENV_ALLOWLIST = [
  "NODE_ENV",
  "PORT",
  "RISPRO_DB_MODE",
  "RISPRO_DICOM_MODE",
  "RISPRO_MPPS_MODE",
  "DATABASE_URL",
  "DATABASE_SSL",
  "DATABASE_SSL_REJECT_UNAUTHORIZED",
  "DB_POOL_MAX",
  "JWT_SECRET",
  "COOKIE_NAME",
  "REAUTH_COOKIE_NAME",
  "COOKIE_SECURE",
  "COOKIE_SAMESITE",
  "SESSION_HOURS",
  "SUPERVISOR_REAUTH_MINUTES",
  "REQUEST_BODY_LIMIT",
  "TRUST_PROXY",
  "UPLOADS_DIR",
  "SEED_SUPERVISOR_USERNAME",
  "SEED_SUPERVISOR_PASSWORD",
  "SEED_SUPERVISOR_FULL_NAME",
  "SEED_SUPER_ADMIN_USERNAME",
  "SEED_SUPER_ADMIN_PASSWORD",
  "SEED_SUPER_ADMIN_FULL_NAME",
  "ORTHANC_AUTH_ENABLED",
  "ORTHANC_MWL_ENABLED",
  "ORTHANC_MWL_SHADOW_MODE",
  "ORTHANC_BASE_URL",
  "ORTHANC_USERNAME",
  "ORTHANC_PASSWORD",
  "ORTHANC_TIMEOUT_SECONDS",
  "ORTHANC_VERIFY_TLS",
  "ORTHANC_WORKLIST_TARGET",
  "SANTE_HL7_ENABLED",
  "SANTE_HL7_OUTPUT_FOLDER_PATH",
  "SANTE_HL7_ALLOWED_BASE_PATHS",
  "SANTE_HL7_HOST_OUTBOX_HINT",
  "SANTE_HL7_WINDOWS_SHARE_SOURCE_HINT",
  "MPPS_BRIDGE_PORT",
  "MPPS_BRIDGE_AE_TITLE",
  "MPPS_AUTH_ENABLED",
  "MPPS_USERNAME",
  "MPPS_PASSWORD",
  "WEB_PUSH_ENABLED",
  "WEB_PUSH_VAPID_PUBLIC_KEY",
  "WEB_PUSH_VAPID_PRIVATE_KEY",
  "WEB_PUSH_VAPID_SUBJECT",
  "WEB_PUSH_REMINDER_HOURS",
  "WEB_PUSH_WORKER_INTERVAL_SECONDS",
  "WEB_PUSH_DELIVERY_MAX_ATTEMPTS",
  "WEB_PUSH_REPORT_READY_SCAN_INTERVAL_SECONDS",
  "WEB_PUSH_REPORT_READY_LOOKBACK_DAYS",
  "WEB_PUSH_REPORT_READY_MAX_CHECKS_PER_RUN"
] as const;

const SECRET_ENV_PATTERNS = [/SECRET/i, /PASSWORD/i, /DATABASE_URL/i, /PRIVATE/i, /TOKEN/i, /KEY/i];
const MACHINE_ENV_PATTERNS = [/URL/i, /HOST/i, /PATH/i, /DIR/i, /FOLDER/i, /TARGET/i, /PORT/i];

interface BackupTableRef {
  schema: string;
  name: string;
  key: string;
  qualified: string;
}

interface BackupRow extends UnknownRecord {}

interface BackupDocumentRow extends BackupRow {
  stored_path?: string;
  file_content_base64?: string | null;
}

interface BackupPayload {
  version: number;
  created_at: string;
  manifest: {
    appName: "rispro";
    backupVersion: number;
    schemas: string[];
    tableCounts: Record<string, number>;
    documents: {
      rows: number;
      filesIncluded: number;
      filesMissing: number;
    };
  };
  env: EncryptedEnvBundle;
  tables: Record<string, BackupRow[]>;
}

interface EncryptedEnvBundle {
  cipher: typeof ENV_CIPHER;
  kdf: typeof ENV_KDF;
  salt: string;
  iv: string;
  authTag: string;
  data: string;
  variableNames: string[];
}

interface EnvPayload {
  createdAt: string;
  variables: Record<string, string>;
}

export interface RestorePreview {
  ok: true;
  manifest: BackupPayload["manifest"] & { createdAt: string };
  tables: Array<{ name: string; rows: number }>;
  documents: BackupPayload["manifest"]["documents"];
  env: Array<{ name: string; value: string; isSecret: boolean; requiresReview: boolean }>;
  warnings: string[];
}

export interface RestoreResult {
  ok: true;
  restoredAt: string;
  tablesRestored: number;
  documentsRestored: number;
  envVarsRestored: number;
  restartRequired: true;
}

export interface RestartResult {
  ok: true;
  restartScheduled: true;
  message: string;
}

function quoteIdent(value: string): string {
  if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(value)) {
    throw new HttpError(400, `Invalid identifier: ${value}`);
  }
  return `"${value.replace(/"/g, '""')}"`;
}

function tableKey(schema: string, tableName: string): string {
  return `${schema}.${tableName}`;
}

function requirePassphrase(passphrase: unknown): string {
  const value = String(passphrase || "");
  if (value.length < 8) {
    throw new HttpError(400, "Backup passphrase must be at least 8 characters.");
  }
  return value;
}

function normalizePayloadRecord(payload: unknown): UnknownRecord {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    throw new HttpError(400, "Invalid backup payload.");
  }
  return payload as UnknownRecord;
}

async function listBackupTables(client: PoolClient): Promise<BackupTableRef[]> {
  const { rows } = await client.query<{ table_schema: string; table_name: string }>(
    `
      select table_schema, table_name
      from information_schema.tables
      where table_type = 'BASE TABLE'
        and table_schema = any($1::text[])
      order by table_schema, table_name
    `,
    [[...BACKUP_SCHEMAS]]
  );

  return rows
    .filter((row) => !EXCLUDED_TABLES.has(row.table_name))
    .map((row) => ({
      schema: row.table_schema,
      name: row.table_name,
      key: tableKey(row.table_schema, row.table_name),
      qualified: `${quoteIdent(row.table_schema)}.${quoteIdent(row.table_name)}`
    }));
}

async function listTableColumns(client: PoolClient): Promise<Map<string, Set<string>>> {
  const { rows } = await client.query<{ table_schema: string; table_name: string; column_name: string }>(
    `
      select table_schema, table_name, column_name
      from information_schema.columns
      where table_schema = any($1::text[])
    `,
    [[...BACKUP_SCHEMAS]]
  );
  const map = new Map<string, Set<string>>();

  for (const row of rows) {
    const key = tableKey(row.table_schema, row.table_name);
    if (!map.has(key)) {
      map.set(key, new Set());
    }
    map.get(key)!.add(row.column_name);
  }

  return map;
}

async function listJsonColumns(client: PoolClient): Promise<Map<string, Set<string>>> {
  const { rows } = await client.query<{ table_schema: string; table_name: string; column_name: string }>(
    `
      select table_schema, table_name, column_name
      from information_schema.columns
      where table_schema = any($1::text[])
        and udt_name in ('json', 'jsonb')
    `,
    [[...BACKUP_SCHEMAS]]
  );
  const map = new Map<string, Set<string>>();

  for (const row of rows) {
    const key = tableKey(row.table_schema, row.table_name);
    if (!map.has(key)) {
      map.set(key, new Set());
    }
    map.get(key)!.add(row.column_name);
  }

  return map;
}

async function listRows(client: PoolClient, table: BackupTableRef): Promise<BackupRow[]> {
  const { rows } = await client.query<BackupRow>(`select * from ${table.qualified} order by 1 asc`);
  return rows;
}

async function readDocumentFiles(documentRows: BackupDocumentRow[]): Promise<{
  rows: BackupDocumentRow[];
  filesIncluded: number;
  filesMissing: number;
}> {
  const enriched: BackupDocumentRow[] = [];
  let filesIncluded = 0;
  let filesMissing = 0;

  for (const row of documentRows) {
    let fileContentBase64: string | null = null;

    if (row.stored_path) {
      try {
        const fileBuffer = await fs.readFile(resolveStoredPath(row.stored_path));
        fileContentBase64 = fileBuffer.toString("base64");
        filesIncluded += 1;
      } catch {
        filesMissing += 1;
      }
    }

    enriched.push({
      ...row,
      file_content_base64: fileContentBase64
    });
  }

  return { rows: enriched, filesIncluded, filesMissing };
}

function buildEnvPayload(): EnvPayload {
  const variables: Record<string, string> = {};
  for (const name of ENV_ALLOWLIST) {
    const value = process.env[name];
    if (value !== undefined) {
      variables[name] = value;
    }
  }
  return { createdAt: new Date().toISOString(), variables };
}

function deriveEnvKey(passphrase: string, salt: Buffer): Buffer {
  return crypto.scryptSync(passphrase, salt, ENV_KEY_BYTES);
}

function encryptEnvPayload(payload: EnvPayload, passphrase: string): EncryptedEnvBundle {
  const salt = crypto.randomBytes(ENV_SALT_BYTES);
  const iv = crypto.randomBytes(ENV_IV_BYTES);
  const key = deriveEnvKey(passphrase, salt);
  const cipher = crypto.createCipheriv(ENV_CIPHER, key, iv);
  const encrypted = Buffer.concat([cipher.update(JSON.stringify(payload), "utf8"), cipher.final()]);

  return {
    cipher: ENV_CIPHER,
    kdf: ENV_KDF,
    salt: salt.toString("base64"),
    iv: iv.toString("base64"),
    authTag: cipher.getAuthTag().toString("base64"),
    data: encrypted.toString("base64"),
    variableNames: Object.keys(payload.variables).sort()
  };
}

function decryptEnvPayload(bundle: EncryptedEnvBundle, passphrase: string): EnvPayload {
  try {
    if (bundle.cipher !== ENV_CIPHER || bundle.kdf !== ENV_KDF) {
      throw new Error("Unsupported env encryption.");
    }
    const key = deriveEnvKey(passphrase, Buffer.from(bundle.salt, "base64"));
    const decipher = crypto.createDecipheriv(ENV_CIPHER, key, Buffer.from(bundle.iv, "base64"));
    decipher.setAuthTag(Buffer.from(bundle.authTag, "base64"));
    const decrypted = Buffer.concat([
      decipher.update(Buffer.from(bundle.data, "base64")),
      decipher.final()
    ]).toString("utf8");
    const parsed = JSON.parse(decrypted) as EnvPayload;
    if (!parsed.variables || typeof parsed.variables !== "object") {
      throw new Error("Invalid env payload.");
    }
    return parsed;
  } catch {
    throw new HttpError(400, "Could not decrypt env bundle. Check the backup passphrase.");
  }
}

function isSecretEnv(name: string): boolean {
  return SECRET_ENV_PATTERNS.some((pattern) => pattern.test(name));
}

function requiresMachineReview(name: string): boolean {
  return MACHINE_ENV_PATTERNS.some((pattern) => pattern.test(name));
}

function maskEnvValue(name: string, value: string): string {
  if (!isSecretEnv(name)) {
    return value;
  }
  if (!value) {
    return "";
  }
  return value.length <= 4 ? "****" : `${value.slice(0, 2)}****${value.slice(-2)}`;
}

function requireBackupShape(payload: unknown): asserts payload is BackupPayload {
  const payloadRecord = normalizePayloadRecord(payload);
  const tables = payloadRecord.tables;
  const manifest = payloadRecord.manifest;
  const envBundle = payloadRecord.env;

  if (
    payloadRecord.version !== BACKUP_VERSION ||
    !payloadRecord.created_at ||
    !manifest ||
    typeof manifest !== "object" ||
    !tables ||
    typeof tables !== "object" ||
    Array.isArray(tables) ||
    !envBundle ||
    typeof envBundle !== "object" ||
    Array.isArray(envBundle)
  ) {
    throw new HttpError(400, "Invalid or unsupported backup payload.");
  }
}

async function validateBackupTables(client: PoolClient, payload: BackupPayload): Promise<BackupTableRef[]> {
  const knownTables = await listBackupTables(client);
  const knownKeys = new Set(knownTables.map((table) => table.key));
  const tableColumns = await listTableColumns(client);

  for (const key of Object.keys(payload.tables)) {
    if (!knownKeys.has(key)) {
      throw new HttpError(400, `Backup contains unknown table: ${key}`);
    }

    const rows = payload.tables[key];
    if (!Array.isArray(rows)) {
      throw new HttpError(400, `Invalid backup payload for table: ${key}`);
    }

    const columns = tableColumns.get(key) || new Set<string>();
    for (const row of rows) {
      if (!row || typeof row !== "object" || Array.isArray(row)) {
        throw new HttpError(400, `Invalid row in backup table: ${key}`);
      }
      for (const column of Object.keys(row)) {
        if (key === "public.documents" && column === "file_content_base64") {
          continue;
        }
        if (!columns.has(column)) {
          throw new HttpError(400, `Backup contains unknown column ${key}.${column}`);
        }
      }
    }
  }

  return knownTables;
}

async function getInsertOrder(client: PoolClient, tables: BackupTableRef[]): Promise<BackupTableRef[]> {
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
    [[...BACKUP_SCHEMAS]]
  );

  for (const row of rows) {
    const key = tableKey(row.table_schema, row.table_name);
    const foreignKey = tableKey(row.foreign_table_schema, row.foreign_table_name);
    if (dependencies.has(key) && tableByKey.has(foreignKey) && key !== foreignKey) {
      dependencies.get(key)!.add(foreignKey);
    }
  }

  const ordered: BackupTableRef[] = [];
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

async function deferBackupForeignKeys(client: PoolClient): Promise<void> {
  const { rows } = await client.query<{
    table_schema: string;
    table_name: string;
    constraint_name: string;
  }>(
    `
      select
        child_schema.nspname as table_schema,
        child.relname as table_name,
        constraint_row.conname as constraint_name
      from pg_constraint constraint_row
      join pg_class child on child.oid = constraint_row.conrelid
      join pg_namespace child_schema on child_schema.oid = child.relnamespace
      where constraint_row.contype = 'f'
        and child_schema.nspname = any($1::text[])
    `,
    [[...BACKUP_SCHEMAS]]
  );

  for (const row of rows) {
    await client.query(
      `alter table ${quoteIdent(row.table_schema)}.${quoteIdent(row.table_name)} alter constraint ${quoteIdent(row.constraint_name)} deferrable initially deferred`
    );
  }
  await client.query("set constraints all deferred");
}

function normalizeRowsForInsert(
  table: BackupTableRef,
  rows: BackupRow[],
  jsonColumns: Map<string, Set<string>>
): BackupRow[] {
  const tableJsonColumns = jsonColumns.get(table.key) || new Set<string>();

  return rows.map((row) => {
    const clone: UnknownRecord = { ...row };
    if (table.key === "public.documents") {
      delete clone.file_content_base64;
    }
    for (const column of tableJsonColumns) {
      if (clone[column] !== null && clone[column] !== undefined) {
        if (typeof clone[column] === "string") {
          try {
            JSON.parse(clone[column] as string);
          } catch {
            clone[column] = JSON.stringify(clone[column]);
          }
        } else {
          clone[column] = JSON.stringify(clone[column]);
        }
      }
    }
    return clone;
  });
}

async function insertRows(
  client: PoolClient,
  table: BackupTableRef,
  rows: BackupRow[],
  jsonColumns: Map<string, Set<string>>
): Promise<void> {
  if (!rows.length) {
    return;
  }

  const sanitizedRows = normalizeRowsForInsert(table, rows, jsonColumns);
  const columns = Object.keys(sanitizedRows[0]);
  for (const column of columns) {
    quoteIdent(column);
  }
  const columnSql = columns.map(quoteIdent).join(", ");
  const placeholders = columns.map((_, index) => `$${index + 1}`).join(", ");

  for (const row of sanitizedRows) {
    const values = columns.map((column) => row[column]);
    await client.query(`insert into ${table.qualified} (${columnSql}) values (${placeholders})`, values);
  }
}

async function reseedTableSequence(client: PoolClient, table: BackupTableRef): Promise<void> {
  const columns = await client.query<{ column_name: string }>(
    `
      select column_name
      from information_schema.columns
      where table_schema = $1
        and table_name = $2
        and column_name = 'id'
      limit 1
    `,
    [table.schema, table.name]
  );
  if (!columns.rowCount) {
    return;
  }

  const { rows } = await client.query<{ max_id: string }>(
    `select coalesce(max(${quoteIdent("id")}), 0) as max_id from ${table.qualified}`
  );
  const maxId = BigInt(rows[0]?.max_id || "0");
  const sequenceNameResult = await client.query<{ sequence_name: string | null }>(
    `select pg_get_serial_sequence($1, 'id') as sequence_name`,
    [`${table.schema}.${table.name}`]
  );
  const sequenceName = sequenceNameResult.rows[0]?.sequence_name;
  if (!sequenceName) {
    return;
  }

  if (maxId === 0n) {
    await client.query(`select setval($1::regclass, 1, false)`, [sequenceName]);
    return;
  }
  await client.query(`select setval($1::regclass, $2::bigint, true)`, [sequenceName, maxId.toString()]);
}

async function userExists(client: PoolClient, userId: NullableUserId): Promise<boolean> {
  if (!userId) {
    return false;
  }
  const { rowCount } = await client.query("select 1 from public.users where id = $1 limit 1", [userId]);
  return Number(rowCount || 0) > 0;
}

async function restoreDocumentFiles(documentRows: BackupDocumentRow[]): Promise<number> {
  let restored = 0;
  for (const row of documentRows) {
    if (!row.stored_path || !row.file_content_base64) {
      continue;
    }
    const absolutePath = resolveStoredPath(row.stored_path);
    await fs.mkdir(path.dirname(absolutePath), { recursive: true });
    await fs.writeFile(absolutePath, Buffer.from(row.file_content_base64, "base64"));
    restored += 1;
  }
  return restored;
}

function formatEnvValue(value: string): string {
  if (/[\n\r]/.test(value)) {
    return JSON.stringify(value);
  }
  if (value === "" || /[\s#"'`$\\]/.test(value)) {
    return JSON.stringify(value);
  }
  return value;
}

function parseDotEnv(content: string): Map<string, string> {
  const values = new Map<string, string>();
  for (const line of content.split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
    if (!match) {
      continue;
    }
    values.set(match[1], match[2]);
  }
  return values;
}

async function writeRestoredEnvFile(envPayload: EnvPayload): Promise<number> {
  const envPath = path.join(getProjectRootDir(), ".env");
  let existing = "";
  try {
    existing = await fs.readFile(envPath, "utf8");
    const backupPath = path.join(
      getProjectRootDir(),
      `.env.pre-restore-${new Date().toISOString().replace(/[:.]/g, "-")}`
    );
    await fs.writeFile(backupPath, existing, { flag: "wx" });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
      throw error;
    }
  }

  const restoredVariables = Object.fromEntries(
    Object.entries(envPayload.variables).filter(([name]) => (ENV_ALLOWLIST as readonly string[]).includes(name))
  );
  const existingValues = parseDotEnv(existing);
  for (const [name, value] of Object.entries(restoredVariables)) {
    existingValues.set(name, formatEnvValue(value));
  }

  const lines = [...existingValues.entries()].map(([name, value]) => `${name}=${value}`);
  const tempPath = `${envPath}.restore-${process.pid}.tmp`;
  await fs.writeFile(tempPath, `${lines.join("\n")}\n`, { flag: "wx" });
  await fs.rename(tempPath, envPath);
  return Object.keys(restoredVariables).length;
}

export async function buildBackupSnapshot(
  currentUserId: NullableUserId,
  passphrase: unknown
): Promise<{ backupName: string; backup: BackupPayload }> {
  const cleanPassphrase = requirePassphrase(passphrase);
  const client = await pool.connect();

  try {
    const createdAt = new Date().toISOString();
    const tables = await listBackupTables(client);
    const backup: BackupPayload = {
      version: BACKUP_VERSION,
      created_at: createdAt,
      manifest: {
        appName: "rispro",
        backupVersion: BACKUP_VERSION,
        schemas: [...BACKUP_SCHEMAS],
        tableCounts: {},
        documents: { rows: 0, filesIncluded: 0, filesMissing: 0 }
      },
      env: encryptEnvPayload(buildEnvPayload(), cleanPassphrase),
      tables: {}
    };

    for (const table of tables) {
      const rows = await listRows(client, table);
      if (table.key === "public.documents") {
        const documents = await readDocumentFiles(rows as BackupDocumentRow[]);
        backup.tables[table.key] = documents.rows;
        backup.manifest.documents = {
          rows: documents.rows.length,
          filesIncluded: documents.filesIncluded,
          filesMissing: documents.filesMissing
        };
      } else {
        backup.tables[table.key] = rows;
      }
      backup.manifest.tableCounts[table.key] = backup.tables[table.key].length;
    }

    const backupName = `rispro-backup-${createdAt.replace(/[:.]/g, "-")}.json`;
    await client.query(
      `
        insert into public.backup_runs (backup_name, storage_type, storage_path, initiated_by_user_id)
        values ($1, 'browser_download', $2, $3)
      `,
      [backupName, "browser_download", currentUserId]
    );

    await logAuditEntry(
      {
        entityType: "backup",
        entityId: null,
        actionType: "download",
        oldValues: null,
        newValues: { backupName, backupVersion: BACKUP_VERSION },
        changedByUserId: currentUserId
      },
      client
    );

    return { backupName, backup };
  } finally {
    client.release();
  }
}

export async function previewBackupRestore(payload: unknown, passphrase: unknown): Promise<RestorePreview> {
  requireBackupShape(payload);
  const cleanPassphrase = requirePassphrase(passphrase);
  const envPayload = decryptEnvPayload(payload.env, cleanPassphrase);
  const client = await pool.connect();

  try {
    await validateBackupTables(client, payload);
    const warnings: string[] = [];
    if (payload.manifest.documents.filesMissing > 0) {
      warnings.push(`${payload.manifest.documents.filesMissing} document files were missing when this backup was created.`);
    }

    return {
      ok: true,
      manifest: {
        ...payload.manifest,
        createdAt: payload.created_at
      },
      tables: Object.entries(payload.tables)
        .map(([name, rows]) => ({ name, rows: rows.length }))
        .sort((a, b) => a.name.localeCompare(b.name)),
      documents: payload.manifest.documents,
      env: Object.entries(envPayload.variables)
        .filter(([name]) => (ENV_ALLOWLIST as readonly string[]).includes(name))
        .map(([name, value]) => ({
          name,
          value: maskEnvValue(name, value),
          isSecret: isSecretEnv(name),
          requiresReview: requiresMachineReview(name)
        }))
        .sort((a, b) => a.name.localeCompare(b.name)),
      warnings
    };
  } finally {
    client.release();
  }
}

export async function restoreBackupSnapshot(
  payload: unknown,
  currentUserId: NullableUserId,
  passphrase: unknown,
  confirmation: unknown
): Promise<RestoreResult> {
  requireBackupShape(payload);
  if (String(confirmation || "") !== RESTORE_CONFIRMATION) {
    throw new HttpError(400, `Confirmation must be ${RESTORE_CONFIRMATION}.`);
  }

  const cleanPassphrase = requirePassphrase(passphrase);
  const envPayload = decryptEnvPayload(payload.env, cleanPassphrase);
  const client = await pool.connect();
  let restoreLockAcquired = false;

  try {
    const lock = await client.query<{ locked: boolean }>("select pg_try_advisory_lock(hashtext($1)) as locked", [
      RESTORE_LOCK_KEY
    ]);
    restoreLockAcquired = Boolean(lock.rows[0]?.locked);
    if (!restoreLockAcquired) {
      throw new HttpError(409, "Another restore is already running.");
    }

    const knownTables = await validateBackupTables(client, payload);
    const insertOrder = await getInsertOrder(client, knownTables);
    const jsonColumns = await listJsonColumns(client);
    const truncateSql = knownTables.map((table) => table.qualified).join(", ");

    await client.query("begin");
    await deferBackupForeignKeys(client);
    await client.query(`truncate table ${truncateSql} restart identity cascade`);

    for (const table of insertOrder) {
      await insertRows(client, table, payload.tables[table.key] || [], jsonColumns);
    }

    for (const table of knownTables) {
      await reseedTableSequence(client, table);
    }

    const documentsRestored = await restoreDocumentFiles((payload.tables["public.documents"] || []) as BackupDocumentRow[]);
    const restoreInitiator = (await userExists(client, currentUserId)) ? currentUserId : null;
    const restoredAt = new Date().toISOString();

    await client.query(
      `
        insert into public.backup_runs (backup_name, storage_type, storage_path, initiated_by_user_id)
        values ($1, 'restore_upload', $2, $3)
      `,
      [`restore-${restoredAt}`, "restore_upload", restoreInitiator]
    );

    await logAuditEntry(
      {
        entityType: "backup",
        entityId: null,
        actionType: "restore",
        oldValues: null,
        newValues: {
          restoredAt,
          backupVersion: payload.version,
          tablesRestored: knownTables.length,
          documentsRestored
        },
        changedByUserId: restoreInitiator
      },
      client
    );

    await client.query("commit");
    const envVarsRestored = await writeRestoredEnvFile(envPayload);

    return {
      ok: true,
      restoredAt,
      tablesRestored: knownTables.length,
      documentsRestored,
      envVarsRestored,
      restartRequired: true
    };
  } catch (error) {
    try {
      await client.query("rollback");
    } catch {
      // Ignore rollback errors when the transaction never started.
    }
    throw error;
  } finally {
    if (restoreLockAcquired) {
      await client.query("select pg_advisory_unlock(hashtext($1))", [RESTORE_LOCK_KEY]).catch(() => undefined);
    }
    client.release();
  }
}

export async function scheduleSystemRestart(currentUserId: NullableUserId): Promise<RestartResult> {
  await logAuditEntry({
    entityType: "system",
    entityId: null,
    actionType: "restart_requested",
    oldValues: null,
    newValues: { requestedAt: new Date().toISOString() },
    changedByUserId: currentUserId
  });

  setTimeout(() => {
    process.kill(process.pid, "SIGTERM");
  }, 750).unref();

  return {
    ok: true,
    restartScheduled: true,
    message: "RISpro restart has been requested. Wait a few seconds, then refresh if the page does not reconnect automatically."
  };
}
