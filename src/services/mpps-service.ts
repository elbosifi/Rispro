import * as crypto from "crypto";
import type { PoolClient } from "pg";
import { pool } from "../db/pool.js";
import { HttpError } from "../utils/http-error.js";
import { normalizeOptionalText } from "../utils/normalize.js";
import { logAuditEntry } from "./audit-service.js";
import { scheduleBookingWorklistSync } from "./dicom-service.js";
import {
  activatePendingReportingAssignmentIntent,
  cancelPendingReportingAssignmentIntent,
  type ReportingAssignmentActivationNotification,
} from "../modules/doctor-portal/reporting-assignment-intents-service.js";
import { createAssignedToMeNotifications } from "../modules/doctor-portal/reporting-board-repository.js";

export type MppsEventType = "n-create" | "n-set";
export type MppsCorrelationStatus = "matched" | "unmatched" | "ambiguous";
export type MppsProcessingStatus = "received" | "processed" | "ignored" | "failed";
export type BookingWorkflowStatus = "scheduled" | "arrived" | "waiting" | "completed" | "no-show" | "cancelled" | "discontinued" | "voided";

export interface IncomingMppsEventPayload {
  eventType?: unknown;
  sourceAeTitle?: unknown;
  patientId?: unknown;
  accessionNumber?: unknown;
  studyInstanceUid?: unknown;
  mppsInstanceUid?: unknown;
  performedStepStatus?: unknown;
  requestedProcedureId?: unknown;
  scheduledProcedureStepId?: unknown;
  modality?: unknown;
  scheduledStartDate?: unknown;
  scheduledStartTime?: unknown;
  performedStartDate?: unknown;
  performedStartTime?: unknown;
  performedEndDate?: unknown;
  performedEndTime?: unknown;
  discontinuationReason?: unknown;
  rawDatasetJson?: unknown;
}

export interface NormalizedMppsEvent {
  eventType: MppsEventType;
  sourceAeTitle: string;
  patientId: string;
  accessionNumber: string;
  studyInstanceUid: string;
  mppsInstanceUid: string;
  performedStepStatus: "IN PROGRESS" | "COMPLETED" | "DISCONTINUED" | "UNKNOWN";
  requestedProcedureId: string;
  scheduledProcedureStepId: string;
  modality: string;
  scheduledStartDate: string;
  scheduledStartTime: string;
  performedStartDate: string;
  performedStartTime: string;
  performedEndDate: string;
  performedEndTime: string;
  discontinuationReason: string;
  rawDatasetJson: Record<string, unknown>;
  dedupeKey: string;
}

export interface MppsIngestResult {
  eventId: number;
  deduplicated: boolean;
  correlatedAppointmentId: number | null;
  correlationStatus: MppsCorrelationStatus;
  processingStatus: MppsProcessingStatus;
  processingError: string | null;
  previousStatus: string | null;
  updatedStatus: string | null;
  dicomStatus: number;
  dicomErrorComment: string | null;
}

interface StoredMppsEventRow {
  id: number;
  correlation_status: MppsCorrelationStatus;
  processing_status: MppsProcessingStatus;
  processing_error: string | null;
  correlated_appointment_id: number | null;
}

interface BookingCandidateRow {
  id: number;
  status: BookingWorkflowStatus;
}

interface AcceptedMppsStateRow {
  id: number;
  performed_step_status: NormalizedMppsEvent["performedStepStatus"];
  correlated_appointment_id: number | null;
}

async function createAssignedToMeNotificationsForReportingIntent(
  notification: ReportingAssignmentActivationNotification | null
): Promise<void> {
  if (!notification) return;
  try {
    await createAssignedToMeNotifications({
      doctorId: notification.doctorId,
      appointmentIds: [notification.bookingId],
    });
  } catch (error) {
    console.warn(JSON.stringify({
      type: "reporting_assignment_intent_notification_failed",
      bookingId: notification.bookingId,
      doctorId: notification.doctorId,
      error: error instanceof Error ? error.message : String(error),
    }));
  }
}

