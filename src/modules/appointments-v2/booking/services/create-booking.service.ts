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
  loadExamTypeRuleItems,
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
import type { CapacityResolutionMode, SchedulingOverrideType } from "../../shared/types/common.js";
import { scheduleBookingWorklistSync } from "../../../../services/dicom-service.js";
import { readPatientQrSettings } from "../../public/utils/patient-qr-settings.js";
import type { Role } from "../../../../types/domain.js";
import { loadClosedWeekdays } from "../../scheduler/services/closed-weekday-settings.js";
import { resolveRequiredOverrideTypes, validateCapacityModeAuthority, validateDecisionAuthority } from "./override-authority.js";
import { assertPatientMeetsBookingQueueRequirements } from "./patient-identifier-requirement.js";
import type { ApprovedOverrideContext } from "../models/approved-override-context.js";
import {
  NO_SHOW_BOOKING_BLOCKED_MESSAGE,
  authorizeNoShowBookingRestriction,
  isNoShowBookingBlocked
} from "../../../../services/patient-no-show-restriction-service.js";
import { HttpError } from "../../../../utils/http-error.js";

export interface CreateBookingResult {
  booking: Booking;
  decisionSnapshot: unknown;
  wasOverride: boolean;
}

export async function createBooking(
  payload: CreateBookingPayload,
  userId: number,
  userRole: Role | undefined,
  policySetKey: string = "default",
  approvedOverrideContext?: ApprovedOverrideContext
): Promise<CreateBookingResult> {
  const result = await withTransaction(async (client) => {
    return createBookingInternal(client, payload, userId, userRole, policySetKey, approvedOverrideContext);
  }, {
    isolationLevel: "serializable",
    operationName: "create_booking",
  });

  scheduleBookingWorklistSync(result.booking.id);
  return result;
}

function normalizeCapacityResolutionMode(payload: CreateBookingPayload): CapacityResolutionMode {
  if (payload.capacityResolutionMode) return payload.capacityResolutionMode;
  return payload.useSpecialQuota === true ? "special_quota_extra" : "standard";
}

async function resolveBookingCaseCategory(
  client: PoolClient,
  patientId: number,
  incomingCategory: CreateBookingPayload["caseCategory"]
): Promise<"oncology" | "non_oncology"> {
  if (incomingCategory === "oncology" || incomingCategory === "non_oncology") {
    return incomingCategory;
  }

  const result = await client.query<{ category: string | null }>(
    `
      select category
      from patients
      where id = $1
      limit 1
    `,
    [patientId]
  );

  const normalized = String(result.rows[0]?.category || "").trim().toLowerCase();
  return normalized === "oncology" ? "oncology" : "non_oncology";
}

