/**
 * Appointments V2 — Create booking service.
 *
 * Transactional booking with lock → re-evaluate → write pattern.
 * Follows D008 precedence and D012 (row-level locking via bucket_mutex).
 */

import type { PoolClient } from "pg";
import { withTransaction } from "../../shared/utils/transactions.js";
import { SchedulingError } from "../../shared/errors/scheduling-error.js";
import { pureEvaluate } from "../../rules/services/pure-evaluate.js";
import type { PureEvaluateInput, RuleEvaluationContext } from "../../rules/models/rule-evaluation-context.js";
import type { Booking, CreateBookingPayload } from "../models/booking.js";
import { findPublishedPolicyVersion } from "../../rules/repositories/policy-version.repo.js";
import {
  loadModalityBlockedRules,
  loadExamTypeRules,
  loadCategoryDailyLimits,
  loadExamTypeSpecialQuotas,
  loadExamTypeRuleItemExamTypeIds,
  loadExamMixQuotaRules,
  loadExamMixQuotaRuleItems,
} from "../../rules/repositories/policy-rules.repo.js";
import { findModalityById } from "../../catalog/repositories/modality-catalog.repo.js";
import { findExamTypeById } from "../../catalog/repositories/exam-type-catalog.repo.js";
import {
  getBookedCountForDate,
  getBookedCountsByCategoryForDate,
  getSpecialQuotaBookedCount,
  getExamMixConsumedCountsByRule,
} from "../../scheduler/repositories/capacity.repo.js";
import { acquireBucketLocks } from "../repositories/bucket-mutex.repo.js";
import { insertBooking } from "../repositories/booking.repo.js";
import { recordOverrideAudit } from "../repositories/override-audit.repo.js";
import { authenticateSupervisor } from "../utils/authenticate-supervisor.js";
import type { CapacityResolutionMode } from "../../shared/types/common.js";

export interface CreateBookingResult {
  booking: Booking;
  decisionSnapshot: unknown;
  wasOverride: boolean;
}

export async function createBooking(
  payload: CreateBookingPayload,
  userId: number,
  policySetKey: string = "default"
): Promise<CreateBookingResult> {
  return withTransaction(async (client) => {
    return createBookingInternal(client, payload, userId, policySetKey);
  }, {
    isolationLevel: "serializable",
    operationName: "create_booking",
  });
}

function normalizeCapacityResolutionMode(payload: CreateBookingPayload): CapacityResolutionMode {
  if (payload.capacityResolutionMode) return payload.capacityResolutionMode;
  return payload.useSpecialQuota === true ? "special_quota_extra" : "standard";
}

