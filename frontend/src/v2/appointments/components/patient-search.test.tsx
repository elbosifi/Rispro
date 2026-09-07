import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, beforeEach, vi } from "vitest";
import { LanguageProvider } from "@/providers/language-provider-component";
import { transliterateArabicName } from "@/lib/transliterate";
import { PatientSearch } from "./patient-search";

const { searchPatients, verifyPatientIdentity } = vi.hoisted(() => ({
  searchPatients: vi.fn(),
  verifyPatientIdentity: vi.fn(),
}));

vi.mock("../api", () => ({
  searchV2AppointmentPatients: searchPatients,
  verifyV2AppointmentPatientIdentity: verifyPatientIdentity,
}));

describe("PatientSearch", () => {
  beforeEach(() => {
    localStorage.setItem("rispro-language", "en");
    searchPatients.mockReset();
    verifyPatientIdentity.mockReset();
  });

  it("falls back to transliterated Arabic name when English name is missing", () => {
    render(
      <LanguageProvider>
        <PatientSearch
          transliterateMissingEnglish
          selectedPatient={{
            id: 42,
            arabicFullName: "محمد علي",
            englishFullName: null,
            category: "non_oncology",
          }}
          onSelect={vi.fn()}
          onClear={vi.fn()}
          caseCategory="non_oncology"
        />
      </LanguageProvider>
    );

    expect(screen.getByText(transliterateArabicName("محمد علي"))).toBeTruthy();
  });

  it("requires the complete primary identifier before selecting an ambiguous search result", async () => {
    const onSelect = vi.fn();
    searchPatients.mockResolvedValue([{
      id: 7,
      arabicFullName: "اختبار تشابه مريض واحد",
      englishFullName: "Similar Patient One",
      category: "non_oncology",
      mrn: "MRN-7",
      primaryIdentifierType: "national_id",
      primaryIdentifierTypeLabelAr: "الرقم الوطني",
      primaryIdentifierTypeLabelEn: "National ID",
      maskedPrimaryIdentifier: "••••1234",
      maskedPhone1: "••••••5678",
      identityRisk: "ambiguous",
      similarPatientCount: 1,
      availableVerificationMethods: ["primary_identifier"],
    }]);
    verifyPatientIdentity.mockResolvedValue({ proof: "signed-proof", verificationMethod: "primary_identifier" });

    render(<LanguageProvider><PatientSearch selectedPatient={null} onSelect={onSelect} onClear={vi.fn()} caseCategory="non_oncology" /></LanguageProvider>);
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "Similar" } });
    await waitFor(() => expect(searchPatients).toHaveBeenCalledWith("Similar"));
    expect(screen.getByText(/National ID: .*1234/)).toBeTruthy();
    expect(screen.queryByText("100000000001")).toBeNull();
    fireEvent.click(await screen.findByText("Similar Patient One"));

    expect(onSelect).not.toHaveBeenCalled();
    expect(screen.getByText("Verify patient identity")).toBeTruthy();
    expect(screen.getByText("National ID")).toBeTruthy();
    expect(screen.queryByText("0912345678")).toBeNull();
    expect(screen.queryByRole("radio")).toBeNull();
    expect(screen.queryByText("Exact date of birth")).toBeNull();
    expect(screen.queryByText("Final four Phone 1 digits")).toBeNull();
    const identifierInput = screen.getByPlaceholderText("Enter complete National ID") as HTMLInputElement;
    expect(identifierInput.value).toBe("");
    expect(screen.queryByDisplayValue("100000000001")).toBeNull();
    fireEvent.change(identifierInput, { target: { value: "100000000001" } });
    fireEvent.click(screen.getByRole("button", { name: "Verify and select" }));

    await waitFor(() => expect(verifyPatientIdentity).toHaveBeenCalledWith(7, "primary_identifier", "100000000001"));
    await waitFor(() => expect(onSelect).toHaveBeenCalledWith(expect.objectContaining({ id: 7, patientIdentitySelectionSource: "search", patientIdentityVerificationProof: "signed-proof", patientIdentityVerificationMethod: "primary_identifier" })));
  });

  it("uses the primary identifier type in the selected-patient summary", () => {
    render(<LanguageProvider><PatientSearch selectedPatient={{
      id: 13,
      arabicFullName: "مريض بطاقة وطنية",
      englishFullName: "Selected National ID Patient",
      primaryIdentifierType: "national_id",
      primaryIdentifierTypeLabelAr: "الرقم الوطني",
      primaryIdentifierTypeLabelEn: "National ID",
      maskedPrimaryIdentifier: "••••1234",
    }} onSelect={vi.fn()} onClear={vi.fn()} caseCategory="non_oncology" /></LanguageProvider>);

    expect(screen.getByText(/National ID: .*1234/)).toBeTruthy();
    expect(screen.queryByText("100000000001")).toBeNull();
  });

  it("displays the server-provided Passport identifier type without prefilling its value", async () => {
    searchPatients.mockResolvedValue([{
      id: 8,
      arabicFullName: "مريض جواز سفر متشابه",
      englishFullName: "Passport Patient",
      identityRisk: "ambiguous",
      availableVerificationMethods: ["primary_identifier"],
      primaryIdentifierType: "passport",
      primaryIdentifierTypeLabelAr: "جواز السفر",
      primaryIdentifierTypeLabelEn: "Passport",
      maskedPrimaryIdentifier: "••••4321",
    }]);

    render(<LanguageProvider><PatientSearch selectedPatient={null} onSelect={vi.fn()} onClear={vi.fn()} caseCategory="non_oncology" /></LanguageProvider>);
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "Passport" } });
    await waitFor(() => expect(searchPatients).toHaveBeenCalledWith("Passport"));
    expect(screen.getByText(/Passport: .*4321/)).toBeTruthy();
    fireEvent.click(await screen.findByText("Passport Patient"));

    expect(screen.getByText("Passport")).toBeTruthy();
    expect(screen.getByPlaceholderText("Enter complete Passport")).toBeTruthy();
    expect(screen.queryByDisplayValue("passport-value")).toBeNull();
  });

  it("uses a custom localized identifier type label from the patient-selection response", async () => {
    searchPatients.mockResolvedValue([{
      id: 11,
      arabicFullName: "مريض معرّف مخصص متشابه",
      englishFullName: "Custom Identifier Patient",
      identityRisk: "ambiguous",
      availableVerificationMethods: ["primary_identifier"],
      primaryIdentifierType: "other",
      primaryIdentifierTypeLabelAr: "بطاقة المستشفى",
      primaryIdentifierTypeLabelEn: "Hospital card number",
      maskedPrimaryIdentifier: "••••9876",
    }]);

    render(<LanguageProvider><PatientSearch selectedPatient={null} onSelect={vi.fn()} onClear={vi.fn()} caseCategory="non_oncology" /></LanguageProvider>);
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "Custom" } });
    await waitFor(() => expect(searchPatients).toHaveBeenCalledWith("Custom"));
    expect(screen.getByText(/Hospital card number: .*9876/)).toBeTruthy();
    fireEvent.click(await screen.findByText("Custom Identifier Patient"));

    expect(screen.getByText("Hospital card number")).toBeTruthy();
    expect(screen.getByPlaceholderText("Enter complete Hospital card number")).toBeTruthy();
  });

  it("uses the Arabic configured label and prompt when the UI language is Arabic", async () => {
    localStorage.setItem("rispro-language", "ar");
    searchPatients.mockResolvedValue([{
      id: 12,
      arabicFullName: "مريض جواز سفر متشابه",
      englishFullName: "Arabic Passport Patient",
      identityRisk: "ambiguous",
      availableVerificationMethods: ["primary_identifier"],
      primaryIdentifierType: "passport",
      primaryIdentifierTypeLabelAr: "جواز السفر",
      primaryIdentifierTypeLabelEn: "Passport",
      maskedPrimaryIdentifier: "••••4321",
    }]);

    render(<LanguageProvider><PatientSearch selectedPatient={null} onSelect={vi.fn()} onClear={vi.fn()} caseCategory="non_oncology" /></LanguageProvider>);
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "Arabic" } });
    await waitFor(() => expect(searchPatients).toHaveBeenCalledWith("Arabic"));
    expect(screen.getByText(/جواز السفر: .*4321/)).toBeTruthy();
    fireEvent.click(await screen.findByText("مريض جواز سفر متشابه"));

    expect(screen.getByText("جواز السفر")).toBeTruthy();
    expect(screen.getByPlaceholderText("أدخل جواز السفر كاملاً")).toBeTruthy();
  });

  it("explains the safe next step when an ambiguous preselected patient has no verification methods", () => {
    render(<LanguageProvider><PatientSearch selectedPatient={{ id: 9, arabicFullName: "مريض تشابه", identityRisk: "ambiguous", availableVerificationMethods: [] }} onSelect={vi.fn()} onClear={vi.fn()} caseCategory="non_oncology" /></LanguageProvider>);
    fireEvent.click(screen.getByRole("button", { name: "Verify identity" }));
    expect(screen.getByText("No primary identifier is recorded for this patient. Update the patient record and set a primary National ID, passport number, or other identifier before scheduling.")).toBeTruthy();
    expect(screen.queryByText("National ID")).toBeNull();
    expect(screen.queryByPlaceholderText(/Enter complete/)).toBeNull();
    expect((screen.getByRole("button", { name: "Verify and select" }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("labels synthetic demographic dates as estimated rather than exact DOB", async () => {
    searchPatients.mockResolvedValue([{
      id: 10,
      arabicFullName: "مريض بيانات تقديرية",
      englishFullName: "Estimated Demographics Patient",
      category: "non_oncology",
      ageYears: 46,
      estimatedDateOfBirth: "1980-01-02",
      demographicsEstimated: true,
      identityRisk: "none",
      availableVerificationMethods: ["primary_identifier"],
    }]);

    render(<LanguageProvider><PatientSearch selectedPatient={null} onSelect={vi.fn()} onClear={vi.fn()} caseCategory="non_oncology" /></LanguageProvider>);
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "Estimated" } });
    await waitFor(() => expect(searchPatients).toHaveBeenCalledWith("Estimated"));
    expect(await screen.findByText(/Estimated DOB: 1980-01-02/)).toBeTruthy();
  });
});
