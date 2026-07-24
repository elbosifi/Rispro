import assert from "node:assert/strict";
import test from "node:test";
import { readRequestScanMaxConcurrency } from "./request-scan-concurrency.js";

test("Request Scan concurrency accepts bounded values and preserves the sequential default", () => {
  assert.equal(readRequestScanMaxConcurrency(undefined), 1);
  assert.equal(readRequestScanMaxConcurrency(""), 1);
  assert.equal(readRequestScanMaxConcurrency("1"), 1);
  assert.equal(readRequestScanMaxConcurrency("2"), 2);
});

for (const value of ["0", "-1", "1.5", "3", "two", " 2"]) {
  test(`Request Scan concurrency rejects ${JSON.stringify(value)}`, () => {
    assert.throws(() => readRequestScanMaxConcurrency(value), /must be either 1 or 2/);
  });
}
