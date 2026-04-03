// @ts-check

import { pool } from "../db/pool.js";
import { HttpError } from "../utils/http-error.js";

/** @typedef {import("../types/domain.js").AuditEvent} DomainAuditEvent */
/** @typedef {import("../types/db.js").DbExecutor} DbExecutor */

/**
 * @typedef AuditEntryInput
 * @property {string} entityType
 * @property {number | string | null} [entityId]
 * @property {string} actionType
 * @property {unknown} [oldValues]
 * @property {unknown} [newValues]
 * @property {number | string | null} [changedByUserId]
 */

/**
 * @typedef AuditFilters
 * @property {number | string} [limit]
 * @property {string} [entityType]
 * @property {string} [actionType]
 * @property {number | string} [changedByUserId]
 * @property {string} [dateFrom]
 * @property {string} [dateTo]
 */

/**
 * @typedef AuditLogRow
 * @property {number} id
 * @property {string} entity_type
 * @property {number | string | null} entity_id
 * @property {string} action_type
 * @property {unknown} old_values
 * @property {unknown} new_values
 * @property {number | string | null} changed_by_user_id
 * @property {string} created_at
 * @property {string | null} [changed_by_name]
 * @property {string | null} [changed_by_username]
 */

/**
 * @typedef AuditEntityTypeRow
 * @property {string} entity_type
 */

/**
 * @typedef AuditActionTypeRow
 * @property {string} action_type
 */

/**
 * @typedef AuditUserOptionRow
 * @property {number | string} id
 * @property {string | null} full_name
 * @property {string | null} username
 */

/**
 * @param {DbExecutor} [executor]
 */
async function isAuditEnabled(executor = pool) {
  const { rows } = await executor.query(
    `
      select setting_value
      from system_settings
      where category = 'audit_and_logging'
        and setting_key = 'audit_trail'
      limit 1
    `
  );

  const firstRow = /** @type {{ setting_value?: { value?: unknown } } | undefined} */ (rows[0]);
  const value = String(firstRow?.setting_value?.value ?? "");
  return value !== "disabled";
}

/**
 * @template T
 * @param {T | undefined} row
 * @param {string} message
 * @returns {T}
 */
function requireRow(row, message) {
  if (!row) {
    throw new HttpError(500, message);
  }

  return row;
}

/**
 * @param {AuditEntryInput & Partial<DomainAuditEvent>} entry
 * @param {DbExecutor} [executor]
 */
export async function logAuditEntry(
  {
    entityType,
    entityId = null,
    actionType,
    oldValues = null,
    newValues = null,
    changedByUserId = null
  },
  executor = pool
) {
  if (!(await isAuditEnabled(executor))) {
    return null;
  }

  const { rows } = await executor.query(
    `
      insert into audit_log (
        entity_type,
        entity_id,
        action_type,
        old_values,
        new_values,
        changed_by_user_id
      )
      values ($1, $2, $3, $4::jsonb, $5::jsonb, $6)
      returning id, entity_type, entity_id, action_type, old_values, new_values, changed_by_user_id, created_at
    `,
    [
      entityType,
      entityId,
      actionType,
      JSON.stringify(oldValues),
      JSON.stringify(newValues),
      changedByUserId
    ]
  );

  return requireRow(/** @type {AuditLogRow | undefined} */ (rows[0]), "Failed to write audit log entry.");
}

/**
 * @param {unknown} value
 * @param {string} fieldName
 * @param {{ required?: boolean, max?: number }} [options]
 */
function normalizePositiveInteger(value, fieldName, { required = false, max = 5000 } = {}) {
  if (value === undefined || value === null || value === "") {
    if (required) {
      throw new HttpError(400, `${fieldName} is required.`);
    }

    return null;
  }

  const parsed = Number(value);

  if (!Number.isInteger(parsed) || parsed <= 0 || parsed > max) {
    throw new HttpError(400, `${fieldName} must be a positive whole number.`);
  }

  return parsed;
}

/**
 * @param {unknown} value
 */
function normalizeStringFilter(value) {
  const clean = String(value || "").trim();
  return clean || null;
}

/**
 * @param {unknown} value
 * @param {string} fieldName
 */
function normalizeDateFilter(value, fieldName) {
  const clean = String(value || "").trim();

  if (!clean) {
    return null;
  }

  if (!/^\d{4}-\d{2}-\d{2}$/.test(clean)) {
    throw new HttpError(400, `${fieldName} must be in YYYY-MM-DD format.`);
  }

  return clean;
}

/**
 * @param {AuditFilters} [filters]
 * @param {{ includeLimit?: boolean }} [options]
 */
