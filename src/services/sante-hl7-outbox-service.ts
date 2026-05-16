import fs from "fs/promises";
import path from "path";
import { randomUUID } from "crypto";
import type { PoolClient } from "pg";
import { pool } from "../db/pool.js";
import { HttpError } from "../utils/http-error.js";
import { logAuditEntry } from "./audit-service.js";
import {
  buildAccessionNumber,
  buildSanteOrmO01Message,
  buildSyntheticSanteTestProjection,
  type SanteHl7BookingProjection,
  type SanteOrderControl,
} from "./sante-hl7-message-builder.js";
import {
  resolveSanteWorklistSettings,
  testSanteOutputFolderAccess,
  type ResolvedSanteWorklistSettings,
} from "./sante-worklist-settings-resolver.js";
import {
  sendSanteMllpMessage,
  SanteMllpRetryableError,
  type SanteMllpSendResult,
} from "./sante-mllp-client.js";
import type { UserId } from "../types/http.js";

export type SanteOutboxStatus =
  | "pending"
  | "writing"
  | "written"
  | "pending_import"
  | "imported_assumed"
  | "imported_done"
  | "import_failed"
  | "pending_timeout"
  | "retry_scheduled"
  | "dead_letter"
  | "skipped"
  | "acknowledged"
  | "nack_received"
  | "send_failed";

export interface SanteOutboxJob {
  id: number;
  bookingId: number | null;
  eventType: "create" | "update" | "cancel" | "test";
  orderControl: SanteOrderControl;
  attemptCount: number;
  maxAttempts: number;
}

export interface SanteHl7Summary {
  outboxStatus: Array<{ status: string; count: number }>;
  recentFailures: Array<{
    id: number;
    bookingId: number | null;
    accessionNumber: string | null;
    status: string;
    attemptCount: number;
    lastError: string;
    updatedAt: string;
  }>;
  settings: {
    enabled: boolean;
    mode: string;
    deliveryMethod: string;
    sendOnlyWhenPatientEntersQueue: boolean;
    outputFolderPath: string;
    allowedBasePaths: string[];
    hostOutboxHint: string;
    windowsShareSourceHint: string;
    mllp: {
      host: string;
      port: number;
      timeoutSeconds: number;
      expectAck: boolean;
    };
  };
}

const ACTIVE_STATUSES = new Set(["scheduled", "arrived", "waiting"]);
const QUEUE_STATUSES = new Set(["arrived", "waiting"]);

async function loadBookingProjection(client: PoolClient, bookingId: number): Promise<SanteHl7BookingProjection | null> {
  const { rows } = await client.query<SanteHl7BookingProjection>(
    `
      select
        b.id,
        b.patient_id,
        p.identifier_value as patient_primary_id,
        p.mrn,
        p.national_id,
        p.phone_1,
        p.address,
        p.arabic_full_name,
        p.english_full_name,
        p.estimated_date_of_birth::text as estimated_date_of_birth,
        p.sex,
        m.code as modality_code,
        m.name_en as modality_name_en,
        m.name_ar as modality_name_ar,
        et.code as exam_type_code,
        et.name_en as exam_name_en,
        et.name_ar as exam_name_ar,
        ap.protocol_text,
        ap.contrast_required,
        ap.contrast_phase_or_protocol,
        b.booking_date::text as booking_date,
        b.booking_time::text as booking_time,
        b.status
      from appointments_v2.bookings b
      join patients p on p.id = b.patient_id
      join modalities m on m.id = b.modality_id
      left join exam_types et on et.id = b.exam_type_id
      left join doctor_portal.appointment_protocols ap on ap.appointment_id = b.id and ap.protocol_status = 'assigned'
      where b.id = $1::bigint
      limit 1
    `,
    [bookingId]
  );
  return rows[0] ?? null;
}

async function hasPreviousSanteSync(client: PoolClient, bookingId: number): Promise<boolean> {
  const { rows } = await client.query<{ exists: boolean }>(
    `select exists(select 1 from sante_worklist_sync where booking_id = $1::bigint and sync_status <> 'skipped')`,
    [bookingId]
  );
  return Boolean(rows[0]?.exists);
}

