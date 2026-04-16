import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { PolicyDraftEditor } from "../components/policy-draft-editor";

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
}));

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
});
