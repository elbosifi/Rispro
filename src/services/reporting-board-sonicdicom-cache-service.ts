import type { Pool, PoolClient } from "pg";
import { pool } from "../db/pool.js";
import { readSonicDicomReportSettings, type SonicDicomReportSettings } from "./sonicdicom-report-settings.js";
import {
  checkSonicDicomReportStatusesBatch,
  fetchSonicDicomDocumentHistoriesBatch,
  mapSonicDicomDocumentStatus,
  normalizeSonicDicomDocumentId,
  selectSonicDicomComparisonDocument,
  type ReportLookupContext,
  type ReportStatusResult,
  type SonicDicomDocumentHistoryResult,
} from "./sonicdicom-report-service.js";
import { insertDoctorAuditEvent } from "../modules/doctor-portal/profile-repository.js";

export type ReportingBoardSonicDicomReaders = {
  checkStatusesBatch: typeof checkSonicDicomReportStatusesBatch;
  fetchDocumentHistoriesBatch: typeof fetchSonicDicomDocumentHistoriesBatch;
};

const productionSonicDicomReaders: ReportingBoardSonicDicomReaders = {
  checkStatusesBatch: checkSonicDicomReportStatusesBatch,
  fetchDocumentHistoriesBatch: fetchSonicDicomDocumentHistoriesBatch,
};
let sonicDicomReaders = productionSonicDicomReaders;

export function __setReportingBoardSonicDicomReadersForTest(readers: ReportingBoardSonicDicomReaders | null): void {
  sonicDicomReaders = readers ?? productionSonicDicomReaders;
}

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

interface PersistedCacheRow {
  appointmentId: number;
  changed: boolean;
  status: ReportingBoardCacheStatus;
  successful: boolean;
  finalizedByDoctorId: number | null;
  sonicDicomFinalizedByAccount: string | null;
  sonicDicomLatestDocumentId: string | null;
  reportFinalAt: string | null;
  sonicDicomCorrelationMethod: "study_instance_uid" | "accession_fallback" | null;
}

export interface ComparisonSonicDicomCacheCandidate extends ReportLookupContext {
  comparisonAssignmentId: number;
  comparisonRequestId: number;
  assignedDoctorSonicAccount: string | null;
  assignedAt: string;
  storedDocumentId: string | null;
  storedDocumentUpdatedAt: string | null;
  primaryDocumentId: string | null;
  primaryCachedReportStatus: string | null;
  primaryManualFinal: boolean;
}

interface ComparisonDocumentObservation {
  status: ReportingBoardCacheStatus;
  successful: boolean;
  reportNo: number | null;
  documentId: string | null;
  account: string | null;
  statusCode: number | null;
  documentUpdatedAt: string | null;
  correlatedDocuments: Array<{ reportNo: number | null; documentId: string; account: string | null; statusCode: number | null; documentUpdatedAt: string | null }>;
  reportFinalAt: string | null;
  correlationMethod: "study_instance_uid" | "accession_fallback" | null;
}

export const FINAL_RECHECK_MS = 5 * 60 * 1000;

async function tryCreateSonicAutoAssignment(row: PersistedCacheRow): Promise<boolean> {
  if (!row.successful || row.status !== "final" || !row.finalizedByDoctorId) return false;
  const client = await pool.connect();
  try {
    await client.query("begin");
    const booking = await client.query<{ appointmentId: number; modalityId: number; bookingDate: string }>(`
      select b.id as "appointmentId", b.modality_id as "modalityId", b.booking_date::text as "bookingDate"
      from appointments_v2.bookings b
      where b.id = $1
        and b.requires_report = true
        and b.status not in ('cancelled', 'discontinued', 'voided')
      for update of b
    `, [row.appointmentId]);
    if (!booking.rows[0]) {
      await client.query("commit");
      return false;
    }
    const doctor = await client.query(`select 1 from doctor_portal.doctor_profiles where id = $1`, [row.finalizedByDoctorId]);
    if (!doctor.rows[0]) {
      await client.query("commit");
      return false;
    }
    const existing = await client.query(`
      select id from doctor_portal.case_team_assignments
      where appointment_id = $1 and assignment_type = 'reporting' and status = 'active'
      for update
    `, [row.appointmentId]);
    if (existing.rows[0]) {
      await client.query("commit");
      return false;
    }
    const inserted = await client.query<{ id: number }>(`
      insert into doctor_portal.case_team_assignments (
        appointment_id, roster_assignment_id, assigned_doctor_id, modality_id,
        assignment_type, expected_reporting_date, status, assignment_origin
      ) values ($1, null, $2, $3, 'reporting', $4::date, 'active', 'sonic_auto')
      on conflict (appointment_id, assignment_type) where status = 'active' do nothing
      returning id
    `, [row.appointmentId, row.finalizedByDoctorId, booking.rows[0].modalityId, booking.rows[0].bookingDate]);
    const assignmentId = Number(inserted.rows[0]?.id ?? 0);
    if (!assignmentId) {
      await client.query("commit");
      return false;
    }
    await insertDoctorAuditEvent(client, {
      actorUserId: null,
      actorDoctorId: null,
      eventType: "reporting_assignment_sonic_auto",
      targetType: "case_team_assignment",
      targetId: assignmentId,
      metadata: {
        appointmentId: row.appointmentId,
        assignmentId,
        doctorId: row.finalizedByDoctorId,
        sonicDicomFinalizedByAccount: row.sonicDicomFinalizedByAccount,
        sonicDicomLatestDocumentId: row.sonicDicomLatestDocumentId,
        reportFinalAt: row.reportFinalAt,
        sonicDicomCorrelationMethod: row.sonicDicomCorrelationMethod,
        source: "sonicdicom",
      },
      reason: "Auto-assigned from SonicDICOM finalizer on previously unassigned case",
    });
    await client.query("commit");
    return true;
  } catch (error) {
    await client.query("rollback").catch(() => null);
    throw error;
  } finally {
    client.release();
  }
}