function deriveEvent(snapshot: SanteHl7BookingProjection, previousSyncExists: boolean): {
  eventType: "create" | "update" | "cancel";
  orderControl: SanteOrderControl;
  skipped: boolean;
} {
  if (ACTIVE_STATUSES.has(snapshot.status)) {
    return previousSyncExists
      ? { eventType: "update", orderControl: "XO", skipped: false }
      : { eventType: "create", orderControl: "NW", skipped: false };
  }
  return previousSyncExists
    ? { eventType: "cancel", orderControl: "CA", skipped: false }
    : { eventType: "cancel", orderControl: "CA", skipped: true };
}

function safeFileStem(input: {
  bookingId: number | null;
  accessionNumber: string;
  eventType: string;
  messageControlId: string;
}): string {
  const token = `${input.bookingId ?? "test"}-${input.accessionNumber}-${input.eventType}-${Date.now()}-${input.messageControlId}`;
  return token.replace(/[^a-zA-Z0-9._-]+/g, "_").slice(0, 180);
}

async function insertOutboxRow(input: {
  client: PoolClient;
  bookingId: number | null;
  projection: SanteHl7BookingProjection;
  eventType: "create" | "update" | "cancel" | "test";
  orderControl: SanteOrderControl;
  status: SanteOutboxStatus;
  settings: ResolvedSanteWorklistSettings;
  createdByUserId?: UserId | null;
}): Promise<{ id: number; skipped: boolean }> {
  const built = buildSanteOrmO01Message({
    booking: input.projection,
    orderControl: input.orderControl,
    settings: input.settings,
  });
  const fileStem = safeFileStem({
    bookingId: input.bookingId,
    accessionNumber: built.accessionNumber,
    eventType: input.eventType,
    messageControlId: built.messageControlId,
  });
  const inserted = await input.client.query<{ id: number }>(
    `
      insert into sante_hl7_outbox (
        booking_id,
        event_type,
        order_control,
        status,
        max_attempts,
        payload_hash,
        message_control_id,
        file_stem,
        final_extension,
        scheduled_date,
        modality_code,
        accession_number,
        created_by_user_id,
        created_at,
        updated_at
      )
      values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10::date, $11, $12, $13, now(), now())
      returning id
    `,
    [
      input.bookingId,
      input.eventType,
      input.orderControl,
      input.status,
      input.settings.retryMaxAttempts,
      built.payloadHash,
      built.messageControlId,
      fileStem,
      input.settings.fileExtension,
      input.projection.booking_date,
      input.projection.modality_code,
      built.accessionNumber,
      input.createdByUserId ?? null,
    ]
  );

  const id = Number(inserted.rows[0].id);
  if (input.bookingId != null) {
    await input.client.query(
      `
        insert into sante_worklist_sync (
          booking_id,
          sync_status,
          payload_hash,
          last_outbox_id,
          last_attempt_at,
          last_error,
          deleted_at,
          updated_at
        )
        values ($1::bigint, $2, $3, $4, null, null, case when $5 = 'cancel' then now() else null end, now())
        on conflict (booking_id)
        do update set
          sync_status = excluded.sync_status,
          payload_hash = excluded.payload_hash,
          last_outbox_id = excluded.last_outbox_id,
          last_error = null,
          deleted_at = excluded.deleted_at,
          updated_at = now()
      `,
      [input.bookingId, input.status === "skipped" ? "skipped" : "pending", built.payloadHash, id, input.eventType]
    );
  }

  return { id, skipped: input.status === "skipped" };
}

