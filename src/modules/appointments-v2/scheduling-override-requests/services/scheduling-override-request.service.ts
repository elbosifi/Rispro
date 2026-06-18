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
  safeNotifySchedulingOverrideApprovalFailed,
  safeNotifySchedulingOverrideApproved,
  safeNotifySchedulingOverrideCancelled,
  safeNotifySchedulingOverrideCreated,
  safeNotifySchedulingOverrideExpired,
  safeNotifySchedulingOverrideRejected,
} from "../../../../services/user-web-push-service.js";
import { getUserSchedulingOverridePermission } from "../../../../services/user-service.js";
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
import {
  getBookedCountsByCategoryForDate,
  getSpecialQuotaBookedCount,
} from "../../scheduler/repositories/capacity.repo.js";
import { loadCategoryDailyLimits, loadExamTypeSpecialQuotas } from "../../rules/repositories/policy-rules.repo.js";
import type {
  CreateSchedulingOverrideRequestInput,
  SchedulingOverrideDecisionContext,
  SchedulingOverrideRequestFilters,
  SchedulingOverrideRequestRow,
  SchedulingOverrideRequestType,
  SchedulingOverrideStoredPayload,
} from "../models/scheduling-override-request.js";

const DEFAULT_EXPIRY_HOURS = 72;
const HIGH_RISK_APPROVAL_NOTE_TYPES = new Set<SchedulingOverrideType>([
  "total_capacity_override",
  "closed_weekday_override",
]);

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
      ? client.query<{ id: number; displayName: string | null; username: string | null; role: string | null }>(
          `
            select id, nullif(full_name, '') as "displayName", username, role
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
      requesterRole: requester?.role ?? null,
    };
  });
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function decisionReasons(decision: unknown): Array<{ code: string; message?: string; ruleRef?: { type?: string; id?: number } }> {
  if (!isObject(decision) || !Array.isArray(decision.reasons)) return [];
  return decision.reasons.filter((reason): reason is { code: string; message?: string; ruleRef?: { type?: string; id?: number } } => {
    return isObject(reason) && typeof reason.code === "string";
  });
}

function policyVersionIdFromSnapshot(decision: unknown): number | null {
  if (!isObject(decision) || !isObject(decision.policyVersionRef)) return null;
  const id = Number(decision.policyVersionRef.versionId);
  return Number.isInteger(id) && id > 0 ? id : null;
}

function formatOverrideRuleLabel(request: SchedulingOverrideRequestRow, reasonMessage: string | null): string | null {
  const modality = request.modalityName || request.modalityCode || "modality";
  if (request.overrideType === "total_capacity_override") return `Total ${modality} capacity exceeded`;
  if (request.overrideType === "category_override") return `${modality} category capacity exceeded`;
  if (request.overrideType === "closed_weekday_override") return `${modality} is closed or disabled for this day`;
  if (request.overrideType === "exam_mix_override") return reasonMessage || "Exam mix quota exceeded";
  return reasonMessage;
}

function firstViolatedRule(request: SchedulingOverrideRequestRow): { label: string | null; type: string | null } {
  const reasons = decisionReasons(request.originalDecisionSnapshotJson);
  const reason = reasons.find((item) => {
    if (request.overrideType === "total_capacity_override") return item.code.includes("total_capacity") || item.code === "modality_daily_capacity_exhausted";
    if (request.overrideType === "category_override") return item.code.includes("category");
    if (request.overrideType === "closed_weekday_override") return item.code.includes("closed_weekday");
    if (request.overrideType === "exam_mix_override") return item.code.includes("exam_mix");
    return false;
  }) ?? reasons[0];
  return {
    label: formatOverrideRuleLabel(request, reason?.message ?? null),
    type: reason?.ruleRef?.type ?? request.overrideType,
  };
}

function approvalNoteRequiredFor(overrideType: SchedulingOverrideType): boolean {
  return HIGH_RISK_APPROVAL_NOTE_TYPES.has(overrideType);
}

function buildApprovalConsequenceText(
  request: SchedulingOverrideRequestRow,
  context: Pick<SchedulingOverrideDecisionContext, "totalCapacity" | "afterApprovalCapacity" | "overbookAmount">
): string | null {
  const modality = request.modalityName || request.modalityCode || "this modality";
  if (request.overrideType === "total_capacity_override") {
    const overbook = context.overbookAmount == null ? null : Math.max(0, context.overbookAmount);
    if (overbook != null && overbook > 0) {
      return `Approving this request will create this appointment even though ${modality} daily capacity is already full. This will overbook ${modality} by ${overbook} case${overbook === 1 ? "" : "s"}.`;
    }
    return `Approving this request will create this appointment using a total capacity override for ${modality}.`;
  }
  if (request.overrideType === "category_override") {
    return `Approving this request will create this appointment even though the requested category capacity is already full.`;
  }
  if (request.overrideType === "closed_weekday_override") {
    return `Approving this request will create this appointment on a disabled or closed scheduling day.`;
  }
  if (request.overrideType === "exam_mix_override") {
    return `Approving this request will create this appointment even though an exam mix quota is already full.`;
  }
  return null;
}

async function buildDecisionContext(
  client: PoolClient,
  request: SchedulingOverrideRequestRow
): Promise<SchedulingOverrideDecisionContext> {
  const policyVersionId = request.requestedPolicyVersionId ?? policyVersionIdFromSnapshot(request.originalDecisionSnapshotJson);
  const excludeBookingId = request.requestType === "reschedule_booking" ? Number(request.bookingId ?? 0) || null : null;
  const [counts, modality, patientCounts, sameDayRows] = await Promise.all([
    getBookedCountsByCategoryForDate(client, Number(request.modalityId), request.requestedBookingDate, excludeBookingId),
    client.query<{ dailyCapacity: number | null }>(
      `select daily_capacity as "dailyCapacity" from modalities where id = $1 limit 1`,
      [request.modalityId]
    ),
    client.query<{
      previousNoShowCount: number;
      previousCancelledCount: number;
      futureAppointmentCount: number;
    }>(
      `
        select
          greatest(coalesce(max(p.no_show_count), 0), count(b.id) filter (where b.status = 'no-show'))::int as "previousNoShowCount",
          count(b.id) filter (where b.status = 'cancelled')::int as "previousCancelledCount",
          count(b.id) filter (
            where b.status in ('scheduled', 'arrived', 'waiting')
              and (b.booking_date > current_date or (b.booking_date = current_date and coalesce(b.booking_time, '23:59'::time) >= current_time))
          )::int as "futureAppointmentCount"
        from patients p
        left join appointments_v2.bookings b on b.patient_id = p.id
        where p.id = $1
      `,
      [request.patientId]
    ),
    client.query<{
      id: number;
      patientDisplayName: string | null;
      examTypeName: string | null;
      bookingTime: string | null;
      status: string;
      caseCategory: string | null;
    }>(
      `
        select
          b.id,
          coalesce(nullif(p.english_full_name, ''), nullif(p.arabic_full_name, '')) as "patientDisplayName",
          coalesce(nullif(et.name_en, ''), nullif(et.name_ar, '')) as "examTypeName",
          b.booking_time::text as "bookingTime",
          b.status,
          b.case_category as "caseCategory"
        from appointments_v2.bookings b
        left join patients p on p.id = b.patient_id
        left join exam_types et on et.id = b.exam_type_id
        where b.modality_id = $1
          and b.booking_date = $2::date
          and b.status not in ('cancelled', 'discontinued', 'voided')
          and ($3::bigint is null or b.id <> $3::bigint)
        order by b.booking_time nulls last, b.id
        limit 5
      `,
      [request.modalityId, request.requestedBookingDate, excludeBookingId]
    ),
  ]);

  const totalCapacity = modality.rows[0]?.dailyCapacity == null ? null : Number(modality.rows[0].dailyCapacity);
  const afterApprovalCapacity = counts.total + 1;
  const overbookAmount = totalCapacity == null ? null : Math.max(0, afterApprovalCapacity - totalCapacity);
  const categoryLimits = policyVersionId
    ? await loadCategoryDailyLimits(client, policyVersionId, Number(request.modalityId))
    : [];
  const categoryBreakdown: SchedulingOverrideDecisionContext["categoryBreakdown"] = [
    {
      caseCategory: "oncology" as const,
      booked: counts.oncology,
      limit: categoryLimits.find((limit) => limit.caseCategory === "oncology")?.dailyLimit ?? null,
      remaining: null,
    },
    {
      caseCategory: "non_oncology" as const,
      booked: counts.nonOncology,
      limit: categoryLimits.find((limit) => limit.caseCategory === "non_oncology")?.dailyLimit ?? null,
      remaining: null,
    },
  ].map((item) => ({
    ...item,
    remaining: item.limit == null ? null : Math.max(0, item.limit - item.booked),
  }));

  let specialQuotaBreakdown: SchedulingOverrideDecisionContext["specialQuotaBreakdown"] = null;
  if (policyVersionId && request.examTypeId != null) {
    const specialQuotas = await loadExamTypeSpecialQuotas(client, policyVersionId);
    const quota = specialQuotas.find((row) => Number(row.examTypeId) === Number(request.examTypeId) && row.isActive);
    if (quota) {
      const consumed = await getSpecialQuotaBookedCount(client, {
        modalityId: Number(request.modalityId),
        bookingDate: request.requestedBookingDate,
        examTypeId: Number(request.examTypeId),
        excludeBookingId,
      });
      specialQuotaBreakdown = {
        examTypeId: Number(request.examTypeId),
        configured: Number(quota.dailyExtraSlots),
        consumed,
        remaining: Math.max(0, Number(quota.dailyExtraSlots) - consumed),
      };
    }
  }

  const violated = firstViolatedRule(request);
  const patientRow = patientCounts.rows[0];
  const contextBase = {
    totalCapacity,
    afterApprovalCapacity,
    overbookAmount,
  };

  return {
    violatedRuleLabel: violated.label,
    violatedRuleType: violated.type,
    currentCapacity: counts.total,
    totalCapacity,
    remainingCapacity: totalCapacity == null ? null : Math.max(0, totalCapacity - counts.total),
    afterApprovalCapacity,
    overbookAmount,
    modalityCapacityBreakdown: {
      modalityId: Number(request.modalityId),
      modalityName: request.modalityName ?? null,
      modalityCode: request.modalityCode ?? null,
      bookedTotal: counts.total,
      totalCapacity,
    },
    categoryBreakdown,
    specialQuotaBreakdown,
    sameDayAppointmentCount: counts.total,
    sameDayAppointmentSummary: sameDayRows.rows.map((row) => ({
      id: Number(row.id),
      patientDisplayName: row.patientDisplayName,
      examTypeName: row.examTypeName,
      bookingTime: row.bookingTime,
      status: row.status,
      caseCategory: row.caseCategory,
    })),
    patientPreviousNoShowCount: Number(patientRow?.previousNoShowCount ?? 0),
    patientPreviousCancelledCount: Number(patientRow?.previousCancelledCount ?? 0),
    patientFutureAppointmentCount: Number(patientRow?.futureAppointmentCount ?? 0),
    duplicateFutureAppointmentWarning: Number(patientRow?.futureAppointmentCount ?? 0) > 0
      ? "Patient already has future appointments. Review before approving a duplicate or unnecessary booking."
      : null,
    requester: {
      userId: Number(request.requesterUserId),
      name: request.requesterDisplayName ?? null,
      username: request.requesterUsername ?? null,
      role: request.requesterRole ?? null,
    },
    submittedAt: request.createdAt,
    requestAgeMinutes: Number.isFinite(new Date(request.createdAt).getTime())
      ? Math.max(0, Math.floor((Date.now() - new Date(request.createdAt).getTime()) / 60000))
      : null,
    approvalNoteRequired: approvalNoteRequiredFor(request.overrideType),
    approvalConsequenceText: buildApprovalConsequenceText(request, contextBase),
  };
}

async function hydrateRequestDecisionContexts(
  client: PoolClient,
  requests: SchedulingOverrideRequestRow[]
): Promise<SchedulingOverrideRequestRow[]> {
  return Promise.all(requests.map(async (request) => ({
    ...request,
    decisionContext: await buildDecisionContext(client, request),
  })));
}

async function hydrateRequestDisplayName(
  client: PoolClient,
  request: SchedulingOverrideRequestRow
): Promise<SchedulingOverrideRequestRow> {
  return (await hydrateRequestDisplayNames(client, [request]))[0] ?? request;
}

async function hydrateRequestForResponse(
  client: PoolClient,
  request: SchedulingOverrideRequestRow
): Promise<SchedulingOverrideRequestRow> {
  return (await hydrateRequestDecisionContexts(client, [await hydrateRequestDisplayName(client, request)]))[0];
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

async function canReceptionistCreateOverrideRequest(client: PoolClient, userId: number): Promise<boolean> {
  return (await canReceptionRequestOverrideFromAvailability(client)) && await getUserSchedulingOverridePermission(userId);
}

function canApproveOverride(role: Role | undefined, overrideType: SchedulingOverrideType): boolean {
  if (role === "super_admin") return true;
  if (role !== "supervisor") return false;
  return overrideType === "closed_weekday_override" || overrideType === "category_override" || overrideType === "exam_mix_override";
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
  const examMix = codes.has("exam_mix_quota_exhausted");

  if ([closed, total, category, examMix].filter(Boolean).length > 1) {
    throw new SchedulingError(
      409,
      "Multiple separate override types are required. Create separate requests after resolving the first blocker.",
      ["multiple_override_types_required"],
      { decision }
    );
  }
  if (total) return "total_capacity_override";
  if (category) return "category_override";
  if (examMix) return "exam_mix_override";
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

  const created = await withTransaction(async (client) => {
    if (role === "receptionist" && !(await canReceptionistCreateOverrideRequest(client, userId))) {
      throw new SchedulingError(403, "This reception user is not allowed to request scheduling override approval.", ["override_requests_disabled"]);
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
    return hydrateRequestForResponse(client, request);
  }, { isolationLevel: "serializable", operationName: "create_scheduling_override_request" });
  safeNotifySchedulingOverrideCreated(created);
  return created;
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
    return hydrateRequestDecisionContexts(client, await hydrateRequestDisplayNames(client, requests));
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
    return (await hydrateRequestDecisionContexts(client, [await hydrateRequestDisplayName(client, request)]))[0];
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
    if (approvalNoteRequiredFor(request.overrideType) && !approverReason?.trim()) {
      throw new SchedulingError(400, "Approval note is required for this override type.", ["approval_note_required"]);
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
        null,
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
    safeNotifySchedulingOverrideApprovalFailed(result.request, approverUserId);
    throw new SchedulingError(
      409,
      result.request.failureMessage ?? "The current scheduling state has changed. This request could not be approved.",
      [result.request.failureCode ?? "override_approval_failed"],
      result
    );
  }
  if (result.request.status === "expired") {
    safeNotifySchedulingOverrideExpired(result.request);
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

  safeNotifySchedulingOverrideApproved(result.request);
  return result;
}

export async function rejectSchedulingOverrideRequest(
  id: number,
  approverUserId: number,
  role: Role | undefined,
  approverReason: string
): Promise<SchedulingOverrideRequestRow> {
  if (!approverReason.trim()) throw new SchedulingError(400, "Approver reason is required.", ["approver_reason_required"]);
  const rejected = await withTransaction(async (client) => {
    const request = await lockSchedulingOverrideRequestById(client, id);
    if (!request) throw new SchedulingError(404, "Scheduling override request not found.", ["override_request_not_found"]);
    assertPending(request);
    if (!canApproveOverride(role, request.overrideType)) {
      throw new SchedulingError(403, "You do not have permission to reject this override type.", ["override_rejection_forbidden"]);
    }
    return hydrateRequestDisplayName(client, await markSchedulingOverrideRequestRejected(client, id, approverUserId, approverReason.trim()));
  }, { isolationLevel: "serializable", operationName: "reject_scheduling_override_request" });
  safeNotifySchedulingOverrideRejected(rejected);
  return rejected;
}

export async function cancelSchedulingOverrideRequest(
  id: number,
  userId: number,
  role: Role | undefined
): Promise<SchedulingOverrideRequestRow> {
  const cancelled = await withTransaction(async (client) => {
    const request = await lockSchedulingOverrideRequestById(client, id);
    if (!request) throw new SchedulingError(404, "Scheduling override request not found.", ["override_request_not_found"]);
    assertPending(request);
    const canCancel = Number(request.requesterUserId) === userId || canSeeAll(role);
    if (!canCancel) throw new SchedulingError(403, "You do not have permission to cancel this request.", ["override_cancel_forbidden"]);
    return hydrateRequestDisplayName(client, await markSchedulingOverrideRequestCancelled(client, id, canSeeAll(role) ? userId : null));
  }, { isolationLevel: "serializable", operationName: "cancel_scheduling_override_request" });
  safeNotifySchedulingOverrideCancelled(cancelled, userId);
  return cancelled;
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
    if (!["closed_weekday_override", "category_override", "exam_mix_override", "total_capacity_override"].includes(overrideType)) {
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
