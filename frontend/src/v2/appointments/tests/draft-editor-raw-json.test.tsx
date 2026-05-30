import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { PolicyDraftEditor } from "../components/policy-draft-editor";

vi.mock("@/providers/language-provider", () => ({
  useLanguage: () => ({ language: "en" }),
}));

vi.mock("../api", () => ({
  useV2Lookups: () => ({
    data: { modalities: [{ id: 7, name: "MRI", code: "MRI" }] },
    isLoading: false,
    isError: false,
  }),
  useV2ExamTypeCatalog: () => ({
    data: [{ id: 11, modalityId: 7, name: "Brain MRI", code: "MRB" }],
    isLoading: false,
    isError: false,
  }),
  useV2PolicyUsers: () => ({
    data: [],
    isLoading: false,
    isError: false,
  }),
}));

afterEach(() => {
  vi.restoreAllMocks();
});

describe("PolicyDraftEditor raw json", () => {
  it("keeps examMixQuotaRules section editable", () => {
    render(
      <PolicyDraftEditor
        isSaving={false}
        onSave={async () => {}}
        snapshot={{
          categoryDailyLimits: [],
          modalityBlockedRules: [],
          examTypeRules: [],
          examTypeSpecialQuotas: [],
          examMixQuotaRules: [],
          specialReasonCodes: [],
        }}
      />
    );

    fireEvent.click(screen.getByText("Add exam mix group"));
    expect(screen.getByText("Exam mix quota groups")).toBeTruthy();
    const select = document.querySelector('select option[value="specific_date"]');
    expect(select).toBeTruthy();
  });

  it("keeps raw JSON collapsed by default and requires confirmation before applying", () => {
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
    render(
      <PolicyDraftEditor
        isSaving={false}
        onSave={async () => {}}
        snapshot={{
          categoryDailyLimits: [],
          modalityBlockedRules: [],
          examTypeRules: [],
          examTypeSpecialQuotas: [],
          examMixQuotaRules: [],
          specialReasonCodes: [],
        }}
      />
    );

    const advanced = screen.getByText("Advanced / Raw JSON").closest("details");
    expect(advanced?.hasAttribute("open")).toBe(false);

    fireEvent.click(screen.getByText("Advanced / Raw JSON"));
    fireEvent.click(screen.getByRole("button", { name: "Apply JSON to form" }));

    expect(confirm).toHaveBeenCalledWith("Apply raw JSON changes to the draft form? This can overwrite structured edits.");
  });
});
