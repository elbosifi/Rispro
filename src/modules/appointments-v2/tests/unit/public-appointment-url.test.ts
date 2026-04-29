import test from "node:test";
import assert from "node:assert/strict";
import { buildPublicAppointmentUrlFromSettings } from "../../public/utils/public-appointment-url-core.js";

function withEnv(vars: Record<string, string>, fn: () => void): void {
  const previous: Record<string, string | undefined> = {};
  for (const key of Object.keys(vars)) {
    previous[key] = process.env[key];
    process.env[key] = vars[key];
  }
  try {
    fn();
  } finally {
    for (const key of Object.keys(vars)) {
      if (previous[key] == null) delete process.env[key];
      else process.env[key] = previous[key];
    }
  }
}

test("buildPublicAppointmentUrl uses DB setting canonical domain and /public/appointment?t=", () => {
  withEnv(
    {
      NODE_ENV: "production",
      PUBLIC_APP_BASE_URL: "https://env.example.test",
    },
    () => {
      const url = buildPublicAppointmentUrlFromSettings("signed-token", {
        risproPublicBaseUrl: "https://rispro.nccb.com.ly",
      });
      assert.equal(url, "https://rispro.nccb.com.ly/public/appointment?t=signed-token");
      assert.ok(url.includes("/public/appointment?t="));
    }
  );
});

test("DB setting overrides env fallback", () => {
  withEnv(
    {
      NODE_ENV: "production",
      PUBLIC_APP_BASE_URL: "https://env.example.test",
    },
    () => {
      const url = buildPublicAppointmentUrlFromSettings("abc", {
        risproPublicBaseUrl: "https://rispro.nccb.com.ly/",
      });
      assert.equal(url, "https://rispro.nccb.com.ly/public/appointment?t=abc");
      assert.ok(!url.includes("//public/appointment"));
    }
  );
});

test("PUBLIC_APP_BASE_URL fallback works when DB setting is empty", () => {
  withEnv(
    {
      NODE_ENV: "production",
      PUBLIC_APP_BASE_URL: "https://rispro.nccb.com.ly/",
    },
    () => {
      const url = buildPublicAppointmentUrlFromSettings("abc", {
        risproPublicBaseUrl: "",
      });
      assert.equal(url, "https://rispro.nccb.com.ly/public/appointment?t=abc");
      assert.ok(!url.includes("//public/appointment"));
    }
  );
});

test("production blocks localhost/private hosts for QR URL generation", () => {
  withEnv(
    {
      NODE_ENV: "production",
      PUBLIC_APP_BASE_URL: "http://192.168.1.12:3000",
    },
    () => {
      assert.throws(
        () => buildPublicAppointmentUrlFromSettings("abc", { risproPublicBaseUrl: "" }),
        /cannot use localhost or private IP hosts in production|must use https in production/
      );
    }
  );
});

test("production rejects localhost/private DB setting even when env fallback is valid", () => {
  withEnv(
    {
      NODE_ENV: "production",
      PUBLIC_APP_BASE_URL: "https://rispro.nccb.com.ly",
    },
    () => {
      assert.throws(
        () => buildPublicAppointmentUrlFromSettings("abc", { risproPublicBaseUrl: "https://192.168.1.12" }),
        /cannot use localhost or private IP hosts in production/
      );
    }
  );
});
