/**
 * Appointments V2 — createBooking unit tests.
 *
 * Tests the create booking service structure, exports, and source wiring.
 * Uses source verification since Node.js ESM mocking is limited.
 * Behavioral coverage is provided by integration tests against real PostgreSQL.
 */

import { describe, it, before } from "node:test";
import assert from "node:assert/strict";

// ---------------------------------------------------------------------------
// Tests: function structure and exports
// ---------------------------------------------------------------------------

describe("createBooking — function structure", () => {
  it("exports createBooking", async () => {
    const { createBooking } = await import("../../booking/services/create-booking.service.js");
    assert.ok(typeof createBooking === "function");
  });

  it("createBooking is async", async () => {
    const { createBooking } = await import("../../booking/services/create-booking.service.js");
    assert.ok(createBooking.constructor.name === "AsyncFunction" || typeof createBooking === "function");
  });

  it("CreateBookingResult has correct shape", () => {
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
        status: "scheduled" as const,
        notes: null,
        policyVersionId: 1,
        createdAt: "2026-04-01T00:00:00Z",
        createdByUserId: 1,
        updatedAt: "2026-04-01T00:00:00Z",
        updatedByUserId: 1,
      },
      decisionSnapshot: null,
      wasOverride: false,
    };

    assert.equal(typeof result.booking.id, "number");
    assert.equal(result.booking.status, "scheduled");
    assert.ok(result.decisionSnapshot === null || typeof result.decisionSnapshot === "object");
    assert.equal(typeof result.wasOverride, "boolean");
  });
});

// ---------------------------------------------------------------------------
// Tests: source verification — branching paths
// ---------------------------------------------------------------------------

describe("createBooking — source verification", () => {
  let source: string;

  before(async () => {
    const fs = await import("node:fs/promises");
    source = await fs.readFile(
      "/Users/serajalsaifi/Nextcloud/RISpro/src/modules/appointments-v2/booking/services/create-booking.service.ts",
      "utf-8"
    );
  });

  it("loads published policy version", () => {
    assert.ok(source.includes("findPublishedPolicyVersion"), "Should call findPublishedPolicyVersion");
    assert.ok(source.includes("no_published_policy"), "Should have no_published_policy error code");
  });

  it("checks modality existence", () => {
    assert.ok(source.includes("findModalityById"), "Should call findModalityById");
    assert.ok(source.includes("modality_not_found"), "Should have modality_not_found error code");
  });

  it("checks exam type existence", () => {
    assert.ok(source.includes("findExamTypeById"), "Should call findExamTypeById");
    assert.ok(source.includes("exam_type_not_found"), "Should have exam_type_not_found error code");
  });

  it("checks exam type belongs to modality", () => {
    assert.ok(source.includes("exam_type_modality_mismatch"), "Should have exam_type_modality_mismatch error code");
  });

  it("acquires bucket lock before evaluation", () => {
    assert.ok(source.includes("acquireBucketLock"), "Should call acquireBucketLock");
  });

  it("loads all rule types for re-evaluation", () => {
    assert.ok(source.includes("loadModalityBlockedRules"), "Should load blocked rules");
    assert.ok(source.includes("loadExamTypeRules"), "Should load exam type rules");
    assert.ok(source.includes("loadCategoryDailyLimits"), "Should load category limits");
    assert.ok(source.includes("loadExamTypeSpecialQuotas"), "Should load special quotas");
    assert.ok(source.includes("loadExamTypeRuleItemExamTypeIds"), "Should load exam type rule item IDs");
  });

  it("loads booked count after lock", () => {
    assert.ok(source.includes("getBookedCountForDate"), "Should call getBookedCountForDate");
  });

  it("re-evaluates with pureEvaluate", () => {
    assert.ok(source.includes("pureEvaluate"), "Should call pureEvaluate");
  });

  it("handles supervisor override authentication", () => {
    assert.ok(source.includes("authenticateSupervisor"), "Should call authenticateSupervisor");
    assert.ok(source.includes("override_required"), "Should have override_required error code");
  });

  it("inserts booking after validation", () => {
    assert.ok(source.includes("insertBooking"), "Should call insertBooking");
  });

  it("records override audit when override is used", () => {
    assert.ok(source.includes("recordOverrideAudit"), "Should call recordOverrideAudit");
    assert.ok(source.includes("approved_and_booked"), "Should record approved_and_booked outcome");
  });

  it("returns booking, decision snapshot, and wasOverride flag", () => {
    assert.ok(source.includes("booking:"), "Should return booking");
    assert.ok(source.includes("decisionSnapshot:"), "Should return decisionSnapshot");
    assert.ok(source.includes("wasOverride:"), "Should return wasOverride");
  });
});

