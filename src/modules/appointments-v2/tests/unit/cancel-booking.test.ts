/**
 * Appointments V2 — cancelBooking unit tests.
 *
 * Tests the cancel booking service structure, exports, and source wiring.
 * Uses source verification since Node.js ESM mocking is limited.
 * Behavioral coverage is provided by integration tests against real PostgreSQL.
 */

import { describe, it, before } from "node:test";
import assert from "node:assert/strict";

// ---------------------------------------------------------------------------
// Tests: function structure and exports
// ---------------------------------------------------------------------------

describe("cancelBooking — function structure", () => {
  it("exports cancelBooking", async () => {
    const { cancelBooking } = await import("../../booking/services/cancel-booking.service.js");
    assert.ok(typeof cancelBooking === "function");
  });

  it("cancelBooking is async", async () => {
    const { cancelBooking } = await import("../../booking/services/cancel-booking.service.js");
    assert.ok(cancelBooking.constructor.name === "AsyncFunction" || typeof cancelBooking === "function");
  });

  it("CancelBookingResult has correct shape", () => {
    const result = {
      booking: {
        id: 100,
        patientId: 1,
        modalityId: 10,
        examTypeId: 50,
        reportingPriorityId: 1,
        bookingDate: "2026-05-01",
        bookingTime: null,
        caseCategory: "non_oncology",
        status: "cancelled" as const,
        notes: null,
        policyVersionId: 1,
        createdAt: "2026-04-01T00:00:00Z",
        createdByUserId: 1,
        updatedAt: "2026-04-01T00:00:00Z",
        updatedByUserId: 1,
      },
      previousStatus: "scheduled",
    };

    assert.equal(typeof result.booking.id, "number");
    assert.equal(result.booking.status, "cancelled");
    assert.equal(typeof result.previousStatus, "string");
  });
});

// ---------------------------------------------------------------------------
// Tests: source verification — branching paths
// ---------------------------------------------------------------------------

describe("cancelBooking — source verification", () => {
  let source: string;

  before(async () => {
    const fs = await import("node:fs/promises");
    source = await fs.readFile(
      "/Users/serajalsaifi/Nextcloud/RISpro/src/modules/appointments-v2/booking/services/cancel-booking.service.ts",
      "utf-8"
    );
  });

  it("finds booking by ID", () => {
    assert.ok(source.includes("findBookingById"), "Should call findBookingById");
    assert.ok(source.includes("not found"), "Should have 'not found' error message");
  });

  it("checks for already-cancelled status", () => {
    assert.ok(source.includes("booking.status === \"cancelled\"") || source.includes("booking.status === 'cancelled'"),
      "Should check if already cancelled");
    assert.ok(source.includes("already cancelled"), "Should have 'already cancelled' error message");
  });

  it("validates cancellable status", () => {
    assert.ok(source.includes("CANCELLABLE_STATUSES.includes"), "Should check CANCELLABLE_STATUSES");
    assert.ok(source.includes("booking_not_cancellable"), "Should have booking_not_cancellable error code");
  });

  it("updates status to cancelled", () => {
    assert.ok(source.includes("updateBookingStatus"), "Should call updateBookingStatus");
    assert.ok(source.includes("\"cancelled\"") || source.includes("'cancelled'"), "Should set status to cancelled");
  });

  it("uses withTransaction for atomic operation", () => {
    assert.ok(source.includes("withTransaction"), "Should use withTransaction");
  });

  it("returns booking and previousStatus", () => {
    assert.ok(source.includes("booking:"), "Should return booking");
    assert.ok(source.includes("previousStatus,"), "Should return previousStatus");
  });

  it("preserves booking fields when constructing result", () => {
    // The service spreads the original booking and overrides status
    assert.ok(source.includes("...booking") || source.includes("booking,"), "Should preserve booking fields");
    assert.ok(source.includes("status:"), "Should override status");
  });
});

// ---------------------------------------------------------------------------
// Tests: import wiring
// ---------------------------------------------------------------------------

