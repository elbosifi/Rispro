/**
 * Appointments V2 — Blocked rule completeness tests.
 *
 * Proves:
 * 1. Incomplete blocked rules (empty date fields) do NOT poison the entire evaluation.
 * 2. A complete specific_date blocked rule DOES block the exact target date.
 * 3. A complete date_range blocked rule DOES block dates within the range.
 * 4. A complete yearly_recurrence blocked rule DOES block matching dates.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { pureEvaluate } from "../../rules/services/pure-evaluate.js";
import type { PureEvaluateInput, RuleEvaluationContext } from "../../rules/models/rule-evaluation-context.js";
import type { ModalityBlockedRuleRow } from "../../rules/models/rule-types.js";

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
    categoryLimits: [],
    specialQuotas: [],
    currentBookedCount: 0,
    currentSpecialQuotaBookedCount: 0,
    ...overrides,
  };
}

function makeInput(overrides: Partial<PureEvaluateInput> = {}): PureEvaluateInput {
  return {
    patientId: 1,
    modalityId: 10,
    examTypeId: null,
    scheduledDate: "2026-04-15",
    caseCategory: "non_oncology",
    useSpecialQuota: false,
    specialReasonCode: null,
    includeOverrideEvaluation: false,
    context: makeContext(),
    ...overrides,
  };
}

function makeBlockedRule(extra: Partial<ModalityBlockedRuleRow>): ModalityBlockedRuleRow {
  return {
    id: 100,
    policyVersionId: 1,
    modalityId: 10,
    ruleType: "specific_date",
    specificDate: null,
    startDate: null,
    endDate: null,
    recurStartMonth: null,
    recurStartDay: null,
    recurEndMonth: null,
    recurEndDay: null,
    isOverridable: false,
    isActive: true,
    title: null,
    notes: null,
    ...extra,
  };
}

describe("Blocked rule — incomplete rows do NOT poison evaluation", () => {
  it("incomplete specific_date (null) does not block all dates", async () => {
    const decision = await pureEvaluate(makeInput({
      context: makeContext({
        blockedRules: [makeBlockedRule({ ruleType: "specific_date", specificDate: null })],
      }),
    }));
    assert.equal(decision.displayStatus, "available", "Incomplete specific_date should NOT block");
    assert.ok(!decision.reasons.some((r) => r.code === "malformed_rule_configuration"));
  });

  it("incomplete date_range (null dates) does not block all dates", async () => {
    const decision = await pureEvaluate(makeInput({
      context: makeContext({
        blockedRules: [makeBlockedRule({ ruleType: "date_range", startDate: null, endDate: null })],
      }),
    }));
    assert.equal(decision.displayStatus, "available", "Incomplete date_range should NOT block");
  });

  it("incomplete yearly_recurrence (null months/days) does not block all dates", async () => {
    const decision = await pureEvaluate(makeInput({
      context: makeContext({
        blockedRules: [makeBlockedRule({
          ruleType: "yearly_recurrence",
          recurStartMonth: null,
          recurStartDay: null,
          recurEndMonth: null,
          recurEndDay: null,
        })],
      }),
    }));
    assert.equal(decision.displayStatus, "available", "Incomplete yearly_recurrence should NOT block");
  });

  it("multiple incomplete rules still do NOT block all dates", async () => {
    const decision = await pureEvaluate(makeInput({
      context: makeContext({
        blockedRules: [
          makeBlockedRule({ id: 1, ruleType: "specific_date", specificDate: null }),
          makeBlockedRule({ id: 2, ruleType: "date_range", startDate: null, endDate: null }),
          makeBlockedRule({ id: 3, ruleType: "yearly_recurrence", recurStartMonth: null }),
        ],
      }),
    }));
    assert.equal(decision.displayStatus, "available", "Multiple incomplete rules should NOT block");
  });
});

describe("Blocked rule — complete rows DO block the correct dates", () => {
  it("complete specific_date blocks the exact target date", async () => {
    const decision = await pureEvaluate(makeInput({
      scheduledDate: "2026-06-15",
      context: makeContext({
        blockedRules: [makeBlockedRule({
          id: 10,
          ruleType: "specific_date",
          specificDate: "2026-06-15",
        })],
      }),
    }));
    assert.equal(decision.displayStatus, "blocked", "Matching specific_date should block");
    assert.ok(decision.reasons.some((r) => r.code === "modality_blocked_rule_match"));
    assert.ok(decision.matchedRuleIds.includes(10));
  });

  it("complete specific_date does NOT block a different date", async () => {
    const decision = await pureEvaluate(makeInput({
      scheduledDate: "2026-06-16",
      context: makeContext({
        blockedRules: [makeBlockedRule({
          ruleType: "specific_date",
          specificDate: "2026-06-15",
        })],
      }),
    }));
    assert.equal(decision.displayStatus, "available", "Non-matching specific_date should NOT block");
  });

  it("complete date_range blocks dates within the range", async () => {
    const decision = await pureEvaluate(makeInput({
      scheduledDate: "2026-07-05",
      context: makeContext({
        blockedRules: [makeBlockedRule({
          ruleType: "date_range",
          startDate: "2026-07-01",
          endDate: "2026-07-10",
        })],
      }),
    }));
    assert.equal(decision.displayStatus, "blocked", "Date within range should be blocked");
  });

  it("complete date_range does NOT block dates outside the range", async () => {
    const decision = await pureEvaluate(makeInput({
      scheduledDate: "2026-07-15",
      context: makeContext({
        blockedRules: [makeBlockedRule({
          ruleType: "date_range",
          startDate: "2026-07-01",
          endDate: "2026-07-10",
        })],
      }),
    }));
    assert.equal(decision.displayStatus, "available", "Date outside range should NOT be blocked");
  });

  it("complete yearly_recurrence blocks matching dates (Dec 20 – Jan 10)", async () => {
    const decision = await pureEvaluate(makeInput({
      scheduledDate: "2027-01-05",
      context: makeContext({
        blockedRules: [makeBlockedRule({
          ruleType: "yearly_recurrence",
          recurStartMonth: 12,
          recurStartDay: 20,
          recurEndMonth: 1,
          recurEndDay: 10,
        })],
      }),
    }));
    assert.equal(decision.displayStatus, "blocked", "Date matching yearly recurrence should be blocked");
  });

  it("complete yearly_recurrence does NOT block non-matching dates", async () => {
    const decision = await pureEvaluate(makeInput({
      scheduledDate: "2026-06-15",
      context: makeContext({
        blockedRules: [makeBlockedRule({
          ruleType: "yearly_recurrence",
          recurStartMonth: 12,
          recurStartDay: 20,
          recurEndMonth: 1,
          recurEndDay: 10,
        })],
      }),
    }));
    assert.equal(decision.displayStatus, "available", "Non-matching date should NOT be blocked");
  });
});
