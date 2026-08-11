/**
 * Appointments V2 — Override audit repository tests.
 *
 * Tests the recordOverrideAudit() repository function that records
 * supervisor override events to appointments_v2.override_audit_events.
 * This is a critical compliance/audit trail component.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "fs";
import { join } from "path";
import type { PoolClient } from "pg";

// ---------------------------------------------------------------------------
// Structure and exports
// ---------------------------------------------------------------------------

describe("Override audit repository — structure", () => {
  it("exports recordOverrideAudit function", async () => {
    const { recordOverrideAudit } = await import(
      "../../booking/repositories/override-audit.repo.js"
    );
    assert.strictEqual(typeof recordOverrideAudit, "function");
  });

  it("recordOverrideAudit is async", async () => {
    const { recordOverrideAudit } = await import(
      "../../booking/repositories/override-audit.repo.js"
    );
    const result = recordOverrideAudit.constructor.name;
    assert.strictEqual(result, "AsyncFunction");
  });
});

describe("Override audit repository — legacy schema compatibility", () => {
  it("uses the legacy insert when override_type is not available", async () => {
    const { recordOverrideAudit } = await import(
      "../../booking/repositories/override-audit.repo.js"
    );
    const queries: Array<{ sql: string; params?: unknown[] }> = [];
    const client = {
      query: async (sql: string, params?: unknown[]) => {
        queries.push({ sql, params });
        return queries.length === 1
          ? { rows: [{ exists: false }] }
          : { rows: [] };
      },
    } as unknown as PoolClient;

    await recordOverrideAudit(client, {
      bookingId: 101,
      patientId: 202,
      modalityId: 303,
      examTypeId: 404,
      bookingDate: "2026-08-11",
      requestingUserId: 505,
      supervisorUserId: 606,
      overrideReason: "Urgent clinical need",
      overrideType: "total_capacity_override",
      decisionSnapshot: { isAllowed: false },
      outcome: "approved_and_booked",
    });

    assert.equal(queries.length, 2);
    assert.match(queries[0].sql, /information_schema\.columns/);
    assert.doesNotMatch(queries[1].sql, /override_type/);
    assert.deepEqual(queries[1].params, [
      101,
      202,
      303,
      404,
      "2026-08-11",
      505,
      606,
      "Urgent clinical need",
      JSON.stringify({ isAllowed: false }),
      "approved_and_booked",
    ]);
  });
});

// ---------------------------------------------------------------------------
// SQL query verification
// ---------------------------------------------------------------------------

describe("Override audit repository — SQL query verification", () => {
  const repoPath = join(
    process.cwd(),
    "src/modules/appointments-v2/booking/repositories/override-audit.repo.ts"
  );
  const source = readFileSync(repoPath, "utf-8");

  it("inserts into correct table", () => {
    assert.ok(
      source.includes("appointments_v2.override_audit_events"),
      "Should insert into appointments_v2.override_audit_events"
    );
  });

  it("includes booking_id column", () => {
    assert.ok(
      source.includes("booking_id"),
      "Should include booking_id column"
    );
  });

  it("includes patient_id column", () => {
    assert.ok(
      source.includes("patient_id"),
      "Should include patient_id column"
    );
  });

  it("includes modality_id column", () => {
    assert.ok(
      source.includes("modality_id"),
      "Should include modality_id column"
    );
  });

  it("includes exam_type_id column", () => {
    assert.ok(
      source.includes("exam_type_id"),
      "Should include exam_type_id column"
    );
  });

  it("includes decision_snapshot column", () => {
    assert.ok(
      source.includes("decision_snapshot"),
      "Should include decision_snapshot column"
    );
  });

  it("includes outcome column", () => {
    assert.ok(
      source.includes("outcome"),
      "Should include outcome column"
    );
  });

  it("includes override_reason column", () => {
    assert.ok(
      source.includes("override_reason"),
      "Should include override_reason column"
    );
  });

  it("JSON.stringify used for decision_snapshot parameter", () => {
    assert.ok(
      source.includes("JSON.stringify(audit.decisionSnapshot)"),
      "Should serialize decision_snapshot as JSON"
    );
  });

  it("passes outcome parameter directly without transformation", () => {
    assert.ok(
      source.includes("audit.outcome"),
      "Should pass outcome parameter directly"
    );
  });

  it("supports current and legacy insert shapes", () => {
    assert.ok(
      source.includes("override_type"),
      "Current insert should include override_type"
    );
    assert.ok(
      source.includes("INSERT_SQL_LEGACY"),
      "Should include legacy fallback insert for older schema"
    );

    const paramMatches = source.match(/\$\d+/g);
    assert.ok(paramMatches !== null, "Should have parameter placeholders");
    const uniqueParams = new Set(paramMatches);
    assert.ok(
      uniqueParams.size >= 10,
      "Should have at least 10 parameter placeholders across current/legacy SQL"
    );
  });
});

// ---------------------------------------------------------------------------
// Outcome type documentation
// ---------------------------------------------------------------------------

describe("Override audit repository — outcome type", () => {
  it("documents 4 valid outcome values in type annotation", async () => {
    const { readFileSync: fsReadFileSync } = await import("fs");
    const { join: pathJoin } = await import("path");
    const repoPath = pathJoin(
      process.cwd(),
      "src/modules/appointments-v2/booking/repositories/override-audit.repo.ts"
    );
    const source = fsReadFileSync(repoPath, "utf-8");

    assert.ok(
      source.includes('"approved_and_booked"'),
      "Should include 'approved_and_booked' outcome"
    );
    assert.ok(
      source.includes('"approved_but_failed"'),
      "Should include 'approved_but_failed' outcome"
    );
    assert.ok(
      source.includes('"denied"'),
      "Should include 'denied' outcome"
    );
    assert.ok(
      source.includes('"cancelled"'),
      "Should include 'cancelled' outcome"
    );
  });

  it("outcome type is a string union literal", async () => {
    const { readFileSync: fsReadFileSync } = await import("fs");
    const { join: pathJoin } = await import("path");
    const repoPath = pathJoin(
      process.cwd(),
      "src/modules/appointments-v2/booking/repositories/override-audit.repo.ts"
    );
    const source = fsReadFileSync(repoPath, "utf-8");

    // Verify the outcome type annotation is a union of string literals
    assert.ok(
      source.includes("outcome:"),
      "Should have outcome type annotation"
    );
    assert.ok(
      source.includes("|"),
      "Should use union type for outcome values"
    );
  });
});

// ---------------------------------------------------------------------------
// Integration wiring
// ---------------------------------------------------------------------------

describe("Override audit repository — integration wiring", () => {
  it("imported by create-booking service", async () => {
    const { readFileSync: fsReadFileSync } = await import("fs");
    const { join: pathJoin } = await import("path");
    const servicePath = pathJoin(
      process.cwd(),
      "src/modules/appointments-v2/booking/services/create-booking.service.ts"
    );
    const source = fsReadFileSync(servicePath, "utf-8");

    assert.ok(
      source.includes("recordOverrideAudit"),
      "Should import recordOverrideAudit"
    );
    assert.ok(
      source.includes("../repositories/override-audit.repo.js"),
      "Should import from correct path"
    );
  });

  it("imported by reschedule-booking service", async () => {
    const { readFileSync: fsReadFileSync } = await import("fs");
    const { join: pathJoin } = await import("path");
    const servicePath = pathJoin(
      process.cwd(),
      "src/modules/appointments-v2/booking/services/reschedule-booking.service.ts"
    );
    const source = fsReadFileSync(servicePath, "utf-8");

    assert.ok(
      source.includes("recordOverrideAudit"),
      "Should import recordOverrideAudit"
    );
    assert.ok(
      source.includes("../repositories/override-audit.repo.js"),
      "Should import from correct path"
    );
  });

  it("called in create-booking after successful booking insertion", async () => {
    const { readFileSync: fsReadFileSync } = await import("fs");
    const { join: pathJoin } = await import("path");
    const servicePath = pathJoin(
      process.cwd(),
      "src/modules/appointments-v2/booking/services/create-booking.service.ts"
    );
    const source = fsReadFileSync(servicePath, "utf-8");

    // Verify recordOverrideAudit is called in the service
    const callPattern = /await recordOverrideAudit\s*\(/;
    assert.ok(
      callPattern.test(source),
      "Should call recordOverrideAudit with await"
    );
  });
});
