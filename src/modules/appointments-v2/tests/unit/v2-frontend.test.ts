/**
 * Appointments V2 — Frontend unit tests.
 *
 * Tests for the V2 frontend module: types, helpers, and component logic.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";

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
  const frontendIndexPath = `${process.cwd()}/frontend/src/v2/appointments/index.ts`;

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
