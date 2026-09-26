import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter } from "react-router-dom";
import type { TeachingCatalog } from "../api/teaching-api";
import { TeachingProgressPage } from "../pages/teaching-progress-page";

const progressApi = vi.hoisted(() => ({
  fetchCatalog: vi.fn(),
  fetchProgress: vi.fn(),
  fetchBreakdown: vi.fn(),
  fetchCycles: vi.fn(),
  fetchPreview: vi.fn(),
  reset: vi.fn(),
}));

vi.mock("../api/teaching-api", () => ({
  fetchTeachingCatalog: progressApi.fetchCatalog,
  fetchTeachingProgress: progressApi.fetchProgress,
  fetchTeachingProgressBreakdown: progressApi.fetchBreakdown,
  fetchTeachingProgressCycles: progressApi.fetchCycles,
  fetchTeachingProgressPreview: progressApi.fetchPreview,
  resetTeachingProgress: progressApi.reset,
}));

function catalogItem(code: string, label: string, parentCode?: string) {
  return { code, label, description: "", ...(parentCode ? { parentCode } : {}), active: true, sortOrder: 1 };
}

const catalog: TeachingCatalog = {
  schemaVersion: 1,
  specialties: [catalogItem("radiology", "Radiology")],
  domains: [catalogItem("neuroradiology", "Neuroradiology"), catalogItem("chest", "Chest")],
  topics: [catalogItem("brain-tumors", "Brain Tumors", "neuroradiology"), catalogItem("stroke", "Stroke", "neuroradiology")],
  subtopics: [],
  modalities: [catalogItem("CT", "CT"), catalogItem("MRI", "MRI")],
  competencies: [catalogItem("diagnosis", "Diagnosis")],
  trainingLevels: [],
  difficulties: [],
  tags: [catalogItem("rano", "RANO")],
  supportedQuestionTypes: [],
  supportedSourceTypes: [],
  supportedProvenanceRelationships: [],
};

const summary = {
  questionBank: { code: "radiology-main", publishedQuestions: 100 },
  currentCycle: { attempted: 72, eligible: 100, correct: 58, incorrect: 14, unseen: 28, completionPercent: 72, accuracyPercent: 80.6, marked: 3 },
  lifetime: { uniqueAttempted: 83, totalAttempts: 117, firstPassCorrect: 56, firstPassAttempted: 83, firstPassAccuracyPercent: 67.5, averageAnswerTimeMs: 35000 },
};

const domainBreakdown = {
  questionBank: "radiology-main", dimension: "domain" as const,
  items: [{ code: "neuroradiology", label: "Neuroradiology", eligible: 60, attempted: 44, correct: 36, incorrect: 8, unseen: 16,
    completionPercent: 73.3, accuracyPercent: 81.8, firstPassAttempted: 51, firstPassCorrect: 36, firstPassAccuracyPercent: 70.6,
    averageAnswerTimeMs: 32000, timedAttemptCount: 51 }],
};

const cycles = {
  questionBank: "radiology-main", scope: { type: "bank", code: "radiology-main", label: "Radiology Question Bank" },
  items: [
    { id: "current", cycleNumber: 2, startedAt: "2026-09-26T10:00:00.000Z", endedAt: null, eligible: 100, attempted: 72, correct: 58, incorrect: 14, completionPercent: 72, accuracyPercent: 80.6, current: true },
    { id: "closed", cycleNumber: 1, startedAt: "2026-01-01T10:00:00.000Z", endedAt: "2026-09-26T09:59:59.000Z", eligible: 96, attempted: 90, correct: 60, incorrect: 30, completionPercent: 93.8, accuracyPercent: 66.7, current: false },
  ],
};

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  const view = render(<QueryClientProvider client={client}><MemoryRouter><TeachingProgressPage /></MemoryRouter></QueryClientProvider>);
  return { ...view, client };
}

