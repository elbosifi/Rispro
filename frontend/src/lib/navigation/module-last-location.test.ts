import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  MODULE_LAST_LOCATIONS_STORAGE_KEY,
  canonicalizeModuleLocation,
  clearModuleLastLocations,
  readModuleLastLocation,
  restorableModuleForPath,
  resolveModuleNavigationTarget,
  saveModuleLastLocation,
} from "./module-last-location";

describe("module last-location navigation", () => {
  beforeEach(() => {
    window.sessionStorage.clear();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    window.sessionStorage.clear();
  });

  it("identifies supported core and Doctor base paths", () => {
    expect(restorableModuleForPath("/patients")).toBe("patients");
    expect(restorableModuleForPath("/registrations")).toBe("registrations");
    expect(restorableModuleForPath("/calendar")).toBe("calendar");
    expect(restorableModuleForPath("/settings")).toBe("settings");
    expect(restorableModuleForPath("/modality")).toBe("modality");
    expect(restorableModuleForPath("/doctor/today-cases")).toBe("doctorTodayCases");
    expect(restorableModuleForPath("/doctor/reporting-board")).toBe("doctorReportingBoard");
    expect(restorableModuleForPath("/doctor/reporting-board/saved/token_123")).toBe("doctorReportingBoard");
    expect(restorableModuleForPath("/doctor/team-workload")).toBe("doctorTeamWorkload");
    expect(restorableModuleForPath("/queue")).toBe("queue");
    expect(restorableModuleForPath("/worklist-monitor")).toBe("worklistMonitor");
    expect(restorableModuleForPath("/statistics")).toBe("statistics");
    expect(restorableModuleForPath("/comparisons")).toBe("comparisons");
    expect(restorableModuleForPath("/doctor/protocols")).toBe("doctorProtocols");
    expect(restorableModuleForPath("/doctor/advanced-setup")).toBe("doctorAdvancedSetup");
    expect(restorableModuleForPath("/patients/")).toBeNull();
    expect(restorableModuleForPath("/doctor/reporting-board/saved/not-safe/token")).toBeNull();
  });

  it("does not treat Patients create/edit or Modality ingestion routes as base pages", () => {
    expect(restorableModuleForPath("/patients/new")).toBeNull();
    expect(restorableModuleForPath("/patients/55/edit")).toBeNull();
    expect(restorableModuleForPath("/patients/merge")).toBeNull();
    expect(restorableModuleForPath("/modality/document-ingestion")).toBeNull();
  });

  it("serializes only the validated Patients location", () => {
    expect(canonicalizeModuleLocation(
      "/patients",
      "?q=Patient%20Name&category=oncology&page=3&patientId=55&query=MRN-55&unexpected=x",
    )).toBe("/patients?category=oncology&page=3&patientId=55");
  });

  it("serializes only the validated Registrations location", () => {
    expect(canonicalizeModuleLocation(
      "/registrations",
      "?q=Patient%20Name&query=MRN-55&search=ACC-55&dateMode=single&date=2025-01-02&modalityId=2&status=completed&appointmentId=123&patientId=55&patientDrawerId=55&tab=details&source=statistics&unexpected=x",
    )).toBe("/registrations?date=2025-01-02&modalityId=2&status=completed&appointmentId=123&patientId=55&patientDrawerId=55&tab=details&source=statistics");
  });

  it("serializes only the validated Calendar location", () => {
    expect(canonicalizeModuleLocation(
      "/calendar",
      "?q=Patient%20Name&month=2026-09&date=2026-09-18&modalityId=2&category=oncology&status=scheduled&patientId=55&unexpected=x",
    )).toBe("/calendar?month=2026-09&date=2026-09-18&modalityId=2&category=oncology&status=scheduled&patientId=55");
  });

  it("serializes only the validated Settings location", () => {
    expect(canonicalizeModuleLocation(
      "/settings",
      "?section=equipment&q=Patient%20Name&query=MRN-55&search=ACC-55&unexpected=x",
      "super_admin",
    )).toBe("/settings?section=equipment");
  });

  it("serializes only the validated Modality location", () => {
    expect(canonicalizeModuleLocation(
      "/modality",
      "?modalityId=002&date=2026-09-18&view=in-progress&appointmentId=123&q=Patient%20Name&query=MRN-55&search=ACC-55&unexpected=x",
    )).toBe("/modality?modalityId=2&date=2026-09-18&view=in-progress&appointmentId=123");
  });

  it("serializes only validated Doctor locations and strips private values", () => {
    expect(canonicalizeModuleLocation(
      "/doctor/today-cases",
      "?dateFrom=2026-09-18&dateTo=2026-09-25&requiresReport=true&view=team&q=private&unknown=x",
    )).toBe("/doctor/today-cases?requiresReport=true&view=team");
    expect(canonicalizeModuleLocation(
      "/doctor/reporting-board/saved/token_123",
      "?modalityId=2&assignmentStatus=unassigned&q=private&unknown=x",
    )).toBe("/doctor/reporting-board/saved/token_123?modalityId=2&assignmentStatus=unassigned");
    expect(canonicalizeModuleLocation(
      "/doctor/team-workload",
      "?startDate=2026-09-19&modalityId=2&requiresReport=true&category=oncology&q=private&unknown=x",
    )).toBe("/doctor/team-workload?startDate=2026-09-19&modalityId=2&requiresReport=true&category=oncology");
    expect(canonicalizeModuleLocation(
      "/queue",
      "?view=entered&modalityId=002&patientId=55&q=private&query=MRN&unknown=x",
    )).toBe("/queue?view=entered&modalityId=2&patientId=55");
    expect(canonicalizeModuleLocation(
      "/worklist-monitor",
      "?tab=sante&dateFrom=2026-09-18&dateTo=2026-09-25&modalityId=002&status=failed&q=private&unknown=x",
    )).toBe("/worklist-monitor?tab=sante&dateTo=2026-09-25&modalityId=2&status=failed");
    expect(canonicalizeModuleLocation(
      "/statistics",
      "?date=2026-09-18&q=private&query=MRN&modalityId=002&unknown=x",
    )).toBe("/statistics?modalityId=2");
    expect(canonicalizeModuleLocation(
      "/comparisons",
      "?kind=ir&comparisonStatus=assigned&irStatus=ready_for_review&q=private&search=MRN&unknown=x",
    )).toBe("/comparisons?kind=ir&comparisonStatus=assigned&irStatus=ready_for_review");
    expect(canonicalizeModuleLocation(
      "/doctor/protocols",
      "?area=protocoling&dateFrom=2026-09-18&dateTo=2026-09-25&protocolStatus=ALL&appointmentId=42&q=private&unknown=x",
    )).toBe("/doctor/protocols?protocolStatus=ALL&appointmentId=42");
    expect(canonicalizeModuleLocation(
      "/doctor/advanced-setup",
      "?section=roster&q=private&unknown=x",
      "supervisor",
    )).toBe("/doctor/advanced-setup?section=roster");
  });

  it("strips private and legacy query parameters from every module", () => {
    for (const [pathname, search] of [
      ["/patients", "?q=name&query=mrn&search=accession&category=oncology"],
      ["/registrations", "?q=name&query=mrn&search=accession&dateMode=all"],
      ["/calendar", "?q=name&query=mrn&search=accession&month=2026-09"],
      ["/settings", "?q=name&query=mrn&search=accession&section=equipment"],
      ["/modality", "?q=name&query=mrn&search=accession&view=completed"],
      ["/queue", "?q=name&query=mrn&search=accession&view=entered"],
      ["/worklist-monitor", "?q=name&query=mrn&search=accession&tab=sante"],
      ["/statistics", "?q=name&query=mrn&search=accession&modalityId=2"],
      ["/comparisons", "?q=name&query=mrn&search=accession&kind=ir"],
      ["/doctor/protocols", "?q=name&query=mrn&search=accession&area=protocoling&appointmentId=2"],
    ] as const) {
      const serialized = canonicalizeModuleLocation(pathname, search, "super_admin");
      expect(serialized).not.toMatch(/(?:q|query|search)=/);
    }
  });

  it.each([
    "https://evil.example/calendar",
    "//evil.example/calendar",
    "/patients?patientId=5",
    "/calendar\\@evil.example",
    "/calendar#unsafe",
  ])("rejects unsafe stored location %s", (value) => {
    window.sessionStorage.setItem(MODULE_LAST_LOCATIONS_STORAGE_KEY, JSON.stringify({ calendar: value }));
    expect(readModuleLastLocation("calendar")).toBeNull();
  });

  it("sanitizes a private query in stored Calendar state", () => {
    window.sessionStorage.setItem(
      MODULE_LAST_LOCATIONS_STORAGE_KEY,
      JSON.stringify({ calendar: "/calendar?q=Patient%20Name&month=2026-09&modalityId=2" }),
    );
    expect(readModuleLastLocation("calendar")).toBe("/calendar?month=2026-09&modalityId=2");
  });

  it("gives explicit navigation search precedence over restored state", () => {
    window.sessionStorage.setItem(
      MODULE_LAST_LOCATIONS_STORAGE_KEY,
      JSON.stringify({ registrations: "/registrations?appointmentId=100" }),
    );
    expect(resolveModuleNavigationTarget("/registrations", "appointmentId=200")).toBe("/registrations?appointmentId=200");
    expect(resolveModuleNavigationTarget("/registrations", undefined)).toBe("/registrations?appointmentId=100");
  });

  it("rejects malformed stored JSON and handles missing sessionStorage safely", () => {
    window.sessionStorage.setItem(MODULE_LAST_LOCATIONS_STORAGE_KEY, "not-json");
    expect(readModuleLastLocation("calendar")).toBeNull();

    const getItem = vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("session storage unavailable");
    });
    expect(readModuleLastLocation("calendar")).toBeNull();
    expect(() => saveModuleLastLocation("/calendar", "?month=2026-09")).not.toThrow();
    expect(() => clearModuleLastLocations()).not.toThrow();
    getItem.mockRestore();
  });

  it("saves independent canonical locations and clear removes the complete record", () => {
    saveModuleLastLocation("/patients", "?q=private&category=oncology&page=3");
    saveModuleLastLocation("/calendar", "?month=2026-09&date=2026-09-18&modalityId=2");
    saveModuleLastLocation("/doctor/team-workload", "?startDate=2026-09-19&modalityId=2");
    saveModuleLastLocation("/queue", "?view=entered&modalityId=2&patientId=55&q=private");
    saveModuleLastLocation("/worklist-monitor", "?tab=sante&dateFrom=2026-09-18&dateTo=2026-09-25&status=failed");
    saveModuleLastLocation("/statistics", "?dateFrom=2026-09-10&dateTo=2026-09-20&modalityId=2");
    saveModuleLastLocation("/comparisons", "?kind=ir&irStatus=ready_for_review&q=private");

    expect(JSON.parse(window.sessionStorage.getItem(MODULE_LAST_LOCATIONS_STORAGE_KEY) ?? "{}"))
      .toEqual({
        patients: "/patients?category=oncology&page=3",
        calendar: "/calendar?month=2026-09&date=2026-09-18&modalityId=2",
        doctorTeamWorkload: "/doctor/team-workload?startDate=2026-09-19&modalityId=2",
        queue: "/queue?view=entered&modalityId=2&patientId=55",
        worklistMonitor: "/worklist-monitor?tab=sante&dateTo=2026-09-25&status=failed",
        statistics: "/statistics?dateFrom=2026-09-10&dateTo=2026-09-20&modalityId=2",
        comparisons: "/comparisons?kind=ir&irStatus=ready_for_review",
      });

    clearModuleLastLocations();
    expect(window.sessionStorage.getItem(MODULE_LAST_LOCATIONS_STORAGE_KEY)).toBeNull();
  });
});
