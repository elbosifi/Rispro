import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import type { TeachingCatalog, TeachingLearnerDashboard, TeachingLearnerQuestion, TeachingLearnerSession } from "../api/teaching-api";
import { TeachingDashboardPage } from "../pages/teaching-dashboard-page";
import { TeachingHistoryPage } from "../pages/teaching-history-page";
import { TeachingQbankPage } from "../pages/teaching-qbank-page";
import { TeachingSessionPage } from "../pages/teaching-session-page";

const learnerApi = vi.hoisted(() => ({
  fetchDashboard: vi.fn(),
  fetchHistory: vi.fn(),
  fetchCatalog: vi.fn(),
  fetchAvailability: vi.fn(),
  createSession: vi.fn(),
  fetchSession: vi.fn(),
  fetchQuestion: vi.fn(),
  submitAnswer: vi.fn(),
  saveExamResponse: vi.fn(),
  submitSession: vi.fn(),
  setBookmark: vi.fn(),
  saveNote: vi.fn(),
  clearNote: vi.fn(),
}));

vi.mock("../api/teaching-api", () => ({
  fetchTeachingLearnerDashboard: learnerApi.fetchDashboard,
  fetchTeachingSessionHistory: learnerApi.fetchHistory,
  fetchTeachingCatalog: learnerApi.fetchCatalog,
  fetchTeachingQuestionAvailability: learnerApi.fetchAvailability,
  createTeachingLearnerSession: learnerApi.createSession,
  fetchTeachingLearnerSession: learnerApi.fetchSession,
  fetchTeachingLearnerQuestion: learnerApi.fetchQuestion,
  submitTeachingLearnerAnswer: learnerApi.submitAnswer,
  saveTeachingLearnerExamResponse: learnerApi.saveExamResponse,
  submitTeachingLearnerSession: learnerApi.submitSession,
  setTeachingQuestionBookmark: learnerApi.setBookmark,
  saveTeachingQuestionNote: learnerApi.saveNote,
  clearTeachingQuestionNote: learnerApi.clearNote,
}));

function renderWithProviders(ui: React.ReactNode, path = "/") {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  const view = render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[path]}>{ui}</MemoryRouter>
    </QueryClientProvider>,
  );
  return { ...view, client };
}

function catalogItem(code: string, label: string, parentCode?: string) {
  return { code, label, description: "", ...(parentCode ? { parentCode } : {}), active: true, sortOrder: 1 };
}

function sessionFixture(status: "active" | "submitted", selectedOptionKey: string | null = null): TeachingLearnerSession {
  const isSubmitted = status === "submitted";
  return {
    id: 42, mode: "exam", status, questionCount: 2, timed: false, timeLimitSeconds: null, remainingSeconds: null,
    currentPosition: 1, startedAt: "2026-09-26T10:00:00.000Z", lastActivityAt: "2026-09-26T10:00:00.000Z",
    submittedAt: isSubmitted ? "2026-09-26T10:05:00.000Z" : null, filters: { questionState: "all" },
    questions: [{ position: 1, answered: Boolean(selectedOptionKey) }, { position: 2, answered: false }],
    progress: {
      total: 2, answered: selectedOptionKey ? 1 : 0, correct: isSubmitted ? 0 : null, incorrect: isSubmitted ? 1 : null,
      unanswered: selectedOptionKey ? 1 : 2, scorePercent: isSubmitted ? 0 : null, answeredAccuracy: isSubmitted ? 0 : null,
    },
  };
}

function questionFixture(submitted = false, selectedOptionKey: string | null = null): TeachingLearnerQuestion {
  return {
    session: { id: 42, mode: "exam", status: submitted ? "submitted" : "active", timed: false, timeLimitSeconds: null, remainingSeconds: null },
    position: 1, totalQuestions: 2, questionId: 501, externalId: "SYNTHETIC-501", type: "single_best_answer",
    stem: "Which answer is selected only after the learner submits?", case: null, images: [],
    options: [{ key: "A", text: "Alpha" }, { key: "B", text: "Beta" }],
    selectedOptionKey, answered: submitted || Boolean(selectedOptionKey), bookmarked: false, note: "",
    ...(submitted ? { feedback: {
      isCorrect: false, selectedOptionKey, correctOption: { key: "A", text: "Alpha" },
      explanation: { summary: "Synthetic explanation after submission.", teachingPoint: "Review the key finding.", furtherDiscussion: null },
      optionExplanations: [], references: [],
    } } : {}),
  };
}