function normalizeEventType(value: unknown): MppsEventType {
  const normalized = String(value || "").trim().toLowerCase();
  if (normalized === "n-create") return "n-create";
  if (normalized === "n-set") return "n-set";
  throw new HttpError(400, "eventType must be n-create or n-set.");
}

function normalizeStepStatus(value: unknown): NormalizedMppsEvent["performedStepStatus"] {
  const normalized = String(value || "")
    .trim()
    .toUpperCase()
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ");

  if (normalized === "IN PROGRESS") {
    return "IN PROGRESS";
  }
  if (normalized === "COMPLETED") {
    return "COMPLETED";
  }
  if (normalized === "DISCONTINUED") {
    return "DISCONTINUED";
  }
  return "UNKNOWN";
}

function normalizeDate(value: unknown): string {
  const normalized = String(value || "").trim().replace(/[^0-9]/g, "");
  return /^\d{8}$/.test(normalized) ? normalized : "";
}

function normalizeTime(value: unknown): string {
  const normalized = String(value || "").trim().replace(/[^0-9]/g, "");
  return normalized ? normalized.slice(0, 6).padEnd(6, "0") : "";
}

function normalizeModality(value: unknown): string {
  return String(value || "").trim().toUpperCase();
}

function normalizeRawDataset(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new HttpError(400, "rawDatasetJson must be an object.");
  }
  return value as Record<string, unknown>;
}

function buildDedupeKey(input: {
  eventType: MppsEventType;
  sourceAeTitle: string;
  mppsInstanceUid: string;
  accessionNumber: string;
  studyInstanceUid: string;
  patientId: string;
  performedStepStatus: string;
}): string {
  const stableInstance = input.mppsInstanceUid || [
    input.sourceAeTitle,
    input.accessionNumber,
    input.studyInstanceUid,
    input.patientId,
  ].join("|");

  return crypto
    .createHash("sha256")
    .update(`${input.eventType}|${stableInstance}|${input.performedStepStatus}`)
    .digest("hex");
}

export function normalizeIncomingMppsEvent(payload: IncomingMppsEventPayload): NormalizedMppsEvent {
  const eventType = normalizeEventType(payload.eventType);
  const sourceAeTitle = normalizeOptionalText(payload.sourceAeTitle).toUpperCase();
  const patientId = normalizeOptionalText(payload.patientId);
  const accessionNumber = normalizeOptionalText(payload.accessionNumber);
  const studyInstanceUid = normalizeOptionalText(payload.studyInstanceUid);
  const mppsInstanceUid = normalizeOptionalText(payload.mppsInstanceUid);
  const suppliedPerformedStepStatus = normalizeOptionalText(payload.performedStepStatus);
  const performedStepStatus = suppliedPerformedStepStatus
    ? normalizeStepStatus(suppliedPerformedStepStatus)
    : eventType === "n-set" ? "IN PROGRESS" : "UNKNOWN";
  const requestedProcedureId = normalizeOptionalText(payload.requestedProcedureId);
  const scheduledProcedureStepId = normalizeOptionalText(payload.scheduledProcedureStepId);
  const modality = normalizeModality(payload.modality);
  const scheduledStartDate = normalizeDate(payload.scheduledStartDate);
  const scheduledStartTime = normalizeTime(payload.scheduledStartTime);
  const performedStartDate = normalizeDate(payload.performedStartDate);
  const performedStartTime = normalizeTime(payload.performedStartTime);
  const performedEndDate = normalizeDate(payload.performedEndDate);
  const performedEndTime = normalizeTime(payload.performedEndTime);
  const discontinuationReason = normalizeOptionalText(payload.discontinuationReason);
  const rawDatasetJson = normalizeRawDataset(payload.rawDatasetJson);

  if (!sourceAeTitle) {
    throw new HttpError(400, "sourceAeTitle is required.");
  }

  if (!mppsInstanceUid && !accessionNumber && !studyInstanceUid && !patientId) {
    throw new HttpError(400, "At least one identifier is required for MPPS processing.");
  }

  return {
    eventType,
    sourceAeTitle,
    patientId,
    accessionNumber,
    studyInstanceUid,
    mppsInstanceUid,
    performedStepStatus,
    requestedProcedureId,
    scheduledProcedureStepId,
    modality,
    scheduledStartDate,
    scheduledStartTime,
    performedStartDate,
    performedStartTime,
    performedEndDate,
    performedEndTime,
    discontinuationReason,
    rawDatasetJson,
    dedupeKey: buildDedupeKey({
      eventType,
      sourceAeTitle,
      mppsInstanceUid,
      accessionNumber,
      studyInstanceUid,
      patientId,
      performedStepStatus,
    }),
  };
}

