import { describe, it } from "node:test";
import assert from "node:assert/strict";
import type { Request, Response } from "express";

process.env.DATABASE_URL ||= "postgres://user:password@localhost:5432/rispro_test";
process.env.JWT_SECRET ||= "test-secret";

describe("action PIN middleware", () => {
  it("skips when global policy is disabled", async () => {
    const { requireActionPin } = await import("./action-pin.js");
    const { DEFAULT_ACTION_PIN_POLICY } = await import("../services/action-pin-policy-service.js");
    const guard = requireActionPin("patient_create", async () => DEFAULT_ACTION_PIN_POLICY);
    let called = false;

    await guard({ user: { sub: 1, role: "receptionist" } } as Request, {} as Response, () => {
      called = true;
    });

    assert.equal(called, true);
  });

  it("returns stable action_pin_required response shape", async () => {
    const { requireActionPin } = await import("./action-pin.js");
    const { DEFAULT_ACTION_PIN_POLICY } = await import("../services/action-pin-policy-service.js");
    const guard = requireActionPin("patient_create", async () => ({
      ...DEFAULT_ACTION_PIN_POLICY,
      enabled: true,
    }));
    let payload: unknown;
    let statusCode = 0;

    await guard(
      { user: { sub: 1, role: "receptionist" }, cookies: {} } as Request,
      {
        status(code: number) {
          statusCode = code;
          return this;
        },
        json(body: unknown) {
          payload = body;
          return this;
        },
      } as unknown as Response,
      () => undefined
    );

    assert.equal(statusCode, 403);
    assert.deepEqual(payload, {
      error: "action_pin_required",
      actionKey: "patient_create",
      requiresReason: false,
    });
  });

  it("returns action_pin_required before reason check when verification is missing", async () => {
    const { requireActionPin } = await import("./action-pin.js");
    const { DEFAULT_ACTION_PIN_POLICY } = await import("../services/action-pin-policy-service.js");
    const guard = requireActionPin("patient_identifier_update", async () => ({
      ...DEFAULT_ACTION_PIN_POLICY,
      enabled: true,
    }));
    let payload: unknown;

    await guard(
      { user: { sub: 1, role: "receptionist" }, cookies: {}, body: { reason: "" } } as Request,
      {
        status() {
          return this;
        },
        json(body: unknown) {
          payload = body;
          return this;
        },
      } as unknown as Response,
      () => undefined
    );

    assert.deepEqual(payload, { error: "action_pin_required", actionKey: "patient_identifier_update", requiresReason: true });
  });

  it("returns reason-required when verification lacks reason for reason-required mode", async () => {
    const { requireActionPin } = await import("./action-pin.js");
    const { DEFAULT_ACTION_PIN_POLICY } = await import("../services/action-pin-policy-service.js");
    const guard = requireActionPin(
      "patient_identifier_update",
      async () => ({ ...DEFAULT_ACTION_PIN_POLICY, enabled: true }),
      async () => ({ ok: true, actionReason: "" })
    );
    let payload: unknown;

    await guard(
      { user: { sub: 1, role: "receptionist" }, cookies: { rispro_action_pin: "opaque" } } as unknown as Request,
      {
        status() {
          return this;
        },
        json(body: unknown) {
          payload = body;
          return this;
        },
      } as unknown as Response,
      () => undefined
    );

    assert.deepEqual(payload, { error: "action_pin_reason_required", actionKey: "patient_identifier_update" });
  });

  it("passes consume=true for required_every_time and consume=false for required_after_inactivity", async () => {
    const { requireActionPin } = await import("./action-pin.js");
    const { DEFAULT_ACTION_PIN_POLICY } = await import("../services/action-pin-policy-service.js");
    const consumeFlags: boolean[] = [];
    const validator = async (input: { consume: boolean }) => {
      consumeFlags.push(input.consume);
      return { ok: true, actionReason: "present" };
    };

    const everyTime = requireActionPin("patient_create", async () => ({ ...DEFAULT_ACTION_PIN_POLICY, enabled: true }), validator as never);
    const afterInactivity = requireActionPin(
      "queue_status_update",
      async () => ({
        ...DEFAULT_ACTION_PIN_POLICY,
        enabled: true,
        actionModes: {
          ...DEFAULT_ACTION_PIN_POLICY.actionModes,
          queue_status_update: { receptionist: "required_after_inactivity" },
        },
      }),
      validator as never
    );
    let nextCount = 0;
    const req = { user: { sub: 1, role: "receptionist" }, cookies: { rispro_action_pin: "opaque" } } as unknown as Request;
    const res = {} as Response;

    await everyTime(req, res, () => { nextCount += 1; });
    await afterInactivity(req, res, () => { nextCount += 1; });

    assert.deepEqual(consumeFlags, [true, false]);
    assert.equal(nextCount, 2);
  });

  it("disabled_for_role blocks action", async () => {
    const { requireActionPin } = await import("./action-pin.js");
    const { DEFAULT_ACTION_PIN_POLICY } = await import("../services/action-pin-policy-service.js");
    const guard = requireActionPin("patient_create", async () => ({
      ...DEFAULT_ACTION_PIN_POLICY,
      enabled: true,
      actionModes: {
        ...DEFAULT_ACTION_PIN_POLICY.actionModes,
        patient_create: {
          ...DEFAULT_ACTION_PIN_POLICY.actionModes.patient_create,
          receptionist: "disabled_for_role",
        },
      },
    }));
    let payload: unknown;
    let nextCalled = false;

    await guard(
      { user: { sub: 1, role: "receptionist" }, cookies: {} } as Request,
      {
        status() {
          return this;
        },
        json(body: unknown) {
          payload = body;
          return this;
        },
      } as unknown as Response,
      () => { nextCalled = true; }
    );

    assert.deepEqual(payload, { error: "action_pin_disabled_for_role", actionKey: "patient_create" });
    assert.equal(nextCalled, false);
  });
});
