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

  it("returns reason-required shape before verification when action needs reason", async () => {
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

    assert.deepEqual(payload, {
      error: "action_pin_reason_required",
      actionKey: "patient_identifier_update",
    });
  });
});
