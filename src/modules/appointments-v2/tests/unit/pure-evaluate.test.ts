/**
 * Appointments V2 — Pure evaluator unit tests.
 *
 * These tests cover the full D008 precedence chain without any DB dependency.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { pureEvaluate } from "../../rules/services/pure-evaluate.js";
import type { PureEvaluateInput } from "../../rules/models/rule-evaluation-context.js";
import type { ModalityBlockedRuleRow, ExamTypeRuleRow, CategoryDailyLimitRow, ExamTypeSpecialQuotaRow } from "../../rules/models/rule-types.js";

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

function makeContext(
  overrides: Partial<PureEvaluateInput["context"]> = {}
): PureEvaluateInput["context"] {
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
    modalityDailyCapacity: 20,
    currentBookedCountTotal: 0,
    currentBookedCountOncology: 0,
    currentBookedCountNonOncology: 0,
    specialQuotas: [],
    currentBookedCount: 0,
    currentSpecialQuotaBookedCount: 0,
    ...overrides,
  };
}

function makeInput(
  overrides: Partial<PureEvaluateInput> = {}
): PureEvaluateInput {
  const capacityResolutionMode =
    overrides.capacityResolutionMode ??
    (overrides.useSpecialQuota ? "special_quota_extra" : "standard");
  return {
    patientId: 1,
    modalityId: 10,
    examTypeId: null,
    scheduledDate: "2026-04-15",
    caseCategory: "non_oncology",
    capacityResolutionMode,
    useSpecialQuota: false,
    specialReasonCode: null,
    includeOverrideEvaluation: false,
    context: makeContext(),
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("pureEvaluate — integrity checks (D008 step 1)", () => {
  it("blocks when modality does not exist", async () => {
    const decision = await pureEvaluate(
      makeInput({ context: makeContext({ modalityExists: false }) })
    );
    assert.equal(decision.displayStatus, "blocked");
    assert.equal(decision.isAllowed, false);
    assert.ok(decision.reasons.some((r) => r.code === "modality_not_found"));
  });

  it("blocks when exam type does not exist", async () => {
    const decision = await pureEvaluate(
      makeInput({
        examTypeId: 99,
        context: makeContext({ examTypeExists: false }),
      })
    );
    assert.equal(decision.displayStatus, "blocked");
    assert.ok(decision.reasons.some((r) => r.code === "exam_type_not_found"));
  });

  it("blocks when exam type does not belong to modality", async () => {
    const decision = await pureEvaluate(
      makeInput({
        examTypeId: 99,
        context: makeContext({ examTypeBelongsToModality: false }),
      })
    );
    assert.equal(decision.displayStatus, "blocked");
    assert.ok(decision.reasons.some((r) => r.code === "exam_type_modality_mismatch"));
  });

  it("does NOT block all dates when blocked rule has incomplete config (missing specific_date)", async () => {
    // Incomplete blocked rules are silently ignored — they don't match any date.
    // This prevents draft rows with empty date fields from poisoning the entire
    // evaluation and making ALL dates appear blocked.
    const decision = await pureEvaluate(
      makeInput({
        context: makeContext({
          blockedRules: [
            {
              id: 500,
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
            },
          ],
        }),
      })
    );
    // The incomplete rule doesn't match any date, so evaluation proceeds normally
    assert.equal(decision.displayStatus, "available");
    assert.ok(!decision.reasons.some((r) => r.code === "malformed_rule_configuration"));
  });
});

describe("pureEvaluate — hard blocks (D008 step 2)", () => {
  function makeBlockedRule(
    ruleType: "specific_date" | "date_range" | "yearly_recurrence",
    isOverridable: boolean,
    extra: Record<string, unknown> = {}
  ): ModalityBlockedRuleRow {
    return {
      id: 100,
      policyVersionId: 1,
      modalityId: 10,
      ruleType,
      specificDate: null,
      startDate: null,
      endDate: null,
      recurStartMonth: null,
      recurStartDay: null,
      recurEndMonth: null,
      recurEndDay: null,
      isOverridable,
      isActive: true,
      title: null,
      notes: null,
      ...extra,
    };
  }

  it("blocks on matching specific_date (non-overridable)", async () => {
    const decision = await pureEvaluate(
      makeInput({
        scheduledDate: "2026-04-15",
        context: makeContext({
          blockedRules: [
            makeBlockedRule("specific_date", false, { specificDate: "2026-04-15" }),
          ],
        }),
      })
    );
    assert.equal(decision.displayStatus, "blocked");
    assert.equal(decision.isAllowed, false);
    assert.ok(decision.reasons.some((r) => r.code === "modality_blocked_rule_match"));
    assert.ok(decision.matchedRuleIds.includes(100));
  });

  it("does not block when specific_date does not match", async () => {
    const decision = await pureEvaluate(
      makeInput({
        scheduledDate: "2026-04-16",
        context: makeContext({
          blockedRules: [
            makeBlockedRule("specific_date", false, { specificDate: "2026-04-15" }),
          ],
        }),
      })
    );
    assert.equal(decision.displayStatus, "available");
  });

  it("marks overridable block as restricted", async () => {
    const decision = await pureEvaluate(
      makeInput({
        scheduledDate: "2026-04-15",
        context: makeContext({
          blockedRules: [
            makeBlockedRule("specific_date", true, { specificDate: "2026-04-15" }),
          ],
        }),
      })
    );
    assert.equal(decision.displayStatus, "restricted");
    assert.equal(decision.requiresSupervisorOverride, true);
    assert.ok(decision.reasons.some((r) => r.code === "modality_blocked_overridable"));
  });

  it("blocks on date_range match", async () => {
    const decision = await pureEvaluate(
      makeInput({
        scheduledDate: "2026-04-05",
        context: makeContext({
          blockedRules: [
            makeBlockedRule("date_range", false, {
              startDate: "2026-04-01",
              endDate: "2026-04-10",
            }),
          ],
        }),
      })
    );
    assert.equal(decision.displayStatus, "blocked");
  });

  it("blocks on yearly_recurrence match (Dec 20 – Jan 10)", async () => {
    const decision = await pureEvaluate(
      makeInput({
        scheduledDate: "2026-01-05",
        context: makeContext({
          blockedRules: [
            makeBlockedRule("yearly_recurrence", false, {
              recurStartMonth: 12,
              recurStartDay: 20,
              recurEndMonth: 1,
              recurEndDay: 10,
            }),
          ],
        }),
      })
    );
    assert.equal(decision.displayStatus, "blocked");
  });

  it("does not block inactive rules", async () => {
    const decision = await pureEvaluate(
      makeInput({
        scheduledDate: "2026-04-15",
        context: makeContext({
          blockedRules: [
            makeBlockedRule("specific_date", false, {
              specificDate: "2026-04-15",
              isActive: false,
            }),
          ],
        }),
      })
    );
    assert.equal(decision.displayStatus, "available");
  });
});

describe("pureEvaluate — exam eligibility (D008 step 3)", () => {
  function makeExamRule(
    effectMode: "hard_restriction" | "restriction_overridable",
    extra: Record<string, unknown> = {}
  ): ExamTypeRuleRow {
    return {
      id: 200,
      policyVersionId: 1,
      modalityId: 10,
      ruleType: "specific_date",
      effectMode,
      specificDate: "2026-04-15",
      startDate: null,
      endDate: null,
      weekday: null,
      alternateWeeks: false,
      recurrenceAnchorDate: null,
      title: null,
      notes: null,
      isActive: true,
      ...extra,
    };
  }

  it("blocks on hard_restriction exam rule", async () => {
    const decision = await pureEvaluate(
      makeInput({
        examTypeId: 50,
        scheduledDate: "2026-04-15",
        context: makeContext({
          examTypeRules: [makeExamRule("hard_restriction")],
          examTypeRuleItemExamTypeIds: [50],
        }),
      })
    );
    assert.equal(decision.displayStatus, "blocked");
    assert.ok(decision.reasons.some((r) => r.code === "exam_type_not_allowed_for_rule"));
    assert.ok(decision.matchedRuleIds.includes(200));
  });

  it("marks restriction_overridable exam rule as restricted", async () => {
    const decision = await pureEvaluate(
      makeInput({
        examTypeId: 50,
        scheduledDate: "2026-04-15",
        context: makeContext({
          examTypeRules: [makeExamRule("restriction_overridable")],
          examTypeRuleItemExamTypeIds: [50],
        }),
      })
    );
    assert.equal(decision.displayStatus, "restricted");
    assert.equal(decision.requiresSupervisorOverride, true);
  });

  it("skips exam rules when no exam type provided", async () => {
    const decision = await pureEvaluate(
      makeInput({
        examTypeId: null,
        scheduledDate: "2026-04-15",
        context: makeContext({
          examTypeRules: [makeExamRule("hard_restriction")],
          examTypeRuleItemExamTypeIds: [50],
        }),
      })
    );
    assert.equal(decision.displayStatus, "available");
  });

  it("skips exam rules when exam type is not in rule items", async () => {
    const decision = await pureEvaluate(
      makeInput({
        examTypeId: 99,
        scheduledDate: "2026-04-15",
        context: makeContext({
          examTypeRules: [makeExamRule("hard_restriction")],
          examTypeRuleItemExamTypeIds: [50], // 99 not in list
        }),
      })
    );
    assert.equal(decision.displayStatus, "available");
  });

  it("matches exam rules by per-rule exam type membership (not flattened global list)", async () => {
    const decision = await pureEvaluate(
      makeInput({
        examTypeId: 50,
        scheduledDate: "2026-04-15",
        context: makeContext({
          examTypeRules: [
            makeExamRule("hard_restriction", { id: 200, title: "Rule A hard block" }),
            makeExamRule("restriction_overridable", { id: 201, title: "Rule B overridable" }),
          ],
          examTypeRuleItemExamTypeIds: [50], // legacy flattened list says exam type is globally present
          examTypeRuleItems: [
            { ruleId: 201, examTypeId: 50 }, // but per-rule mapping only links exam type to rule 201
          ],
        }),
      })
    );

    assert.equal(decision.displayStatus, "restricted");
    assert.equal(decision.reasons.some((r) => r.code === "exam_type_not_allowed_for_rule"), true);
    assert.equal(decision.matchedRuleIds.includes(200), false);
    assert.equal(decision.matchedRuleIds.includes(201), true);
  });

  it("emits matchedExamRuleSummaries for matched exam rules", async () => {
    const decision = await pureEvaluate(
      makeInput({
        examTypeId: 50,
        scheduledDate: "2026-04-15",
        context: makeContext({
          examTypeRules: [
            makeExamRule("hard_restriction", {
              id: 202,
              title: "No CT Head on this date",
              ruleType: "specific_date",
            }),
          ],
          examTypeRuleItemExamTypeIds: [50],
          examTypeRuleItems: [{ ruleId: 202, examTypeId: 50 }],
        }),
      })
    );

    assert.ok(Array.isArray(decision.matchedExamRuleSummaries));
    assert.deepEqual(decision.matchedExamRuleSummaries?.[0], {
      ruleId: "202",
      title: "No CT Head on this date",
      ruleType: "specific_date",
      effectMode: "hard_restriction",
      isBlocking: true,
    });
  });
});

describe("pureEvaluate — capacity checks (D008 step 4)", () => {
  function makeLimit(
    dailyLimit: number,
    caseCategory: "oncology" | "non_oncology",
    isActive = true
  ): CategoryDailyLimitRow {
    return {
      id: 300,
      policyVersionId: 1,
      modalityId: 10,
      caseCategory,
      dailyLimit,
      isActive,
    };
  }

  it("available when booked count is below limit", async () => {
    const decision = await pureEvaluate(
      makeInput({
        context: makeContext({
          categoryLimits: [makeLimit(10, "non_oncology")],
          currentBookedCount: 5,
        }),
      })
    );
    assert.equal(decision.displayStatus, "available");
    assert.equal(decision.remainingStandardCapacity, 5);
  });

  it("blocks when booked count equals limit", async () => {
    const decision = await pureEvaluate(
      makeInput({
        context: makeContext({
          categoryLimits: [makeLimit(10, "non_oncology")],
          currentBookedCount: 10,
        }),
      })
    );
    assert.equal(decision.displayStatus, "blocked");
    assert.equal(decision.remainingStandardCapacity, 0);
    assert.ok(decision.reasons.some((r) => r.code === "standard_capacity_exhausted"));
  });

  it("allows when no limit is configured", async () => {
    const decision = await pureEvaluate(
      makeInput({
        context: makeContext({ categoryLimits: [] }),
      })
    );
    assert.equal(decision.displayStatus, "available");
    assert.equal(decision.remainingStandardCapacity, 20);
  });

  it("uses correct category limit (not wrong category)", async () => {
    const decision = await pureEvaluate(
      makeInput({
        caseCategory: "non_oncology",
        context: makeContext({
          categoryLimits: [makeLimit(10, "oncology")],
          currentBookedCount: 10,
        }),
      })
    );
    // Missing non_oncology limit means no category-specific cap for non_oncology.
    assert.equal(decision.displayStatus, "available");
  });

  it("enforces total modality ceiling even when selected category has reserve", async () => {
    const decision = await pureEvaluate(
      makeInput({
        caseCategory: "non_oncology",
        context: makeContext({
          modalityDailyCapacity: 10,
          categoryLimits: [makeLimit(6, "non_oncology"), makeLimit(4, "oncology")],
          currentBookedCountTotal: 10,
          currentBookedCountOncology: 4,
          currentBookedCountNonOncology: 6,
          currentBookedCount: 6,
        }),
      })
    );
    assert.equal(decision.displayStatus, "blocked");
    assert.ok(decision.reasons.some((r) => r.code === "standard_capacity_exhausted"));
  });

  it("does not derive opposite-category reserve when limit is missing", async () => {
    const decision = await pureEvaluate(
      makeInput({
        caseCategory: "oncology",
        context: makeContext({
          modalityDailyCapacity: 10,
          categoryLimits: [makeLimit(6, "non_oncology")],
          currentBookedCountTotal: 6,
          currentBookedCountOncology: 3,
          currentBookedCountNonOncology: 3,
          currentBookedCount: 3,
        }),
      })
    );
    assert.equal(decision.displayStatus, "available");
    assert.equal(decision.remainingStandardCapacity, 4);
  });

  it("allows when both limits do not sum to modality capacity", async () => {
    const decision = await pureEvaluate(
      makeInput({
        context: makeContext({
          modalityDailyCapacity: 10,
          categoryLimits: [makeLimit(7, "non_oncology"), makeLimit(4, "oncology")],
          currentBookedCountTotal: 0,
        }),
      })
    );
    assert.equal(decision.displayStatus, "available");
    assert.equal(decision.remainingStandardCapacity, 7);
  });
});

describe("pureEvaluate — special quota (D008 step 5)", () => {
  function makeQuota(
    examTypeId: number,
    dailyExtraSlots: number
  ): ExamTypeSpecialQuotaRow {
    return {
      id: 400,
      policyVersionId: 1,
      examTypeId,
      dailyExtraSlots,
      isActive: true,
    };
  }

  it("special_quota_extra can bypass exhausted standard bucket when quota exists", async () => {
    const decision = await pureEvaluate(
      makeInput({
        examTypeId: 50,
        useSpecialQuota: true,
        context: makeContext({
          categoryLimits: [
            {
              id: 300,
              policyVersionId: 1,
              modalityId: 10,
              caseCategory: "non_oncology",
              dailyLimit: 10,
              isActive: true,
            },
          ],
          currentBookedCount: 10,
          specialQuotas: [makeQuota(50, 3)],
          examTypeRuleItemExamTypeIds: [50],
        }),
      })
    );
    assert.equal(decision.displayStatus, "available");
    assert.equal(decision.consumedCapacityMode, "special");
  });

  it("blocks when special quota not requested and capacity exhausted", async () => {
    const decision = await pureEvaluate(
      makeInput({
        useSpecialQuota: false,
        context: makeContext({
          categoryLimits: [
            {
              id: 300,
              policyVersionId: 1,
              modalityId: 10,
              caseCategory: "non_oncology",
              dailyLimit: 10,
              isActive: true,
            },
          ],
          currentBookedCount: 10,
        }),
      })
    );
    assert.equal(decision.displayStatus, "blocked");
  });
});

describe("pureEvaluate — override eligibility (D008 step 6)", () => {
  it("suggests override when restricted blocks exist", async () => {
    const decision = await pureEvaluate(
      makeInput({
        scheduledDate: "2026-04-15",
        context: makeContext({
          blockedRules: [
            {
              id: 100,
              policyVersionId: 1,
              modalityId: 10,
              ruleType: "specific_date",
              specificDate: "2026-04-15",
              startDate: null,
              endDate: null,
              recurStartMonth: null,
              recurStartDay: null,
              recurEndMonth: null,
              recurEndDay: null,
              isOverridable: true,
              isActive: true,
              title: null,
              notes: null,
            },
          ],
        }),
      })
    );
    assert.equal(decision.displayStatus, "restricted");
    assert.equal(decision.requiresSupervisorOverride, true);
    assert.equal(decision.suggestedBookingMode, "override");
  });
});

describe("pureEvaluate — decision shape (D005 compliance)", () => {
  it("always includes all required fields", async () => {
    const decision = await pureEvaluate(makeInput());

    assert.equal(typeof decision.isAllowed, "boolean");
    assert.equal(typeof decision.requiresSupervisorOverride, "boolean");
    assert.ok(["available", "restricted", "blocked"].includes(decision.displayStatus));
    assert.ok(["standard", "special", "override"].includes(decision.suggestedBookingMode));
    assert.ok(
      decision.consumedCapacityMode == null ||
        ["standard", "special", "override"].includes(decision.consumedCapacityMode)
    );
    assert.ok(Array.isArray(decision.reasons));
    assert.ok(Array.isArray(decision.matchedRuleIds));
    assert.ok(decision.policyVersionRef);
    assert.ok(decision.decisionTrace);
    assert.match(decision.decisionTrace.evaluatedAt, /^\d{4}-\d{2}-\d{2}T/);
  });

  it("includes policy reference with version info", async () => {
    const decision = await pureEvaluate(
      makeInput({
        context: makeContext({
          policyVersionId: 42,
          policyVersionNo: 3,
          policyConfigHash: "sha256hash",
        }),
      })
    );
    assert.equal(decision.policyVersionRef.versionId, 42);
    assert.equal(decision.policyVersionRef.versionNo, 3);
    assert.equal(decision.policyVersionRef.configHash, "sha256hash");
  });

  it("echoes input in decisionTrace", async () => {
    const decision = await pureEvaluate(makeInput());
    assert.equal(decision.decisionTrace.input.patientId, 1);
    assert.equal(decision.decisionTrace.input.modalityId, 10);
    assert.equal(decision.decisionTrace.input.scheduledDate, "2026-04-15");
  });
});

describe("pureEvaluate — exam mix quota", () => {
  it("blocks standard mode when primary exam-mix group is exhausted", async () => {
    const decision = await pureEvaluate(
      makeInput({
        examTypeId: 50,
        capacityResolutionMode: "standard",
        context: makeContext({
          examMixQuotaRules: [
            {
              id: 901,
              policyVersionId: 1,
              modalityId: 10,
              title: "Brain MRI",
              ruleType: "specific_date",
              specificDate: "2026-04-15",
              startDate: null,
              endDate: null,
              weekday: null,
              alternateWeeks: false,
              recurrenceAnchorDate: null,
              dailyLimit: 2,
              isActive: true,
            },
          ],
          examMixQuotaRuleItems: [{ ruleId: 901, examTypeId: 50 }],
          currentExamMixConsumedByRuleId: { 901: 2 },
        }),
      })
    );
    assert.equal(decision.displayStatus, "blocked");
    assert.ok(decision.reasons.some((r) => r.code === "exam_mix_quota_exhausted"));
  });

  it("bypasses exam-mix blocking in special_quota_extra mode", async () => {
    const decision = await pureEvaluate(
      makeInput({
        examTypeId: 50,
        capacityResolutionMode: "special_quota_extra",
        useSpecialQuota: true,
        context: makeContext({
          specialQuotas: [
            { id: 1, policyVersionId: 1, examTypeId: 50, dailyExtraSlots: 1, isActive: true },
          ],
          examMixQuotaRules: [
            {
              id: 901,
              policyVersionId: 1,
              modalityId: 10,
              title: "Brain MRI",
              ruleType: "specific_date",
              specificDate: "2026-04-15",
              startDate: null,
              endDate: null,
              weekday: null,
              alternateWeeks: false,
              recurrenceAnchorDate: null,
              dailyLimit: 1,
              isActive: true,
            },
          ],
          examMixQuotaRuleItems: [{ ruleId: 901, examTypeId: 50 }],
          currentExamMixConsumedByRuleId: { 901: 1 },
          currentSpecialQuotaBookedCount: 0,
        }),
      })
    );
    assert.equal(decision.displayStatus, "available");
    assert.ok(!decision.reasons.some((r) => r.code === "exam_mix_quota_exhausted"));
  });
});
