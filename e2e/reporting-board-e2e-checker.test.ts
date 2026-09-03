import assert from "node:assert/strict";
import test from "node:test";
import { pool } from "../src/db/pool.js";
import { e2eReportingBoardAssignmentBatchChecker } from "./reporting-board-e2e-checker.js";

test("E2E Reporting Board checker reads seeded cache states and fails closed", async () => {
  if (process.env.RISPRO_E2E !== "1") throw new Error("RISPRO_E2E=1 is required for the E2E checker test.");
  const fixtures = await pool.query<{ id: number; english_full_name: string }>(
    `select b.id, p.english_full_name
     from appointments_v2.bookings b
     join patients p on p.id = b.patient_id
     where p.english_full_name = any($1::text[])`,
    [["E2E Reporting Claim", "E2E Reporting Final Guard"]],
  );
  const byName = new Map(fixtures.rows.map((row) => [row.english_full_name, Number(row.id)]));
  const claimId = byName.get("E2E Reporting Claim");
  const finalId = byName.get("E2E Reporting Final Guard");
  assert.ok(claimId); assert.ok(finalId);
  const contexts = [claimId, finalId, -1].map((bookingId) => ({ bookingId, accessionNumber: `V2-${bookingId}`, studyInstanceUid: null, requiresReport: true, status: "completed" as const }));
  const states = await e2eReportingBoardAssignmentBatchChecker(contexts, { audit: false });
  assert.equal(states.get(claimId)?.state, "draft");
  assert.equal(states.get(finalId)?.state, "final");
  assert.equal(states.get(-1)?.state, "unavailable");
});
