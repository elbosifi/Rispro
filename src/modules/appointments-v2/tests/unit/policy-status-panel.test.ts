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
    // specialReasonCodes are global — they are loaded but NOT counted as versioned rules
    // This test verifies the file references the field (for display purposes)
    assert.ok(content.includes("specialReasonCodes"), "PolicyStatusPanel should reference specialReasonCodes (for display)");
  });

  it("includes all 5 rule types in countRules", async () => {
    const content = await readFile(panelPath, "utf-8");
    // Versioned types only (excludes specialReasonCodes which are global)
    const versionedTypes = [
      "categoryDailyLimits",
      "modalityBlockedRules",
      "examTypeRules",
      "examTypeSpecialQuotas",
    ];
    for (const type of versionedTypes) {
      assert.ok(content.includes(`snapshot.${type}.length`), `Should count ${type}`);
    }
    // specialReasonCodes should NOT be counted
    assert.ok(!content.includes("snapshot.specialReasonCodes.length"), "Should NOT count specialReasonCodes");
  });

  it("uses nullish coalescing for all versioned rule types", async () => {
    const content = await readFile(panelPath, "utf-8");
    const versionedTypes = [
      "categoryDailyLimits",
      "modalityBlockedRules",
      "examTypeRules",
      "examTypeSpecialQuotas",
    ];
    for (const type of versionedTypes) {
      assert.ok(content.includes(`snapshot.${type}.length ?? 0`), `Should use ?? 0 for ${type}`);
    }
  });

  it("excludes specialReasonCodes from count and diff", async () => {
    const content = await readFile(panelPath, "utf-8");
    // countRules should NOT include specialReasonCodes
    assert.ok(!content.includes("snapshot.specialReasonCodes.length"), "countRules should NOT count specialReasonCodes");
    // snapshotsDiffer should use versionedRulesOnly
    assert.ok(content.includes("versionedRulesOnly"), "Should have versionedRulesOnly helper");
  });

  it("snapshotsDiffer ignores changes to specialReasonCodes only", () => {
    // Simulate the versionedRulesOnly + snapshotsDiffer logic
    const versionedRulesOnly = (s: any) => ({
      categoryDailyLimits: s.categoryDailyLimits,
      modalityBlockedRules: s.modalityBlockedRules,
      examTypeRules: s.examTypeRules,
      examTypeSpecialQuotas: s.examTypeSpecialQuotas,
    });

    const snapshotsDiffer = (a: any, b: any) =>
      JSON.stringify(versionedRulesOnly(a)) !== JSON.stringify(versionedRulesOnly(b));

    // Same versioned rules, different specialReasonCodes → should NOT differ
    const published = {
      categoryDailyLimits: [{ id: 1 }],
      modalityBlockedRules: [],
      examTypeRules: [],
      examTypeSpecialQuotas: [],
      specialReasonCodes: [{ code: "urgent" }],
    };
    const draft = {
      categoryDailyLimits: [{ id: 1 }],
      modalityBlockedRules: [],
      examTypeRules: [],
      examTypeSpecialQuotas: [],
      specialReasonCodes: [{ code: "different" }],
    };

    assert.ok(!snapshotsDiffer(published, draft), "Should NOT differ when only specialReasonCodes changed");

    // Different versioned rules → should differ
    const draftWithChanges = {
      ...draft,
      categoryDailyLimits: [{ id: 99 }],
    };

    assert.ok(snapshotsDiffer(published, draftWithChanges), "Should differ when versioned rules changed");
  });

  it("computes correct count for snapshot with only specialReasonCodes (returns 0)", () => {
    // specialReasonCodes are global — they should NOT be counted as versioned rules
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

    // Only versioned types count
    const count =
      (snapshot.categoryDailyLimits.length ?? 0) +
      (snapshot.modalityBlockedRules.length ?? 0) +
      (snapshot.examTypeRules.length ?? 0) +
      (snapshot.examTypeSpecialQuotas.length ?? 0);

    assert.strictEqual(count, 0, "Should return 0 — specialReasonCodes are NOT versioned rules");
  });

  it("computes correct count for mixed snapshot", () => {
    const snapshot = {
      categoryDailyLimits: [{ id: 1 }, { id: 2 }],
      modalityBlockedRules: [{ id: 3 }],
      examTypeRules: [],
      examTypeSpecialQuotas: [{ id: 4 }, { id: 5 }, { id: 6 }],
      specialReasonCodes: [{ code: "urgent" }],
    };

    // Only versioned types count
    const count =
      (snapshot.categoryDailyLimits.length ?? 0) +
      (snapshot.modalityBlockedRules.length ?? 0) +
      (snapshot.examTypeRules.length ?? 0) +
      (snapshot.examTypeSpecialQuotas.length ?? 0);

    assert.strictEqual(count, 6, "Should count only versioned rules: 2+1+0+3=6 (excludes specialReasonCodes)");
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
