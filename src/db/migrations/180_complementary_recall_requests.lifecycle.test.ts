import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

const sql = readFileSync(new URL("./180_complementary_recall_requests.sql", import.meta.url), "utf8");

describe("180 complementary recall requests migration", () => {
  it("creates the bounded lifecycle table and active-link invariants", () => {
    assert.match(sql, /create table appointments_v2\.complementary_recall_requests/i);
    assert.match(sql, /technologist_instruction text not null/i);
    assert.match(sql, /pending_scheduling.*scheduled.*completed.*cancelled/is);
    assert.match(sql, /where status in \('pending_scheduling', 'scheduled'\)/i);
    assert.match(sql, /recall_appointment_id is null or recall_appointment_id <> original_appointment_id/i);
  });

  it("allows a clinically cancelled recall to retain its scheduled booking link", () => {
    assert.doesNotMatch(sql, /status = 'cancelled'[^\n]*recall_appointment_id is null/i);
    assert.match(sql, /status = 'cancelled' and cancelled_at is not null/i);
  });
});
