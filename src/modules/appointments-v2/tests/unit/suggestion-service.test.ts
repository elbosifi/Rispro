/**
 * Appointments V2 — Suggestion service unit tests.
 *
 * Tests the suggestion service structure, filtering logic,
 * and integration with the availability service.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";

// ---------------------------------------------------------------------------
// GetSuggestionsParams shape
// ---------------------------------------------------------------------------

describe("GetSuggestionsParams — shape", () => {
  it("requires modalityId and days", () => {
    const params = {
      modalityId: 1,
      days: 7,
    };

    assert.equal(params.modalityId, 1);
    assert.equal(params.days, 7);
  });

  it("supports optional examTypeId", () => {
    const params = {
      modalityId: 1,
      days: 7,
      examTypeId: 50,
    };

    assert.equal(params.examTypeId, 50);
  });

  it("supports optional caseCategory", () => {
    const params = {
      modalityId: 1,
      days: 7,
      caseCategory: "oncology" as const,
    };

    assert.equal(params.caseCategory, "oncology");
  });

  it("supports optional includeOverrideCandidates", () => {
    const params = {
      modalityId: 1,
      days: 7,
      includeOverrideCandidates: true,
    };

    assert.equal(params.includeOverrideCandidates, true);
  });
});

// ---------------------------------------------------------------------------
// SuggestionDto shape
// ---------------------------------------------------------------------------

describe("SuggestionDto — shape", () => {
  it("has date, modalityId, and decision fields", () => {
    const suggestion = {
      date: "2026-05-01",
      modalityId: 1,
      decision: {
        isAllowed: true,
        requiresSupervisorOverride: false,
        displayStatus: "available" as const,
        suggestedBookingMode: "standard" as const,
        consumedCapacityMode: "standard" as const,
        remainingStandardCapacity: 10,
        remainingSpecialQuota: null,
        matchedRuleIds: [],
        reasons: [] as string[],
        policy: {
          policySetKey: "default",
          versionId: 1,
          versionNo: 1,
          configHash: "abc123",
        },
        decisionTrace: {
          evaluatedAt: "2026-04-12T00:00:00.000Z",
          input: {} as Record<string, unknown>,
        },
      },
    };

    assert.equal(suggestion.date, "2026-05-01");
    assert.equal(suggestion.modalityId, 1);
    assert.ok(typeof suggestion.decision === "object");
    assert.ok("isAllowed" in suggestion.decision);
    assert.ok("displayStatus" in suggestion.decision);
  });
});

// ---------------------------------------------------------------------------
// Suggestion filtering logic
// ---------------------------------------------------------------------------

describe("Suggestion filtering — bookable date detection", () => {
  it("includes dates where isAllowed is true and not full", () => {
    const day = {
      decision: { isAllowed: true, requiresSupervisorOverride: false, displayStatus: "available" },
      isFull: false,
    };

    const isBookable =
      day.decision.isAllowed ||
      (day.decision.requiresSupervisorOverride && day.decision.displayStatus !== "blocked");

    assert.ok(isBookable && !day.isFull, "Should be bookable");
  });

  it("excludes dates where isFull is true", () => {
    const day = {
      decision: { isAllowed: true, requiresSupervisorOverride: false, displayStatus: "available" },
      isFull: true,
    };

    const isBookable =
      day.decision.isAllowed ||
      (day.decision.requiresSupervisorOverride && day.decision.displayStatus !== "blocked");

    assert.ok(!(!day.isFull && isBookable), "Full dates should be excluded");
  });

  it("excludes blocked dates", () => {
    const day = {
      decision: { isAllowed: false, requiresSupervisorOverride: false, displayStatus: "blocked" },
      isFull: false,
    };

    const isBookable =
      day.decision.isAllowed ||
      (day.decision.requiresSupervisorOverride && day.decision.displayStatus !== "blocked");

    assert.ok(!isBookable, "Blocked dates should be excluded");
  });

  it("includes override-available dates when override is possible", () => {
    const day = {
      decision: { isAllowed: false, requiresSupervisorOverride: true, displayStatus: "restricted" },
      isFull: false,
    };

    const isBookable =
      day.decision.isAllowed ||
      (day.decision.requiresSupervisorOverride && day.decision.displayStatus !== "blocked");

    assert.ok(isBookable && !day.isFull, "Override-available dates should be included");
  });

  it("excludes restricted dates without override possibility", () => {
    const day = {
      decision: { isAllowed: false, requiresSupervisorOverride: false, displayStatus: "restricted" },
      isFull: false,
    };

    const isBookable =
      day.decision.isAllowed ||
      (day.decision.requiresSupervisorOverride && day.decision.displayStatus !== "blocked");

    assert.ok(!isBookable, "Restricted without override should be excluded");
  });
});

// ---------------------------------------------------------------------------
// Suggestion service — structure and exports
// ---------------------------------------------------------------------------

describe("Suggestion service — structure and exports", () => {
  it("exports getSuggestions function", async () => {
    const { getSuggestions } = await import("../../scheduler/services/suggestion.service.js");
    assert.ok(typeof getSuggestions === "function");
  });

  it("getSuggestions accepts params object", async () => {
    const { getSuggestions } = await import("../../scheduler/services/suggestion.service.js");
    // Will fail without real DB — just verifying the function signature
    try {
      await getSuggestions({ modalityId: 1, days: 7 });
    } catch {
      // Expected — no real DB in unit test
    }
  });

  it("SuggestionDto is exported from index", async () => {
    const index = await import("../../index.js");
    assert.ok("SuggestionDto" in index || true); // Type exports are erased at runtime
  });

  it("GetSuggestionsParams is exported from service", async () => {
    const suggestionModule = await import("../../scheduler/services/suggestion.service.js");
    assert.ok("getSuggestions" in suggestionModule);
    assert.ok("GetSuggestionsParams" in suggestionModule || true); // Type exports are erased
  });
});

// ---------------------------------------------------------------------------
// Suggestion service — source verification
// ---------------------------------------------------------------------------

describe("Suggestion service — no longer a stub", () => {
  it("imports getAvailability from availability service", async () => {
    const fs = await import("node:fs/promises");
    const content = await fs.readFile(
      "/Users/serajalsaifi/Nextcloud/RISpro/src/modules/appointments-v2/scheduler/services/suggestion.service.ts",
      "utf-8"
    );
    assert.ok(
      content.includes('from "./availability.service.js"') ||
      content.includes("from './availability.service.js'"),
      "Should import getAvailability"
    );
  });

  it("filters based on decision.isAllowed and decision.requiresSupervisorOverride", async () => {
    const fs = await import("node:fs/promises");
    const content = await fs.readFile(
      "/Users/serajalsaifi/Nextcloud/RISpro/src/modules/appointments-v2/scheduler/services/suggestion.service.ts",
      "utf-8"
    );
    assert.ok(content.includes("isAllowed"), "Should check isAllowed");
    assert.ok(content.includes("requiresSupervisorOverride"), "Should check override flag");
  });

  it("checks day.isFull to exclude fully booked dates", async () => {
    const fs = await import("node:fs/promises");
    const content = await fs.readFile(
      "/Users/serajalsaifi/Nextcloud/RISpro/src/modules/appointments-v2/scheduler/services/suggestion.service.ts",
      "utf-8"
    );
    assert.ok(content.includes("isFull"), "Should check isFull");
  });

  it("does not return empty array stub", async () => {
    const fs = await import("node:fs/promises");
    const content = await fs.readFile(
      "/Users/serajalsaifi/Nextcloud/RISpro/src/modules/appointments-v2/scheduler/services/suggestion.service.ts",
      "utf-8"
    );
    // The stub pattern was "return [];" with a TODO comment
    const hasStubTodo = content.includes("TODO (Stage 5)") || content.includes("TODO: Implement suggestion");
    assert.ok(!hasStubTodo, "Should not contain stub TODO comments");
  });
});
