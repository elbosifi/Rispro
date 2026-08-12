import { createHash } from "crypto";
import type { PoolClient } from "pg";
import { pool } from "../db/pool.js";
import { resolveOrthancSettings } from "./orthanc-settings-resolver.js";
import {
  MWL_POLICY_CATEGORY,
  REQUIRE_PROTOCOL_BEFORE_MWL_KEY,
  resolveMwlEligibilityForBooking,
  type MwlEligibility,
} from "./mwl-eligibility-service.js";
import { PROTOCOLING_MODALITY_SQL } from "./protocoling-modality.js";

export type OrthancMwlOperation = "upsert" | "delete";

type BookingStatus = "scheduled" | "arrived" | "waiting" | "completed" | "no-show" | "cancelled" | "discontinued" | "voided";
const ORTHANC_QUEUE_STATUSES = new Set(["arrived", "waiting"]);

interface BookingSyncSnapshot {
  id: number;
  patient_id: number;
  patient_primary_id: string | null;
  modality_id: number;
  exam_type_id: number | null;
  reporting_priority_id: number | null;
  booking_date: string;
  booking_time: string | null;
  status: BookingStatus;
  notes: string | null;
  updated_at: string;
  mrn: string | null;
  national_id: string | null;
  arabic_full_name: string;
  english_full_name: string | null;
  estimated_date_of_birth: string | null;
  sex: string | null;
  modality_code: string;
  modality_name_en: string;
  modality_name_ar: string;
  exam_name_en: string | null;
  exam_name_ar: string | null;
}

export interface OrthancSyncEnqueueResult {
  enqueued: boolean;
  jobId: number | null;
  operation: OrthancMwlOperation | null;
  reason?: string;
}

export interface OrthancOutboxJob {
  id: number;
  bookingId: number;
  operation: OrthancMwlOperation;
  attemptCount: number;
  payloadHash: string | null;
}

export interface OrthancSyncState {
  bookingId: number;
  externalWorklistId: string | null;
  syncStatus: "pending" | "in_progress" | "synced" | "failed" | "deleted";
  payloadHash: string | null;
}

export async function isOrthancMwlEnabled(): Promise<boolean> {
  const settings = await resolveOrthancSettings();
  return settings.enabled;
}

export async function isOrthancMwlShadowMode(): Promise<boolean> {
  const settings = await resolveOrthancSettings();
  return settings.shadowMode;
}

function deriveOperationFromStatus(status: string | null | undefined): OrthancMwlOperation {
  return status === "scheduled" || status === "arrived" || status === "waiting" ? "upsert" : "delete";
}

export function shouldSkipOrthancInitialUpsertForQueueGate(input: {
  sendOnlyWhenPatientEntersQueue: boolean;
  currentProjectionExists: boolean;
  status: string | null | undefined;
}): boolean {
  return input.sendOnlyWhenPatientEntersQueue
    && !input.currentProjectionExists
    && deriveOperationFromStatus(input.status) === "upsert"
    && !ORTHANC_QUEUE_STATUSES.has(String(input.status || ""));
}

async function loadBookingSyncSnapshot(
  client: PoolClient,
  bookingId: number
): Promise<BookingSyncSnapshot | null> {
  const { rows } = await client.query<BookingSyncSnapshot>(
    `
        select
          b.id,
          b.patient_id,
          p.identifier_value as patient_primary_id,
          b.modality_id,
        b.exam_type_id,
        b.reporting_priority_id,
        b.booking_date::text as booking_date,
        b.booking_time::text as booking_time,
        b.status,
        b.notes,
        b.updated_at::text as updated_at,
        p.mrn,
        p.national_id,
        p.arabic_full_name,
        p.english_full_name,
        p.estimated_date_of_birth::text as estimated_date_of_birth,
        p.sex,
        m.code as modality_code,
        m.name_en as modality_name_en,
        m.name_ar as modality_name_ar,
        et.name_en as exam_name_en,
        et.name_ar as exam_name_ar
      from appointments_v2.bookings b
      join patients p on p.id = b.patient_id
      join modalities m on m.id = b.modality_id
      left join exam_types et on et.id = b.exam_type_id
      where b.id = $1::bigint
      limit 1
    `,
    [bookingId]
  );

  return rows[0] ?? null;
}

