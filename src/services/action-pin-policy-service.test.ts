import { describe, it } from "node:test";
import assert from "node:assert/strict";

process.env.DATABASE_URL ||= "postgres://user:password@localhost:5432/rispro_test";
process.env.JWT_SECRET ||= "test-secret";

describe("action PIN policy", () => {
  it("defaults rollout to disabled with fixed 4 digit PINs", async () => {
    const { DEFAULT_ACTION_PIN_POLICY } = await import("./action-pin-policy-service.js");
    assert.equal(DEFAULT_ACTION_PIN_POLICY.enabled, false);
    assert.equal(DEFAULT_ACTION_PIN_POLICY.pinLength, 4);
    assert.equal(DEFAULT_ACTION_PIN_POLICY.maxFailedAttempts, 5);
    assert.equal(DEFAULT_ACTION_PIN_POLICY.lockoutMinutes, 15);
    assert.equal(DEFAULT_ACTION_PIN_POLICY.verificationTtlSeconds, 300);
    assert.equal(DEFAULT_ACTION_PIN_POLICY.idleLockEnabled, false);
    assert.equal(DEFAULT_ACTION_PIN_POLICY.idleLockSeconds, 180);
  });

  it("normalizes invalid stored policy values to safe defaults", async () => {
    const { normalizeActionPinPolicy } = await import("./action-pin-policy-service.js");
    const policy = normalizeActionPinPolicy({
      enabled: "yes",
      pinLength: 9,
      rotationMode: "yearly",
      maxFailedAttempts: 0,
      lockoutMinutes: -1,
      actionModes: {
        patient_create: {
          receptionist: "required_every_time",
          super_admin: "disabled_for_role",
          invalid_role: "required_every_time",
        },
      },
    });

    assert.equal(policy.enabled, true);
    assert.equal(policy.pinLength, 4);
    assert.equal(policy.rotationMode, "manual");
    assert.equal(policy.maxFailedAttempts, 5);
    assert.equal(policy.lockoutMinutes, 15);
    assert.equal(policy.actionModes.patient_create.receptionist, "required_every_time");
    assert.equal(policy.actionModes.patient_create.super_admin, "disabled_for_role");
    assert.equal("invalid_role" in policy.actionModes.patient_create, false);
  });

  it("includes all required action keys", async () => {
    const { ACTION_PIN_ACTION_KEYS } = await import("./action-pin-policy-service.js");
    assert.ok(ACTION_PIN_ACTION_KEYS.includes("patient_create"));
    assert.ok(ACTION_PIN_ACTION_KEYS.includes("patient_identifier_update"));
    assert.ok(ACTION_PIN_ACTION_KEYS.includes("appointment_create"));
    assert.ok(ACTION_PIN_ACTION_KEYS.includes("registration_create"));
    assert.ok(ACTION_PIN_ACTION_KEYS.includes("queue_walk_in"));
    assert.ok(ACTION_PIN_ACTION_KEYS.includes("duplicate_patient_safe_delete"));
    assert.ok(ACTION_PIN_ACTION_KEYS.includes("pacs_patient_remap"));
  });

  it("resolves disabled global policy as not required", async () => {
    const { DEFAULT_ACTION_PIN_POLICY, resolveActionPinRequirement } = await import("./action-pin-policy-service.js");
    const result = resolveActionPinRequirement(
      { ...DEFAULT_ACTION_PIN_POLICY, enabled: false },
      "receptionist",
      "patient_create"
    );

    assert.equal(result.mode, "not_required");
    assert.equal(result.required, false);
  });

  it("resolves reason requirement from action mode", async () => {
    const { DEFAULT_ACTION_PIN_POLICY, resolveActionPinRequirement } = await import("./action-pin-policy-service.js");
    const result = resolveActionPinRequirement(
      { ...DEFAULT_ACTION_PIN_POLICY, enabled: true },
      "receptionist",
      "patient_identifier_update"
    );

    assert.equal(result.mode, "required_every_time_with_reason");
    assert.equal(result.required, true);
    assert.equal(result.requiresReason, true);
  });
});
