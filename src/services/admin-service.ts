import fs from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";
import type { PoolClient } from "pg";
import { env } from "../config/env.js";
import { pool } from "../db/pool.js";
import { HttpError } from "../utils/http-error.js";
import { logAuditEntry } from "./audit-service.js";
import type { NullableUserId, UnknownRecord } from "../types/http.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, "..", "..");

const backupTables = [
  "users",
  "reporting_priorities",
  "modalities",
  "exam_types",
  "patients",
  "appointments",
  "appointment_status_history",
  "queue_entries",
  "patient_custom_fields",
  "patient_custom_values",
  "name_dictionary",
  "documents",
  "dicom_devices",
  "dicom_message_log",
  "system_settings",
  "backup_runs",
  "audit_log"
] as const;

type BackupTableName = (typeof backupTables)[number];

interface BackupRow extends UnknownRecord {}

interface BackupDocumentRow extends BackupRow {
  stored_path?: string;
  file_content_base64?: string | null;
}

interface BackupPayload {
  version: number;
  created_at: string;
  tables: Record<string, BackupRow[]>;
}

function isValidTableName(tableName: string): tableName is BackupTableName {
  return (backupTables as readonly string[]).includes(tableName);
}

async function listRows(client: PoolClient, tableName: BackupTableName): Promise<BackupRow[]> {
  if (!isValidTableName(tableName)) {
    throw new HttpError(400, `Invalid table name: ${tableName}`);
  }
  const { rows } = await client.query<BackupRow>(`select * from ${tableName} order by 1 asc`);
  return rows;
}

async function readDocumentFiles(documentRows: BackupDocumentRow[]): Promise<BackupDocumentRow[]> {
  const enriched: BackupDocumentRow[] = [];

  for (const row of documentRows) {
    let fileContentBase64: string | null = null;

    if (row.stored_path) {
      const absolutePath = path.join(rootDir, row.stored_path);

      try {
        const fileBuffer = await fs.readFile(absolutePath);
        fileContentBase64 = fileBuffer.toString("base64");
      } catch {
        fileContentBase64 = null;
      }
    }

    enriched.push({
      ...row,
      file_content_base64: fileContentBase64
    });
  }

  return enriched;
}

