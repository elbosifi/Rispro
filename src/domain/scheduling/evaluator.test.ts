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

// ---------------------------------------------------------------------------
// displayStatus regression tests
// ---------------------------------------------------------------------------

test("blocked candidate => displayStatus === 'blocked'", () => {
  const result = evaluateSchedulingCandidate(
    baseInput(),
    baseContext({
      blockedRules: [
        {
          id: 1,
          ruleType: "specific_date",
          specificDate: "2026-04-15",
          startDate: null, endDate: null,
          recurStartMonth: null, recurStartDay: null,
          recurEndMonth: null, recurEndDay: null,
          isOverridable: false
        }
      ]
    })
  );
  assert.equal(result.isAllowed, false);
  assert.equal(result.requiresSupervisorOverride, false);
  assert.equal(result.displayStatus, "blocked");
});

test("ordinary allowed candidate => displayStatus === 'available'", () => {
  const result = evaluateSchedulingCandidate(baseInput(), baseContext());
  assert.equal(result.isAllowed, true);
  assert.equal(result.requiresSupervisorOverride, false);
  assert.equal(result.displayStatus, "available");
});

test("override-eligible candidate => displayStatus === 'restricted'", () => {
  const result = evaluateSchedulingCandidate(
    baseInput({ includeOverrideEvaluation: true }),
    baseContext({
      blockedRules: [
        {
          id: 5,
          ruleType: "date_range",
          specificDate: null,
          startDate: "2026-04-15",
          endDate: "2026-04-15",
          recurStartMonth: null, recurStartDay: null,
          recurEndMonth: null, recurEndDay: null,
          isOverridable: true
        }
      ]
    })
  );
  // The override is allowed to book, but the slot must show as restricted.
  assert.equal(result.isAllowed, true);
  assert.equal(result.requiresSupervisorOverride, true);
  assert.equal(result.displayStatus, "restricted");
});

// ---------------------------------------------------------------------------
// Integrity failure tests — all must be non-overridable blocked
// ---------------------------------------------------------------------------

function assertIntegrityBlocked(
  result: ReturnType<typeof evaluateSchedulingCandidate>,
  expectedReason: string
) {
  assert.equal(result.isAllowed, false, `isAllowed should be false for ${expectedReason}`);
  assert.equal(result.requiresSupervisorOverride, false, `requiresSupervisorOverride should be false for ${expectedReason}`);
  assert.equal(result.displayStatus, "blocked", `displayStatus should be 'blocked' for ${expectedReason}`);
  assert.ok(result.blockReasons.includes(expectedReason), `blockReasons should include '${expectedReason}'`);
}

test("integrity: modality missing => blocked", () => {
  const result = evaluateSchedulingCandidate(
    baseInput(),
    baseContext({ integrity: { modalityExists: false, examTypeExists: true, examTypeBelongsToModality: true, malformedRuleConfig: false } })
  );
  assertIntegrityBlocked(result, "modality_not_found");
});

test("integrity: exam type missing => blocked", () => {
  const result = evaluateSchedulingCandidate(
    baseInput(),
    baseContext({ integrity: { modalityExists: true, examTypeExists: false, examTypeBelongsToModality: true, malformedRuleConfig: false } })
  );
  assertIntegrityBlocked(result, "exam_type_not_found");
});

test("integrity: exam type / modality mismatch => blocked", () => {
  const result = evaluateSchedulingCandidate(
    baseInput(),
    baseContext({ integrity: { modalityExists: true, examTypeExists: true, examTypeBelongsToModality: false, malformedRuleConfig: false } })
  );
  assertIntegrityBlocked(result, "exam_type_modality_mismatch");
});

test("integrity: malformed rule configuration => blocked", () => {
  const result = evaluateSchedulingCandidate(
    baseInput(),
    baseContext({ integrity: { modalityExists: true, examTypeExists: true, examTypeBelongsToModality: true, malformedRuleConfig: true } })
  );
  assertIntegrityBlocked(result, "malformed_rule_configuration");
});

test("integrity: multiple failures => all reasons collected, still blocked", () => {
  const result = evaluateSchedulingCandidate(
    baseInput(),
    baseContext({ integrity: { modalityExists: false, examTypeExists: false, examTypeBelongsToModality: false, malformedRuleConfig: true } })
  );
  assert.equal(result.isAllowed, false);
  assert.equal(result.requiresSupervisorOverride, false);
  assert.equal(result.displayStatus, "blocked");
  assert.ok(result.blockReasons.includes("modality_not_found"));
  assert.ok(result.blockReasons.includes("exam_type_not_found"));
  assert.ok(result.blockReasons.includes("exam_type_modality_mismatch"));
  assert.ok(result.blockReasons.includes("malformed_rule_configuration"));
});