export async function createBookingInternal(
  client: PoolClient,
  payload: CreateBookingPayload,
  userId: number,
  userRole: Role | undefined,
  policySetKey: string,
  approvedOverrideContext?: ApprovedOverrideContext
): Promise<CreateBookingResult> {
  const capacityResolutionMode = normalizeCapacityResolutionMode(payload);
  validateCapacityModeAuthority(userRole, capacityResolutionMode);
  await assertPatientMeetsBookingQueueRequirements(client, payload.patientId, userRole);
  let noShowAuthorization: { userId: number; reason: string } | null = null;
  if (await isNoShowBookingBlocked(client, payload.patientId)) {
    if (payload.override) {
      const supervisor = await authenticateSupervisor(
        client,
        payload.override.supervisorUsername,
        payload.override.supervisorPassword
      );
      const reason = String(payload.override.reason || "").trim();
      if (!reason) throw new HttpError(403, "No-show booking authorization reason is required.");
      noShowAuthorization = { userId: supervisor.id, reason };
    } else if (userRole === "supervisor" || userRole === "super_admin") {
      const reason = String(payload.noShowAuthorizationReason || "").trim();
      if (!reason) throw new HttpError(403, "No-show booking authorization reason is required.");
      noShowAuthorization = { userId, reason };
    } else {
      const error = new HttpError(403, NO_SHOW_BOOKING_BLOCKED_MESSAGE) as HttpError & { reasonCodes?: string[] };
      error.reasonCodes = ["patient_no_show_booking_blocked"];
      throw error;
    }
  }
  const caseCategory = await resolveBookingCaseCategory(client, payload.patientId, payload.caseCategory);
  const patientQrSettings = await readPatientQrSettings();
  const requiresReport =
    typeof payload.requiresReport === "boolean"
      ? payload.requiresReport
      : caseCategory === "oncology"
        ? patientQrSettings.defaultReportRequiredForOncology
        : patientQrSettings.defaultReportRequiredForNonOncology;
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
  const examTypeRuleItems = await loadExamTypeRuleItems(
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
    caseCategory
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
  const closedWeekdays = await loadClosedWeekdays(client);

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
    examTypeRuleItems,
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
    closedWeekdays,
    requesterRole: userRole,
    requesterUserId: userId,
  };

  const requestedOverrideType = approvedOverrideContext?.overrideType ?? payload.override?.overrideType ?? null;
  const pureInput: PureEvaluateInput = {
    patientId: payload.patientId,
    modalityId: payload.modalityId,
    examTypeId: payload.examTypeId ?? null,
    scheduledDate: payload.bookingDate,
    caseCategory,
    capacityResolutionMode,
    useSpecialQuota: capacityResolutionMode === "special_quota_extra",
    // `specialReasonCode` is metadata/audit justification and is not a
    // standalone scheduling rule input at this stage.
    specialReasonCode: payload.specialReasonCode ?? null,
    includeOverrideEvaluation: payload.override != null,
    bypassExamMixQuota: requestedOverrideType === "exam_mix_override",
    context,
  };

  const decision = await pureEvaluate(pureInput);
  console.info(JSON.stringify({
    type: "appointments_v2_booking_decision",
    modalityId: payload.modalityId,
    bookingDate: payload.bookingDate,
    caseCategory,
    examTypeId: payload.examTypeId ?? null,
    displayStatus: decision.displayStatus,
    requiresSupervisorOverride: decision.requiresSupervisorOverride,
    isAllowed: decision.isAllowed,
    reasonCodes: decision.reasons.map((r) => r.code),
  }));

  validateDecisionAuthority(decision, userRole, capacityResolutionMode);

  // 8. Check if booking is allowed or requires override
  let wasOverride = false;
  let supervisorUserId: number | null = null;
  const requiredOverrideTypes = resolveRequiredOverrideTypes(decision, capacityResolutionMode);
  if (requestedOverrideType === "exam_mix_override" && !requiredOverrideTypes.includes("exam_mix_override")) {
    requiredOverrideTypes.push("exam_mix_override");
  }

  if (decision.displayStatus === "blocked" && !decision.requiresSupervisorOverride) {
    // Hard block — cannot book even with override
    throw new SchedulingError(
      409,
      "Booking is not allowed for this date/category.",
      decision.reasons.map((r) => r.code),
      { decision }
    );
  }

  if (decision.requiresSupervisorOverride || requiredOverrideTypes.length > 0 || approvedOverrideContext) {
    // Override required — validate supervisor credentials or backend-approved deferred context.
    if (approvedOverrideContext) {
      supervisorUserId = approvedOverrideContext.approverUserId;
      wasOverride = true;
    } else if (!payload.override) {
      throw new SchedulingError(
        403,
        "Override is required for this booking. Please provide supervisor credentials.",
        ["override_required"]
      );
    } else if (!payload.override.reason?.trim()) {
      throw new SchedulingError(403, "Override reason is required.", ["override_reason_required"]);
    } else {
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

  if (noShowAuthorization) {
    await authorizeNoShowBookingRestriction(client, payload.patientId, noShowAuthorization.userId, noShowAuthorization.reason);
  }

  // 10. Insert the booking
  const booking = await insertBooking(client, {
    patientId: payload.patientId,
    modalityId: payload.modalityId,
    examTypeId: payload.examTypeId ?? null,
    reportingPriorityId: payload.reportingPriorityId ?? null,
    bookingDate: payload.bookingDate,
    bookingTime: payload.bookingTime ?? null,
    caseCategory,
    requiresReport,
    studyInstanceUid: payload.studyInstanceUid ?? null,
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
    const overrideType: SchedulingOverrideType =
      approvedOverrideContext?.overrideType ??
      (requiredOverrideTypes.includes("total_capacity_override")
        ? "total_capacity_override"
        : requiredOverrideTypes.includes("exam_mix_override")
        ? "exam_mix_override"
        : requiredOverrideTypes.includes("category_override")
        ? "category_override"
        : "closed_weekday_override");
    await recordOverrideAudit(client, {
      bookingId: booking.id,
      patientId: payload.patientId,
      modalityId: payload.modalityId,
      examTypeId: payload.examTypeId ?? null,
      bookingDate: payload.bookingDate,
      requestingUserId: approvedOverrideContext?.requesterUserId ?? userId,
      supervisorUserId,
      overrideReason: approvedOverrideContext?.reason ?? payload.override?.reason ?? null,
      overrideType,
      decisionSnapshot: approvedOverrideContext
        ? { ...decision, capacityResolutionMode, deferredApprovalRequestId: approvedOverrideContext.requestId }
        : { ...decision, capacityResolutionMode },
      outcome: "approved_and_booked",
    });
  }

  return {
    booking,
    decisionSnapshot: decision,
    wasOverride,
  };
}
