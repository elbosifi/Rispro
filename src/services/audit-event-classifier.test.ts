import test from "node:test";
import assert from "node:assert/strict";
import { actorLabel, classifyAuditEvent, presentAuditEvent, redactAuditValue, targetLabel } from "./audit-event-classifier.js";

test("audit classifier keeps important, security, automated, and unknown events deterministic", () => {
  assert.equal(classifyAuditEvent({ actionType: "appointment_reschedule", entityType: "appointment" }).category, "important");
  assert.equal(classifyAuditEvent({ actionType: "supervisor_reauth", entityType: "auth" }).category, "security");
  assert.equal(classifyAuditEvent({ actionType: "report_status_final", entityType: "patient_report" }).category, "automated");
  assert.equal(classifyAuditEvent({ actionType: "new_future_action", entityType: "unknown_entity" }).category, "other");
});

test("audit presentation uses human-readable titles and safe actor/target fallbacks", () => {
  const presented = presentAuditEvent({ actionType: "supervisor_reauth", entityType: "auth", changedByUsername: "seraj" });
  assert.equal(presented.title, "Completed supervisor re-authentication");
  assert.equal(presented.actorLabel, "seraj");
  assert.equal(targetLabel("appointment_v2_booking", 42), "Appointment #42");
  assert.equal(actorLabel({ changedByName: null, changedByUsername: null, changedByUserId: null }), "System");
});

test("audit outcome is only successful when an explicit reliable status is present", () => {
  assert.equal(classifyAuditEvent({ actionType: "login", entityType: "auth" }).outcome, "unknown");
  assert.equal(classifyAuditEvent({ actionType: "update", entityType: "setting", newValues: { status: "completed" } }).outcome, "successful");
  assert.equal(classifyAuditEvent({ actionType: "update", entityType: "setting", newValues: { outcome: "rejected" } }).outcome, "rejected");
});

test("audit redaction masks sensitive keys recursively without changing stored event shape", () => {
  assert.deepEqual(redactAuditValue({ password: "secret", nested: { actionPin: "1234", status: "completed" } }), {
    password: "[REDACTED]",
    nested: { actionPin: "[REDACTED]", status: "completed" }
  });
  assert.equal(redactAuditValue("token=secret-value"), "token=[REDACTED]");
});