async function hasCurrentOrthancProjection(client: PoolClient, bookingId: number): Promise<boolean> {
  const { rows } = await client.query<{ exists: boolean }>(
    `
      select exists(
        select 1
        from external_mwl_sync
        where booking_id = $1::bigint
          and external_system = 'orthanc'
          and deleted_at is null
      )
    `,
    [bookingId]
  );
  return Boolean(rows[0]?.exists);
}

function computePayloadHash(snapshot: BookingSyncSnapshot | null): string | null {
  if (!snapshot) return null;
  const payload = {
    bookingId: snapshot.id,
    patientId: snapshot.patient_id,
    patientPrimaryId: snapshot.patient_primary_id,
    modalityId: snapshot.modality_id,
    examTypeId: snapshot.exam_type_id,
    reportingPriorityId: snapshot.reporting_priority_id,
    bookingDate: snapshot.booking_date,
    bookingTime: snapshot.booking_time,
    status: snapshot.status,
    notes: snapshot.notes,
    patientMrn: snapshot.mrn,
    patientNationalId: snapshot.national_id,
    patientNameArabic: snapshot.arabic_full_name,
    patientNameEnglish: snapshot.english_full_name,
    patientDob: snapshot.estimated_date_of_birth,
    patientSex: snapshot.sex,
    modalityCode: snapshot.modality_code,
    modalityNameEn: snapshot.modality_name_en,
    modalityNameAr: snapshot.modality_name_ar,
    examNameEn: snapshot.exam_name_en,
    examNameAr: snapshot.exam_name_ar,
    updatedAt: snapshot.updated_at,
  };
  return createHash("sha256").update(JSON.stringify(payload)).digest("hex");
}

export async function enqueueOrthancSyncForBooking(
  bookingId: number,
  resolvedEligibility?: MwlEligibility
): Promise<OrthancSyncEnqueueResult> {
  const settings = await resolveOrthancSettings();
  if (!settings.enabled) {
    return { enqueued: false, jobId: null, operation: null, reason: "orthanc_mwl_disabled" };
  }

  const client = await pool.connect();
  try {
    await client.query("begin");
    const snapshot = await loadBookingSyncSnapshot(client, bookingId);
    if (!snapshot) {
      await client.query("rollback");
      return { enqueued: false, jobId: null, operation: null, reason: "booking_not_found" };
    }

    let operation = deriveOperationFromStatus(snapshot.status);
    const currentProjectionExists = await hasCurrentOrthancProjection(client, bookingId);
    const eligibility = resolvedEligibility ?? await resolveMwlEligibilityForBooking(bookingId, client);
    if (operation === "upsert" && !eligibility.protocolGateSatisfied) {
      if (!currentProjectionExists) {
        await client.query("rollback");
        return { enqueued: false, jobId: null, operation: null, reason: "waiting_for_protocol" };
      }
      operation = "delete";
    }
    if (shouldSkipOrthancInitialUpsertForQueueGate({
      sendOnlyWhenPatientEntersQueue: settings.sendOnlyWhenPatientEntersQueue,
      currentProjectionExists,
      status: snapshot.status,
    })) {
      await client.query("rollback");
      return { enqueued: false, jobId: null, operation: null, reason: "waiting_for_patient_queue" };
    }

    const payloadHash = operation === "upsert" ? computePayloadHash(snapshot) : null;

    await client.query(
      `
        insert into external_mwl_sync (
          booking_id,
          external_system,
          sync_status,
          payload_hash,
          last_attempt_at,
          last_error,
          deleted_at,
          updated_at
        )
        values (
          $1::bigint,
          'orthanc',
          'pending',
          $2,
          null,
          null,
          case when $3 = 'delete' then now() else null end,
          now()
        )
        on conflict (booking_id, external_system)
        do update set
          sync_status = 'pending',
          payload_hash = excluded.payload_hash,
          last_error = null,
          deleted_at = case when $3 = 'delete' then now() else null end,
          updated_at = now()
      `,
      [bookingId, payloadHash, operation]
    );

    const existingJob = await client.query<{ id: number }>(
      `
        with mutable_job as (
          select id
          from external_mwl_outbox
          where booking_id = $1::bigint
            and external_system = 'orthanc'
            and status in ('pending', 'failed')
            and not exists (
              select 1
              from external_mwl_outbox newer
              where newer.booking_id = external_mwl_outbox.booking_id
                and newer.external_system = external_mwl_outbox.external_system
                and newer.id > external_mwl_outbox.id
            )
          order by id desc
          limit 1
          for update
        )
        update external_mwl_outbox outbox
        set
          operation = $2,
          status = 'pending',
          next_attempt_at = now(),
          locked_at = null,
          payload_hash = $3,
          last_error = null,
          updated_at = now()
        from mutable_job
        where outbox.id = mutable_job.id
        returning outbox.id
      `,
      [bookingId, operation, payloadHash]
    );

    let jobId: number;
    if (existingJob.rows[0]?.id) {
      jobId = Number(existingJob.rows[0].id);
    } else {
      const inserted = await client.query<{ id: number }>(
        `
          insert into external_mwl_outbox (
            booking_id,
            external_system,
            operation,
            status,
            attempt_count,
            next_attempt_at,
            payload_hash,
            created_at,
            updated_at
          )
          values ($1::bigint, 'orthanc', $2, 'pending', 0, now(), $3, now(), now())
          returning id
        `,
        [bookingId, operation, payloadHash]
      );
      jobId = Number(inserted.rows[0].id);
    }

    await client.query("commit");
    return {
      enqueued: true,
      jobId,
      operation,
      reason: operation === "delete" && eligibility.holdReason ? eligibility.holdReason : undefined,
    };
  } catch (error) {
    await client.query("rollback");
    throw error;
  } finally {
    client.release();
  }
}

