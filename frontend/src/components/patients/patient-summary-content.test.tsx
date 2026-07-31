import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { LanguageProvider } from "@/providers/language-provider-component";
import type { PatientDirectorySummary } from "@/types/api";
import { PatientSummaryContent } from "./patient-summary-content";
import { formatPatientIdentifierRows } from "./patient-summary-formatters";

const summary: PatientDirectorySummary = {
  demographics: { id: 7, mrn: "005821", arabicFullName: "خالد وليد محمود", englishFullName: "Khaled Walid Mahmoud", sex: "F", ageYears: 19, demographicsEstimated: false, dateOfBirth: "2007-01-01T00:00:00.000Z" },
  identifiers: {
    nationalId: "N4609871",
    identifierType: "passport",
    identifierValue: "N4609871",
    items: [
      { id: 1, typeCode: "passport", value: "N4609871", isPrimary: true },
      { id: 2, typeCode: "national_id", value: "N4609871", isPrimary: false },
      { id: 3, typeCode: "national_id", value: "N4609871", isPrimary: false },
    ],
  },
  contact: { phone1: "0943855646", phone2: "0910000000", address: "Tripoli" },
  category: "oncology",
  registration: { createdAt: "2026-07-01T08:00:00Z", createdByUserId: 2, createdByName: "Staff", createdByUsername: "staff" },
  warnings: { missingPhone: false, missingDob: false, missingSex: false, missingName: false, incompleteData: false, possibleDuplicate: false, duplicateReasons: [] },
  lastAppointment: null,
  nextAppointment: null,
  recentAppointments: [],
  noShow: { noShowCount: 0, bookingRestricted: false, lastNoShowAppointment: null, lastAuthorizationUser: null, lastAuthorizationDate: null, lastAuthorizationReason: null },
};

beforeEach(() => localStorage.setItem("rispro-language", "en"));
afterEach(() => { cleanup(); localStorage.removeItem("rispro-language"); });

describe("PatientSummaryContent", () => {
  it("shares localized identity formatting and deduplicates repeated identifiers", () => {
    expect(formatPatientIdentifierRows(summary, "en")).toHaveLength(1);
    render(<LanguageProvider><PatientSummaryContent summary={summary} variant="embedded" /></LanguageProvider>);

    expect(screen.getByText("Khaled Walid Mahmoud")).toBeTruthy();
    expect(screen.getByText(/19 years · Female/)).toBeTruthy();
    const demographics = screen.getByRole("button", { name: "More demographics" });
    expect(demographics.getAttribute("aria-expanded")).toBe("false");
    expect(screen.getByText("N4609871")).toBeTruthy();
    expect(screen.queryAllByText("N4609871")).toHaveLength(1);
    expect(screen.getByText("More demographics")).toBeTruthy();
  });
});
