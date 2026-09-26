import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { TeachingQuestionListPage } from "../pages/teaching-question-list-page";

const listApi = vi.hoisted(() => ({ fetchCatalog: vi.fn(), fetchQuestions: vi.fn(), validateSelection: vi.fn() }));
vi.mock("../api/teaching-api", () => ({
  fetchTeachingCatalog: listApi.fetchCatalog,
  fetchTeachingQuestions: listApi.fetchQuestions,
  validateTeachingQuestionSelection: listApi.validateSelection,
}));

vi.mock("../auth/teaching-auth-context", () => ({
  useTeachingAuth: () => ({ identity: { permissions: ["teaching.access", "teaching.author"] } }),
}));

const catalog = {
  schemaVersion: 1,
  specialties: [{ code: "radiology", label: "Radiology", description: "", active: true, sortOrder: 1 }],
  domains: [{ code: "neuroradiology", label: "Neuroradiology", description: "", parentCode: "radiology", active: true, sortOrder: 1 }],
  topics: [{ code: "brain-tumors", label: "Brain tumors", description: "", parentCode: "neuroradiology", active: true, sortOrder: 1 }],
  subtopics: [{ code: "glioma", label: "Glioma", description: "", parentCode: "brain-tumors", active: true, sortOrder: 1 }],
  modalities: [], competencies: [], trainingLevels: [], difficulties: [], tags: [], supportedQuestionTypes: [], supportedSourceTypes: [], supportedProvenanceRelationships: [],
};
const listResponse = {
  items: [{
    id: 12, externalId: "RAD-NEURO-012", questionBank: { code: "radiology-main", name: "Radiology Main" },
    revision: { id: 112, version: 1, revisionNumber: 3, status: "draft" as const, type: "single_best_answer" as const, stem: "Synthetic editorial question.", importBatchId: null },
    validation: null,
    classification: { specialty: { code: "radiology", label: "Radiology" }, domain: { code: "neuroradiology", label: "Neuroradiology" }, topic: { code: "brain-tumors", label: "Brain tumors" }, difficulty: 3, trainingLevel: { code: "junior_resident", label: "Junior resident" } },
    sourceTitle: "Teaching source", hasImage: false, imported: false, retiredAt: null,
    createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-02-01T00:00:00.000Z",
  }],
  pagination: { page: 1, pageSize: 20, total: 21, totalPages: 2, limit: 20, offset: 0 },
};

function renderList(path = "/teaching/admin/questions") {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={client}><MemoryRouter initialEntries={[path]}><Routes><Route path="/teaching/admin/questions" element={<TeachingQuestionListPage />} /></Routes></MemoryRouter></QueryClientProvider>);
}

describe("Teaching editorial question list", () => {
  afterEach(() => { cleanup(); vi.resetAllMocks(); });

  it("renders the server-backed editorial list and retains filters in the URL", async () => {
    listApi.fetchCatalog.mockResolvedValue(catalog);
    listApi.fetchQuestions.mockImplementation(async (params: URLSearchParams) => ({
      ...listResponse,
      pagination: { ...listResponse.pagination, page: Number(params.get("page") ?? 1), pageSize: Number(params.get("pageSize") ?? 20) },
    }));
    renderList();

    expect(await screen.findByRole("link", { name: "RAD-NEURO-012" })).toBeTruthy();
    expect(screen.getByText("21 questions · page 1 of 2")).toBeTruthy();
    expect(screen.getByText("Teaching source")).toBeTruthy();

    fireEvent.change(screen.getByLabelText("Status"), { target: { value: "draft" } });
    await waitFor(() => expect(listApi.fetchQuestions.mock.calls.length).toBeGreaterThanOrEqual(2));
    await waitFor(() => {
      const latestParams = listApi.fetchQuestions.mock.calls.at(-1)?.[0] as URLSearchParams;
      expect(latestParams.get("status")).toBe("draft");
      expect(latestParams.get("page")).toBe("1");
    });

    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    await waitFor(() => {
      const latestParams = listApi.fetchQuestions.mock.calls.at(-1)?.[0] as URLSearchParams;
      expect(latestParams.get("page")).toBe("2");
    });
  });

  it("validates the visible worklist page with one bulk request and shows the saved status", async () => {
    listApi.fetchCatalog.mockResolvedValue(catalog);
    listApi.fetchQuestions.mockResolvedValueOnce({
      ...listResponse,
      items: [{ ...listResponse.items[0]!, validation: null }],
    });
    listApi.fetchQuestions.mockResolvedValue({
      ...listResponse,
      items: [{ ...listResponse.items[0]!, validation: { classification: "valid", errorCount: 0, warningCount: 0 } }],
    });
    listApi.validateSelection.mockResolvedValue({ total: 1, draft: 1, inReview: 0, published: 0, retired: 0, valid: 1, validWithWarnings: 0, invalid: 0, conflicts: 0, questions: [] });
    renderList();

    expect(await screen.findByText("Not validated")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Validate current page" }));
    await waitFor(() => expect(listApi.validateSelection).toHaveBeenCalledWith([12]));
    expect(await screen.findByText("Validated 1 Drafts: 1 valid, 0 with warnings, 0 invalid.")).toBeTruthy();
    expect(await screen.findByText("Valid")).toBeTruthy();
  });
});
