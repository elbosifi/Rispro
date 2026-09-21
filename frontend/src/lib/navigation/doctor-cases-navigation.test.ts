import { describe, expect, it } from "vitest";
import {
  buildDoctorCasesSearch,
  parseDoctorCasesNavigation,
  sanitizeDoctorCasesSearch,
} from "./doctor-cases-navigation";

const manager = { canManage: true, today: "2026-09-18" };
const doctor = { canManage: false, today: "2026-09-18" };

describe("Doctor Cases navigation", () => {
  it("parses a complete valid URL", () => {
    expect(parseDoctorCasesNavigation(new URLSearchParams("dateFrom=2026-09-18&dateTo=2026-09-25&modalityId=2&status=active&requiresReport=true&category=oncology&view=team"), manager)).toEqual({
      dateFrom: "2026-09-18",
      dateTo: "2026-09-25",
      modalityId: "2",
      status: "active",
      requiresReport: "true",
      category: "oncology",
      view: "team",
    });
  });

  it("validates the date range and normalizes dateTo before dateFrom", () => {
    expect(parseDoctorCasesNavigation(new URLSearchParams("dateFrom=2026-09-20&dateTo=2026-09-18"), manager)).toMatchObject({
      dateFrom: "2026-09-20",
      dateTo: "2026-09-20",
    });
  });

  it("rejects invalid dates and uses the deterministic default range", () => {
    expect(parseDoctorCasesNavigation(new URLSearchParams("dateFrom=2026-13-01&dateTo=2026-02-31"), manager)).toMatchObject({
      dateFrom: "2026-09-18",
      dateTo: "2026-09-25",
    });
  });

  it("accepts a positive modalityId and rejects invalid modality IDs", () => {
    expect(parseDoctorCasesNavigation(new URLSearchParams("modalityId=12"), manager).modalityId).toBe("12");
    expect(parseDoctorCasesNavigation(new URLSearchParams("modalityId=-4"), manager).modalityId).toBe("");
  });

  it("accepts only the supported category values", () => {
    expect(parseDoctorCasesNavigation(new URLSearchParams("category=oncology"), manager).category).toBe("oncology");
    expect(parseDoctorCasesNavigation(new URLSearchParams("category=unknown"), manager).category).toBe("");
  });

  it("accepts only the supported status values", () => {
    expect(parseDoctorCasesNavigation(new URLSearchParams("status=active"), manager).status).toBe("active");
    expect(parseDoctorCasesNavigation(new URLSearchParams("status=unassigned"), manager).status).toBe("unassigned");
    expect(parseDoctorCasesNavigation(new URLSearchParams("status=random"), manager).status).toBe("");
  });

  it("supports requiresReport true and false while falling back safely for invalid values", () => {
    expect(parseDoctorCasesNavigation(new URLSearchParams("requiresReport=true"), manager).requiresReport).toBe("true");
    expect(parseDoctorCasesNavigation(new URLSearchParams("requiresReport=false"), manager).requiresReport).toBe("false");
    expect(parseDoctorCasesNavigation(new URLSearchParams("requiresReport=wat"), manager).requiresReport).toBe("true");
  });

  it("preserves manager views and defaults a bare manager URL to unassigned", () => {
    expect(parseDoctorCasesNavigation(new URLSearchParams("view=my"), manager).view).toBe("my");
    expect(parseDoctorCasesNavigation(new URLSearchParams("view=team"), manager).view).toBe("team");
    expect(parseDoctorCasesNavigation(new URLSearchParams("view=unassigned"), manager).view).toBe("unassigned");
    expect(parseDoctorCasesNavigation(new URLSearchParams(), manager).view).toBe("unassigned");
  });

  it("forces every unauthorized view to My Cases", () => {
    expect(parseDoctorCasesNavigation(new URLSearchParams("view=team"), doctor).view).toBe("my");
    expect(parseDoctorCasesNavigation(new URLSearchParams("view=unassigned"), doctor).view).toBe("my");
    expect(parseDoctorCasesNavigation(new URLSearchParams(), doctor).view).toBe("my");
  });

  it("builds a canonical query and removes invalid or private values", () => {
    const search = buildDoctorCasesSearch(
      new URLSearchParams("q=patient-name&query=mrn&search=secret"),
      {
        dateFrom: "2026-09-19",
        dateTo: "2026-09-27",
        modalityId: "2",
        status: "active",
        requiresReport: "true",
        category: "oncology",
        view: "team",
      },
      manager,
    );

    expect(search.toString()).toBe("dateFrom=2026-09-19&dateTo=2026-09-27&modalityId=2&status=active&requiresReport=true&category=oncology&view=team");
    expect(search.toString()).not.toMatch(/(?:^|&)(?:q|query|search)=|patient-name|mrn|secret/);
  });

  it("preserves earlier filters across successive navigation patches", () => {
    let search = new URLSearchParams();
    search = buildDoctorCasesSearch(search, { dateFrom: "2026-09-22" }, manager);
    search = buildDoctorCasesSearch(search, { dateTo: "2026-09-30" }, manager);
    search = buildDoctorCasesSearch(search, { modalityId: "2" }, manager);
    search = buildDoctorCasesSearch(search, { category: "non_oncology" }, manager);
    search = buildDoctorCasesSearch(search, { view: "team" }, manager);

    expect(search.toString()).toBe("dateFrom=2026-09-22&dateTo=2026-09-30&modalityId=2&requiresReport=true&category=non_oncology&view=team");
  });

  it("sanitizes malformed state to the manager defaults", () => {
    const search = sanitizeDoctorCasesSearch(
      new URLSearchParams("dateFrom=bad&dateTo=2026-02-31&modalityId=-4&status=random&category=unknown&view=banana&q=private"),
      manager,
    );
    expect(search.toString()).toBe("requiresReport=true");
  });

  it("builds a normal doctor's explicit view without allowing a manager-only view", () => {
    const search = buildDoctorCasesSearch(new URLSearchParams(), { view: "team" }, doctor);
    expect(search.toString()).toBe("requiresReport=true");
    expect(parseDoctorCasesNavigation(search, doctor).view).toBe("my");
  });
});
