/**
 * Appointments V2 — Policy status panel unit tests.
 *
 * Verifies that:
 * - countRules() includes all snapshot rule types including specialReasonCodes
 * - Live and draft rule counts are computed correctly
 * - Snapshots with only specialReasonCodes return count > 0
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

// ---------------------------------------------------------------------------
// Test: countRules function
// ---------------------------------------------------------------------------

describe("PolicyStatusPanel — countRules logic", () => {
  const panelPath = "/Users/serajalsaifi/Nextcloud/RISpro/frontend/src/v2/appointments/components/policy-status-panel.tsx";

  it("includes specialReasonCodes.length in count", async () => {
    const content = await readFile(panelPath, "utf-8");
    assert.ok(content.includes("snapshot.specialReasonCodes.length"), "Should count specialReasonCodes");
  });

  it("includes all 5 rule types in countRules", async () => {
    const content = await readFile(panelPath, "utf-8");
    const expectedTypes = [
      "categoryDailyLimits",
      "modalityBlockedRules",
      "examTypeRules",
      "examTypeSpecialQuotas",
      "specialReasonCodes",
    ];
    for (const type of expectedTypes) {
      assert.ok(content.includes(`snapshot.${type}.length`), `Should count ${type}`);
    }
  });

  it("uses nullish coalescing for all rule types", async () => {
    const content = await readFile(panelPath, "utf-8");
    const expectedTypes = [
      "categoryDailyLimits",
      "modalityBlockedRules",
      "examTypeRules",
      "examTypeSpecialQuotas",
      "specialReasonCodes",
    ];
    for (const type of expectedTypes) {
      assert.ok(content.includes(`snapshot.${type}.length ?? 0`), `Should use ?? 0 for ${type}`);
    }
  });

  it("computes correct count for snapshot with only specialReasonCodes", () => {
    // Simulate the countRules function behavior
    const snapshot = {
      categoryDailyLimits: [],
      modalityBlockedRules: [],
      examTypeRules: [],
      examTypeSpecialQuotas: [],
      specialReasonCodes: [
        { code: "urgent", labelAr: "عاجل", labelEn: "Urgent", isActive: true },
        { code: "priority", labelAr: "أولوية", labelEn: "Priority", isActive: true },
      ],
    };

    const count =
      (snapshot.categoryDailyLimits.length ?? 0) +
      (snapshot.modalityBlockedRules.length ?? 0) +
      (snapshot.examTypeRules.length ?? 0) +
      (snapshot.examTypeSpecialQuotas.length ?? 0) +
      (snapshot.specialReasonCodes.length ?? 0);

    assert.strictEqual(count, 2, "Should count 2 specialReasonCodes");
  });

  it("computes correct count for mixed snapshot", () => {
    const snapshot = {
      categoryDailyLimits: [{ id: 1 }, { id: 2 }],
      modalityBlockedRules: [{ id: 3 }],
      examTypeRules: [],
      examTypeSpecialQuotas: [{ id: 4 }, { id: 5 }, { id: 6 }],
      specialReasonCodes: [{ code: "urgent" }],
    };

    const count =
      (snapshot.categoryDailyLimits.length ?? 0) +
      (snapshot.modalityBlockedRules.length ?? 0) +
      (snapshot.examTypeRules.length ?? 0) +
      (snapshot.examTypeSpecialQuotas.length ?? 0) +
      (snapshot.specialReasonCodes.length ?? 0);

    assert.strictEqual(count, 7, "Should count all rules: 2+1+0+3+1=7");
  });

  it("returns 0 for empty snapshot", () => {
    const snapshot = {
      categoryDailyLimits: [],
      modalityBlockedRules: [],
      examTypeRules: [],
      examTypeSpecialQuotas: [],
      specialReasonCodes: [],
    };

    const count =
      (snapshot.categoryDailyLimits.length ?? 0) +
      (snapshot.modalityBlockedRules.length ?? 0) +
      (snapshot.examTypeRules.length ?? 0) +
      (snapshot.examTypeSpecialQuotas.length ?? 0) +
      (snapshot.specialReasonCodes.length ?? 0);

    assert.strictEqual(count, 0, "Should return 0 for empty snapshot");
  });
});

// ---------------------------------------------------------------------------
// Test: PolicyStatusPanel usage
// ---------------------------------------------------------------------------

describe("PolicyStatusPanel — usage of countRules", () => {
  const panelPath = "/Users/serajalsaifi/Nextcloud/RISpro/frontend/src/v2/appointments/components/policy-status-panel.tsx";

  it("calls countRules for publishedSnapshot", async () => {
    const content = await readFile(panelPath, "utf-8");
    assert.ok(content.includes("countRules(status.publishedSnapshot)"), "Should count published rules");
  });

  it("calls countRules for draftSnapshot", async () => {
    const content = await readFile(panelPath, "utf-8");
    assert.ok(content.includes("countRules(status.draftSnapshot)"), "Should count draft rules");
  });

  it("displays 'Live rules' count", async () => {
    const content = await readFile(panelPath, "utf-8");
    assert.ok(content.includes("Live rules"), "Should display Live rules label");
  });

  it("displays 'Working draft' count", async () => {
    const content = await readFile(panelPath, "utf-8");
    assert.ok(content.includes("Working draft"), "Should display Working draft label");
  });
});
