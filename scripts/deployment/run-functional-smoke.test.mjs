import assert from "node:assert/strict";
import http from "node:http";
import test from "node:test";
import { readSmokeConfig, runFunctionalSmoke, SmokeFailure } from "./run-functional-smoke.mjs";

const SHA = "a".repeat(40);
const PASSWORD = "smoke-password-must-not-appear";

async function startServer(overrides = {}) {
  let readinessAttempts = 0;
  const authMeCookies = [];
  const loginSessionCookie = overrides.loginSessionCookie ?? "rispro_session=test-token; HttpOnly";
  const originalSessionCookie = loginSessionCookie.split(";", 1)[0];
  const server = http.createServer((request, response) => {
    const route = new URL(request.url, "http://localhost").pathname;
    const status = (name, fallback) => overrides[name] ?? fallback;
    const buildSha = Object.prototype.hasOwnProperty.call(overrides, "buildSha") ? overrides.buildSha : SHA;
    if (route === "/api/health") return response.writeHead(status("healthStatus", 200), { "content-type": "application/json" }).end(JSON.stringify({ ok: true, environment: "test", buildSha }));
    if (route === "/api/ready") {
      readinessAttempts += 1;
      const ready = readinessAttempts > (overrides.readyAfter ?? 0);
      return response.writeHead(ready ? 200 : 503, { "content-type": "application/json" }).end(JSON.stringify({ ok: ready }));
    }
    if (route === "/") {
      const origin = `http://127.0.0.1:${server.address().port}`;
      const html = overrides.frontendHtml ?? (overrides.absoluteAssets
        ? `<!doctype html><html><head><link rel="stylesheet" href="${origin}/assets/main.css"></head><body><script type="module" src="${origin}/assets/main.js"></script></body></html>`
        : '<!doctype html><html><head><link rel="stylesheet" href="/assets/main.css"></head><body><script type="module" src="/assets/main.js"></script></body></html>');
      return response.writeHead(200, { "content-type": overrides.frontendContentType ?? "text/html" }).end(html);
    }
    if (route === "/assets/main.js") {
      if (overrides.assetRedirect === "same-origin") return response.writeHead(302, { location: "/assets/redirected-main.js" }).end();
      if (overrides.assetRedirect) return response.writeHead(302, { location: "https://foreign.example.invalid/main.js" }).end();
      return response.writeHead(status("jsStatus", 200), { "content-type": "application/javascript" }).end("export {};");
    }
    if (route === "/assets/redirected-main.js") return response.writeHead(200, { "content-type": "application/javascript" }).end("export {};");
    if (route === "/assets/main.css") return response.writeHead(status("cssStatus", 200), { "content-type": "text/css" }).end("body{}");
    if (route === "/api/public/appointments/cancel-preview") {
      const publicStatus = status("publicStatus", 400);
      const publicBody = Object.prototype.hasOwnProperty.call(overrides, "publicBody")
        ? overrides.publicBody
        : JSON.stringify({ error: { message: "Missing cancellation token.", details: { code: "missing_token" } } });
      return response.writeHead(publicStatus, { "content-type": overrides.publicContentType ?? "application/json" }).end(publicBody);
    }
    if (route === "/api/auth/login") {
      if (overrides.authFailure) return response.writeHead(401, { "content-type": "application/json" }).end(JSON.stringify({ message: "Invalid username or password." }));
      return response.writeHead(200, { "content-type": "application/json", "set-cookie": loginSessionCookie }).end(JSON.stringify({ user: { id: 1, role: "receptionist" } }));
    }
    if (route === "/api/settings/appointment_slip") {
      if (overrides.protectedUnauthorized) return response.writeHead(401, { "content-type": "application/json" }).end(JSON.stringify({ message: "Authentication required." }));
      return response.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify({ settings: [] }));
    }
    if (route === "/api/auth/logout") {
      const sessionClear = overrides.logoutSessionCookie ?? "rispro_session=; Expires=Thu, 01 Jan 1970 00:00:00 GMT; HttpOnly";
      const reauthClear = "rispro_reauth=; Expires=Thu, 01 Jan 1970 00:00:00 GMT; HttpOnly";
      const cookies = overrides.logoutCookies ?? (overrides.logoutSessionFirst ? [sessionClear, reauthClear] : overrides.logoutSessionMissing ? [reauthClear] : [reauthClear, sessionClear]);
      return response.writeHead(204, { "set-cookie": cookies }).end();
    }
    if (route === "/api/auth/me") {
      const cookie = request.headers.cookie || "";
      authMeCookies.push(cookie);
      if (overrides.sessionRemainsValidAfterLogout && cookie === originalSessionCookie) {
        return response.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify({ user: { id: 1, role: "receptionist" } }));
      }
      return response.writeHead(401, { "content-type": "application/json" }).end(JSON.stringify({ message: "Authentication required." }));
    }
    return response.writeHead(404).end();
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  return {
    baseUrl: `http://127.0.0.1:${address.port}`,
    authMeCookies,
    originalSessionCookie,
    close: () => new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve())),
  };
}

