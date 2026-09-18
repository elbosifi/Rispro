import { describe, expect, it } from "vitest";
import {
  buildModalitySearch,
  parseModalityNavigation,
  sanitizeModalitySearch,
} from "./modality-navigation";

describe("modality navigation", () => {
  it("parses valid modality, date, view, scope, and appointment state", () => {
    expect(parseModalityNavigation(new URLSearchParams("modalityId=2&date=2026-09-18&scope=all&view=in-progress&appointmentId=5513"))).toEqual({
      modalityId: "2",
      date: "2026-09-18",
      scope: "all",
      view: "in-progress",
      appointmentId: 5513,
    });
  });

  it("rejects invalid identifiers, dates, scope, and views safely", () => {
    expect(parseModalityNavigation(new URLSearchParams("modalityId=0&date=2026-02-30&scope=unknown&view=unknown&appointmentId=1.5"))).toEqual({
      modalityId: "",
      date: null,
      scope: "day",
      view: "operational",
      appointmentId: null,
    });
  });

  it("normalizes navigation state, omits defaults, and preserves unrelated safe parameters", () => {
    const search = buildModalitySearch(
      new URLSearchParams("source=dashboard&modalityId=002&date=2026-09-18&scope=all&view=in-progress&appointmentId=5513"),
      { scope: "day", view: "operational", appointmentId: null, date: "2026-09-18" },
      "2026-09-18",
    );

    expect(search.toString()).toBe("source=dashboard&modalityId=2");
  });

  it("removes invalid recognized parameters while retaining existing valid deep links", () => {
    const search = buildModalitySearch(new URLSearchParams("source=dashboard&modalityId=nope&date=bad&view=missing&appointmentId=0"));
    expect(search.toString()).toBe("source=dashboard");
  });

  it("does not serialize private search text or legacy PHI-bearing query keys", () => {
    const search = sanitizeModalitySearch(new URLSearchParams("source=dashboard&q=Patient%20Name&query=MRN-42&search=ACC-1"));
    expect(search.toString()).toBe("source=dashboard");
  });

  it("keeps an explicitly supplied non-default date and removes a selected default date", () => {
    expect(buildModalitySearch(new URLSearchParams("date=2026-09-18"), {}, "2026-09-19").get("date")).toBe("2026-09-18");
    expect(buildModalitySearch(new URLSearchParams(), { date: "2026-09-19" }, "2026-09-19").has("date")).toBe(false);
  });
});
