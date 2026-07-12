import type { Pool, PoolClient } from "pg";
import { pool } from "../db/pool.js";
import { readSonicDicomReportSettings } from "./sonicdicom-report-settings.js";
import { checkSonicDicomReportStatusesBatch, type ReportLookupContext, type ReportStatusResult } from "./sonicdicom-report-service.js";

export type ReportingBoardCacheStatus = "final" | "draft" | "no_report" | "study_not_found" | "unavailable";

export interface ReportingBoardSonicDicomCacheCandidate extends ReportLookupContext {
  assigned: boolean;
  priorityCode: string | null;
  cacheStatus: ReportingBoardCacheStatus | null;
  lastSuccessAt: string | null;
}

export interface ReportingBoardSonicDicomCacheTickResult {
  candidates: number;
  successful: number;
  changedStatus: number;
  final: number;
  failed: number;
}

type Queryable = Pick<Pool, "query"> | Pick<PoolClient, "query">;

function accessionFor(appointmentId: number): string { return `V2-${String(appointmentId).padStart(6, "0")}`; }
function normalizedState(state: string): ReportingBoardCacheStatus {
  return state === "final" || state === "draft" || state === "no_report" || state === "study_not_found" ? state : "unavailable";
}
function nextCheckAt(status: ReportingBoardCacheStatus, failureCount: number, ttlSeconds: number): string {
  const base = Math.max(1, ttlSeconds) * 1000;
  const delay = status === "final" ? 24 * 60 * 60 * 1000
    : status === "study_not_found" ? Math.max(base, 5 * 60 * 1000)
    : status === "unavailable" ? Math.min(30 * 60 * 1000, Math.max(base, base * (2 ** Math.min(failureCount, 8))))
    : base;
  return new Date(Date.now() + delay).toISOString();
}

export async function enqueueReportingBoardSonicDicomCacheRows(appointmentIds: number[], db: Queryable = pool, options: { force?: boolean } = {}): Promise<void> {
  const ids = [...new Set(appointmentIds.filter((id) => Number.isInteger(id) && id > 0))];
  if (!ids.length) return;
  await db.query(`
    insert into doctor_portal.reporting_board_sonicdicom_cache (appointment_id, report_status, next_check_at, study_instance_uid_snapshot, accession_number_snapshot)
    select b.id, 'unavailable', now(), b.study_instance_uid, ('V2-' || lpad(b.id::text, 6, '0'))
    from appointments_v2.bookings b
    where b.id = any($1::bigint[]) and b.status = 'completed' and b.requires_report = true
    on conflict (appointment_id) do update
      set next_check_at = least(doctor_portal.reporting_board_sonicdicom_cache.next_check_at, now()), updated_at = now()
      where $2::boolean
         or doctor_portal.reporting_board_sonicdicom_cache.study_instance_uid_snapshot is distinct from excluded.study_instance_uid_snapshot
         or doctor_portal.reporting_board_sonicdicom_cache.accession_number_snapshot is distinct from excluded.accession_number_snapshot
  `, [ids, Boolean(options.force)]);
}

export async function selectDueReportingBoardSonicDicomCacheCandidates(limit: number, db: Queryable = pool): Promise<ReportingBoardSonicDicomCacheCandidate[]> {
  const result = await db.query<ReportingBoardSonicDicomCacheCandidate>(`
    select b.id as "bookingId", ('V2-' || lpad(b.id::text, 6, '0')) as "accessionNumber", b.study_instance_uid as "studyInstanceUid",
      b.requires_report as "requiresReport", b.status, cta.id is not null as assigned, rp.code as "priorityCode",
      cache.report_status as "cacheStatus", cache.last_success_at as "lastSuccessAt"
    from appointments_v2.bookings b
    left join doctor_portal.reporting_board_sonicdicom_cache cache on cache.appointment_id = b.id
    left join doctor_portal.reporting_board_manual_final_overrides manual on manual.appointment_id = b.id and manual.cleared_at is null
    left join doctor_portal.case_team_assignments cta on cta.appointment_id = b.id and cta.assignment_type = 'reporting' and cta.status = 'active'
    left join reporting_priorities rp on rp.id = b.reporting_priority_id
    where b.status = 'completed' and b.requires_report = true and manual.id is null
      and (cache.appointment_id is null or cache.next_check_at <= now()
        or cache.study_instance_uid_snapshot is distinct from b.study_instance_uid
        or cache.accession_number_snapshot is distinct from ('V2-' || lpad(b.id::text, 6, '0')))
    order by (cache.appointment_id is null) desc, (cta.id is not null) desc,
      case lower(coalesce(rp.code, '')) when 'stat' then 0 when 'urgent' then 1 else 2 end,
      cache.next_check_at asc nulls first, cache.last_success_at asc nulls first, b.id asc
    limit $1
  `, [Math.max(1, Math.min(limit, 200))]);
  return result.rows.map((row) => ({ ...row, bookingId: Number(row.bookingId) }));
}