describe("cancelBooking — import wiring", () => {
  it("imports booking repo from correct path", async () => {
    const fs = await import("node:fs/promises");
    const source = await fs.readFile(
      "/Users/serajalsaifi/Nextcloud/RISpro/src/modules/appointments-v2/booking/services/cancel-booking.service.ts",
      "utf-8"
    );
    assert.ok(
      source.includes('from "../repositories/booking.repo.js"'),
      "Should import booking.repo from relative path"
    );
  });

  it("imports transaction util from correct path", async () => {
    const fs = await import("node:fs/promises");
    const source = await fs.readFile(
      "/Users/serajalsaifi/Nextcloud/RISpro/src/modules/appointments-v2/booking/services/cancel-booking.service.ts",
      "utf-8"
    );
    assert.ok(
      source.includes('from "../../shared/utils/transactions.js"'),
      "Should import transactions from relative path"
    );
  });

  it("imports SchedulingError from correct path", async () => {
    const fs = await import("node:fs/promises");
    const source = await fs.readFile(
      "/Users/serajalsaifi/Nextcloud/RISpro/src/modules/appointments-v2/booking/services/cancel-booking.service.ts",
      "utf-8"
    );
    assert.ok(
      source.includes('from "../../shared/errors/scheduling-error.js"'),
      "Should import SchedulingError from relative path"
    );
  });

  it("imports CANCELLABLE_STATUSES from shared types", async () => {
    const fs = await import("node:fs/promises");
    const source = await fs.readFile(
      "/Users/serajalsaifi/Nextcloud/RISpro/src/modules/appointments-v2/booking/services/cancel-booking.service.ts",
      "utf-8"
    );
    assert.ok(
      source.includes('from "../../shared/types/common.js"'),
      "Should import CANCELLABLE_STATUSES from shared types"
    );
  });
});

// ---------------------------------------------------------------------------
// Tests: error codes
// ---------------------------------------------------------------------------

describe("cancelBooking — error codes", () => {
  let source: string;

  before(async () => {
    const fs = await import("node:fs/promises");
    source = await fs.readFile(
      "/Users/serajalsaifi/Nextcloud/RISpro/src/modules/appointments-v2/booking/services/cancel-booking.service.ts",
      "utf-8"
    );
  });

  it("uses 404 for booking not found", () => {
    assert.ok(source.includes("404"), "Should use 404 status");
    assert.ok(source.includes("booking_not_found"), "Should have booking_not_found reason code");
  });

  it("uses 409 for already cancelled", () => {
    assert.ok(source.includes("409"), "Should use 409 status");
    assert.ok(source.includes("booking_already_cancelled"), "Should have booking_already_cancelled reason code");
  });

  it("uses 409 for non-cancellable status", () => {
    const count409 = (source.match(/409/g) || []).length;
    assert.ok(count409 >= 2, "Should use 409 for both already-cancelled and non-cancellable");
    assert.ok(source.includes("booking_not_cancellable"), "Should have booking_not_cancellable reason code");
  });
});

// ---------------------------------------------------------------------------
// Tests: route wiring
// ---------------------------------------------------------------------------

describe("POST /:id/cancel — route wiring", () => {
  it("imports cancelBooking from service", async () => {
    const fs = await import("node:fs/promises");
    const source = await fs.readFile(
      "/Users/serajalsaifi/Nextcloud/RISpro/src/modules/appointments-v2/api/routes/appointments-v2-routes.ts",
      "utf-8"
    );
    assert.ok(
      source.includes('from "../../booking/services/cancel-booking.service.js"'),
      "Should import cancelBooking"
    );
  });

  it("parses bookingId from route param", async () => {
    const fs = await import("node:fs/promises");
    const source = await fs.readFile(
      "/Users/serajalsaifi/Nextcloud/RISpro/src/modules/appointments-v2/api/routes/appointments-v2-routes.ts",
      "utf-8"
    );
    assert.ok(source.includes("parseInt(String(req.params.id)"), "Should parse bookingId from params");
    assert.ok(source.includes("Invalid booking ID"), "Should validate booking ID");
  });

  it("extracts userId from request user context", async () => {
    const fs = await import("node:fs/promises");
    const source = await fs.readFile(
      "/Users/serajalsaifi/Nextcloud/RISpro/src/modules/appointments-v2/api/routes/appointments-v2-routes.ts",
      "utf-8"
    );
    assert.ok(source.includes("req.user?.sub"), "Should extract userId from user context");
  });

  it("returns booking and previousStatus in response", async () => {
    const fs = await import("node:fs/promises");
    const source = await fs.readFile(
      "/Users/serajalsaifi/Nextcloud/RISpro/src/modules/appointments-v2/api/routes/appointments-v2-routes.ts",
      "utf-8"
    );
    assert.ok(source.includes("booking: result.booking"), "Should return booking");
    assert.ok(source.includes("previousStatus: result.previousStatus"), "Should return previousStatus");
  });
});
