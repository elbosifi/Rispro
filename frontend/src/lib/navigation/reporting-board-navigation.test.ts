import { describe, expect, it } from "vitest";
import {
  buildReportingBoardSearch,
  parseReportingBoardNavigation,
  sanitizeReportingBoardSearch,
} from "./reporting-board-navigation";
import type { ReportingBoardFilters } from "@/types/api";

const defaults: ReportingBoardFilters = {
  dateFrom: "2026-09-01",
  dateTo: null,
  cutoffDate: "2026-09-01",
  assignmentStatus: "all",
  reportStatus: "required_not_final",
  caseSource: "all",
  sortBy: "priority_study_date",
  sortDirection: "asc",
  pinUrgentToTop: true,
  limit: 100,
  offset: 0,
};

const context = { defaultFilters: defaults };

describe("Reporting Board navigation", () => {
  it("parses a valid normal-board filter URL", () => {
    expect(parseReportingBoardNavigation(
      new URLSearchParams("dateFrom=2026-09-02&dateTo=2026-09-05&modalityId=2&assignedDoctorId=7&finalizedByDoctorId=8&assignmentStatus=assigned&assignmentMatch=mismatch&reportStatus=draft&caseSource=appointments&category=oncology&priorityCode=stat&sortBy=study_date&sortDirection=desc&pinUrgentToTop=false&limit=300"),
      context,
    ).filters).toMatchObject({
      dateFrom: "2026-09-02",
      dateTo: "2026-09-05",
      modalityId: 2,
      modalityCode: null,
      assignedDoctorId: 7,
      finalizedByDoctorId: 8,
      assignmentStatus: "assigned",
      assignmentMatch: "mismatch",
      reportStatus: "draft",
      caseSource: "appointments",
      caseCategory: "oncology",
      priorityCode: "stat",
      sortBy: "study_date",
      sortDirection: "desc",
      pinUrgentToTop: false,
      limit: 300,
      offset: 0,
    });
  });

  it("accepts strict dates, rejects impossible dates, and normalizes an inverted range", () => {
    expect(parseReportingBoardNavigation(new URLSearchParams("dateFrom=2026-02-30"), context).filters.dateFrom).toBe(defaults.dateFrom);
    expect(parseReportingBoardNavigation(new URLSearchParams("dateFrom=2026-09-10&dateTo=2026-09-02"), context).filters).toMatchObject({
      dateFrom: "2026-09-10",
      dateTo: "2026-09-10",
    });
  });

  it("validates IDs, modality codes, and keeps modality filters mutually exclusive", () => {
    expect(parseReportingBoardNavigation(new URLSearchParams("modalityId=4"), context).filters.modalityId).toBe(4);
    expect(parseReportingBoardNavigation(new URLSearchParams("modalityId=-5"), context).filters.modalityId).toBeNull();
    expect(parseReportingBoardNavigation(new URLSearchParams("modalityCode=ct"), context).filters.modalityCode).toBe("CT");
    expect(parseReportingBoardNavigation(new URLSearchParams("modalityId=4&modalityCode=CT"), context).filters).toMatchObject({ modalityId: 4, modalityCode: null });
  });

  it("validates doctors, assignment/report/case enums, category mapping, sort, direction, pinning, and limits", () => {
    const parsed = parseReportingBoardNavigation(new URLSearchParams("assignedDoctorId=9&finalizedByDoctorId=10&assignmentStatus=assigned&assignmentMatch=matched&reportStatus=final&caseSource=comparisons&category=non_oncology&priorityCode=urgent&sortBy=mrn&sortDirection=desc&pinUrgentToTop=true&limit=1"), context).filters;
    expect(parsed).toMatchObject({ assignedDoctorId: 9, finalizedByDoctorId: 10, assignmentStatus: "assigned", assignmentMatch: "matched", reportStatus: "final", caseSource: "comparisons", caseCategory: "non_oncology", priorityCode: "urgent", sortBy: "mrn", sortDirection: "desc", pinUrgentToTop: true, limit: 1 });
    expect(parseReportingBoardNavigation(new URLSearchParams("assignmentMatch=unknown&reportStatus=banana&caseSource=unknown&category=other&sortBy=random&sortDirection=sideways&pinUrgentToTop=maybe"), context).filters).toMatchObject(defaults);
    expect(parseReportingBoardNavigation(new URLSearchParams("limit=300"), context).filters.limit).toBe(300);
    expect(parseReportingBoardNavigation(new URLSearchParams("limit=0"), context).filters.limit).toBe(100);
    expect(parseReportingBoardNavigation(new URLSearchParams("limit=9999"), context).filters.limit).toBe(100);
  });

  it("builds only canonical safe overrides and removes PHI/private, derived, unknown, and legacy keys", () => {
    const search = buildReportingBoardSearch(
      new URLSearchParams("q=PRIVATE-PATIENT&query=secret&search=mrn&cutoffDate=2026-01-01&offset=42&unknown=x&caseCategory=oncology&savedViewToken=old"),
      {
        dateFrom: "2026-09-02",
        modalityId: 4,
        modalityCode: null,
        assignmentStatus: "unassigned",
        caseCategory: "oncology",
        limit: 300,
        offset: 0,
      },
      context,
    );

    expect(search.toString()).toBe("dateFrom=2026-09-02&modalityId=4&assignmentStatus=unassigned&category=oncology&limit=300");
    expect(search.has("q")).toBe(false);
    expect(search.has("query")).toBe(false);
    expect(search.has("search")).toBe(false);
    expect(search.has("cutoffDate")).toBe(false);
    expect(search.has("offset")).toBe(false);
    expect(search.has("savedViewToken")).toBe(false);
  });

  it("omits values equal to normal defaults and keeps strict boolean representation", () => {
    const search = buildReportingBoardSearch(
      new URLSearchParams("dateFrom=2026-09-01&assignmentStatus=all&sortDirection=asc&pinUrgentToTop=true&limit=100"),
      {},
      context,
    );
    expect(search.toString()).toBe("");
  });

  it("merges saved-view filters before URL overrides and preserves a saved private q without serializing it", () => {
    const savedContext = {
      defaultFilters: defaults,
      savedViewFilters: { modalityCode: "CT", caseCategory: "oncology", reportStatus: "draft", q: "PRIVATE-SAVED", offset: 30 } as ReportingBoardFilters,
    };
    const parsed = parseReportingBoardNavigation(new URLSearchParams("category=non_oncology&modalityId=2"), savedContext);
    expect(parsed.filters).toMatchObject({ modalityCode: null, modalityId: 2, caseCategory: "non_oncology", reportStatus: "draft", q: "PRIVATE-SAVED", offset: 0 });

    expect(buildReportingBoardSearch(new URLSearchParams("category=oncology"), {}, savedContext).toString()).toBe("");
    expect(buildReportingBoardSearch(new URLSearchParams("category=non_oncology"), {}, savedContext).toString()).toBe("category=non_oncology");
    expect(sanitizeReportingBoardSearch(new URLSearchParams("category=non_oncology&q=PRIVATE&query=PRIVATE&search=PRIVATE"), savedContext).toString()).toBe("category=non_oncology");
  });
});
