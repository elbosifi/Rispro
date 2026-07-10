import { pool } from "../db/pool.js";
import { HttpError } from "../utils/http-error.js";
import { requireRow } from "../utils/records.js";
import { normalizePositiveInteger } from "../utils/normalize.js";
import { validateIsoDate } from "../utils/date.js";
import {
  actorLabel,
  classifyAuditEvent,
  presentAuditEvent,
  redactAuditText,
  redactAuditValue,
  targetLabel,
  type AuditCategory,
  type AuditOutcome
} from "./audit-event-classifier.js";
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
  /** Legacy compatibility for callers that still request a bounded raw list. */
  limit?: UserId;
  page?: unknown;
  pageSize?: unknown;
  entityType?: string;
  actionType?: string;
  changedByUserId?: UserId;
  dateFrom?: string;
  dateTo?: string;
  category?: AuditCategory | string;
  search?: string;
  outcome?: AuditOutcome | string;
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
  category?: AuditCategory;
  outcome?: AuditOutcome;
}

export interface AuditApiEntry {
  id: number;
  changedByName: string | null;
  changedByUsername: string | null;
  changedByUserId: NullableUserId;
  entityType: string;
  entityId: NullableUserId;
  actionType: string;
  oldValues: unknown;
  newValues: unknown;
  createdAt: string;
  category: AuditCategory;
  outcome: AuditOutcome;
  importance: "high" | "medium" | "low";
  title: string;
  summary: string;
  actorLabel: string;
  targetLabel: string;
}

export interface AuditPagination {
  page: number;
  pageSize: number;
  totalItems: number;
  totalPages: number;
  hasPreviousPage: boolean;
  hasNextPage: boolean;
  rangeStart: number;
  rangeEnd: number;
}

export interface AuditSummary {
  total: number;
  important: number;
  security: number;
  automated: number;
  other: number;
  failed: number;
}

export interface AuditUserOptionRow {
  id: UserId;
  full_name: string | null;
  username: string | null;
}

export interface AuditPageResponse {
  entries: AuditApiEntry[];
  pagination: AuditPagination;
  summary: AuditSummary;
  meta: {
    entityTypes: string[];
    actionTypes: string[];
    users: AuditUserOptionRow[];
    categories: AuditCategory[];
    outcomes: AuditOutcome[];
  };
}

interface AuditEntityTypeRow { entity_type: string; }
interface AuditActionTypeRow { action_type: string; }
export const AUDIT_CATEGORIES: AuditCategory[] = ["important", "security", "automated", "other"];
export const AUDIT_OUTCOMES: AuditOutcome[] = ["successful", "failed", "rejected", "cancelled", "pending", "informational", "unknown"];
export const AUDIT_PAGE_SIZES = [25, 50, 100] as const;

const CATEGORY_SQL = `case
  when lower(audit_log.action_type || ' ' || audit_log.entity_type) ~ '(report_status|pacs|orthanc|dicom|mwl|sonicdicom|notification|background|scheduled_process|poll|synchroni[sz]|auto_complete|worker)' then 'automated'
  when lower(audit_log.action_type || ' ' || audit_log.entity_type) ~ '(^|_)(login|logout|auth|reauth|password|action_pin|pin|permission|security)(_|$)|reauth|failed_login|role_change|page_access' then 'security'
  when lower(audit_log.action_type || ' ' || audit_log.entity_type) ~ '(patient|appointment|booking|override|capacity|modality|user_(create|delete|deactivate|activate|update|role)|document|backup|restore|report_final|destructive|merge)' then 'important'
  else 'other'
end`;