function config(baseUrl, extra = {}) {
  return readSmokeConfig({
    RISPRO_SMOKE_BASE_URL: baseUrl,
    RISPRO_EXPECTED_COMMIT_SHA: SHA,
    RISPRO_SMOKE_READINESS_RETRIES: "3",
    RISPRO_SMOKE_READINESS_DELAY_MS: "1",
    ...extra,
  });
}

async function expectFailure(configuration, category) {
  await assert.rejects(() => runFunctionalSmoke(configuration, () => {}), (error) => error instanceof SmokeFailure && error.category === category);
}

test("functional deployment smoke passes all checks with configured authentication", async () => {
  const fixture = await startServer();
  try {
    const lines = [];
    await runFunctionalSmoke(config(fixture.baseUrl, { RISPRO_SMOKE_AUTH_ENABLED: "true", RISPRO_SMOKE_USERNAME: "smoke", RISPRO_SMOKE_PASSWORD: PASSWORD }), (line) => lines.push(line));
    assert.deepEqual(lines, ["PASS HEALTH", "PASS READINESS", "PASS BUILD_SHA", "PASS FRONTEND_HTML", "PASS FRONTEND_ASSETS", "PASS PUBLIC_ERROR_HANDLING", "PASS AUTHENTICATION", "PASS PROTECTED_READ"]);
    assert.equal(lines.join("\n").includes("test-token"), false);
    assert.deepEqual(fixture.authMeCookies, [fixture.originalSessionCookie]);
  } finally { await fixture.close(); }
});

test("complete unauthenticated smoke passes and skips only optional checks", async () => {
  const fixture = await startServer();
  try {
    const lines = [];
    await runFunctionalSmoke(config(fixture.baseUrl), (line) => lines.push(line));
    assert.deepEqual(lines, ["PASS HEALTH", "PASS READINESS", "PASS BUILD_SHA", "PASS FRONTEND_HTML", "PASS FRONTEND_ASSETS", "PASS PUBLIC_ERROR_HANDLING", "SKIP AUTHENTICATION_NOT_CONFIGURED", "SKIP PROTECTED_READ_NOT_CONFIGURED"]);
  } finally { await fixture.close(); }
});

test("fails health when health is not successful", async () => {
  const fixture = await startServer({ healthStatus: 500 });
  try { await expectFailure(config(fixture.baseUrl), "HEALTH"); } finally { await fixture.close(); }
});

test("fails when readiness never succeeds", async () => {
  const fixture = await startServer({ readyAfter: 9 });
  try { await expectFailure(config(fixture.baseUrl), "READINESS_DATABASE"); } finally { await fixture.close(); }
});

test("fails on deployed SHA mismatch", async () => {
  const fixture = await startServer({ buildSha: "b".repeat(40) });
  try { await expectFailure(config(fixture.baseUrl), "BUILD_SHA_MISMATCH"); } finally { await fixture.close(); }
});

