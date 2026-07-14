import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  buildComparisonCaseAssignedNotification,
  buildInternalNotificationPatientLabel,
  buildReportingCaseAssignedNotification,
  buildSchedulingOverrideNotification,
  sanitizeNotificationText,
} from "./internal-notification-formatters.js";

describe("internal notification formatters", () => {
  it("uses full internal patient identity with a generic ID label and safely omits a missing primary identifier", () => {
    assert.equal(buildInternalNotificationPatientLabel({ fullName: "  Fatima\nHassan Ali ", primaryIdentifier: " 784512369 " }), "Fatima Hassan Ali • ID: 784512369");
    assert.equal(buildInternalNotificationPatientLabel({ fullName: "Fatima Hassan Ali", primaryIdentifier: null }), "Fatima Hassan Ali");
  });

  it("builds compact distinct reporting and comparison notifications without malformed separators", () => {
    const normal = buildReportingCaseAssignedNotification({ modality: "CT", exam: "CT chest", date: "2026-07-14", patient: "Fatima Hassan Ali • ID: 784512369", note: "Compare\nwith previous PET/CT" });
    assert.equal(normal.title, "Case assigned • CT");
    assert.match(normal.body, /CT chest • 14 Jul • Fatima Hassan Ali • ID: 784512369 • Note: Compare with previous PET\/CT/);
    const comparison = buildComparisonCaseAssignedNotification({ modality: "MR", exam: "Brain MRI", priorDate: "2026-05-03", patient: "Fatima Hassan Ali • ID: 784512369", note: "Assess treatment response" });
    assert.equal(comparison.title, "Comparison case assigned • MR");
    assert.match(comparison.body, /^Fatima Hassan Ali • ID: 784512369 • Brain MRI • Prior: 03 May/);
  });

  it("preserves operational context while truncating long reasons", () => {
    const message = buildSchedulingOverrideNotification({ state: "created", modality: "CT", date: "2026-07-14", exam: "CT CAP", patient: "Fatima Hassan Ali • ID: 784512369", capacity: "16/15 booked", overbook: 1, requesterReason: "x".repeat(200) });
    assert.match(message.title, /^Overbooking review • CT • 14 Jul$/);
    assert.match(message.body, /^Fatima Hassan Ali • ID: 784512369 • CT CAP • 16\/15 booked • \+1 above capacity/);
    assert.match(message.body, /Reason: .+…$/);
    assert.equal(sanitizeNotificationText("  one\t\n two "), "one two");
  });
});
