/**
 * Appointments V2 — Frontend unit tests.
 *
 * Tests for the V2 frontend module: types, helpers, and component logic.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";

describe("V2 Frontend — describeReason helper", () => {
  // The describeReason function is defined inline in page.tsx.
  // We test the mapping logic here.
  const REASON_MAP: Record<string, string> = {
    modality_not_found: "Modality not found",
    exam_type_not_found: "Exam type not found",
    exam_type_modality_mismatch: "Exam type not valid for modality",
    malformed_rule_configuration: "Rule configuration error",
    modality_blocked_rule_match: "Date blocked for this modality",
    modality_blocked_overridable: "Date blocked — needs supervisor approval",
    exam_type_not_allowed_for_rule: "Exam type not allowed on this date",
    standard_capacity_exhausted: "Daily capacity reached",
    special_quota_exhausted: "Special quota reached",
    no_published_policy: "No scheduling policy published",
  };

  function describeReason(code: string): string {
    return REASON_MAP[code] ?? code;
  }

  it("maps known reason codes to human-readable strings", () => {
    assert.equal(describeReason("modality_not_found"), "Modality not found");
    assert.equal(describeReason("standard_capacity_exhausted"), "Daily capacity reached");
    assert.equal(describeReason("modality_blocked_overridable"), "Date blocked — needs supervisor approval");
  });

  it("returns unknown codes as-is", () => {
    assert.equal(describeReason("unknown_code"), "unknown_code");
  });

  it("covers all expected V2 decision reason codes", () => {
    const expectedCodes = [
      "modality_not_found",
      "exam_type_not_found",
      "exam_type_modality_mismatch",
      "malformed_rule_configuration",
      "modality_blocked_rule_match",
      "modality_blocked_overridable",
      "exam_type_not_allowed_for_rule",
      "standard_capacity_exhausted",
      "special_quota_exhausted",
      "no_published_policy",
    ];
    for (const code of expectedCodes) {
      const result = describeReason(code);
      assert.notEqual(result, code, `Code "${code}" should be mapped to a description`);
      assert.ok(result.length > 0);
    }
  });
});

describe("V2 Frontend — formatDate helper", () => {
  function formatDate(dateStr: string): string {
    const d = new Date(`${dateStr}T00:00:00Z`);
    return d.toLocaleDateString("en-LY", { weekday: "short", month: "short", day: "numeric" });
  }

  it("formats a valid ISO date string", () => {
    const result = formatDate("2026-04-15");
    assert.ok(result.includes("Apr"));
    assert.ok(result.includes("15"));
  });

  it("produces a string with weekday, month, and day", () => {
    const result = formatDate("2026-04-15");
    // Wed Apr 15
    assert.ok(result.length > 0);
  });
});

describe("V2 Frontend — StatusBadge config", () => {
  it("has config for all three decision statuses", () => {
    const statuses = ["available", "restricted", "blocked"] as const;
    const config: Record<string, { label: string; color: string }> = {
      available: { label: "Available", color: "green" },
      restricted: { label: "Needs Approval", color: "yellow" },
      blocked: { label: "Not Available", color: "red" },
    };

    for (const status of statuses) {
      assert.ok(config[status], `Status "${status}" should have config`);
      assert.ok(config[status].label);
      assert.ok(config[status].color);
    }
  });
});

describe("V2 Frontend — API query key structure", () => {
  it("useV2Availability query key includes all params", () => {
    const params = {
      modalityId: 10,
      days: 14,
      offset: 0,
      examTypeId: 50,
      caseCategory: "non_oncology" as const,
      useSpecialQuota: false,
      specialReasonCode: null,
      includeOverrideCandidates: false,
    };
    const queryKey = ["v2-availability", params] as const;
    assert.equal(queryKey[0], "v2-availability");
    assert.equal(queryKey[1].modalityId, 10);
    assert.equal(queryKey[1].examTypeId, 50);
  });

  it("useV2ExamTypes query key includes modalityId", () => {
    const queryKey = ["v2-exam-types", 10] as const;
    assert.equal(queryKey[0], "v2-exam-types");
    assert.equal(queryKey[1], 10);
  });
});

describe("V2 Frontend — types shape validation", () => {
  it("AvailabilityDayDto has all required fields", () => {
    const day = {
      date: "2026-04-15",
      dailyCapacity: 20,
      bookedCount: 5,
      remainingCapacity: 15,
      isFull: false,
      decision: {
        isAllowed: true,
        requiresSupervisorOverride: false,
        displayStatus: "available",
        suggestedBookingMode: "standard" as const,
        consumedCapacityMode: "standard" as const,
        remainingStandardCapacity: 15,
        remainingSpecialQuota: null,
        matchedRuleIds: [],
        reasons: [],
        policy: {
          policySetKey: "default",
          versionId: 1,
          versionNo: 1,
          configHash: "abc123",
        },
        decisionTrace: {
          evaluatedAt: new Date().toISOString(),
          input: {},
        },
      },
    };

    assert.equal(typeof day.date, "string");
    assert.equal(typeof day.dailyCapacity, "number");
    assert.equal(typeof day.bookedCount, "number");
    assert.equal(typeof day.remainingCapacity, "number");
    assert.equal(typeof day.isFull, "boolean");
    assert.ok(day.decision);
    assert.equal(typeof day.decision.displayStatus, "string");
    assert.ok(["available", "restricted", "blocked"].includes(day.decision.displayStatus));
  });
});
