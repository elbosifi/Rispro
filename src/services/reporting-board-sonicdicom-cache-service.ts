import type { Pool, PoolClient } from "pg";
import { pool } from "../db/pool.js";
import { readSonicDicomReportSettings, type SonicDicomReportSettings } from "./sonicdicom-report-settings.js";
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

/** Queues the complete eligible Reporting Board scope without altering cached results. */
export async function queueFullReportingBoardSonicDicomResync(db: Queryable = pool): Promise<number> {
  const result = await db.query<{ queued: string }>(`
    with queued as (
      insert into doctor_portal.reporting_board_sonicdicom_cache (
        appointment_id, report_status, next_check_at, study_instance_uid_snapshot, accession_number_snapshot
      )
      select b.id, 'unavailable', now(), b.study_instance_uid, ('V2-' || lpad(b.id::text, 6, '0'))
      from appointments_v2.bookings b
      left join doctor_portal.reporting_board_manual_final_overrides manual
        on manual.appointment_id = b.id and manual.cleared_at is null
      where b.status = 'completed' and b.requires_report = true and manual.id is null
      on conflict (appointment_id) do update set
        next_check_at = now(),
        study_instance_uid_snapshot = excluded.study_instance_uid_snapshot,
        accession_number_snapshot = excluded.accession_number_snapshot,
        updated_at = now()
      returning appointment_id
    ) select count(*)::text as queued from queued
  `);
  return Number(result.rows[0]?.queued ?? 0);
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
  const rows = await persistReportingBoardSonicDicomCacheResults([{ context, result, error }], settings, db);
  return rows[0] ?? { changed: false, status: normalizedState(result?.state ?? "unavailable") };
}

export async function persistReportingBoardSonicDicomCacheResults(
  inputs: Array<{ context: ReportLookupContext; result: ReportStatusResult | null; error?: unknown }>,
  settings: SonicDicomReportSettings,
  db: Queryable = pool
): Promise<Array<{ appointmentId: number; changed: boolean; status: ReportingBoardCacheStatus }>> {
  if (!inputs.length) return [];
  const payload = inputs.map(({ context, result, error }) => {
    const status = normalizedState(result?.state ?? "unavailable");
    const successful = Boolean(result && ["final", "draft", "no_report", "study_not_found"].includes(result.state));
    const errorText = error instanceof Error ? error.message : error ? String(error) : null;
    return {
      appointmentId: context.bookingId, status, reportFinalAt: status === "final" ? result?.reportFinalAt ?? null : null,
      studyNote: result?.studyNote ?? null, successful, errorText, studyInstanceUid: context.studyInstanceUid,
      accessionNumber: context.accessionNumber || accessionFor(context.bookingId), ttlSeconds: settings.sonicDicomStatusCacheTtlSeconds,
    };
  });
  const updated = await db.query<{ appointmentId: number; changed: boolean; status: ReportingBoardCacheStatus }>(`
    with input as (
      select * from jsonb_to_recordset($1::jsonb) as x(
        "appointmentId" bigint, status text, "reportFinalAt" timestamptz, "studyNote" text, successful boolean,
        "errorText" text, "studyInstanceUid" text, "accessionNumber" text, "ttlSeconds" integer
      )
    ), prepared as (
      select input.*, coalesce(cache.failure_count, 0) + 1 as resulting_failure_count,
        case when successful then now() + case status when 'final' then interval '24 hours' when 'study_not_found' then greatest(make_interval(secs => greatest("ttlSeconds", 300)), interval '5 minutes') else make_interval(secs => greatest("ttlSeconds", 1)) end
          else now() + least(interval '30 minutes', greatest(make_interval(secs => greatest("ttlSeconds", 1)), make_interval(secs => greatest("ttlSeconds", 1) * power(2, least(coalesce(cache.failure_count, 0) + 1, 8)::int)))) end as computed_next_check_at,
        cache.report_status as previous_status
      from input left join doctor_portal.reporting_board_sonicdicom_cache cache on cache.appointment_id = input."appointmentId"
    ), upserted as (
      insert into doctor_portal.reporting_board_sonicdicom_cache (appointment_id, report_status, report_final_at, sonicdicom_study_note, source, last_success_at, last_attempt_at, next_check_at, status_changed_at, failure_count, last_error, study_instance_uid_snapshot, accession_number_snapshot)
      select "appointmentId", status, "reportFinalAt", "studyNote", case when successful then 'sonicdicom' else null end, case when successful then now() else null end, now(), computed_next_check_at,
        case when successful and previous_status is distinct from status then now() else null end, case when successful then 0 else resulting_failure_count end, case when successful then null else "errorText" end, "studyInstanceUid", "accessionNumber"
      from prepared
      on conflict (appointment_id) do update set
        report_status = case when excluded.last_success_at is not null then excluded.report_status else doctor_portal.reporting_board_sonicdicom_cache.report_status end,
        report_final_at = case when excluded.last_success_at is not null then excluded.report_final_at else doctor_portal.reporting_board_sonicdicom_cache.report_final_at end,
        sonicdicom_study_note = case when excluded.last_success_at is not null then excluded.sonicdicom_study_note else doctor_portal.reporting_board_sonicdicom_cache.sonicdicom_study_note end,
        source = case when excluded.last_success_at is not null then 'sonicdicom' else doctor_portal.reporting_board_sonicdicom_cache.source end,
        last_success_at = coalesce(excluded.last_success_at, doctor_portal.reporting_board_sonicdicom_cache.last_success_at), last_attempt_at = now(), next_check_at = excluded.next_check_at,
        status_changed_at = case when excluded.last_success_at is not null and doctor_portal.reporting_board_sonicdicom_cache.report_status is distinct from excluded.report_status then now() else doctor_portal.reporting_board_sonicdicom_cache.status_changed_at end,
        failure_count = excluded.failure_count, last_error = excluded.last_error, study_instance_uid_snapshot = excluded.study_instance_uid_snapshot, accession_number_snapshot = excluded.accession_number_snapshot, updated_at = now()
      returning appointment_id as "appointmentId", report_status as status, last_success_at
    ) select u."appointmentId", u.status, (u.last_success_at is not null and p.successful and p.previous_status is distinct from p.status) as changed from upserted u join prepared p on p."appointmentId" = u."appointmentId"
  `, [JSON.stringify(payload)]);
  return updated.rows.map((row) => ({ ...row, appointmentId: Number(row.appointmentId) }));
}