function parseBookingIdFromIdentifier(value: string): number | null {
  const trimmed = String(value || "").trim();
  const v2Match = trimmed.match(/^V2-(\d+)$/i);
  if (v2Match) {
    return Number(v2Match[1]);
  }
  return null;
}

async function findSingleBookingByIds(client: PoolClient, ids: number[]): Promise<number | null> {
  const uniqueIds = Array.from(new Set(ids.filter((id) => Number.isInteger(id) && id > 0)));
  if (uniqueIds.length === 0) return null;

  const { rows } = await client.query<{ id: number }>(
    `
      select id
      from appointments_v2.bookings
      where id = any($1::bigint[])
      limit 2
    `,
    [uniqueIds]
  );

  if (rows.length !== 1) {
    return null;
  }

  return Number(rows[0].id);
}

async function correlateByAccession(client: PoolClient, event: NormalizedMppsEvent): Promise<number | null> {
  const bookingId = parseBookingIdFromIdentifier(event.accessionNumber);
  if (!bookingId) return null;
  return findSingleBookingByIds(client, [bookingId]);
}

async function correlateByProcedureIdentifiers(client: PoolClient, event: NormalizedMppsEvent): Promise<number | null> {
  const candidateIds = [
    parseBookingIdFromIdentifier(event.requestedProcedureId),
    parseBookingIdFromIdentifier(event.scheduledProcedureStepId),
  ].filter((value): value is number => value != null);

  return findSingleBookingByIds(client, candidateIds);
}

async function correlateByStudyInstanceUid(client: PoolClient, event: NormalizedMppsEvent): Promise<number | null> {
  if (!event.studyInstanceUid) return null;

  const { rows } = await client.query<{ correlated_appointment_id: number }>(
    `
      select correlated_appointment_id
      from mpps_event_log
      where study_instance_uid = $1
        and correlation_status = 'matched'
        and correlated_appointment_id is not null
      order by id desc
      limit 2
    `,
    [event.studyInstanceUid]
  );

  const ids = Array.from(new Set(rows.map((row) => Number(row.correlated_appointment_id)).filter((id) => id > 0)));
  return ids.length === 1 ? ids[0] : null;
}

async function correlateByPatientModalityDateTime(
  client: PoolClient,
  event: NormalizedMppsEvent
): Promise<{ bookingId: number | null; ambiguous: boolean }> {
  const fallbackDate = event.performedStartDate || event.scheduledStartDate;
  if (!event.patientId || !fallbackDate) {
    return { bookingId: null, ambiguous: false };
  }

  const { rows } = await client.query<{ id: number }>(
    `
      with device_match as (
        select modality_id
        from dicom_devices
        where modality_ae_title = nullif($4, '')
           or scheduled_station_ae_title = nullif($4, '')
        order by id asc
        limit 1
      )
      select b.id
      from appointments_v2.bookings b
      join patients p on p.id = b.patient_id
      join modalities m on m.id = b.modality_id
      left join device_match dm on true
      where b.booking_date = to_date($2, 'YYYYMMDD')
        and (
          p.mrn = $1
          or p.national_id = $1
          or coalesce(p.identifier_value, '') = $1
        )
        and ($3 = '' or replace(coalesce(b.booking_time::text, ''), ':', '') like ($3 || '%'))
        and (
          $5 = ''
          or upper(coalesce(m.code, '')) = $5
          or (
            dm.modality_id is not null
            and b.modality_id = dm.modality_id
          )
        )
      order by b.id asc
      limit 2
    `,
    [event.patientId, fallbackDate, event.scheduledStartTime, event.sourceAeTitle, event.modality]
  );

  if (rows.length === 1) {
    return { bookingId: Number(rows[0].id), ambiguous: false };
  }

  return { bookingId: null, ambiguous: rows.length > 1 };
}

