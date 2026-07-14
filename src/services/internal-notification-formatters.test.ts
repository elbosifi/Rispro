import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  buildComparisonCaseAssignedNotification,
  buildPatientNotificationLabel,
  buildReportingCaseAssignedNotification,
  buildSchedulingOverrideNotification,
  maskNotificationIdentifier,
  sanitizeNotificationText,
} from "./internal-notification-formatters.js";

describe("internal notification formatters", () => {
  it("uses generic ID labels, masks values, and safely handles short or unusual identifiers", () => {
    assert.equal(maskNotificationIdentifier("784512369"), "…2369");
    assert.equal(maskNotificationIdentifier(" A\nB "), "…A B");
    assert.equal(buildPatientNotificationLabel("Samira Ali", { rawValue: "784512369", maskedValue: "…2369" }), "S. A. • ID: …2369");
    assert.equal(buildPatientNotificationLabel("Samira Ali", null), "S. A.");
  });

  it("builds compact distinct reporting and comparison notifications without malformed separators", () => {
    const normal = buildReportingCaseAssignedNotification({ modality: "CT", exam: "CT chest", date: "2026-07-14", patient: "S. A. • ID: …4821", note: "Compare\nwith previous PET/CT" });
    assert.equal(normal.title, "Case assigned • CT");
    assert.match(normal.body, /CT chest • 14 Jul • S\. A\. • ID: …4821 • Note: Compare with previous PET\/CT/);
    const comparison = buildComparisonCaseAssignedNotification({ modality: "MR", exam: "Brain MRI", priorDate: "2026-05-03", patient: "S. A. • ID: …7319", note: "Assess treatment response" });
    assert.equal(comparison.title, "Comparison case assigned • MR");
    assert.match(comparison.body, /Prior: 03 May/);
  });

  it("preserves operational context while truncating long reasons", () => {
    const message = buildSchedulingOverrideNotification({ state: "created", modality: "CT", date: "2026-07-14", exam: "CT CAP", patient: "S. A. • ID: …4821", capacity: "16/15 booked", overbook: 1, requesterReason: "x".repeat(200) });
    assert.match(message.title, /^Overbooking review • CT • 14 Jul$/);
    assert.match(message.body, /16\/15 booked • \+1 above capacity • CT CAP/);
    assert.ok(message.body.length <= 180);
    assert.equal(sanitizeNotificationText("  one\t\n two "), "one two");
  });
});
