import { createHash } from "crypto";
import type { PoolClient } from "pg";
import { pool } from "../db/pool.js";
import { resolveOrthancSettings } from "./orthanc-settings-resolver.js";

export type OrthancMwlOperation = "upsert" | "delete";

type BookingStatus = "scheduled" | "arrived" | "waiting" | "completed" | "no-show" | "cancelled";

interface BookingSyncSnapshot {
  id: number;
  patient_id: number;
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

async function loadBookingSyncSnapshot(
  client: PoolClient,
  bookingId: number
): Promise<BookingSyncSnapshot | null> {
  const { rows } = await client.query<BookingSyncSnapshot>(
    `
      select
        b.id,
        b.patient_id,
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

function computePayloadHash(snapshot: BookingSyncSnapshot | null): string | null {
  if (!snapshot) return null;
  const payload = {
    bookingId: snapshot.id,
    patientId: snapshot.patient_id,
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

export async function enqueueOrthancSyncForBooking(bookingId: number): Promise<OrthancSyncEnqueueResult> {
  if (!(await isOrthancMwlEnabled())) {
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

    const operation = deriveOperationFromStatus(snapshot.status);
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
          $1,
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
        update external_mwl_outbox
        set
          operation = $2,
          status = 'pending',
          next_attempt_at = now(),
          locked_at = null,
          payload_hash = $3,
          last_error = null,
          updated_at = now()
        where booking_id = $1::bigint
          and external_system = 'orthanc'
          and status in ('pending', 'processing', 'failed')
        returning id
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
          values ($1, 'orthanc', $2, 'pending', 0, now(), $3, now(), now())
          returning id
        `,
        [bookingId, operation, payloadHash]
      );
      jobId = Number(inserted.rows[0].id);
    }

    await client.query("commit");
    return { enqueued: true, jobId, operation };
  } catch (error) {
    await client.query("rollback");
    throw error;
  } finally {
    client.release();
  }
}

export async function claimOrthancOutboxBatch(limit = 20): Promise<OrthancOutboxJob[]> {
  const size = Number.isInteger(limit) && limit > 0 ? limit : 20;
  const { rows } = await pool.query<{
    id: number;
    booking_id: number;
    operation: OrthancMwlOperation;
    attempt_count: number;
    payload_hash: string | null;
  }>(
    `
      with candidates as (
        select id
        from external_mwl_outbox
        where external_system = 'orthanc'
          and status in ('pending', 'failed')
          and next_attempt_at <= now()
        order by next_attempt_at asc, id asc
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
    const bookingIds = jobs.map((j) => j.bookingId);
    await pool.query(
      `
        update external_mwl_sync
        set
          sync_status = 'in_progress',
          last_attempt_at = now(),
          updated_at = now()
        where external_system = 'orthanc'
          and booking_id = any($1::bigint[])
      `,
      [bookingIds]
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
          sync_status = case when $3 = 'delete' then 'deleted' else 'synced' end,
          external_worklist_id = coalesce($4, external_worklist_id),
          last_synced_at = now(),
          last_attempt_at = now(),
          last_error = null,
          deleted_at = case when $3 = 'delete' then now() else null end,
          updated_at = now()
        where booking_id = $2
          and external_system = 'orthanc'
      `,
      [jobId, bookingId, operation, externalWorklistId]
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
      `,
      [bookingId, errorMessage]
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
