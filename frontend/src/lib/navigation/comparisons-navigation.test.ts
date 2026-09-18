import { beforeEach, describe, expect, it } from "vitest";
import {
  buildComparisonsSearch,
  COMPARISONS_SEARCH_STORAGE_KEY,
  parseComparisonsNavigation,
  sanitizeComparisonsSearch,
  writeComparisonsSearch,
} from "./comparisons-navigation";

describe("comparisons navigation", () => {
  beforeEach(() => window.sessionStorage.clear());

  it("parses validated kind and domain-specific statuses", () => {
    expect(parseComparisonsNavigation(new URLSearchParams("kind=comparisons&comparisonStatus=assigned"), "pending"))
      .toEqual({ requestKind: "comparisons", comparisonStatus: "assigned", irStatus: "all" });
    expect(parseComparisonsNavigation(new URLSearchParams("kind=ir&irStatus=ready_for_review"), "pending"))
      .toEqual({ requestKind: "ir", comparisonStatus: "pending", irStatus: "ready_for_review" });
  });

  it("preserves role-dependent comparison defaults and strips invalid/private state", () => {
    expect(buildComparisonsSearch(new URLSearchParams(), { requestKind: "comparisons" }, "pending").toString()).toBe("kind=comparisons");
    expect(sanitizeComparisonsSearch(new URLSearchParams("kind=bad&comparisonStatus=bad&irStatus=bad&q=Patient&search=MRN&unknown=x"), "active").toString()).toBe("");
    expect(buildComparisonsSearch(new URLSearchParams(), { requestKind: "ir", irStatus: "needs_information" }).toString())
      .toBe("kind=ir&irStatus=needs_information");
  });

  it("keeps applied free-text search in session storage", () => {
    writeComparisonsSearch("MRN-123");
    expect(window.sessionStorage.getItem(COMPARISONS_SEARCH_STORAGE_KEY)).toBe("MRN-123");
  });
});
