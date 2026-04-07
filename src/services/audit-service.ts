import { pool } from "../db/pool.js";
import { HttpError } from "../utils/http-error.js";
import { requireRow } from "../utils/records.js";
import { normalizePositiveInteger } from "../utils/normalize.js";
import type { AuditEvent } from "../types/domain.js";
import type { DbExecutor } from "../types/db.js";
import type { UserId, NullableUserId } from "../types/http.js";

export interface AuditEntryInput {
  entityType: string;
  entityId?: NullableUserId;
  actionType: string;
  oldValues?: unknown;
  newValues?: unknown;
  changedByUserId?: NullableUserId;
}

export interface AuditFilters {
  limit?: UserId;
  entityType?: string;
  actionType?: string;
  changedByUserId?: UserId;
  dateFrom?: string;
  dateTo?: string;
}

export interface AuditLogRow {
  id: number;
  entity_type: string;
  entity_id: NullableUserId;
  action_type: string;
  old_values: unknown;
  new_values: unknown;
  changed_by_user_id: NullableUserId;
  created_at: string;
  changed_by_name?: string | null;
  changed_by_username?: string | null;
}

interface AuditEntityTypeRow {
  entity_type: string;
}

interface AuditActionTypeRow {
  action_type: string;
}

export interface AuditUserOptionRow {
  id: UserId;
  full_name: string | null;
  username: string | null;
}

async function isAuditEnabled(executor: DbExecutor = pool): Promise<boolean> {
  const { rows } = await executor.query(
    `
      select setting_value
      from system_settings
      where category = 'audit_and_logging'
        and setting_key = 'audit_trail'
      limit 1
    `
  );

  const firstRow = rows[0] as { setting_value?: { value?: unknown } } | undefined;
  const value = String(firstRow?.setting_value?.value ?? "");
  return value !== "disabled";
}

export async function logAuditEntry(
  {
    entityType,
    entityId = null,
    actionType,
    oldValues = null,
    newValues = null,
    changedByUserId = null
  }: AuditEntryInput & Partial<AuditEvent>,
  executor: DbExecutor = pool
): Promise<AuditLogRow | null> {
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

  return requireRow<AuditLogRow>(rows[0] as unknown as AuditLogRow | undefined, "Failed to write audit log entry.");
}

function normalizeStringFilter(value: unknown): string | null {
  const clean = String(value || "").trim();
  return clean || null;
}

function normalizeDateFilter(value: unknown, fieldName: string): string | null {
  const clean = String(value || "").trim();

  if (!clean) {
    return null;
  }

  if (!/^\d{4}-\d{2}-\d{2}$/.test(clean)) {
    throw new HttpError(400, `${fieldName} must be in YYYY-MM-DD format.`);
  }

  return clean;
}

function buildAuditFilterQuery(
  filters: AuditFilters = {},
  { includeLimit = true }: { includeLimit?: boolean } = {}
): { params: unknown[]; whereClause: string; limitClause: string } {
  const cleanLimit = includeLimit ? Math.min(Math.max(Number(filters.limit) || 100, 1), 5000) : null;
  const entityType = normalizeStringFilter(filters.entityType);
  const actionType = normalizeStringFilter(filters.actionType);
  const changedByUserId = normalizePositiveInteger(filters.changedByUserId, "changedByUserId");
  const dateFrom = normalizeDateFilter(filters.dateFrom, "dateFrom");
  const dateTo = normalizeDateFilter(filters.dateTo, "dateTo");

  if (dateFrom && dateTo && dateFrom > dateTo) {
    throw new HttpError(400, "dateFrom cannot be later than dateTo.");
  }

  const clauses: string[] = [];
  const params: unknown[] = [];

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

export async function listAuditEntries(filters: AuditFilters = {}): Promise<AuditLogRow[]> {
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

  return rows as AuditLogRow[];
}

export async function listAuditFilterOptions(): Promise<{ entityTypes: string[]; actionTypes: string[]; users: AuditUserOptionRow[] }> {
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

  const entityTypeRows = entityTypeResult.rows as AuditEntityTypeRow[];
  const actionTypeRows = actionTypeResult.rows as AuditActionTypeRow[];
  const userRows = userResult.rows as AuditUserOptionRow[];

  return {
    entityTypes: entityTypeRows.map((row) => row.entity_type),
    actionTypes: actionTypeRows.map((row) => row.action_type),
    users: userRows
  };
}

function escapeCsvValue(value: unknown): string {
  const clean = String(value ?? "");
  return `"${clean.replaceAll('"', '""')}"`;
}

export async function exportAuditEntriesCsv(filters: AuditFilters = {}): Promise<string> {
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
