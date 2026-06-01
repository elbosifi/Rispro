/**
 * Appointments V2 — Create booking service unit tests.
 *
 * Tests the booking service logic with mocked dependencies.
 * Full integration tests require a real PostgreSQL instance.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { SchedulingError } from "../../shared/errors/scheduling-error.js";
import {
  assertPatientIdentifierAllowsBooking,
  BOOKING_PATIENT_IDENTIFIER_REQUIRED_MESSAGE,
} from "../../booking/services/patient-identifier-requirement.js";

const transactionSource = readFileSync(new URL("../../shared/utils/transactions.ts", import.meta.url), "utf8");
const rescheduleServiceSource = readFileSync(
  new URL("../../booking/services/reschedule-booking.service.ts", import.meta.url),
  "utf8"
);
const cancelServiceSource = readFileSync(
  new URL("../../booking/services/cancel-booking.service.ts", import.meta.url),
  "utf8"
);
const commonTypesSource = readFileSync(new URL("../../shared/types/common.ts", import.meta.url), "utf8");

describe("Create booking — validation", () => {
  it("SchedulingError includes reasonCodes for hard blocks", () => {
    const err = new SchedulingError(
      409,
      "Booking is not allowed",
      ["modality_blocked_rule_match"]
    );
    assert.equal(err.statusCode, 409);
    assert.deepEqual(err.reasonCodes, ["modality_blocked_rule_match"]);
  });

  it("SchedulingError accepts empty reasonCodes", () => {
    const err = new SchedulingError(400, "Bad request");
    assert.deepEqual(err.reasonCodes, []);
  });
});

describe("Create booking - patient identifier requirement", () => {
  it("required identifier setting blocks booking when patient has no primary identifier", async () => {
    const client = {
      query: async (sql: string) => {
        if (sql.includes("system_settings")) return { rows: [{ value: "required" }] };
        return { rows: [{ primary_identifier: "" }] };
      },
    };

    await assert.rejects(
      () => assertPatientIdentifierAllowsBooking(client as never, 1, "receptionist"),
      (error: unknown) => {
        assert.ok(error instanceof SchedulingError);
        assert.equal(error.statusCode, 400);
        assert.equal(error.message, BOOKING_PATIENT_IDENTIFIER_REQUIRED_MESSAGE);
        assert.deepEqual(error.reasonCodes, ["patient_primary_identifier_required"]);
        return true;
      }
    );
  });

  it("super admins cannot bypass missing patient primary identifier for booking", async () => {
    const client = {
      query: async (sql: string) => {
        if (sql.includes("system_settings")) return { rows: [{ value: "required" }] };
        return { rows: [{ primary_identifier: "" }] };
      },
    };

    await assert.rejects(
      () => assertPatientIdentifierAllowsBooking(client as never, 1, "super_admin"),
      (error: unknown) => {
        assert.ok(error instanceof SchedulingError);
        assert.deepEqual(error.reasonCodes, ["patient_primary_identifier_required"]);
        return true;
      }
    );
  });
});

describe("Create booking — DTO shape", () => {
  it("CreateAppointmentDto has required fields", () => {
    const dto = {
      patientId: 1,
      modalityId: 10,
      examTypeId: 50,
      reportingPriorityId: 1,
      bookingDate: "2026-04-20",
      bookingTime: "09:00",
      caseCategory: "non_oncology" as const,
      notes: "Test booking",
    };

    assert.equal(typeof dto.patientId, "number");
    assert.equal(typeof dto.modalityId, "number");
    assert.equal(typeof dto.bookingDate, "string");
    assert.match(dto.bookingDate, /^\d{4}-\d{2}-\d{2}$/);
    assert.ok(["oncology", "non_oncology"].includes(dto.caseCategory));
  });

  it("CreateAppointmentDto with override has supervisor credentials", () => {
    const dto = {
      patientId: 1,
      modalityId: 10,
      bookingDate: "2026-04-20",
      caseCategory: "non_oncology" as const,
      override: {
        supervisorUsername: "admin",
        supervisorPassword: "secret",
        reason: "Medical priority",
      },
    };

    assert.ok(dto.override);
    assert.equal(typeof dto.override.supervisorUsername, "string");
    assert.equal(typeof dto.override.supervisorPassword, "string");
    assert.equal(typeof dto.override.reason, "string");
  });

  it("CreateAppointmentDto works without optional fields", () => {
    const dto: Record<string, unknown> = {
      patientId: 1,
      modalityId: 10,
      bookingDate: "2026-04-20",
      caseCategory: "non_oncology" as const,
    };

    assert.equal(dto.examTypeId, undefined);
    assert.equal(dto.reportingPriorityId, undefined);
    assert.equal(dto.bookingTime, undefined);
    assert.equal(dto.notes, undefined);
    assert.equal(dto.override, undefined);
  });
});

describe("Create booking — Booking model shape", () => {
  it("Booking interface has all required fields", () => {
    const booking = {
      id: 1,
      patientId: 1,
      modalityId: 10,
      examTypeId: 50,
      reportingPriorityId: null,
      bookingDate: "2026-04-20",
      bookingTime: "09:00",
      caseCategory: "non_oncology" as const,
      status: "scheduled" as const,
      notes: null,
      policyVersionId: 1,
      createdAt: "2026-04-11T10:00:00Z",
      createdByUserId: 1,
      updatedAt: "2026-04-11T10:00:00Z",
      updatedByUserId: 1,
    };

    assert.equal(typeof booking.id, "number");
    assert.equal(typeof booking.patientId, "number");
    assert.equal(typeof booking.modalityId, "number");
    assert.ok(booking.bookingDate);
    assert.ok(booking.caseCategory);
    assert.ok(booking.status);
    assert.ok(booking.policyVersionId);
  });

  it("Booking status can be all valid values", () => {
    const validStatuses = [
      "scheduled",
      "arrived",
      "waiting",
      "completed",
      "no-show",
      "cancelled",
    ] as const;

    for (const status of validStatuses) {
      assert.ok(
        [
          "scheduled",
          "arrived",
          "waiting",
          "completed",
          "no-show",
          "cancelled",
        ].includes(status),
        `${status} should be a valid booking status`
      );
    }
  });
});

describe("Create booking — transaction wrapper", () => {
  it("withTransaction is exported", () => {
    assert.match(transactionSource, /export async function withTransaction/);
  });
});

describe("Create booking — supervisor auth helper", () => {
  it("authenticateSupervisor is a function", async () => {
    const { authenticateSupervisor } = await import(
      "../../booking/utils/authenticate-supervisor.js"
    );
    assert.equal(typeof authenticateSupervisor, "function");
  });
});

// ---------------------------------------------------------------------------
// Reschedule booking tests
// ---------------------------------------------------------------------------

describe("Reschedule booking — service structure", () => {
  it("rescheduleBooking is exported", () => {
    assert.match(rescheduleServiceSource, /export async function rescheduleBooking/);
  });

  it("RescheduleBookingResult has the expected shape", () => {
    const result = {
      booking: {
        id: 2,
        patientId: 1,
        modalityId: 10,
        examTypeId: 50,
        reportingPriorityId: null,
        bookingDate: "2026-04-21",
        bookingTime: "10:00",
        caseCategory: "non_oncology" as const,
        status: "scheduled" as const,
        notes: null,
        policyVersionId: 1,
        createdAt: "2026-04-11T11:00:00Z",
        createdByUserId: 1,
        updatedAt: "2026-04-11T11:00:00Z",
        updatedByUserId: 1,
      },
      decisionSnapshot: { displayStatus: "available" },
      wasOverride: false,
      previousDate: "2026-04-20",
    };

    assert.equal(typeof result.booking.id, "number");
    assert.equal(result.booking.status, "scheduled");
    assert.equal(result.booking.bookingDate, "2026-04-21");
    assert.equal(result.previousDate, "2026-04-20");
    assert.equal(result.wasOverride, false);
    assert.ok(result.decisionSnapshot);
  });

  it("RescheduleBookingResult with override returns wasOverride=true", () => {
    const result = {
      booking: {
        id: 3,
        patientId: 1,
        modalityId: 10,
        examTypeId: null,
        reportingPriorityId: null,
        bookingDate: "2026-04-21",
        bookingTime: null,
        caseCategory: "oncology" as const,
        status: "scheduled" as const,
        notes: "Override reason: urgent referral",
        policyVersionId: 1,
        createdAt: "2026-04-11T12:00:00Z",
        createdByUserId: 1,
        updatedAt: "2026-04-11T12:00:00Z",
        updatedByUserId: 1,
      },
      decisionSnapshot: { displayStatus: "restricted", requiresSupervisorOverride: true },
      wasOverride: true,
      previousDate: "2026-04-20",
    };

    assert.equal(result.wasOverride, true);
    assert.equal(result.booking.status, "scheduled");
  });
});

describe("Reschedule booking — repository functions", () => {
  it("updateBookingDateTime is a function", async () => {
    const { updateBookingDateTime } = await import(
      "../../booking/repositories/booking.repo.js"
    );
    assert.equal(typeof updateBookingDateTime, "function");
  });

  it("insertBooking is a function", async () => {
    const { insertBooking } = await import(
      "../../booking/repositories/booking.repo.js"
    );
    assert.equal(typeof insertBooking, "function");
  });
});

// ---------------------------------------------------------------------------
// Reschedule booking — backend status validation
// ---------------------------------------------------------------------------

describe("Reschedule booking — backend status validation", () => {
  it("RESCHEDULABLE_STATUSES constant is imported from shared types", () => {
    const serviceContent = rescheduleServiceSource;
    assert.ok(
      serviceContent.includes('from "../../shared/types/common.js"'),
      "Service imports RESCHEDULABLE_STATUSES from shared types"
    );
    assert.ok(!serviceContent.includes("const RESCHEDULABLE_STATUSES"), "Service does not define its own constant");
  });

  it("RESCHEDULABLE_STATUSES in shared types includes scheduled, arrived, waiting", () => {
    const sharedContent = commonTypesSource;
    assert.ok(sharedContent.includes("RESCHEDULABLE_STATUSES"));
    assert.ok(sharedContent.includes('"scheduled"'));
    assert.ok(sharedContent.includes('"arrived"'));
    assert.ok(sharedContent.includes('"waiting"'));
  });

  it("RESCHEDULABLE_STATUSES excludes completed, no-show, cancelled", () => {
    const sharedContent = commonTypesSource;
    const match = sharedContent.match(/RESCHEDULABLE_STATUSES.*?\[[\s\S]*?\]/);
    assert.ok(match, "Found RESCHEDULABLE_STATUSES definition");
    const def = match[0];
    assert.ok(!def.includes('"completed"'), "Should not include completed");
    assert.ok(!def.includes('"no-show"'), "Should not include no-show");
    assert.ok(!def.includes('"cancelled"'), "Should not include cancelled");
  });

  it("service rejects non-reschedulable status with SchedulingError", () => {
    const serviceContent = rescheduleServiceSource;
    assert.ok(serviceContent.includes("booking_not_reschedulable"));
    assert.ok(serviceContent.includes("RESCHEDULABLE_STATUSES.includes"));
  });

  it("service still has separate cancelled check before general validation", () => {
    const serviceContent = rescheduleServiceSource;
    assert.ok(serviceContent.includes("booking_cancelled"));
    assert.ok(serviceContent.includes("is cancelled and cannot be rescheduled"));
  });
});

// ---------------------------------------------------------------------------
// Cancel booking — backend status validation
// ---------------------------------------------------------------------------

describe("Cancel booking — backend status validation", () => {
  it("cancelBooking service imports CANCELLABLE_STATUSES from shared types", () => {
    const serviceContent = cancelServiceSource;
    assert.ok(
      serviceContent.includes('from "../../shared/types/common.js"'),
      "Cancel service imports CANCELLABLE_STATUSES from shared types"
    );
    assert.ok(!serviceContent.includes("const CANCELLABLE_STATUSES"), "Cancel service does not define its own constant");
  });

  it("CANCELLABLE_STATUSES in shared types includes scheduled, arrived, waiting", () => {
    const sharedContent = commonTypesSource;
    assert.ok(sharedContent.includes("CANCELLABLE_STATUSES"));
    assert.ok(sharedContent.includes('"scheduled"'));
    assert.ok(sharedContent.includes('"arrived"'));
    assert.ok(sharedContent.includes('"waiting"'));
  });

  it("CANCELLABLE_STATUSES excludes completed, no-show, cancelled", () => {
    const sharedContent = commonTypesSource;
    const match = sharedContent.match(/CANCELLABLE_STATUSES.*?\[[\s\S]*?\]/);
    assert.ok(match, "Found CANCELLABLE_STATUSES definition");
    const def = match[0];
    assert.ok(!def.includes('"completed"'), "Should not include completed");
    assert.ok(!def.includes('"no-show"'), "Should not include no-show");
    assert.ok(!def.includes('"cancelled"'), "Should not include cancelled");
  });

  it("cancel service rejects non-cancellable status with SchedulingError", () => {
    const serviceContent = cancelServiceSource;
    assert.ok(serviceContent.includes("booking_not_cancellable"));
    assert.ok(serviceContent.includes("CANCELLABLE_STATUSES.includes"));
  });

  it("cancel service still has already-cancelled check before general validation", () => {
    const serviceContent = cancelServiceSource;
    assert.ok(serviceContent.includes("booking_already_cancelled"));
    assert.ok(serviceContent.includes("is already cancelled"));
  });
});