export async function claimOrthancOutboxBatch(limit = 20): Promise<OrthancOutboxJob[]> {
  const size = Number.isInteger(limit) && limit > 0 ? limit : 20;
  const converted = await pool.query<{ booking_id: number }>(
    `
      update external_mwl_outbox outbox
      set operation = 'delete',
          payload_hash = null,
          last_error = null,
          updated_at = now()
      from appointments_v2.bookings b
      join modalities m on m.id = b.modality_id
      cross join lateral (select ${PROTOCOLING_MODALITY_SQL} as modality_code) protocoling_modality
      where outbox.booking_id = b.id
        and outbox.external_system = 'orthanc'
        and outbox.operation = 'upsert'
        and outbox.status in ('pending', 'failed')
        and not exists (
          select 1
          from external_mwl_outbox newer
          where newer.booking_id = outbox.booking_id
            and newer.external_system = outbox.external_system
            and newer.id > outbox.id
        )
        and b.status in ('scheduled', 'arrived', 'waiting')
        and protocoling_modality.modality_code in ('CT', 'MRI')
        and exists (
          select 1 from system_settings setting
          where setting.category = $1
            and setting.setting_key = $2
            and lower(nullif(trim(setting.setting_value ->> 'value'), '')) in ('enabled', 'true', '1', 'yes', 'on')
        )
        and not exists (
          select 1 from appointment_protocol_assignments assignment
          where assignment.appointment_id = b.id
            and assignment.status <> 'CANCELLED'
        )
      returning outbox.booking_id
    `,
    [MWL_POLICY_CATEGORY, REQUIRE_PROTOCOL_BEFORE_MWL_KEY]
  );
  if (converted.rows.length > 0) {
    await pool.query(
      `update external_mwl_sync
       set payload_hash=null, deleted_at=now(), updated_at=now()
       where external_system='orthanc' and booking_id=any($1::bigint[])`,
      [converted.rows.map((row) => Number(row.booking_id))]
    );
  }
  const { rows } = await pool.query<{
    id: number;
    booking_id: number;
    operation: OrthancMwlOperation;
    attempt_count: number;
    payload_hash: string | null;
  }>(
    `
      with candidates as (
        select candidate.id
        from external_mwl_outbox candidate
        where candidate.external_system = 'orthanc'
          and candidate.status in ('pending', 'failed')
          and candidate.next_attempt_at <= now()
          and not exists (
            select 1
            from external_mwl_outbox newer
            where newer.booking_id = candidate.booking_id
              and newer.external_system = candidate.external_system
              and newer.id > candidate.id
          )
          and not exists (
            select 1
            from external_mwl_outbox in_flight
            where in_flight.booking_id = candidate.booking_id
              and in_flight.external_system = candidate.external_system
              and in_flight.status = 'processing'
              and in_flight.id < candidate.id
          )
        order by candidate.next_attempt_at asc, candidate.id asc
        for update skip locked
        limit $1
      )
      update external_mwl_outbox o
      set
        status = 'processing',
        attempt_count = o.attempt_count + 1,
        locked_at = now(),
        updated_at = now()
      from candidates c
      where o.id = c.id
      returning
        o.id,
        o.booking_id,
        o.operation,
        o.attempt_count,
        o.payload_hash
    `,
    [size]
  );

  const jobs = rows.map((row) => ({
    id: Number(row.id),
    bookingId: Number(row.booking_id),
    operation: row.operation,
    attemptCount: Number(row.attempt_count),
    payloadHash: row.payload_hash,
  }));

  if (jobs.length > 0) {
    await pool.query(
      `
        with claimed(booking_id, job_id) as (
          select * from unnest($1::bigint[], $2::bigint[])
        )
        update external_mwl_sync sync
        set
          sync_status = 'in_progress',
          last_attempt_at = now(),
          updated_at = now()
        from claimed
        where sync.external_system = 'orthanc'
          and sync.booking_id = claimed.booking_id
          and not exists (
            select 1
            from external_mwl_outbox newer
            where newer.booking_id = claimed.booking_id
              and newer.external_system = 'orthanc'
              and newer.id > claimed.job_id
          )
      `,
      [jobs.map((job) => job.bookingId), jobs.map((job) => job.id)]
    );
  }

  return jobs;
}

