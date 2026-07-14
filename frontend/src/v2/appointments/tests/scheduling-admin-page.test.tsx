import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { SchedulingAdminPage } from "../scheduling-admin-page";
import type { PolicyPreviewDto, PolicyStatusDto } from "../types";

const createDraftMock = vi.fn();
const saveDraftMock = vi.fn();
const publishDraftMock = vi.fn();
let policyStatus: PolicyStatusDto;
let policyPreview: PolicyPreviewDto | null;

vi.mock("@/providers/auth-provider", () => ({
  useAuth: () => ({ user: { id: 1, role: "supervisor" } }),
}));

vi.mock("@/providers/language-provider", () => ({
  useLanguage: () => ({ language: "en" }),
}));

vi.mock("@/lib/toast", () => ({
  pushToast: vi.fn(),
}));

vi.mock("../api", () => ({
  useV2PolicyStatus: () => ({ data: policyStatus, isError: false }),
  useV2CreatePolicyDraft: () => ({ mutateAsync: createDraftMock, isPending: false }),
  useV2SavePolicyDraft: () => ({ mutateAsync: saveDraftMock, isPending: false }),
  useV2PublishPolicyDraft: () => ({ mutateAsync: publishDraftMock, isPending: false }),
  useV2PolicyPreview: () => ({ data: policyPreview, isLoading: false }),
  useV2Lookups: () => ({ data: { modalities: [] }, isLoading: false, isError: false }),
  useV2ExamTypeCatalog: () => ({ data: [], isLoading: false, isError: false }),
  useV2PolicyUsers: () => ({ data: [], isLoading: false, isError: false }),
}));

function baseStatus(): PolicyStatusDto {
  return {
    policySet: { id: 1, key: "default", name: "Default" },
    published: {
      id: 10,
      policySetId: 1,
      versionNo: 3,
      status: "published",
      configHash: "publishedhash",
      changeNote: null,
      createdAt: "2027-01-01T00:00:00Z",
      publishedAt: "2027-01-01T00:00:00Z",
    },
    draft: {
      id: 11,
      policySetId: 1,
      versionNo: 4,
      status: "draft",
      configHash: "drafthash",
      changeNote: null,
      createdAt: "2027-01-02T00:00:00Z",
      publishedAt: null,
    },
    publishedSnapshot: {
      categoryDailyLimits: [],
      modalityBlockedRules: [],
      examTypeRules: [],
      examTypeSpecialQuotas: [],
      examMixQuotaRules: [],
      specialReasonCodes: [],
    },
    draftSnapshot: {
      categoryDailyLimits: [{ id: 1, modalityId: 1, caseCategory: "oncology", dailyLimit: 1, isActive: true }],
      modalityBlockedRules: [],
      examTypeRules: [],
      examTypeSpecialQuotas: [],
      examMixQuotaRules: [],
      specialReasonCodes: [],
    },
    displayLookups: { modalities: [], examTypes: [], users: [] },
  };
}

function renderPage() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <SchedulingAdminPage />
    </QueryClientProvider>
  );
}

describe("SchedulingAdminPage", () => {
  beforeEach(() => {
    policyStatus = baseStatus();
    policyPreview = {
      draftVersionId: 11,
      publishedVersionId: 10,
      addedRulesCount: 1,
      removedRulesCount: 0,
      modifiedRulesCount: 0,
      addedRules: [],
      removedRules: [],
      modifiedRules: [],
      warnings: [],
    };
  });

  it("shows clear section structure", () => {
    renderPage();

    expect(screen.getByRole("heading", { name: "Status" })).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Live Policy" })).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Working Draft" })).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Preview / Diff" })).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Advanced" })).toBeTruthy();
  });

  it("shows live and draft versions plus unpublished draft state", () => {
    renderPage();

    expect(screen.getByText("Live version: v3")).toBeTruthy();
    expect(screen.getByText("Draft version: v4")).toBeTruthy();
    expect(screen.getByText("Draft has unpublished changes")).toBeTruthy();
  });

  it("disables publish when no draft exists and shows a reason", () => {
    policyStatus = { ...baseStatus(), draft: null };

    renderPage();

    const publish = screen.getByRole("button", { name: "Publish Draft" }) as HTMLButtonElement;
    expect(publish.disabled).toBe(true);
    expect(screen.getByText("Create a draft before publishing.")).toBeTruthy();
  });

  it("disables publish when blocking validation errors exist and shows a reason", () => {
    policyStatus = baseStatus();
    policyStatus.draftSnapshot.examTypeRules = [{
      id: 2,
      modalityId: 1,
      ruleType: "specific_date",
      effectMode: "hard_restriction",
      specificDate: "2027-01-01",
      startDate: null,
      endDate: null,
      weekday: null,
      alternateWeeks: false,
      recurrenceAnchorDate: null,
      examTypeIds: [],
      title: null,
      notes: null,
      isActive: true,
    }];

    renderPage();

    const publish = screen.getByRole("button", { name: "Publish Draft" }) as HTMLButtonElement;
    expect(publish.disabled).toBe(true);
    expect(screen.getByText("Resolve blocking validation errors before publishing.")).toBeTruthy();
    expect(screen.getByText(/Active exam restriction rule must select at least one exam/)).toBeTruthy();
  });

  it("shows before-publishing validation, preview, and risk context", () => {
    policyStatus = baseStatus();
    policyStatus.publishedSnapshot.examTypeRules = [{
      id: 2,
      modalityId: 1,
      ruleType: "specific_date",
      effectMode: "restriction_overridable",
      specificDate: "2027-01-01",
      startDate: null,
      endDate: null,
      weekday: null,
      alternateWeeks: false,
      recurrenceAnchorDate: null,
      examTypeIds: [10],
      title: null,
      notes: null,
      isActive: true,
    }];
    policyStatus.draftSnapshot.examTypeRules = [{
      ...policyStatus.publishedSnapshot.examTypeRules[0]!,
      effectMode: "hard_restriction",
    }];
    policyStatus.displayLookups = {
      modalities: [{ id: 1, name: "MRI", nameAr: "MRI AR", nameEn: "MRI", code: "MR", isActive: true }],
      examTypes: [{ id: 10, name: "Brain MRI", nameAr: "Brain MRI AR", nameEn: "Brain MRI", code: "BMRI", modalityId: 1, isActive: true }],
      users: [],
    };

    renderPage();

    expect(screen.getByText("Before publishing")).toBeTruthy();
    expect(screen.getAllByText(/Validation:/).length).toBeGreaterThan(0);
    expect(screen.getByText(/1 added, 0 removed, 0 modified/)).toBeTruthy();
    expect(screen.getAllByText(/High-risk warnings:/).length).toBeGreaterThan(0);
    expect(screen.getByText("Publishing makes this draft the live policy.")).toBeTruthy();
  });
});
