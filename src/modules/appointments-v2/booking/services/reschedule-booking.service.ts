/**
 * Appointments V2 — Reschedule booking service.
 *
 * Transactional: finds booking → acquires new bucket lock (if date changed)
 * → re-evaluates → updates existing booking row (stable ID)
 * → records override + reschedule audit events.
 */

import type { PoolClient } from "pg";
import { withTransaction } from "../../shared/utils/transactions.js";
import { SchedulingError } from "../../shared/errors/scheduling-error.js";
import { pureEvaluate } from "../../rules/services/pure-evaluate.js";
import type { PureEvaluateInput, RuleEvaluationContext } from "../../rules/models/rule-evaluation-context.js";
import { findPublishedPolicyVersion } from "../../rules/repositories/policy-version.repo.js";
import {
  loadModalityBlockedRules,
  loadExamTypeRules,
  loadCategoryDailyLimits,
  loadSpecialQuotaRules,
  loadExamTypeRuleItemExamTypeIds,
  loadExamTypeRuleItems,
  loadExamMixQuotaRules,
  loadExamMixQuotaRuleItems,
} from "../../rules/repositories/policy-rules.repo.js";
import {
  getBookedCountForDate,
  getBookedCountsByCategoryForDate,
  getSpecialQuotaConsumptionCount,
  getExamMixConsumedCountsByRule,
} from "../../scheduler/repositories/capacity.repo.js";
import { findBookingById, findBookingByIdForUpdate, updateBookingDateTime, updateBookingForReschedule } from "../repositories/booking.repo.js";
import { acquireBucketLocks, acquireSpecialQuotaBucketLocks } from "../repositories/bucket-mutex.repo.js";
import { recordOverrideAudit } from "../repositories/override-audit.repo.js";
import { authenticateSupervisor } from "../utils/authenticate-supervisor.js";
import { recordRescheduleAudit } from "../repositories/reschedule-audit.repo.js";
import type { Booking } from "../models/booking.js";
import type { CreateBookingPayload } from "../models/booking.js";
import { RESCHEDULABLE_STATUSES } from "../../shared/types/common.js";
import { findModalityById } from "../../catalog/repositories/modality-catalog.repo.js";
import { findExamTypeById } from "../../catalog/repositories/exam-type-catalog.repo.js";
import type { CapacityResolutionMode, SchedulingOverrideType } from "../../shared/types/common.js";
import { scheduleBookingWorklistDetailReplacement } from "../../../../services/dicom-service.js";
import { safeEnqueuePatientNotificationEvent } from "../../../../services/patient-web-push-service.js";
import type { Role } from "../../../../types/domain.js";
import { loadClosedWeekdays } from "../../scheduler/services/closed-weekday-settings.js";
import { resolveRequiredOverrideTypes, validateCapacityModeAuthority, validateDecisionAuthority, validateFinalOverrideTypeConsistency } from "./override-authority.js";
import { assertPatientMeetsBookingQueueRequirements } from "./patient-identifier-requirement.js";
import type { ApprovedOverrideContext } from "../models/approved-override-context.js";
import {
  NO_SHOW_BOOKING_BLOCKED_MESSAGE,
  authorizeNoShowBookingRestriction,
  isNoShowBookingBlocked
} from "../../../../services/patient-no-show-restriction-service.js";
import { HttpError } from "../../../../utils/http-error.js";
import { cancelPendingReportingAssignmentIntent } from "../../../doctor-portal/reporting-assignment-intents-service.js";
import { findApplicableSpecialQuotaRules } from "../../rules/services/resolve-special-quota.js";
import {
  findActiveSpecialQuotaConsumption,
  insertSpecialQuotaConsumption,
  releaseActiveSpecialQuotaConsumption,
} from "../repositories/special-quota-consumption.repo.js";

export interface RescheduleBookingResult {
  booking: Booking;
  decisionSnapshot: unknown;
  wasOverride: boolean;
  previousDate: string;
  previousTime: string | null;
  dateTimeChanged: boolean;
  patientVisibleDetailsChanged: boolean;
}

