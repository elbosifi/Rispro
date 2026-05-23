import { pool } from "../../../../db/pool.js";
import type { PoolClient } from "pg";
import { SchedulingError } from "../../shared/errors/scheduling-error.js";
import type { CapacityResolutionMode, SchedulingOverrideType } from "../../shared/types/common.js";
import type { Role } from "../../../../types/domain.js";
import { withTransaction } from "../../shared/utils/transactions.js";
import { evaluateWithDb } from "../../rules/services/evaluate-with-db.js";
import type { BookingDecision } from "../../rules/models/booking-decision.js";
import type { CreateAppointmentDto, UpdateAppointmentDto } from "../../api/dto/appointment.dto.js";
import { findBookingById } from "../../booking/repositories/booking.repo.js";
import { createBookingInternal } from "../../booking/services/create-booking.service.js";
import { rescheduleBookingInternal } from "../../booking/services/reschedule-booking.service.js";
import { scheduleBookingWorklistSync, scheduleBookingWorklistDetailReplacement } from "../../../../services/dicom-service.js";
import { safeEnqueuePatientNotificationEvent } from "../../../../services/patient-web-push-service.js";
import {
  findSchedulingOverrideRequestById,
  insertSchedulingOverrideRequest,
  isSchedulingOverrideRequestStatus,
  listSchedulingOverrideRequests,
  lockSchedulingOverrideRequestById,
  markSchedulingOverrideRequestApproved,
  markSchedulingOverrideRequestCancelled,
  markSchedulingOverrideRequestExpired,
  markSchedulingOverrideRequestFailed,
  markSchedulingOverrideRequestRejected,
} from "../repositories/scheduling-override-request.repo.js";
import type {
  CreateSchedulingOverrideRequestInput,
  SchedulingOverrideRequestFilters,
  SchedulingOverrideRequestRow,
  SchedulingOverrideRequestType,
  SchedulingOverrideStoredPayload,
} from "../models/scheduling-override-request.js";

const DEFAULT_EXPIRY_HOURS = 72;

interface RescheduleNotificationInfo {
  previousDate: string;
  previousTime: string | null;
  newDate: string;
  newTime: string | null;
}

async function hydrateRequestDisplayNames(
  client: PoolClient,
  requests: SchedulingOverrideRequestRow[]
): Promise<SchedulingOverrideRequestRow[]> {
  if (requests.length === 0) return requests;
  const patientIds = [...new Set(requests.map((request) => Number(request.patientId)).filter((id) => id > 0))];
  const modalityIds = [...new Set(requests.map((request) => Number(request.modalityId)).filter((id) => id > 0))];
  const examTypeIds = [...new Set(requests.map((request) => Number(request.examTypeId)).filter((id) => id > 0))];
  const userIds = [...new Set(requests.flatMap((request) => [request.requesterUserId, request.approverUserId]).map(Number).filter((id) => id > 0))];

  const [patients, modalities, examTypes, users] = await Promise.all([
    patientIds.length
      ? client.query<{
          id: number;
          displayName: string | null;
          identifier: string | null;
        }>(
          `
            select id,
                   coalesce(nullif(english_full_name, ''), nullif(arabic_full_name, '')) as "displayName",
                   coalesce(nullif(identifier_value, ''), nullif(national_id, ''), mrn) as identifier
            from patients
            where id = any($1::bigint[])
          `,
          [patientIds]
        )
      : Promise.resolve({ rows: [] }),
    modalityIds.length
      ? client.query<{ id: number; name: string | null; code: string | null }>(
          `
            select id, coalesce(nullif(name_en, ''), nullif(name_ar, '')) as name, code
            from modalities
            where id = any($1::bigint[])
          `,
          [modalityIds]
        )
      : Promise.resolve({ rows: [] }),
    examTypeIds.length
      ? client.query<{ id: number; name: string | null }>(
          `
            select id, coalesce(nullif(name_en, ''), nullif(name_ar, '')) as name
            from exam_types
            where id = any($1::bigint[])
          `,
          [examTypeIds]
        )
      : Promise.resolve({ rows: [] }),
    userIds.length
      ? client.query<{ id: number; displayName: string | null; username: string | null }>(
          `
            select id, nullif(full_name, '') as "displayName", username
            from users
            where id = any($1::bigint[])
          `,
          [userIds]
        )
      : Promise.resolve({ rows: [] }),
  ]);

  const patientById = new Map(patients.rows.map((row) => [Number(row.id), row]));
  const modalityById = new Map(modalities.rows.map((row) => [Number(row.id), row]));
  const examTypeById = new Map(examTypes.rows.map((row) => [Number(row.id), row]));
  const userById = new Map(users.rows.map((row) => [Number(row.id), row]));

  return requests.map((request) => {
    const patient = patientById.get(Number(request.patientId));
    const modality = modalityById.get(Number(request.modalityId));
    const examType = request.examTypeId == null ? null : examTypeById.get(Number(request.examTypeId));
    const requester = userById.get(Number(request.requesterUserId));
    const approver = request.approverUserId == null ? null : userById.get(Number(request.approverUserId));
    return {
      ...request,
      patientDisplayName: patient?.displayName ?? null,
      patientIdentifier: patient?.identifier ?? null,
      modalityName: modality?.name ?? null,
      modalityCode: modality?.code ?? null,
      examTypeName: examType?.name ?? null,
      requesterDisplayName: requester?.displayName ?? null,
      requesterUsername: requester?.username ?? null,
      approverDisplayName: approver?.displayName ?? null,
      approverUsername: approver?.username ?? null,
    };
  });
}

