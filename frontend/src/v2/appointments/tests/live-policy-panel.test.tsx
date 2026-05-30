import { render, screen } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import { LivePolicyPanel } from "../components/live-policy-panel";

vi.mock("@/providers/language-provider", () => ({
  useLanguage: () => ({ language: "en" }),
}));

describe("LivePolicyPanel", () => {
  it("renders exam mix quota groups section", () => {
    render(
      <LivePolicyPanel
        snapshot={{
          categoryDailyLimits: [],
          modalityBlockedRules: [],
          examTypeRules: [],
          examTypeSpecialQuotas: [],
          examMixQuotaRules: [
            {
              id: 1,
              modalityId: 7,
              title: "Brain MRI",
              ruleType: "specific_date",
              specificDate: "2027-01-01",
              startDate: null,
              endDate: null,
              weekday: null,
              alternateWeeks: false,
              recurrenceAnchorDate: null,
              dailyLimit: 2,
              examTypeIds: [11, 12],
              isActive: true,
            },
          ],
          specialReasonCodes: [],
        }}
      />
    );

    expect(screen.getAllByText(/Exam mix quota groups/).length).toBeGreaterThan(0);
    expect(screen.getByText("Brain MRI")).toBeTruthy();
    expect(screen.getByText("Selected exams (2)")).toBeTruthy();
    expect(screen.getByText("Unknown exam type ID 11")).toBeTruthy();
  });

  it("shows section counts, resolved chips, inactive markers, and warning summary", () => {
    render(
      <LivePolicyPanel
        snapshot={{
          categoryDailyLimits: [
            { id: 1, modalityId: 7, caseCategory: "oncology", dailyLimit: 2, isActive: true },
            { id: 2, modalityId: 99, caseCategory: "non_oncology", dailyLimit: 1, isActive: true },
          ],
          modalityBlockedRules: [],
          examTypeRules: [
            {
              id: 3,
              modalityId: 7,
              ruleType: "specific_date",
              effectMode: "hard_restriction",
              specificDate: "2027-01-01",
              startDate: null,
              endDate: null,
              weekday: null,
              alternateWeeks: false,
              recurrenceAnchorDate: null,
              title: null,
              notes: null,
              examTypeIds: [11, 12],
              isActive: true,
            },
          ],
          examTypeSpecialQuotas: [
            { id: 4, examTypeId: 13, dailyExtraSlots: 1, allowedUserIds: [20, 21], isActive: true },
          ],
          examMixQuotaRules: [],
          specialReasonCodes: [],
        }}
        displayLookups={{
          modalities: [{ id: 7, name: "MRI", nameAr: "MRI AR", nameEn: "MRI", code: "MR", isActive: false }],
          examTypes: [
            { id: 11, name: "Brain MRI", nameAr: "Brain MRI AR", nameEn: "Brain MRI", code: "BMRI", modalityId: 7, isActive: false },
            { id: 13, name: "Spine MRI", nameAr: "Spine MRI AR", nameEn: "Spine MRI", code: "SMRI", modalityId: 7, isActive: true },
          ],
          users: [{ id: 20, username: "supervisor", fullName: "Supervisor User", role: "supervisor", isActive: false }],
        }}
      />
    );

    expect(screen.getAllByText(/Daily category limits/).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/Exam restriction rules/).length).toBeGreaterThan(0);
    expect(screen.getByText("Selected exams (2)")).toBeTruthy();
    expect(screen.getByText(/Live policy warnings/)).toBeTruthy();
    expect(screen.getAllByText("MRI (MR) (inactive)").length).toBeGreaterThan(0);
    expect(screen.getByText("Unknown modality ID 99")).toBeTruthy();
    expect(screen.getByText("Brain MRI (BMRI) (inactive)")).toBeTruthy();
    expect(screen.getByText("Unknown exam type ID 12")).toBeTruthy();
    expect(screen.getByText("Spine MRI (SMRI)")).toBeTruthy();
    expect(screen.getByText("Supervisor User (supervisor) (inactive), Unknown user ID 21")).toBeTruthy();
    expect(screen.getAllByText(/inactive modality MRI/).length).toBeGreaterThan(0);
    expect(screen.getByText(/unknown exam type reference 12/)).toBeTruthy();
  });

  it("resolves live policy references when display lookup ids are string-backed", () => {
    render(
      <LivePolicyPanel
        snapshot={{
          categoryDailyLimits: [
            { id: 1, modalityId: 7, caseCategory: "oncology", dailyLimit: 2, isActive: true },
          ],
          modalityBlockedRules: [],
          examTypeRules: [],
          examTypeSpecialQuotas: [
            { id: 4, examTypeId: 13, dailyExtraSlots: 1, allowedUserIds: [20], isActive: true },
          ],
          examMixQuotaRules: [
            {
              id: 5,
              modalityId: 7,
              title: "Mix",
              ruleType: "specific_date",
              specificDate: "2027-01-01",
              startDate: null,
              endDate: null,
              weekday: null,
              alternateWeeks: false,
              recurrenceAnchorDate: null,
              dailyLimit: 2,
              examTypeIds: [11, 12],
              isActive: true,
            },
          ],
          specialReasonCodes: [],
        }}
        displayLookups={{
          modalities: [{ id: "7" as unknown as number, name: "MRI", nameAr: "MRI AR", nameEn: "MRI", code: "MR", isActive: true }],
          examTypes: [
            { id: "11" as unknown as number, name: "Brain MRI", nameAr: "Brain MRI AR", nameEn: "Brain MRI", code: "BMRI", modalityId: 7, isActive: true },
            { id: "12" as unknown as number, name: "Spine MRI", nameAr: "Spine MRI AR", nameEn: "Spine MRI", code: "SMRI", modalityId: 7, isActive: true },
            { id: "13" as unknown as number, name: "Special MRI", nameAr: "Special MRI AR", nameEn: "Special MRI", code: "SPMRI", modalityId: 7, isActive: true },
          ],
          users: [{ id: "20" as unknown as number, username: "supervisor", fullName: "Supervisor User", role: "supervisor", isActive: true }],
        }}
      />
    );

    expect(screen.getAllByText("MRI (MR)").length).toBeGreaterThan(0);
    expect(screen.getByText("Brain MRI (BMRI)")).toBeTruthy();
    expect(screen.getByText("Spine MRI (SMRI)")).toBeTruthy();
    expect(screen.getByText("Special MRI (SPMRI)")).toBeTruthy();
    expect(screen.getByText("Supervisor User (supervisor)")).toBeTruthy();
  });

  it("uses human-readable labels for prioritized rule fields", () => {
    render(
      <LivePolicyPanel
        snapshot={{
          categoryDailyLimits: [],
          modalityBlockedRules: [],
          examTypeRules: [
            {
              id: 1,
              modalityId: 7,
              ruleType: "weekly_recurrence",
              effectMode: "restriction_overridable",
              specificDate: null,
              startDate: null,
              endDate: null,
              weekday: 1,
              alternateWeeks: false,
              recurrenceAnchorDate: null,
              examTypeIds: [11],
              title: null,
              notes: null,
              isActive: true,
            },
          ],
          examMixQuotaRules: [
            {
              id: 2,
              modalityId: 7,
              title: null,
              ruleType: "date_range",
              specificDate: null,
              startDate: "2027-01-01",
              endDate: "2027-01-31",
              weekday: null,
              alternateWeeks: false,
              recurrenceAnchorDate: null,
              dailyLimit: 1,
              examTypeIds: [11],
              isActive: true,
            },
          ],
          examTypeSpecialQuotas: [],
          specialReasonCodes: [],
        }}
        displayLookups={{
          modalities: [{ id: 7, name: "MRI", nameAr: "MRI AR", nameEn: "MRI", code: "MR", isActive: true }],
          examTypes: [{ id: 11, name: "Brain MRI", nameAr: "Brain MRI AR", nameEn: "Brain MRI", code: "BMRI", modalityId: 7, isActive: true }],
          users: [],
        }}
      />
    );

    expect(screen.getByText("Weekly recurrence")).toBeTruthy();
    expect(screen.getByText("Date range")).toBeTruthy();
    expect(screen.getByText("Supervisor-overridable restriction")).toBeTruthy();
    expect(screen.queryByText("weekly_recurrence")).toBeNull();
    expect(screen.queryByText("restriction_overridable")).toBeNull();
  });
});
