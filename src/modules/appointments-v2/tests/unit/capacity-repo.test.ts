/**
 * Appointments V2 — Capacity repository tests.
 *
 * Tests the getBookedCountForDate() repository function that counts
 * existing bookings per date/modality/category. This is called by
 * every availability check and booking creation.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "fs";
import { join } from "path";

// ---------------------------------------------------------------------------
// Structure and exports
// ---------------------------------------------------------------------------

describe("Capacity repository — structure", () => {
  it("exports getBookedCountForDate function", async () => {
    const { getBookedCountForDate } = await import(
      "../../scheduler/repositories/capacity.repo.js"
    );
    assert.strictEqual(typeof getBookedCountForDate, "function");
  });

  it("getBookedCountForDate is async", async () => {
    const { getBookedCountForDate } = await import(
      "../../scheduler/repositories/capacity.repo.js"
    );
    assert.strictEqual(getBookedCountForDate.constructor.name, "AsyncFunction");
  });
});

// ---------------------------------------------------------------------------
// SQL query verification
// ---------------------------------------------------------------------------

describe("Capacity repository — SQL query verification", () => {
  const repoPath = join(
    process.cwd(),
    "src/modules/appointments-v2/scheduler/repositories/capacity.repo.ts"
  );
  const source = readFileSync(repoPath, "utf-8");

  it("queries appointments_v2.bookings table", () => {
    assert.ok(
      source.includes("appointments_v2.bookings"),
      "Should query appointments_v2.bookings table"
    );
  });

  it("filters by modality_id", () => {
    assert.ok(
      source.includes("modality_id = $1"),
      "Should filter by modality_id = $1"
    );
  });

  it("filters by booking_date", () => {
    assert.ok(
      source.includes("booking_date = $2"),
      "Should filter by booking_date = $2"
    );
  });

  it("filters by case_category", () => {
    assert.ok(
      source.includes("case_category = $3"),
      "Should filter by case_category = $3"
    );
  });

  it("excludes cancelled bookings with status <> 'cancelled'", () => {
    assert.ok(
      source.includes("status <> 'cancelled'"),
      "Should exclude cancelled bookings"
    );
  });

  it("returns count with proper cast", () => {
    assert.ok(
      source.includes("count(*)::int as count"),
      "Should cast count to int"
    );
  });

  it("passes modalityId, date, and caseCategory parameters", () => {
    assert.ok(
      source.includes("modalityId") && source.includes("date") && source.includes("caseCategory"),
      "Should pass all 3 parameters"
    );
  });

  it("returns 0 as fallback when no rows exist", () => {
    assert.ok(
      source.includes("?.count ?? 0"),
      "Should return 0 as fallback using optional chaining"
    );
  });
});

// ---------------------------------------------------------------------------
// Integration wiring
// ---------------------------------------------------------------------------

describe("Capacity repository — integration wiring", () => {
  it("imported by availability service", async () => {
    const { readFileSync: fsReadFileSync } = await import("fs");
    const { join: pathJoin } = await import("path");
    const servicePath = pathJoin(
      process.cwd(),
      "src/modules/appointments-v2/scheduler/services/availability.service.ts"
    );
    const source = fsReadFileSync(servicePath, "utf-8");

    assert.ok(
      source.includes("getBookedCountForDate"),
      "Should import getBookedCountForDate"
    );
    assert.ok(
      source.includes("../../scheduler/repositories/capacity.repo.js"),
      "Should import from correct path"
    );
  });

  it("imported by create-booking service", async () => {
    const { readFileSync: fsReadFileSync } = await import("fs");
    const { join: pathJoin } = await import("path");
    const servicePath = pathJoin(
      process.cwd(),
      "src/modules/appointments-v2/booking/services/create-booking.service.ts"
    );
    const source = fsReadFileSync(servicePath, "utf-8");

    assert.ok(
      source.includes("getBookedCountForDate"),
      "Should import getBookedCountForDate"
    );
  });
});
