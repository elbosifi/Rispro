import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import { LanguageProvider } from "@/providers/language-provider";
import { PatientCategoryBadge } from "@/components/patients/patient-category-badge";

function renderBadge(category: "oncology" | "non_oncology" | null, showWhenUnset = false) {
  return render(
    <LanguageProvider>
      <PatientCategoryBadge category={category} showWhenUnset={showWhenUnset} />
    </LanguageProvider>
  );
}

describe("PatientCategoryBadge", () => {
  beforeEach(() => {
    localStorage.setItem("rispro-language", "en");
  });

  it("renders oncology label", () => {
    renderBadge("oncology");
    expect(screen.getByText("Oncology")).toBeTruthy();
  });

  it("renders non-oncology label", () => {
    renderBadge("non_oncology");
    expect(screen.getByText("Non-Oncology")).toBeTruthy();
  });

  it("renders unset label when requested", () => {
    renderBadge(null, true);
    expect(screen.getByText("Not set")).toBeTruthy();
  });
});