test("rejects absent and malformed expected SHAs", () => {
  assert.throws(() => readSmokeConfig({ RISPRO_SMOKE_BASE_URL: "https://example.invalid" }), (error) => error instanceof SmokeFailure && error.category === "CONFIGURATION");
  assert.throws(() => readSmokeConfig({ RISPRO_SMOKE_BASE_URL: "https://example.invalid", RISPRO_EXPECTED_COMMIT_SHA: "abc" }), (error) => error instanceof SmokeFailure && error.category === "CONFIGURATION");
});

test("rejects embedded URL credentials", () => {
  assert.throws(() => readSmokeConfig({ RISPRO_SMOKE_BASE_URL: "https://user@example.invalid", RISPRO_EXPECTED_COMMIT_SHA: SHA }), (error) => error instanceof SmokeFailure && error.category === "CONFIGURATION");
  assert.throws(() => readSmokeConfig({ RISPRO_SMOKE_BASE_URL: "https://user:password@example.invalid", RISPRO_EXPECTED_COMMIT_SHA: SHA }), (error) => error instanceof SmokeFailure && error.category === "CONFIGURATION");
});

test("accepts only surrounding runtime SHA whitespace and case differences", async () => {
  const fixture = await startServer({ buildSha: ` \t${SHA.toUpperCase()}\n` });
  try { await runFunctionalSmoke(config(fixture.baseUrl), () => {}); } finally { await fixture.close(); }
});

test("fails when the runtime SHA is absent, malformed, internally spaced, or has trailing content", async () => {
  const absent = await startServer({ buildSha: null });
  const malformed = await startServer({ buildSha: "not-a-sha" });
  const internalWhitespace = await startServer({ buildSha: `${SHA.slice(0, 20)} ${SHA.slice(20)}` });
  const trailingContent = await startServer({ buildSha: `${SHA}x` });
  try {
    await expectFailure(config(absent.baseUrl), "HEALTH");
    await expectFailure(config(malformed.baseUrl), "BUILD_SHA_MISMATCH");
    await expectFailure(config(internalWhitespace.baseUrl), "BUILD_SHA_MISMATCH");
    await expectFailure(config(trailingContent.baseUrl), "BUILD_SHA_MISMATCH");
  } finally { await absent.close(); await malformed.close(); await internalWhitespace.close(); await trailingContent.close(); }
});

test("rejects prefix-only runtime SHA matches", async () => {
  const fixture = await startServer({ buildSha: SHA.slice(0, -1) });
  try { await expectFailure(config(fixture.baseUrl), "BUILD_SHA_MISMATCH"); } finally { await fixture.close(); }
});

test("fails when a referenced frontend asset is missing", async () => {
  const fixture = await startServer({ cssStatus: 404 });
  try { await expectFailure(config(fixture.baseUrl), "FRONTEND_ASSET_MISSING"); } finally { await fixture.close(); }
});

test("fails when a referenced first-party JavaScript asset is missing", async () => {
  const fixture = await startServer({ jsStatus: 404 });
  try { await expectFailure(config(fixture.baseUrl), "FRONTEND_ASSET_MISSING"); } finally { await fixture.close(); }
});

test("extracts assets across valid HTML attribute formats and ignores external assets", async () => {
  const fixture = await startServer({ frontendHtml: '<HTML><HEAD><LINK data-x=1 HREF = /assets/main.css REL=stylesheet></HEAD><BODY><SCRIPT defer SRC=\'/assets/main.js\'></SCRIPT><SCRIPT SRC=https://third-party.example.invalid/analytics.js></SCRIPT></BODY></HTML>' });
  try { await runFunctionalSmoke(config(fixture.baseUrl), () => {}); } finally { await fixture.close(); }
});

test("accepts absolute same-origin assets", async () => {
  const fixture = await startServer({ absoluteAssets: true });
  try { await runFunctionalSmoke(config(fixture.baseUrl), () => {}); } finally { await fixture.close(); }
});