function accessionFor(appointmentId: number): string { return `V2-${String(appointmentId).padStart(6, "0")}`; }
function normalizedState(state: string): ReportingBoardCacheStatus {
  return state === "final" || state === "draft" || state === "no_report" || state === "study_not_found" ? state : "unavailable";
}

function comparisonObservationFromHistory(
  candidate: ComparisonSonicDicomCacheCandidate,
  history: SonicDicomDocumentHistoryResult | null,
  settings: SonicDicomReportSettings
): ComparisonDocumentObservation {
  const noObservation = { statusCode: null, documentUpdatedAt: null, correlatedDocuments: [] };
  if (!history) return { status: "unavailable", successful: false, reportNo: null, documentId: candidate.storedDocumentId, account: null, reportFinalAt: null, correlationMethod: null, ...noObservation };
  if (!history.foundStudy) return { status: "study_not_found", successful: true, reportNo: null, documentId: candidate.storedDocumentId, account: null, reportFinalAt: null, correlationMethod: null, ...noObservation };
  const selected = selectSonicDicomComparisonDocument(candidate, history, {
    noReportStatusCodes: settings.sonicDicomSqlNoReportStatusCodes,
    finalStatusCodes: settings.sonicDicomSqlFinalStatusCodes,
  });
  if (selected.multipleCandidates) {
    console.warn(JSON.stringify({
      type: "comparison_sonicdicom_multiple_document_candidates",
      comparisonAssignmentId: candidate.comparisonAssignmentId,
      comparisonRequestId: candidate.comparisonRequestId,
      account: candidate.assignedDoctorSonicAccount,
    }));
  }
  if (selected.bootstrapRejected) console.warn(JSON.stringify({
    type: "comparison_sonicdicom_bootstrap_ambiguous",
    comparisonAssignmentId: candidate.comparisonAssignmentId,
    comparisonRequestId: candidate.comparisonRequestId,
  }));
  if (selected.failClosed) return {
    status: "unavailable", successful: false, reportNo: history.reportNo, documentId: candidate.storedDocumentId,
    account: null, reportFinalAt: null, correlationMethod: history.correlationMethod, ...noObservation,
  };
  if (!selected.document) return {
    status: "no_report", successful: true, reportNo: history.reportNo, documentId: candidate.storedDocumentId,
    account: null, reportFinalAt: null, correlationMethod: history.correlationMethod, ...noObservation,
  };
  const mapped = mapSonicDicomDocumentStatus(
    settings, selected.document.statusCode, selected.document.updatedAt, selected.document.documentId,
    selected.document.account, history.correlationMethod
  );
  const correlated = [selected.storedDocument, selected.document].filter((document): document is NonNullable<typeof document> => Boolean(document));
  const correlatedDocuments = [...new Map(correlated.map((document) => [normalizeSonicDicomDocumentId(document.documentId), {
    reportNo: document.reportNo ?? history.reportNo, documentId: document.documentId, account: document.account,
    statusCode: document.statusCode, documentUpdatedAt: document.updatedAt,
  }])).values()];
  return {
    status: normalizedState(mapped.state), successful: mapped.state !== "unavailable", reportNo: history.reportNo,
    documentId: selected.document.documentId, account: selected.document.account,
    reportFinalAt: mapped.state === "final" ? mapped.reportFinalAt : null,
    correlationMethod: history.correlationMethod, statusCode: selected.document.statusCode,
    documentUpdatedAt: selected.document.updatedAt, correlatedDocuments,
  };
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
export async function queueFullReportingBoardSonicDicomResync(requestedAt: string, db: Queryable = pool): Promise<number> {
  const result = await db.query<{ queued: string }>(`
    with queued as (
      insert into doctor_portal.reporting_board_sonicdicom_cache (
        appointment_id, report_status, next_check_at, study_instance_uid_snapshot, accession_number_snapshot
      )
      select b.id, 'unavailable', $1::timestamptz, b.study_instance_uid, ('V2-' || lpad(b.id::text, 6, '0'))
      from appointments_v2.bookings b
      left join doctor_portal.reporting_board_manual_final_overrides manual
        on manual.appointment_id = b.id and manual.cleared_at is null
      where b.status = 'completed' and b.requires_report = true and manual.id is null
      on conflict (appointment_id) do update set
        next_check_at = $1::timestamptz,
        study_instance_uid_snapshot = excluded.study_instance_uid_snapshot,
        accession_number_snapshot = excluded.accession_number_snapshot,
        updated_at = now()
      returning appointment_id
    ) select count(*)::text as queued from queued
  `, [requestedAt]);
  // Comparison observations are independent from the source appointment's
  // manual-final layer, so they are always queued for active assignments.
  const comparisons = await db.query<{ queued: string }>(`
    with queued as (
    insert into doctor_portal.comparison_sonicdicom_cache (
      comparison_assignment_id, comparison_request_id, report_status, next_check_at
    )
    select cca.id, cca.comparison_request_id, 'unavailable', $1::timestamptz
    from doctor_portal.comparison_case_assignments cca
    join comparison_requests cr on cr.id = cca.comparison_request_id
    where cca.status = 'active' and cr.status in ('ready_for_reporting', 'assigned', 'finalized')
    on conflict (comparison_assignment_id) do update set
      next_check_at = $1::timestamptz,
      updated_at = now()
    returning comparison_assignment_id
    ) select count(*)::text as queued from queued
  `, [requestedAt]);
  return Number(result.rows[0]?.queued ?? 0) + Number(comparisons.rows[0]?.queued ?? 0);
}

export async function getFullReportingBoardSonicDicomResyncStatus(requestedAt: string, db: Queryable = pool): Promise<{ remaining: number; failed: number }> {
  const result = await db.query<{ remaining: string; failed: string }>(`
    with work as (
      select next_check_at, last_attempt_at, last_error from doctor_portal.reporting_board_sonicdicom_cache
      union all
      select next_check_at, last_attempt_at, last_error from doctor_portal.comparison_sonicdicom_cache
    )
    select count(*) filter (where next_check_at = $1::timestamptz)::text as remaining,
      count(*) filter (where last_attempt_at >= $1::timestamptz and last_error is not null)::text as failed
    from work
  `, [requestedAt]);
  return { remaining: Number(result.rows[0]?.remaining ?? 0), failed: Number(result.rows[0]?.failed ?? 0) };
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

export async function selectDueComparisonSonicDicomCacheCandidates(limit: number, db: Queryable = pool): Promise<ComparisonSonicDicomCacheCandidate[]> {
  const result = await db.query<ComparisonSonicDicomCacheCandidate>(`
    select
      b.id as "bookingId", ('V2-' || lpad(b.id::text, 6, '0')) as "accessionNumber", b.study_instance_uid as "studyInstanceUid",
      b.requires_report as "requiresReport", b.status,
      cca.id as "comparisonAssignmentId", cca.comparison_request_id as "comparisonRequestId", cca.assigned_at as "assignedAt",
      coalesce(nullif(btrim(assigned_user.email), ''), nullif(btrim(assigned_user.username), '')) as "assignedDoctorSonicAccount", comparison_cache.sonicdicom_document_id as "storedDocumentId",
      comparison_cache.sonicdicom_document_updated_at as "storedDocumentUpdatedAt",
      primary_cache.sonicdicom_latest_document_id as "primaryDocumentId", primary_cache.report_status as "primaryCachedReportStatus",
      manual.id is not null as "primaryManualFinal"
    from doctor_portal.comparison_case_assignments cca
    join comparison_requests cr on cr.id = cca.comparison_request_id
    join appointments_v2.bookings b on b.id = cr.linked_previous_booking_id
    join doctor_portal.doctor_profiles assigned_doctor on assigned_doctor.id = cca.assigned_doctor_id
    join users assigned_user on assigned_user.id = assigned_doctor.user_id
    left join doctor_portal.comparison_sonicdicom_cache comparison_cache on comparison_cache.comparison_assignment_id = cca.id
    left join doctor_portal.reporting_board_sonicdicom_cache primary_cache on primary_cache.appointment_id = b.id
    left join doctor_portal.reporting_board_manual_final_overrides manual on manual.appointment_id = b.id and manual.cleared_at is null
    where cca.status = 'active'
      and cr.status in ('ready_for_reporting', 'assigned', 'finalized')
      and (comparison_cache.comparison_assignment_id is null or comparison_cache.next_check_at <= now())
    order by (comparison_cache.comparison_assignment_id is null) desc, comparison_cache.next_check_at asc nulls first, cca.assigned_at asc, cca.id asc
    limit $1
  `, [Math.max(1, Math.min(limit, 200))]);
  return result.rows.map((row) => ({
    ...row,
    bookingId: Number(row.bookingId),
    comparisonAssignmentId: Number(row.comparisonAssignmentId),
    comparisonRequestId: Number(row.comparisonRequestId),
    primaryManualFinal: Boolean(row.primaryManualFinal),
    storedDocumentId: row.storedDocumentId == null ? null : String(row.storedDocumentId),
    storedDocumentUpdatedAt: row.storedDocumentUpdatedAt == null ? null : String(row.storedDocumentUpdatedAt),
    primaryDocumentId: row.primaryDocumentId == null ? null : String(row.primaryDocumentId),
    primaryCachedReportStatus: row.primaryCachedReportStatus == null ? null : String(row.primaryCachedReportStatus),
    assignedDoctorSonicAccount: row.assignedDoctorSonicAccount == null ? null : String(row.assignedDoctorSonicAccount),
    assignedAt: String(row.assignedAt),
  }));
}

export async function selectComparisonSonicDicomCacheCandidatesByRequestIds(
  comparisonRequestIds: number[],
  db: Queryable = pool
): Promise<ComparisonSonicDicomCacheCandidate[]> {
  const ids = [...new Set(comparisonRequestIds.filter((id) => Number.isInteger(id) && id > 0))];
  if (!ids.length) return [];
  const result = await db.query<ComparisonSonicDicomCacheCandidate>(`
    select
      b.id as "bookingId", ('V2-' || lpad(b.id::text, 6, '0')) as "accessionNumber", b.study_instance_uid as "studyInstanceUid",
      b.requires_report as "requiresReport", b.status,
      cca.id as "comparisonAssignmentId", cca.comparison_request_id as "comparisonRequestId", cca.assigned_at as "assignedAt",
      coalesce(nullif(btrim(assigned_user.email), ''), nullif(btrim(assigned_user.username), '')) as "assignedDoctorSonicAccount", comparison_cache.sonicdicom_document_id as "storedDocumentId",
      comparison_cache.sonicdicom_document_updated_at as "storedDocumentUpdatedAt",
      primary_cache.sonicdicom_latest_document_id as "primaryDocumentId", primary_cache.report_status as "primaryCachedReportStatus",
      manual.id is not null as "primaryManualFinal"
    from doctor_portal.comparison_case_assignments cca
    join comparison_requests cr on cr.id = cca.comparison_request_id
    join appointments_v2.bookings b on b.id = cr.linked_previous_booking_id
    join doctor_portal.doctor_profiles assigned_doctor on assigned_doctor.id = cca.assigned_doctor_id
    join users assigned_user on assigned_user.id = assigned_doctor.user_id
    left join doctor_portal.comparison_sonicdicom_cache comparison_cache on comparison_cache.comparison_assignment_id = cca.id
    left join doctor_portal.reporting_board_sonicdicom_cache primary_cache on primary_cache.appointment_id = b.id
    left join doctor_portal.reporting_board_manual_final_overrides manual on manual.appointment_id = b.id and manual.cleared_at is null
    where cca.status = 'active'
      and cr.status in ('ready_for_reporting', 'assigned', 'finalized')
      and cr.id = any($1::bigint[])
    order by cca.assigned_at asc, cca.id asc
  `, [ids]);
  return result.rows.map((row) => ({
    ...row,
    bookingId: Number(row.bookingId),
    comparisonAssignmentId: Number(row.comparisonAssignmentId),
    comparisonRequestId: Number(row.comparisonRequestId),
    primaryManualFinal: Boolean(row.primaryManualFinal),
    storedDocumentId: row.storedDocumentId == null ? null : String(row.storedDocumentId),
    storedDocumentUpdatedAt: row.storedDocumentUpdatedAt == null ? null : String(row.storedDocumentUpdatedAt),
    primaryDocumentId: row.primaryDocumentId == null ? null : String(row.primaryDocumentId),
    primaryCachedReportStatus: row.primaryCachedReportStatus == null ? null : String(row.primaryCachedReportStatus),
    assignedDoctorSonicAccount: row.assignedDoctorSonicAccount == null ? null : String(row.assignedDoctorSonicAccount),
    assignedAt: String(row.assignedAt),
  }));
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
      latestDocumentId: result?.latestDocumentId ?? null,
      finalizedByAccount: status === "final" ? String(result?.finalizedByAccount ?? "").trim() || null : null,
      correlationMethod: result?.correlationMethod ?? null,
      studyNote: result?.studyNote ?? null, successful, errorText, studyInstanceUid: context.studyInstanceUid,
      accessionNumber: context.accessionNumber || accessionFor(context.bookingId), ttlSeconds: settings.sonicDicomStatusCacheTtlSeconds,
      finalRecheckSeconds: Math.floor(FINAL_RECHECK_MS / 1000),
    };
  });
  const updated = await db.query<PersistedCacheRow>(`
    with input as (
      select * from jsonb_to_recordset($1::jsonb) as x(
        "appointmentId" bigint, status text, "reportFinalAt" timestamptz, "latestDocumentId" text,
        "finalizedByAccount" text, "correlationMethod" text, "studyNote" text, successful boolean,
        "errorText" text, "studyInstanceUid" text, "accessionNumber" text, "ttlSeconds" integer, "finalRecheckSeconds" integer
      )
    ), prepared as (
      select input.*, finalizer.doctor_id as finalized_by_doctor_id,
        coalesce(cache.failure_count, 0) + 1 as resulting_failure_count,
        case when successful then now() + case status when 'final' then make_interval(secs => "finalRecheckSeconds") when 'study_not_found' then greatest(make_interval(secs => greatest("ttlSeconds", 300)), interval '5 minutes') else make_interval(secs => greatest("ttlSeconds", 1)) end
          else now() + least(interval '30 minutes', greatest(make_interval(secs => greatest("ttlSeconds", 1)), make_interval(secs => greatest("ttlSeconds", 1) * power(2, least(coalesce(cache.failure_count, 0) + 1, 8)::int)))) end as computed_next_check_at,
        cache.report_status as previous_status
      from input left join doctor_portal.reporting_board_sonicdicom_cache cache on cache.appointment_id = input."appointmentId"
      left join lateral (
        select case when count(*) = 1 then min(dp.id) else null end as doctor_id
        from users u
        join doctor_portal.doctor_profiles dp on dp.user_id = u.id
        where input.successful and input.status = 'final'
          and nullif(btrim(input."finalizedByAccount"), '') is not null
          and lower(btrim(u.username)) = lower(btrim(input."finalizedByAccount"))
      ) finalizer on true
    ), upserted as (
      insert into doctor_portal.reporting_board_sonicdicom_cache (appointment_id, report_status, report_final_at, sonicdicom_latest_document_id, sonicdicom_finalized_by_account, finalized_by_doctor_id, correlation_method, sonicdicom_study_note, source, last_success_at, last_attempt_at, next_check_at, status_changed_at, failure_count, last_error, study_instance_uid_snapshot, accession_number_snapshot)
      select "appointmentId", status, "reportFinalAt", "latestDocumentId", "finalizedByAccount", finalized_by_doctor_id, "correlationMethod", "studyNote", case when successful then 'sonicdicom' else null end, case when successful then now() else null end, now(), computed_next_check_at,
        case when successful and previous_status is distinct from status then now() else null end, case when successful then 0 else resulting_failure_count end, case when successful then null else "errorText" end, "studyInstanceUid", "accessionNumber"
      from prepared
      on conflict (appointment_id) do update set
        report_status = case when excluded.last_success_at is not null then excluded.report_status else doctor_portal.reporting_board_sonicdicom_cache.report_status end,
        report_final_at = case when excluded.last_success_at is not null then excluded.report_final_at else doctor_portal.reporting_board_sonicdicom_cache.report_final_at end,
        sonicdicom_latest_document_id = case when excluded.last_success_at is not null then excluded.sonicdicom_latest_document_id else doctor_portal.reporting_board_sonicdicom_cache.sonicdicom_latest_document_id end,
        sonicdicom_finalized_by_account = case when excluded.last_success_at is not null then excluded.sonicdicom_finalized_by_account else doctor_portal.reporting_board_sonicdicom_cache.sonicdicom_finalized_by_account end,
        finalized_by_doctor_id = case when excluded.last_success_at is not null then excluded.finalized_by_doctor_id else doctor_portal.reporting_board_sonicdicom_cache.finalized_by_doctor_id end,
        correlation_method = case when excluded.last_success_at is not null then excluded.correlation_method else doctor_portal.reporting_board_sonicdicom_cache.correlation_method end,
        sonicdicom_study_note = case when excluded.last_success_at is not null then excluded.sonicdicom_study_note else doctor_portal.reporting_board_sonicdicom_cache.sonicdicom_study_note end,
        source = case when excluded.last_success_at is not null then 'sonicdicom' else doctor_portal.reporting_board_sonicdicom_cache.source end,
        last_success_at = coalesce(excluded.last_success_at, doctor_portal.reporting_board_sonicdicom_cache.last_success_at), last_attempt_at = now(), next_check_at = excluded.next_check_at,
        status_changed_at = case when excluded.last_success_at is not null and doctor_portal.reporting_board_sonicdicom_cache.report_status is distinct from excluded.report_status then now() else doctor_portal.reporting_board_sonicdicom_cache.status_changed_at end,
        failure_count = excluded.failure_count, last_error = excluded.last_error, study_instance_uid_snapshot = excluded.study_instance_uid_snapshot, accession_number_snapshot = excluded.accession_number_snapshot, updated_at = now()
      returning appointment_id as "appointmentId", report_status as status, last_success_at
    ) select u."appointmentId", u.status,
      (u.last_success_at is not null and p.successful and p.previous_status is distinct from p.status) as changed,
      p.successful,
      p.finalized_by_doctor_id as "finalizedByDoctorId",
      p."finalizedByAccount" as "sonicDicomFinalizedByAccount",
      p."latestDocumentId" as "sonicDicomLatestDocumentId",
      p."reportFinalAt" as "reportFinalAt",
      p."correlationMethod" as "sonicDicomCorrelationMethod"
    from upserted u join prepared p on p."appointmentId" = u."appointmentId"
  `, [JSON.stringify(payload)]);
  for (const row of updated.rows) {
    await tryCreateSonicAutoAssignment(row).catch((error) => {
      console.warn(JSON.stringify({
        type: "reporting_board_sonic_assignment_sync_failed",
        appointmentId: Number(row.appointmentId),
        error: error instanceof Error ? error.message : String(error),
      }));
    });
  }
  return updated.rows.map((row) => ({ ...row, appointmentId: Number(row.appointmentId) }));
}

