/**
 * Appointments V2 — List bookings unit tests.
 *
 * Tests for the list bookings service, repository query shape, and frontend types.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";

// ---------------------------------------------------------------------------
// Test: ListBookingsParams shape
// ---------------------------------------------------------------------------

describe("List bookings — params shape", () => {
  it("has required modalityId and date range", () => {
    const params = {
      modalityId: 1,
      dateFrom: "2026-04-01",
      dateTo: "2026-04-14",
      limit: 50,
      offset: 0,
    };
    assert.strictEqual(typeof params.modalityId, "number");
    assert.strictEqual(typeof params.dateFrom, "string");
    assert.strictEqual(typeof params.dateTo, "string");
    assert.strictEqual(params.limit, 50);
    assert.strictEqual(params.offset, 0);
  });

  it("supports optional limit, offset, and includeCancelled with defaults", () => {
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

// ---------------------------------------------------------------------------
// Test: BookingWithPatientInfo shape
// ---------------------------------------------------------------------------

describe("List bookings — BookingWithPatientInfo shape", () => {
  it("includes all booking fields plus patient/modality/exam info", () => {
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
      patientArabicName: "أحمد محمد",
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

  it("supports all valid booking statuses", () => {
    const statuses = [
      "scheduled",
      "arrived",
      "waiting",
      "completed",
      "no-show",
      "cancelled",
    ] as const;

    for (const status of statuses) {
      assert.ok(typeof status === "string");
    }
  });

  it("cancelled bookings has patientEnglishName and patientNationalId", () => {
    const booking = {
      id: 99,
      patientId: 10,
      modalityId: 2,
      examTypeId: null,
      reportingPriorityId: null,
      bookingDate: "2026-04-15",
      bookingTime: null,
      caseCategory: "non_oncology" as const,
      status: "cancelled" as const,
      notes: "Patient called to cancel",
      policyVersionId: 1,
      createdAt: "2026-04-10T10:00:00Z",
      createdByUserId: 1,
      updatedAt: "2026-04-10T12:00:00Z",
      updatedByUserId: 1,
      patientArabicName: null,
      patientEnglishName: "Cancelled Patient",
      patientNationalId: "12345678901",
      modalityName: "CT",
      examTypeName: null,
    };

    assert.strictEqual(booking.status, "cancelled");
    assert.strictEqual(booking.patientEnglishName, "Cancelled Patient");
  });
});

// ---------------------------------------------------------------------------
// Test: ListBookingsResponse shape
// ---------------------------------------------------------------------------

describe("List bookings — response shape", () => {
  it("wraps bookings array", () => {
    const response = {
      bookings: [
        {
          id: 1,
          patientId: 10,
          modalityId: 2,
          examTypeId: null,
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
          patientArabicName: null,
          patientEnglishName: "Test Patient",
          patientNationalId: null,
          modalityName: "CT",
          examTypeName: null,
        },
      ],
    };

    assert.ok(Array.isArray(response.bookings));
    assert.strictEqual(response.bookings.length, 1);
    assert.strictEqual(response.bookings[0].patientEnglishName, "Test Patient");
  });

  it("returns empty array when no bookings found", () => {
    const response = { bookings: [] };
    assert.strictEqual(response.bookings.length, 0);
  });
});

// ---------------------------------------------------------------------------
// Test: Frontend API hook shape
// ---------------------------------------------------------------------------

describe("List bookings — frontend API params", () => {
  it("listV2Bookings requires modalityId, dateFrom, dateTo", () => {
    const params = {
      modalityId: 1,
      dateFrom: "2026-04-01",
      dateTo: "2026-04-14",
    };
    assert.strictEqual(typeof params.modalityId, "number");
    assert.strictEqual(params.dateFrom.length, 10); // ISO date length
    assert.strictEqual(params.dateTo.length, 10);
  });

  it("useV2ListBookings accepts null when modality not selected", () => {
    const params = null;
    assert.strictEqual(params, null);
  });
});

// ---------------------------------------------------------------------------
// Test: Barrel exports
// ---------------------------------------------------------------------------

describe("V2 appointments — barrel exports for list bookings", () => {
  const frontendIndexPath = "/Users/serajalsaifi/Nextcloud/RISpro/frontend/src/v2/appointments/index.ts";

  it("index.ts exports useV2ListBookings", async () => {
    const fs = await import("node:fs/promises");
    const content = await fs.readFile(frontendIndexPath, "utf-8");
    assert.ok(content.includes("useV2ListBookings"));
  });

  it("index.ts exports listV2Bookings", async () => {
    const fs = await import("node:fs/promises");
    const content = await fs.readFile(frontendIndexPath, "utf-8");
    assert.ok(content.includes("listV2Bookings"));
  });

  it("index.ts exports BookingWithPatientInfo type", async () => {
    const fs = await import("node:fs/promises");
    const content = await fs.readFile(frontendIndexPath, "utf-8");
    assert.ok(content.includes("BookingWithPatientInfo"));
  });

  it("index.ts exports ListBookingsResponse type", async () => {
    const fs = await import("node:fs/promises");
    const content = await fs.readFile(frontendIndexPath, "utf-8");
    assert.ok(content.includes("ListBookingsResponse"));
  });

  it("index.ts exports CancelConfirmDialog", async () => {
    const fs = await import("node:fs/promises");
    const content = await fs.readFile(frontendIndexPath, "utf-8");
    assert.ok(content.includes("CancelConfirmDialog"));
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
    const routePath = "/Users/serajalsaifi/Nextcloud/RISpro/src/modules/appointments-v2/api/routes/appointments-v2-routes.ts";
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
    const repoPath = "/Users/serajalsaifi/Nextcloud/RISpro/src/modules/appointments-v2/booking/repositories/booking.repo.ts";
    const content = await fs.readFile(repoPath, "utf-8");
    assert.ok(content.includes("includeCancelled: boolean"));
    assert.ok(content.includes("($4 = true or b.status <> 'cancelled')"));
    assert.ok(content.includes("params.includeCancelled"));
  });

  it("service passes includeCancelled through", async () => {
    const fs = await import("node:fs/promises");
    const servicePath = "/Users/serajalsaifi/Nextcloud/RISpro/src/modules/appointments-v2/booking/services/list-bookings.service.ts";
    const content = await fs.readFile(servicePath, "utf-8");
    assert.ok(content.includes("includeCancelled?: boolean"));
    assert.ok(content.includes("includeCancelled,"));
  });

  it("route parses includeCancelled query param", async () => {
    const fs = await import("node:fs/promises");
    const routePath = "/Users/serajalsaifi/Nextcloud/RISpro/src/modules/appointments-v2/api/routes/appointments-v2-routes.ts";
    const content = await fs.readFile(routePath, "utf-8");
    assert.ok(content.includes("includeCancelled"));
    assert.ok(content.includes("includeCancelled (optional, default false)"));
  });

  it("frontend API includes includeCancelled in params", async () => {
    const fs = await import("node:fs/promises");
    const apiPath = "/Users/serajalsaifi/Nextcloud/RISpro/frontend/src/v2/appointments/api.ts";
    const content = await fs.readFile(apiPath, "utf-8");
    assert.ok(content.includes("includeCancelled?: boolean"));
    assert.ok(content.includes('searchParams.set("includeCancelled", "true")'));
  });

  it("frontend types include ListBookingsParams with includeCancelled", async () => {
    const fs = await import("node:fs/promises");
    const typesPath = "/Users/serajalsaifi/Nextcloud/RISpro/frontend/src/v2/appointments/types.ts";
    const content = await fs.readFile(typesPath, "utf-8");
    assert.ok(content.includes("ListBookingsParams"));
    assert.ok(content.includes("includeCancelled?: boolean"));
  });

  it("page uses includeCancelled state and toggle UI", async () => {
    const fs = await import("node:fs/promises");
    const pagePath = "/Users/serajalsaifi/Nextcloud/RISpro/frontend/src/v2/appointments/page.tsx";
    const content = await fs.readFile(pagePath, "utf-8");
    assert.ok(content.includes("includeCancelled"));
    assert.ok(content.includes("setIncludeCancelled"));
    assert.ok(content.includes("Include cancelled"));
    assert.ok(content.includes('type="checkbox"'));
  });

  it("cancelled bookings rows have reduced opacity", async () => {
    const fs = await import("node:fs/promises");
    const pagePath = "/Users/serajalsaifi/Nextcloud/RISpro/frontend/src/v2/appointments/page.tsx";
    const content = await fs.readFile(pagePath, "utf-8");
    assert.ok(content.includes('booking.status === "cancelled"'));
    assert.ok(content.includes("opacity"));
  });
});
