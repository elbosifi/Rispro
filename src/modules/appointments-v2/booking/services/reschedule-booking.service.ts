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
  loadExamTypeSpecialQuotas,
  loadExamTypeRuleItemExamTypeIds,
  loadExamTypeRuleItems,
  loadExamMixQuotaRules,
  loadExamMixQuotaRuleItems,
} from "../../rules/repositories/policy-rules.repo.js";
import {
  getBookedCountForDate,
  getBookedCountsByCategoryForDate,
  getSpecialQuotaBookedCount,
  getExamMixConsumedCountsByRule,
} from "../../scheduler/repositories/capacity.repo.js";
import { findBookingById, updateBookingDateTime, updateBookingForReschedule } from "../repositories/booking.repo.js";
import { acquireBucketLocks } from "../repositories/bucket-mutex.repo.js";
import { recordOverrideAudit } from "../repositories/override-audit.repo.js";
import { authenticateSupervisor } from "../utils/authenticate-supervisor.js";
import { recordRescheduleAudit } from "../repositories/reschedule-audit.repo.js";
import type { Booking } from "../models/booking.js";
import type { CreateBookingPayload } from "../models/booking.js";
import { RESCHEDULABLE_STATUSES } from "../../shared/types/common.js";
import { findModalityById } from "../../catalog/repositories/modality-catalog.repo.js";
import { findExamTypeById } from "../../catalog/repositories/exam-type-catalog.repo.js";
import type { CapacityResolutionMode, SchedulingOverrideType } from "../../shared/types/common.js";
import { scheduleBookingWorklistSync } from "../../../../services/dicom-service.js";
import { safeEnqueuePatientNotificationEvent } from "../../../../services/patient-web-push-service.js";
import type { Role } from "../../../../types/domain.js";
import { loadClosedWeekdays } from "../../scheduler/services/closed-weekday-settings.js";
import { resolveRequiredOverrideTypes, validateCapacityModeAuthority, validateDecisionAuthority } from "./override-authority.js";

export interface RescheduleBookingResult {
  booking: Booking;
  decisionSnapshot: unknown;
  wasOverride: boolean;
  previousDate: string;
  previousTime: string | null;
  dateTimeChanged: boolean;
  patientVisibleDetailsChanged: boolean;
}

export async function rescheduleBooking(
  bookingId: number,
  newDate: string | null,
  newTime: string | null,
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
  requiresReport?: boolean,
  studyInstanceUid?: string | null,
  policySetKey: string = "default"
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
      requiresReport,
      studyInstanceUid,
      policySetKey
    );
  }, {
    isolationLevel: "serializable",
    operationName: "reschedule_booking",
  });

  scheduleBookingWorklistSync(bookingId);
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

