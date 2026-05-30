import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { PolicyPreviewPanel } from "../components/policy-preview-panel";

describe("PolicyPreviewPanel", () => {
  it("shows preview counts, affected sections, and high-risk warnings", () => {
    render(
      <PolicyPreviewPanel
        isLoading={false}
        preview={{
          draftVersionId: 2,
          publishedVersionId: 1,
          addedRulesCount: 1,
          removedRulesCount: 2,
          modifiedRulesCount: 3,
          addedRules: [],
          removedRules: [],
          modifiedRules: [],
          warnings: ["Backend warning"],
        }}
        riskSummary={{
          affectedSections: ["Exam restriction rules", "Special quotas"],
          highRiskWarnings: [
            { section: "Exam restriction rules", ruleId: 10, message: "Exam selection cleared." },
          ],
        }}
      />
    );

    expect(screen.getByText(/Added:/)).toBeTruthy();
    expect(screen.getByText(/Removed:/)).toBeTruthy();
    expect(screen.getByText(/Modified:/)).toBeTruthy();
    expect(screen.getByText(/Exam restriction rules, Special quotas/)).toBeTruthy();
    expect(screen.getAllByText(/Backend warning/).length).toBeGreaterThan(0);
    expect(screen.getByText(/1 warning/)).toBeTruthy();
    expect(screen.getByText(/Exam selection cleared/)).toBeTruthy();
  });
});