test("classifies malformed asset URLs as frontend asset failures", async () => {
  const fixture = await startServer({ frontendHtml: '<html><script src="http://[bad.js"></script><link href="/assets/main.css"></html>' });
  try { await expectFailure(config(fixture.baseUrl), "FRONTEND_ASSET_MISSING"); } finally { await fixture.close(); }
});

test("follows same-origin first-party asset redirects and rejects foreign redirects", async () => {
  const sameOrigin = await startServer({ assetRedirect: "same-origin" });
  const foreign = await startServer({ assetRedirect: "foreign" });
  try {
    await runFunctionalSmoke(config(sameOrigin.baseUrl), () => {});
    await expectFailure(config(foreign.baseUrl), "FRONTEND_ASSET_MISSING");
  } finally { await sameOrigin.close(); await foreign.close(); }
});

test("fails when the public invalid-request endpoint returns 5xx", async () => {
  const fixture = await startServer({ publicStatus: 500 });
  try { await expectFailure(config(fixture.baseUrl), "PUBLIC_ENDPOINT_5XX"); } finally { await fixture.close(); }
});

test("requires the controlled public JSON error contract", async () => {
  const expected = await startServer();
  const html = await startServer({ publicContentType: "text/html", publicBody: "<html>bad</html>" });
  const malformed = await startServer({ publicBody: "not-json" });
  const wrongShape = await startServer({ publicBody: JSON.stringify({ error: { details: { code: "other" } } }) });
  const redirect = await startServer({ publicStatus: 302, publicBody: "" });
  const success = await startServer({ publicStatus: 200 });
  try {
    await runFunctionalSmoke(config(expected.baseUrl), () => {});
    await expectFailure(config(html.baseUrl), "PUBLIC_ERROR_HANDLING");
    await expectFailure(config(malformed.baseUrl), "PUBLIC_ERROR_HANDLING");
    await expectFailure(config(wrongShape.baseUrl), "PUBLIC_ERROR_HANDLING");
    await expectFailure(config(redirect.baseUrl), "PUBLIC_ERROR_HANDLING");
    await expectFailure(config(success.baseUrl), "PUBLIC_ERROR_HANDLING");
  } finally {
    await expected.close(); await html.close(); await malformed.close(); await wrongShape.close(); await redirect.close(); await success.close();
  }
});

test("fails configured authentication without printing credentials", async () => {
  const fixture = await startServer({ authFailure: true });
  try {
    const lines = [];
    await assert.rejects(
      () => runFunctionalSmoke(config(fixture.baseUrl, { RISPRO_SMOKE_AUTH_ENABLED: "true", RISPRO_SMOKE_USERNAME: "smoke", RISPRO_SMOKE_PASSWORD: PASSWORD }), (line) => lines.push(line)),
      (error) => error instanceof SmokeFailure && error.category === "AUTHENTICATION",
    );
    assert.equal(lines.join("\n").includes(PASSWORD), false);
  } finally { await fixture.close(); }
});

test("fails protected read when the authenticated request is unauthorized", async () => {
  const fixture = await startServer({ protectedUnauthorized: true });
  try { await expectFailure(config(fixture.baseUrl, { RISPRO_SMOKE_AUTH_ENABLED: "true", RISPRO_SMOKE_USERNAME: "smoke", RISPRO_SMOKE_PASSWORD: PASSWORD }), "PROTECTED_READ"); } finally { await fixture.close(); }
});

test("fails when logout clears the client cookie but leaves the original server session valid", async () => {
  const fixture = await startServer({ sessionRemainsValidAfterLogout: true });
  try {
    const lines = [];
    await assert.rejects(
      () => runFunctionalSmoke(config(fixture.baseUrl, { RISPRO_SMOKE_AUTH_ENABLED: "true", RISPRO_SMOKE_USERNAME: "smoke", RISPRO_SMOKE_PASSWORD: PASSWORD }), (line) => lines.push(line)),
      (error) => error instanceof SmokeFailure && error.category === "AUTHENTICATION",
    );
    assert.deepEqual(fixture.authMeCookies, [fixture.originalSessionCookie]);
    assert.equal(lines.join("\n").includes("test-token"), false);
    assert.equal(lines.join("\n").includes(PASSWORD), false);
  } finally { await fixture.close(); }
});