async function correlateMppsEvent(
  client: PoolClient,
  event: NormalizedMppsEvent
): Promise<{ status: MppsCorrelationStatus; bookingId: number | null; reason: string | null }> {
  const byAccession = await correlateByAccession(client, event);
  if (byAccession) {
    return { status: "matched", bookingId: byAccession, reason: null };
  }

  const byProcedure = await correlateByProcedureIdentifiers(client, event);
  if (byProcedure) {
    return { status: "matched", bookingId: byProcedure, reason: null };
  }

  const byStudy = await correlateByStudyInstanceUid(client, event);
  if (byStudy) {
    return { status: "matched", bookingId: byStudy, reason: null };
  }

  const byFallback = await correlateByPatientModalityDateTime(client, event);
  if (byFallback.bookingId) {
    return { status: "matched", bookingId: byFallback.bookingId, reason: null };
  }
  if (byFallback.ambiguous) {
    return { status: "ambiguous", bookingId: null, reason: "Ambiguous MPPS fallback correlation." };
  }

  return { status: "unmatched", bookingId: null, reason: "No confident MPPS correlation found." };
}

function mapMppsStatusToBookingStatus(status: NormalizedMppsEvent["performedStepStatus"]): BookingWorkflowStatus | null {
  if (status === "IN PROGRESS") return "waiting";
  if (status === "COMPLETED") return "completed";
  if (status === "DISCONTINUED") return "discontinued";
  return null;
}

function canTransitionBookingStatus(currentStatus: BookingWorkflowStatus, targetStatus: BookingWorkflowStatus): boolean {
  if (currentStatus === targetStatus) return true;

  switch (targetStatus) {
    case "waiting":
      return ["scheduled", "arrived", "waiting"].includes(currentStatus);
    case "completed":
      return ["scheduled", "arrived", "waiting", "completed"].includes(currentStatus);
    case "discontinued":
      return ["scheduled", "arrived", "waiting", "discontinued"].includes(currentStatus);
    default:
      return false;
  }
}

function acceptedResult(result: Omit<MppsIngestResult, "dicomStatus" | "dicomErrorComment">): MppsIngestResult {
  return { ...result, dicomStatus: 0x0000, dicomErrorComment: null };
}

function lifecycleRejectedResult(dicomStatus: number, dicomErrorComment: string): MppsIngestResult {
  return {
    eventId: 0,
    deduplicated: false,
    correlatedAppointmentId: null,
    correlationStatus: "unmatched",
    processingStatus: "ignored",
    processingError: dicomErrorComment,
    previousStatus: null,
    updatedStatus: null,
    dicomStatus,
    dicomErrorComment,
  };
}

async function findAcceptedMppsState(
  client: PoolClient,
  mppsInstanceUid: string,
  onlyCreate: boolean
): Promise<AcceptedMppsStateRow | null> {
  const result = await client.query<AcceptedMppsStateRow>(
    `
      select id, performed_step_status, correlated_appointment_id
      from mpps_event_log
      where mpps_instance_uid = $1
        and processing_status in ('processed', 'ignored')
        ${onlyCreate ? "and event_type = 'n-create'" : ""}
      order by id desc
      limit 1
    `,
    [mppsInstanceUid]
  );
  return result.rows[0] || null;
}