const dashboardFixture: TeachingLearnerDashboard = {
  publishedQuestionCount: 12,
  progress: { attemptedQuestions: 3, unseenQuestions: 9, correctQuestions: 2, incorrectQuestions: 1, markedQuestions: 1 },
  recentSessions: [{
    id: 42, mode: "study", status: "active", questionCount: 5, timed: false, currentPosition: 2,
    startedAt: "2026-09-26T10:00:00.000Z", submittedAt: null,
    progress: { total: 5, answered: 1, correct: null, incorrect: null, unanswered: 4, scorePercent: null, answeredAccuracy: null },
  }],
  continueSession: {
    id: 42, mode: "study", status: "active", questionCount: 5, timed: false, currentPosition: 2,
    startedAt: "2026-09-26T10:00:00.000Z", submittedAt: null,
    progress: { total: 5, answered: 1, correct: null, incorrect: null, unanswered: 4, scorePercent: null, answeredAccuracy: null },
  },
};

const catalogFixture: TeachingCatalog = {
  schemaVersion: 1,
  specialties: [catalogItem("radiology", "Radiology"), catalogItem("cardiology", "Cardiology")],
  domains: [catalogItem("neuroradiology", "Neuroradiology", "radiology"), catalogItem("cardiac-imaging", "Cardiac imaging", "cardiology")],
  topics: [catalogItem("brain", "Brain", "neuroradiology"), catalogItem("heart", "Heart", "cardiac-imaging")],
  subtopics: [catalogItem("tumors", "Tumors", "brain"), catalogItem("valves", "Valves", "heart")],
  modalities: [catalogItem("MRI", "MRI")],
  competencies: [catalogItem("diagnosis", "Diagnosis")],
  trainingLevels: [catalogItem("junior", "Junior resident")],
  difficulties: [{ value: 3, code: "moderate", label: "Moderate", description: "", active: true, sortOrder: 1 }],
  tags: [catalogItem("oncology", "Oncology")],
  supportedQuestionTypes: ["single_best_answer"],
  supportedSourceTypes: [],
  supportedProvenanceRelationships: [],
};

