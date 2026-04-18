import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { PolicyDraftEditor } from "../components/policy-draft-editor";

vi.mock("../api", () => ({
  useV2Lookups: () => ({
    data: {
      modalities: [{ id: 1, name: "CT", code: "CT", dailyCapacity: 10 }],
    },
    isLoading: false,
    isError: false,
  }),
  useV2ExamTypeCatalog: () => ({
    data: [],
    isLoading: false,
    isError: false,
  }),
}));

describe("PolicyDraftEditor category daily limits", () => {
  it("auto-balances counterpart category limit when both categories exist", () => {
    render(
      <PolicyDraftEditor
        isSaving={false}
        onSave={async () => {}}
        snapshot={{
          categoryDailyLimits: [
            { id: 1, modalityId: 1, caseCategory: "oncology", dailyLimit: 4, isActive: true },
            { id: 2, modalityId: 1, caseCategory: "non_oncology", dailyLimit: 6, isActive: true },
          ],
          modalityBlockedRules: [],
          examTypeRules: [],
          examTypeSpecialQuotas: [],
          examMixQuotaRules: [],
          specialReasonCodes: [],
        }}
      />
    );

    const dailyLimitInputs = screen.getAllByRole("spinbutton") as HTMLInputElement[];
    fireEvent.change(dailyLimitInputs[0], { target: { value: "7" } });

    expect(dailyLimitInputs[0].value).toBe("7");
    expect(dailyLimitInputs[1].value).toBe("3");
  });

  it("blocks save when duplicate active modality/category rows exist", async () => {
    const onSave = vi.fn(async () => {});

    render(
      <PolicyDraftEditor
        isSaving={false}
        onSave={onSave}
        snapshot={{
          categoryDailyLimits: [
            { id: 1, modalityId: 1, caseCategory: "oncology", dailyLimit: 4, isActive: true },
            { id: 2, modalityId: 1, caseCategory: "oncology", dailyLimit: 6, isActive: true },
          ],
          modalityBlockedRules: [],
          examTypeRules: [],
          examTypeSpecialQuotas: [],
          examMixQuotaRules: [],
          specialReasonCodes: [],
        }}
      />
    );

    fireEvent.click(screen.getByRole("button", { name: "Save Draft Snapshot" }));

    expect(onSave).not.toHaveBeenCalled();
    expect(screen.getByText("Duplicate active category limits detected for the same modality/category.")).toBeTruthy();
  });
});
