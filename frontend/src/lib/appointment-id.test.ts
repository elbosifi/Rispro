import { describe, expect, it } from "vitest";
import { normalizeAppointmentId } from "./appointment-id";

describe("normalizeAppointmentId", () => {
  it.each([
    [9, 9],
    ["9", 9],
    [" 9 ", 9],
  ])("accepts %j as %j", (value, expected) => {
    expect(normalizeAppointmentId(value)).toBe(expected);
  });

  it.each([null, undefined, "", "   ", "V2-000009", 0, -1, 1.5, "1.5", Number.NaN, Number.POSITIVE_INFINITY])(
    "rejects %j",
    (value) => {
      expect(normalizeAppointmentId(value)).toBeNull();
    },
  );
});