describe("Teaching learner pages", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    learnerApi.fetchDashboard.mockResolvedValue(dashboardFixture);
    learnerApi.fetchHistory.mockResolvedValue({ items: [], pagination: { page: 1, pageSize: 20, total: 0 } });
    learnerApi.fetchCatalog.mockResolvedValue(catalogFixture);
    learnerApi.fetchAvailability.mockResolvedValue({ available: 12, questionState: "all" });
    learnerApi.createSession.mockResolvedValue({ sessionId: 77, questionCount: 4, mode: "exam", status: "active", timed: true, timeLimitSeconds: 1800, startedAt: "2026-09-26T10:00:00.000Z", firstPosition: 1 });
    learnerApi.fetchSession.mockResolvedValue(sessionFixture("active"));
    learnerApi.fetchQuestion.mockResolvedValue(questionFixture());
    learnerApi.saveExamResponse.mockImplementation(async (_id: number, _position: number, selected: string) => ({
      saved: true, submitted: false, session: sessionFixture("active", selected),
    }));
    learnerApi.submitSession.mockResolvedValue(sessionFixture("submitted", "B"));
    learnerApi.setBookmark.mockImplementation(async (questionId: number, marked: boolean) => ({ questionId, marked }));
    learnerApi.saveNote.mockImplementation(async (questionId: number, note: string) => ({ questionId, note }));
    learnerApi.clearNote.mockImplementation(async (questionId: number) => ({ questionId, cleared: true }));
  });

  afterEach(() => cleanup());

  it("shows learner progress and a direct resume link", async () => {
    renderWithProviders(<TeachingDashboardPage />);

    expect(await screen.findByText("Current cycle: 3 / 12 questions.")).toBeTruthy();
    expect(screen.getByText("Incorrect this cycle").nextElementSibling?.textContent).toBe("1");
    expect(screen.getByRole("link", { name: /resume/i }).getAttribute("href")).toBe("/teaching/qbank/session/42");
    expect(screen.getByRole("link", { name: /session history/i }).getAttribute("href")).toBe("/teaching/history");
  });

  it("creates a filtered timed Exam from the available active catalog", async () => {
    renderWithProviders(
      <Routes>
        <Route path="/teaching/qbank" element={<TeachingQbankPage />} />
        <Route path="/teaching/qbank/session/:sessionId" element={<p>Session created</p>} />
      </Routes>,
      "/teaching/qbank",
    );

    await screen.findByText("Available questions: 12");
    fireEvent.change(screen.getByLabelText("Specialty"), { target: { value: "radiology" } });
    await waitFor(() => expect(learnerApi.fetchAvailability).toHaveBeenLastCalledWith({ specialty: "radiology", questionState: "all" }));
    const topicOptions = Array.from((screen.getByLabelText("Topic") as HTMLSelectElement).options).map((option) => option.value);
    expect(topicOptions).toContain("brain");
    expect(topicOptions).not.toContain("heart");
    fireEvent.change(screen.getByLabelText("Mode"), { target: { value: "exam" } });
    fireEvent.change(screen.getByLabelText("Number of questions"), { target: { value: "4" } });
    fireEvent.click(screen.getByRole("checkbox", { name: "Timed exam" }));
    fireEvent.change(screen.getByLabelText("Time limit (minutes)"), { target: { value: "30" } });
    fireEvent.click(screen.getByRole("button", { name: "Start session" }));

    await waitFor(() => expect(learnerApi.createSession.mock.calls[0]?.[0]).toEqual({
      mode: "exam", questionCount: 4, timed: true, timeLimitSeconds: 1800,
      filters: { specialty: "radiology", questionState: "all" },
    }));
  });

  it("keeps Exam answers editable and withholds feedback until final submission", async () => {
    let selectedDraft: string | null = null;
    let submitted = false;
    learnerApi.saveExamResponse.mockImplementation(async (_id: number, _position: number, selected: string) => {
      selectedDraft = selected;
      return { saved: true, submitted: false, session: sessionFixture("active", selected) };
    });
    learnerApi.fetchSession.mockImplementation(async () => sessionFixture(submitted ? "submitted" : "active", selectedDraft));
    learnerApi.fetchQuestion.mockImplementation(async () => questionFixture(submitted, selectedDraft));
    learnerApi.submitSession.mockImplementation(async () => {
      submitted = true;
      return sessionFixture("submitted", selectedDraft);
    });

    renderWithProviders(
      <Routes><Route path="/teaching/qbank/session/:sessionId" element={<TeachingSessionPage />} /></Routes>,
      "/teaching/qbank/session/42",
    );

    await screen.findByText("Which answer is selected only after the learner submits?");
    const answerChoices = screen.getAllByRole("radio");
    fireEvent.click(answerChoices[0]!);
    await waitFor(() => expect(learnerApi.saveExamResponse).toHaveBeenLastCalledWith(42, 1, "A"));
    const afterFirstAnswer = screen.getAllByRole("radio");
    expect(afterFirstAnswer[1]!.matches(":disabled")).toBe(false);
    fireEvent.click(afterFirstAnswer[1]!);
    await waitFor(() => expect(learnerApi.saveExamResponse).toHaveBeenLastCalledWith(42, 1, "B"));
    expect(screen.queryByRole("heading", { name: "Correct" })).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Mark question" }));
    await waitFor(() => expect(learnerApi.setBookmark).toHaveBeenCalledWith(501, true));
    fireEvent.click(screen.getByText("Personal note"));
    fireEvent.change(screen.getByRole("textbox", { name: "Personal note" }), { target: { value: "Private learner note" } });
    fireEvent.click(screen.getByRole("button", { name: "Save note" }));
    await waitFor(() => expect(learnerApi.saveNote).toHaveBeenCalledWith(501, "Private learner note"));

    fireEvent.click(screen.getByRole("button", { name: "Submit exam" }));
    const dialog = screen.getByRole("dialog");
    expect(within(dialog).getByText(/1 unanswered/)).toBeTruthy();
    fireEvent.click(within(dialog).getByRole("button", { name: "Submit exam" }));

    expect(await screen.findByRole("heading", { name: "Incorrect" })).toBeTruthy();
    expect(screen.getByText((_content, element) => element?.tagName === "P" && element.textContent === "Correct answer: A. Alpha")).toBeTruthy();
    expect(screen.getByText("Synthetic explanation after submission.")).toBeTruthy();
  });

  it("loads submitted feedback when the server expires a timed Exam", async () => {
    let expired = false;
    learnerApi.fetchSession.mockImplementation(async () => ({
      ...sessionFixture(expired ? "submitted" : "active", "B"),
      timed: true,
      timeLimitSeconds: 60,
      remainingSeconds: expired ? 0 : 1,
    }));
    learnerApi.fetchQuestion.mockImplementation(async () => questionFixture(expired, "B"));
    const { client } = renderWithProviders(
      <Routes><Route path="/teaching/qbank/session/:sessionId" element={<TeachingSessionPage />} /></Routes>,
      "/teaching/qbank/session/42",
    );

    await screen.findByText("Which answer is selected only after the learner submits?");
    expect(screen.queryByRole("heading", { name: "Incorrect" })).toBeNull();
    expired = true;
    act(() => client.setQueryData(["teaching", "session", 42], {
      ...sessionFixture("submitted", "B"), timed: true, timeLimitSeconds: 60, remainingSeconds: 0,
    }));

    expect(await screen.findByRole("heading", { name: "Incorrect" })).toBeTruthy();
    expect(learnerApi.fetchQuestion).toHaveBeenCalledTimes(2);
  });

  it("shows empty history with a path to create the first session", async () => {
    renderWithProviders(<TeachingHistoryPage />);

    expect(await screen.findByText("No sessions yet. Create a Study, Exam, or Review session to get started.")).toBeTruthy();
    expect(screen.getByText("Page 1 of 1 · 0 sessions")).toBeTruthy();
  });
});
