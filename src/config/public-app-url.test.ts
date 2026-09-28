import assert from "node:assert/strict";
import test from "node:test";
import { getPublicAppBaseUrl, normalizePublicAppBaseUrl } from "./public-app-url.js";
import { pool } from "../db/pool.js";

function withEnv(values: Record<string, string | undefined>, run: () => void): void {
  const previous = Object.fromEntries(Object.keys(values).map((key) => [key, process.env[key]]));
  try { for (const [key, value] of Object.entries(values)) value === undefined ? delete process.env[key] : process.env[key] = value; run(); }
  finally { for (const [key, value] of Object.entries(previous)) value === undefined ? delete process.env[key] : process.env[key] = value; }
}

test("normalizes a clean absolute public origin and trailing slash", () => {
  withEnv({ NODE_ENV: "production" }, () => assert.equal(normalizePublicAppBaseUrl(" https://rispro.example.test/ "), "https://rispro.example.test"));
});

test("requires an absolute configured value", () => {
  assert.throws(() => normalizePublicAppBaseUrl(""), /Missing required public base URL setting: deployment_identity\.public_app_base_url/);
  assert.throws(() => normalizePublicAppBaseUrl("rispro.example.test"), /absolute URL/);
});

test("production accepts HTTPS and rejects insecure or private origins", () => {
  withEnv({ NODE_ENV: "production" }, () => {
    assert.equal(normalizePublicAppBaseUrl("https://rispro.example.test"), "https://rispro.example.test");
    assert.throws(() => normalizePublicAppBaseUrl("http://rispro.example.test"), /must use https/i);
    for (const value of ["https://localhost", "https://127.0.0.1", "https://10.1.2.3", "https://192.168.1.12", "https://172.16.1.12", "https://rispro.local"]) {
      assert.throws(() => normalizePublicAppBaseUrl(value), /cannot use localhost or private IP hosts/i);
    }
  });
});

test("always rejects credentials, paths, queries, and hashes", () => {
  for (const value of ["https://user:pass@rispro.example.test", "https://rispro.example.test/path", "https://rispro.example.test?x=1", "https://rispro.example.test#top"]) {
    assert.throws(() => normalizePublicAppBaseUrl(value), /must contain only an origin/);
  }
});

test("development permits clean HTTP localhost and private origins", () => {
  withEnv({ NODE_ENV: "development" }, () => {
    assert.equal(normalizePublicAppBaseUrl("http://localhost:3000/"), "http://localhost:3000");
    assert.equal(normalizePublicAppBaseUrl("http://192.168.1.20:3000"), "http://192.168.1.20:3000");
  });
});

test("reads and normalizes the persisted deployment identity setting", async () => {
  const previous = await pool.query<{ setting_value: unknown }>("select setting_value from system_settings where category = 'deployment_identity' and setting_key = 'public_app_base_url'");
  try {
    await pool.query("update system_settings set setting_value = '{\"value\":\"http://localhost:3100/\"}'::jsonb where category = 'deployment_identity' and setting_key = 'public_app_base_url'");
    await new Promise<void>((resolve) => withEnv({ NODE_ENV: "development" }, () => { getPublicAppBaseUrl().then((value) => { assert.equal(value, "http://localhost:3100"); resolve(); }); }));
  } finally {
    if (previous.rows[0]) await pool.query("update system_settings set setting_value = $1::jsonb where category = 'deployment_identity' and setting_key = 'public_app_base_url'", [JSON.stringify(previous.rows[0].setting_value)]);
  }
});
