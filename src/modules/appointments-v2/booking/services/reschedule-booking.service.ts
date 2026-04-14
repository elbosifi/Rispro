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
} from "../../rules/repositories/policy-rules.repo.js";
import {
  getBookedCountForDate,
  getSpecialQuotaBookedCount,
} from "../../scheduler/repositories/capacity.repo.js";
import { findBookingById, updateBookingDateTime, updateBookingForReschedule } from "../repositories/booking.repo.js";
import { acquireBucketLock } from "../repositories/bucket-mutex.repo.js";
import { recordOverrideAudit } from "../repositories/override-audit.repo.js";
import { authenticateSupervisor } from "../utils/authenticate-supervisor.js";
import { recordRescheduleAudit } from "../repositories/reschedule-audit.repo.js";
import type { Booking } from "../models/booking.js";
import type { CreateBookingPayload } from "../models/booking.js";
import { RESCHEDULABLE_STATUSES } from "../../shared/types/common.js";

export interface RescheduleBookingResult {
  booking: Booking;
  decisionSnapshot: unknown;
  wasOverride: boolean;
  previousDate: string;
}

export async function rescheduleBooking(
  bookingId: number,
  newDate: string | null,
  newTime: string | null,
  userId: number,
  override?: CreateBookingPayload["override"],
  useSpecialQuota: boolean = false,
  specialReasonCode: string | null = null,
  rescheduleReason: string | null = null,
  policySetKey: string = "default"
): Promise<RescheduleBookingResult> {
  return withTransaction(async (client) => {
    return rescheduleBookingInternal(
      client,
      bookingId,
      newDate,
      newTime,
      userId,
      override,
      useSpecialQuota,
      specialReasonCode,
      rescheduleReason,
      policySetKey
    );
  }, {
    isolationLevel: "serializable",
    operationName: "reschedule_booking",
  });
}

async function rescheduleBookingInternal(
  client: PoolClient,
  bookingId: number,
  newDate: string | null,
  newTime: string | null,
  userId: number,
  override: CreateBookingPayload["override"] | undefined,
  useSpecialQuota: boolean,
  specialReasonCode: string | null,
  rescheduleReason: string | null,
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

  // If the date hasn't changed (or no new date provided), just update the time — no re-evaluation needed
  if (!newDate || previousDate === newDate) {
    return rescheduleTimeOnly(
      client,
      bookingId,
      newTime,
      userId,
      previousDate,
      previousTime,
      override,
      rescheduleReason
    );
  }

  // 2. Acquire the NEW bucket lock (for the new date)
  await acquireBucketLock(
    client,
    booking.modalityId,
    newDate,
    booking.caseCategory
  );

  // 3. Load the published policy
  const publishedVersion = await findPublishedPolicyVersion(client, policySetKey);
  if (!publishedVersion) {
    throw new SchedulingError(
      400,
      "No scheduling policy has been published.",
      ["no_published_policy"]
    );
  }

  // 4. Load all rules for re-evaluation
  const blockedRules = await loadModalityBlockedRules(
    client,
    publishedVersion.id,
    booking.modalityId
  );
  const examTypeRules = await loadExamTypeRules(
    client,
    publishedVersion.id,
    booking.modalityId
  );
  const categoryLimits = await loadCategoryDailyLimits(
    client,
    publishedVersion.id,
    booking.modalityId
  );
  const specialQuotas = await loadExamTypeSpecialQuotas(
    client,
    publishedVersion.id
  );

  const examTypeRuleItemExamTypeIds = await loadExamTypeRuleItemExamTypeIds(
    client,
    publishedVersion.id,
    booking.modalityId
  );

  // 5. Load current booked count for the NEW date (after lock)
  // Note: the old booking is still counted here because it hasn't been updated yet
  const currentBookedCount = await getBookedCountForDate(
    client,
    booking.modalityId,
    newDate,
    booking.caseCategory
  );

  // 6. Load special quota booked count for the NEW date (only when examTypeId is provided)
  let currentSpecialQuotaBookedCount = 0;
  if (booking.examTypeId != null) {
    currentSpecialQuotaBookedCount = await getSpecialQuotaBookedCount(client, {
      modalityId: booking.modalityId,
      bookingDate: newDate,
      caseCategory: booking.caseCategory,
      examTypeId: booking.examTypeId,
    });
  }

  // 7. Build context and re-evaluate
  const context: RuleEvaluationContext = {
    policyVersionId: publishedVersion.id,
    policySetKey,
    policyVersionNo: publishedVersion.versionNo,
    policyConfigHash: publishedVersion.configHash,
    modalityExists: true,
    examTypeExists: booking.examTypeId != null,
    examTypeBelongsToModality: true, // Was already validated at creation
    blockedRules,
    examTypeRules,
    examTypeRuleItemExamTypeIds,
    categoryLimits,
    specialQuotas,
    currentBookedCount, // Includes this booking if newDate === oldDate
    currentSpecialQuotaBookedCount,
  };

  const pureInput: PureEvaluateInput = {
    patientId: booking.patientId,
    modalityId: booking.modalityId,
    examTypeId: booking.examTypeId,
    scheduledDate: newDate,
    caseCategory: booking.caseCategory,
    useSpecialQuota,
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
    modalityId: booking.modalityId,
    previousDate,
    newDate,
    caseCategory: booking.caseCategory,
    displayStatus: decision.displayStatus,
    requiresSupervisorOverride: decision.requiresSupervisorOverride,
    isAllowed: decision.isAllowed,
    reasonCodes: decision.reasons.map((r) => r.code),
  }));

  // 7. Check if reschedule is allowed or requires override
  let wasOverride = false;
  let supervisorUserId: number | null = null;

  if (decision.displayStatus === "blocked" && !decision.requiresSupervisorOverride) {
    throw new SchedulingError(
      409,
      "Reschedule is not allowed for the new date/category.",
      decision.reasons.map((r) => r.code),
      { decision }
    );
  }

  if (decision.requiresSupervisorOverride) {
    if (!override) {
      throw new SchedulingError(
        403,
        "Supervisor override is required for this reschedule.",
        ["override_required"]
      );
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

  await updateBookingForReschedule(
    client,
    bookingId,
    newDate,
    newTime,
    publishedVersion.id,
    userId,
    // Recompute uses_special_quota for the new booking state
    decision.consumedCapacityMode === "special"
  );

  if (wasOverride && supervisorUserId != null) {
    await recordOverrideAudit(client, {
      bookingId,
      patientId: booking.patientId,
      modalityId: booking.modalityId,
      examTypeId: booking.examTypeId,
      bookingDate: newDate,
      requestingUserId: userId,
      supervisorUserId,
      overrideReason: override?.reason ?? null,
      decisionSnapshot: decision,
      outcome: "approved_and_booked",
    });
  }

  await recordRescheduleAudit(client, {
    bookingId,
    previousDate,
    previousTime,
    newDate,
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
  override: CreateBookingPayload["override"] | undefined,
  rescheduleReason: string | null
): Promise<RescheduleBookingResult> {
  await updateBookingDateTime(client, bookingId, previousDate, newTime, userId);

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
  };
}
