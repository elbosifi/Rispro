import { beforeEach, describe, expect, it } from "vitest";
import {
  buildWorklistMonitorSearch,
  parseWorklistMonitorNavigation,
  sanitizeWorklistMonitorSearch,
} from "./worklist-monitor-navigation";

describe("worklist monitor navigation", () => {
  beforeEach(() => window.sessionStorage.clear());

  it("parses validated tab, date, modality, and status values", () => {
    expect(parseWorklistMonitorNavigation(
      new URLSearchParams("tab=sante&dateFrom=2026-09-18&dateTo=2026-09-25&modalityId=002&status=waiting_for_queue"),
      "2026-09-18",
    )).toEqual({ tab: "sante", dateFrom: "2026-09-18", dateTo: "2026-09-25", modalityId: "2", status: "waiting_for_queue" });
  });

  it("normalizes invalid dates/ranges and omits defaults", () => {
    expect(parseWorklistMonitorNavigation(
      new URLSearchParams("tab=unsafe&dateFrom=2026-02-30&dateTo=2026-09-01&modalityId=0&status=unsafe"),
      "2026-09-18",
    )).toEqual({ tab: "orthanc", dateFrom: "2026-09-18", dateTo: "2026-09-18", modalityId: "", status: "all" });
    expect(buildWorklistMonitorSearch(new URLSearchParams(), {}, "2026-09-18").toString()).toBe("");
    expect(buildWorklistMonitorSearch(new URLSearchParams(), { dateFrom: "2026-09-19", dateTo: "2026-09-17" }, "2026-09-18").toString())
      .toBe("dateFrom=2026-09-19&dateTo=2026-09-19");
  });

  it("strips private and unknown query parameters", () => {
    expect(sanitizeWorklistMonitorSearch(new URLSearchParams("tab=sante&q=Patient%20Name&search=MRN&dateFrom=2026-09-18&status=failed&unknown=x"), "2026-09-18").toString())
      .toBe("tab=sante&status=failed");
  });
});
