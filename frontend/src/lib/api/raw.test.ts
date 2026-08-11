import { describe, expect, it } from "vitest";
import { rawArray, rawBool, rawNumber, rawString } from "./raw";

describe("raw API response helpers", () => {
  it.each([
    [null, null],
    [undefined, null],
    [0, "0"],
    [false, "false"],
  ])("preserves rawString fallback semantics for %j", (value, expected) => {
    expect(rawString(value)).toBe(expected);
  });

  it("preserves numeric and boolean coercion", () => {
    expect(rawNumber(null)).toBeNull();
    expect(rawNumber("12")).toBe(12);
    expect(rawBool(0)).toBe(false);
    expect(rawBool("false")).toBe(true);
  });

  it("keeps only non-array object rows", () => {
    expect(rawArray([{ id: 1 }, null, [], "row", { id: 2 }])).toEqual([{ id: 1 }, { id: 2 }]);
    expect(rawArray({ id: 1 })).toEqual([]);
  });
});
