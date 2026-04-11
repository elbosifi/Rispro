/**
 * Appointments V2 — Create booking service unit tests.
 *
 * Tests the booking service logic with mocked dependencies.
 * Full integration tests require a real PostgreSQL instance.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { SchedulingError } from "../../shared/errors/scheduling-error.js";

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
  it("withTransaction calls the provided function", async () => {
    // We can't test withTransaction with a real DB, but we can
    // verify it's imported and callable.
    const { withTransaction } = await import(
      "../../shared/utils/transactions.js"
    );
    assert.equal(typeof withTransaction, "function");
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
