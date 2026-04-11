/**
 * Appointments V2 — Date utilities unit tests.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { toIsoDate, todayIso, addDays } from "../../shared/utils/dates.js";

describe("V2 date utilities", () => {
  it("toIsoDate should return yyyy-mm-dd format", () => {
    const d = new Date(Date.UTC(2026, 3, 11));
    assert.equal(toIsoDate(d), "2026-04-11");
  });

  it("todayIso should return today's date in yyyy-mm-dd", () => {
    const result = todayIso();
    assert.match(result, /^\d{4}-\d{2}-\d{2}$/);
  });

  it("addDays should add days correctly", () => {
    assert.equal(addDays("2026-04-11", 1), "2026-04-12");
    assert.equal(addDays("2026-04-11", 7), "2026-04-18");
    assert.equal(addDays("2026-04-11", -1), "2026-04-10");
  });
});
