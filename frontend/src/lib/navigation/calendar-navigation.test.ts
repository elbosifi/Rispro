import { afterEach, describe, expect, it } from "vitest";
import {
  CALENDAR_SEARCH_STORAGE_KEY,
  buildCalendarSearch,
  clearCalendarSearch,
  parseCalendarNavigation,
  readCalendarSearch,
  writeCalendarSearch,
} from "./calendar-navigation";

describe("calendar navigation", () => {
  afterEach(() => {
    window.sessionStorage.clear();
  });

  it("parses valid Calendar navigation state", () => {
    expect(parseCalendarNavigation(new URLSearchParams("month=2026-09&date=2026-09-17&modalityId=2&category=oncology&status=scheduled&patientId=824"))).toEqual({
      month: "2026-09",
      date: "2026-09-17",
      modalityId: "2",
      category: "oncology",
      status: "scheduled",
      patientId: 824,
    });
  });

  it("rejects malformed month, date, filters, and patient identifiers", () => {
    expect(parseCalendarNavigation(new URLSearchParams("month=2026-13&date=2026-02-30&modalityId=0&category=other&status=invalid&patientId=1.5"))).toEqual({
      month: null,
      date: null,
      modalityId: "",
      category: "",
      status: "",
      patientId: null,
    });
  });

  it("uses a valid date as the canonical displayed month", () => {
    expect(parseCalendarNavigation(new URLSearchParams("month=2026-09&date=2026-10-17"))).toMatchObject({
      month: "2026-10",
      date: "2026-10-17",
    });
  });

  it("normalizes Calendar state, omits defaults, and preserves unrelated parameters", () => {
    const search = buildCalendarSearch(
      new URLSearchParams("source=dashboard&q=PRIVATE&month=2026-09&date=2026-10-17&modalityId=2&category=oncology&status=scheduled&patientId=824"),
      { modalityId: "", category: "", status: "", patientId: null },
    );

    expect(search.toString()).toBe("source=dashboard&month=2026-10&date=2026-10-17");
  });

  it("never serializes private Calendar search text", () => {
    const search = buildCalendarSearch(new URLSearchParams("q=Patient%20Name%20MRN-42&month=2026-09"));
    expect(search.toString()).toBe("month=2026-09");
  });

  it("keeps Calendar free-text search private in session storage", () => {
    writeCalendarSearch("Patient Name MRN-42");
    expect(readCalendarSearch()).toBe("Patient Name MRN-42");
    expect(window.sessionStorage.getItem(CALENDAR_SEARCH_STORAGE_KEY)).toBe("Patient Name MRN-42");

    clearCalendarSearch();
    expect(readCalendarSearch()).toBe("");
  });
});