export async function persistReportingBoardSonicDicomCacheResult(
  context: ReportLookupContext,
  result: ReportStatusResult | null,
  error: unknown = null,
  db: Queryable = pool
): Promise<{ changed: boolean; status: ReportingBoardCacheStatus }> {
  const settings = await readSonicDicomReportSettings();
  const status = normalizedState(result?.state ?? "unavailable");
  const successful = Boolean(result && ["final", "draft", "no_report", "study_not_found"].includes(result.state));
  const errorText = error instanceof Error ? error.message : error ? String(error) : null;
  const next = nextCheckAt(status, successful ? 0 : 1, settings.sonicDicomStatusCacheTtlSeconds);
  const updated = await db.query<{ changed: boolean; status: ReportingBoardCacheStatus }>(`
    insert into doctor_portal.reporting_board_sonicdicom_cache (
      appointment_id, report_status, report_final_at, sonicdicom_study_note, source, last_success_at, last_attempt_at, next_check_at,
      status_changed_at, failure_count, last_error, study_instance_uid_snapshot, accession_number_snapshot
    ) values ($1, $2, $3, $4, 'sonicdicom', case when $5 then now() else null end, now(), $6, now(),
      case when $5 then 0 else 1 end, case when $5 then null else $7 end, $8, $9)
    on conflict (appointment_id) do update set
      report_status = case when $5 then excluded.report_status else doctor_portal.reporting_board_sonicdicom_cache.report_status end,
      report_final_at = case when $5 then excluded.report_final_at else doctor_portal.reporting_board_sonicdicom_cache.report_final_at end,
      sonicdicom_study_note = case when $5 then excluded.sonicdicom_study_note else doctor_portal.reporting_board_sonicdicom_cache.sonicdicom_study_note end,
      source = case when $5 then 'sonicdicom' else doctor_portal.reporting_board_sonicdicom_cache.source end,
      last_success_at = case when $5 then now() else doctor_portal.reporting_board_sonicdicom_cache.last_success_at end,
      last_attempt_at = now(), next_check_at = $6,
      status_changed_at = case when $5 and doctor_portal.reporting_board_sonicdicom_cache.report_status is distinct from excluded.report_status then now() else doctor_portal.reporting_board_sonicdicom_cache.status_changed_at end,
      failure_count = case when $5 then 0 else doctor_portal.reporting_board_sonicdicom_cache.failure_count + 1 end,
      last_error = case when $5 then null else $7 end,
      study_instance_uid_snapshot = $8, accession_number_snapshot = $9, updated_at = now()
    returning (report_status is distinct from $2) as changed, report_status as status
  `, [context.bookingId, status, status === "final" ? result?.reportFinalAt ?? null : null, result?.studyNote ?? null, successful, next, errorText, context.studyInstanceUid, context.accessionNumber || accessionFor(context.bookingId)]);
  return updated.rows[0] ?? { changed: false, status };
}

export async function refreshReportingBoardSonicDicomCacheCandidates(candidates: ReportingBoardSonicDicomCacheCandidate[]): Promise<ReportingBoardSonicDicomCacheTickResult> {
  if (!candidates.length) return { candidates: 0, successful: 0, changedStatus: 0, final: 0, failed: 0 };
  let resolved: Map<number, ReportStatusResult>;
  try { resolved = await checkSonicDicomReportStatusesBatch(candidates, { audit: false }); }
  catch (error) {
    await Promise.all(candidates.map((candidate) => persistReportingBoardSonicDicomCacheResult(candidate, null, error)));
    return { candidates: candidates.length, successful: 0, changedStatus: 0, final: 0, failed: candidates.length };
  }
  let successful = 0; let changedStatus = 0; let final = 0; let failed = 0;
  for (const candidate of candidates) {
    const value = resolved.get(candidate.bookingId) ?? null;
    const persisted = await persistReportingBoardSonicDicomCacheResult(candidate, value, value?.state === "unavailable" ? "SonicDICOM unavailable" : null);
    if (value?.state === "unavailable") failed += 1; else successful += 1;
    if (persisted.changed) changedStatus += 1;
    if (persisted.status === "final") final += 1;
  }
  return { candidates: candidates.length, successful, changedStatus, final, failed };
}
