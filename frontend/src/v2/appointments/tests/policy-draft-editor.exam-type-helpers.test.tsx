import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { PolicyDraftEditor } from "../components/policy-draft-editor";

vi.mock("../api", () => ({
  useV2Lookups: () => ({
    data: { modalities: [{ id: "1" as unknown as number, name: "CT", code: "CT" }] },
    isLoading: false,
    isError: false,
  }),
  useV2ExamTypeCatalog: () => ({
    data: [
      { id: "101" as unknown as number, modalityId: "1" as unknown as number, name: "CT Head", code: "CTH" },
      { id: "102" as unknown as number, modalityId: "1" as unknown as number, name: "CT Chest", code: "CTC" },
    ],
    isLoading: false,
    isError: false,
  }),
}));

describe("PolicyDraftEditor exam type helper text", () => {
  describe("Exam date rules section", () => {
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
      expect(screen.getByText("Restricted exams")).toBeTruthy();
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

      const emptyState = screen.getByText(/No exam types configured for/);
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
      expect((screen.getByLabelText("CT Head") as HTMLInputElement).checked).toBe(false);
      expect((screen.getByLabelText("CT Chest") as HTMLInputElement).checked).toBe(false);
    });
  });

  describe("Exam mix quota groups section", () => {
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

      const emptyState = screen.getByText(/No exam types configured for/);
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
  });
});
