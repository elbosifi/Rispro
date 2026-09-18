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

  it("identifies exactly the five supported base paths", () => {
    expect(restorableModuleForPath("/patients")).toBe("patients");
    expect(restorableModuleForPath("/registrations")).toBe("registrations");
    expect(restorableModuleForPath("/calendar")).toBe("calendar");
    expect(restorableModuleForPath("/settings")).toBe("settings");
    expect(restorableModuleForPath("/modality")).toBe("modality");
    expect(restorableModuleForPath("/patients/")).toBeNull();
    expect(restorableModuleForPath("/queue")).toBeNull();
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

  it("strips private and legacy query parameters from every module", () => {
    for (const [pathname, search] of [
      ["/patients", "?q=name&query=mrn&search=accession&category=oncology"],
      ["/registrations", "?q=name&query=mrn&search=accession&dateMode=all"],
      ["/calendar", "?q=name&query=mrn&search=accession&month=2026-09"],
      ["/settings", "?q=name&query=mrn&search=accession&section=equipment"],
      ["/modality", "?q=name&query=mrn&search=accession&view=completed"],
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

    expect(JSON.parse(window.sessionStorage.getItem(MODULE_LAST_LOCATIONS_STORAGE_KEY) ?? "{}"))
      .toEqual({
        patients: "/patients?category=oncology&page=3",
        calendar: "/calendar?month=2026-09&date=2026-09-18&modalityId=2",
      });

    clearModuleLastLocations();
    expect(window.sessionStorage.getItem(MODULE_LAST_LOCATIONS_STORAGE_KEY)).toBeNull();
  });
});