async function validateMppsLifecycle(
  client: PoolClient,
  event: NormalizedMppsEvent
): Promise<{ rejection: MppsIngestResult | null; priorState: AcceptedMppsStateRow | null }> {
  if (!event.mppsInstanceUid) {
    return {
      rejection: lifecycleRejectedResult(0x0106, "MPPS SOP Instance UID is required."),
      priorState: null,
    };
  }

  if (event.eventType === "n-create") {
    if (event.performedStepStatus !== "IN PROGRESS") {
      return {
        rejection: lifecycleRejectedResult(0x0106, "N-CREATE requires Performed Procedure Step Status IN PROGRESS."),
        priorState: null,
      };
    }
  } else if (event.performedStepStatus === "UNKNOWN") {
    return {
      rejection: lifecycleRejectedResult(0x0106, "Unsupported Performed Procedure Step Status."),
      priorState: null,
    };
  }

  await client.query("select pg_advisory_xact_lock(hashtext($1))", [event.mppsInstanceUid]);
  const priorState = await findAcceptedMppsState(client, event.mppsInstanceUid, event.eventType === "n-create");

  if (event.eventType === "n-create" && priorState) {
    return {
      rejection: lifecycleRejectedResult(0x0111, "Duplicate MPPS SOP Instance."),
      priorState,
    };
  }

  if (event.eventType === "n-set") {
    if (!priorState) {
      return {
        rejection: lifecycleRejectedResult(0x0112, "No accepted MPPS N-CREATE exists for this SOP Instance UID."),
        priorState: null,
      };
    }
    if (["COMPLETED", "DISCONTINUED"].includes(priorState.performed_step_status)) {
      return {
        rejection: lifecycleRejectedResult(0x0110, "MPPS instance is already final."),
        priorState,
      };
    }
  }

  return { rejection: null, priorState };
}

async function insertOrLoadMppsEvent(client: PoolClient, event: NormalizedMppsEvent): Promise<{ id: number; deduplicated: boolean }> {
  const insertResult = await client.query<{ id: number }>(
    `
      insert into mpps_event_log (
        dedupe_key,
        event_type,
        source_ae_title,
        patient_id,
        accession_number,
        study_instance_uid,
        mpps_instance_uid,
        performed_step_status,
        requested_procedure_id,
        scheduled_step_id,
        modality,
        scheduled_start_date,
        scheduled_start_time,
        performed_start_date,
        performed_start_time,
        performed_end_date,
        performed_end_time,
        discontinuation_reason,
        payload_json,
        correlation_status,
        processing_status,
        processing_error,
        received_at
      )
      values (
        $1, $2, $3, nullif($4, ''), nullif($5, ''), nullif($6, ''), nullif($7, ''), $8,
        nullif($9, ''), nullif($10, ''), nullif($11, ''), nullif($12, ''), nullif($13, ''),
        nullif($14, ''), nullif($15, ''), nullif($16, ''), nullif($17, ''), nullif($18, ''),
        $19::jsonb, 'unmatched', 'received', null, now()
      )
      on conflict (dedupe_key) do nothing
      returning id
    `,
    [
      event.dedupeKey,
      event.eventType,
      event.sourceAeTitle,
      event.patientId,
      event.accessionNumber,
      event.studyInstanceUid,
      event.mppsInstanceUid,
      event.performedStepStatus,
      event.requestedProcedureId,
      event.scheduledProcedureStepId,
      event.modality,
      event.scheduledStartDate,
      event.scheduledStartTime,
      event.performedStartDate,
      event.performedStartTime,
      event.performedEndDate,
      event.performedEndTime,
      event.discontinuationReason,
      JSON.stringify(event.rawDatasetJson),
    ]
  );

  if (insertResult.rows[0]?.id) {
    return { id: Number(insertResult.rows[0].id), deduplicated: false };
  }

  const existing = await client.query<{ id: number }>(
    `select id from mpps_event_log where dedupe_key = $1 limit 1`,
    [event.dedupeKey]
  );

  const existingId = existing.rows[0]?.id;
  if (!existingId) {
    throw new Error("Failed to load deduplicated MPPS event.");
  }

  await client.query(
    `
      update mpps_event_log
      set payload_json = $2::jsonb, received_at = now(), updated_at = now()
      where id = $1
    `,
    [existingId, JSON.stringify(event.rawDatasetJson)]
  );

  return { id: Number(existingId), deduplicated: true };
}

