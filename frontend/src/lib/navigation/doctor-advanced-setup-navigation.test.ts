import { describe, expect, it } from "vitest";
import {
  buildDoctorAdvancedSetupSearch,
  parseDoctorAdvancedSetupNavigation,
  sanitizeDoctorAdvancedSetupSearch,
} from "./doctor-advanced-setup-navigation";

const both = { canManageRoster: true, canManageDoctors: true };

describe("Doctor Advanced Setup navigation", () => {
  it("parses only known sections", () => {
    expect(parseDoctorAdvancedSetupNavigation(new URLSearchParams("section=roster"), both).section).toBe("roster");
    expect(parseDoctorAdvancedSetupNavigation(new URLSearchParams("section=unknown"), both).section).toBeNull();
  });

  it("sanitizes sections the current user cannot access", () => {
    expect(parseDoctorAdvancedSetupNavigation(new URLSearchParams("section=roster"), { canManageRoster: false, canManageDoctors: true }).section).toBeNull();
    expect(parseDoctorAdvancedSetupNavigation(new URLSearchParams("section=doctors"), { canManageRoster: true, canManageDoctors: false }).section).toBeNull();
    expect(sanitizeDoctorAdvancedSetupSearch(new URLSearchParams("section=roster&unknown=x"), { canManageRoster: false, canManageDoctors: true }).toString()).toBe("");
  });

  it("builds the permission-aware section query", () => {
    expect(buildDoctorAdvancedSetupSearch(new URLSearchParams("section=roster"), {}, both).toString()).toBe("section=roster");
    expect(buildDoctorAdvancedSetupSearch(new URLSearchParams(), { section: "doctors" }, both).toString()).toBe("section=doctors");
    expect(buildDoctorAdvancedSetupSearch(new URLSearchParams("section=doctors"), { section: null }, both).toString()).toBe("");
  });
});

