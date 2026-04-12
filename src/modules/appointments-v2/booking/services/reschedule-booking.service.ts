/**
 * Appointments V2 — Reschedule booking service.
 *
 * Transactional: finds booking → releases old bucket → acquires new bucket lock
 * → re-evaluates → updates booking → records override audit if applicable.
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
import { getBookedCountForDate } from "../../scheduler/repositories/capacity.repo.js";
import { findBookingById, updateBookingStatus, updateBookingDateTime, insertBooking } from "../repositories/booking.repo.js";
import { acquireBucketLock } from "../repositories/bucket-mutex.repo.js";
import { recordOverrideAudit } from "../repositories/override-audit.repo.js";
import { authenticateSupervisor } from "../utils/authenticate-supervisor.js";
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
  policySetKey: string = "default"
): Promise<RescheduleBookingResult> {
  return withTransaction(async (client) => {
    return rescheduleBookingInternal(client, bookingId, newDate, newTime, userId, override, policySetKey);
  });
}

async function rescheduleBookingInternal(
  client: PoolClient,
  bookingId: number,
  newDate: string | null,
  newTime: string | null,
  userId: number,
  override: CreateBookingPayload["override"] | undefined,
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

  // If the date hasn't changed (or no new date provided), just update the time — no re-evaluation needed
  if (!newDate || previousDate === newDate) {
    return rescheduleTimeOnly(client, bookingId, newTime, userId, previousDate);
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

  // 6. Build context and re-evaluate
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
  };

  const pureInput: PureEvaluateInput = {
    patientId: booking.patientId,
    modalityId: booking.modalityId,
    examTypeId: booking.examTypeId,
    scheduledDate: newDate,
    caseCategory: booking.caseCategory,
    useSpecialQuota: false,
    specialReasonCode: null,
    includeOverrideEvaluation: override != null,
    context,
  };

  const decision = await pureEvaluate(pureInput);

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
    supervisorUserId = supervisor.id;
    wasOverride = true;
  }

  // 8. Cancel the old booking and insert a new one on the new date
  // This maintains a clean audit trail: old booking stays as "cancelled",
  // new booking is "scheduled" with its own ID.
  await updateBookingStatus(client, bookingId, "cancelled", userId);

  const newBooking = await insertBooking(client, {
    patientId: booking.patientId,
    modalityId: booking.modalityId,
    examTypeId: booking.examTypeId,
    reportingPriorityId: booking.reportingPriorityId,
    bookingDate: newDate,
    bookingTime: newTime,
    caseCategory: booking.caseCategory,
    status: "scheduled",
    notes: booking.notes,
    policyVersionId: publishedVersion.id,
    userId,
  });

  if (wasOverride && supervisorUserId != null) {
    await recordOverrideAudit(client, {
      bookingId: newBooking.id,
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

  return {
    booking: newBooking,
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
  previousDate: string
): Promise<RescheduleBookingResult> {
  await updateBookingDateTime(client, bookingId, previousDate, newTime, userId);

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