const OUTCOME_SQL = `case
  when lower(coalesce(nullif(audit_log.new_values->>'outcome', ''), nullif(audit_log.new_values->>'result', ''), nullif(audit_log.new_values->>'status', ''), nullif(audit_log.new_values->>'error', ''), nullif(audit_log.old_values->>'outcome', ''), nullif(audit_log.old_values->>'result', ''), nullif(audit_log.old_values->>'status', ''), '')) in ('failed','failure','error','errored','exception','timeout') or lower(audit_log.action_type) ~ '(fail|error|exception|timeout)' then 'failed'
  when lower(coalesce(nullif(audit_log.new_values->>'outcome', ''), nullif(audit_log.new_values->>'result', ''), nullif(audit_log.new_values->>'status', ''), nullif(audit_log.old_values->>'outcome', ''), nullif(audit_log.old_values->>'result', ''), nullif(audit_log.old_values->>'status', ''), '')) in ('rejected','denied','declined') or lower(audit_log.action_type) ~ '(reject|deny|denied)' then 'rejected'
  when lower(coalesce(nullif(audit_log.new_values->>'outcome', ''), nullif(audit_log.new_values->>'result', ''), nullif(audit_log.new_values->>'status', ''), nullif(audit_log.old_values->>'outcome', ''), nullif(audit_log.old_values->>'result', ''), nullif(audit_log.old_values->>'status', ''), '')) in ('cancelled','canceled','aborted','voided') or lower(audit_log.action_type) ~ '(cancel|abort|void)' then 'cancelled'
  when lower(coalesce(nullif(audit_log.new_values->>'outcome', ''), nullif(audit_log.new_values->>'result', ''), nullif(audit_log.new_values->>'status', ''), nullif(audit_log.old_values->>'outcome', ''), nullif(audit_log.old_values->>'result', ''), nullif(audit_log.old_values->>'status', ''), '')) in ('pending','queued','in_progress','in-progress') then 'pending'
  when lower(coalesce(nullif(audit_log.new_values->>'outcome', ''), nullif(audit_log.new_values->>'result', ''), nullif(audit_log.new_values->>'status', ''), nullif(audit_log.old_values->>'outcome', ''), nullif(audit_log.old_values->>'result', ''), nullif(audit_log.old_values->>'status', ''), '')) in ('success','successful','succeeded','ok','completed','complete') then 'successful'
  when lower(coalesce(nullif(audit_log.new_values->>'outcome', ''), nullif(audit_log.new_values->>'result', ''), nullif(audit_log.new_values->>'status', ''), nullif(audit_log.old_values->>'outcome', ''), nullif(audit_log.old_values->>'result', ''), nullif(audit_log.old_values->>'status', ''))) in ('informational','info','not_found','no_report') then 'informational'
  else 'unknown'
end`;

async function isAuditEnabled(executor: DbExecutor = pool): Promise<boolean> {
  const { rows } = await executor.query(
    `select setting_value from system_settings where category = 'audit_and_logging' and setting_key = 'audit_trail' limit 1`
  );
  const firstRow = rows[0] as { setting_value?: { value?: unknown } } | undefined;
  return String(firstRow?.setting_value?.value ?? "") !== "disabled";
}

export async function logAuditEntry(
  { entityType, entityId = null, actionType, oldValues = null, newValues = null, changedByUserId = null }: AuditEntryInput & Partial<AuditEvent>,
  executor: DbExecutor = pool
): Promise<AuditLogRow | null> {
  if (!(await isAuditEnabled(executor))) return null;
  const { rows } = await executor.query(
    `insert into audit_log (entity_type, entity_id, action_type, old_values, new_values, changed_by_user_id)
     values ($1, $2, $3, $4::jsonb, $5::jsonb, $6)
     returning id, entity_type, entity_id, action_type, old_values, new_values, changed_by_user_id, created_at`,
    [entityType, entityId, actionType, JSON.stringify(oldValues), JSON.stringify(newValues), changedByUserId]
  );
  return requireRow<AuditLogRow>(rows[0] as unknown as AuditLogRow | undefined, "Failed to write audit log entry.");
}

function normalizeStringFilter(value: unknown): string | null {
  const clean = String(value || "").trim();
  return clean || null;
}

function normalizeDateFilter(value: unknown, fieldName: string): string | null {
  const clean = String(value || "").trim();
  if (!clean) return null;
  try {
    return validateIsoDate(clean, fieldName);
  } catch {
    throw new HttpError(400, `${fieldName} must be in YYYY-MM-DD format.`);
  }
}

function normalizeCategory(value: unknown): AuditCategory | null {
  const clean = normalizeStringFilter(value);
  if (!clean) return null;
  if (!AUDIT_CATEGORIES.includes(clean as AuditCategory)) throw new HttpError(400, "category must be important, security, automated, or other.");
  return clean as AuditCategory;
}

