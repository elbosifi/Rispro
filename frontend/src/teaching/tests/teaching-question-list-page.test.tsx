import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { TeachingQuestionListPage } from "../pages/teaching-question-list-page";

const listApi = vi.hoisted(() => ({ fetchCatalog: vi.fn(), fetchQuestions: vi.fn(), validateMatching: vi.fn(), publishMatching: vi.fn() }));
vi.mock("../api/teaching-api", () => ({
  fetchTeachingCatalog: listApi.fetchCatalog,
  fetchTeachingQuestions: listApi.fetchQuestions,
  validateTeachingQuestionMatching: listApi.validateMatching,
  validateAndPublishTeachingQuestionMatching: listApi.publishMatching,
}));

vi.mock("../auth/teaching-auth-context", () => ({
  useTeachingAuth: () => ({ identity: { permissions: ["teaching.access", "teaching.author", "teaching.publish"] } }),
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

  it("validates every matching question with one request, then confirms publication using server counts", async () => {
    listApi.fetchCatalog.mockResolvedValue(catalog);
    listApi.fetchQuestions.mockResolvedValueOnce({
      ...listResponse,
      items: [{ ...listResponse.items[0]!, validation: null }],
    });
    listApi.fetchQuestions.mockResolvedValue({
      ...listResponse,
      items: [{ ...listResponse.items[0]!, validation: { classification: "valid", errorCount: 0, warningCount: 0 } }],
    });
    listApi.validateMatching.mockResolvedValue({ scopeFingerprint: "scope-draft-neuro", total: 21, draft: 21, inReview: 0, published: 0, retired: 0, valid: 17, validWithWarnings: 2, invalid: 2, conflicts: 1, eligibleForPublish: 19, questions: [] });
    listApi.publishMatching.mockResolvedValue({ requested: 21, published: 19, warnings: 2, invalid: 2, conflicts: 1, alreadyPublished: 0, requiresReview: 0, retired: 0, failed: 0, results: [] });
    renderList("/teaching/admin/questions?status=draft&tagCode=neuro&page=2");

    expect(await screen.findByText("Not validated")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Validate all matching" }));
    await waitFor(() => expect(listApi.validateMatching).toHaveBeenCalledWith({ status: "draft", tagCode: "neuro" }));
    expect(await screen.findByText("Matched 21: 17 valid, 2 with warnings, 2 invalid.")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Validate & publish all eligible (19)" }));
    expect(await screen.findByText("21 questions", { selector: "strong" })).toBeTruthy();
    expect(screen.getByText("2 questions have warnings.")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Publish 19 eligible questions" }));
    await waitFor(() => expect(listApi.publishMatching).toHaveBeenCalledWith({ status: "draft", tagCode: "neuro" }, "scope-draft-neuro"));
    expect(await screen.findByText("21 matched: 19 published, 2 published with warnings, 2 invalid / remain Draft, 1 conflicts, 0 already published.")).toBeTruthy();
  });

  it("keeps invalid questions and transient conflicts discoverable from the bulk operation result", async () => {
    listApi.fetchCatalog.mockResolvedValue(catalog);
    listApi.fetchQuestions.mockResolvedValue(listResponse);
    listApi.validateMatching.mockResolvedValue({ scopeFingerprint: "scope-attention", total: 2, draft: 2, inReview: 0, published: 0, retired: 0, valid: 0, validWithWarnings: 0, invalid: 1, conflicts: 1, eligibleForPublish: 0, questions: [
      { questionId: 12, externalId: "INVALID-12", stemPreview: "", revisionId: 112, revisionVersion: 1, revisionStatus: "draft", validationStatus: "invalid", eligibleForPublish: false, errors: [], warnings: [] },
      { questionId: 13, externalId: "CONFLICT-13", stemPreview: "", revisionId: 113, revisionVersion: 1, revisionStatus: "draft", validationStatus: null, eligibleForPublish: false, errors: [], warnings: [], publishStatus: "conflict" },
    ] });
    renderList();

    await screen.findByText("Not validated");
    fireEvent.click(screen.getByRole("button", { name: "Validate all matching" }));
    fireEvent.click(await screen.findByRole("button", { name: "View questions requiring attention" }));
    expect(screen.getByRole("link", { name: "INVALID-12" }).getAttribute("href")).toBe("/teaching/admin/questions/12");
    expect(screen.getByRole("link", { name: "CONFLICT-13" }).getAttribute("href")).toBe("/teaching/admin/questions/13");
  });

  it("invalidates a validated bulk scope after a matching filter changes and requires a new validation", async () => {
    listApi.fetchCatalog.mockResolvedValue(catalog);
    listApi.fetchQuestions.mockResolvedValue(listResponse);
    listApi.validateMatching
      .mockResolvedValueOnce({ scopeFingerprint: "scope-draft", total: 1, draft: 1, inReview: 0, published: 0, retired: 0, valid: 1, validWithWarnings: 0, invalid: 0, conflicts: 0, eligibleForPublish: 1, questions: [] })
      .mockResolvedValueOnce({ scopeFingerprint: "scope-published", total: 1, draft: 0, inReview: 0, published: 1, retired: 0, valid: 1, validWithWarnings: 0, invalid: 0, conflicts: 0, eligibleForPublish: 1, questions: [] });
    renderList("/teaching/admin/questions?status=draft");

    await screen.findByText("Not validated");
    fireEvent.click(screen.getByRole("button", { name: "Validate all matching" }));
    await screen.findByRole("button", { name: "Validate & publish all eligible (1)" });
    fireEvent.change(screen.getByLabelText("Status"), { target: { value: "published" } });
    await waitFor(() => expect((screen.getByRole("button", { name: "Validate & publish all eligible" }) as HTMLButtonElement).disabled).toBe(true));
    expect(listApi.publishMatching).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "Validate all matching" }));
    await screen.findByRole("button", { name: "Validate & publish all eligible (1)" });
    fireEvent.click(screen.getByRole("button", { name: "Validate & publish all eligible (1)" }));
    fireEvent.click(screen.getByRole("button", { name: "Publish 1 eligible questions" }));
    await waitFor(() => expect(listApi.publishMatching).toHaveBeenCalledWith({ status: "published" }, "scope-published"));
  });

  it("removes dependent taxonomy parameters when a parent filter changes", async () => {
    listApi.fetchCatalog.mockResolvedValue(catalog);
    listApi.fetchQuestions.mockResolvedValue(listResponse);
    renderList("/teaching/admin/questions?specialtyCode=radiology&domainCode=neuroradiology&topicCode=brain-tumors&subtopicCode=glioma");

    await screen.findByText("Not validated");
    fireEvent.change(screen.getByLabelText("Specialty"), { target: { value: "radiology" } });
    await waitFor(() => {
      const latestParams = listApi.fetchQuestions.mock.calls.at(-1)?.[0] as URLSearchParams;
      expect(latestParams.get("specialtyCode")).toBe("radiology");
      expect(latestParams.get("domainCode")).toBeNull();
      expect(latestParams.get("topicCode")).toBeNull();
      expect(latestParams.get("subtopicCode")).toBeNull();
    });
  });
});