export async function enqueueSanteHl7ForBooking(bookingId: number): Promise<{ enqueued: boolean; jobId: number | null; reason?: string }> {
  const settings = await resolveSanteWorklistSettings();
  if (!settings.enabled || settings.mode === "disabled") {
    return { enqueued: false, jobId: null, reason: "sante_hl7_disabled" };
  }

  const client = await pool.connect();
  try {
    await client.query("begin");
    const projection = await loadBookingProjection(client, bookingId);
    if (!projection) {
      await client.query("rollback");
      return { enqueued: false, jobId: null, reason: "booking_not_found" };
    }
    const previousSyncExists = await hasPreviousSanteSync(client, bookingId);
    if (
      settings.sendOnlyWhenPatientEntersQueue &&
      !previousSyncExists &&
      ACTIVE_STATUSES.has(projection.status) &&
      !QUEUE_STATUSES.has(projection.status)
    ) {
      await client.query("rollback");
      return { enqueued: false, jobId: null, reason: "waiting_for_patient_queue" };
    }
    const event = deriveEvent(projection, previousSyncExists);
    const inserted = await insertOutboxRow({
      client,
      bookingId,
      projection,
      eventType: event.eventType,
      orderControl: event.orderControl,
      status: event.skipped ? "skipped" : "pending",
      settings,
    });
    await client.query("commit");
    return inserted.skipped
      ? { enqueued: false, jobId: inserted.id, reason: "inactive_without_previous_sante_sync" }
      : { enqueued: true, jobId: inserted.id };
  } catch (error) {
    await client.query("rollback");
    throw error;
  } finally {
    client.release();
  }
}

export async function enqueueSanteHl7ReplacementForBooking(bookingId: number): Promise<{
  enqueued: boolean;
  jobIds: number[];
  reason?: string;
}> {
  const settings = await resolveSanteWorklistSettings();
  if (!settings.enabled || settings.mode === "disabled") {
    return { enqueued: false, jobIds: [], reason: "sante_hl7_disabled" };
  }

  const client = await pool.connect();
  try {
    await client.query("begin");
    const projection = await loadBookingProjection(client, bookingId);
    if (!projection) {
      await client.query("rollback");
      return { enqueued: false, jobIds: [], reason: "booking_not_found" };
    }
    if (!QUEUE_STATUSES.has(projection.status)) {
      await client.query("rollback");
      return { enqueued: false, jobIds: [], reason: "booking_not_in_queue" };
    }

    const jobIds: number[] = [];
    if (await hasPreviousSanteSync(client, bookingId)) {
      const cancel = await insertOutboxRow({
        client,
        bookingId,
        projection,
        eventType: "cancel",
        orderControl: "CA",
        status: "pending",
        settings,
      });
      jobIds.push(cancel.id);
    }

    const create = await insertOutboxRow({
      client,
      bookingId,
      projection,
      eventType: "create",
      orderControl: "NW",
      status: "pending",
      settings,
    });
    jobIds.push(create.id);

    await client.query("commit");
    return { enqueued: true, jobIds };
  } catch (error) {
    await client.query("rollback");
    throw error;
  } finally {
    client.release();
  }
}

export async function claimSanteOutboxBatch(limit = 20): Promise<SanteOutboxJob[]> {
  const { rows } = await pool.query<{
    id: number;
    booking_id: number | null;
    event_type: SanteOutboxJob["eventType"];
    order_control: SanteOrderControl;
    attempt_count: number;
    max_attempts: number;
  }>(
    `
      with candidates as (
        select id
        from sante_hl7_outbox
        where status in ('pending', 'retry_scheduled')
          and next_attempt_at <= now()
        order by next_attempt_at asc, id asc
        for update skip locked
        limit $1
      )
      update sante_hl7_outbox o
      set status = 'writing',
          attempt_count = o.attempt_count + 1,
          locked_at = now(),
          updated_at = now()
      from candidates c
      where o.id = c.id
      returning o.id, o.booking_id, o.event_type, o.order_control, o.attempt_count, o.max_attempts
    `,
    [Math.max(1, limit)]
  );

  return rows.map((row) => ({
    id: Number(row.id),
    bookingId: row.booking_id == null ? null : Number(row.booking_id),
    eventType: row.event_type,
    orderControl: row.order_control,
    attemptCount: Number(row.attempt_count),
    maxAttempts: Number(row.max_attempts),
  }));
}

async function projectionForJob(job: SanteOutboxJob, client: PoolClient): Promise<SanteHl7BookingProjection> {
  if (job.eventType === "test" || job.bookingId == null) return buildSyntheticSanteTestProjection();
  const projection = await loadBookingProjection(client, job.bookingId);
  if (!projection) throw new Error(`Booking ${job.bookingId} not found for Sante HL7.`);
  return projection;
}