function normalizeOutcome(value: unknown): AuditOutcome | null {
  const clean = normalizeStringFilter(value);
  if (!clean) return null;
  if (!AUDIT_OUTCOMES.includes(clean as AuditOutcome)) throw new HttpError(400, "Invalid audit outcome.");
  return clean as AuditOutcome;
}

function normalizePage(value: unknown): number {
  return normalizePositiveInteger(value, "page", { required: false }) || 1;
}

function normalizePageSize(value: unknown): number {
  if (value === undefined || value === null || value === "") return 25;
  const parsed = normalizePositiveInteger(value, "pageSize", { required: true, max: 100 });
  if (parsed === null) throw new HttpError(400, "pageSize must be one of 25, 50, or 100.");
  if (!AUDIT_PAGE_SIZES.includes(parsed as (typeof AUDIT_PAGE_SIZES)[number])) throw new HttpError(400, "pageSize must be one of 25, 50, or 100.");
  return parsed;
}

function normalizedLegacyLimit(filters: AuditFilters): number | null {
  if (filters.pageSize !== undefined || filters.limit === undefined || filters.limit === null || filters.limit === "") return null;
  const parsed = normalizePositiveInteger(filters.limit, "limit", { required: false, max: 5000 });
  return parsed;
}

function buildAuditWhere(filters: AuditFilters = {}): { params: unknown[]; whereClause: string } {
  const entityType = normalizeStringFilter(filters.entityType);
  const actionType = normalizeStringFilter(filters.actionType);
  const changedByUserId = normalizePositiveInteger(filters.changedByUserId, "changedByUserId", { required: false });
  const dateFrom = normalizeDateFilter(filters.dateFrom, "dateFrom");
  const dateTo = normalizeDateFilter(filters.dateTo, "dateTo");
  const category = normalizeCategory(filters.category);
  const outcome = normalizeOutcome(filters.outcome);
  const search = normalizeStringFilter(filters.search);
  if (dateFrom && dateTo && dateFrom > dateTo) throw new HttpError(400, "dateFrom cannot be later than dateTo.");

  const clauses: string[] = [];
  const params: unknown[] = [];
  const add = (value: unknown) => { params.push(value); return `$${params.length}`; };
  if (entityType) clauses.push(`audit_log.entity_type = ${add(entityType)}`);
  if (actionType) clauses.push(`audit_log.action_type = ${add(actionType)}`);
  if (changedByUserId) clauses.push(`audit_log.changed_by_user_id = ${add(changedByUserId)}`);
  if (dateFrom) clauses.push(`audit_log.created_at >= ${add(dateFrom)}::date`);
  if (dateTo) clauses.push(`audit_log.created_at < (${add(dateTo)}::date + interval '1 day')`);
  if (category) clauses.push(`(${CATEGORY_SQL}) = ${add(category)}`);
  if (outcome) clauses.push(`(${OUTCOME_SQL}) = ${add(outcome)}`);
  if (search) {
    const placeholder = add(`%${search}%`);
    clauses.push(`(
      coalesce(users.full_name, '') ilike ${placeholder}
      or coalesce(users.username, '') ilike ${placeholder}
      or coalesce(audit_log.entity_type, '') ilike ${placeholder}
      or coalesce(audit_log.entity_id::text, '') ilike ${placeholder}
      or coalesce(audit_log.action_type, '') ilike ${placeholder}
      or coalesce(audit_log.new_values->>'status', '') ilike ${placeholder}
      or coalesce(audit_log.new_values->>'outcome', '') ilike ${placeholder}
      or coalesce(audit_log.new_values->>'result', '') ilike ${placeholder}
      or coalesce(audit_log.new_values->>'code', '') ilike ${placeholder}
      or coalesce(audit_log.old_values->>'status', '') ilike ${placeholder}
      or coalesce(audit_log.old_values->>'outcome', '') ilike ${placeholder}
      or coalesce(audit_log.old_values->>'result', '') ilike ${placeholder}
      or coalesce(audit_log.old_values->>'code', '') ilike ${placeholder}
    )`);
  }
  return { params, whereClause: clauses.length ? `where ${clauses.join(" and ")}` : "" };
}