export async function refreshReportingBoardSonicDicomCacheCandidates(candidates: ReportingBoardSonicDicomCacheCandidate[]): Promise<ReportingBoardSonicDicomCacheTickResult> {
  if (!candidates.length) return { candidates: 0, successful: 0, changedStatus: 0, final: 0, failed: 0 };
  let resolved: Map<number, ReportStatusResult>;
  try { resolved = await checkSonicDicomReportStatusesBatch(candidates, { audit: false }); }
  catch (error) {
    const settings = await readSonicDicomReportSettings();
    await persistReportingBoardSonicDicomCacheResults(candidates.map((candidate) => ({ context: candidate, result: null, error })), settings);
    return { candidates: candidates.length, successful: 0, changedStatus: 0, final: 0, failed: candidates.length };
  }
  const settings = await readSonicDicomReportSettings();
  const persistedRows = await persistReportingBoardSonicDicomCacheResults(candidates.map((candidate) => ({ context: candidate, result: resolved.get(candidate.bookingId) ?? null, error: resolved.get(candidate.bookingId)?.state === "unavailable" ? "SonicDICOM unavailable" : null })), settings);
  const persistedById = new Map(persistedRows.map((row) => [row.appointmentId, row]));
  let successful = 0; let changedStatus = 0; let final = 0; let failed = 0;
  for (const candidate of candidates) {
    const value = resolved.get(candidate.bookingId) ?? null;
    const persisted = persistedById.get(candidate.bookingId) ?? { changed: false, status: "unavailable" as const };
    if (value?.state === "unavailable") failed += 1; else successful += 1;
    if (persisted.changed) changedStatus += 1;
    if (persisted.status === "final") final += 1;
  }
  return { candidates: candidates.length, successful, changedStatus, final, failed };
}
