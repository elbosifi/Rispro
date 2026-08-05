import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { parseNaps2WebscanAllowedOrigins } from "./env.js";

describe("NAPS2 WebScan allowed origins", () => {
  it("canonicalizes and deduplicates exact HTTP and HTTPS origins", () => {
    assert.deepEqual(
      parseNaps2WebscanAllowedOrigins(" http://scanner:9801/,https://scanner.example.test:443, http://scanner:9801 "),
      ["http://scanner:9801", "https://scanner.example.test"]
    );
  });

  it("ignores invalid entries without admitting broader sources", () => {
    assert.deepEqual(
      parseNaps2WebscanAllowedOrigins("ftp://scanner,http://user:pass@scanner,http://scanner/eSCL,http://scanner/?x=1,http://scanner/#x,http://*.example.test,not-a-url"),
      []
    );
  });
});
