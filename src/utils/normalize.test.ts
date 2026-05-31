import test from "node:test";
import assert from "node:assert/strict";
import { normalizeArabicNameCompact } from "./normalize.js";

test("normalizeArabicNameCompact matches spaced and unspaced Arabic compounds", () => {
  assert.equal(normalizeArabicNameCompact("عبد الله"), normalizeArabicNameCompact("عبدالله"));
  assert.equal(normalizeArabicNameCompact("عبد الرحمن"), normalizeArabicNameCompact("عبدالرحمن"));
  assert.equal(normalizeArabicNameCompact("نور الدين"), normalizeArabicNameCompact("نورالدين"));
});

test("normalizeArabicNameCompact removes tatweel, diacritics, and whitespace", () => {
  assert.equal(normalizeArabicNameCompact("عَبْـدُ اللّٰه"), normalizeArabicNameCompact("عبدالله"));
});

test("normalizeArabicNameCompact returns empty string for empty compact names", () => {
  assert.equal(normalizeArabicNameCompact(""), "");
  assert.equal(normalizeArabicNameCompact("   "), "");
  assert.equal(normalizeArabicNameCompact("ـًٌٍَُِّْٰ"), "");
});
