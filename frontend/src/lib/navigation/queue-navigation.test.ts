import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  buildQueueSearch,
  clearQueueSearch,
  parseQueueNavigation,
  QUEUE_SEARCH_STORAGE_KEY,
  readQueueSearch,
  sanitizeQueueSearch,
  writeQueueSearch,
} from "./queue-navigation";

describe("queue navigation", () => {
  beforeEach(() => window.sessionStorage.clear());
  afterEach(() => window.sessionStorage.clear());

  it("parses every supported view and validates numeric IDs", () => {
    for (const view of ["all", "entered", "not_entered", "walk_in"] as const) {
      expect(parseQueueNavigation(new URLSearchParams(`view=${view}&modalityId=002&patientId=7`))).toEqual({
        view,
        modalityId: "2",
        patientId: 7,
      });
    }

    expect(parseQueueNavigation(new URLSearchParams("view=unsafe&modalityId=0&patientId=-2"))).toEqual({
      view: "all",
      modalityId: "",
      patientId: null,
    });
  });

  it("omits defaults and never serializes search or PHI-like query keys", () => {
    expect(buildQueueSearch(new URLSearchParams("view=all&q=Patient%20Name&query=MRN&search=ACC&unknown=x")).toString()).toBe("");
    expect(buildQueueSearch(new URLSearchParams(), { view: "entered", modalityId: "002", patientId: 22 }).toString())
      .toBe("view=entered&modalityId=2&patientId=22");
    expect(sanitizeQueueSearch(new URLSearchParams("q=private&patientId=22&modalityId=2")).toString())
      .toBe("modalityId=2&patientId=22");
  });

  it("persists private search only in session storage and clears it", () => {
    writeQueueSearch("Patient Name MRN-22");
    expect(readQueueSearch()).toBe("Patient Name MRN-22");
    expect(window.sessionStorage.getItem(QUEUE_SEARCH_STORAGE_KEY)).toBe("Patient Name MRN-22");
    clearQueueSearch();
    expect(readQueueSearch()).toBe("");
    expect(window.sessionStorage.getItem(QUEUE_SEARCH_STORAGE_KEY)).toBeNull();
  });
});