describe("Teaching Progress page", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal("crypto", { randomUUID: () => "b3b26f5e-d8e3-4a72-93fb-251280a50110" });
    progressApi.fetchCatalog.mockResolvedValue(catalog);
    progressApi.fetchProgress.mockResolvedValue(summary);
    progressApi.fetchBreakdown.mockResolvedValue(domainBreakdown);
    progressApi.fetchCycles.mockResolvedValue(cycles);
    progressApi.fetchPreview.mockResolvedValue({
      questionBank: "radiology-main", scope: { type: "domain", code: "neuroradiology", label: "Neuroradiology" },
      eligibleQuestionCount: 60, attempted: 44, correct: 36, incorrect: 8, unseen: 16, completionPercent: 73.3,
      accuracyPercent: 81.8, marked: 2, activeSessionCount: 1, activeSessionQuestionCount: 4,
    });
    progressApi.reset.mockResolvedValue({
      questionBank: "radiology-main", scope: { type: "domain", code: "neuroradiology", label: "Neuroradiology" },
      eligibleQuestionCount: 60, attempted: 0, correct: 0, incorrect: 0, unseen: 60, completionPercent: 0,
      accuracyPercent: null, marked: 2, cycleNumber: 3, startedAt: "2026-09-26T11:00:00.000Z", alreadyApplied: false,
    });
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it("shows current-cycle and lifetime statistics separately with sample counts and closed history", async () => {
    renderPage();
    expect(await screen.findByText("72 / 100")).toBeTruthy();
    expect(screen.getByText("Current-cycle accuracy")).toBeTruthy();
    expect(screen.getByText("80.6%")).toBeTruthy();
    expect(screen.getByText("First-pass accuracy")).toBeTruthy();
    expect(screen.getByText("67.5%")).toBeTruthy();
    const row = await screen.findByRole("row", { name: /Neuroradiology/ });
    expect(within(row).getByText("36 / 44 · 81.8%")).toBeTruthy();
    expect(within(row).getByText("36 / 51 · 70.6%")).toBeTruthy();
    expect(await screen.findByText("Cycle 1")).toBeTruthy();
    expect(screen.getByText(/Previous attempts, sessions, bookmarks, and notes stay in your history/)).toBeTruthy();
  });

  it("switches dimensions and drills into topics with a live domain filter", async () => {
    renderPage();
    await screen.findByRole("row", { name: /Neuroradiology/ });
    fireEvent.change(screen.getByLabelText("Analyze by"), { target: { value: "topic" } });
    fireEvent.change(screen.getByLabelText("Domain"), { target: { value: "neuroradiology" } });
    await waitFor(() => expect(progressApi.fetchBreakdown).toHaveBeenLastCalledWith("topic", { questionBank: "radiology-main", domain: "neuroradiology" }));
    fireEvent.change(screen.getByLabelText("Analyze by"), { target: { value: "tag" } });
    fireEvent.change(screen.getByLabelText("Find tags"), { target: { value: "RANO" } });
    await waitFor(() => expect(progressApi.fetchBreakdown).toHaveBeenLastCalledWith("tag", { questionBank: "radiology-main", search: "RANO" }));
  });

  it("previews scope and active-session warning before a history-preserving reset", async () => {
    const { client } = renderPage();
    const unseenKey = ["teaching", "qbank-availability", { questionState: "unseen" }];
    client.setQueryData(unseenKey, { available: 0, questionState: "unseen" });
    fireEvent.click(await screen.findByRole("button", { name: "Reset progress" }));
    fireEvent.change(screen.getByLabelText("Scope"), { target: { value: "domain" } });
    fireEvent.change(screen.getByLabelText("Domain"), { target: { value: "neuroradiology" } });

    const dialog = await screen.findByRole("dialog");
    expect(await within(dialog).findByText(/60 published questions · 44 attempted this cycle · 81.8% current accuracy/)).toBeTruthy();
    expect(within(dialog).getByText(/active session containing 4 question\(s\)/i)).toBeTruthy();
    expect(within(dialog).getByText(/Previous attempts, session history, bookmarks, and personal notes will not be deleted/)).toBeTruthy();
    fireEvent.click(within(dialog).getByRole("button", { name: "Start new cycle" }));

    await waitFor(() => expect(progressApi.reset).toHaveBeenCalledWith({
      questionBank: "radiology-main", scope: { type: "domain", code: "neuroradiology" }, idempotencyKey: "b3b26f5e-d8e3-4a72-93fb-251280a50110",
    }));
    await waitFor(() => expect(client.getQueryCache().find({ queryKey: unseenKey })?.state.isInvalidated).toBe(true));
    await waitFor(() => expect(progressApi.fetchProgress).toHaveBeenCalledTimes(2));
    expect(screen.queryByRole("dialog")).toBeNull();
  });
});