export async function writeSanteOutboxJob(job: SanteOutboxJob): Promise<void> {
  const settings = await resolveSanteWorklistSettings();
  const client = await pool.connect();
  try {
    const projection = await projectionForJob(job, client);
    const built = buildSanteOrmO01Message({
      booking: projection,
      orderControl: job.orderControl,
      settings,
    });
    if (settings.deliveryMethod === "mllp") {
      await sendSanteOutboxJobViaMllp(job, built, settings);
      return;
    }

    await writeSanteOutboxJobToFileDrop(job, built, settings);
  } catch (error) {
    const retryable = job.attemptCount < job.maxAttempts;
    await markSanteOutboxFailure(job, (error as Error).message || "sante_hl7_delivery_failed", retryable);
  } finally {
    client.release();
  }
}

async function writeSanteOutboxJobToFileDrop(
  job: SanteOutboxJob,
  built: ReturnType<typeof buildSanteOrmO01Message>,
  settings: ResolvedSanteWorklistSettings
): Promise<void> {
  await testSanteOutputFolderAccess(settings.outputFolderPath);
  const fileStem = safeFileStem({
    bookingId: job.bookingId,
    accessionNumber: built.accessionNumber,
    eventType: job.eventType,
    messageControlId: built.messageControlId,
  });
  const tmpPath = path.join(settings.outputFolderPath, `${fileStem}.tmp`);
  const targetPath = path.join(settings.outputFolderPath, `${fileStem}${settings.fileExtension}`);

  await fs.writeFile(tmpPath, built.message, "utf8");
  await fs.rename(tmpPath, targetPath);

  await pool.query(
    `
        update sante_hl7_outbox
        set status = 'pending_import',
            locked_at = null,
            last_error = null,
            payload_hash = $2,
            message_control_id = $3,
            file_stem = $4,
            final_extension = $5,
            tmp_path = $6,
            target_path = $7,
            observed_path = $7,
            last_file_state = 'exists',
            updated_at = now()
        where id = $1
      `,
    [job.id, built.payloadHash, built.messageControlId, fileStem, settings.fileExtension, tmpPath, targetPath]
  );

  if (job.bookingId != null) {
    await pool.query(
      `
          update sante_worklist_sync
          set sync_status = 'written',
              payload_hash = $2,
              last_outbox_id = $3,
              last_attempt_at = now(),
              last_error = null,
              updated_at = now()
          where booking_id = $1::bigint
        `,
      [job.bookingId, built.payloadHash, job.id]
    );
  }
}

async function markSanteOutboxAcknowledged(input: {
  job: SanteOutboxJob;
  built: ReturnType<typeof buildSanteOrmO01Message>;
  ack: SanteMllpSendResult;
}): Promise<void> {
  await pool.query(
    `
      update sante_hl7_outbox
      set status = 'acknowledged',
          locked_at = null,
          last_error = null,
          payload_hash = $2,
          message_control_id = $3,
          accession_number = $4,
          last_file_state = $5,
          updated_at = now()
      where id = $1
    `,
    [input.job.id, input.built.payloadHash, input.built.messageControlId, input.built.accessionNumber, input.ack.ackCode ? `mllp_ack_${input.ack.ackCode}` : "mllp_sent_no_ack_expected"]
  );
  if (input.job.bookingId != null) {
    await pool.query(
      `
        update sante_worklist_sync
        set sync_status = 'acknowledged',
            payload_hash = $2,
            last_outbox_id = $3,
            last_attempt_at = now(),
            last_success_at = now(),
            last_error = null,
            updated_at = now()
        where booking_id = $1::bigint
      `,
      [input.job.bookingId, input.built.payloadHash, input.job.id]
    );
  }
}

