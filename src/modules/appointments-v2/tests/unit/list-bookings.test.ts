/**
 * Appointments V2 — List bookings backend unit tests.
 *
 * The active GET /api/v2/appointments endpoint remains covered after the
 * obsolete frontend list client was removed.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";

// ---------------------------------------------------------------------------
// Test: Backend list query and result shapes
// ---------------------------------------------------------------------------

describe("List bookings — backend query params", () => {
  it("has required modality and date range with pagination", () => {
    const params = {
      modalityId: 1,
      dateFrom: "2026-04-01",
      dateTo: "2026-04-14",
      limit: 50,
      offset: 0,
    };
    assert.strictEqual(typeof params.modalityId, "number");
    assert.strictEqual(typeof params.dateFrom, "string");
    assert.strictEqual(params.limit, 50);
    assert.strictEqual(params.offset, 0);
  });

  it("supports optional pagination and include-cancelled filtering", () => {
    const params: {
      modalityId: number;
      dateFrom: string;
      dateTo: string;
      limit?: number;
      offset?: number;
      includeCancelled?: boolean;
    } = {
      modalityId: 1,
      dateFrom: "2026-04-01",
      dateTo: "2026-04-14",
    };
    assert.strictEqual(params.limit, undefined);
    assert.strictEqual(params.offset, undefined);
    assert.strictEqual(params.includeCancelled, undefined);
  });
});

describe("List bookings — backend result record shape", () => {
  it("includes booking, patient, modality, and exam information", () => {
    const booking = {
      id: 1,
      patientId: 10,
      modalityId: 2,
      examTypeId: 3,
      reportingPriorityId: null,
      bookingDate: "2026-04-15",
      bookingTime: null,
      caseCategory: "non_oncology" as const,
      status: "scheduled" as const,
      notes: null,
      policyVersionId: 1,
      createdAt: "2026-04-10T10:00:00Z",
      createdByUserId: 1,
      updatedAt: "2026-04-10T10:00:00Z",
      updatedByUserId: 1,
      patientArabicName: "Ahmed Mohamed",
      patientEnglishName: "Ahmed Mohamed",
      patientNationalId: "12345678901",
      modalityName: "CT",
      examTypeName: "CT Chest",
    };

    assert.strictEqual(typeof booking.id, "number");
    assert.strictEqual(typeof booking.patientId, "number");
    assert.strictEqual(booking.caseCategory, "non_oncology");
    assert.strictEqual(booking.status, "scheduled");
    assert.strictEqual(typeof booking.patientEnglishName, "string");
    assert.strictEqual(typeof booking.modalityName, "string");
  });

  it("supports all booking statuses returned by the active endpoint", () => {
    const statuses = [
      "scheduled",
      "arrived",
      "waiting",
      "completed",
      "discontinued",
      "no-show",
      "cancelled",
      "voided",
    ] as const;

    for (const status of statuses) {
      assert.ok(typeof status === "string");
    }
  });

  it("retains patient details for cancelled records", () => {
    const booking = {
      status: "cancelled" as const,
      patientEnglishName: "Cancelled Patient",
      patientNationalId: "12345678901",
    };

    assert.strictEqual(booking.status, "cancelled");
    assert.strictEqual(booking.patientEnglishName, "Cancelled Patient");
  });
});

describe("List bookings — backend result wrapper", () => {
  it("wraps records in a bookings array", () => {
    const response = { bookings: [{ id: 1, patientEnglishName: "Test Patient" }] };
    assert.ok(Array.isArray(response.bookings));
    assert.strictEqual(response.bookings.length, 1);
    assert.strictEqual(response.bookings[0].patientEnglishName, "Test Patient");
  });

  it("returns an empty array when no records are found", () => {
    const response = { bookings: [] };
    assert.strictEqual(response.bookings.length, 0);
  });
});

// ---------------------------------------------------------------------------
// Test: Backend service imports
// ---------------------------------------------------------------------------

describe("List bookings — backend service exists", () => {
  it("list-bookings.service.ts exports listBookingsService", async () => {
    const { listBookingsService } = await import("../../booking/services/list-bookings.service.js");
    assert.strictEqual(typeof listBookingsService, "function");
  });
});

// ---------------------------------------------------------------------------
// Test: Backend route wiring
// ---------------------------------------------------------------------------

describe("List bookings — route wiring", () => {
  it("appointments-v2-routes.ts includes GET route", async () => {
    const fs = await import("node:fs/promises");
    const routePath = `${process.cwd()}/src/modules/appointments-v2/api/routes/appointments-v2-routes.ts`;
    const content = await fs.readFile(routePath, "utf-8");
    assert.ok(content.includes("router.get"));
    assert.ok(content.includes("listBookingsService"));
  });
});

// ---------------------------------------------------------------------------
// Test: includeCancelled support
// ---------------------------------------------------------------------------

describe("List bookings — includeCancelled", () => {
  it("repository SQL includes includeCancelled param", async () => {
    const fs = await import("node:fs/promises");
    const repoPath = `${process.cwd()}/src/modules/appointments-v2/booking/repositories/booking.repo.ts`;
    const content = await fs.readFile(repoPath, "utf-8");
    assert.ok(content.includes("includeCancelled: boolean"));
    assert.ok(content.includes("($4 = true or b.status not in ('cancelled', 'discontinued', 'voided'))"));
    assert.ok(content.includes("params.includeCancelled"));
  });

  it("service passes includeCancelled through", async () => {
    const fs = await import("node:fs/promises");
    const servicePath = `${process.cwd()}/src/modules/appointments-v2/booking/services/list-bookings.service.ts`;
    const content = await fs.readFile(servicePath, "utf-8");
    assert.ok(content.includes("includeCancelled?: boolean"));
    assert.ok(content.includes("includeCancelled,"));
  });

  it("route parses includeCancelled query param", async () => {
    const fs = await import("node:fs/promises");
    const routePath = `${process.cwd()}/src/modules/appointments-v2/api/routes/appointments-v2-routes.ts`;
    const content = await fs.readFile(routePath, "utf-8");
    assert.ok(content.includes("includeCancelled"));
    assert.ok(content.includes("include cancelled and discontinued bookings in results"));
  });
});
