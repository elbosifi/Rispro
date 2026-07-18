import crypto from "node:crypto";
import fs from "node:fs/promises";
import { pool } from "../db/pool.js";
import { env } from "../config/env.js";
import { HttpError } from "../utils/http-error.js";
import { normalizePositiveInteger } from "../utils/normalize.js";
import type { NullableUserId } from "../types/http.js";

export type DiagnosticSeverity = "info" | "warning" | "error" | "critical";
const severities = new Set<DiagnosticSeverity>(["info", "warning", "error", "critical"]);
const MAX_DETAILS = 8_000;

export interface DiagnosticEventInput {
  severity: DiagnosticSeverity; source: string; component: string; operation?: string | null;
  requestId?: string | null; route?: string | null; httpMethod?: string | null; statusCode?: number | null;
  userId?: NullableUserId; errorName?: string | null; errorCode?: string | null; message: unknown;
  technicalDetails?: unknown; metadata?: unknown;
}

export interface DiagnosticFilters {
  severity?: string; source?: string; component?: string; status?: string; dateFrom?: string; dateTo?: string;
  requestId?: string; page?: unknown; pageSize?: unknown;
}

function text(value: unknown): string { return String(value ?? ""); }

/** Redacts credentials and tokens before anything reaches diagnostic persistence or the UI. */
export function redactDiagnosticText(value: unknown): string {
  return text(value)
    .replace(/(password|passphrase|token|secret|api[_-]?key|pgpassword)\s*([=:])\s*[^\s,;"']+/gi, "$1$2[REDACTED]")
    .replace(/(authorization\s*:\s*bearer)\s+[^\s,;]+/gi, "$1 [REDACTED]")
    .replace(/(cookie\s*:)\s*[^\r\n]+/gi, "$1 [REDACTED]")
    .replace(/postgres(?:ql)?:\/\/([^:\s/@]+):[^@\s]+@/gi, "postgresql://$1:[REDACTED]@")
    .replace(/\b(DATABASE_URL)\b\s*([=:])\s*[^\s,;"']+/gi, "$1$2[REDACTED]")
    .replace(/\b(JWT|SMTP|ORTHANC|SONICDICOM|PACS)[A-Z_]*(PASSWORD|SECRET|TOKEN|KEY)?\b\s*([=:])\s*[^\s,;"']+/gi, "$1$3[REDACTED]")
    .replace(/\b(patient(?:_id|name|_name)?|mrn|accession(?:_number)?|national_?id|clinical_?data)\b\s*([=:])\s*[^\s,;"']+/gi, "$1$2[REDACTED]")
    .replace(/(?:\/Users\/|\/home\/|[A-Z]:\\)[^\s\n)]+/g, "[PATH]")
    .slice(0, MAX_DETAILS);
}

export function redactDiagnosticMetadata(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const output: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value)) {
    if (/password|passphrase|token|secret|authorization|cookie|api.?key|database.?url|body|upload|patient|clinical/i.test(key)) {
      output[key] = "[REDACTED]";
    } else if (typeof item === "string") {
      output[key] = redactDiagnosticText(item);
    } else if (typeof item === "number" || typeof item === "boolean" || item === null) {
      output[key] = item;
    }
  }
  return output;
}

function safeRoute(route?: string | null): string | null { return route ? redactDiagnosticText(route.split("?", 1)[0]) : null; }
function safeMessage(value: unknown): string { return redactDiagnosticText(value).slice(0, 1_000) || "Unexpected server error."; }

export async function createDiagnosticEvent(input: DiagnosticEventInput): Promise<string> {
  if (!severities.has(input.severity)) throw new HttpError(400, "Invalid diagnostic severity.");
  const eventId = crypto.randomUUID();
  await pool.query(`insert into system_diagnostic_events
    (event_id,severity,source,component,operation,request_id,route,http_method,status_code,user_id,error_name,error_code,message,technical_details,metadata)
    values ($1,$2,$3,$4,$5,$6::uuid,$7,$8,$9,$10,$11,$12,$13,$14,$15::jsonb)`, [
    eventId, input.severity, safeMessage(input.source), safeMessage(input.component), input.operation ? safeMessage(input.operation) : null,
    input.requestId || null, safeRoute(input.route), input.httpMethod ? safeMessage(input.httpMethod) : null, input.statusCode || null,
    input.userId || null, input.errorName ? safeMessage(input.errorName) : null, input.errorCode ? safeMessage(input.errorCode) : null,
    safeMessage(input.message), input.technicalDetails ? redactDiagnosticText(input.technicalDetails) : null, JSON.stringify(redactDiagnosticMetadata(input.metadata))
  ]);
  return eventId;
}

export function recordDiagnosticEvent(input: DiagnosticEventInput): void {
  void createDiagnosticEvent(input).catch((error) => console.error("System diagnostics persistence failed:", redactDiagnosticText(error instanceof Error ? error.message : error)));
}

export async function listDiagnosticEvents(filters: DiagnosticFilters = {}) {
  const clauses: string[] = []; const params: unknown[] = [];
  const add = (sql: string, value: unknown) => { params.push(value); clauses.push(sql.replace("?", `$${params.length}`)); };
  if (filters.severity) { if (!severities.has(filters.severity as DiagnosticSeverity)) throw new HttpError(400, "Invalid severity."); add("severity = ?", filters.severity); }
  if (filters.source) add("source = ?", safeMessage(filters.source));
  if (filters.component) add("component = ?", safeMessage(filters.component));
  if (filters.status) { if (!['resolved','unresolved'].includes(filters.status)) throw new HttpError(400, "Invalid status."); clauses.push(filters.status === 'resolved' ? "resolved_at is not null" : "resolved_at is null"); }
  if (filters.requestId) add("request_id = ?::uuid", filters.requestId);
  if (filters.dateFrom) add("occurred_at >= ?::timestamptz", filters.dateFrom);
  if (filters.dateTo) add("occurred_at <= ?::timestamptz", filters.dateTo);
  const page = normalizePositiveInteger(filters.page, "page", { required: false }) || 1;
  const pageSize = Math.min(normalizePositiveInteger(filters.pageSize, "pageSize", { required: false, max: 200 }) || 50, 200);
  const where = clauses.length ? `where ${clauses.join(" and ")}` : "";
  const total = await pool.query<{ count: string }>(`select count(*)::text as count from system_diagnostic_events ${where}`, params);
  params.push(pageSize, (page - 1) * pageSize);
  const result = await pool.query(`select event_id, occurred_at, severity, source, component, operation, request_id, route, http_method, status_code, error_name, error_code, message, technical_details, metadata, resolved_at, resolved_by_user_id, resolution_note from system_diagnostic_events ${where} order by occurred_at desc limit $${params.length - 1} offset $${params.length}`, params);
  return { events: result.rows, page, pageSize, total: Number(total.rows[0]?.count || 0) };
}

export async function getDiagnosticEvent(eventId: string) { const result = await pool.query("select event_id, occurred_at, severity, source, component, operation, request_id, route, http_method, status_code, error_name, error_code, message, technical_details, metadata, resolved_at, resolved_by_user_id, resolution_note from system_diagnostic_events where event_id=$1::uuid", [eventId]); if (!result.rows[0]) throw new HttpError(404, "Diagnostic event not found."); return result.rows[0]; }
export async function setDiagnosticResolution(eventId: string, userId: NullableUserId, resolved: boolean, note?: unknown) { const result = await pool.query("update system_diagnostic_events set resolved_at = case when $3 then now() else null end, resolved_by_user_id = case when $3 then $2 else null end, resolution_note = case when $3 then $4 else null end where event_id=$1::uuid returning event_id,resolved_at,resolved_by_user_id,resolution_note", [eventId, userId, resolved, resolved ? safeMessage(note).slice(0, 1000) : null]); if (!result.rows[0]) throw new HttpError(404, "Diagnostic event not found."); return result.rows[0]; }
export async function cleanupExpiredDiagnosticEvents(retentionDays = 30): Promise<number> { const days = Math.max(1, Math.min(retentionDays, 365)); const result = await pool.query("delete from system_diagnostic_events where occurred_at < now() - ($1::text || ' days')::interval", [days]); return result.rowCount || 0; }

async function health(label: string, check: () => Promise<Record<string, unknown>>) { try { return { status: "ok", ...(await check()) }; } catch (error) { return { status: "error", reason: `${label} check failed` }; } }
export async function getDiagnosticsSummary() {
  const database = await health("Database", async () => { const start = performance.now(); await pool.query("select 1"); return { reachable: true, latencyMs: Math.round(performance.now() - start) }; });
  const storage = await health("Storage", async () => { const root = env.uploadsDir; const stat = await fs.stat(root); await fs.access(root, fs.constants.W_OK); const space = await fs.statfs(root); return { roots: [{ name: "uploads", exists: stat.isDirectory(), writable: true, freeBytes: Number(space.bavail) * Number(space.bsize), totalBytes: Number(space.blocks) * Number(space.bsize) }] }; });
  const counts = await health("Diagnostics", async () => { const { rows } = await pool.query("select count(*) filter (where severity='error' and occurred_at > now()-interval '24 hours')::int as errors_24h, count(*) filter (where severity='critical' and occurred_at > now()-interval '24 hours')::int as critical_24h, count(*) filter (where resolved_at is null)::int as unresolved, max(occurred_at) filter (where severity in ('error','critical')) as latest_error_time from system_diagnostic_events"); return rows[0] || {}; });
  const backupRestore = await health("Backup/restore", async () => {
    const { rows } = await pool.query(`select
      (select max(completed_at) from backup_jobs where status='completed') as last_success,
      (select max(completed_at) from backup_jobs where status='failed') as last_failure,
      (select count(*)::int from backup_jobs where status in ('queued','generating','copying','verifying')) as active_jobs,
      (select count(*)::int from backup_jobs where status='failed' and created_at > now()-interval '24 hours') as failed_jobs_24h,
      (select archive_name from backup_jobs where status='completed' order by completed_at desc nulls last limit 1) as latest_archive_name,
      (select row_to_json(worker) from (select heartbeat_at,last_successful_tick_at,last_failure_message from backup_worker_state where singleton_key=true) worker) as worker,
      (select row_to_json(verification) from (select status,completed_at,failure_message from backup_restore_verification_jobs order by created_at desc limit 1) verification) as latest_restore_verification,
      (select count(*)::int from backup_retention_actions where action='delete' and created_at > now()-interval '24 hours') as retention_deletes_24h,
      (select count(*)::int from backup_retention_actions where action='failed' and created_at > now()-interval '24 hours') as retention_failures_24h`);
    return { v3RestoreEnabled: true, ...(rows[0] || {}) };
  });
  const ohifViewer = await health("OHIF Viewer", async () => {
    const { rows } = await pool.query(`select settings.enabled,settings.selected_pacs_node_id,settings.access_strategy,
      endpoint.last_test_status,endpoint.qido_last_status,endpoint.wado_metadata_last_status,endpoint.wado_frame_last_status,
      (select count(*)::int from ohif_retrieval_jobs where status in ('queued','resolving','retrieving')) as active_retrieval_jobs,
      (select count(*)::int from ohif_retrieval_jobs where status in ('failed','timed_out') and updated_at>now()-interval '24 hours') as retrieval_failures_24h
      from ohif_viewer_settings settings left join pacs_web_endpoints endpoint on endpoint.pacs_node_id=settings.selected_pacs_node_id
      where settings.singleton_key=true limit 1`);
    return { environmentEnabled: env.ohifEnabled, ...(rows[0] || {}) };
  });
  return { application: { version: process.env.npm_package_version || "unknown", gitCommit: process.env.GIT_COMMIT || null, environment: env.nodeEnv, uptimeSeconds: Math.floor(process.uptime()), serverTime: new Date().toISOString() }, database, storage, backupRestore, ohifViewer, recentDiagnostics: counts };
}