async function markSanteOutboxNack(input: {
  job: SanteOutboxJob;
  built: ReturnType<typeof buildSanteOrmO01Message>;
  ack: SanteMllpSendResult;
}): Promise<void> {
  const message = input.ack.error || `Sante MLLP negative ACK: ${input.ack.ackCode || "unknown"}`;
  await pool.query(
    `
      update sante_hl7_outbox
      set status = 'nack_received',
          locked_at = null,
          last_error = $2,
          payload_hash = $3,
          message_control_id = $4,
          accession_number = $5,
          last_file_state = $6,
          updated_at = now()
      where id = $1
    `,
    [input.job.id, message, input.built.payloadHash, input.built.messageControlId, input.built.accessionNumber, `mllp_nack_${input.ack.ackCode || "unknown"}`]
  );
  if (input.job.bookingId != null) {
    await pool.query(
      `
        update sante_worklist_sync
        set sync_status = 'nack_received',
            payload_hash = $2,
            last_outbox_id = $3,
            last_attempt_at = now(),
            last_error = $4,
            updated_at = now()
        where booking_id = $1::bigint
      `,
      [input.job.bookingId, input.built.payloadHash, input.job.id, message]
    );
  }
}

async function markSanteOutboxSendFailed(
  job: SanteOutboxJob,
  message: string,
  built: ReturnType<typeof buildSanteOrmO01Message>
): Promise<void> {
  await pool.query(
    `
      update sante_hl7_outbox
      set status = 'send_failed',
          locked_at = null,
          last_error = $2,
          payload_hash = $3,
          message_control_id = $4,
          accession_number = $5,
          last_file_state = 'mllp_send_failed',
          updated_at = now()
      where id = $1
    `,
    [job.id, message, built.payloadHash, built.messageControlId, built.accessionNumber]
  );
  if (job.bookingId != null) {
    await pool.query(
      `
        update sante_worklist_sync
        set sync_status = 'send_failed',
            payload_hash = $2,
            last_outbox_id = $3,
            last_attempt_at = now(),
            last_error = $4,
            updated_at = now()
        where booking_id = $1::bigint
      `,
      [job.bookingId, built.payloadHash, job.id, message]
    );
  }
}

async function sendSanteOutboxJobViaMllp(
  job: SanteOutboxJob,
  built: ReturnType<typeof buildSanteOrmO01Message>,
  settings: ResolvedSanteWorklistSettings
): Promise<void> {
  try {
    const ack = await sendSanteMllpMessage({
      host: settings.mllpHost,
      port: settings.mllpPort,
      timeoutSeconds: settings.mllpTimeoutSeconds,
      message: built.message,
      expectAck: settings.mllpExpectAck,
    });
    if (ack.acknowledged) {
      await markSanteOutboxAcknowledged({ job, built, ack });
      return;
    }
    await markSanteOutboxNack({ job, built, ack });
  } catch (error) {
    const message = error instanceof SanteMllpRetryableError
      ? error.message
      : (error as Error).message || "sante_hl7_mllp_send_failed";
    await markSanteOutboxSendFailed(job, message, built);
    await markSanteOutboxFailure(job, message, job.attemptCount < job.maxAttempts);
  }
}

export async function markSanteOutboxFailure(job: SanteOutboxJob, message: string, retryable: boolean): Promise<void> {
  const settings = await resolveSanteWorklistSettings().catch(() => null);
  const delaySeconds = settings
    ? Math.min(settings.retryMaxDelaySeconds, settings.retryInitialDelaySeconds * Math.pow(2, Math.max(0, job.attemptCount - 1)))
    : 300;
  const status: SanteOutboxStatus = retryable ? "retry_scheduled" : "dead_letter";
  await pool.query(
    `
      update sante_hl7_outbox
      set status = $2,
          locked_at = null,
          last_error = $3,
          next_attempt_at = now() + ($4::text || ' seconds')::interval,
          updated_at = now()
      where id = $1
    `,
    [job.id, status, message, String(delaySeconds)]
  );
  if (job.bookingId != null) {
    await pool.query(
      `
        update sante_worklist_sync
        set sync_status = $2,
            last_attempt_at = now(),
            last_error = $3,
            updated_at = now()
        where booking_id = $1::bigint
      `,
      [job.bookingId, status, message]
    );
  }
}

