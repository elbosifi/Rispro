// @ts-check

import fs from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";
import { env } from "../config/env.js";
import { pool } from "../db/pool.js";
import { HttpError } from "../utils/http-error.js";
import { logAuditEntry } from "./audit-service.js";

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
];

/**
 * @typedef {Record<string, unknown>} BackupRow
 */

/**
 * @typedef {BackupRow & { stored_path?: string, file_content_base64?: string }} BackupDocumentRow
 */

/**
 * @param {import("pg").PoolClient} client
 * @param {string} tableName
 */
async function listRows(client, tableName) {
  const { rows } = await client.query(`select * from ${tableName} order by 1 asc`);
  return /** @type {BackupRow[]} */ (rows);
}

/**
 * @param {BackupDocumentRow[]} documentRows
 */
async function readDocumentFiles(documentRows) {
  const enriched = [];

  for (const row of documentRows) {
    let fileContentBase64 = null;

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

/**
 * @typedef BackupPayload
 * @property {number} version
 * @property {string} created_at
 * @property {Record<string, BackupRow[]>} tables
 */

/**
 * @param {number | string | null} currentUserId
 * @returns {Promise<{ backupName: string, backup: BackupPayload }>}
 */
export async function buildBackupSnapshot(currentUserId) {
  const client = await pool.connect();

  try {
    const backup = {
      version: 1,
      created_at: new Date().toISOString(),
      tables: {}
    };

    for (const tableName of backupTables) {
      const rows = await listRows(client, tableName);
      backup.tables[tableName] = tableName === "documents" ? await readDocumentFiles(rows) : rows;
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

/**
 * @param {unknown} payload
 * @returns {asserts payload is BackupPayload}
 */
function requireBackupShape(payload) {
  const payloadRecord =
    payload && typeof payload === "object" ? /** @type {Record<string, unknown>} */ (payload) : null;

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

  const tableRecord = /** @type {Record<string, unknown>} */ (tables);
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

/**
 * @param {BackupDocumentRow[]} documentRows
 */
async function restoreDocumentFiles(documentRows) {
  for (const row of documentRows) {
    if (!row.stored_path || !row.file_content_base64) {
      continue;
    }

    const absolutePath = path.join(rootDir, row.stored_path);
    await fs.mkdir(path.dirname(absolutePath), { recursive: true });
    await fs.writeFile(absolutePath, Buffer.from(row.file_content_base64, "base64"));
  }
}

/**
 * @param {import("pg").PoolClient} client
 * @param {string} tableName
 * @param {BackupRow[]} rows
 */
async function insertRows(client, tableName, rows) {
  if (!rows?.length) {
    return;
  }

  const sanitizedRows = rows.map((row) => {
    const clone = { ...row };

    if (tableName === "documents") {
      delete clone.file_content_base64;
    }

    return clone;
  });

  const columns = Object.keys(sanitizedRows[0]);

  for (const row of sanitizedRows) {
    const values = /** @type {unknown[]} */ (columns.map((column) => row[column]));
    const placeholders = values.map((_, index) => `$${index + 1}`).join(", ");
    await client.query(
      `insert into ${tableName} (${columns.join(", ")}) values (${placeholders})`,
      values
    );
  }
}

/**
 * @param {import("pg").PoolClient} client
 * @param {number | string | null} userId
 */
async function userExists(client, userId) {
  if (!userId) {
    return false;
  }

  const { rowCount } = await client.query("select 1 from users where id = $1 limit 1", [userId]);
  return Number(rowCount || 0) > 0;
}

/**
 * @param {unknown} payload
 * @param {number | string | null} currentUserId
 * @returns {Promise<{ ok: true }>}
 */
export async function restoreBackupSnapshot(payload, currentUserId) {
  requireBackupShape(payload);
  const backupPayload = /** @type {BackupPayload} */ (payload);
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

    await restoreDocumentFiles(/** @type {BackupDocumentRow[]} */ (backupPayload.tables.documents || []));

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
