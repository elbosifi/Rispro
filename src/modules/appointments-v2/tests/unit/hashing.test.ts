/**
 * Appointments V2 — Hashing utilities unit tests.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { sha256Hex, hashConfigSnapshot } from "../../shared/utils/hashing.js";

describe("V2 hashing utilities", () => {
  it("sha256Hex should produce consistent 64-char hex output", () => {
    const hash = sha256Hex("hello");
    assert.equal(hash.length, 64);
    assert.match(hash, /^[0-9a-f]{64}$/);
  });

  it("sha256Hex should be deterministic", () => {
    const a = sha256Hex("test");
    const b = sha256Hex("test");
    assert.equal(a, b);
  });

  it("hashConfigSnapshot should hash JSON consistently", () => {
    const obj = { key: "value", count: 42 };
    const a = hashConfigSnapshot(obj);
    const b = hashConfigSnapshot(obj);
    assert.equal(a, b);
    assert.equal(a.length, 64);
  });
});
