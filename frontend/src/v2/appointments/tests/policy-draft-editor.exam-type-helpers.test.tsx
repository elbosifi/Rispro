import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { PolicyDraftEditor } from "../components/policy-draft-editor";
import type { PolicySnapshotDto } from "../types";

vi.mock("@/providers/language-provider", () => ({
  useLanguage: () => ({ language: "en" }),
}));

vi.mock("../api", () => ({
  useV2Lookups: () => ({
    data: {
      modalities: [
        { id: "1" as unknown as number, name: "CT", code: "CT" },
        { id: "2" as unknown as number, name: "MRI", code: "MR" },
      ],
    },
    isLoading: false,
    isError: false,
  }),
  useV2ExamTypeCatalog: () => ({
    data: [
      { id: "101" as unknown as number, modalityId: "1" as unknown as number, name: "CT Head", code: "CTH" },
      { id: "102" as unknown as number, modalityId: "1" as unknown as number, name: "CT Chest", code: "CTC" },
      { id: "104" as unknown as number, modalityId: "1" as unknown as number, name: "CT Abdomen", code: "CTA" },
      { id: "105" as unknown as number, modalityId: "1" as unknown as number, name: "CT Pelvis", code: "CTP" },
      { id: "106" as unknown as number, modalityId: "1" as unknown as number, name: "CT Spine", code: "CTS" },
      { id: "107" as unknown as number, modalityId: "1" as unknown as number, name: "CT Sinus", code: "CTSIN" },
      { id: "108" as unknown as number, modalityId: "1" as unknown as number, name: "CT Neck", code: "CTN" },
      { id: "109" as unknown as number, modalityId: "1" as unknown as number, name: "CT Angio", code: "CTANG" },
      { id: "110" as unknown as number, modalityId: "1" as unknown as number, name: "CT Cardiac", code: "CTCARD" },
    ],
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

describe("PolicyDraftEditor exam type helper text", () => {
  describe("Exam date rules section", () => {
    it("shows selected inactive and unknown exams after load and preserves them on save", async () => {
      let savedSnapshot: PolicySnapshotDto | null = null;
      const onSave = vi.fn(async (nextSnapshot: PolicySnapshotDto) => {
        savedSnapshot = nextSnapshot;
      });
      render(
        <PolicyDraftEditor
          isSaving={false}
          onSave={onSave}
          displayLookups={{
            modalities: [],
            examTypes: [
              { id: 103, modalityId: 1, name: "Old CT Angio", nameAr: null, nameEn: "Old CT Angio", code: "CTA", isActive: false },
            ],
            users: [],
          }}
          snapshot={{
            categoryDailyLimits: [],
            modalityBlockedRules: [],
            examTypeRules: [
              {
                id: 1,
                modalityId: 1,
                ruleType: "specific_date",
                effectMode: "restriction_overridable",
                specificDate: "2027-01-01",
                startDate: null,
                endDate: null,
                weekday: null,
                alternateWeeks: false,
                recurrenceAnchorDate: null,
                examTypeIds: [103, 999],
                title: null,
                notes: null,
                isActive: true,
              },
            ],
            examTypeSpecialQuotas: [],
            examMixQuotaRules: [],
            specialReasonCodes: [],
          }}
        />
      );

      expect(screen.getByText("Exam restriction rule #1")).toBeTruthy();
      expect(screen.getAllByText(/Supervisor-overridable restriction/).length).toBeGreaterThan(0);
      expect(screen.getByText("Selected exams (2)")).toBeTruthy();
      expect(screen.getByText("Old CT Angio (CTA) (inactive)")).toBeTruthy();
      expect(screen.getByText("Unknown exam type ID 999")).toBeTruthy();

      fireEvent.click(screen.getByRole("button", { name: "Save Draft" }));

      expect(onSave).toHaveBeenCalledTimes(1);
      expect((savedSnapshot as PolicySnapshotDto | null)?.examTypeRules[0]?.examTypeIds).toEqual([103, 999]);
    });

    it("does not clear selected exams on modality change when confirmation is declined", () => {
      const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
      render(
        <PolicyDraftEditor
          isSaving={false}
          onSave={async () => {}}
          displayLookups={{
            modalities: [],
            examTypes: [{ id: 103, modalityId: 1, name: "Old CT Angio", nameAr: null, nameEn: "Old CT Angio", code: "CTA", isActive: false }],
            users: [],
          }}
          snapshot={{
            categoryDailyLimits: [],
            modalityBlockedRules: [],
            examTypeRules: [
              {
                id: 1,
                modalityId: 1,
                ruleType: "specific_date",
                effectMode: "restriction_overridable",
                specificDate: null,
                startDate: null,
                endDate: null,
                weekday: null,
                alternateWeeks: false,
                recurrenceAnchorDate: null,
                examTypeIds: [103],
                title: null,
                notes: null,
                isActive: true,
              },
            ],
            examTypeSpecialQuotas: [],
            examMixQuotaRules: [],
            specialReasonCodes: [],
          }}
        />
      );

      fireEvent.change(screen.getAllByRole("combobox")[0], { target: { value: "2" } });

      expect(confirm).toHaveBeenCalledWith("Changing modality will clear selected exams for this rule. Continue?");
      expect(screen.getByText("Old CT Angio (CTA) (inactive)")).toBeTruthy();
    });

    it("shows restriction-based wording and bulk actions when modality has exam types", () => {
      render(
        <PolicyDraftEditor
          isSaving={false}
          onSave={async () => {}}
          snapshot={{
            categoryDailyLimits: [],
            modalityBlockedRules: [],
            examTypeRules: [
              {
                id: 1,
                modalityId: 1,
                ruleType: "specific_date",
                effectMode: "restriction_overridable",
                specificDate: null,
                startDate: null,
                endDate: null,
                weekday: null,
                alternateWeeks: false,
                recurrenceAnchorDate: null,
                examTypeIds: [],
                title: null,
                notes: null,
                isActive: true,
              },
            ],
            examTypeSpecialQuotas: [],
            examMixQuotaRules: [],
            specialReasonCodes: [],
          }}
        />
      );

      expect(screen.getByText("Exam restriction rules")).toBeTruthy();
      expect(screen.getByText("Exam restriction rule #1")).toBeTruthy();
      expect(screen.getByText("Selected exams (0)")).toBeTruthy();
      expect(screen.getByText("Checked exams are the ones this rule blocks or restricts.")).toBeTruthy();
      expect(screen.getByRole("button", { name: "Select all" })).toBeTruthy();
      expect(screen.getByRole("button", { name: "Clear all" })).toBeTruthy();
    });

    it("shows 'Select a modality first.' when no modality is selected", () => {
      render(
        <PolicyDraftEditor
          isSaving={false}
          onSave={async () => {}}
          snapshot={{
            categoryDailyLimits: [],
            modalityBlockedRules: [],
            examTypeRules: [
              {
                id: 1,
                modalityId: 0,
                ruleType: "specific_date",
                effectMode: "restriction_overridable",
                specificDate: null,
                startDate: null,
                endDate: null,
                weekday: null,
                alternateWeeks: false,
                recurrenceAnchorDate: null,
                examTypeIds: [],
                title: null,
                notes: null,
                isActive: true,
              },
            ],
            examTypeSpecialQuotas: [],
            examMixQuotaRules: [],
            specialReasonCodes: [],
          }}
        />
      );

      expect(screen.getByText("Select a modality first.")).toBeTruthy();
    });

    it("shows modality-aware empty-state when modality has no exam types", () => {
      render(
        <PolicyDraftEditor
          isSaving={false}
          onSave={async () => {}}
          snapshot={{
            categoryDailyLimits: [],
            modalityBlockedRules: [],
            examTypeRules: [
              {
                id: 1,
                modalityId: 99,
                ruleType: "specific_date",
                effectMode: "restriction_overridable",
                specificDate: null,
                startDate: null,
                endDate: null,
                weekday: null,
                alternateWeeks: false,
                recurrenceAnchorDate: null,
                examTypeIds: [],
                title: null,
                notes: null,
                isActive: true,
              },
            ],
            examTypeSpecialQuotas: [],
            examMixQuotaRules: [],
            specialReasonCodes: [],
          }}
        />
      );

      const emptyState = screen.getByText(/No active exam types available to add for/);
      expect(emptyState).toBeTruthy();
    });

    it("shows exam type checkboxes when modality has exam types", () => {
      render(
        <PolicyDraftEditor
          isSaving={false}
          onSave={async () => {}}
          snapshot={{
            categoryDailyLimits: [],
            modalityBlockedRules: [],
            examTypeRules: [
              {
                id: 1,
                modalityId: 1,
                ruleType: "specific_date",
                effectMode: "restriction_overridable",
                specificDate: null,
                startDate: null,
                endDate: null,
                weekday: null,
                alternateWeeks: false,
                recurrenceAnchorDate: null,
                examTypeIds: [],
                title: null,
                notes: null,
                isActive: true,
              },
            ],
            examTypeSpecialQuotas: [],
            examMixQuotaRules: [],
            specialReasonCodes: [],
          }}
        />
      );

      expect(screen.getByText("CT Head")).toBeTruthy();
      expect(screen.getByText("CT Chest")).toBeTruthy();
    });

    it("selects and clears all restricted exams", () => {
      const confirm = vi.spyOn(window, "confirm").mockReturnValue(true);
      render(
        <PolicyDraftEditor
          isSaving={false}
          onSave={async () => {}}
          snapshot={{
            categoryDailyLimits: [],
            modalityBlockedRules: [],
            examTypeRules: [
              {
                id: 1,
                modalityId: 1,
                ruleType: "specific_date",
                effectMode: "restriction_overridable",
                specificDate: null,
                startDate: null,
                endDate: null,
                weekday: null,
                alternateWeeks: false,
                recurrenceAnchorDate: null,
                examTypeIds: [],
                title: null,
                notes: null,
                isActive: true,
              },
            ],
            examTypeSpecialQuotas: [],
            examMixQuotaRules: [],
            specialReasonCodes: [],
          }}
        />
      );

      fireEvent.click(screen.getByRole("button", { name: "Select all" }));
      expect((screen.getByLabelText("CT Head") as HTMLInputElement).checked).toBe(true);
      expect((screen.getByLabelText("CT Chest") as HTMLInputElement).checked).toBe(true);

      fireEvent.click(screen.getByRole("button", { name: "Clear all" }));
      expect(confirm).toHaveBeenCalledWith("Clear all selected exams from this exam restriction rule?");
      expect((screen.getByLabelText("CT Head") as HTMLInputElement).checked).toBe(false);
      expect((screen.getByLabelText("CT Chest") as HTMLInputElement).checked).toBe(false);
    });

    it("filters available exams without hiding selected chips and preserves selections on save", async () => {
      let savedSnapshot: PolicySnapshotDto | null = null;
      const onSave = vi.fn(async (nextSnapshot: PolicySnapshotDto) => {
        savedSnapshot = nextSnapshot;
      });
      render(
        <PolicyDraftEditor
          isSaving={false}
          onSave={onSave}
          snapshot={{
            categoryDailyLimits: [],
            modalityBlockedRules: [],
            examTypeRules: [
              {
                id: 1,
                modalityId: 1,
                ruleType: "specific_date",
                effectMode: "restriction_overridable",
                specificDate: "2027-01-01",
                startDate: null,
                endDate: null,
                weekday: null,
                alternateWeeks: false,
                recurrenceAnchorDate: null,
                examTypeIds: [101],
                title: null,
                notes: null,
                isActive: true,
              },
            ],
            examTypeSpecialQuotas: [],
            examMixQuotaRules: [],
            specialReasonCodes: [],
          }}
        />
      );

      expect(screen.getByText("Selected exams (1)")).toBeTruthy();
      expect(screen.getByText("CT Head (CTH)")).toBeTruthy();

      fireEvent.change(screen.getByPlaceholderText("Search available exams"), { target: { value: "abdomen" } });

      expect(screen.getByText("CT Head (CTH)")).toBeTruthy();
      expect(screen.getByLabelText("CT Abdomen")).toBeTruthy();
      expect(screen.queryByLabelText("CT Chest")).toBeNull();

      fireEvent.click(screen.getByRole("button", { name: "Save Draft" }));

      expect(onSave).toHaveBeenCalledTimes(1);
      expect((savedSnapshot as PolicySnapshotDto | null)?.examTypeRules[0]?.examTypeIds).toEqual([101]);
    });

    it("requires confirmation before clearing selected exam restriction exams", () => {
      const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
      render(
        <PolicyDraftEditor
          isSaving={false}
          onSave={async () => {}}
          snapshot={{
            categoryDailyLimits: [],
            modalityBlockedRules: [],
            examTypeRules: [
              {
                id: 1,
                modalityId: 1,
                ruleType: "specific_date",
                effectMode: "restriction_overridable",
                specificDate: null,
                startDate: null,
                endDate: null,
                weekday: null,
                alternateWeeks: false,
                recurrenceAnchorDate: null,
                examTypeIds: [101],
                title: null,
                notes: null,
                isActive: true,
              },
            ],
            examTypeSpecialQuotas: [],
            examMixQuotaRules: [],
            specialReasonCodes: [],
          }}
        />
      );

      fireEvent.click(screen.getByRole("button", { name: "Clear all" }));

      expect(confirm).toHaveBeenCalledWith("Clear all selected exams from this exam restriction rule?");
      expect(screen.getByText("CT Head (CTH)")).toBeTruthy();
    });
  });

  describe("Exam mix quota groups section", () => {
    it("shows selected inactive exams after load when no active options are available", () => {
      render(
        <PolicyDraftEditor
          isSaving={false}
          onSave={async () => {}}
          displayLookups={{
            modalities: [],
            examTypes: [
              { id: 201, modalityId: 99, name: "Legacy MRI", nameAr: null, nameEn: "Legacy MRI", code: "LMRI", isActive: false },
            ],
            users: [],
          }}
          snapshot={{
            categoryDailyLimits: [],
            modalityBlockedRules: [],
            examTypeRules: [],
            examTypeSpecialQuotas: [],
            examMixQuotaRules: [
              {
                id: 1,
                modalityId: 99,
                title: null,
                ruleType: "specific_date",
                specificDate: "2027-01-01",
                startDate: null,
                endDate: null,
                weekday: null,
                alternateWeeks: false,
                recurrenceAnchorDate: null,
                dailyLimit: 1,
                examTypeIds: [201],
                isActive: true,
              },
            ],
            specialReasonCodes: [],
          }}
        />
      );

      expect(screen.getByText("Exam mix group #1")).toBeTruthy();
      expect(screen.getByText("Selected exams (1)")).toBeTruthy();
      expect(screen.getByText("Legacy MRI (LMRI) (inactive)")).toBeTruthy();
      expect(screen.getByText(/No active exam types available to add for/)).toBeTruthy();
      expect(screen.queryByText(/No exam types configured for/)).toBeNull();
    });

    it("shows 'Select a modality first.' when no modality is selected", () => {
      render(
        <PolicyDraftEditor
          isSaving={false}
          onSave={async () => {}}
          snapshot={{
            categoryDailyLimits: [],
            modalityBlockedRules: [],
            examTypeRules: [],
            examTypeSpecialQuotas: [],
            examMixQuotaRules: [
              {
                id: 1,
                modalityId: 0,
                title: null,
                ruleType: "specific_date",
                specificDate: null,
                startDate: null,
                endDate: null,
                weekday: null,
                alternateWeeks: false,
                recurrenceAnchorDate: null,
                dailyLimit: 1,
                examTypeIds: [],
                isActive: true,
              },
            ],
            specialReasonCodes: [],
          }}
        />
      );

      expect(screen.getByText("Select a modality first.")).toBeTruthy();
    });

    it("shows modality-aware empty-state when modality has no exam types", () => {
      render(
        <PolicyDraftEditor
          isSaving={false}
          onSave={async () => {}}
          snapshot={{
            categoryDailyLimits: [],
            modalityBlockedRules: [],
            examTypeRules: [],
            examTypeSpecialQuotas: [],
            examMixQuotaRules: [
              {
                id: 1,
                modalityId: 99,
                title: null,
                ruleType: "specific_date",
                specificDate: null,
                startDate: null,
                endDate: null,
                weekday: null,
                alternateWeeks: false,
                recurrenceAnchorDate: null,
                dailyLimit: 1,
                examTypeIds: [],
                isActive: true,
              },
            ],
            specialReasonCodes: [],
          }}
        />
      );

      const emptyState = screen.getByText(/No active exam types available to add for/);
      expect(emptyState).toBeTruthy();
    });

    it("shows exam type checkboxes when modality has exam types", () => {
      render(
        <PolicyDraftEditor
          isSaving={false}
          onSave={async () => {}}
          snapshot={{
            categoryDailyLimits: [],
            modalityBlockedRules: [],
            examTypeRules: [],
            examTypeSpecialQuotas: [],
            examMixQuotaRules: [
              {
                id: 1,
                modalityId: 1,
                title: null,
                ruleType: "specific_date",
                specificDate: null,
                startDate: null,
                endDate: null,
                weekday: null,
                alternateWeeks: false,
                recurrenceAnchorDate: null,
                dailyLimit: 1,
                examTypeIds: [],
                isActive: true,
              },
            ],
            specialReasonCodes: [],
          }}
        />
      );

      expect(screen.getByText("CT Head")).toBeTruthy();
      expect(screen.getByText("CT Chest")).toBeTruthy();
    });

    it("shows readable card header and bulk action parity", () => {
      render(
        <PolicyDraftEditor
          isSaving={false}
          onSave={async () => {}}
          snapshot={{
            categoryDailyLimits: [],
            modalityBlockedRules: [],
            examTypeRules: [],
            examTypeSpecialQuotas: [],
            examMixQuotaRules: [
              {
                id: 1,
                modalityId: 1,
                title: null,
                ruleType: "specific_date",
                specificDate: "2027-01-01",
                startDate: null,
                endDate: null,
                weekday: null,
                alternateWeeks: false,
                recurrenceAnchorDate: null,
                dailyLimit: 2,
                examTypeIds: [],
                isActive: true,
              },
            ],
            specialReasonCodes: [],
          }}
        />
      );

      expect(screen.getByText("Exam mix group #1")).toBeTruthy();
      expect(screen.getByText("Selected exams (0)")).toBeTruthy();
      expect(screen.getByRole("button", { name: "Select all" })).toBeTruthy();
      expect(screen.getByRole("button", { name: "Clear all" })).toBeTruthy();
    });

    it("selects and confirms clearing all exam mix group exams", () => {
      const confirm = vi.spyOn(window, "confirm").mockReturnValue(true);
      render(
        <PolicyDraftEditor
          isSaving={false}
          onSave={async () => {}}
          snapshot={{
            categoryDailyLimits: [],
            modalityBlockedRules: [],
            examTypeRules: [],
            examTypeSpecialQuotas: [],
            examMixQuotaRules: [
              {
                id: 1,
                modalityId: 1,
                title: null,
                ruleType: "specific_date",
                specificDate: null,
                startDate: null,
                endDate: null,
                weekday: null,
                alternateWeeks: false,
                recurrenceAnchorDate: null,
                dailyLimit: 1,
                examTypeIds: [],
                isActive: true,
              },
            ],
            specialReasonCodes: [],
          }}
        />
      );

      fireEvent.click(screen.getByRole("button", { name: "Select all" }));
      expect((screen.getByLabelText("CT Head") as HTMLInputElement).checked).toBe(true);
      expect((screen.getByLabelText("CT Chest") as HTMLInputElement).checked).toBe(true);

      fireEvent.click(screen.getByRole("button", { name: "Clear all" }));

      expect(confirm).toHaveBeenCalledWith("Clear all selected exams from this exam mix group?");
      expect((screen.getByLabelText("CT Head") as HTMLInputElement).checked).toBe(false);
      expect((screen.getByLabelText("CT Chest") as HTMLInputElement).checked).toBe(false);
    });
  });
});