export async function markOrthancOutboxSuccess(
  jobId: number,
  bookingId: number,
  operation: OrthancMwlOperation,
  externalWorklistId: string | null
): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query("begin");
    await client.query(
      `
        update external_mwl_outbox
        set
          status = 'completed',
          locked_at = null,
          last_error = null,
          updated_at = now()
        where id = $1
      `,
      [jobId]
    );

    await client.query(
      `
        update external_mwl_sync
        set
          sync_status = case when $2 = 'delete' then 'deleted' else 'synced' end,
          external_worklist_id = coalesce($3, external_worklist_id),
          last_synced_at = now(),
          last_attempt_at = now(),
          last_error = null,
          deleted_at = case when $2 = 'delete' then now() else null end,
          updated_at = now()
        where booking_id = $1::bigint
          and external_system = 'orthanc'
          and not exists (
            select 1
            from external_mwl_outbox newer
            where newer.booking_id = $1::bigint
              and newer.external_system = 'orthanc'
              and newer.id > $4
          )
      `,
      [bookingId, operation, externalWorklistId, jobId]
    );

    await client.query("commit");
  } catch (error) {
    await client.query("rollback");
    throw error;
  } finally {
    client.release();
  }
}

export async function markOrthancOutboxFailure(
  jobId: number,
  bookingId: number,
  errorMessage: string,
  retryDelaySeconds = 30
): Promise<void> {
  const safeRetrySeconds = Number.isFinite(retryDelaySeconds) && retryDelaySeconds > 0
    ? Math.floor(retryDelaySeconds)
    : 30;
  const client = await pool.connect();
  try {
    await client.query("begin");
    await client.query(
      `
        update external_mwl_outbox
        set
          status = 'failed',
          locked_at = null,
          last_error = $2,
          next_attempt_at = now() + ($3::text || ' seconds')::interval,
          updated_at = now()
        where id = $1
      `,
      [jobId, errorMessage, String(safeRetrySeconds)]
    );

    await client.query(
      `
        update external_mwl_sync
        set
          sync_status = 'failed',
          last_attempt_at = now(),
          last_error = $2,
          updated_at = now()
        where booking_id = $1::bigint
          and external_system = 'orthanc'
          and not exists (
            select 1
            from external_mwl_outbox newer
            where newer.booking_id = $1::bigint
              and newer.external_system = 'orthanc'
              and newer.id > $3
          )
      `,
      [bookingId, errorMessage, jobId]
    );

    await client.query("commit");
  } catch (error) {
    await client.query("rollback");
    throw error;
  } finally {
    client.release();
  }
}

export async function getOrthancSyncState(bookingId: number): Promise<OrthancSyncState | null> {
  const { rows } = await pool.query<{
    booking_id: number;
    external_worklist_id: string | null;
    sync_status: OrthancSyncState["syncStatus"];
    payload_hash: string | null;
  }>(
    `
      select
        booking_id,
        external_worklist_id,
        sync_status,
        payload_hash
      from external_mwl_sync
      where external_system = 'orthanc'
        and booking_id = $1::bigint
      limit 1
    `,
    [bookingId]
  );

  const row = rows[0];
  if (!row) return null;
  return {
    bookingId: Number(row.booking_id),
    externalWorklistId: row.external_worklist_id,
    syncStatus: row.sync_status,
    payloadHash: row.payload_hash,
  };
}
