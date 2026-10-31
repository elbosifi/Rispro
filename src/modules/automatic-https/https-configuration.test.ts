import assert from "node:assert/strict";
import test from "node:test";
import { decryptRuntimeSecret } from "../../services/runtime-secret-crypto.js";
import { caddyConfiguration, cnameMatches, isPublicAddress, requiredCname, validateHttpsConfiguration } from "./https-configuration.js";

const input = { enabled: true, hostname: "rispro.nccb.com.ly", serverUrl: "https://acmedns.provider.org", username: "test-user", password: "synthetic-secret", subdomain: "account-id", fullDomain: "account-id.acmedns.provider.org" };

test("strict configuration validation encrypts credentials and retains them only for the same account", () => {
  const previousKey = process.env.RISPRO_SECRET_ENCRYPTION_KEY;
  process.env.RISPRO_SECRET_ENCRYPTION_KEY = Buffer.alloc(32, 3).toString("base64");
  try {
    const saved = validateHttpsConfiguration(input);
    assert.equal(saved.redirectHttpToHttps, false);
    assert.equal(validateHttpsConfiguration({ ...input, redirectHttpToHttps: true }).redirectHttpToHttps, true);
    assert.equal(JSON.stringify(saved).includes(input.password), false);
    assert.deepEqual(JSON.parse(decryptRuntimeSecret(saved.credentials)), { username: input.username, password: input.password });
    assert.deepEqual(validateHttpsConfiguration({ ...input, username: "", password: "" }, saved).credentials, saved.credentials);
    for (const patch of [{ hostname: "127.0.0.1" }, { hostname: "a.example.com\nrespond bad" }, { serverUrl: "http://acmedns.provider.org" }, { serverUrl: "https://127.0.0.1" }, { serverUrl: "https://acmedns.provider.org/path" }, { serverUrl: "https://user:secret@acmedns.provider.org" }, { fullDomain: "fabricated.provider.org" }, { command: "anything" }, { enabled: "true" }]) {
      assert.throws(() => validateHttpsConfiguration({ ...input, ...patch }));
    }
    assert.throws(() => validateHttpsConfiguration({ ...input, serverUrl: "https://other.provider.org", username: "", password: "" }, saved));
    delete process.env.RISPRO_SECRET_ENCRYPTION_KEY;
    assert.throws(() => validateHttpsConfiguration(input), /not configured/);
  } finally {
    if (previousKey === undefined) delete process.env.RISPRO_SECRET_ENCRYPTION_KEY;
    else process.env.RISPRO_SECRET_ENCRYPTION_KEY = previousKey;
  }
});

test("CNAME uses the configured account full domain and exact DNS matching", () => {
  assert.deepEqual(requiredCname(input), { type: "CNAME", name: "_acme-challenge.rispro.nccb.com.ly", target: input.fullDomain });
  assert.equal(cnameMatches([`${input.fullDomain.toUpperCase()}.`], input.fullDomain), true);
  assert.equal(cnameMatches(["wrong.provider.org"], input.fullDomain), false);
  assert.equal(cnameMatches([], input.fullDomain), false);
  assert.equal(cnameMatches([input.fullDomain, "wrong.provider.org"], input.fullDomain), false);
});

test("provider address policy rejects LAN, loopback, metadata and reserved destinations", () => {
  for (const address of ["0.0.0.0", "127.0.0.1", "10.1.2.3", "169.254.169.254", "172.17.0.1", "192.168.1.1", "100.64.0.1", "198.18.0.1", "224.0.0.1", "::1", "::ffff:127.0.0.1", "fe80::1", "fc00::1", "2001:db8::1", "2002:7f00:1::"]) assert.equal(isPublicAddress(address), false, address);
  for (const address of ["8.8.8.8", "1.1.1.1", "2606:4700:4700::1111"]) assert.equal(isPublicAddress(address), true, address);
});

test("Caddy template uses DNS-only ACME, restricted credentials and streaming existing gateway", () => {
  const config = caddyConfiguration({ ...input, id: "test", credentials: {} } as never, "/run/rispro-https/account.json", "a".repeat(64), true);
  assert.match(JSON.stringify(config), /acme-staging-v02/);
  assert.equal(config.admin.listen, "unix//run/rispro-https/admin.sock|0600");
  const server = config.apps.http.servers.rispro;
  assert.equal(server.routes[0].handle[0].upstreams[0].dial, "gateway:8080");
  assert.equal(server.routes[0].handle[0].flush_interval, -1);
  assert.equal(JSON.stringify(config).includes("synthetic-secret"), false);
  assert.deepEqual(config.apps.tls.automation.policies[0].issuers[0].challenges.http, { disabled: true });
});
