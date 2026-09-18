import { describe, expect, it } from "vitest";
import {
  buildDoctorTeamWorkloadSearch,
  parseDoctorTeamWorkloadNavigation,
  sanitizeDoctorTeamWorkloadSearch,
} from "./doctor-team-workload-navigation";

const context = { today: "2026-09-18" };

describe("Doctor Team Workload navigation", () => {
  it("parses the complete safe URL contract", () => {
    expect(parseDoctorTeamWorkloadNavigation(
      new URLSearchParams("startDate=2026-09-20&endDate=2026-09-27&modalityId=2&requiresReport=true&category=oncology"),
      context,
    )).toEqual({
      startDate: "2026-09-20",
      endDate: "2026-09-27",
      modalityId: "2",
      requiresReport: "true",
      category: "oncology",
    });
  });

  it("uses deterministic defaults and strictly validates the date range", () => {
    expect(parseDoctorTeamWorkloadNavigation(new URLSearchParams(), context)).toEqual({
      startDate: "2026-09-18",
      endDate: "2026-09-25",
      modalityId: "",
      requiresReport: "",
      category: "",
    });
    expect(parseDoctorTeamWorkloadNavigation(new URLSearchParams("startDate=2026-09-20&endDate=2026-09-18"), context)).toMatchObject({
      startDate: "2026-09-20",
      endDate: "2026-09-20",
    });
    expect(parseDoctorTeamWorkloadNavigation(new URLSearchParams("startDate=2026-02-31&endDate=bad"), context)).toMatchObject({
      startDate: "2026-09-18",
      endDate: "2026-09-25",
    });
  });

  it("accepts only positive modality IDs and known filter enums", () => {
    expect(parseDoctorTeamWorkloadNavigation(new URLSearchParams("modalityId=12&requiresReport=false&category=non_oncology"), context)).toMatchObject({
      modalityId: "12",
      requiresReport: "false",
      category: "non_oncology",
    });
    expect(parseDoctorTeamWorkloadNavigation(new URLSearchParams("modalityId=-4&requiresReport=wat&category=unknown"), context)).toMatchObject({
      modalityId: "",
      requiresReport: "",
      category: "",
    });
  });

  it("omits defaults and drops private, unknown, and legacy values", () => {
    expect(buildDoctorTeamWorkloadSearch(
      new URLSearchParams("q=patient&query=mrn&search=secret&unknown=x"),
      { startDate: "2026-09-19", endDate: "2026-09-26", modalityId: "2", requiresReport: "true", category: "oncology" },
      context,
    ).toString()).toBe("startDate=2026-09-19&modalityId=2&requiresReport=true&category=oncology");

    expect(sanitizeDoctorTeamWorkloadSearch(
      new URLSearchParams("startDate=bad&endDate=2026-02-31&modalityId=-1&requiresReport=wat&category=unknown&q=private"),
      context,
    ).toString()).toBe("");
  });
});