function buildAuditFilterQuery(filters = {}, { includeLimit = true } = {}) {
  const cleanLimit = includeLimit ? Math.min(Math.max(Number(filters.limit) || 100, 1), 5000) : null;
  const entityType = normalizeStringFilter(filters.entityType);
  const actionType = normalizeStringFilter(filters.actionType);
  const changedByUserId = normalizePositiveInteger(filters.changedByUserId, "changedByUserId");
  const dateFrom = normalizeDateFilter(filters.dateFrom, "dateFrom");
  const dateTo = normalizeDateFilter(filters.dateTo, "dateTo");

  if (dateFrom && dateTo && dateFrom > dateTo) {
    throw new HttpError(400, "dateFrom cannot be later than dateTo.");
  }

  const clauses = [];
  const params = [];

  if (entityType) {
    params.push(entityType);
    clauses.push(`audit_log.entity_type = $${params.length}`);
  }

  if (actionType) {
    params.push(actionType);
    clauses.push(`audit_log.action_type = $${params.length}`);
  }

  if (changedByUserId) {
    params.push(changedByUserId);
    clauses.push(`audit_log.changed_by_user_id = $${params.length}`);
  }

  if (dateFrom) {
    params.push(dateFrom);
    clauses.push(`audit_log.created_at >= $${params.length}::date`);
  }

  if (dateTo) {
    params.push(dateTo);
    clauses.push(`audit_log.created_at < ($${params.length}::date + interval '1 day')`);
  }

  const whereClause = clauses.length ? `where ${clauses.join(" and ")}` : "";
  let limitClause = "";

  if (includeLimit) {
    params.push(cleanLimit);
    limitClause = `limit $${params.length}`;
  }

  return { params, whereClause, limitClause };
}

/**
 * @param {AuditFilters} [filters]
 */
export async function listAuditEntries(filters = {}) {
  const { params, whereClause, limitClause } = buildAuditFilterQuery(filters, { includeLimit: true });

  const { rows } = await pool.query(
    `
      select
        audit_log.id,
        audit_log.entity_type,
        audit_log.entity_id,
        audit_log.action_type,
        audit_log.old_values,
        audit_log.new_values,
        audit_log.changed_by_user_id,
        audit_log.created_at,
        users.full_name as changed_by_name,
        users.username as changed_by_username
      from audit_log
      left join users on users.id = audit_log.changed_by_user_id
      ${whereClause}
      order by audit_log.created_at desc
      ${limitClause}
    `,
    params
  );

  return /** @type {AuditLogRow[]} */ (rows);
}

export async function listAuditFilterOptions() {
  const [entityTypeResult, actionTypeResult, userResult] = await Promise.all([
    pool.query(
      `
        select distinct entity_type
        from audit_log
        where entity_type is not null
        order by entity_type asc
      `
    ),
    pool.query(
      `
        select distinct action_type
        from audit_log
        where action_type is not null
        order by action_type asc
      `
    ),
    pool.query(
      `
        select distinct users.id, users.full_name, users.username
        from audit_log
        join users on users.id = audit_log.changed_by_user_id
        order by users.full_name asc nulls last, users.username asc
      `
    )
  ]);

  const entityTypeRows = /** @type {AuditEntityTypeRow[]} */ (entityTypeResult.rows);
  const actionTypeRows = /** @type {AuditActionTypeRow[]} */ (actionTypeResult.rows);
  const userRows = /** @type {AuditUserOptionRow[]} */ (userResult.rows);

  return {
    entityTypes: entityTypeRows.map((row) => row.entity_type),
    actionTypes: actionTypeRows.map((row) => row.action_type),
    users: userRows
  };
}

/**
 * @param {unknown} value
 */
function escapeCsvValue(value) {
  const clean = String(value ?? "");
  return `"${clean.replaceAll('"', '""')}"`;
}

/**
 * @param {AuditFilters} [filters]
 */
export async function exportAuditEntriesCsv(filters = {}) {
  const rows = await listAuditEntries({ ...filters, limit: filters.limit || 2000 });
  const header = [
    "created_at",
    "changed_by_name",
    "changed_by_username",
    "entity_type",
    "entity_id",
    "action_type",
    "old_values",
    "new_values"
  ];

  const lines = [
    header.join(","),
    ...rows.map((row) =>
      [
        row.created_at,
        row.changed_by_name || "",
        row.changed_by_username || "",
        row.entity_type,
        row.entity_id ?? "",
        row.action_type,
        JSON.stringify(row.old_values ?? {}),
        JSON.stringify(row.new_values ?? {})
      ]
        .map(escapeCsvValue)
        .join(",")
    )
  ];

  return lines.join("\n");
}