type ExamTypeChangePolicy = "allowed_without_supervisor" | "supervisor_required" | "disabled";
const RESOLVED_CAPACITY_REASON_CODES = new Set([
  "category_capacity_exhausted",
  "category_override_forbidden",
  "category_override_required",
  "modality_daily_capacity_exhausted",
  "total_capacity_override_forbidden",
  "total_capacity_override_required",
]);

function sameSlotDetailsEditCapacityReasonsAreResolved(
  reasons: Array<{ code: string }>,
  existingBookingCapacityAlreadyAccountedFor: boolean
): boolean {
  return (
    existingBookingCapacityAlreadyAccountedFor &&
    reasons.length > 0 &&
    reasons.every((reason) => RESOLVED_CAPACITY_REASON_CODES.has(reason.code))
  );
}

async function getExamTypeChangePolicy(client: PoolClient): Promise<ExamTypeChangePolicy> {
  const result = await client.query<{ setting_value: { value?: string } | null }>(
    `
      select setting_value
      from system_settings
      where category = 'scheduling_and_capacity'
        and setting_key = 'exam_type_change_policy'
      limit 1
    `
  );
  const raw = String(result.rows[0]?.setting_value?.value ?? "").trim().toLowerCase();
  if (raw === "disabled" || raw === "supervisor_required" || raw === "allowed_without_supervisor") {
    return raw;
  }
  return "allowed_without_supervisor";
}

async function bookingHasPrivilegedOrigin(client: PoolClient, booking: Booking): Promise<boolean> {
  const result = await client.query<{ allowed: boolean }>(
    `
      select (
        exists (
          select 1
          from users u
          where u.id = $1
            and u.role in ('supervisor', 'super_admin')
        )
        or exists (
          select 1
          from appointments_v2.override_audit_events oae
          where oae.booking_id = $2
            and oae.outcome = 'approved_and_booked'
        )
      ) as allowed
    `,
    [booking.createdByUserId, booking.id]
  );
  return result.rows[0]?.allowed === true;
}

export async function rescheduleBooking(
  bookingId: number,
  newDate: string | null,
  newTime: string | null | undefined,
  newExamTypeId: number | null,
  reportingPriorityId: number | null,
  notes: string | null,
  userId: number,
  userRole: Role | undefined,
  override?: CreateBookingPayload["override"],
  capacityResolutionMode?: CapacityResolutionMode,
  specialReasonCode: string | null = null,
  specialReasonNote: string | null = null,
  rescheduleReason: string | null = null,
  noShowAuthorizationReason: string | null = null,
  requiresReport?: boolean,
  studyInstanceUid?: string | null,
  policySetKey: string = "default",
  approvedOverrideContext?: ApprovedOverrideContext,
  doctorProtocolReportUpdateAuthorized: boolean = false
): Promise<RescheduleBookingResult> {
  const result = await withTransaction(async (client) => {
    return rescheduleBookingInternal(
      client,
      bookingId,
      newDate,
      newTime,
      newExamTypeId,
      reportingPriorityId,
      notes,
      userId,
      userRole,
      override,
      capacityResolutionMode,
      specialReasonCode,
      specialReasonNote,
      rescheduleReason,
      noShowAuthorizationReason,
      requiresReport,
      studyInstanceUid,
      policySetKey,
      approvedOverrideContext,
      doctorProtocolReportUpdateAuthorized
    );
  }, {
    isolationLevel: "serializable",
    operationName: "reschedule_booking",
  });

  scheduleBookingWorklistDetailReplacement(bookingId);
  if (result.dateTimeChanged) {
    void safeEnqueuePatientNotificationEvent({
      bookingId,
      eventType: "appointment_rescheduled",
      dedupeSuffix: `${result.previousDate}:${result.previousTime ?? ""}->${result.booking.bookingDate}:${result.booking.bookingTime ?? ""}`,
    });
  } else if (result.patientVisibleDetailsChanged) {
    void safeEnqueuePatientNotificationEvent({
      bookingId,
      eventType: "appointment_changed",
      dedupeSuffix: `${result.booking.updatedAt ?? Date.now()}`,
    });
  }
  return result;
}