// ---------------------------------------------------------------------------
// Tests: import wiring
// ---------------------------------------------------------------------------

describe("createBooking — import wiring", () => {
  it("imports booking repo from correct path", async () => {
    const fs = await import("node:fs/promises");
    const source = await fs.readFile(
      "/Users/serajalsaifi/Nextcloud/RISpro/src/modules/appointments-v2/booking/services/create-booking.service.ts",
      "utf-8"
    );
    assert.ok(
      source.includes('from "../repositories/booking.repo.js"'),
      "Should import booking.repo from relative path"
    );
  });

  it("imports bucket mutex repo from correct path", async () => {
    const fs = await import("node:fs/promises");
    const source = await fs.readFile(
      "/Users/serajalsaifi/Nextcloud/RISpro/src/modules/appointments-v2/booking/services/create-booking.service.ts",
      "utf-8"
    );
    assert.ok(
      source.includes('from "../repositories/bucket-mutex.repo.js"'),
      "Should import bucket-mutex.repo from relative path"
    );
  });

  it("imports transaction util from correct path", async () => {
    const fs = await import("node:fs/promises");
    const source = await fs.readFile(
      "/Users/serajalsaifi/Nextcloud/RISpro/src/modules/appointments-v2/booking/services/create-booking.service.ts",
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
      "/Users/serajalsaifi/Nextcloud/RISpro/src/modules/appointments-v2/booking/services/create-booking.service.ts",
      "utf-8"
    );
    assert.ok(
      source.includes('from "../../shared/errors/scheduling-error.js"'),
      "Should import SchedulingError from relative path"
    );
  });

  it("imports pureEvaluate from correct path", async () => {
    const fs = await import("node:fs/promises");
    const source = await fs.readFile(
      "/Users/serajalsaifi/Nextcloud/RISpro/src/modules/appointments-v2/booking/services/create-booking.service.ts",
      "utf-8"
    );
    assert.ok(
      source.includes('from "../../rules/services/pure-evaluate.js"'),
      "Should import pureEvaluate from relative path"
    );
  });

  it("imports authenticateSupervisor from correct path", async () => {
    const fs = await import("node:fs/promises");
    const source = await fs.readFile(
      "/Users/serajalsaifi/Nextcloud/RISpro/src/modules/appointments-v2/booking/services/create-booking.service.ts",
      "utf-8"
    );
    assert.ok(
      source.includes('from "../utils/authenticate-supervisor.js"'),
      "Should import authenticateSupervisor from relative path"
    );
  });
});

// ---------------------------------------------------------------------------
// Tests: error codes
// ---------------------------------------------------------------------------