export async function buildBackupSnapshot(
  currentUserId: NullableUserId
): Promise<{ backupName: string; backup: BackupPayload }> {
  const client = await pool.connect();

  try {
    const backup: BackupPayload = {
      version: 1,
      created_at: new Date().toISOString(),
      tables: {}
    };

    for (const tableName of backupTables) {
      const rows = await listRows(client, tableName);
      backup.tables[tableName] =
        tableName === "documents" ? await readDocumentFiles(rows as BackupDocumentRow[]) : rows;
    }

    const backupName = `rispro-backup-${backup.created_at.replace(/[:.]/g, "-")}.json`;
    await client.query(
      `
        insert into backup_runs (backup_name, storage_type, storage_path, initiated_by_user_id)
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
        newValues: { backupName },
        changedByUserId: currentUserId
      },
      client
    );

    return {
      backupName,
      backup
    };
  } finally {
    client.release();
  }
}

function requireBackupShape(payload: unknown): asserts payload is BackupPayload {
  const payloadRecord =
    payload && typeof payload === "object" ? (payload as UnknownRecord) : null;

  const tables = payloadRecord?.tables;
  if (
    !payloadRecord ||
    typeof payloadRecord.version !== "number" ||
    !tables ||
    typeof tables !== "object" ||
    Array.isArray(tables)
  ) {
    throw new HttpError(400, "Invalid backup payload.");
  }

  const tableRecord = tables as UnknownRecord;
  for (const tableName of backupTables) {
    const tableRows = tableRecord[tableName];

    if (tableRows === undefined) {
      continue;
    }

    if (!Array.isArray(tableRows)) {
      throw new HttpError(400, `Invalid backup payload for table: ${tableName}`);
    }
  }
}

async function restoreDocumentFiles(documentRows: BackupDocumentRow[]): Promise<void> {
  for (const row of documentRows) {
    if (!row.stored_path || !row.file_content_base64) {
      continue;
    }

    const absolutePath = path.join(rootDir, row.stored_path);
    await fs.mkdir(path.dirname(absolutePath), { recursive: true });
    await fs.writeFile(absolutePath, Buffer.from(row.file_content_base64, "base64"));
  }
}

// JSONB columns that need explicit serialization during restore
const JSONB_COLUMNS: Record<string, Set<string>> = {
  system_settings: new Set(["setting_value"]),
  dicom_message_log: new Set(["payload"]),
  appointments: new Set(["metadata"])
};

async function insertRows(
  client: PoolClient,
  tableName: BackupTableName,
  rows: BackupRow[]
): Promise<void> {
  if (!rows?.length) {
    return;
  }

  if (!isValidTableName(tableName)) {
    throw new HttpError(400, `Invalid table name: ${tableName}`);
  }

  const sanitizedRows = rows.map((row) => {
    const clone: UnknownRecord = { ...row };

    if (tableName === "documents") {
      delete clone.file_content_base64;
    }

    // Serialize JSONB columns to strings so pg doesn't double-encode
    // or send invalid JSON tokens.
    const jsonbCols = JSONB_COLUMNS[tableName];
    if (jsonbCols) {
      for (const col of jsonbCols) {
        if (col in clone && clone[col] !== null && clone[col] !== undefined) {
          const val = clone[col];
          // If already a string, ensure it's valid JSON or wrap it
          if (typeof val === "string") {
            try {
              JSON.parse(val);
              // Already valid JSON, leave as-is
            } catch {
              // Not valid JSON — wrap in quotes to make it a JSON string literal
              clone[col] = JSON.stringify(val);
            }
          } else if (typeof val === "object") {
            clone[col] = JSON.stringify(val);
          }
        }
      }
    }

    return clone;
  });

  const columns = Object.keys(sanitizedRows[0]);

  // Validate column names to prevent SQL injection via crafted backup files
  for (const column of columns) {
    if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(column)) {
      throw new HttpError(400, `Invalid column name: ${column}`);
    }
  }

  // Build explicit ::jsonb casts for jsonb columns
  const typedColumns = columns.map((col) => {
    const jsonbCols = JSONB_COLUMNS[tableName];
    if (jsonbCols?.has(col)) return `${col}::jsonb`;
    return col;
  });

  for (const row of sanitizedRows) {
    const values: unknown[] = columns.map((column) => row[column]);
    const placeholders = values.map((_, index) => `$${index + 1}`).join(", ");
    await client.query(
      `insert into ${tableName} (${typedColumns.join(", ")}) values (${placeholders})`,
      values
    );
  }
}

async function userExists(client: PoolClient, userId: NullableUserId): Promise<boolean> {
  if (!userId) {
    return false;
  }

  const { rowCount } = await client.query("select 1 from users where id = $1 limit 1", [userId]);
  return Number(rowCount || 0) > 0;
}

export async function restoreBackupSnapshot(
  payload: unknown,
  currentUserId: NullableUserId
): Promise<{ ok: true }> {
  requireBackupShape(payload);
  const backupPayload = payload;
  const client = await pool.connect();

  try {
    await client.query("begin");
    await client.query(
      `
        truncate table
          appointment_status_history,
          queue_entries,
          appointments,
          patient_custom_values,
          patient_custom_fields,
          documents,
          dicom_message_log,
          dicom_devices,
          patients,
          exam_types,
          modalities,
          reporting_priorities,
          name_dictionary,
          system_settings,
          backup_runs,
          audit_log,
          users
        restart identity cascade
      `
    );

    for (const tableName of backupTables) {
      await insertRows(client, tableName, backupPayload.tables[tableName] || []);
    }

    await restoreDocumentFiles(
      (backupPayload.tables.documents || []) as BackupDocumentRow[]
    );

    const restoreInitiator = (await userExists(client, currentUserId)) ? currentUserId : null;

    await client.query(
      `
        insert into backup_runs (backup_name, storage_type, storage_path, initiated_by_user_id)
        values ($1, 'restore_upload', $2, $3)
      `,
      [`restore-${new Date().toISOString()}`, "restore_upload", restoreInitiator]
    );

    await logAuditEntry(
      {
        entityType: "backup",
        entityId: null,
        actionType: "restore",
        oldValues: null,
        newValues: { restoredAt: new Date().toISOString() },
        changedByUserId: restoreInitiator
      },
      client
    );

    await client.query("commit");
    return { ok: true };
  } catch (error) {
    await client.query("rollback");
    throw error;
  } finally {
    client.release();
  }
}
