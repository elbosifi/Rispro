import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { evaluateNoShowEligibility, normalizeNoShowMode, type NoShowSettings } from "../../booking/services/no-show-review.service.js";

const settings: NoShowSettings = { reviewTime: "17:00", reviewActive: true, graceMinutes: 30, cleanupDays: 1, mode: "manual", autoNoShowEnabled: false, manualConfirmationRequired: true };
const now = new Date("2026-07-10T16:45:00.000Z"); // 18:45 Africa/Tripoli in July.
const booking = (overrides: Record<string, unknown> = {}) => ({ status: "scheduled", booking_date: "2026-07-10", booking_time: null, ...overrides }) as any;

describe("no-show review eligibility", () => {
  it("requires the configured review time", () => assert.equal(evaluateNoShowEligibility(booking(), { ...settings, reviewActive: false }, now).reasonCode, "no_show_review_not_open"));
  it("allows an untimed scheduled booking after review opens", () => assert.equal(evaluateNoShowEligibility(booking(), settings, now).eligible, true));
  it("protects a future timed booking", () => assert.equal(evaluateNoShowEligibility(booking({ booking_time: "19:00" }), settings, now).reasonCode, "booking_time_grace_not_elapsed"));
  it("protects a booking during its grace period and allows it after grace", () => {
    assert.equal(evaluateNoShowEligibility(booking({ booking_time: "18:30" }), settings, now).reasonCode, "booking_time_grace_not_elapsed");
    assert.equal(evaluateNoShowEligibility(booking({ booking_time: "18:00" }), settings, now).eligible, true);
  });
  for (const status of ["arrived", "waiting", "completed", "cancelled", "no-show"]) {
    it(`excludes ${status}`, () => assert.equal(evaluateNoShowEligibility(booking({ status }), settings, now).eligible, false));
  }
  it("normalizes conflicting settings to manual authority", () => {
    assert.equal(normalizeNoShowMode(true, true), "manual");
    assert.equal(normalizeNoShowMode(false, true), "automatic");
    assert.equal(normalizeNoShowMode(false, false), "disabled");
  });
});