async function hydrateRequestDisplayName(
  client: PoolClient,
  request: SchedulingOverrideRequestRow
): Promise<SchedulingOverrideRequestRow> {
  return (await hydrateRequestDisplayNames(client, [request]))[0] ?? request;
}

function assertKnownRole(role: Role | undefined): Role {
  if (!role) throw new SchedulingError(401, "Authentication required.", ["authentication_required"]);
  return role;
}

function canCreateRequest(role: Role | undefined): boolean {
  return role === "receptionist" || role === "supervisor" || role === "super_admin";
}

async function canReceptionRequestOverrideFromAvailability(client: PoolClient): Promise<boolean> {
  const result = await client.query<{ value: string | null }>(
    `
      select setting_value->>'value' as value
      from system_settings
      where category = 'scheduling_and_capacity'
        and setting_key = 'allow_reception_override_requests_from_availability'
      limit 1
    `
  );
  return String(result.rows[0]?.value ?? "enabled").trim().toLowerCase() !== "disabled";
}

function canApproveOverride(role: Role | undefined, overrideType: SchedulingOverrideType): boolean {
  if (role === "super_admin") return true;
  if (role !== "supervisor") return false;
  return overrideType === "closed_weekday_override" || overrideType === "category_override";
}

function canSeeAll(role: Role | undefined): boolean {
  return role === "supervisor" || role === "super_admin";
}

function assertVisible(request: SchedulingOverrideRequestRow, userId: number, role: Role | undefined): void {
  if (canSeeAll(role)) return;
  if (Number(request.requesterUserId) === userId) return;
  throw new SchedulingError(404, "Scheduling override request not found.", ["override_request_not_found"]);
}

