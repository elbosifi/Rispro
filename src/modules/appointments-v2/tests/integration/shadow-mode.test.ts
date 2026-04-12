/**
 * Shadow Mode Integration Tests
 *
 * Tests shadow mode diff computation and logging against real PostgreSQL.
 * These tests verify:
 * 1. compareLegacyVsV2 correctly classifies outcomes (match/mismatch/v2_stricter/v2_looser)
 * 2. logShadowDiffs produces valid JSON-lines output
 * 3. isShadowModeEnabled respects SHADOW_MODE_ENABLED env var
 *
 * Run: node --test --experimental-strip-types 'src/modules/appointments-v2/tests/integration/shadow-mode.test.ts'
 */

import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import type { BookingDecision } from "../../rules/models/booking-decision.js";
import {
  compareLegacyVsV2,
  summarizeShadowDiffs,
  logShadowDiffs,
} from "../../observability/shadow-diff.js";
import { isShadowModeEnabled } from "../../observability/shadow-availability.js";
import { isDatabaseAvailable, seedTestData, setupTestDatabase } from "./helpers.js";

// Helper to create a valid BookingDecision object
function createMockDecision(
  isAllowed: boolean,
  displayStatus: "available" | "restricted" | "blocked"
): BookingDecision {
  return {
    isAllowed,
    requiresSupervisorOverride: false,
    displayStatus,
    suggestedBookingMode: isAllowed ? "standard" : "override",
    consumedCapacityMode: isAllowed ? "standard" : null,
    remainingStandardCapacity: isAllowed ? 10 : 0,
    remainingSpecialQuota: 0,
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
        patientId: 0,
        modalityId: 1,
        scheduledDate: "2026-04-15",
        caseCategory: "non_oncology",
      },
    },
  };
}

// Synchronous skip check at module load time
const skipEnv = !isDatabaseAvailable() ? "DATABASE_URL not set" : undefined;