export async function monitorSantePendingImports(limit = 100): Promise<{ checked: number; updated: number }> {
  const settings = await resolveSanteWorklistSettings();
  if (settings.deliveryMethod !== "file_drop") return { checked: 0, updated: 0 };
  const { rows } = await pool.query<{
    id: number;
    booking_id: number | null;
    target_path: string | null;
    file_stem: string | null;
    final_extension: string;
    updated_at: string;
  }>(
    `
      select id, booking_id, target_path, file_stem, final_extension, updated_at::text as updated_at
      from sante_hl7_outbox
      where status = 'pending_import'
      order by updated_at asc
      limit $1
    `,
    [Math.max(1, limit)]
  );

  let updated = 0;
  for (const row of rows) {
    const targetPath = row.target_path || "";
    const base = row.file_stem && targetPath ? path.join(path.dirname(targetPath), row.file_stem) : "";
    const doneCandidates = base ? [`${base}.DON`, `${base}.don`] : [];
    const errCandidates = base ? settings.errorExtensions.map((ext) => `${base}${ext}`) : [];
    const targetExists = targetPath ? await fs.access(targetPath).then(() => true).catch(() => false) : false;
    const donePath = await firstExisting(doneCandidates);
    const errPath = await firstExisting(errCandidates);

    let status: SanteOutboxStatus | null = null;
    let observedPath: string | null = null;
    let fileState = "";
    let lastError: string | null = null;

    if (errPath) {
      status = "import_failed";
      observedPath = errPath;
      fileState = "error_file";
      lastError = "Sante created an error marker for this HL7 file.";
    } else if (donePath) {
      status = "imported_done";
      observedPath = donePath;
      fileState = "done_file";
    } else if (!targetExists) {
      status = "imported_assumed";
      observedPath = targetPath;
      fileState = "disappeared";
    } else {
      const ageMs = Date.now() - new Date(row.updated_at).getTime();
      if (ageMs > settings.pendingImportTimeoutSeconds * 1000) {
        status = "pending_timeout";
        observedPath = targetPath;
        fileState = "timeout_exists";
        lastError = "HL7 file still exists after the configured pending import timeout.";
      }
    }

    if (!status) continue;
    await pool.query(
      `
        update sante_hl7_outbox
        set status = $2,
            observed_path = $3,
            last_file_state = $4,
            last_error = $5,
            updated_at = now()
        where id = $1
      `,
      [row.id, status, observedPath, fileState, lastError]
    );
    if (row.booking_id != null) {
      await pool.query(
        `
          update sante_worklist_sync
          set sync_status = $2,
              last_success_at = case when $2 in ('imported_assumed', 'imported_done') then now() else last_success_at end,
              last_error = $3,
              updated_at = now()
          where booking_id = $1::bigint
        `,
        [row.booking_id, status, lastError]
      );
    }
    updated += 1;
  }

  return { checked: rows.length, updated };
}

async function firstExisting(paths: string[]): Promise<string | null> {
  for (const candidate of paths) {
    if (await fs.access(candidate).then(() => true).catch(() => false)) return candidate;
  }
  return null;
}

export async function sendSyntheticSanteTestFile(currentUserId: UserId): Promise<{ outboxId: number }> {
  const settings = await resolveSanteWorklistSettings();
  if (settings.deliveryMethod === "file_drop" && !settings.outputFolderPath) {
    throw new HttpError(400, "Sante output folder path is required.");
  }
  const client = await pool.connect();
  try {
    await client.query("begin");
    const inserted = await insertOutboxRow({
      client,
      bookingId: null,
      projection: buildSyntheticSanteTestProjection(),
      eventType: "test",
      orderControl: "NW",
      status: "pending",
      settings,
      createdByUserId: currentUserId,
    });
    await logAuditEntry({
      entityType: "integration",
      entityId: inserted.id,
      actionType: "sante_hl7_test_queued",
      oldValues: null,
      newValues: { outboxId: inserted.id, synthetic: true },
      changedByUserId: currentUserId,
    }, client);
    await client.query("commit");
    await writeSanteOutboxJob({
      id: inserted.id,
      bookingId: null,
      eventType: "test",
      orderControl: "NW",
      attemptCount: 0,
      maxAttempts: settings.retryMaxAttempts,
    });
    return { outboxId: inserted.id };
  } catch (error) {
    await client.query("rollback");
    throw error;
  } finally {
    client.release();
  }
}