function getString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function getNumber(value: unknown): number | null {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

function normalizeRequestType(value: unknown): SchedulingOverrideRequestType {
  if (value === "create_booking" || value === "reschedule_booking") return value;
  throw new SchedulingError(400, "Invalid scheduling override request type.", ["invalid_request_type"]);
}

function normalizePolicySetKey(payload: Record<string, unknown>): string {
  return getString(payload.policySetKey) || "default";
}

function normalizeCreatePayload(payload: Record<string, unknown>): CreateAppointmentDto {
  const patientId = getNumber(payload.patientId);
  const modalityId = getNumber(payload.modalityId);
  const bookingDate = getString(payload.bookingDate);
  if (!patientId || !modalityId || !bookingDate) {
    throw new SchedulingError(400, "patientId, modalityId, and bookingDate are required.", ["invalid_request_payload"]);
  }
  const caseCategory = payload.caseCategory === "oncology" ? "oncology" : "non_oncology";
  return {
    patientId,
    modalityId,
    examTypeId: getNumber(payload.examTypeId),
    reportingPriorityId: getNumber(payload.reportingPriorityId),
    bookingDate,
    bookingTime: getString(payload.bookingTime) || null,
    caseCategory,
    requiresReport: typeof payload.requiresReport === "boolean" ? payload.requiresReport : undefined,
    studyInstanceUid: getString(payload.studyInstanceUid) || null,
    capacityResolutionMode: "standard",
    useSpecialQuota: false,
    specialReasonCode: null,
    specialReasonNote: null,
    notes: getString(payload.notes) || null,
    isWalkIn: payload.isWalkIn === true,
    policySetKey: normalizePolicySetKey(payload),
  };
}

function normalizeReschedulePayload(payload: Record<string, unknown>): UpdateAppointmentDto {
  const bookingDate = getString(payload.bookingDate);
  return {
    bookingDate: bookingDate || undefined,
    bookingTime: payload.bookingTime === null ? null : getString(payload.bookingTime) || undefined,
    examTypeId: payload.examTypeId === null ? null : getNumber(payload.examTypeId),
    reportingPriorityId: payload.reportingPriorityId === null ? null : getNumber(payload.reportingPriorityId),
    notes: payload.notes === null ? null : getString(payload.notes) || undefined,
    requiresReport: typeof payload.requiresReport === "boolean" ? payload.requiresReport : undefined,
    studyInstanceUid: payload.studyInstanceUid === null ? null : getString(payload.studyInstanceUid) || undefined,
    capacityResolutionMode: "standard",
    useSpecialQuota: false,
    specialReasonCode: null,
    specialReasonNote: null,
    rescheduleReason: getString(payload.rescheduleReason) || null,
    policySetKey: normalizePolicySetKey(payload),
  };
}

function inferRequiredOverrideType(decision: BookingDecision): SchedulingOverrideType | null {
  const codes = new Set(decision.reasons.map((reason) => reason.code));
  const closed =
    codes.has("closed_weekday_override_required") ||
    codes.has("closed_weekday_override_forbidden");
  const total =
    codes.has("total_capacity_override_required") ||
    codes.has("total_capacity_override_forbidden") ||
    codes.has("modality_daily_capacity_exhausted");
  const category =
    codes.has("category_override_required") ||
    codes.has("category_override_forbidden") ||
    codes.has("category_capacity_exhausted");

  if (closed && (total || category)) {
    throw new SchedulingError(
      409,
      "Multiple separate override types are required. Create separate requests after resolving the first blocker.",
      ["multiple_override_types_required"],
      { decision }
    );
  }
  if (total) return "total_capacity_override";
  if (category) return "category_override";
  if (closed) return "closed_weekday_override";
  return null;
}

function capacityModeForOverride(overrideType: SchedulingOverrideType): CapacityResolutionMode {
  if (overrideType === "category_override") return "category_override";
  if (overrideType === "total_capacity_override") return "total_capacity_override";
  return "standard";
}

async function inferApprovalOverrideTypeOrFail(
  client: PoolClient,
  requestId: number,
  approverUserId: number,
  decision: BookingDecision
): Promise<{ requiredOverrideType: SchedulingOverrideType | null; failedRequest?: SchedulingOverrideRequestRow }> {
  let requiredOverrideType: SchedulingOverrideType | null;
  try {
    requiredOverrideType = inferRequiredOverrideType(decision);
  } catch (error) {
    const failed = await markSchedulingOverrideRequestFailed(client, requestId, {
      approverUserId,
      failureCode: "multiple_override_types_required",
      failureMessage: "The current scheduling state has changed. A different or stronger override is now required.",
      approvalDecisionSnapshot: decision,
    });
    return { requiredOverrideType: null, failedRequest: failed };
  }
  if (!requiredOverrideType && !decision.isAllowed) {
    const failed = await markSchedulingOverrideRequestFailed(client, requestId, {
      approverUserId,
      failureCode: "unsupported_current_blocker",
      failureMessage: "The current scheduling state has changed and is no longer covered by this override request.",
      approvalDecisionSnapshot: decision,
    });
    return { requiredOverrideType: null, failedRequest: failed };
  }
  return { requiredOverrideType };
}

function policyVersionId(decision: BookingDecision): number | null {
  const id = Number(decision.policyVersionRef?.versionId ?? 0);
  return Number.isInteger(id) && id > 0 ? id : null;
}

async function evaluateCreatePayload(client: PoolClient, payload: CreateAppointmentDto): Promise<BookingDecision> {
  return evaluateWithDb(client, {
    patientId: payload.patientId,
    modalityId: payload.modalityId,
    examTypeId: payload.examTypeId ?? null,
    scheduledDate: payload.bookingDate,
    caseCategory: payload.caseCategory ?? "non_oncology",
    capacityResolutionMode: "standard",
    useSpecialQuota: false,
    specialReasonCode: null,
    includeOverrideEvaluation: true,
    requesterRole: "receptionist",
  }, payload.policySetKey ?? "default");
}

async function evaluateReschedulePayload(
  client: PoolClient,
  bookingId: number,
  payload: UpdateAppointmentDto
): Promise<{ decision: BookingDecision; patientId: number; modalityId: number; examTypeId: number | null; bookingDate: string; bookingTime: string | null }> {
  const booking = await findBookingById(client, bookingId);
  if (!booking) throw new SchedulingError(404, "Booking not found.", ["booking_not_found"]);
  const bookingDate = payload.bookingDate ?? booking.bookingDate;
  const examTypeId = payload.examTypeId === undefined ? booking.examTypeId : payload.examTypeId;
  const bookingTime = payload.bookingTime === undefined ? booking.bookingTime : payload.bookingTime;
  const decision = await evaluateWithDb(client, {
    patientId: booking.patientId,
    modalityId: booking.modalityId,
    examTypeId,
    scheduledDate: bookingDate,
    caseCategory: booking.caseCategory,
    capacityResolutionMode: "standard",
    useSpecialQuota: false,
    specialReasonCode: null,
    includeOverrideEvaluation: true,
    requesterRole: "receptionist",
  }, payload.policySetKey ?? "default");
  return { decision, patientId: booking.patientId, modalityId: booking.modalityId, examTypeId, bookingDate, bookingTime };
}

export async function createSchedulingOverrideRequest(
  input: CreateSchedulingOverrideRequestInput,
  userId: number,
  role: Role | undefined
): Promise<SchedulingOverrideRequestRow> {
  if (!canCreateRequest(role)) {
    throw new SchedulingError(403, "You do not have permission to request scheduling override approval.", ["override_request_forbidden"]);
  }
  const requesterReason = input.requesterReason.trim();
  if (!requesterReason) {
    throw new SchedulingError(400, "Requester reason is required.", ["requester_reason_required"]);
  }

  return withTransaction(async (client) => {
    if (role === "receptionist" && !(await canReceptionRequestOverrideFromAvailability(client))) {
      throw new SchedulingError(403, "Reception override requests are disabled in settings.", ["override_requests_disabled"]);
    }

    const requestType = normalizeRequestType(input.requestType);
    const rawPayload = input.requestPayload ?? {};
    const payloadRecord = typeof rawPayload === "object" && rawPayload !== null && !Array.isArray(rawPayload)
      ? rawPayload as Record<string, unknown>
      : {};

    let storedPayload: SchedulingOverrideStoredPayload;
    let decision: BookingDecision;
    let patientId: number;
    let modalityId: number;
    let examTypeId: number | null;
    let requestedBookingDate: string;
    let requestedBookingTime: string | null;
    let bookingId: number | null = null;

    if (requestType === "create_booking") {
      const createPayload = normalizeCreatePayload(payloadRecord);
      decision = await evaluateCreatePayload(client, createPayload);
      patientId = createPayload.patientId;
      modalityId = createPayload.modalityId;
      examTypeId = createPayload.examTypeId ?? null;
      requestedBookingDate = createPayload.bookingDate;
      requestedBookingTime = createPayload.bookingTime ?? null;
      storedPayload = {
        version: 1,
        requestType,
        policySetKey: createPayload.policySetKey ?? "default",
        bookingId: null,
        createPayload,
      };
    } else {
      bookingId = input.bookingId ?? getNumber(payloadRecord.bookingId);
      if (!bookingId) throw new SchedulingError(400, "bookingId is required for reschedule requests.", ["booking_id_required"]);
      const reschedulePayload = normalizeReschedulePayload(payloadRecord);
      const evaluated = await evaluateReschedulePayload(client, bookingId, reschedulePayload);
      decision = evaluated.decision;
      patientId = evaluated.patientId;
      modalityId = evaluated.modalityId;
      examTypeId = evaluated.examTypeId;
      requestedBookingDate = evaluated.bookingDate;
      requestedBookingTime = evaluated.bookingTime;
      storedPayload = {
        version: 1,
        requestType,
        policySetKey: reschedulePayload.policySetKey ?? "default",
        bookingId,
        reschedulePayload,
      };
    }

    const overrideType = inferRequiredOverrideType(decision);
    if (!overrideType) {
      throw new SchedulingError(409, "No supported scheduling override is required for this request.", ["override_not_required"], { decision });
    }

    const expiresAt = new Date(Date.now() + DEFAULT_EXPIRY_HOURS * 60 * 60 * 1000);
    const request = await insertSchedulingOverrideRequest(client, {
      requestType,
      overrideType,
      requesterUserId: userId,
      patientId,
      modalityId,
      examTypeId,
      requestedBookingDate,
      requestedBookingTime,
      bookingId,
      requestedPolicyVersionId: policyVersionId(decision),
      requestPayload: storedPayload,
      originalDecisionSnapshot: decision,
      requesterReason,
      expiresAt,
      createdFromContext: input.createdFromContext ?? null,
    });
    return hydrateRequestDisplayName(client, request);
  }, { isolationLevel: "serializable", operationName: "create_scheduling_override_request" });
}

export async function listSchedulingOverrideRequestsForUser(
  filters: SchedulingOverrideRequestFilters,
  userId: number,
  role: Role | undefined
): Promise<SchedulingOverrideRequestRow[]> {
  const client = await pool.connect();
  try {
    const requests = await listSchedulingOverrideRequests(client, filters, {
      requesterUserId: canSeeAll(role) ? null : userId,
    });
    return hydrateRequestDisplayNames(client, requests);
  } finally {
    client.release();
  }
}

export async function getSchedulingOverrideRequestForUser(
  id: number,
  userId: number,
  role: Role | undefined
): Promise<SchedulingOverrideRequestRow> {
  const client = await pool.connect();
  try {
    const request = await findSchedulingOverrideRequestById(client, id);
    if (!request) throw new SchedulingError(404, "Scheduling override request not found.", ["override_request_not_found"]);
    assertVisible(request, userId, role);
    return hydrateRequestDisplayName(client, request);
  } finally {
    client.release();
  }
}

function assertPending(request: SchedulingOverrideRequestRow): void {
  if (request.status !== "pending") {
    throw new SchedulingError(409, "This request is no longer pending.", ["override_request_not_pending"]);
  }
}

function isExpired(request: SchedulingOverrideRequestRow): boolean {
  return new Date(request.expiresAt).getTime() <= Date.now();
}

export async function approveSchedulingOverrideRequest(
  id: number,
  approverUserId: number,
  approverRole: Role | undefined,
  approverReason: string | null
): Promise<{ request: SchedulingOverrideRequestRow; booking?: unknown }> {
  const role = assertKnownRole(approverRole);
  let createdOrUpdatedBookingId: number | null = null;
  let rescheduleNotification: RescheduleNotificationInfo | null = null;

  const result = await withTransaction(async (client) => {
    const request = await lockSchedulingOverrideRequestById(client, id);
    if (!request) throw new SchedulingError(404, "Scheduling override request not found.", ["override_request_not_found"]);
    assertPending(request);
    if (isExpired(request)) {
      const expired = await hydrateRequestDisplayName(client, await markSchedulingOverrideRequestExpired(client, id));
      return { request: expired };
    }
    if (!canApproveOverride(role, request.overrideType)) {
      throw new SchedulingError(403, "You do not have permission to approve this override type.", ["override_approval_forbidden"]);
    }

    const payload = request.requestPayloadJson;
    if (payload.version !== 1 || payload.requestType !== request.requestType) {
      throw new SchedulingError(400, "Stored override request payload is invalid.", ["invalid_stored_request_payload"]);
    }

    const approvalReason = approverReason?.trim() || `Deferred scheduling override request #${request.id} approved.`;
    let decision: BookingDecision;
    let booking: unknown;
    let requiredOverrideType: SchedulingOverrideType | null;

    if (request.requestType === "create_booking") {
      if (!payload.createPayload) throw new SchedulingError(400, "Stored create request payload is invalid.", ["invalid_stored_request_payload"]);
      decision = await evaluateCreatePayload(client, payload.createPayload);
      const inferred = await inferApprovalOverrideTypeOrFail(client, id, approverUserId, decision);
      if (inferred.failedRequest) return { request: await hydrateRequestDisplayName(client, inferred.failedRequest) };
      requiredOverrideType = inferred.requiredOverrideType;
      if (requiredOverrideType && requiredOverrideType !== request.overrideType) {
        const failed = await markSchedulingOverrideRequestFailed(client, id, {
          approverUserId,
          failureCode: "override_type_changed",
          failureMessage: "The current scheduling state has changed. A different or stronger override is now required.",
          approvalDecisionSnapshot: decision,
        });
        return { request: await hydrateRequestDisplayName(client, failed) };
      }
      const capacityResolutionMode = requiredOverrideType ? capacityModeForOverride(request.overrideType) : "standard";
      const createPayload: CreateAppointmentDto = {
        ...payload.createPayload,
        capacityResolutionMode,
        useSpecialQuota: false,
        specialReasonCode: null,
        specialReasonNote: null,
      };
      const bookingResult = await createBookingInternal(
        client,
        createPayload,
        approverUserId,
        role,
        payload.policySetKey,
        requiredOverrideType
          ? { requesterUserId: Number(request.requesterUserId), approverUserId, approverRole: role, overrideType: request.overrideType, reason: approvalReason, source: "deferred_approval", requestId: request.id }
          : undefined
      );
      booking = bookingResult.booking;
      createdOrUpdatedBookingId = bookingResult.booking.id;
    } else {
      if (!payload.reschedulePayload || !payload.bookingId) {
        throw new SchedulingError(400, "Stored reschedule request payload is invalid.", ["invalid_stored_request_payload"]);
      }
      const evaluated = await evaluateReschedulePayload(client, payload.bookingId, payload.reschedulePayload);
      decision = evaluated.decision;
      const inferred = await inferApprovalOverrideTypeOrFail(client, id, approverUserId, decision);
      if (inferred.failedRequest) return { request: await hydrateRequestDisplayName(client, inferred.failedRequest) };
      requiredOverrideType = inferred.requiredOverrideType;
      if (requiredOverrideType && requiredOverrideType !== request.overrideType) {
        const failed = await markSchedulingOverrideRequestFailed(client, id, {
          approverUserId,
          failureCode: "override_type_changed",
          failureMessage: "The current scheduling state has changed. A different or stronger override is now required.",
          approvalDecisionSnapshot: decision,
        });
        return { request: await hydrateRequestDisplayName(client, failed) };
      }
      const capacityResolutionMode = requiredOverrideType ? capacityModeForOverride(request.overrideType) : undefined;
      const reschedule = payload.reschedulePayload;
      const rescheduleResult = await rescheduleBookingInternal(
        client,
        payload.bookingId,
        reschedule.bookingDate ?? null,
        reschedule.bookingTime,
        reschedule.examTypeId ?? null,
        reschedule.reportingPriorityId ?? null,
        reschedule.notes ?? null,
        approverUserId,
        role,
        undefined,
        capacityResolutionMode,
        null,
        null,
        reschedule.rescheduleReason ?? approvalReason,
        reschedule.requiresReport,
        reschedule.studyInstanceUid ?? undefined,
        payload.policySetKey,
        requiredOverrideType
          ? { requesterUserId: Number(request.requesterUserId), approverUserId, approverRole: role, overrideType: request.overrideType, reason: approvalReason, source: "deferred_approval", requestId: request.id }
          : undefined
      );
      booking = rescheduleResult.booking;
      createdOrUpdatedBookingId = rescheduleResult.booking.id;
      rescheduleNotification = {
        previousDate: rescheduleResult.previousDate,
        previousTime: rescheduleResult.previousTime,
        newDate: rescheduleResult.booking.bookingDate,
        newTime: rescheduleResult.booking.bookingTime,
      };
    }

    const approved = await markSchedulingOverrideRequestApproved(client, id, {
      approverUserId,
      approverReason: approverReason?.trim() || null,
      approvedPolicyVersionId: policyVersionId(decision),
      approvalDecisionSnapshot: decision,
    });
    return { request: await hydrateRequestDisplayName(client, approved), booking };
  }, { isolationLevel: "serializable", operationName: "approve_scheduling_override_request" });

  if (result.request.status === "failed") {
    throw new SchedulingError(
      409,
      result.request.failureMessage ?? "The current scheduling state has changed. This request could not be approved.",
      [result.request.failureCode ?? "override_approval_failed"],
      result
    );
  }
  if (result.request.status === "expired") {
    throw new SchedulingError(409, "This request has expired.", ["override_request_expired"], result);
  }

  if (createdOrUpdatedBookingId != null) {
    if (result.request.requestType === "create_booking") {
      scheduleBookingWorklistSync(createdOrUpdatedBookingId);
    } else {
      scheduleBookingWorklistDetailReplacement(createdOrUpdatedBookingId);
      const notification = rescheduleNotification as RescheduleNotificationInfo | null;
      if (notification) {
        void safeEnqueuePatientNotificationEvent({
          bookingId: createdOrUpdatedBookingId,
          eventType: "appointment_rescheduled",
          dedupeSuffix: `${notification.previousDate}:${notification.previousTime ?? ""}->${notification.newDate}:${notification.newTime ?? ""}`,
        });
      }
    }
  }

  return result;
}

export async function rejectSchedulingOverrideRequest(
  id: number,
  approverUserId: number,
  role: Role | undefined,
  approverReason: string
): Promise<SchedulingOverrideRequestRow> {
  if (!approverReason.trim()) throw new SchedulingError(400, "Approver reason is required.", ["approver_reason_required"]);
  return withTransaction(async (client) => {
    const request = await lockSchedulingOverrideRequestById(client, id);
    if (!request) throw new SchedulingError(404, "Scheduling override request not found.", ["override_request_not_found"]);
    assertPending(request);
    if (!canApproveOverride(role, request.overrideType)) {
      throw new SchedulingError(403, "You do not have permission to reject this override type.", ["override_rejection_forbidden"]);
    }
    return hydrateRequestDisplayName(client, await markSchedulingOverrideRequestRejected(client, id, approverUserId, approverReason.trim()));
  }, { isolationLevel: "serializable", operationName: "reject_scheduling_override_request" });
}

export async function cancelSchedulingOverrideRequest(
  id: number,
  userId: number,
  role: Role | undefined
): Promise<SchedulingOverrideRequestRow> {
  return withTransaction(async (client) => {
    const request = await lockSchedulingOverrideRequestById(client, id);
    if (!request) throw new SchedulingError(404, "Scheduling override request not found.", ["override_request_not_found"]);
    assertPending(request);
    const canCancel = Number(request.requesterUserId) === userId || canSeeAll(role);
    if (!canCancel) throw new SchedulingError(403, "You do not have permission to cancel this request.", ["override_cancel_forbidden"]);
    return hydrateRequestDisplayName(client, await markSchedulingOverrideRequestCancelled(client, id, canSeeAll(role) ? userId : null));
  }, { isolationLevel: "serializable", operationName: "cancel_scheduling_override_request" });
}

export function parseSchedulingOverrideRequestFilters(query: Record<string, unknown>): SchedulingOverrideRequestFilters {
  const filters: SchedulingOverrideRequestFilters = {};
  const status = getString(query.status);
  if (status) {
    if (!isSchedulingOverrideRequestStatus(status)) throw new SchedulingError(400, "Invalid status filter.", ["invalid_status"]);
    filters.status = status;
  }
  const requestType = getString(query.request_type || query.requestType);
  if (requestType) filters.requestType = normalizeRequestType(requestType);
  const overrideType = getString(query.override_type || query.overrideType);
  if (overrideType) {
    if (!["closed_weekday_override", "category_override", "total_capacity_override"].includes(overrideType)) {
      throw new SchedulingError(400, "Invalid override type filter.", ["invalid_override_type"]);
    }
    filters.overrideType = overrideType as SchedulingOverrideType;
  }
  const modalityId = getNumber(query.modality_id || query.modalityId);
  if (modalityId) filters.modalityId = modalityId;
  const requestedBookingDate = getString(query.requested_booking_date || query.requestedBookingDate);
  if (requestedBookingDate) filters.requestedBookingDate = requestedBookingDate;
  return filters;
}
