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

  it("requires non-name verification before selecting an ambiguous search result", async () => {
    const onSelect = vi.fn();
    searchPatients.mockResolvedValue([{
      id: 7,
      arabicFullName: "اختبار تشابه مريض واحد",
      englishFullName: "Similar Patient One",
      category: "non_oncology",
      mrn: "MRN-7",
      maskedPrimaryIdentifier: "••••1234",
      maskedPhone1: "••••••5678",
      identityRisk: "ambiguous",
      similarPatientCount: 1,
      availableVerificationMethods: ["phone_suffix"],
    }]);
    verifyPatientIdentity.mockResolvedValue({ proof: "signed-proof", verificationMethod: "phone_suffix" });

    render(<LanguageProvider><PatientSearch selectedPatient={null} onSelect={onSelect} onClear={vi.fn()} caseCategory="non_oncology" /></LanguageProvider>);
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "Similar" } });
    await waitFor(() => expect(searchPatients).toHaveBeenCalledWith("Similar"));
    fireEvent.click(await screen.findByText("Similar Patient One"));

    expect(onSelect).not.toHaveBeenCalled();
    expect(screen.getByText("Verify patient identity")).toBeTruthy();
    expect(screen.queryByText("0912345678")).toBeNull();
    fireEvent.change(screen.getByPlaceholderText("Last four digits"), { target: { value: "5678" } });
    fireEvent.click(screen.getByRole("button", { name: "Verify and select" }));

    await waitFor(() => expect(verifyPatientIdentity).toHaveBeenCalledWith(7, "phone_suffix", "5678"));
    await waitFor(() => expect(onSelect).toHaveBeenCalledWith(expect.objectContaining({ id: 7, patientIdentityVerificationProof: "signed-proof" })));
  });

  it("explains the safe next step when an ambiguous preselected patient has no verification methods", () => {
    render(<LanguageProvider><PatientSearch selectedPatient={{ id: 9, arabicFullName: "مريض تشابه", identityRisk: "ambiguous", availableVerificationMethods: [] }} onSelect={vi.fn()} onClear={vi.fn()} caseCategory="non_oncology" /></LanguageProvider>);
    fireEvent.click(screen.getByRole("button", { name: "Verify identity" }));
    expect(screen.getByText("No usable non-name identifier is recorded. Update the patient record before scheduling; name-only selection is not permitted.")).toBeTruthy();
    expect((screen.getByRole("button", { name: "Verify and select" }) as HTMLButtonElement).disabled).toBe(true);
  });
});
