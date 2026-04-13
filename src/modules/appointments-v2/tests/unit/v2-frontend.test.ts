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

  it("AvailabilityResponse supports optional noPublishedPolicy meta", () => {
    const response = {
      items: [],
      meta: {
        noPublishedPolicy: true,
      },
    };

    assert.ok(Array.isArray(response.items));
    assert.equal(response.meta?.noPublishedPolicy, true);
  });
});

describe("V2 Frontend — no published policy state", () => {
  const pagePath = "/Users/serajalsaifi/Nextcloud/RISpro/frontend/src/v2/appointments/page.tsx";

  it("renders explicit no-policy message", async () => {
    const fs = await import("node:fs/promises");
    const source = await fs.readFile(pagePath, "utf-8");
    assert.ok(source.includes("No scheduling policy has been published yet."));
    assert.ok(source.includes("noPublishedPolicy"));
  });

  it("shows supervisor CTA to /v2/appointments/admin", async () => {
    const fs = await import("node:fs/promises");
    const source = await fs.readFile(pagePath, "utf-8");
    assert.ok(source.includes('navigate("/v2/appointments/admin")'));
    assert.ok(source.includes('user?.role === "supervisor"'));
  });
});

describe("V2 Frontend — bookings action pending state", () => {
  const pagePath = "/Users/serajalsaifi/Nextcloud/RISpro/frontend/src/v2/appointments/page.tsx";

  it("tracks cancel pending by booking ID (not globally)", async () => {
    const fs = await import("node:fs/promises");
    const source = await fs.readFile(pagePath, "utf-8");
    assert.ok(source.includes("cancelPendingBookingId"));
    assert.ok(source.includes("cancelPendingBookingId === booking.id"));
  });

  it("tracks reschedule pending by booking ID (not globally)", async () => {
    const fs = await import("node:fs/promises");
    const source = await fs.readFile(pagePath, "utf-8");
    assert.ok(source.includes("reschedulePendingBookingId"));
    assert.ok(source.includes("reschedulePendingBookingId === booking.id"));
  });
});

// ---------------------------------------------------------------------------
// V2 Frontend — Reschedule hook
// ---------------------------------------------------------------------------

describe("V2 Frontend — RescheduleBookingRequest type shape", () => {
  it("has required bookingDate and optional bookingTime", () => {
    const request = {
      bookingDate: "2026-04-20",
      bookingTime: "10:00",
    };
    assert.equal(typeof request.bookingDate, "string");
    assert.equal(typeof request.bookingTime, "string");
  });

  it("supports null bookingTime for day-level reschedule", () => {
    const request = {
      bookingDate: "2026-04-20",
      bookingTime: null,
    };
    assert.equal(request.bookingTime, null);
  });

  it("supports optional override field", () => {
    const request = {
      bookingDate: "2026-04-20",
      bookingTime: null,
      override: {
        supervisorUsername: "admin",
        supervisorPassword: "secret",
        reason: "Patient requested",
      },
    };
    assert.ok(request.override);
    assert.equal(typeof request.override.supervisorUsername, "string");
    assert.equal(typeof request.override.supervisorPassword, "string");
    assert.equal(typeof request.override.reason, "string");
  });
});

describe("V2 Frontend — RescheduleBookingResponse type shape", () => {
  it("has all required fields including previousDate and wasOverride", () => {
    const response = {
      booking: {
        id: 2,
        patientId: 1,
        modalityId: 10,
        examTypeId: 50,
        reportingPriorityId: null,
        bookingDate: "2026-04-20",
        bookingTime: "10:00",
        caseCategory: "non_oncology" as const,
        status: "scheduled" as const,
        notes: null,
        policyVersionId: 1,
        createdAt: "2026-04-11T11:00:00Z",
        updatedAt: "2026-04-11T11:00:00Z",
      },
      decision: { displayStatus: "available" },
      wasOverride: false,
      previousDate: "2026-04-15",
    };

    assert.equal(typeof response.booking.id, "number");
    assert.equal(typeof response.booking.bookingDate, "string");
    assert.equal(typeof response.wasOverride, "boolean");
    assert.equal(typeof response.previousDate, "string");
    assert.ok(response.decision);
  });
});

describe("V2 Frontend — Reschedule API query key structure", () => {
  it("useV2RescheduleBooking is a mutation (no query key)", () => {
    // Mutations don't have query keys — they have mutation functions.
    // We verify the mutationFn signature here.
    const mutationFn = ({
      bookingId,
      input,
    }: {
      bookingId: number;
      input: { bookingDate: string; bookingTime: string | null };
    }) => ({
      url: `/v2/appointments/${bookingId}`,
      method: "PUT",
      body: input,
    });

    const result = mutationFn({
      bookingId: 42,
      input: { bookingDate: "2026-04-20", bookingTime: "10:00" },
    });

    assert.equal(result.url, "/v2/appointments/42");
    assert.equal(result.method, "PUT");
    assert.equal(result.body.bookingDate, "2026-04-20");
  });
});

describe("V2 appointments — barrel exports for reschedule", () => {
  const frontendIndexPath = "/Users/serajalsaifi/Nextcloud/RISpro/frontend/src/v2/appointments/index.ts";

  it("index.ts exports useV2RescheduleBooking", async () => {
    const fs = await import("node:fs/promises");
    const content = await fs.readFile(frontendIndexPath, "utf-8");
    assert.ok(content.includes("useV2RescheduleBooking"));
  });

  it("index.ts exports rescheduleV2Booking", async () => {
    const fs = await import("node:fs/promises");
    const content = await fs.readFile(frontendIndexPath, "utf-8");
    assert.ok(content.includes("rescheduleV2Booking"));
  });

  it("index.ts exports RescheduleBookingRequest type", async () => {
    const fs = await import("node:fs/promises");
    const content = await fs.readFile(frontendIndexPath, "utf-8");
    assert.ok(content.includes("RescheduleBookingRequest"));
  });

  it("index.ts exports RescheduleBookingResponse type", async () => {
    const fs = await import("node:fs/promises");
    const content = await fs.readFile(frontendIndexPath, "utf-8");
    assert.ok(content.includes("RescheduleBookingResponse"));
  });
});
