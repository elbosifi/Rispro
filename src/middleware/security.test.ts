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

  it("allows local scanner bridge and diagnostic NAPS2 endpoints in connect-src without env config", () => {
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

      const csp = headers["Content-Security-Policy"];
      assert.equal(csp.includes("connect-src 'self'"), true);
      assert.equal(csp.includes("http://127.0.0.1:9810"), true);
      assert.equal(csp.includes("http://localhost:9810"), true);
      assert.equal(csp.includes("http://127.0.0.1:9801"), true);
      assert.equal(csp.includes("http://localhost:9801"), true);
    } finally {
      env.naps2WebscanEnabled = previousEnabled;
      env.naps2WebscanEndpoint = previousEndpoint;
    }
  });

  it("allows every secure QZ localhost endpoint and excludes insecure WebSockets by default", () => {
    const previous = env.qzAllowInsecureWebsocket;
    env.qzAllowInsecureWebsocket = false;
    try {
      const headers: Record<string, string> = {};
      securityHeaders({} as any, { setHeader(name: string, value: string) { headers[name] = value; } } as any, () => {});
      for (const host of ["localhost", "localhost.qz.io", "127.0.0.1"]) for (const port of [8181, 8282, 8383, 8484]) assert.match(headers["Content-Security-Policy"], new RegExp(`wss://${host.replaceAll(".", "\\.")}:${port}`));
      assert.equal(headers["Content-Security-Policy"].includes(" ws://"), false);
    } finally { env.qzAllowInsecureWebsocket = previous; }
  });

  it("adds QZ insecure development endpoints only when explicitly enabled", () => {
    const previous = env.qzAllowInsecureWebsocket;
    env.qzAllowInsecureWebsocket = true;
    try {
      const headers: Record<string, string> = {};
      securityHeaders({} as any, { setHeader(name: string, value: string) { headers[name] = value; } } as any, () => {});
      assert.equal(headers["Content-Security-Policy"].includes("ws://localhost:8182"), true);
      assert.equal(headers["Content-Security-Policy"].includes("ws://localhost.qz.io:8283"), true);
      assert.equal(headers["Content-Security-Policy"].includes("ws://127.0.0.1:8485"), true);
    } finally { env.qzAllowInsecureWebsocket = previous; }
  });

  it("allows local scanner bridge endpoints in connect-src when configured", () => {
    const previousEnabled = env.naps2WebscanEnabled;
    const previousEndpoint = env.naps2WebscanEndpoint;
    env.naps2WebscanEnabled = true;
    env.naps2WebscanEndpoint = "http://naps2.example.test:9803/eSCL/ScannerCapabilities";
    try {
      const headers: Record<string, string> = {};
      securityHeaders({} as any, {
        setHeader(name: string, value: string) {
          headers[name] = value;
        },
      } as any, () => {});

      const csp = headers["Content-Security-Policy"];
      assert.equal(
        csp.includes(
          "connect-src 'self' http://127.0.0.1:9810 http://localhost:9810 http://127.0.0.1:9801 http://localhost:9801"
        ),
        true
      );
      assert.equal(csp.includes("http://naps2.example.test:9803"), true);
      assert.equal(csp.includes("script-src 'self'"), true);
      assert.equal(csp.includes("object-src 'none'"), true);
      assert.equal(csp.includes("frame-ancestors 'none'"), true);
    } finally {
      env.naps2WebscanEnabled = previousEnabled;
      env.naps2WebscanEndpoint = previousEndpoint;
    }
  });
});