describe("Shadow Mode Integration Tests", { skip: skipEnv }, () => {
  let testDb: Awaited<ReturnType<typeof setupTestDatabase>>;

  before(async () => {
    testDb = await setupTestDatabase();
    await seedTestData(testDb.schemaName);
  });

  after(async () => {
    await testDb.cleanup();
  });

  describe("compareLegacyVsV2 — outcome classification", () => {
    it("classifies match when both legacy and V2 allow booking", () => {
      const v2Decision = createMockDecision(true, "available");
      const diff = compareLegacyVsV2(
        "2026-04-15",
        1,
        null,
        "non_oncology",
        { isBookable: true, displayStatus: "available" },
        v2Decision
      );

      assert.equal(diff.outcome, "match");
      assert.equal(diff.date, "2026-04-15");
      assert.equal(diff.modalityId, 1);
      assert.equal(diff.caseCategory, "non_oncology");
      assert.ok(!diff.diffDetails, "Should not have diffDetails for match");
    });

    it("detects v2_stricter when V2 blocks what legacy allowed", () => {
      const v2Decision = createMockDecision(false, "blocked");
      v2Decision.reasons = [{ code: "exam_eligibility_failed", severity: "error", message: "Exam not allowed" }];
      
      const diff = compareLegacyVsV2(
        "2026-04-15",
        1,
        50,
        "oncology",
        { isBookable: true, displayStatus: "available" },
        v2Decision
      );

      assert.equal(diff.outcome, "v2_stricter");
      assert.ok(diff.diffDetails, "Should have diffDetails for mismatch");
      assert.equal(diff.diffDetails?.legacyStatus, "available");
      assert.equal(diff.diffDetails?.v2Status, "blocked");
      assert.equal(diff.diffDetails?.legacyAllowed, true);
      assert.equal(diff.diffDetails?.v2Allowed, false);
    });

    it("detects v2_looser when V2 allows what legacy blocked", () => {
      const v2Decision = createMockDecision(true, "restricted");
      v2Decision.requiresSupervisorOverride = true;
      v2Decision.reasons = [{ code: "requires_override", severity: "warning", message: "Override required" }];
      
      const diff = compareLegacyVsV2(
        "2026-04-15",
        1,
        null,
        "non_oncology",
        { isBookable: false, displayStatus: "blocked" },
        v2Decision
      );

      assert.equal(diff.outcome, "v2_looser");
      assert.ok(diff.diffDetails, "Should have diffDetails for mismatch");
      assert.equal(diff.diffDetails?.legacyStatus, "blocked");
      assert.equal(diff.diffDetails?.v2Status, "restricted");
    });
  });

  describe("logShadowDiffs — JSON-lines output", () => {
    it("produces valid JSON-lines with shadow_diff and shadow_summary entries", () => {
      const entries = [
        compareLegacyVsV2(
          "2026-04-15",
          1,
          null,
          "non_oncology",
          { isBookable: true },
          createMockDecision(false, "blocked")
        ),
        compareLegacyVsV2(
          "2026-04-16",
          1,
          null,
          "non_oncology",
          { isBookable: true },
          createMockDecision(true, "available")
        ),
      ];

      // Capture console.log output
      const loggedLines: string[] = [];
      const originalLog = console.log;
      console.log = (msg: string) => {
        loggedLines.push(msg);
      };

      try {
        logShadowDiffs(entries);

        // Should have at least 2 lines: 1 shadow_diff + 1 shadow_summary
        assert.ok(loggedLines.length >= 2, `Expected at least 2 log lines, got ${loggedLines.length}`);

        // Parse and verify JSON structure
        const shadowDiffLines = loggedLines.filter((line) => {
          try {
            const parsed = JSON.parse(line);
            return parsed.type === "shadow_diff";
          } catch {
            return false;
          }
        });

        const summaryLines = loggedLines.filter((line) => {
          try {
            const parsed = JSON.parse(line);
            return parsed.type === "shadow_summary";
          } catch {
            return false;
          }
        });

        assert.equal(shadowDiffLines.length, 1, "Should have exactly 1 shadow_diff line");
        assert.equal(summaryLines.length, 1, "Should have exactly 1 shadow_summary line");

        // Verify shadow_diff structure
        const shadowDiff = JSON.parse(shadowDiffLines[0]);
        assert.equal(shadowDiff.date, "2026-04-15");
        assert.equal(shadowDiff.outcome, "v2_stricter");

        // Verify summary structure
        const summary = JSON.parse(summaryLines[0]);
        assert.equal(summary.total, 2);
        assert.equal(summary.mismatches, 1);
        assert.equal(summary.v2Stricter, 1);
        assert.equal(summary.v2Looser, 0);
        assert.ok(typeof summary.mismatchRate === "number", "Should have mismatchRate");
      } finally {
        console.log = originalLog;
      }
    });
  });

  describe("isShadowModeEnabled — env var gating", () => {
    it("returns false when SHADOW_MODE_ENABLED is not set", () => {
      const originalValue = process.env.SHADOW_MODE_ENABLED;
      delete process.env.SHADOW_MODE_ENABLED;

      try {
        const enabled = isShadowModeEnabled();
        assert.equal(enabled, false, "Shadow mode should be disabled by default");
      } finally {
        if (originalValue !== undefined) {
          process.env.SHADOW_MODE_ENABLED = originalValue;
        }
      }
    });

    it("returns true when SHADOW_MODE_ENABLED=true", () => {
      const originalValue = process.env.SHADOW_MODE_ENABLED;
      process.env.SHADOW_MODE_ENABLED = "true";

      try {
        const enabled = isShadowModeEnabled();
        assert.equal(enabled, true, "Shadow mode should be enabled when env var is 'true'");
      } finally {
        if (originalValue !== undefined) {
          process.env.SHADOW_MODE_ENABLED = originalValue;
        } else {
          delete process.env.SHADOW_MODE_ENABLED;
        }
      }
    });
  });
});