test("accepts either logout cookie order and rejects a missing session clear", async () => {
  const sessionFirst = await startServer({ logoutSessionFirst: true });
  const reauthFirst = await startServer();
  const missing = await startServer({ logoutSessionMissing: true });
  try {
    await runFunctionalSmoke(config(sessionFirst.baseUrl, { RISPRO_SMOKE_AUTH_ENABLED: "true", RISPRO_SMOKE_USERNAME: "smoke", RISPRO_SMOKE_PASSWORD: PASSWORD }), () => {});
    await runFunctionalSmoke(config(reauthFirst.baseUrl, { RISPRO_SMOKE_AUTH_ENABLED: "true", RISPRO_SMOKE_USERNAME: "smoke", RISPRO_SMOKE_PASSWORD: PASSWORD }), () => {});
    await expectFailure(config(missing.baseUrl, { RISPRO_SMOKE_AUTH_ENABLED: "true", RISPRO_SMOKE_USERNAME: "smoke", RISPRO_SMOKE_PASSWORD: PASSWORD }), "AUTHENTICATION");
  } finally { await sessionFirst.close(); await reauthFirst.close(); await missing.close(); }
});

test("requires a structurally valid session-cookie clearing attribute", async () => {
  const exactMaxAge = await startServer({ logoutSessionCookie: "rispro_session=; Max-Age = 0; HttpOnly" });
  const pastExpires = await startServer({ logoutSessionCookie: "rispro_session=; Expires=Thu, 01 Jan 1970 00:00:00 GMT; HttpOnly" });
  const futureExpires = await startServer({ logoutSessionCookie: `rispro_session=; Expires=${new Date(Date.now() + 60_000).toUTCString()}; HttpOnly` });
  const malformedExpires = await startServer({ logoutSessionCookie: "rispro_session=; Expires=not-a-date; HttpOnly" });
  const maxAgeSuffix = await startServer({ logoutSessionCookie: "rispro_session=; Max-Age=0abc; HttpOnly" });
  const maxAgeMalformed = await startServer({ logoutSessionCookie: "rispro_session=; Max-Age=00x; HttpOnly" });
  const missingExpiry = await startServer({ logoutSessionCookie: "rispro_session=; HttpOnly" });
  const nonemptyValue = await startServer({ logoutSessionCookie: "rispro_session=still-valid; Max-Age=0; HttpOnly" });
  const authenticated = { RISPRO_SMOKE_AUTH_ENABLED: "true", RISPRO_SMOKE_USERNAME: "smoke", RISPRO_SMOKE_PASSWORD: PASSWORD };
  try {
    await runFunctionalSmoke(config(exactMaxAge.baseUrl, authenticated), () => {});
    await runFunctionalSmoke(config(pastExpires.baseUrl, authenticated), () => {});
    for (const fixture of [futureExpires, malformedExpires, maxAgeSuffix, maxAgeMalformed, missingExpiry, nonemptyValue]) {
      await expectFailure(config(fixture.baseUrl, authenticated), "AUTHENTICATION");
    }
  } finally {
    await exactMaxAge.close(); await pastExpires.close(); await futureExpires.close(); await malformedExpires.close();
    await maxAgeSuffix.close(); await maxAgeMalformed.close(); await missingExpiry.close(); await nonemptyValue.close();
  }
});

test("accepts a bounded transient readiness delay", async () => {
  const fixture = await startServer({ readyAfter: 1 });
  try { await runFunctionalSmoke(config(fixture.baseUrl), () => {}); } finally { await fixture.close(); }
});
