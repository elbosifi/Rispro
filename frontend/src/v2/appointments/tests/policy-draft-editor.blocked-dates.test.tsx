import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi, beforeEach } from "vitest";
import { LanguageProvider } from "@/providers/language-provider-component";
import { PolicyDraftEditor } from "../components/policy-draft-editor";
import type { PolicySnapshotDto } from "../types";

vi.mock("../api", () => ({
  useV2Lookups: () => ({
    data: {
      modalities: [
        { id: 1, name: "CT", code: "CT", dailyCapacity: 10, nameAr: "CT", nameEn: "CT", isActive: true },
        { id: 2, name: "MRI", code: "MRI", dailyCapacity: 12, nameAr: "MRI", nameEn: "MRI", isActive: false },
        { id: 3, name: "XR", code: "XR", dailyCapacity: 8, nameAr: "XR", nameEn: "XR", isActive: true },
      ],
    },
    isLoading: false,
    isError: false,
  }),
  useV2ExamTypeCatalog: () => ({
    data: [],
    isLoading: false,
    isError: false,
  }),
  useV2PolicyUsers: () => ({
    data: [],
    isLoading: false,
    isError: false,
  }),
}));

function renderEditor(snapshot: PolicySnapshotDto, onSave = vi.fn(async () => {})) {
  render(
    <LanguageProvider>
      <PolicyDraftEditor isSaving={false} onSave={onSave} snapshot={snapshot} />
    </LanguageProvider>
  );
  return onSave;
}

describe("PolicyDraftEditor blocked dates", () => {
  beforeEach(() => {
    localStorage.setItem("rispro-language", "en");
  });

  it("renders and saves both date fields for date_range blocked rules", async () => {
    const onSave = vi.fn(async () => {});
    renderEditor(
      {
        categoryDailyLimits: [],
        modalityBlockedRules: [
          {
            id: 1,
            modalityId: 1,
            ruleType: "date_range",
            specificDate: null,
            startDate: null,
            endDate: null,
            recurStartMonth: null,
            recurStartDay: null,
            recurEndMonth: null,
            recurEndDay: null,
            isOverridable: false,
            isActive: true,
            title: null,
            notes: null,
          },
        ],
        examTypeRules: [],
        specialQuotaRules: [],
        examMixQuotaRules: [],
        specialReasonCodes: [],
      },
      onSave
    );

    const blockedSection = screen.getByText("Blocked dates").closest("details");
    expect(blockedSection).toBeTruthy();
    const dateInputs = blockedSection!.querySelectorAll('input[type="date"]');
    expect(dateInputs).toHaveLength(2);

    fireEvent.change(dateInputs[0], { target: { value: "2026-04-01" } });
    fireEvent.change(dateInputs[1], { target: { value: "2026-04-30" } });

    await fireEvent.click(screen.getByRole("button", { name: "Save Draft" }));

    expect(onSave).toHaveBeenCalledTimes(1);
    const savedSnapshot = (onSave.mock.calls[0] as unknown as [PolicySnapshotDto, string | null])[0];
    expect(savedSnapshot.modalityBlockedRules[0].startDate).toBe("2026-04-01");
    expect(savedSnapshot.modalityBlockedRules[0].endDate).toBe("2026-04-30");
  });

  it("copies one configured blocked rule to other active modalities", async () => {
    const onSave = vi.fn(async () => {});
    renderEditor(
      {
        categoryDailyLimits: [],
        modalityBlockedRules: [
          {
            id: 1,
            modalityId: 1,
            ruleType: "date_range",
            specificDate: null,
            startDate: "2026-04-01",
            endDate: "2026-04-30",
            recurStartMonth: null,
            recurStartDay: null,
            recurEndMonth: null,
            recurEndDay: null,
            isOverridable: true,
            isActive: true,
            title: "Block period",
            notes: "Template row",
          },
        ],
        examTypeRules: [],
        specialQuotaRules: [],
        examMixQuotaRules: [],
        specialReasonCodes: [],
      },
      onSave
    );

    fireEvent.click(screen.getByRole("button", { name: "Add blocked rule for all modalities" }));
    await fireEvent.click(screen.getByRole("button", { name: "Save Draft" }));

    expect(onSave).toHaveBeenCalledTimes(1);
    const savedSnapshot = (onSave.mock.calls[0] as unknown as [PolicySnapshotDto, string | null])[0];
    expect(savedSnapshot.modalityBlockedRules).toHaveLength(2);
    expect(savedSnapshot.modalityBlockedRules.map((row) => row.modalityId).sort()).toEqual([1, 3]);
    expect(savedSnapshot.modalityBlockedRules.every((row) => row.modalityId > 0)).toBe(true);
    const copiedRule = savedSnapshot.modalityBlockedRules.find((row) => row.modalityId === 3);
    expect(copiedRule).toMatchObject({
      ruleType: "date_range",
      startDate: "2026-04-01",
      endDate: "2026-04-30",
      isOverridable: true,
      title: "Block period",
      notes: "Template row",
      isActive: true,
    });
  });
});
