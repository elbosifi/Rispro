import { render, screen } from "@testing-library/react";
import { describe, expect, it, beforeEach, vi } from "vitest";
import { LanguageProvider } from "@/providers/language-provider-component";
import { transliterateArabicName } from "@/lib/transliterate";
import { PatientSearch } from "./patient-search";

describe("PatientSearch", () => {
  beforeEach(() => {
    localStorage.setItem("rispro-language", "en");
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
});