export async function retrySanteOutbox(outboxId: number, currentUserId: UserId): Promise<{ ok: true; outboxId: number }> {
  const id = Number(outboxId);
  if (!Number.isInteger(id) || id <= 0) throw new HttpError(400, "outboxId must be a positive integer.");
  await pool.query(
    `
      update sante_hl7_outbox
      set status = 'retry_scheduled',
          next_attempt_at = now(),
          locked_at = null,
          target_path = null,
          tmp_path = null,
          observed_path = null,
          last_file_state = 'manual_retry_new_file',
          last_error = null,
          updated_at = now()
      where id = $1
    `,
    [id]
  );
  await logAuditEntry({
    entityType: "integration",
    entityId: id,
    actionType: "sante_hl7_retry_queued",
    oldValues: null,
    newValues: { outboxId: id, createsNewDeliveryAttempt: true },
    changedByUserId: currentUserId,
  });
  return { ok: true, outboxId: id };
}

export async function reconcileSanteHl7Window(input: {
  dateFrom: string;
  dateTo: string;
  modalityCode?: string;
  apply?: boolean;
  limit?: number;
}): Promise<{
  missing: number[];
  failed: number[];
  pendingTimeout: number[];
  repaired: number[];
}> {
  const limit = Number.isInteger(input.limit) && (input.limit as number) > 0 ? Number(input.limit) : 5000;
  const { rows } = await pool.query<{ id: number; sync_status: string | null }>(
    `
      select b.id, s.sync_status
      from appointments_v2.bookings b
      join modalities m on m.id = b.modality_id
      left join sante_worklist_sync s on s.booking_id = b.id
      where b.booking_date between $1::date and $2::date
        and b.status in ('scheduled', 'arrived', 'waiting')
        and ($3::text is null or m.code = $3)
      order by b.booking_date asc, b.id asc
      limit $4
    `,
    [input.dateFrom, input.dateTo, input.modalityCode || null, limit]
  );

  const missing = rows.filter((row) => !row.sync_status).map((row) => Number(row.id));
  const failed = rows
    .filter((row) => ["import_failed", "dead_letter", "nack_received", "send_failed"].includes(row.sync_status || ""))
    .map((row) => Number(row.id));
  const pendingTimeout = rows.filter((row) => row.sync_status === "pending_timeout").map((row) => Number(row.id));
  const repairCandidates = Array.from(new Set([...missing, ...failed, ...pendingTimeout]));
  const repaired: number[] = [];
  if (input.apply) {
    for (const bookingId of repairCandidates) {
      const result = await enqueueSanteHl7ForBooking(bookingId);
      if (result.enqueued) repaired.push(bookingId);
    }
  }

  return { missing, failed, pendingTimeout, repaired };
}

