import { describe, expect, it } from "vitest";
import {
  buildStatisticsSearch,
  parseStatisticsNavigation,
  sanitizeStatisticsSearch,
  statisticsRangeIsSafe,
} from "./statistics-navigation";

describe("statistics navigation", () => {
  it("supports direct same-day, range, and modality links", () => {
    expect(parseStatisticsNavigation(new URLSearchParams("date=2026-09-17&modalityId=002"), "2026-09-18"))
      .toEqual({ dateFrom: "2026-09-17", dateTo: "2026-09-17", modalityId: "2" });
    expect(parseStatisticsNavigation(new URLSearchParams("dateFrom=2026-09-10&dateTo=2026-09-20&modalityId=3"), "2026-09-18"))
      .toEqual({ dateFrom: "2026-09-10", dateTo: "2026-09-20", modalityId: "3" });
  });

  it("falls back for invalid dates, rejects invalid modality IDs, and strips unsafe query state", () => {
    expect(parseStatisticsNavigation(new URLSearchParams("dateFrom=bad&dateTo=2026-09-20&modalityId=0"), "2026-09-18"))
      .toEqual({ dateFrom: "2026-09-18", dateTo: "2026-09-18", modalityId: "" });
    expect(sanitizeStatisticsSearch(new URLSearchParams("date=2026-09-18&q=Patient&query=MRN&unknown=x"), "2026-09-18").toString()).toBe("");
    expect(buildStatisticsSearch(new URLSearchParams(), { dateFrom: "2026-09-10", dateTo: "2026-09-20", modalityId: "002" }, "2026-09-18").toString())
      .toBe("dateFrom=2026-09-10&dateTo=2026-09-20&modalityId=2");
  });

  it("detects invalid date order without issuing an API-safe range", () => {
    expect(statisticsRangeIsSafe({ dateFrom: "2026-09-20", dateTo: "2026-09-10", modalityId: "" })).toBe(false);
  });
});