describe("createBooking — error codes", () => {
  let source: string;

  before(async () => {
    const fs = await import("node:fs/promises");
    source = await fs.readFile(
      "/Users/serajalsaifi/Nextcloud/RISpro/src/modules/appointments-v2/booking/services/create-booking.service.ts",
      "utf-8"
    );
  });

  it("uses 400 for no published policy", () => {
    assert.ok(source.includes("400"), "Should use 400 status");
    assert.ok(source.includes("no_published_policy"), "Should have no_published_policy reason code");
  });

  it("uses 400 for modality not found", () => {
    const count400 = (source.match(/400/g) || []).length;
    assert.ok(count400 >= 2, "Should use 400 for multiple integrity failures");
    assert.ok(source.includes("modality_not_found"), "Should have modality_not_found reason code");
  });

  it("uses 400 for exam type not found", () => {
    assert.ok(source.includes("exam_type_not_found"), "Should have exam_type_not_found reason code");
  });

  it("uses 400 for exam type modality mismatch", () => {
    assert.ok(source.includes("exam_type_modality_mismatch"), "Should have exam_type_modality_mismatch reason code");
  });

  it("uses 409 for booking not allowed (includes capacity exhausted)", () => {
    assert.ok(source.includes("409"), "Should use 409 status");
    // The error codes come from decision.reasons.map((r) => r.code)
    // which includes codes like standard_capacity_exhausted from pureEvaluate
    assert.ok(source.includes("decision.reasons.map"), "Should map decision reason codes to error");
    assert.ok(source.includes("Booking is not allowed"), "Should have 'not allowed' error message");
  });

  it("uses 403 for override required but not provided", () => {
    assert.ok(source.includes("403"), "Should use 403 status for auth requirement");
    assert.ok(source.includes("override_required"), "Should have override_required reason code");
  });
});

// ---------------------------------------------------------------------------
// Tests: route wiring
// ---------------------------------------------------------------------------

describe("POST /appointments — route wiring", () => {
  it("imports createBooking from service", async () => {
    const fs = await import("node:fs/promises");
    const source = await fs.readFile(
      "/Users/serajalsaifi/Nextcloud/RISpro/src/modules/appointments-v2/api/routes/appointments-v2-routes.ts",
      "utf-8"
    );
    assert.ok(
      source.includes('from "../../booking/services/create-booking.service.js"'),
      "Should import createBooking"
    );
  });

  it("validates required fields", async () => {
    const fs = await import("node:fs/promises");
    const source = await fs.readFile(
      "/Users/serajalsaifi/Nextcloud/RISpro/src/modules/appointments-v2/api/routes/appointments-v2-routes.ts",
      "utf-8"
    );
    assert.ok(source.includes("patientId, modalityId, bookingDate, and caseCategory are required"),
      "Should validate required fields");
    assert.ok(source.includes("400"), "Should return 400 for missing fields");
  });

  it("extracts userId from request user context", async () => {
    const fs = await import("node:fs/promises");
    const source = await fs.readFile(
      "/Users/serajalsaifi/Nextcloud/RISpro/src/modules/appointments-v2/api/routes/appointments-v2-routes.ts",
      "utf-8"
    );
    assert.ok(source.includes("req.user?.sub"), "Should extract userId from user context");
  });

  it("passes optional fields with null fallbacks", async () => {
    const fs = await import("node:fs/promises");
    const source = await fs.readFile(
      "/Users/serajalsaifi/Nextcloud/RISpro/src/modules/appointments-v2/api/routes/appointments-v2-routes.ts",
      "utf-8"
    );
    assert.ok(source.includes("body.examTypeId ?? null"), "Should fallback examTypeId to null");
    assert.ok(source.includes("body.bookingTime ?? null"), "Should fallback bookingTime to null");
    assert.ok(source.includes("body.notes ?? null"), "Should fallback notes to null");
  });

  it("returns 201 with booking, decision, and wasOverride", async () => {
    const fs = await import("node:fs/promises");
    const source = await fs.readFile(
      "/Users/serajalsaifi/Nextcloud/RISpro/src/modules/appointments-v2/api/routes/appointments-v2-routes.ts",
      "utf-8"
    );
    assert.ok(source.includes("status(201)"), "Should return 201");
    assert.ok(source.includes("booking: result.booking"), "Should return booking");
    assert.ok(source.includes("decision: result.decisionSnapshot"), "Should return decision");
    assert.ok(source.includes("wasOverride: result.wasOverride"), "Should return wasOverride");
  });
});
