import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import express from "express";
import cookieParser from "cookie-parser";
import jwt from "jsonwebtoken";
import { randomUUID } from "node:crypto";

process.env.DATABASE_URL ||= "postgresql://rispro_test:rispro_test_password@localhost:5433/rispro_test";
process.env.JWT_SECRET ||= "passkey-test-secret";

type RequestResult<T> = { status: number; data: T; cookies: string[] };

async function startServer(router: import("express").Router): Promise<{ baseUrl: string; close: () => Promise<void> }> {
  const { errorHandler } = await import("../middleware/error-handler.js");
  const app = express();
  app.use(express.json());
  app.use(cookieParser());
  app.use("/api/auth/passkeys", router);
  app.use(errorHandler);
  const server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  const port = typeof address === "object" && address ? address.port : 0;
  return {
    baseUrl: `http://127.0.0.1:${port}`,
    close: () => new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()))
  };
}

function cookies(response: Response): string[] {
  const headers = response.headers as Headers & { getSetCookie?: () => string[] };
  return headers.getSetCookie?.() ?? (response.headers.get("set-cookie") ? [response.headers.get("set-cookie") as string] : []);
}

async function request<T>(baseUrl: string, path: string, options: { body?: unknown; cookie?: string } = {}): Promise<RequestResult<T>> {
  const response = await fetch(`${baseUrl}/api/auth/passkeys${path}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(options.cookie ? { Cookie: options.cookie } : {})
    },
    ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) })
  });
  return { status: response.status, data: await response.json() as T, cookies: cookies(response) };
}

function cookieHeader(setCookies: string[]): string {
  return setCookies.map((value) => value.split(";", 1)[0]).join("; ");
}

test("passkey routes require auth for registration options, store registrations, issue normal login cookies, reject invalid challenges, and block disabled users", async () => {
  const [{ pool }, { createPasskeyRouter }, { env }] = await Promise.all([
    import("../db/pool.js"),
    import("./passkeys.js"),
    import("../config/env.js")
  ]);
  try {
    await pool.query("select 1 from user_passkeys limit 1");
  } catch {
    return;
  }

  const suffix = randomUUID().replace(/-/g, "").slice(0, 12);
  const activeUsername = `passkey_active_${suffix}`;
  const disabledUsername = `passkey_disabled_${suffix}`;
  const registeredCredential = `registered-credential-${suffix}`;
  const disabledCredential = `disabled-credential-${suffix}`;
  const createdUsers: number[] = [];
  const makeUser = async (username: string, active: boolean) => {
    const result = await pool.query<{ id: string }>(
      `insert into users (username, full_name, password_hash, role, is_active)
       values ($1, $2, $3, 'supervisor', $4) returning id::text as id`,
      [username, `Passkey ${username}`, "unused", active]
    );
    const id = Number(result.rows[0].id);
    createdUsers.push(id);
    return { id, username };
  };

  const active = await makeUser(activeUsername, true);
  const disabled = await makeUser(disabledUsername, false);
  const previousConfiguration = await pool.query<{ setting_key: string; setting_value: unknown; updated_by_user_id: string | null }>(
    "select setting_key, setting_value, updated_by_user_id::text as updated_by_user_id from system_settings where category = 'passkey'"
  );
  await pool.query("delete from system_settings where category = 'passkey'");
  await pool.query(
    `insert into system_settings (category, setting_key, setting_value, updated_by_user_id)
     values ('passkey', 'rp_name', $1::jsonb, $3), ('passkey', 'origin', $2::jsonb, $3)`,
    [JSON.stringify({ value: "RISpro Development" }), JSON.stringify({ value: "http://localhost" }), active.id]
  );
  await pool.query(
    `insert into user_passkeys (user_id, credential_id, public_key, counter, transports)
     values ($1, $2, $3, 0, '[]'::jsonb)`,
    [disabled.id, disabledCredential, Buffer.from([1, 2, 3])]
  );

  const fakeWebAuthn = {
    generateRegistrationOptions: async () => ({ challenge: "registration-challenge" }),
    verifyRegistrationResponse: async () => ({
      verified: true,
      registrationInfo: {
        credential: { id: registeredCredential, publicKey: new Uint8Array([4, 5, 6]), counter: 0 },
        credentialBackedUp: true,
        credentialDeviceType: "multiDevice"
      }
    }),
    generateAuthenticationOptions: async () => ({ challenge: "authentication-challenge" }),
    verifyAuthenticationResponse: async () => ({
      verified: true,
      authenticationInfo: {
        newCounter: 1,
        credentialDeviceType: "multiDevice",
        credentialBackedUp: true
      }
    })
  } as unknown as import("../services/passkey-service.js").PasskeyWebAuthn;
  const server = await startServer(createPasskeyRouter(fakeWebAuthn));
  const authCookie = `${env.cookieName}=${jwt.sign({ sub: active.id, role: "supervisor", username: active.username, fullName: "Passkey Active" }, process.env.JWT_SECRET as string)}`;

  try {
    const unauthenticated = await request<{ error: { message: string } }>(server.baseUrl, "/register/options");
    assert.equal(unauthenticated.status, 401, "registration options require an authenticated RISpro user");

    const registrationOptions = await request<{ challenge: string }>(server.baseUrl, "/register/options", { cookie: authCookie });
    assert.equal(registrationOptions.status, 200);
    assert.equal(registrationOptions.data.challenge, "registration-challenge");
    const registration = await request<{ verified: boolean }>(server.baseUrl, "/register/verify", {
      cookie: `${authCookie}; ${cookieHeader(registrationOptions.cookies)}`,
      body: { response: { id: registeredCredential, response: { transports: ["internal"] } } }
    });
    assert.deepEqual(registration.data, { verified: true }, "successful registration is accepted");
    const stored = await pool.query<{ credential_id: string; device_type: string; backed_up: boolean }>(
      "select credential_id, device_type, backed_up from user_passkeys where user_id = $1 and credential_id = $2",
      [active.id, registeredCredential]
    );
    assert.deepEqual(stored.rows[0], { credential_id: registeredCredential, device_type: "multiDevice", backed_up: true }, "successful registration stores a credential");

    const authenticationOptions = await request<{ challenge: string }>(server.baseUrl, "/login/options");
    assert.equal(authenticationOptions.status, 200);
    assert.equal(authenticationOptions.data.challenge, "authentication-challenge", "authentication options return a challenge");
    const login = await request<{ user: { id: number; username: string } }>(server.baseUrl, "/login/verify", {
      cookie: cookieHeader(authenticationOptions.cookies),
      body: { response: { id: registeredCredential } }
    });
    assert.equal(login.status, 200);
    assert.equal(Number(login.data.user.id), active.id, "successful passkey verification returns the normal login user");
    assert.equal(login.data.user.username, active.username);
    const loginCookie = login.cookies.find((value) => value.startsWith(`${env.cookieName}=`));
    assert.ok(loginCookie, "successful passkey verification creates the normal RISpro session cookie");

    const invalidChallenge = await request<{ error: { message: string } }>(server.baseUrl, "/login/verify", {
      body: { response: { id: registeredCredential } }
    });
    assert.equal(invalidChallenge.status, 400);
    assert.match(invalidChallenge.data.error.message, /challenge/i, "invalid challenge is rejected");

    const disabledOptions = await request<{ challenge: string }>(server.baseUrl, "/login/options");
    const disabledLogin = await request<{ error: { message: string } }>(server.baseUrl, "/login/verify", {
      cookie: cookieHeader(disabledOptions.cookies),
      body: { response: { id: disabledCredential } }
    });
    assert.equal(disabledLogin.status, 401, "disabled users cannot authenticate with a passkey");
  } finally {
    await server.close();
    await pool.query("delete from audit_log where changed_by_user_id = any($1::bigint[])", [createdUsers]);
    await pool.query("delete from system_settings where category = 'passkey'");
    await pool.query("delete from users where id = any($1::bigint[])", [createdUsers]);
    for (const setting of previousConfiguration.rows) {
      await pool.query(
        `insert into system_settings (category, setting_key, setting_value, updated_by_user_id)
         values ('passkey', $1, $2::jsonb, $3)`,
        [setting.setting_key, JSON.stringify(setting.setting_value), setting.updated_by_user_id]
      );
    }
  }
});
