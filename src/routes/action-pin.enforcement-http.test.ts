import { after, describe, it } from "node:test";
import assert from "node:assert/strict";
import express, { type Request, type Response } from "express";
import cookieParser from "cookie-parser";
import http from "node:http";

import type {
  ActionPinActionKey,
  ActionPinPolicy,
  ActionPinMode,
} from "../services/action-pin-policy-service.js";
import type { ActionPinVerificationValidationInput } from "../services/action-pin-service.js";
import type { Role } from "../types/domain.js";

process.env.DATABASE_URL ||= "postgres://user:password@localhost:5432/rispro_test";
process.env.JWT_SECRET ||= "test-secret";

interface VerificationFixture {
  userId: number;
  actionKey: ActionPinActionKey;
  reason: string | null;
  consumed?: boolean;
}

async function defaultPolicy(): Promise<ActionPinPolicy> {
  const { DEFAULT_ACTION_PIN_POLICY } = await import("../services/action-pin-policy-service.js");
  return DEFAULT_ACTION_PIN_POLICY;
}

async function policyFor(actionKey: ActionPinActionKey, mode: ActionPinMode, role: Role = "receptionist"): Promise<ActionPinPolicy> {
  const { DEFAULT_ACTION_PIN_POLICY } = await import("../services/action-pin-policy-service.js");
  return {
    ...DEFAULT_ACTION_PIN_POLICY,
    enabled: true,
    actionModes: {
      ...DEFAULT_ACTION_PIN_POLICY.actionModes,
      [actionKey]: {
        ...DEFAULT_ACTION_PIN_POLICY.actionModes[actionKey],
        [role]: mode,
      },
    },
  };
}

async function startHarness(options: {
  policy: ActionPinPolicy;
  verifications?: Record<string, VerificationFixture>;
}): Promise<{ baseUrl: string; close: () => Promise<void>; hits: Record<string, number> }> {
  const { requireActionPin } = await import("../middleware/action-pin.js");
  const app = express();
  const hits: Record<string, number> = {};
  const verifications = options.verifications ?? {};

  app.use(express.json());
  app.use(cookieParser());
  app.use((req, _res, next) => {
    req.user = {
      sub: Number(req.header("x-user-id") ?? "1"),
      role: (req.header("x-role") ?? "receptionist") as Role,
      username: "route_test",
      fullName: "Route Test",
    };
    next();
  });

  const validateVerification = async (input: ActionPinVerificationValidationInput) => {
    const token = String(input.token ?? "");
    const verification = verifications[token];
    if (
      !verification ||
      verification.consumed ||
      Number(input.userId) !== verification.userId ||
      (input.requireActionScoped && verification.actionKey !== input.actionKey)
    ) {
      return { ok: false as const, reason: "not_found" as const };
    }
    if (input.consume) verification.consumed = true;
    return {
      ok: true as const,
      verificationId: 1,
      actionKey: verification.actionKey,
      actionReason: verification.reason,
      expiresAt: new Date(Date.now() + 300_000).toISOString(),
    };
  };

  const handler = (name: string) => (req: Request, res: Response) => {
    hits[name] = (hits[name] ?? 0) + 1;
    res.status(201).json({ ok: true, route: name, body: req.body ?? null });
  };

  app.post("/api/patients", requireActionPin("patient_create", async () => options.policy, validateVerification), handler("patient_create"));
  app.put("/api/patients/:patientId", requireActionPin("patient_update", async () => options.policy, validateVerification), handler("patient_update"));
  app.post("/api/v2/appointments", requireActionPin("appointment_create", async () => options.policy, validateVerification), handler("appointment_create"));
  app.post("/api/queue/walk-in", requireActionPin("queue_walk_in", async () => options.policy, validateVerification), handler("queue_walk_in"));

  const server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const address = server.address();
  const port = typeof address === "object" && address ? address.port : 0;
  return {
    baseUrl: `http://127.0.0.1:${port}`,
    close: async () => { await new Promise<void>((resolve) => server.close(() => resolve())); },
    hits,
  };
}

async function postJson(baseUrl: string, path: string, options: {
  method?: string;
  body?: unknown;
  token?: string;
  userId?: number;
} = {}) {
  const headers: Record<string, string> = {
    "content-type": "application/json",
    "x-user-id": String(options.userId ?? 1),
  };
  if (options.token) headers.cookie = `rispro_action_pin=${options.token}`;
  const response = await fetch(`${baseUrl}${path}`, {
    method: options.method ?? "POST",
    headers,
    body: JSON.stringify(options.body ?? {}),
  });
  return {
    status: response.status,
    text: await response.text(),
  };
}