async function loadStoredEvent(client: PoolClient, eventId: number): Promise<StoredMppsEventRow> {
  const result = await client.query<StoredMppsEventRow>(
    `
      select id, correlation_status, processing_status, processing_error, correlated_appointment_id
      from mpps_event_log
      where id = $1
      limit 1
    `,
    [eventId]
  );

  if (!result.rows[0]) {
    throw new Error("Stored MPPS event not found.");
  }

  return result.rows[0];
}

async function markEventProcessed(
  client: PoolClient,
  eventId: number,
  patch: {
    correlatedAppointmentId?: number | null;
    correlationStatus: MppsCorrelationStatus;
    processingStatus: MppsProcessingStatus;
    processingError?: string | null;
  }
): Promise<void> {
  await client.query(
    `
      update mpps_event_log
      set
        correlated_appointment_id = $2,
        correlation_status = $3,
        processing_status = $4,
        processing_error = $5,
        updated_at = now()
      where id = $1
    `,
    [
      eventId,
      patch.correlatedAppointmentId ?? null,
      patch.correlationStatus,
      patch.processingStatus,
      patch.processingError ?? null,
    ]
  );
}

export async function ingestMppsEvent(payload: IncomingMppsEventPayload): Promise<MppsIngestResult> {
  const event = normalizeIncomingMppsEvent(payload);
  const insertClient = await pool.connect();
  let eventId: number | null = null;
  let deduplicated = false;
  let priorMppsState: AcceptedMppsStateRow | null = null;

  try {
    await insertClient.query("begin");
    const lifecycle = await validateMppsLifecycle(insertClient, event);
    priorMppsState = lifecycle.priorState;
    if (lifecycle.rejection) {
      await insertClient.query("commit");
      return lifecycle.rejection;
    }
    const stored = await insertOrLoadMppsEvent(insertClient, event);
    eventId = stored.id;
    deduplicated = stored.deduplicated;
    const existing = await loadStoredEvent(insertClient, stored.id);

    if (stored.deduplicated && ["processed", "ignored"].includes(existing.processing_status)) {
      await insertClient.query("commit");
      return acceptedResult({
        eventId: existing.id,
        deduplicated: true,
        correlatedAppointmentId: existing.correlated_appointment_id,
        correlationStatus: existing.correlation_status,
        processingStatus: existing.processing_status,
        processingError: existing.processing_error,
        previousStatus: null,
        updatedStatus: null,
      });
    }
    await insertClient.query("commit");
  } catch (error) {
    await insertClient.query("rollback");
    throw error;
  } finally {
    insertClient.release();
  }

  const client = await pool.connect();
  let reportingIntentNotification: ReportingAssignmentActivationNotification | null = null;
  try {
    await client.query("begin");
    const storedId = Number(eventId);
    const correlation = event.eventType === "n-set" && priorMppsState?.correlated_appointment_id
      ? { status: "matched" as const, bookingId: Number(priorMppsState.correlated_appointment_id), reason: null }
      : await correlateMppsEvent(client, event);
    if (correlation.status !== "matched" || !correlation.bookingId) {
      await markEventProcessed(client, storedId, {
        correlatedAppointmentId: null,
        correlationStatus: correlation.status,
        processingStatus: "ignored",
        processingError: correlation.reason,
      });
      await client.query("commit");
      return acceptedResult({
        eventId: storedId,
        deduplicated,
        correlatedAppointmentId: null,
        correlationStatus: correlation.status,
        processingStatus: "ignored",
        processingError: correlation.reason,
        previousStatus: null,
        updatedStatus: null,
      });
    }

    const bookingResult = await client.query<BookingCandidateRow>(
      `
        select id, status
        from appointments_v2.bookings
        where id = $1
        limit 1
        for update
      `,
      [correlation.bookingId]
    );

    const booking = bookingResult.rows[0];
    if (!booking) {
      await markEventProcessed(client, storedId, {
        correlatedAppointmentId: null,
        correlationStatus: "unmatched",
        processingStatus: "ignored",
        processingError: "Correlated booking no longer exists.",
      });
      await client.query("commit");
      return acceptedResult({
        eventId: storedId,
        deduplicated,
        correlatedAppointmentId: null,
        correlationStatus: "unmatched",
        processingStatus: "ignored",
        processingError: "Correlated booking no longer exists.",
        previousStatus: null,
        updatedStatus: null,
      });
    }

    const targetStatus = mapMppsStatusToBookingStatus(event.performedStepStatus);
    if (!targetStatus) {
      await markEventProcessed(client, storedId, {
        correlatedAppointmentId: booking.id,
        correlationStatus: "matched",
        processingStatus: "ignored",
        processingError: `Unsupported MPPS performed step status: ${event.performedStepStatus}`,
      });
      await client.query("commit");
      return acceptedResult({
        eventId: storedId,
        deduplicated,
        correlatedAppointmentId: booking.id,
        correlationStatus: "matched",
        processingStatus: "ignored",
        processingError: `Unsupported MPPS performed step status: ${event.performedStepStatus}`,
        previousStatus: booking.status,
        updatedStatus: null,
      });
    }

    if (!canTransitionBookingStatus(booking.status, targetStatus)) {
      const errorMessage = `Skipping MPPS status transition from ${booking.status} to ${targetStatus}.`;
      await markEventProcessed(client, storedId, {
        correlatedAppointmentId: booking.id,
        correlationStatus: "matched",
        processingStatus: "ignored",
        processingError: errorMessage,
      });
      await client.query("commit");
      return acceptedResult({
        eventId: storedId,
        deduplicated,
        correlatedAppointmentId: booking.id,
        correlationStatus: "matched",
        processingStatus: "ignored",
        processingError: errorMessage,
        previousStatus: booking.status,
        updatedStatus: null,
      });
    }

    if (booking.status !== targetStatus) {
      await client.query(
        `
          update appointments_v2.bookings
          set status = $2, updated_at = now(), updated_by_user_id = null
          where id = $1
        `,
        [booking.id, targetStatus]
      );

      await logAuditEntry(
        {
          entityType: "appointments_v2_booking",
          entityId: booking.id,
          actionType: "mpps_status_update",
          oldValues: { status: booking.status },
          newValues: {
            status: targetStatus,
            mppsPerformedStepStatus: event.performedStepStatus,
            accessionNumber: event.accessionNumber,
            studyInstanceUid: event.studyInstanceUid,
            mppsInstanceUid: event.mppsInstanceUid,
          },
          changedByUserId: null,
        },
        client
      );
      if (targetStatus === "completed") {
        reportingIntentNotification = await activatePendingReportingAssignmentIntent(client, booking.id, {
          actorUserId: null,
          actionType: "mpps_status_completion",
        });
      } else if (targetStatus === "discontinued") {
        await cancelPendingReportingAssignmentIntent(client, booking.id, {
          reason: "status_discontinued",
          actorUserId: null,
        });
      }
    }

    await markEventProcessed(client, storedId, {
      correlatedAppointmentId: booking.id,
      correlationStatus: "matched",
      processingStatus: "processed",
      processingError: null,
    });

    await client.query("commit");

    if (booking.status !== targetStatus) {
      scheduleBookingWorklistSync(booking.id);
    }
    await createAssignedToMeNotificationsForReportingIntent(reportingIntentNotification);

    return acceptedResult({
      eventId: storedId,
      deduplicated,
      correlatedAppointmentId: booking.id,
      correlationStatus: "matched",
      processingStatus: "processed",
      processingError: null,
      previousStatus: booking.status,
      updatedStatus: targetStatus,
    });
  } catch (error) {
    await client.query("rollback");
    if (eventId) {
      await pool.query(
        `
          update mpps_event_log
          set processing_status = 'failed', processing_error = $2, updated_at = now()
          where id = $1
        `,
        [eventId, error instanceof Error ? error.message : String(error)]
      ).catch(() => undefined);
    }
    throw error;
  } finally {
    client.release();
  }
}