async function createBookingInternal(
  client: PoolClient,
  payload: CreateBookingPayload,
  userId: number,
  policySetKey: string
): Promise<CreateBookingResult> {
  const capacityResolutionMode = normalizeCapacityResolutionMode(payload);
  // 1. Load the published policy
  const publishedVersion = await findPublishedPolicyVersion(client, policySetKey);
  if (!publishedVersion) {
    throw new SchedulingError(
      400,
      "No scheduling policy has been published.",
      ["no_published_policy"]
    );
  }

  // 2. Integrity: check modality exists
  const modality = await findModalityById(client, payload.modalityId);
  if (!modality) {
    throw new SchedulingError(
      400,
      `Modality ${payload.modalityId} not found.`,
      ["modality_not_found"]
    );
  }

  // 3. Integrity: check exam type if provided
  let examTypeExists = true;
  let examTypeBelongsToModality = true;
  if (payload.examTypeId != null) {
    const examType = await findExamTypeById(client, payload.examTypeId);
    if (!examType) {
      throw new SchedulingError(
        400,
        `Exam type ${payload.examTypeId} not found.`,
        ["exam_type_not_found"]
      );
    }
    examTypeBelongsToModality = Number(examType.modalityId) === payload.modalityId;
    if (!examTypeBelongsToModality) {
      throw new SchedulingError(
        400,
        `Exam type ${payload.examTypeId} does not belong to modality ${payload.modalityId}.`,
        ["exam_type_modality_mismatch"]
      );
    }
  }

  // 4. Acquire both category locks for the target date (deterministic order).
  await acquireBucketLocks(client, [
    {
      modalityId: payload.modalityId,
      date: payload.bookingDate,
      caseCategory: "oncology",
    },
    {
      modalityId: payload.modalityId,
      date: payload.bookingDate,
      caseCategory: "non_oncology",
    },
  ]);

  // 5. Load all rules for re-evaluation inside the transaction
  const blockedRules = await loadModalityBlockedRules(
    client,
    publishedVersion.id,
    payload.modalityId
  );
  const examTypeRules = await loadExamTypeRules(
    client,
    publishedVersion.id,
    payload.modalityId
  );
  const categoryLimits = await loadCategoryDailyLimits(
    client,
    publishedVersion.id,
    payload.modalityId
  );
  const specialQuotas = await loadExamTypeSpecialQuotas(
    client,
    publishedVersion.id
  );

  const examTypeRuleItemExamTypeIds = await loadExamTypeRuleItemExamTypeIds(
    client,
    publishedVersion.id,
    payload.modalityId
  );
  const examMixQuotaRules = await loadExamMixQuotaRules(
    client,
    publishedVersion.id,
    payload.modalityId
  );
  const examMixQuotaRuleItems = await loadExamMixQuotaRuleItems(
    client,
    publishedVersion.id,
    payload.modalityId
  );

  // 6. Load current booked count (after lock, so this is consistent)
  const currentBookedCount = await getBookedCountForDate(
    client,
    payload.modalityId,
    payload.bookingDate,
    payload.caseCategory
  );
  const bookedCounts = await getBookedCountsByCategoryForDate(
    client,
    payload.modalityId,
    payload.bookingDate
  );

  // 7. Load special quota booked count (only when examTypeId is provided)
  let currentSpecialQuotaBookedCount = 0;
  if (payload.examTypeId != null) {
    currentSpecialQuotaBookedCount = await getSpecialQuotaBookedCount(client, {
      modalityId: payload.modalityId,
      bookingDate: payload.bookingDate,
      examTypeId: payload.examTypeId,
    });
  }
  const currentExamMixConsumedByRuleId = await getExamMixConsumedCountsByRule(client, {
    policyVersionId: publishedVersion.id,
    modalityId: payload.modalityId,
    bookingDate: payload.bookingDate,
    ruleIds: examMixQuotaRules.map((row) => Number(row.id)),
  });

  // 8. Build context and evaluate
  const context: RuleEvaluationContext = {
    policyVersionId: publishedVersion.id,
    policySetKey,
    policyVersionNo: publishedVersion.versionNo,
    policyConfigHash: publishedVersion.configHash,
    modalityExists: true,
    examTypeExists,
    examTypeBelongsToModality,
    blockedRules,
    examTypeRules,
    examTypeRuleItemExamTypeIds,
    categoryLimits,
    modalityDailyCapacity: modality.dailyCapacity ?? null,
    currentBookedCountTotal: bookedCounts.total,
    currentBookedCountOncology: bookedCounts.oncology,
    currentBookedCountNonOncology: bookedCounts.nonOncology,
    specialQuotas,
    currentBookedCount,
    currentSpecialQuotaBookedCount,
    examMixQuotaRules,
    examMixQuotaRuleItems,
    currentExamMixConsumedByRuleId,
  };

  const pureInput: PureEvaluateInput = {
    patientId: payload.patientId,
    modalityId: payload.modalityId,
    examTypeId: payload.examTypeId ?? null,
    scheduledDate: payload.bookingDate,
    caseCategory: payload.caseCategory,
    capacityResolutionMode,
    useSpecialQuota: capacityResolutionMode === "special_quota_extra",
    // `specialReasonCode` is metadata/audit justification and is not a
    // standalone scheduling rule input at this stage.
    specialReasonCode: payload.specialReasonCode ?? null,
    includeOverrideEvaluation: payload.override != null,
    context,
  };

  const decision = await pureEvaluate(pureInput);
  console.info(JSON.stringify({
    type: "appointments_v2_booking_decision",
    modalityId: payload.modalityId,
    bookingDate: payload.bookingDate,
    caseCategory: payload.caseCategory,
    examTypeId: payload.examTypeId ?? null,
    displayStatus: decision.displayStatus,
    requiresSupervisorOverride: decision.requiresSupervisorOverride,
    isAllowed: decision.isAllowed,
    reasonCodes: decision.reasons.map((r) => r.code),
  }));

  // 8. Check if booking is allowed or requires override
  let wasOverride = false;
  let supervisorUserId: number | null = null;

  if (decision.displayStatus === "blocked" && !decision.requiresSupervisorOverride) {
    // Hard block — cannot book even with override
    throw new SchedulingError(
      409,
      "Booking is not allowed for this date/category.",
      decision.reasons.map((r) => r.code),
      { decision }
    );
  }

  if (decision.requiresSupervisorOverride) {
    // Override required — validate supervisor credentials
    if (!payload.override) {
      throw new SchedulingError(
        403,
        "Supervisor override is required for this booking. Please provide supervisor credentials.",
        ["override_required"]
      );
    }

    const supervisor = await authenticateSupervisor(
      client,
      payload.override.supervisorUsername,
      payload.override.supervisorPassword
    );
    console.info(JSON.stringify({
      type: "appointments_v2_booking_override",
      modalityId: payload.modalityId,
      bookingDate: payload.bookingDate,
      requestingUserId: userId,
      supervisorUserId: supervisor.id,
    }));
    supervisorUserId = supervisor.id;
    wasOverride = true;
  }

  if (capacityResolutionMode === "special_quota_extra" && !payload.specialReasonCode) {
    throw new SchedulingError(
      400,
      "Special quota extra mode requires specialReasonCode.",
      ["special_reason_code_required"]
    );
  }

  // 9. Determine whether special quota was consumed
  const consumedSpecialQuota = decision.consumedCapacityMode === "special";

  // 10. Insert the booking
  const booking = await insertBooking(client, {
    patientId: payload.patientId,
    modalityId: payload.modalityId,
    examTypeId: payload.examTypeId ?? null,
    reportingPriorityId: payload.reportingPriorityId ?? null,
    bookingDate: payload.bookingDate,
    bookingTime: payload.bookingTime ?? null,
    caseCategory: payload.caseCategory,
    status: "scheduled",
    notes: payload.notes ?? null,
    policyVersionId: publishedVersion.id,
    capacityResolutionMode,
    usesSpecialQuota: consumedSpecialQuota,
    specialReasonCode: payload.specialReasonCode ?? null,
    specialReasonNote: payload.specialReasonNote ?? null,
    isWalkIn: payload.isWalkIn ?? false,
    userId,
  });

  // 10. Record override audit if applicable
  if (wasOverride && supervisorUserId != null) {
    await recordOverrideAudit(client, {
      bookingId: booking.id,
      patientId: payload.patientId,
      modalityId: payload.modalityId,
      examTypeId: payload.examTypeId ?? null,
      bookingDate: payload.bookingDate,
      requestingUserId: userId,
      supervisorUserId,
      overrideReason: payload.override?.reason ?? null,
      decisionSnapshot: { ...decision, capacityResolutionMode },
      outcome: "approved_and_booked",
    });
  }

  return {
    booking,
    decisionSnapshot: decision,
    wasOverride,
  };
}