async function rescheduleBookingInternal(
  client: PoolClient,
  bookingId: number,
  newDate: string | null,
  newTime: string | null,
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
  requiresReport: boolean | undefined,
  studyInstanceUid: string | null | undefined,
  policySetKey: string
): Promise<RescheduleBookingResult> {
  // 1. Find the existing booking
  const booking = await findBookingById(client, bookingId);
  if (!booking) {
    throw new SchedulingError(404, `Booking ${bookingId} not found.`, ["booking_not_found"]);
  }

  if (booking.status === "cancelled") {
    throw new SchedulingError(
      409,
      `Booking ${bookingId} is cancelled and cannot be rescheduled.`,
      ["booking_cancelled"]
    );
  }

  // Validate that the booking is in a reschedulable status
  if (!RESCHEDULABLE_STATUSES.includes(booking.status as typeof RESCHEDULABLE_STATUSES[number])) {
    throw new SchedulingError(
      409,
      `Booking ${bookingId} has status "${booking.status}" and cannot be rescheduled.`,
      ["booking_not_reschedulable"]
    );
  }

  const previousDate = booking.bookingDate;
  const previousTime = booking.bookingTime;
  const previousExamTypeId = booking.examTypeId;
  const previousRequiresReport = booking.requiresReport;
  const bookingModalityId = Number(booking.modalityId);
  const effectiveDate = newDate ?? previousDate;
  const effectiveExamTypeId = newExamTypeId ?? booking.examTypeId;
  const effectiveReportingPriorityId = reportingPriorityId ?? booking.reportingPriorityId;
  const effectiveNotes = notes ?? booking.notes;
  const effectiveRequiresReport = requiresReport ?? booking.requiresReport;
  const effectiveStudyInstanceUid = studyInstanceUid ?? booking.studyInstanceUid;
  const effectiveCapacityResolutionMode =
    capacityResolutionMode ?? booking.capacityResolutionMode ?? "standard";
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
  const examTypeUnchanged = Number(booking.examTypeId ?? -1) === Number(effectiveExamTypeId ?? -1);
  // If date + exam type are unchanged, this is a time-only update.
  if (dateUnchanged && examTypeUnchanged) {
    return rescheduleTimeOnly(
      client,
      bookingId,
      newTime,
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
  const specialQuotas = await loadExamTypeSpecialQuotas(
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

  // 5. Load current booked count for the NEW date (after lock)
  // Note: the old booking is still counted here because it hasn't been updated yet
  const currentBookedCount = await getBookedCountForDate(
    client,
    bookingModalityId,
    effectiveDate,
    booking.caseCategory
  );
  const bookedCounts = await getBookedCountsByCategoryForDate(
    client,
    bookingModalityId,
    effectiveDate
  );

  // 6. Load special quota booked count for the NEW date (only when examTypeId is provided)
  let currentSpecialQuotaBookedCount = 0;
  if (effectiveExamTypeId != null) {
    currentSpecialQuotaBookedCount = await getSpecialQuotaBookedCount(client, {
      modalityId: bookingModalityId,
      bookingDate: effectiveDate,
      examTypeId: effectiveExamTypeId,
    });
  }
  const currentExamMixConsumedByRuleId = await getExamMixConsumedCountsByRule(client, {
    policyVersionId: publishedVersion.id,
    modalityId: bookingModalityId,
    bookingDate: effectiveDate,
    ruleIds: examMixQuotaRules.map((row) => Number(row.id)),
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
    currentSpecialQuotaBookedCount,
    examMixQuotaRules,
    examMixQuotaRuleItems,
    currentExamMixConsumedByRuleId,
    closedWeekdays,
    requesterRole: userRole,
    requesterUserId: userId,
  };

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

  validateDecisionAuthority(decision, userRole, effectiveCapacityResolutionMode);

  // 7. Check if reschedule is allowed or requires override
  let wasOverride = false;
  let supervisorUserId: number | null = null;
  const requiredOverrideTypes = resolveRequiredOverrideTypes(decision, effectiveCapacityResolutionMode);

  if (decision.displayStatus === "blocked" && !decision.requiresSupervisorOverride) {
    throw new SchedulingError(
      409,
      "Reschedule is not allowed for the new date/category.",
      decision.reasons.map((r) => r.code),
      { decision }
    );
  }

  if (decision.requiresSupervisorOverride || requiredOverrideTypes.length > 0) {
    if (!override) {
      throw new SchedulingError(
        403,
        "Supervisor override is required for this reschedule.",
        ["override_required"]
      );
    }
    if (!override.reason?.trim()) {
      throw new SchedulingError(403, "Override reason is required.", ["override_reason_required"]);
    }

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

  if (effectiveCapacityResolutionMode === "special_quota_extra" && !specialReasonCode) {
    throw new SchedulingError(
      400,
      "Special quota extra mode requires specialReasonCode.",
      ["special_reason_code_required"]
    );
  }

  await updateBookingForReschedule(
    client,
    bookingId,
    effectiveDate,
    newTime,
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

  if (wasOverride && supervisorUserId != null) {
    const overrideType: SchedulingOverrideType =
      requiredOverrideTypes.includes("total_capacity_override")
        ? "total_capacity_override"
        : requiredOverrideTypes.includes("category_override")
        ? "category_override"
        : "closed_weekday_override";
    await recordOverrideAudit(client, {
      bookingId,
      patientId: booking.patientId,
      modalityId: bookingModalityId,
      examTypeId: effectiveExamTypeId,
      bookingDate: effectiveDate,
      requestingUserId: userId,
      supervisorUserId,
      overrideReason: override?.reason ?? null,
      overrideType,
      decisionSnapshot: { ...decision, capacityResolutionMode: effectiveCapacityResolutionMode },
      outcome: "approved_and_booked",
    });
  }

  await recordRescheduleAudit(client, {
    bookingId,
    previousDate,
    previousTime,
    newDate: effectiveDate,
    newTime,
    changedByUserId: userId,
    overrideUsed: wasOverride,
    supervisorUserId,
    reason: rescheduleReason ?? override?.reason ?? null,
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
