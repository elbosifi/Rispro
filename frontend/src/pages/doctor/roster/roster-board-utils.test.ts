import { describe, expect, it } from "vitest";
import {
  nextRosterRange,
  previewRosterDate,
  rosterDays,
} from "./roster-board-utils";

describe("roster calendar", () => {
  it.each([
    ["2026-10-24T12:00:00Z", "2026-10-25", "2026-10-29"],
    ["2026-10-25T12:00:00Z", "2026-11-01", "2026-11-05"],
    ["2026-12-31T23:30:00Z", "2027-01-03", "2027-01-07"],
    ["2026-01-31T23:30:00Z", "2026-02-08", "2026-02-12"],
    ["2028-02-26T12:00:00Z", "2028-02-27", "2028-03-02"],
  ])("defaults from Tripoli local date %s", (now, start, end) => {
    expect(nextRosterRange(new Date(now))).toEqual({ start, end });
    expect(rosterDays(start, end)).toHaveLength(5);
  });
  it("handles custom ranges including repeated weekdays without copying excluded days", () => {
    expect(
      previewRosterDate("2026-10-19", "2026-10-19", "2026-10-25", "2026-10-29"),
    ).toBe("2026-10-26");
    expect(
      previewRosterDate("2026-10-23", "2026-10-19", "2026-10-25", "2026-10-29"),
    ).toBeNull();
    expect(
      previewRosterDate("2026-10-26", "2026-10-19", "2026-11-01", "2026-11-12"),
    ).toBe("2026-11-09");
    expect(rosterDays("2026-10-31", "2026-11-02")).toEqual([
      "2026-10-31",
      "2026-11-01",
      "2026-11-02",
    ]);
  });
});