async function persistComparisonSonicDicomCacheObservations(
  inputs: Array<{ candidate: ComparisonSonicDicomCacheCandidate; observation: ComparisonDocumentObservation; error?: unknown }>,
  settings: SonicDicomReportSettings,
  db: Queryable = pool
): Promise<void> {
  if (!inputs.length) return;
  const payload = inputs.map(({ candidate, observation, error }) => ({
    comparisonAssignmentId: candidate.comparisonAssignmentId,
    comparisonRequestId: candidate.comparisonRequestId,
    status: observation.status,
    successful: observation.successful,
    reportNo: observation.reportNo,
    documentId: observation.documentId,
    account: observation.account,
    statusCode: observation.statusCode,
    documentUpdatedAt: observation.documentUpdatedAt,
    reportFinalAt: observation.reportFinalAt,
    correlationMethod: observation.correlationMethod,
    errorText: error instanceof Error ? error.message : error ? String(error) : null,
    ttlSeconds: settings.sonicDicomStatusCacheTtlSeconds,
  }));
  await db.query(`
    with input as (
      select * from jsonb_to_recordset($1::jsonb) as x(
        "comparisonAssignmentId" bigint, "comparisonRequestId" bigint, status text, successful boolean,
        "reportNo" integer, "documentId" text, account text, "statusCode" integer, "documentUpdatedAt" timestamptz, "reportFinalAt" timestamptz,
        "correlationMethod" text, "errorText" text, "ttlSeconds" integer
      )
    ), prepared as (
      select input.*, cache.report_status as previous_status,
        coalesce(cache.failure_count, 0) + 1 as resulting_failure_count,
        case when input.successful then now() + case input.status
          when 'final' then make_interval(secs => ${Math.floor(FINAL_RECHECK_MS / 1000)})
          when 'study_not_found' then greatest(make_interval(secs => greatest(input."ttlSeconds", 300)), interval '5 minutes')
          else make_interval(secs => greatest(input."ttlSeconds", 1)) end
        else now() + least(interval '30 minutes', greatest(make_interval(secs => greatest(input."ttlSeconds", 1)), make_interval(secs => greatest(input."ttlSeconds", 1) * power(2, least(coalesce(cache.failure_count, 0) + 1, 8)::int)))) end as computed_next_check_at
      from input
      left join doctor_portal.comparison_sonicdicom_cache cache on cache.comparison_assignment_id = input."comparisonAssignmentId"
    )
    insert into doctor_portal.comparison_sonicdicom_cache (
      comparison_assignment_id, comparison_request_id, report_status, sonicdicom_report_no, sonicdicom_document_id,
      sonicdicom_account, sonicdicom_status_code, sonicdicom_document_updated_at, report_final_at, correlation_method, last_attempt_at, last_success_at, next_check_at,
      status_changed_at, failure_count, last_error
    )
    select "comparisonAssignmentId", "comparisonRequestId", status, "reportNo", "documentId", account, "statusCode", "documentUpdatedAt",
      "reportFinalAt", "correlationMethod", now(), case when successful then now() else null end,
      computed_next_check_at, case when successful and previous_status is distinct from status then now() else null end,
      case when successful then 0 else resulting_failure_count end, case when successful then null else "errorText" end
    from prepared
    on conflict (comparison_assignment_id) do update set
      comparison_request_id = excluded.comparison_request_id,
      report_status = case when excluded.last_success_at is not null then excluded.report_status else doctor_portal.comparison_sonicdicom_cache.report_status end,
      sonicdicom_report_no = case when excluded.last_success_at is not null then excluded.sonicdicom_report_no else doctor_portal.comparison_sonicdicom_cache.sonicdicom_report_no end,
      sonicdicom_document_id = coalesce(excluded.sonicdicom_document_id, doctor_portal.comparison_sonicdicom_cache.sonicdicom_document_id),
      sonicdicom_account = case when excluded.last_success_at is not null then excluded.sonicdicom_account else doctor_portal.comparison_sonicdicom_cache.sonicdicom_account end,
      sonicdicom_status_code = case when excluded.last_success_at is not null then excluded.sonicdicom_status_code else doctor_portal.comparison_sonicdicom_cache.sonicdicom_status_code end,
      sonicdicom_document_updated_at = case when excluded.last_success_at is not null then excluded.sonicdicom_document_updated_at else doctor_portal.comparison_sonicdicom_cache.sonicdicom_document_updated_at end,
      report_final_at = case when excluded.last_success_at is not null then excluded.report_final_at else doctor_portal.comparison_sonicdicom_cache.report_final_at end,
      correlation_method = case when excluded.last_success_at is not null then excluded.correlation_method else doctor_portal.comparison_sonicdicom_cache.correlation_method end,
      last_attempt_at = now(), last_success_at = coalesce(excluded.last_success_at, doctor_portal.comparison_sonicdicom_cache.last_success_at),
      next_check_at = excluded.next_check_at,
      status_changed_at = case when excluded.last_success_at is not null and doctor_portal.comparison_sonicdicom_cache.report_status is distinct from excluded.report_status then now() else doctor_portal.comparison_sonicdicom_cache.status_changed_at end,
      failure_count = excluded.failure_count, last_error = excluded.last_error, updated_at = now()
  `, [JSON.stringify(payload)]);
  const documents = inputs.flatMap(({ candidate, observation }) => observation.correlatedDocuments.map((document) => ({
    comparisonAssignmentId: candidate.comparisonAssignmentId,
    documentId: document.documentId,
    reportNo: document.reportNo,
    account: document.account,
    statusCode: document.statusCode,
    documentUpdatedAt: document.documentUpdatedAt,
  })));
  if (!documents.length) return;
  await db.query(`
    with input as (
      select * from jsonb_to_recordset($1::jsonb) as x(
        "comparisonAssignmentId" bigint, "documentId" text, "reportNo" integer, account text,
        "statusCode" integer, "documentUpdatedAt" timestamptz
      )
    )
    insert into doctor_portal.comparison_sonicdicom_documents (
      comparison_assignment_id, sonicdicom_document_id, sonicdicom_report_no, sonicdicom_account,
      last_status_code, document_updated_at, last_seen_at, removed_at
    )
    select "comparisonAssignmentId", "documentId", "reportNo", account, "statusCode", "documentUpdatedAt", now(),
      case when "statusCode" = any($2::integer[]) then now() else null end
    from input
    on conflict (comparison_assignment_id, sonicdicom_document_id) do update set
      sonicdicom_report_no = coalesce(excluded.sonicdicom_report_no, doctor_portal.comparison_sonicdicom_documents.sonicdicom_report_no),
      sonicdicom_account = coalesce(excluded.sonicdicom_account, doctor_portal.comparison_sonicdicom_documents.sonicdicom_account),
      last_status_code = excluded.last_status_code,
      document_updated_at = excluded.document_updated_at,
      last_seen_at = now(),
      removed_at = coalesce(doctor_portal.comparison_sonicdicom_documents.removed_at, excluded.removed_at)
  `, [JSON.stringify(documents), settings.sonicDicomSqlNoReportStatusCodes]);
}

