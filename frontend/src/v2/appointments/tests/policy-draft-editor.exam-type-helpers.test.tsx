import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { PolicyDraftEditor } from "../components/policy-draft-editor";

vi.mock("../api", () => ({
  useV2Lookups: () => ({
    data: { modalities: [{ id: 1, name: "CT", code: "CT" }] },
    isLoading: false,
    isError: false,
  }),
  useV2ExamTypeCatalog: () => ({
    data: [
      { id: 101, modalityId: 1, name: "CT Head", code: "CTH" },
      { id: 102, modalityId: 1, name: "CT Chest", code: "CTC" },
    ],
    isLoading: false,
    isError: false,
  }),
}));

describe("PolicyDraftEditor exam type helper text", () => {
  describe("Exam date rules section", () => {
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