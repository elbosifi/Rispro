import test from "node:test";
import assert from "node:assert/strict";
import { evaluateSchedulingCandidate } from "./evaluator.js";
import type { SchedulingCandidateInput, SchedulingDecisionContext } from "./types.js";

function baseInput(overrides: Partial<SchedulingCandidateInput> = {}): SchedulingCandidateInput {
  return {
    patientId: 1,
    modalityId: 1,
    examTypeId: 11,
    scheduledDate: "2026-04-15",
    scheduledTime: null,
    caseCategory: "non_oncology",
    requestedByUserId: 99,
    useSpecialQuota: false,
    specialReasonCode: null,
    specialReasonNote: null,
    includeOverrideEvaluation: false,
    ...overrides
  };
}

function baseContext(overrides: Partial<SchedulingDecisionContext> = {}): SchedulingDecisionContext {
  return {
    integrity: {
      modalityExists: true,
      examTypeExists: true,
      examTypeBelongsToModality: true,
      malformedRuleConfig: false
    },
    blockedRules: [],
    examTypeRules: [],
    capacity: {
      standardDailyCapacity: 10,
      categoryLimits: {
        oncology: 4,
        nonOncology: 8
      },
      bookedTotals: {
        total: 2,
        oncology: 1,
        nonOncology: 1
      },
      specialQuotaLimit: 2,
      specialQuotaConsumed: 0
    },
    ...overrides
  };
}

test("blocks on non-overridable blocked specific date", () => {
  const result = evaluateSchedulingCandidate(
    baseInput(),
    baseContext({
      blockedRules: [
        {
          id: 10,
          ruleType: "specific_date",
          specificDate: "2026-04-15",
          startDate: null,
          endDate: null,
          recurStartMonth: null,
          recurStartDay: null,
          recurEndMonth: null,
          recurEndDay: null,
          isOverridable: false
        }
      ]
    })
  );

  assert.equal(result.isAllowed, false);
  assert.equal(result.requiresSupervisorOverride, false);
  assert.equal(result.displayStatus, "blocked");
  assert.ok(result.blockReasons.includes("modality_blocked_rule_match"));
});

test("marks override-required when exam type restriction fails in overridable mode", () => {
  const result = evaluateSchedulingCandidate(
    baseInput({ examTypeId: 99, includeOverrideEvaluation: false }),
    baseContext({
      examTypeRules: [
        {
          id: 21,
          ruleType: "date_range",
          effectMode: "restriction_overridable",
          specificDate: null,
          startDate: "2026-04-01",
          endDate: "2026-04-30",
          weekday: null,
          alternateWeeks: false,
          recurrenceAnchorDate: null,
          allowedExamTypeIds: [11]
        }
      ]
    })
  );

  assert.equal(result.isAllowed, false);
  assert.equal(result.requiresSupervisorOverride, true);
  assert.equal(result.displayStatus, "restricted");
});

test("consumes special quota when standard capacity is exhausted and quota requested", () => {
  const result = evaluateSchedulingCandidate(
    baseInput({ useSpecialQuota: true }),
    baseContext({
      capacity: {
        standardDailyCapacity: 2,
        categoryLimits: {
          oncology: 4,
          nonOncology: 1
        },
        bookedTotals: {
          total: 2,
          oncology: 1,
          nonOncology: 1
        },
        specialQuotaLimit: 3,
        specialQuotaConsumed: 1
      }
    })
  );

  assert.equal(result.isAllowed, true);
  assert.equal(result.consumedCapacityMode, "special");
  assert.equal(result.suggestedBookingMode, "special");
  assert.equal(result.remainingSpecialQuota, 2);
});

test("allows override mode only when includeOverrideEvaluation is true", () => {
  const base = baseContext({
    capacity: {
      standardDailyCapacity: 1,
      categoryLimits: {
        oncology: 4,
        nonOncology: 1
      },
      bookedTotals: {
        total: 1,
        oncology: 0,
        nonOncology: 1
      },
      specialQuotaLimit: 0,
      specialQuotaConsumed: 0
    }
  });

  const noOverride = evaluateSchedulingCandidate(
    baseInput({ includeOverrideEvaluation: false }),
    base
  );
  assert.equal(noOverride.isAllowed, false);
  assert.equal(noOverride.requiresSupervisorOverride, true);
  assert.equal(noOverride.consumedCapacityMode, null);

  const withOverride = evaluateSchedulingCandidate(
    baseInput({ includeOverrideEvaluation: true }),
    base
  );
  assert.equal(withOverride.isAllowed, true);
  assert.equal(withOverride.requiresSupervisorOverride, true);
  assert.equal(withOverride.consumedCapacityMode, "override");
});
