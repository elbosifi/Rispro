import test from "node:test";
import assert from "node:assert/strict";
import { buildPublicAppointmentUrl } from "../../public/utils/public-appointment-url.js";

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

test("buildPublicAppointmentUrl uses canonical domain and /public/appointment?t=", () => {
  withEnv(
    {
      NODE_ENV: "production",
      PUBLIC_APP_BASE_URL: "https://rispro.nccb.com.ly",
    },
    () => {
      const url = buildPublicAppointmentUrl("signed-token");
      assert.equal(url, "https://rispro.nccb.com.ly/public/appointment?t=signed-token");
      assert.ok(url.includes("/public/appointment?t="));
    }
  );
});

test("trailing slash in PUBLIC_APP_BASE_URL is normalized", () => {
  withEnv(
    {
      NODE_ENV: "production",
      PUBLIC_APP_BASE_URL: "https://rispro.nccb.com.ly/",
    },
    () => {
      const url = buildPublicAppointmentUrl("abc");
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
        () => buildPublicAppointmentUrl("abc"),
        /cannot use localhost or private IP hosts in production|must use https in production/
      );
    }
  );
});
