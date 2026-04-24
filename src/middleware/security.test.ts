import { describe, it } from "node:test";
import assert from "node:assert/strict";
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
});