export async function forceResyncSanteHl7Window(input: {
  dateFrom: string;
  dateTo: string;
  modalityCode?: string;
  limit?: number;
  currentUserId: UserId;
}): Promise<{
  deletedOutboxCount: number;
  deletedSyncCount: number;
  selectedBookingIds: number[];
  enqueuedBookingIds: number[];
  skippedBookingIds: number[];
}> {
  const limit = Number.isInteger(input.limit) && (input.limit as number) > 0 ? Number(input.limit) : 5000;
  const client = await pool.connect();
  let selectedBookingIds: number[] = [];
  let deletedOutboxCount = 0;
  let deletedSyncCount = 0;

  try {
    await client.query("begin");
    const { rows } = await client.query<{ id: number }>(
      `
        select b.id
        from appointments_v2.bookings b
        join modalities m on m.id = b.modality_id
        where b.booking_date between $1::date and $2::date
          and b.status in ('scheduled', 'arrived', 'waiting')
          and ($3::text is null or m.code = $3)
        order by b.booking_date asc, b.id asc
        limit $4
      `,
      [input.dateFrom, input.dateTo, input.modalityCode || null, limit]
    );
    selectedBookingIds = rows.map((row) => Number(row.id));

    if (selectedBookingIds.length > 0) {
      const deletedSync = await client.query(
        `delete from sante_worklist_sync where booking_id = any($1::bigint[])`,
        [selectedBookingIds]
      );
      const deletedOutbox = await client.query(
        `delete from sante_hl7_outbox where booking_id = any($1::bigint[])`,
        [selectedBookingIds]
      );
      deletedSyncCount = deletedSync.rowCount ?? 0;
      deletedOutboxCount = deletedOutbox.rowCount ?? 0;
    }

    await logAuditEntry({
      entityType: "integration",
      entityId: null,
      actionType: "sante_hl7_force_resync_cleared",
      oldValues: null,
      newValues: {
        dateFrom: input.dateFrom,
        dateTo: input.dateTo,
        modalityCode: input.modalityCode || null,
        selectedBookingCount: selectedBookingIds.length,
        deletedOutboxCount,
        deletedSyncCount,
      },
      changedByUserId: input.currentUserId,
    }, client);
    await client.query("commit");
  } catch (error) {
    await client.query("rollback");
    throw error;
  } finally {
    client.release();
  }

  const enqueuedBookingIds: number[] = [];
  const skippedBookingIds: number[] = [];
  for (const bookingId of selectedBookingIds) {
    const result = await enqueueSanteHl7ForBooking(bookingId);
    if (result.enqueued) {
      enqueuedBookingIds.push(bookingId);
    } else {
      skippedBookingIds.push(bookingId);
    }
  }

  await logAuditEntry({
    entityType: "integration",
    entityId: null,
    actionType: "sante_hl7_force_resync_queued",
    oldValues: null,
    newValues: {
      dateFrom: input.dateFrom,
      dateTo: input.dateTo,
      modalityCode: input.modalityCode || null,
      selectedBookingCount: selectedBookingIds.length,
      enqueuedCount: enqueuedBookingIds.length,
      skippedCount: skippedBookingIds.length,
    },
    changedByUserId: input.currentUserId,
  });

  return {
    deletedOutboxCount,
    deletedSyncCount,
    selectedBookingIds,
    enqueuedBookingIds,
    skippedBookingIds,
  };
}

export async function getSanteHl7Summary(): Promise<SanteHl7Summary> {
  const settings = await resolveSanteWorklistSettings();
  const [statusResult, failuresResult] = await Promise.all([
    pool.query<{ status: string; count: string }>(
      `select status, count(*)::text as count from sante_hl7_outbox group by status order by status asc`
    ).catch(() => ({ rows: [] })),
    pool.query<{
      id: number;
      booking_id: number | null;
      accession_number: string | null;
      status: string;
      attempt_count: number;
      last_error: string | null;
      updated_at: string;
    }>(
      `
        select id, booking_id, accession_number, status, attempt_count, last_error, updated_at::text as updated_at
        from sante_hl7_outbox
        where status in ('import_failed', 'pending_timeout', 'retry_scheduled', 'dead_letter', 'nack_received', 'send_failed')
        order by updated_at desc
        limit 10
      `
    ).catch(() => ({ rows: [] })),
  ]);

  return {
    outboxStatus: statusResult.rows.map((row) => ({ status: row.status, count: Number(row.count) })),
    recentFailures: failuresResult.rows.map((row) => ({
      id: Number(row.id),
      bookingId: row.booking_id == null ? null : Number(row.booking_id),
      accessionNumber: row.accession_number,
      status: row.status,
      attemptCount: Number(row.attempt_count),
      lastError: row.last_error || "",
      updatedAt: row.updated_at,
    })),
    settings: {
      enabled: settings.enabled,
      mode: settings.mode,
      deliveryMethod: settings.deliveryMethod,
      sendOnlyWhenPatientEntersQueue: settings.sendOnlyWhenPatientEntersQueue,
      outputFolderPath: settings.outputFolderPath,
      allowedBasePaths: settings.allowedBasePaths,
      hostOutboxHint: settings.hostOutboxHint,
      windowsShareSourceHint: settings.windowsShareSourceHint,
      mllp: {
        host: settings.mllpHost,
        port: settings.mllpPort,
        timeoutSeconds: settings.mllpTimeoutSeconds,
        expectAck: settings.mllpExpectAck,
      },
    },
  };
}

export function createDetachedSanteMessageControlId(): string {
  return `RISPRO-${randomUUID()}`;
}
