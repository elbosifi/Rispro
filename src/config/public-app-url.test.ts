import assert from "node:assert/strict";
import test from "node:test";
import { getPublicAppBaseUrl, getPublicAppOrigin, normalizePublicAppBaseUrl, tryGetPublicAppBaseUrl } from "./public-app-url.js";

function withEnv(values: Record<string, string | undefined>, run: () => void): void {
  const previous = Object.fromEntries(Object.keys(values).map((key) => [key, process.env[key]]));
  try {
    for (const [key, value] of Object.entries(values)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    run();
  } finally {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

test("normalizes an absolute public URL and its trailing slash", () => {
  withEnv({ NODE_ENV: "production" }, () => {
    assert.equal(normalizePublicAppBaseUrl(" https://rispro.example.test/public/ "), "https://rispro.example.test/public");
  });
});

test("strict public URL resolution requires configuration and the soft resolver can fail closed", () => {
  withEnv({ PUBLIC_APP_BASE_URL: undefined }, () => {
    assert.throws(() => getPublicAppBaseUrl(), /Missing required public base URL setting/);
    assert.equal(tryGetPublicAppBaseUrl(), null);
  });
});

test("production rejects HTTP and local or private public hosts", () => {
  withEnv({ NODE_ENV: "production" }, () => {
    assert.throws(() => normalizePublicAppBaseUrl("http://rispro.example.test"), /must use https/i);
    for (const value of ["https://localhost", "https://127.0.0.1", "https://10.1.2.3", "https://192.168.1.12", "https://172.16.1.12"]) {
      assert.throws(() => normalizePublicAppBaseUrl(value), /cannot use localhost or private IP hosts/i);
    }
  });
});

test("development retains compatible HTTP and localhost behavior", () => {
  withEnv({ NODE_ENV: "development", PUBLIC_APP_BASE_URL: "http://localhost:3000/" }, () => {
    assert.equal(getPublicAppBaseUrl(), "http://localhost:3000");
  });
});

test("origin-only resolution preserves QZ restrictions", () => {
  withEnv({ NODE_ENV: "production", PUBLIC_APP_BASE_URL: "https://rispro.example.test/" }, () => {
    assert.equal(getPublicAppOrigin(), "https://rispro.example.test");
  });
  withEnv({ NODE_ENV: "production", PUBLIC_APP_BASE_URL: "https://rispro.example.test/path" }, () => {
    assert.throws(() => getPublicAppOrigin(), /must contain only an origin/);
  });
  withEnv({ NODE_ENV: "production", PUBLIC_APP_BASE_URL: "https://rispro.example.test/?query=1" }, () => {
    assert.throws(() => getPublicAppOrigin(), /must contain only an origin/);
  });
});