export async function rescheduleBookingInternal(
  client: PoolClient,
  bookingId: number,
  newDate: string | null,
  newTime: string | null | undefined,
  newExamTypeId: number | null,
  reportingPriorityId: number | null,
  notes: string | null,
  userId: number,
  userRole: Role | undefined,
  override: CreateBookingPayload["override"] | undefined,
  capacityResolutionMode: CapacityResolutionMode | undefined,
  specialReasonCode: string | null,
  specialReasonNote: string | null,
  rescheduleReason: string | null,
  noShowAuthorizationReason: string | null,
  requiresReport: boolean | undefined,
  studyInstanceUid: string | null | undefined,
  policySetKey: string,
  approvedOverrideContext?: ApprovedOverrideContext,
  doctorProtocolReportUpdateAuthorized: boolean = false
): Promise<RescheduleBookingResult> {
  // 1. Find the existing booking
  const booking = await findBookingByIdForUpdate(client, bookingId);
  if (!booking) {
    throw new SchedulingError(404, `Booking ${bookingId} not found.`, ["booking_not_found"]);
  }
  await assertPatientMeetsBookingQueueRequirements(client, booking.patientId, userRole);
  let noShowAuthorization: { userId: number; reason: string; role: Role } | null = null;
  if (await isNoShowBookingBlocked(client, booking.patientId)) {
    if (override) {
      const supervisor = await authenticateSupervisor(
        client,
        override.supervisorUsername,
        override.supervisorPassword
      );
      const reason = String(override.reason || "").trim();
      if (!reason) throw new HttpError(403, "No-show booking authorization reason is required.");
      noShowAuthorization = { userId: supervisor.id, reason, role: supervisor.role as Role };
    } else if (userRole === "supervisor" || userRole === "super_admin") {
      const reason = String(noShowAuthorizationReason || "").trim();
      if (!reason) throw new HttpError(403, "No-show booking authorization reason is required.");
      noShowAuthorization = { userId, reason, role: userRole };
    } else {
      const error = new HttpError(403, NO_SHOW_BOOKING_BLOCKED_MESSAGE) as HttpError & { reasonCodes?: string[] };
      error.reasonCodes = ["patient_no_show_booking_blocked"];
      throw error;
    }
  }

  const previousDate = booking.bookingDate;
  const previousTime = booking.bookingTime;
  const previousExamTypeId = booking.examTypeId;
  const previousRequiresReport = booking.requiresReport;
  const bookingModalityId = Number(booking.modalityId);
  const effectiveDate = newDate ?? previousDate;
  const effectiveTime = newTime === undefined ? previousTime : newTime;
  const effectiveExamTypeId = newExamTypeId ?? booking.examTypeId;
  const effectiveReportingPriorityId = reportingPriorityId ?? booking.reportingPriorityId;
  const effectiveNotes = notes ?? booking.notes;
  const effectiveRequiresReport = requiresReport ?? booking.requiresReport;
  const isEnablingNonOncologyReport =
    booking.caseCategory === "non_oncology" &&
    booking.requiresReport !== true &&
    requiresReport === true;
  if (
    isEnablingNonOncologyReport &&
    !doctorProtocolReportUpdateAuthorized &&
    userRole !== "super_admin" &&
    userRole !== "supervisor"
  ) {
    throw new HttpError(403, "Only supervisors and super admins can require a report for non-oncology bookings.");
  }
  const effectiveStudyInstanceUid = studyInstanceUid ?? booking.studyInstanceUid;
  const effectiveCapacityResolutionMode =
    capacityResolutionMode ?? booking.capacityResolutionMode ?? "standard";
  const capacityModeUnchanged = effectiveCapacityResolutionMode === booking.capacityResolutionMode;
  const examTypeChangePolicy = await getExamTypeChangePolicy(client);
  validateCapacityModeAuthority(userRole, effectiveCapacityResolutionMode);

  if (effectiveExamTypeId != null) {
    const examType = await findExamTypeById(client, effectiveExamTypeId);
    if (!examType) {
      throw new SchedulingError(400, `Exam type ${effectiveExamTypeId} not found.`, ["exam_type_not_found"]);
    }
    if (Number(examType.modalityId) !== bookingModalityId) {
      throw new SchedulingError(
        400,
        `Exam type ${effectiveExamTypeId} does not belong to modality ${bookingModalityId}.`,
        ["exam_type_modality_mismatch"]
      );
    }
  }

  const dateUnchanged = previousDate === effectiveDate;
  const timeUnchanged = String(previousTime ?? "") === String(effectiveTime ?? "");
  const examTypeUnchanged = Number(booking.examTypeId ?? -1) === Number(effectiveExamTypeId ?? -1);
  const examTypeChanged = !examTypeUnchanged;
  const hasPrivilegedOrigin = examTypeChanged ? await bookingHasPrivilegedOrigin(client, booking) : false;
  const examTypeChangeBypassesSupervisorAuth =
    examTypeChanged &&
    examTypeChangePolicy === "supervisor_required" &&
    hasPrivilegedOrigin;
  const examTypeChangeRequiresSupervisorAuth =
    examTypeChanged && examTypeChangePolicy === "supervisor_required" && !examTypeChangeBypassesSupervisorAuth;
  const scheduleUnchanged = dateUnchanged && timeUnchanged && examTypeUnchanged && capacityModeUnchanged;

  if (examTypeChanged && examTypeChangePolicy === "disabled") {
    throw new SchedulingError(
      403,
      "Changing the exam type is disabled.",
      ["exam_type_change_disabled"]
    );
  }

  if (!scheduleUnchanged) {
    if (booking.status === "cancelled") {
      throw new SchedulingError(
        409,
        `Booking ${bookingId} is cancelled and cannot be rescheduled.`,
        ["booking_cancelled"]
      );
    }

    if (!RESCHEDULABLE_STATUSES.includes(booking.status as typeof RESCHEDULABLE_STATUSES[number])) {
      throw new SchedulingError(
        409,
        `Booking ${bookingId} has status "${booking.status}" and cannot be rescheduled.`,
        ["booking_not_reschedulable"]
      );
    }
  }

  // If schedule fields are unchanged, update editable booking details only.
  if (scheduleUnchanged) {
    return rescheduleTimeOnly(
      client,
      bookingId,
      effectiveTime,
      userId,
      previousDate,
      previousTime,
      effectiveReportingPriorityId,
      effectiveNotes,
      effectiveRequiresReport,
      booking.requiresReport,
      effectiveStudyInstanceUid,
      override,
      rescheduleReason
    );
  }

  // 2. Acquire deterministic locks for both categories on source+target dates.
  await acquireBucketLocks(client, [
    {
      modalityId: bookingModalityId,
      date: previousDate,
      caseCategory: "oncology",
    },
    {
      modalityId: bookingModalityId,
      date: previousDate,
      caseCategory: "non_oncology",
    },
    {
      modalityId: bookingModalityId,
      date: effectiveDate,
      caseCategory: "oncology",
    },
    {
      modalityId: bookingModalityId,
      date: effectiveDate,
      caseCategory: "non_oncology",
    },
  ]);

  // 3. Load the published policy
  const publishedVersion = await findPublishedPolicyVersion(client, policySetKey);
  if (!publishedVersion) {
    throw new SchedulingError(
      400,
      "No scheduling policy has been published.",
      ["no_published_policy"]
    );
  }
  const modality = await findModalityById(client, bookingModalityId);
  if (!modality) {
    throw new SchedulingError(
      400,
      `Modality ${bookingModalityId} not found.`,
      ["modality_not_found"]
    );
  }

  // 4. Load all rules for re-evaluation
  const blockedRules = await loadModalityBlockedRules(
    client,
    publishedVersion.id,
    bookingModalityId
  );
  const examTypeRules = await loadExamTypeRules(
    client,
    publishedVersion.id,
    bookingModalityId
  );
  const categoryLimits = await loadCategoryDailyLimits(
    client,
    publishedVersion.id,
    bookingModalityId
  );
  const specialQuotas = await loadSpecialQuotaRules(
    client,
    publishedVersion.id
  );

  const examTypeRuleItemExamTypeIds = await loadExamTypeRuleItemExamTypeIds(
    client,
    publishedVersion.id,
    bookingModalityId
  );
  const examTypeRuleItems = await loadExamTypeRuleItems(
    client,
    publishedVersion.id,
    bookingModalityId
  );
  const examMixQuotaRules = await loadExamMixQuotaRules(
    client,
    publishedVersion.id,
    bookingModalityId
  );
  const examMixQuotaRuleItems = await loadExamMixQuotaRuleItems(
    client,
    publishedVersion.id,
    bookingModalityId
  );

  // 5. Load current booked count for the NEW date (after lock).
  // For same-date edits, evaluate the replacement state without double-counting this booking.
  const excludeBookingIdFromTargetCounts = previousDate === effectiveDate ? bookingId : null;
  const currentBookedCount = await getBookedCountForDate(
    client,
    bookingModalityId,
    effectiveDate,
    booking.caseCategory,
    excludeBookingIdFromTargetCounts
  );
  const bookedCounts = await getBookedCountsByCategoryForDate(
    client,
    bookingModalityId,
    effectiveDate,
    excludeBookingIdFromTargetCounts
  );

  // 6. Lock source/target quota pools and load target shared-pool consumption.
  const sourceConsumptionBeforeLock = await findActiveSpecialQuotaConsumption(client, bookingId);
  const applicableTargetQuotas = findApplicableSpecialQuotaRules(specialQuotas, {
    modalityId: bookingModalityId,
    examTypeId: effectiveExamTypeId,
    requesterRole: userRole,
    requesterUserId: userId,
  });
  const quotaLockKeys = [] as Array<{ logicalKey: string; date: string }>;
  if (sourceConsumptionBeforeLock) {
    quotaLockKeys.push({
      logicalKey: sourceConsumptionBeforeLock.quotaLogicalKey,
      date: sourceConsumptionBeforeLock.bookingDate,
    });
  }
  if (effectiveCapacityResolutionMode === "special_quota_extra" && applicableTargetQuotas.length === 1) {
    quotaLockKeys.push({ logicalKey: applicableTargetQuotas[0].logicalKey, date: effectiveDate });
  }
  await acquireSpecialQuotaBucketLocks(client, quotaLockKeys);
  const sourceConsumption = await findActiveSpecialQuotaConsumption(client, bookingId, { forUpdate: true });

  let currentSpecialQuotaConsumptionCount = 0;
  if (effectiveCapacityResolutionMode === "special_quota_extra" && applicableTargetQuotas.length === 1) {
    currentSpecialQuotaConsumptionCount = await getSpecialQuotaConsumptionCount(client, {
      logicalKey: applicableTargetQuotas[0].logicalKey,
      bookingDate: effectiveDate,
      excludeBookingId: bookingId,
    });
  }
  const currentExamMixConsumedByRuleId = await getExamMixConsumedCountsByRule(client, {
    policyVersionId: publishedVersion.id,
    modalityId: bookingModalityId,
    bookingDate: effectiveDate,
    ruleIds: examMixQuotaRules.map((row) => Number(row.id)),
    excludeBookingId: excludeBookingIdFromTargetCounts,
  });
  const closedWeekdays = await loadClosedWeekdays(client);

  // 7. Build context and re-evaluate
  const context: RuleEvaluationContext = {
    policyVersionId: publishedVersion.id,
    policySetKey,
    policyVersionNo: publishedVersion.versionNo,
    policyConfigHash: publishedVersion.configHash,
    modalityExists: true,
    examTypeExists: effectiveExamTypeId != null,
    examTypeBelongsToModality: true, // Was already validated at creation
    blockedRules,
    examTypeRules,
    examTypeRuleItemExamTypeIds,
    examTypeRuleItems,
    categoryLimits,
    modalityDailyCapacity: modality.dailyCapacity ?? null,
    currentBookedCountTotal: bookedCounts.total,
    currentBookedCountOncology: bookedCounts.oncology,
    currentBookedCountNonOncology: bookedCounts.nonOncology,
    specialQuotas,
    currentBookedCount, // Includes this booking if newDate === oldDate
    currentSpecialQuotaConsumptionCount,
    examMixQuotaRules,
    examMixQuotaRuleItems,
    currentExamMixConsumedByRuleId,
    closedWeekdays,
    requesterRole: userRole,
    requesterUserId: userId,
  };

  const requestedOverrideType = approvedOverrideContext?.overrideType ?? override?.overrideType ?? null;
  const pureInput: PureEvaluateInput = {
    patientId: booking.patientId,
    modalityId: bookingModalityId,
    examTypeId: effectiveExamTypeId,
    scheduledDate: effectiveDate,
    caseCategory: booking.caseCategory,
    capacityResolutionMode: effectiveCapacityResolutionMode,
    useSpecialQuota: effectiveCapacityResolutionMode === "special_quota_extra",
    // `specialReasonCode` remains metadata/audit justification only and does
    // not create independent scheduling policy behavior.
    specialReasonCode,
    includeOverrideEvaluation: override != null,
    bypassExamMixQuota: requestedOverrideType === "exam_mix_override",
    context,
  };

  const decision = await pureEvaluate(pureInput);
  console.info(JSON.stringify({
    type: "appointments_v2_reschedule_decision",
    bookingId,
    modalityId: bookingModalityId,
    previousDate,
    newDate: effectiveDate,
    caseCategory: booking.caseCategory,
    displayStatus: decision.displayStatus,
    requiresSupervisorOverride: decision.requiresSupervisorOverride,
    isAllowed: decision.isAllowed,
    reasonCodes: decision.reasons.map((r) => r.code),
  }));

  const capacityModePreserved = capacityResolutionMode === undefined;
  const existingBookingCapacityAlreadyAccountedFor = capacityModePreserved && dateUnchanged && timeUnchanged;
  const authorityDecision = existingBookingCapacityAlreadyAccountedFor
    ? {
        ...decision,
        reasons: decision.reasons.filter((reason) => !RESOLVED_CAPACITY_REASON_CODES.has(reason.code)),
      }
    : decision;

  validateDecisionAuthority(authorityDecision, userRole, effectiveCapacityResolutionMode);

  // 7. Check if reschedule is allowed or requires override
  let wasOverride = false;
  let supervisorUserId: number | null = null;
  let requiredOverrideTypes = resolveRequiredOverrideTypes(authorityDecision, effectiveCapacityResolutionMode);
  if (existingBookingCapacityAlreadyAccountedFor) {
    requiredOverrideTypes = requiredOverrideTypes.filter(
      (type) => type !== "category_override" && type !== "total_capacity_override"
    );
  }
  if (requestedOverrideType === "exam_mix_override" && !requiredOverrideTypes.includes("exam_mix_override")) {
    requiredOverrideTypes.push("exam_mix_override");
  }
  validateFinalOverrideTypeConsistency(requiredOverrideTypes, requestedOverrideType);

  if (
    decision.displayStatus === "blocked" &&
    !decision.requiresSupervisorOverride &&
    !sameSlotDetailsEditCapacityReasonsAreResolved(decision.reasons, existingBookingCapacityAlreadyAccountedFor)
  ) {
    throw new SchedulingError(
      409,
      "Reschedule is not allowed for the new date/category.",
      decision.reasons.map((r) => r.code),
      { decision }
    );
  }

  if (decision.requiresSupervisorOverride || requiredOverrideTypes.length > 0 || examTypeChangeRequiresSupervisorAuth || approvedOverrideContext) {
    if (approvedOverrideContext) {
      supervisorUserId = approvedOverrideContext.approverUserId;
      wasOverride = true;
    } else if (!override) {
      if (examTypeChangeRequiresSupervisorAuth && !decision.requiresSupervisorOverride && requiredOverrideTypes.length === 0) {
        throw new SchedulingError(
          403,
          "Supervisor override is required to change the exam type.",
          ["exam_type_change_supervisor_required"]
        );
      }
      throw new SchedulingError(
        403,
        "Supervisor override is required for this reschedule.",
        ["override_required"]
      );
    } else if (!override.reason?.trim()) {
      throw new SchedulingError(403, "Override reason is required.", ["override_reason_required"]);
    } else {
      const supervisor = await authenticateSupervisor(
        client,
        override.supervisorUsername,
        override.supervisorPassword
      );
      console.info(JSON.stringify({
        type: "appointments_v2_reschedule_override",
        bookingId,
        requestingUserId: userId,
        supervisorUserId: supervisor.id,
      }));
      supervisorUserId = supervisor.id;
      wasOverride = true;
    }
  }

  if (effectiveCapacityResolutionMode === "special_quota_extra" && !specialReasonCode) {
    throw new SchedulingError(
      400,
      "Special quota extra mode requires specialReasonCode.",
      ["special_reason_code_required"]
    );
  }

  if (noShowAuthorization) {
    await authorizeNoShowBookingRestriction(client, booking.patientId, noShowAuthorization.userId, noShowAuthorization.reason, bookingId, noShowAuthorization.role);
  }

  const targetQuota = decision.consumedCapacityMode === "special" ? decision.matchedSpecialQuota ?? null : null;
  const keepExistingConsumption =
    sourceConsumption != null &&
    targetQuota != null &&
    sourceConsumption.quotaLogicalKey === targetQuota.logicalKey &&
    sourceConsumption.bookingDate === effectiveDate &&
    Number(sourceConsumption.examTypeId) === Number(effectiveExamTypeId);

  if (sourceConsumption && !keepExistingConsumption) {
    await releaseActiveSpecialQuotaConsumption(client, {
      bookingId,
      releasedByUserId: userId,
      releaseReason: "rescheduled",
    });
  }

  await updateBookingForReschedule(
    client,
    bookingId,
    effectiveDate,
    effectiveTime,
    publishedVersion.id,
    userId,
    effectiveCapacityResolutionMode,
    // Recompute uses_special_quota for the new booking state
    decision.consumedCapacityMode === "special",
    specialReasonCode,
    specialReasonNote,
    effectiveExamTypeId,
    effectiveReportingPriorityId,
    effectiveNotes,
    effectiveRequiresReport,
    effectiveStudyInstanceUid
  );
  if (targetQuota && !keepExistingConsumption) {
    if (effectiveExamTypeId == null) {
      throw new SchedulingError(500, "Special Quota decision did not identify an exam type.", ["special_quota_exam_missing"]);
    }
    await insertSpecialQuotaConsumption(client, {
      bookingId,
      quotaRuleId: targetQuota.ruleId,
      quotaLogicalKey: targetQuota.logicalKey,
      policyVersionId: publishedVersion.id,
      bookingDate: effectiveDate,
      examTypeId: effectiveExamTypeId,
      consumedByUserId: userId,
    });
  }
  if (effectiveRequiresReport === false) {
    await cancelPendingReportingAssignmentIntent(client, bookingId, {
      reason: "requires_report=false",
      actorUserId: userId,
    });
  }

  const schedulingAuditOverrideType: SchedulingOverrideType | null =
      approvedOverrideContext?.overrideType ??
      (requiredOverrideTypes.length === 1 ? requiredOverrideTypes[0] : null);
  if (wasOverride && supervisorUserId != null && schedulingAuditOverrideType) {
    await recordOverrideAudit(client, {
      bookingId,
      patientId: booking.patientId,
      modalityId: bookingModalityId,
      examTypeId: effectiveExamTypeId,
      bookingDate: effectiveDate,
      requestingUserId: approvedOverrideContext?.requesterUserId ?? userId,
      supervisorUserId,
      overrideReason: approvedOverrideContext?.reason ?? override?.reason ?? null,
      overrideType: schedulingAuditOverrideType,
      decisionSnapshot: approvedOverrideContext
        ? { ...decision, capacityResolutionMode: effectiveCapacityResolutionMode, deferredApprovalRequestId: approvedOverrideContext.requestId }
        : { ...decision, capacityResolutionMode: effectiveCapacityResolutionMode },
      outcome: "approved_and_booked",
    });
  }

  await recordRescheduleAudit(client, {
    bookingId,
    previousDate,
    previousTime,
    newDate: effectiveDate,
    newTime: effectiveTime,
    changedByUserId: userId,
    overrideUsed: wasOverride,
    supervisorUserId,
    reason: rescheduleReason ?? approvedOverrideContext?.reason ?? override?.reason ?? null,
  });

  const updatedBooking = await findBookingById(client, bookingId);
  if (!updatedBooking) {
    throw new SchedulingError(500, "Booking disappeared after reschedule.", ["internal_error"]);
  }

  return {
    booking: updatedBooking,
    decisionSnapshot: decision,
    wasOverride,
    previousDate,
    previousTime,
    dateTimeChanged: previousDate !== updatedBooking.bookingDate || String(previousTime ?? "") !== String(updatedBooking.bookingTime ?? ""),
    patientVisibleDetailsChanged:
      Number(previousExamTypeId ?? -1) !== Number(updatedBooking.examTypeId ?? -1) ||
      Boolean(previousRequiresReport) !== Boolean(updatedBooking.requiresReport),
  };
}

