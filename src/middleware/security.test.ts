import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { env } from "../config/env.js";
import { securityHeaders } from "./security.js";

describe("securityHeaders", () => {
  it("allows blob PDF previews in same-page frames", () => {
    const headers: Record<string, string> = {};
    securityHeaders({} as any, {
      setHeader(name: string, value: string) {
        headers[name] = value;
      },
    } as any, () => {});

    assert.equal(headers["Content-Security-Policy"].includes("frame-src 'self' blob:"), true);
    assert.equal(headers["Content-Security-Policy"].includes("object-src 'none'"), true);
  });

  it("keeps connect-src self-only when NAPS2 web scan is not configured", () => {
    const previousEnabled = env.naps2WebscanEnabled;
    const previousEndpoint = env.naps2WebscanEndpoint;
    env.naps2WebscanEnabled = false;
    env.naps2WebscanEndpoint = "";
    try {
      const headers: Record<string, string> = {};
      securityHeaders({} as any, {
        setHeader(name: string, value: string) {
          headers[name] = value;
        },
      } as any, () => {});

      assert.equal(headers["Content-Security-Policy"].includes("connect-src 'self';"), true);
      assert.equal(headers["Content-Security-Policy"].includes("http://localhost:9801"), false);
    } finally {
      env.naps2WebscanEnabled = previousEnabled;
      env.naps2WebscanEndpoint = previousEndpoint;
    }
  });

  it("allows local NAPS2 scanner-sharing endpoints in connect-src when configured", () => {
    const previousEnabled = env.naps2WebscanEnabled;
    const previousEndpoint = env.naps2WebscanEndpoint;
    env.naps2WebscanEnabled = true;
    env.naps2WebscanEndpoint = "http://127.0.0.1:9801/eSCL/ScannerCapabilities";
    try {
      const headers: Record<string, string> = {};
      securityHeaders({} as any, {
        setHeader(name: string, value: string) {
          headers[name] = value;
        },
      } as any, () => {});

      const csp = headers["Content-Security-Policy"];
      assert.equal(csp.includes("connect-src 'self' http://127.0.0.1:9801 http://localhost:9801"), true);
      assert.equal(csp.includes("script-src 'self'"), true);
      assert.equal(csp.includes("object-src 'none'"), true);
      assert.equal(csp.includes("frame-ancestors 'none'"), true);
    } finally {
      env.naps2WebscanEnabled = previousEnabled;
      env.naps2WebscanEndpoint = previousEndpoint;
    }
  });
});