async function knownComparisonDocumentIdsByAppointment(appointmentIds: number[], db: Queryable = pool): Promise<Map<number, Set<string>>> {
  if (!appointmentIds.length) return new Map();
  const result = await db.query<{ appointmentId: number; documentId: string }>(`
    select cr.linked_previous_booking_id as "appointmentId", documents.sonicdicom_document_id as "documentId"
    from doctor_portal.comparison_sonicdicom_documents documents
    join doctor_portal.comparison_case_assignments assignment on assignment.id = documents.comparison_assignment_id
    join comparison_requests cr on cr.id = assignment.comparison_request_id
    where cr.linked_previous_booking_id = any($1::bigint[])
    union
    select cr.linked_previous_booking_id as "appointmentId", cache.sonicdicom_document_id as "documentId"
    from doctor_portal.comparison_sonicdicom_cache cache
    join comparison_requests cr on cr.id = cache.comparison_request_id
    where cr.linked_previous_booking_id = any($1::bigint[])
      and nullif(btrim(cache.sonicdicom_document_id), '') is not null
  `, [appointmentIds]);
  const ids = new Map<number, Set<string>>();
  for (const row of result.rows) {
    const appointmentId = Number(row.appointmentId);
    const values = ids.get(appointmentId) ?? new Set<string>();
    values.add(normalizeSonicDicomDocumentId(row.documentId));
    ids.set(appointmentId, values);
  }
  return ids;
}