export function buildAuditFilterQuery(filters: AuditFilters = {}, { includeLimit = true }: { includeLimit?: boolean } = {}): { params: unknown[]; whereClause: string; limitClause: string } {
  const built = buildAuditWhere(filters);
  let limitClause = "";
  if (includeLimit) {
    const limit = normalizedLegacyLimit(filters) ?? 100;
    built.params.push(Math.min(Math.max(limit, 1), 5000));
    limitClause = `limit $${built.params.length}`;
  }
  return { ...built, limitClause };
}

function auditRowToApi(row: AuditLogRow): AuditApiEntry {
  const presentation = presentAuditEvent({
    actionType: row.action_type,
    entityType: row.entity_type,
    entityId: row.entity_id,
    changedByName: row.changed_by_name,
    changedByUsername: row.changed_by_username,
    changedByUserId: row.changed_by_user_id,
    oldValues: row.old_values,
    newValues: row.new_values
  });
  return {
    id: row.id,
    changedByName: row.changed_by_name ?? null,
    changedByUsername: row.changed_by_username ?? null,
    changedByUserId: row.changed_by_user_id,
    entityType: row.entity_type,
    entityId: row.entity_id,
    actionType: row.action_type,
    oldValues: redactAuditValue(row.old_values),
    newValues: redactAuditValue(row.new_values),
    createdAt: row.created_at,
    ...presentation
  };
}

function auditRowSelect(): string {
  return `select audit_log.id, audit_log.entity_type, audit_log.entity_id, audit_log.action_type, audit_log.old_values, audit_log.new_values, audit_log.changed_by_user_id, audit_log.created_at, users.full_name as changed_by_name, users.username as changed_by_username from audit_log left join users on users.id = audit_log.changed_by_user_id`;
}

export async function listAuditEntries(filters: AuditFilters = {}): Promise<AuditLogRow[]> {
  const { params, whereClause, limitClause } = buildAuditFilterQuery(filters, { includeLimit: true });
  const { rows } = await pool.query(`${auditRowSelect()} ${whereClause} order by audit_log.created_at desc, audit_log.id desc ${limitClause}`, params);
  return rows as AuditLogRow[];
}

export async function listAuditFilterOptions(): Promise<{ entityTypes: string[]; actionTypes: string[]; users: AuditUserOptionRow[] }> {
  const [entityTypeResult, actionTypeResult, userResult] = await Promise.all([
    pool.query<AuditEntityTypeRow>(`select distinct entity_type from audit_log where entity_type is not null order by entity_type asc`),
    pool.query<AuditActionTypeRow>(`select distinct action_type from audit_log where action_type is not null order by action_type asc`),
    pool.query<AuditUserOptionRow>(`select distinct users.id, users.full_name, users.username from audit_log join users on users.id = audit_log.changed_by_user_id order by users.full_name asc nulls last, users.username asc`)
  ]);
  return {
    entityTypes: entityTypeResult.rows.map((row) => row.entity_type),
    actionTypes: actionTypeResult.rows.map((row) => row.action_type),
    users: userResult.rows
  };
}