/**
 * Reschedule a booking on the same date (time-only change).
 * No re-evaluation needed — just update the booking_time.
 */
async function rescheduleTimeOnly(
  client: PoolClient,
  bookingId: number,
  newTime: string | null,
  userId: number,
  previousDate: string,
  previousTime: string | null,
  reportingPriorityId: number | null,
  notes: string | null,
  requiresReport: boolean,
  previousRequiresReport: boolean,
  studyInstanceUid: string | null,
  override: CreateBookingPayload["override"] | undefined,
  rescheduleReason: string | null
): Promise<RescheduleBookingResult> {
  await updateBookingDateTime(client, bookingId, previousDate, newTime, userId, reportingPriorityId, notes, requiresReport, studyInstanceUid);
  if (requiresReport === false) {
    await cancelPendingReportingAssignmentIntent(client, bookingId, {
      reason: "requires_report=false",
      actorUserId: userId,
    });
  }

  await recordRescheduleAudit(client, {
    bookingId,
    previousDate,
    previousTime,
    newDate: previousDate,
    newTime,
    changedByUserId: userId,
    overrideUsed: false,
    supervisorUserId: null,
    reason: rescheduleReason ?? override?.reason ?? null,
  });

  const updatedBooking = await findBookingById(client, bookingId);
  if (!updatedBooking) {
    throw new SchedulingError(500, "Booking disappeared after update.", ["internal_error"]);
  }

  return {
    booking: updatedBooking,
    decisionSnapshot: null,
    wasOverride: false,
    previousDate,
    previousTime,
    dateTimeChanged: String(previousTime ?? "") !== String(updatedBooking.bookingTime ?? ""),
    patientVisibleDetailsChanged: Boolean(previousRequiresReport) !== Boolean(updatedBooking.requiresReport),
  };
}