export async function refreshReportingBoardSonicDicomCacheCandidates(
  candidates: ReportingBoardSonicDicomCacheCandidate[],
  comparisonCandidates: ComparisonSonicDicomCacheCandidate[] = []
): Promise<ReportingBoardSonicDicomCacheTickResult> {
  if (!candidates.length && !comparisonCandidates.length) return { candidates: 0, successful: 0, changedStatus: 0, final: 0, failed: 0 };
  const settings = await readSonicDicomReportSettings();
  // A comparison source is refreshed with its comparison when it is not manual-final.
  // This avoids waiting for an unrelated primary due time to protect finality.
  const primaryContexts = new Map<number, ReportLookupContext>(candidates.map((candidate) => [candidate.bookingId, candidate]));
  for (const comparison of comparisonCandidates) {
    if (!comparison.primaryManualFinal && !primaryContexts.has(comparison.bookingId)) {
      primaryContexts.set(comparison.bookingId, {
        bookingId: comparison.bookingId, accessionNumber: comparison.accessionNumber,
        studyInstanceUid: comparison.studyInstanceUid, requiresReport: comparison.requiresReport, status: comparison.status,
      });
    }
  }
  const primary = [...primaryContexts.values()];
  let resolved = new Map<number, ReportStatusResult>();
  try {
    resolved = primary.length ? await sonicDicomReaders.checkStatusesBatch(primary, { audit: false }) : resolved;
  } catch (error) {
    await persistReportingBoardSonicDicomCacheResults(primary.map((context) => ({ context, result: null, error })), settings);
    await persistComparisonSonicDicomCacheObservations(comparisonCandidates.map((candidate) => ({
      candidate,
      observation: { status: "unavailable", successful: false, reportNo: null, documentId: candidate.storedDocumentId, account: null, statusCode: null, documentUpdatedAt: null, correlatedDocuments: [], reportFinalAt: null, correlationMethod: null },
      error,
    })), settings);
    return { candidates: candidates.length + comparisonCandidates.length, successful: 0, changedStatus: 0, final: 0, failed: candidates.length + comparisonCandidates.length };
  }

  let histories = new Map<string, SonicDicomDocumentHistoryResult>();
  let historyError: unknown = null;
  try {
    const historyContexts = [...new Map(primary.map((context) => [context.bookingId, {
      lookupKey: `study:${context.bookingId}`, accessionNumber: context.accessionNumber, studyInstanceUid: context.studyInstanceUid,
    }])).values()];
    for (let index = 0; index < historyContexts.length; index += 200) {
      const batch = await sonicDicomReaders.fetchDocumentHistoriesBatch(historyContexts.slice(index, index + 200));
      for (const [key, value] of batch) histories.set(key, value);
    }
  } catch (error) {
    historyError = error;
  }

  const comparisonObservations = comparisonCandidates.map((candidate) => {
    const observation = comparisonObservationFromHistory(candidate, histories.get(`study:${candidate.bookingId}`) ?? null, settings);
    return { candidate, observation, error: historyError ?? (!observation.successful ? "SonicDICOM comparison correlation was not safely established" : null) };
  });
  await persistComparisonSonicDicomCacheObservations(comparisonObservations, settings);

  const comparisonDocumentIds = await knownComparisonDocumentIdsByAppointment(primary.map((context) => context.bookingId));
  const primaryInputs = primary.map((context) => {
    const history = histories.get(`study:${context.bookingId}`);
    const excluded = comparisonDocumentIds.get(context.bookingId);
    const normal = resolved.get(context.bookingId) ?? null;
    if (!history) {
      if (excluded?.size) return { context, result: null, error: historyError ?? "SonicDICOM document history unavailable" };
      return { context, result: normal, error: normal?.state === "unavailable" ? "SonicDICOM unavailable" : null };
    }
    if (!excluded?.size) return { context, result: normal, error: normal?.state === "unavailable" ? "SonicDICOM unavailable" : null };
    const noReportStatuses = new Set(settings.sonicDicomSqlNoReportStatusCodes.filter(Number.isInteger));
    const document = history.documents.find((candidate) =>
      !excluded.has(normalizeSonicDicomDocumentId(candidate.documentId)) &&
      (candidate.statusCode == null || !noReportStatuses.has(candidate.statusCode))
    ) ?? null;
    const result = document
      ? mapSonicDicomDocumentStatus(settings, document.statusCode, document.updatedAt, document.documentId, document.account, history.correlationMethod)
      : {
        state: "no_report" as const, canViewReport: false, source: "sonicdicom" as const, reportFinalAt: null,
        latestDocumentId: null, finalizedByAccount: null, correlationMethod: history.correlationMethod,
      };
    return { context, result, error: result.state === "unavailable" ? "SonicDICOM unavailable" : null };
  });
  const persistedRows = await persistReportingBoardSonicDicomCacheResults(primaryInputs, settings);
  const persistedById = new Map(persistedRows.map((row) => [row.appointmentId, row]));
  let successful = 0; let changedStatus = 0; let final = 0; let failed = 0;
  for (const candidate of candidates) {
    const value = primaryInputs.find((input) => input.context.bookingId === candidate.bookingId)?.result ?? null;
    const persisted = persistedById.get(candidate.bookingId) ?? { changed: false, status: "unavailable" as const };
    if (!value || value.state === "unavailable") failed += 1; else successful += 1;
    if (persisted.changed) changedStatus += 1;
    if (persisted.status === "final") final += 1;
  }
  for (const { observation } of comparisonObservations) {
    if (observation.successful) successful += 1; else failed += 1;
    if (observation.status === "final") final += 1;
  }
  return { candidates: candidates.length + comparisonCandidates.length, successful, changedStatus, final, failed };
}
