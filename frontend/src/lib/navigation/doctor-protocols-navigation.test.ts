import { beforeEach, describe, expect, it } from "vitest";
import {
  DOCTOR_PROTOCOLING_SEARCH_STORAGE_KEY,
  DOCTOR_PROTOCOL_LIBRARY_SEARCH_STORAGE_KEY,
  buildDoctorProtocolsSearch,
  clearDoctorProtocolsSearch,
  parseDoctorProtocolsNavigation,
  readDoctorProtocolingSearch,
  writeDoctorProtocolingSearch,
  writeDoctorProtocolLibrarySearch,
} from "./doctor-protocols-navigation";

const permissions = { canAssign: true, canManageLibrary: true };

describe("doctor protocols navigation", () => {
  beforeEach(() => window.sessionStorage.clear());

  it("parses permission-aware areas and validated protocoling filters", () => {
    expect(parseDoctorProtocolsNavigation(new URLSearchParams("area=protocoling&dateFrom=2026-09-18&dateTo=2026-09-25&modality=MRI&protocolStatus=ALL&appointmentStatus=waiting&waitingFirst=true&appointmentId=42"), permissions, "2026-09-18"))
      .toEqual({ area: "protocoling", section: "protocols", protocolFilter: "all", dateFrom: "2026-09-18", dateTo: "2026-09-25", modality: "MRI", protocolStatus: "ALL", appointmentStatus: "waiting", waitingFirst: false, appointmentId: 42 });
    expect(parseDoctorProtocolsNavigation(new URLSearchParams("area=library&section=mriSequences&filter=draft"), { canAssign: false, canManageLibrary: true }, "2026-09-18").area).toBe("library");
    expect(parseDoctorProtocolsNavigation(new URLSearchParams("area=library"), { canAssign: true, canManageLibrary: false }, "2026-09-18").area).toBe("protocoling");
  });

  it("serializes stable context and strips private or invalid state", () => {
    expect(buildDoctorProtocolsSearch(new URLSearchParams("q=private&search=private&unknown=x"), { area: "protocoling", dateFrom: "2026-09-18", dateTo: "2026-09-25", waitingFirst: true, appointmentId: 42 }, permissions, "2026-09-18").toString())
      .toBe("waitingFirst=true&appointmentId=42");
    expect(buildDoctorProtocolsSearch(new URLSearchParams(), { area: "library", section: "mriSequences", protocolFilter: "draft" }, permissions, "2026-09-18").toString())
      .toBe("area=library&section=mriSequences");
  });

  it("keeps protocoling and library searches private", () => {
    writeDoctorProtocolingSearch("MRN-123");
    writeDoctorProtocolLibrarySearch("brain");
    expect(readDoctorProtocolingSearch()).toBe("MRN-123");
    expect(window.sessionStorage.getItem(DOCTOR_PROTOCOLING_SEARCH_STORAGE_KEY)).toBe("MRN-123");
    expect(window.sessionStorage.getItem(DOCTOR_PROTOCOL_LIBRARY_SEARCH_STORAGE_KEY)).toBe("brain");
    clearDoctorProtocolsSearch();
    expect(window.sessionStorage.getItem(DOCTOR_PROTOCOLING_SEARCH_STORAGE_KEY)).toBeNull();
    expect(window.sessionStorage.getItem(DOCTOR_PROTOCOL_LIBRARY_SEARCH_STORAGE_KEY)).toBeNull();
  });
});
