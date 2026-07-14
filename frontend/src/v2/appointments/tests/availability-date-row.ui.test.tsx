import { render, screen } from "@testing-library/react";
import { beforeEach, describe, it, expect } from "vitest";
import { LanguageProvider } from "@/providers/language-provider-component";
import { AvailabilityDateRow } from "../components/AvailabilityDateRow";

function baseProps() {
  return {
    date: "2027-01-02",
    dayLabel: "Sat, Jan 2",
    status: "restricted" as const,
    bucketMode: "partitioned" as const,
    remainingCapacity: 1,
    dailyCapacity: 20,
    oncologyReserved: 10,
    oncologyFilled: 5,
    oncologyRemaining: 5,
    nonOncologyReserved: 10,
    nonOncologyFilled: 9,
    nonOncologyRemaining: 1,
    specialQuotaRemaining: null,
    examMixQuotaSummaries: [],
    primaryExamMixBlocking: null,
    reasonText: "",
    requiresSupervisorOverride: true,
    selected: false,
    onClick: () => undefined,
  };
}

function renderRow(props: Parameters<typeof AvailabilityDateRow>[0]) {
  return render(
    <LanguageProvider>
      <AvailabilityDateRow {...props} />
    </LanguageProvider>
  );
}

describe("AvailabilityDateRow exam-rule display", () => {
  beforeEach(() => {
    localStorage.setItem("rispro-language", "en");
  });

  it("renders matched exam-rule title and effect when provided", () => {
    renderRow({
      ...baseProps(),
      matchedExamRuleSummary: {
        ruleId: "201",
        title: "Brain MRI restriction",
        effectLabel: "Restricted unless supervisor approves",
        isBlocking: false,
      },
    });

    expect(
      screen.getByText("Exam rule: Brain MRI restriction (Restricted unless supervisor approves)")
    ).toBeTruthy();
  });

  it("uses generic reason text only as fallback when no matched exam-rule summary exists", () => {
    renderRow({
      ...baseProps(),
      reasonText: "Generic fallback reason",
      matchedExamRuleSummary: null,
    });

    expect(screen.getByText("Generic fallback reason")).toBeTruthy();
  });

  it("renders segmented capacity progress with category fill colors", () => {
    renderRow({
      ...baseProps(),
      matchedExamRuleSummary: null,
    });

    const progress = screen.getByLabelText("slot-capacity-progress");
    expect(progress).toBeTruthy();
    expect(progress.children.length).toBe(20);
    expect((progress.children[0] as HTMLElement).style.backgroundColor).toBe("var(--green)");
    expect((progress.children[9] as HTMLElement).style.backgroundColor).toBe("rgba(34, 197, 94, 0.5)");
    expect((progress.children[10] as HTMLElement).style.backgroundColor).toBe("var(--blue)");
    expect((progress.children[19] as HTMLElement).style.backgroundColor).toBe("rgba(59, 130, 246, 0.5)");
  });

  it("renders uncategorized slots in yellow shades when modality capacity exceeds category quotas", () => {
    renderRow({
      ...baseProps(),
      dailyCapacity: 24,
      remainingCapacity: 8,
      matchedExamRuleSummary: null,
    });

    const progress = screen.getByLabelText("slot-capacity-progress");
    expect(progress.children.length).toBe(24);
    expect((progress.children[20] as HTMLElement).style.backgroundColor).toBe("var(--amber)");
    expect((progress.children[23] as HTMLElement).style.backgroundColor).toBe("rgba(245, 158, 11, 0.5)");
  });

  it("keeps progress bar visible for blocked rows", () => {
    renderRow({
      ...baseProps(),
      status: "blocked",
      matchedExamRuleSummary: null,
    });

    expect(screen.getByLabelText("slot-capacity-progress")).toBeTruthy();
    expect(screen.getAllByText("Blocked").length).toBeGreaterThan(0);
  });
});
