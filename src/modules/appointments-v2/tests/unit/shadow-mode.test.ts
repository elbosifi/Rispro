/**
 * Appointments V2 — Shadow mode unit tests.
 *
 * Tests cover diff comparison logic, summarization, and logging.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  compareLegacyVsV2,
  summarizeShadowDiffs,
  type ShadowDiffEntry,
} from "../../observability/shadow-diff.js";
import type { BookingDecision } from "../../rules/models/booking-decision.js";

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

function makeV2Decision(
  displayStatus: "available" | "restricted" | "blocked",
  isAllowed: boolean
): BookingDecision {
  return {
    isAllowed,
    requiresSupervisorOverride: displayStatus === "restricted",
    displayStatus,
    suggestedBookingMode: displayStatus === "blocked" ? "override" : "standard",
    consumedCapacityMode: "standard",
    remainingStandardCapacity: displayStatus === "available" ? 5 : 0,
    remainingSpecialQuota: null,
    matchedRuleIds: [],
    reasons: [],
    policyVersionRef: {
      policySetKey: "default",
      versionId: 1,
      versionNo: 1,
      configHash: "abc123",
    },
    decisionTrace: {
      evaluatedAt: new Date().toISOString(),
      input: {
        patientId: 1,
        modalityId: 10,
        examTypeId: null,
        scheduledDate: "2026-04-15",
        caseCategory: "non_oncology",
        useSpecialQuota: false,
        specialReasonCode: null,
        includeOverrideEvaluation: false,
      },
    },
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("Shadow mode — compareLegacyVsV2", () => {
  it("detects a match when both allow", () => {
    const entry = compareLegacyVsV2(
      "2026-04-15",
      10,
      null,
      "non_oncology",
      { isBookable: true, displayStatus: "available" },
      makeV2Decision("available", true)
    );

    assert.equal(entry.outcome, "match");
    assert.equal(entry.date, "2026-04-15");
    assert.equal(entry.modalityId, 10);
    assert.equal(entry.caseCategory, "non_oncology");
    assert.equal(entry.diffDetails, undefined);
  });

  it("detects a match when both block", () => {
    const entry = compareLegacyVsV2(
      "2026-04-15",
      10,
      null,
      "non_oncology",
      { isBookable: false, displayStatus: "blocked" },
      makeV2Decision("blocked", false)
    );

    assert.equal(entry.outcome, "match");
    assert.equal(entry.diffDetails, undefined);
  });

  it("detects v2_stricter when V2 blocks but legacy allows", () => {
    const entry = compareLegacyVsV2(
      "2026-04-15",
      10,
      null,
      "non_oncology",
      { isBookable: true, displayStatus: "available" },
      makeV2Decision("blocked", false)
    );

    assert.equal(entry.outcome, "v2_stricter");
    assert.ok(entry.diffDetails);
    assert.equal(entry.diffDetails?.legacyAllowed, true);
    assert.equal(entry.diffDetails?.v2Allowed, false);
    assert.equal(entry.diffDetails?.legacyStatus, "available");
    assert.equal(entry.diffDetails?.v2Status, "blocked");
  });

  it("detects v2_looser when V2 allows but legacy blocks", () => {
    const entry = compareLegacyVsV2(
      "2026-04-15",
      10,
      null,
      "non_oncology",
      { isBookable: false, displayStatus: "blocked" },
      makeV2Decision("available", true)
    );

    assert.equal(entry.outcome, "v2_looser");
    assert.ok(entry.diffDetails);
    assert.equal(entry.diffDetails?.legacyAllowed, false);
    assert.equal(entry.diffDetails?.v2Allowed, true);
  });

  it("defaults legacy status to available when displayStatus is missing", () => {
    const entry = compareLegacyVsV2(
      "2026-04-15",
      10,
      null,
      "non_oncology",
      { isBookable: true }, // No displayStatus
      makeV2Decision("blocked", false)
    );

    assert.equal(entry.outcome, "v2_stricter");
    assert.equal(entry.diffDetails?.legacyStatus, "available");
  });

  it("defaults legacy status to blocked when isBookable is false and displayStatus is missing", () => {
    const entry = compareLegacyVsV2(
      "2026-04-15",
      10,
      null,
      "non_oncology",
      { isBookable: false }, // No displayStatus
      makeV2Decision("available", true)
    );

    assert.equal(entry.outcome, "v2_looser");
    assert.equal(entry.diffDetails?.legacyStatus, "blocked");
  });

  it("includes examTypeId in the entry", () => {
    const entry = compareLegacyVsV2(
      "2026-04-15",
      10,
      50,
      "oncology",
      { isBookable: true },
      makeV2Decision("available", true)
    );

    assert.equal(entry.examTypeId, 50);
    assert.equal(entry.caseCategory, "oncology");
  });
});

describe("Shadow mode — summarizeShadowDiffs", () => {
  it("summarizes a batch with all outcome types", () => {
    const entries: ShadowDiffEntry[] = [
      compareLegacyVsV2("2026-04-15", 10, null, "non_oncology", { isBookable: true }, makeV2Decision("available", true)),
      compareLegacyVsV2("2026-04-16", 10, null, "non_oncology", { isBookable: false }, makeV2Decision("blocked", false)),
      compareLegacyVsV2("2026-04-17", 10, null, "non_oncology", { isBookable: true }, makeV2Decision("blocked", false)),
      compareLegacyVsV2("2026-04-18", 10, null, "non_oncology", { isBookable: false }, makeV2Decision("available", true)),
    ];

    const summary = summarizeShadowDiffs(entries);

    assert.equal(summary.total, 4);
    assert.equal(summary.matches, 2);
    assert.equal(summary.mismatches, 2);
    assert.equal(summary.v2Stricter, 1);
    assert.equal(summary.v2Looser, 1);
    assert.equal(summary.mismatchRate, 0.5);
  });

  it("handles empty entries", () => {
    const summary = summarizeShadowDiffs([]);

    assert.equal(summary.total, 0);
    assert.equal(summary.matches, 0);
    assert.equal(summary.mismatches, 0);
    assert.equal(summary.mismatchRate, 0);
  });

  it("handles all matches", () => {
    const entries: ShadowDiffEntry[] = [
      compareLegacyVsV2("2026-04-15", 10, null, "non_oncology", { isBookable: true }, makeV2Decision("available", true)),
      compareLegacyVsV2("2026-04-16", 10, null, "non_oncology", { isBookable: false }, makeV2Decision("blocked", false)),
    ];

    const summary = summarizeShadowDiffs(entries);

    assert.equal(summary.total, 2);
    assert.equal(summary.matches, 2);
    assert.equal(summary.mismatches, 0);
    assert.equal(summary.mismatchRate, 0);
  });
});

describe("Shadow mode — isShadowModeEnabled", () => {
  it("returns false when env var is not set", async () => {
    const { isShadowModeEnabled } = await import("../../observability/shadow-availability.js");
    // The env var is not set in test environment
    assert.equal(isShadowModeEnabled(), false);
  });
});