export async function listAuditPage(filters: AuditFilters = {}): Promise<AuditPageResponse> {
  const page = normalizePage(filters.page);
  const pageSize = normalizePageSize(filters.pageSize ?? normalizedLegacyLimit(filters));
  const { params: whereParams, whereClause } = buildAuditWhere(filters);
  const categoryRows = await pool.query<{ category: AuditCategory; count: string }>(
    `with filtered as (
      select audit_log.id, ${CATEGORY_SQL} as category
      from audit_log left join users on users.id = audit_log.changed_by_user_id ${whereClause}
    ) select category, count(*)::text as count from filtered group by category`,
    whereParams
  );
  const outcomeRows = await pool.query<{ outcome: AuditOutcome; count: string }>(
    `with filtered as (
      select audit_log.id, ${OUTCOME_SQL} as outcome
      from audit_log left join users on users.id = audit_log.changed_by_user_id ${whereClause}
    ) select outcome, count(*)::text as count from filtered group by outcome`,
    whereParams
  );
  const categoryCounts = Object.fromEntries(categoryRows.rows.map((row) => [row.category, Number(row.count)])) as Record<AuditCategory, number>;
  const outcomeCounts = Object.fromEntries(outcomeRows.rows.map((row) => [row.outcome, Number(row.count)])) as Record<AuditOutcome, number>;
  const total = AUDIT_CATEGORIES.reduce((sum, category) => sum + (categoryCounts[category] || 0), 0);
  const totalPages = total === 0 ? 0 : Math.ceil(total / pageSize);
  const effectivePage = totalPages > 0 ? Math.min(page, totalPages) : 1;
  const pageParams = [...whereParams, pageSize, (effectivePage - 1) * pageSize];
  const pageResult = await pool.query<AuditLogRow>(
    `with filtered as (${auditRowSelect()} ${whereClause})
     select * from filtered order by created_at desc, id desc limit $${pageParams.length - 1} offset $${pageParams.length}`,
    pageParams
  );
  const meta = await listAuditFilterOptions();
  return {
    entries: pageResult.rows.map(auditRowToApi),
    pagination: {
      page: effectivePage,
      pageSize,
      totalItems: total,
      totalPages,
      hasPreviousPage: effectivePage > 1,
      hasNextPage: totalPages > 0 && effectivePage < totalPages,
      rangeStart: total === 0 ? 0 : (effectivePage - 1) * pageSize + 1,
      rangeEnd: total === 0 ? 0 : Math.min(effectivePage * pageSize, total)
    },
    summary: {
      total,
      important: categoryCounts.important || 0,
      security: categoryCounts.security || 0,
      automated: categoryCounts.automated || 0,
      other: categoryCounts.other || 0,
      failed: outcomeCounts.failed || 0
    },
    meta: { ...meta, categories: AUDIT_CATEGORIES, outcomes: AUDIT_OUTCOMES }
  };
}

function escapeCsvValue(value: unknown): string {
  const clean = redactAuditText(String(value ?? ""));
  return `"${clean.replaceAll('"', '""')}"`;
}

const AUDIT_CSV_HEADER = "created_at,changed_by_name,changed_by_username,changed_by_user_id,entity_type,entity_id,action_type,category,outcome,old_values,new_values\n";

function auditRowToCsv(row: AuditLogRow): string {
  const entry = auditRowToApi(row);
  return [
    entry.createdAt,
    entry.changedByName || actorLabel({ changedByName: null, changedByUsername: entry.changedByUsername, changedByUserId: entry.changedByUserId }),
    entry.changedByUsername || "",
    entry.changedByUserId ?? "",
    entry.entityType,
    entry.entityId ?? "",
    entry.actionType,
    entry.category,
    entry.outcome,
    JSON.stringify(entry.oldValues ?? {}),
    JSON.stringify(entry.newValues ?? {})
  ].map(escapeCsvValue).join(",") + "\n";
}

export async function streamAuditEntriesCsv(filters: AuditFilters = {}, write: (chunk: string) => void | Promise<void>): Promise<void> {
  const { params: whereParams, whereClause } = buildAuditWhere(filters);
  const batchSize = 500;
  let offset = 0;
  await write(AUDIT_CSV_HEADER);
  while (true) {
    const params = [...whereParams, batchSize, offset];
    const { rows } = await pool.query<AuditLogRow>(
      `${auditRowSelect()} ${whereClause} order by audit_log.created_at desc, audit_log.id desc limit $${params.length - 1} offset $${params.length}`,
      params
    );
    if (rows.length === 0) break;
    await write(rows.map(auditRowToCsv).join(""));
    if (rows.length < batchSize) break;
    offset += batchSize;
  }
}

export async function exportAuditEntriesCsv(filters: AuditFilters = {}): Promise<string> {
  const chunks: string[] = [];
  await streamAuditEntriesCsv(filters, (chunk) => { chunks.push(chunk); });
  return chunks.join("").replace(/\n$/, "");
}

export { classifyAuditEvent, presentAuditEvent, redactAuditValue, targetLabel };
