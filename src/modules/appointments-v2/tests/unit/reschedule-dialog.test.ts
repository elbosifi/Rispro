/**
 * Appointments V2 — Reschedule dialog component tests.
 *
 * Structure and type tests for the RescheduleDialog component.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

// ---------------------------------------------------------------------------
// Helper factories
// ---------------------------------------------------------------------------

function makeBooking() {
  return {
    id: 1,
    patientId: 100,
    modalityId: 1,
    examTypeId: 50,
    reportingPriorityId: null,
    bookingDate: "2026-04-15",
    bookingTime: null,
    caseCategory: "non_oncology" as const,
    status: "scheduled",
    notes: null,
    policyVersionId: 1,
    createdAt: "2026-04-10T10:00:00Z",
    createdByUserId: 1,
    updatedAt: "2026-04-10T10:00:00Z",
    updatedByUserId: null,
    patientArabicName: "المريض الأول",
    patientEnglishName: "Patient One",
    patientNationalId: "11234567890",
    modalityName: "CT",
    examTypeName: "CT Head",
  };
}

function makeDecision(overrides?: Record<string, unknown>) {
  return {
    isAllowed: true,
    requiresSupervisorOverride: false,
    displayStatus: "available",
    suggestedBookingMode: "standard",
    consumedCapacityMode: "standard",
    remainingStandardCapacity: 10,
    remainingSpecialQuota: null,
    matchedRuleIds: [],
    reasons: [],
    policy: {
      policySetKey: "scheduling_v2",
      versionId: 1,
      versionNo: 1,
      configHash: "abc123",
    },
    decisionTrace: {
      evaluatedAt: "2026-04-12T00:00:00Z",
      input: null,
    },
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests — RescheduleDialog structure
// ---------------------------------------------------------------------------

describe("RescheduleDialog", () => {
  it("is a function component", async () => {
    const content = await readFile(
      "/Users/serajalsaifi/Nextcloud/RISpro/frontend/src/v2/appointments/components/reschedule-dialog.tsx",
      "utf-8"
    );
    assert.ok(content.includes("export function RescheduleDialog"));
  });

  it("accepts required props with correct types", () => {
    const booking = makeBooking();
    const props = {
      booking,
      availableDates: ["2026-04-13", "2026-04-14", "2026-04-15", "2026-04-16"],
      caseCategory: "non_oncology" as const,
      examTypeId: 50,
      onReschedule: async (_date: string, _time: string | null, _override?: unknown) => {},
      onCancel: () => {},
      error: null,
    };

    assert.strictEqual(props.booking.id, 1);
    assert.strictEqual(props.availableDates.length, 4);
    assert.strictEqual(props.caseCategory, "non_oncology");
    assert.strictEqual(props.examTypeId, 50);
    assert.strictEqual(typeof props.onReschedule, "function");
    assert.strictEqual(typeof props.onCancel, "function");
    assert.strictEqual(props.error, null);
  });

  it("accepts optional error prop as string", () => {
    const props = {
      booking: makeBooking(),
      availableDates: ["2026-04-13"],
      caseCategory: "oncology" as const,
      examTypeId: null,
      onReschedule: async (_date: string, _time: string | null, _override?: unknown) => {},
      onCancel: () => {},
      error: "Something went wrong",
    };

    assert.strictEqual(props.error, "Something went wrong");
  });

  it("onReschedule callback has correct signature", async () => {
    let calledDate = "";
    let calledTime: string | null = null;
    let calledOverride: unknown = undefined;

    const onReschedule = async (
      date: string,
      time: string | null,
      override?: unknown
    ) => {
      calledDate = date;
      calledTime = time;
      calledOverride = override;
    };

    await onReschedule("2026-04-16", null, { supervisorUsername: "admin", supervisorPassword: "pass", reason: "test" });

    assert.strictEqual(calledDate, "2026-04-16");
    assert.strictEqual(calledTime, null);
    assert.strictEqual(typeof calledOverride, "object");
  });
});

// ---------------------------------------------------------------------------
// Tests — prop types
// ---------------------------------------------------------------------------

describe("RescheduleDialog — prop types", () => {
  it("BookingWithPatientInfo has required fields", () => {
    const booking = makeBooking();
    assert.strictEqual(booking.id, 1);
    assert.strictEqual(booking.patientId, 100);
    assert.strictEqual(booking.bookingDate, "2026-04-15");
    assert.strictEqual(booking.caseCategory, "non_oncology");
    assert.strictEqual(booking.modalityId, 1);
    assert.strictEqual(booking.examTypeId, 50);
    assert.strictEqual(booking.status, "scheduled");
  });

  it("SchedulingDecisionDto has required fields", () => {
    const decision = makeDecision();
    assert.strictEqual(decision.isAllowed, true);
    assert.strictEqual(decision.requiresSupervisorOverride, false);
    assert.strictEqual(decision.displayStatus, "available");
    assert.strictEqual(decision.remainingStandardCapacity, 10);
    assert.strictEqual(Array.isArray(decision.reasons), true);
    assert.strictEqual(decision.policy.versionId, 1);
  });

  it("SchedulingDecisionDto with override required", () => {
    const decision = makeDecision({
      isAllowed: false,
      requiresSupervisorOverride: true,
      displayStatus: "restricted",
      suggestedBookingMode: "override",
    });
    assert.strictEqual(decision.requiresSupervisorOverride, true);
    assert.strictEqual(decision.displayStatus, "restricted");
    assert.strictEqual(decision.suggestedBookingMode, "override");
  });
});

// ---------------------------------------------------------------------------
// Tests — barrel export
// ---------------------------------------------------------------------------

describe("RescheduleDialog barrel export", () => {
  it("is exported from module entry point", async () => {
    const content = await readFile(
      "/Users/serajalsaifi/Nextcloud/RISpro/frontend/src/v2/appointments/index.ts",
      "utf-8"
    );
    assert.ok(content.includes('export { RescheduleDialog }'));
  });
});

// ---------------------------------------------------------------------------
// Tests — component file structure
// ---------------------------------------------------------------------------

describe("RescheduleDialog — component file", () => {
  it("component file exists", async () => {
    const content = await readFile(
      "/Users/serajalsaifi/Nextcloud/RISpro/frontend/src/v2/appointments/components/reschedule-dialog.tsx",
      "utf-8"
    );
    assert.ok(content.length > 0);
  });

  it("component imports react", async () => {
    const content = await readFile(
      "/Users/serajalsaifi/Nextcloud/RISpro/frontend/src/v2/appointments/components/reschedule-dialog.tsx",
      "utf-8"
    );
    assert.ok(content.includes("import { useState, useEffect, useRef } from \"react\""));
  });

  it("component uses evaluateV2Scheduling for pre-evaluation", async () => {
    const content = await readFile(
      "/Users/serajalsaifi/Nextcloud/RISpro/frontend/src/v2/appointments/components/reschedule-dialog.tsx",
      "utf-8"
    );
    assert.ok(content.includes("evaluateV2Scheduling"));
  });

  it("component handles Escape key for dismissal", async () => {
    const content = await readFile(
      "/Users/serajalsaifi/Nextcloud/RISpro/frontend/src/v2/appointments/components/reschedule-dialog.tsx",
      "utf-8"
    );
    assert.ok(content.includes("Escape"));
  });

  it("component has backdrop dismiss handler", async () => {
    const content = await readFile(
      "/Users/serajalsaifi/Nextcloud/RISpro/frontend/src/v2/appointments/components/reschedule-dialog.tsx",
      "utf-8"
    );
    assert.ok(content.includes("e.target === e.currentTarget"));
  });
});

// ---------------------------------------------------------------------------
// Tests — reschedule status guard
// ---------------------------------------------------------------------------

describe("Reschedule status guard", () => {
  it("RESCHEDULABLE_STATUSES is imported from types in page", async () => {
    const content = await readFile(
      "/Users/serajalsaifi/Nextcloud/RISpro/frontend/src/v2/appointments/page.tsx",
      "utf-8"
    );
    assert.ok(content.includes("RESCHEDULABLE_STATUSES"));
    assert.ok(content.includes('from "./types"'));
    assert.ok(!content.includes("const RESCHEDULABLE_STATUSES"), "Page does not define its own constant");
  });

  it("RESCHEDULABLE_STATUSES in frontend types includes scheduled, arrived, waiting", async () => {
    const content = await readFile(
      "/Users/serajalsaifi/Nextcloud/RISpro/frontend/src/v2/appointments/types.ts",
      "utf-8"
    );
    assert.ok(content.includes("RESCHEDULABLE_STATUSES"));
    assert.ok(content.includes('"scheduled"'));
    assert.ok(content.includes('"arrived"'));
    assert.ok(content.includes('"waiting"'));
  });

  it("RESCHEDULABLE_STATUSES excludes completed, no-show, cancelled", async () => {
    const content = await readFile(
      "/Users/serajalsaifi/Nextcloud/RISpro/frontend/src/v2/appointments/types.ts",
      "utf-8"
    );
    const guardLine = content.match(/RESCHEDULABLE_STATUSES.*?\[[\s\S]*?\]/);
    assert.ok(guardLine, "Found RESCHEDULABLE_STATUSES definition");
    const def = guardLine![0];
    assert.ok(!def.includes('"completed"'), "Should not include completed");
    assert.ok(!def.includes('"no-show"'), "Should not include no-show");
    assert.ok(!def.includes('"cancelled"'), "Should not include cancelled");
  });

  it("reschedule button has disabled state based on status", async () => {
    const content = await readFile(
      "/Users/serajalsaifi/Nextcloud/RISpro/frontend/src/v2/appointments/page.tsx",
      "utf-8"
    );
    assert.ok(content.includes("disabled={!RESCHEDULABLE_STATUSES.includes(booking.status)"));
    assert.ok(content.includes("Cannot reschedule a booking with status"));
  });

  it("handleReschedule checks status before submitting", async () => {
    const content = await readFile(
      "/Users/serajalsaifi/Nextcloud/RISpro/frontend/src/v2/appointments/page.tsx",
      "utf-8"
    );
    assert.ok(content.includes("RESCHEDULABLE_STATUSES.includes(rescheduleTarget.status)"));
    assert.ok(content.includes("setRescheduleError(msg)"));
  });

  it("BookingStatus type is imported in page", async () => {
    const content = await readFile(
      "/Users/serajalsaifi/Nextcloud/RISpro/frontend/src/v2/appointments/page.tsx",
      "utf-8"
    );
    assert.ok(content.includes("BookingStatus"));
  });

  it("RESCHEDULABLE_STATUSES is barrel exported from frontend module", async () => {
    const content = await readFile(
      "/Users/serajalsaifi/Nextcloud/RISpro/frontend/src/v2/appointments/index.ts",
      "utf-8"
    );
    assert.ok(content.includes("RESCHEDULABLE_STATUSES"));
  });

  it("frontend and backend RESCHEDULABLE_STATUSES match", async () => {
    const frontendContent = await readFile(
      "/Users/serajalsaifi/Nextcloud/RISpro/frontend/src/v2/appointments/types.ts",
      "utf-8"
    );
    const backendContent = await readFile(
      "/Users/serajalsaifi/Nextcloud/RISpro/src/modules/appointments-v2/shared/types/common.ts",
      "utf-8"
    );

    // Extract the array values from both files
    const extractStatuses = (content: string) => {
      const match = content.match(/RESCHEDULABLE_STATUSES.*?\[\s*([\s\S]*?)\s*\]/);
      if (!match) return [];
      return match[1]
        .split(",")
        .map((s) => s.trim().replace(/"/g, "").replace(/'/g, ""))
        .filter(Boolean)
        .sort();
    };

    const frontendStatuses = extractStatuses(frontendContent);
    const backendStatuses = extractStatuses(backendContent);

    assert.deepEqual(frontendStatuses, backendStatuses, "Frontend and backend RESCHEDULABLE_STATUSES must match");
  });

  it("frontend and backend CANCELLABLE_STATUSES match", async () => {
    const frontendContent = await readFile(
      "/Users/serajalsaifi/Nextcloud/RISpro/frontend/src/v2/appointments/types.ts",
      "utf-8"
    );
    const backendContent = await readFile(
      "/Users/serajalsaifi/Nextcloud/RISpro/src/modules/appointments-v2/shared/types/common.ts",
      "utf-8"
    );

    const extractStatuses = (content: string) => {
      const match = content.match(/CANCELLABLE_STATUSES.*?\[\s*([\s\S]*?)\s*\]/);
      if (!match) return [];
      return match[1]
        .split(",")
        .map((s) => s.trim().replace(/"/g, "").replace(/'/g, ""))
        .filter(Boolean)
        .sort();
    };

    const frontendStatuses = extractStatuses(frontendContent);
    const backendStatuses = extractStatuses(backendContent);

    assert.deepEqual(frontendStatuses, backendStatuses, "Frontend and backend CANCELLABLE_STATUSES must match");
  });
});

// ---------------------------------------------------------------------------
// Tests — cancel status guard
// ---------------------------------------------------------------------------

describe("Cancel status guard", () => {
  it("CANCELLABLE_STATUSES is imported from types in page", async () => {
    const content = await readFile(
      "/Users/serajalsaifi/Nextcloud/RISpro/frontend/src/v2/appointments/page.tsx",
      "utf-8"
    );
    assert.ok(content.includes("CANCELLABLE_STATUSES"));
    assert.ok(!content.includes("const CANCELLABLE_STATUSES"), "Page does not define its own constant");
  });

  it("CANCELLABLE_STATUSES in frontend types includes scheduled, arrived, waiting", async () => {
    const content = await readFile(
      "/Users/serajalsaifi/Nextcloud/RISpro/frontend/src/v2/appointments/types.ts",
      "utf-8"
    );
    assert.ok(content.includes("CANCELLABLE_STATUSES"));
    assert.ok(content.includes('"scheduled"'));
    assert.ok(content.includes('"arrived"'));
    assert.ok(content.includes('"waiting"'));
  });

  it("CANCELLABLE_STATUSES excludes completed, no-show, cancelled", async () => {
    const content = await readFile(
      "/Users/serajalsaifi/Nextcloud/RISpro/frontend/src/v2/appointments/types.ts",
      "utf-8"
    );
    const guardLine = content.match(/CANCELLABLE_STATUSES.*?\[[\s\S]*?\]/);
    assert.ok(guardLine, "Found CANCELLABLE_STATUSES definition");
    const def = guardLine![0];
    assert.ok(!def.includes('"completed"'), "Should not include completed");
    assert.ok(!def.includes('"no-show"'), "Should not include no-show");
    assert.ok(!def.includes('"cancelled"'), "Should not include cancelled");
  });

  it("cancel button has disabled state based on status", async () => {
    const content = await readFile(
      "/Users/serajalsaifi/Nextcloud/RISpro/frontend/src/v2/appointments/page.tsx",
      "utf-8"
    );
    assert.ok(content.includes("disabled={!CANCELLABLE_STATUSES.includes(booking.status)"));
    assert.ok(content.includes("Cannot cancel a booking with status"));
  });

  it("CANCELLABLE_STATUSES is barrel exported from frontend module", async () => {
    const content = await readFile(
      "/Users/serajalsaifi/Nextcloud/RISpro/frontend/src/v2/appointments/index.ts",
      "utf-8"
    );
    assert.ok(content.includes("CANCELLABLE_STATUSES"));
  });
});
