import { render, screen } from "@testing-library/react";
import { describe, it, expect } from "vitest";
import { LivePolicyPanel } from "../components/live-policy-panel";

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

    expect(screen.getByText("Exam mix quota groups")).toBeTruthy();
    expect(screen.getByText("Brain MRI")).toBeTruthy();
  });
});

