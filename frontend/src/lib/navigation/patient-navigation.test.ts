import { describe, expect, it } from "vitest";
import {
  buildPatientDirectorySearch,
  globalPatientSearchLocation,
  parsePatientDirectoryNavigation,
  patientEditPath,
  safeInternalReturnTo,
} from "./patient-navigation";

describe("patient directory navigation", () => {
  it("parses every supported value and falls back safely for malformed values", () => {
    const parsed = parsePatientDirectoryNavigation(new URLSearchParams("q=SENSITIVE_VALUE&category=oncology&appointment=has_future&sex=male&ageMin=40&ageMax=70&sort=name&page=3&patientId=824"));
    expect(parsed).toEqual({ category: "oncology", appointment: "has_future", sex: "male", ageMin: 40, ageMax: 70, sort: "name", page: 3, patientId: 824 });

    expect(parsePatientDirectoryNavigation(new URLSearchParams("category=unknown&appointment=nope&sex=x&ageMin=-1&ageMax=3.2&sort=nope&page=0&patientId=nan"))).toMatchObject({
      category: "", appointment: "", sex: "", ageMin: "", ageMax: "", sort: "recent", page: 1, patientId: null,
    });
  });

  it("omits defaults and preserves unrelated query parameters while changing directory state", () => {
    const next = buildPatientDirectorySearch(new URLSearchParams("source=dashboard&q=old&page=4&patientId=55"), {
      page: 1, patientId: null, category: "oncology",
    });
    expect(next.toString()).toBe("source=dashboard&category=oncology");
  });

  it("builds an encoded edit target and permits only safe internal return locations", () => {
    expect(patientEditPath(824, "/patients?q=Ahmed&category=oncology&page=3&patientId=824")).toBe("/patients/824/edit?returnTo=%2Fpatients%3Fcategory%3Doncology%26page%3D3%26patientId%3D824");
    expect(safeInternalReturnTo("/patients?q=Ahmed&category=oncology#drawer")).toBe("/patients?category=oncology#drawer");
    expect(safeInternalReturnTo("https://evil.example/patients")).toBe("/patients");
    expect(safeInternalReturnTo("//evil.example/patients")).toBe("/patients");
    expect(safeInternalReturnTo("/\\evil.example")).toBe("/patients");
    expect(safeInternalReturnTo("/..//evil.example")).toBe("/patients");
    expect(safeInternalReturnTo("/%2e%2e//evil.example")).toBe("/patients");
  });

  it("makes global patient search canonical while preserving active Patients filters", () => {
    expect(globalPatientSearchLocation("/patients", "?q=SENSITIVE_VALUE&page=2", 55)).toBe("/patients?page=2&patientId=55");
    expect(globalPatientSearchLocation("/dashboard", "?q=SENSITIVE_VALUE", 55)).toBe("/patients?patientId=55");
  });
});
