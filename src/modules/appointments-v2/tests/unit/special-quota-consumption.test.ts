/**
 * Appointments V2 — Special quota consumption unit tests.
 *
 * Tests the pureEvaluate special quota logic with consumed count:
 * - remainingSpecialQuota = dailyExtraSlots - currentSpecialQuotaBookedCount
 * - quota becomes unavailable when consumed count reaches dailyExtraSlots
 * - no special quota when examTypeId is null
 * - standard capacity takes precedence over special quota
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { pureEvaluate } from "../../rules/services/pure-evaluate.js";
import type { PureEvaluateInput, RuleEvaluationContext } from "../../rules/models/rule-evaluation-context.js";

function makeContext(overrides: Partial<RuleEvaluationContext> = {}): RuleEvaluationContext {
  return {
    policyVersionId: 1,
    policySetKey: "default",
    policyVersionNo: 1,
    policyConfigHash: "abc123",
    modalityExists: true,
    examTypeExists: true,
    examTypeBelongsToModality: true,
    blockedRules: [],
    examTypeRules: [],
    examTypeRuleItemExamTypeIds: [],
    categoryLimits: [
      { id: 1, policyVersionId: 1, modalityId: 1, caseCategory: "non_oncology", dailyLimit: 5, isActive: true },
    ],
    modalityDailyCapacity: 5,
    currentBookedCountTotal: 0,
    currentBookedCountOncology: 0,
    currentBookedCountNonOncology: 0,
    specialQuotas: [
      { id: 1, policyVersionId: 1, examTypeId: 10, dailyExtraSlots: 3, isActive: true },
    ],
    currentBookedCount: 0,
    currentSpecialQuotaBookedCount: 0,
    ...overrides,
  };
}

function makeInput(overrides: Partial<PureEvaluateInput> = {}): PureEvaluateInput {
  const capacityResolutionMode =
    overrides.capacityResolutionMode ??
    (overrides.useSpecialQuota ? "special_quota_extra" : "standard");
  return {
    patientId: 1,
    modalityId: 1,
    examTypeId: 10,
    scheduledDate: "2026-06-01",
    caseCategory: "non_oncology",
    capacityResolutionMode,
    useSpecialQuota: false,
    specialReasonCode: null,
    includeOverrideEvaluation: false,
    context: makeContext(),
    ...overrides,
  };
}

describe("Special quota consumption — pureEvaluate", () => {
  it("returns remainingSpecialQuota when capacity is available and special quota is requested", async () => {
    const input = makeInput({
      useSpecialQuota: true,
      context: makeContext({
        currentBookedCount: 2,
        currentSpecialQuotaBookedCount: 0,
      }),
    });

    const decision = await pureEvaluate(input);

    assert.strictEqual(decision.displayStatus, "available");
    assert.strictEqual(decision.remainingStandardCapacity, 3);
    assert.strictEqual(decision.remainingSpecialQuota, 3);
  });

  it("decrements remainingSpecialQuota by consumed count", async () => {
    const input = makeInput({
      useSpecialQuota: true,
      context: makeContext({
        currentBookedCount: 2,
        currentSpecialQuotaBookedCount: 1, // 1 already consumed
      }),
    });

    const decision = await pureEvaluate(input);

    assert.strictEqual(decision.displayStatus, "available");
    assert.strictEqual(decision.remainingSpecialQuota, 2); // 3 - 1 = 2
  });

  it("allows special_quota_extra when standard/category capacity is exhausted and quota exists", async () => {
    const input = makeInput({
      capacityResolutionMode: "special_quota_extra",
      useSpecialQuota: true,
      context: makeContext({
        currentBookedCount: 5, // category exhausted
        currentSpecialQuotaBookedCount: 0,
      }),
    });

    const decision = await pureEvaluate(input);

    assert.strictEqual(decision.displayStatus, "available");
    assert.strictEqual(decision.remainingStandardCapacity, 0);
    assert.strictEqual(decision.remainingSpecialQuota, 3);
  });

  it("returns available with standard capacity when not exhausted (ignores special quota)", async () => {
    const input = makeInput({
      useSpecialQuota: false,
      context: makeContext({
        currentBookedCount: 2, // 3 remaining
        currentSpecialQuotaBookedCount: 0,
      }),
    });

    const decision = await pureEvaluate(input);

    assert.strictEqual(decision.displayStatus, "available");
    assert.strictEqual(decision.remainingStandardCapacity, 3);
    assert.strictEqual(decision.remainingSpecialQuota, null);
  });

  it("returns null remainingSpecialQuota when useSpecialQuota is false", async () => {
    const input = makeInput({
      useSpecialQuota: false,
      context: makeContext({
        currentBookedCount: 2,
        currentSpecialQuotaBookedCount: 0,
      }),
    });

    const decision = await pureEvaluate(input);

    assert.strictEqual(decision.remainingSpecialQuota, null);
    assert.strictEqual(decision.displayStatus, "available");
  });

  it("blocks special_quota_extra when no examTypeId is provided", async () => {
    const input = makeInput({
      examTypeId: null,
      useSpecialQuota: true,
      context: makeContext({
        currentBookedCount: 2,
        currentSpecialQuotaBookedCount: 0,
      }),
    });

    const decision = await pureEvaluate(input);

    assert.strictEqual(decision.remainingSpecialQuota, 0);
    assert.strictEqual(decision.displayStatus, "blocked");
  });

  it("blocks special_quota_extra when no special quota is configured for exam type", async () => {
    const input = makeInput({
      examTypeId: 99, // no quota for this exam type
      useSpecialQuota: true,
      context: makeContext({
        currentBookedCount: 2,
        currentSpecialQuotaBookedCount: 0,
        specialQuotas: [
          { id: 1, policyVersionId: 1, examTypeId: 10, dailyExtraSlots: 3, isActive: true }, // quota for exam type 10, not 99
        ],
      }),
    });

    const decision = await pureEvaluate(input);

    assert.strictEqual(decision.displayStatus, "blocked");
    assert.strictEqual(decision.remainingSpecialQuota, 0);
  });

  it("returns special suggestion mode when special quota requested and available", async () => {
    const input = makeInput({
      useSpecialQuota: true,
      context: makeContext({
        currentBookedCount: 2,
        currentSpecialQuotaBookedCount: 2, // 3 - 2 = 1 remaining
      }),
    });

    const decision = await pureEvaluate(input);

    assert.strictEqual(decision.displayStatus, "available");
    assert.strictEqual(decision.remainingSpecialQuota, 1);
    assert.strictEqual(decision.suggestedBookingMode, "special");
    assert.strictEqual(decision.consumedCapacityMode, "special");
  });
});