describe("Action PIN HTTP route enforcement", () => {
  const harnesses: Array<{ close: () => Promise<void> }> = [];

  after(async () => {
    for (const harness of harnesses.splice(0)) {
      await harness.close();
    }
  });

  async function harness(options: Parameters<typeof startHarness>[0]) {
    const app = await startHarness(options);
    harnesses.push(app);
    return app;
  }

  it("allows patient create through when global policy is disabled", async () => {
    const app = await harness({ policy: await defaultPolicy() });

    const response = await postJson(app.baseUrl, "/api/patients", { body: { arabicFullName: "x" } });

    assert.equal(response.status, 201);
    assert.equal(app.hits.patient_create, 1);
  });

  it("requires, consumes, and action-scopes patient_create verification", async () => {
    const app = await harness({
      policy: await policyFor("patient_create", "required_every_time"),
      verifications: {
        patientCreateToken: { userId: 1, actionKey: "patient_create", reason: null },
        appointmentCreateToken: { userId: 1, actionKey: "appointment_create", reason: null },
        otherUserToken: { userId: 2, actionKey: "patient_create", reason: null },
      },
    });

    const missing = await postJson(app.baseUrl, "/api/patients");
    assert.equal(missing.status, 403);
    assert.match(missing.text, /action_pin_required/);
    assert.equal(app.hits.patient_create ?? 0, 0);

    const valid = await postJson(app.baseUrl, "/api/patients", { token: "patientCreateToken" });
    assert.equal(valid.status, 201);
    assert.equal(app.hits.patient_create, 1);

    const reused = await postJson(app.baseUrl, "/api/patients", { token: "patientCreateToken" });
    assert.equal(reused.status, 403);

    const wrongAction = await postJson(app.baseUrl, "/api/patients", { token: "appointmentCreateToken" });
    assert.equal(wrongAction.status, 403);

    const wrongUser = await postJson(app.baseUrl, "/api/patients", { token: "otherUserToken", userId: 1 });
    assert.equal(wrongUser.status, 403);
  });

  it("lets appointment_create reach the handler after Action PIN and preserves override payload", async () => {
    const app = await harness({
      policy: await policyFor("appointment_create", "required_every_time"),
      verifications: {
        appointmentCreateToken: { userId: 1, actionKey: "appointment_create", reason: null },
      },
    });

    const missing = await postJson(app.baseUrl, "/api/v2/appointments", { body: { override: { reason: "capacity" } } });
    assert.equal(missing.status, 403);
    assert.equal(app.hits.appointment_create ?? 0, 0);

    const valid = await postJson(app.baseUrl, "/api/v2/appointments", {
      token: "appointmentCreateToken",
      body: { override: { supervisorUsername: "sup", supervisorPassword: "pw", reason: "capacity" } },
    });

    assert.equal(valid.status, 201);
    assert.match(valid.text, /"override":\{"supervisorUsername":"sup","supervisorPassword":"pw","reason":"capacity"\}/);
  });

  it("requires Action PIN for queue walk-in when policy requires it", async () => {
    const app = await harness({ policy: await policyFor("queue_walk_in", "required_every_time") });

    const response = await postJson(app.baseUrl, "/api/queue/walk-in");

    assert.equal(response.status, 403);
    assert.match(response.text, /action_pin_required/);
    assert.equal(app.hits.queue_walk_in ?? 0, 0);
  });

  it("requires reason-bearing verification for reason-required patient update", async () => {
    const app = await harness({
      policy: await policyFor("patient_update", "required_every_time_with_reason"),
      verifications: {
        noReason: { userId: 1, actionKey: "patient_update", reason: null },
        withReason: { userId: 1, actionKey: "patient_update", reason: "corrected identity" },
      },
    });

    const noReason = await postJson(app.baseUrl, "/api/patients/123", { method: "PUT", token: "noReason" });
    assert.equal(noReason.status, 403);
    assert.match(noReason.text, /action_pin_reason_required/);
    assert.equal(app.hits.patient_update ?? 0, 0);

    const withReason = await postJson(app.baseUrl, "/api/patients/123", { method: "PUT", token: "withReason" });
    assert.equal(withReason.status, 201);
    assert.equal(app.hits.patient_update, 1);
  });

  it("does not expose PIN or verification secrets in enforcement errors", async () => {
    const rawToken = "secretVerificationCookieValue";
    const rawPin = "1234";
    const app = await harness({ policy: await policyFor("patient_create", "required_every_time") });

    const response = await postJson(app.baseUrl, "/api/patients", {
      token: rawToken,
      body: { pin: rawPin, pin_hash: "pinHashValue", verification_token_hash: "tokenHashValue" },
    });

    assert.equal(response.status, 403);
    assert.equal(response.text.includes(rawToken), false);
    assert.equal(response.text.includes(rawPin), false);
    assert.equal(response.text.includes("pinHashValue"), false);
    assert.equal(response.text.includes("tokenHashValue"), false);
    assert.equal(response.text.includes("verification_token_hash"), false);
  });
});
