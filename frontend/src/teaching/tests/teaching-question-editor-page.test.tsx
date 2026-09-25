import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { TeachingQuestionEditorPage } from "../pages/teaching-question-editor-page";

const apiMocks = vi.hoisted(() => ({
  approve: vi.fn(), createCase: vi.fn(), createQuestion: vi.fn(), createRevision: vi.fn(), createReference: vi.fn(), createSource: vi.fn(),
  fetchCatalog: vi.fn(), fetchBatch: vi.fn(), fetchQuestion: vi.fn(), fetchBanks: vi.fn(), listCases: vi.fn(), listAssets: vi.fn(), listReferences: vi.fn(), listSources: vi.fn(),
  publish: vi.fn(), retire: vi.fn(), returnDraft: vi.fn(), submitReview: vi.fn(), validate: vi.fn(), updateDraft: vi.fn(),
  uploadAsset: vi.fn(),
}));

const authState = vi.hoisted(() => ({ identity: { identitySubject: "author-1", displayName: "Teaching Author", permissions: ["teaching.access", "teaching.author", "teaching.manage_sources"] } }));

vi.mock("../api/teaching-api", () => ({
  approveTeachingQuestionReview: apiMocks.approve,
  createTeachingCaseRequest: apiMocks.createCase,
  createTeachingQuestionRequest: apiMocks.createQuestion,
  createTeachingQuestionRevision: apiMocks.createRevision,
  createTeachingReferenceRequest: apiMocks.createReference,
  createTeachingSourceRequest: apiMocks.createSource,
  fetchTeachingCatalog: apiMocks.fetchCatalog,
  fetchTeachingImportBatch: apiMocks.fetchBatch,
  fetchTeachingQuestion: apiMocks.fetchQuestion,
  fetchTeachingQuestionBanks: apiMocks.fetchBanks,
  listTeachingCases: apiMocks.listCases,
  listTeachingAssets: apiMocks.listAssets,
  listTeachingReferences: apiMocks.listReferences,
  listTeachingSources: apiMocks.listSources,
  publishTeachingQuestion: apiMocks.publish,
  retireTeachingQuestion: apiMocks.retire,
  returnTeachingQuestionToDraft: apiMocks.returnDraft,
  submitTeachingQuestionForReview: apiMocks.submitReview,
  teachingAssetUrl: (id: number) => `/api/teaching/assets/${id}`,
  updateTeachingQuestionDraft: apiMocks.updateDraft,
  uploadTeachingAsset: apiMocks.uploadAsset,
  validateTeachingQuestionContent: apiMocks.validate,
}));

vi.mock("../auth/teaching-auth-context", () => ({ useTeachingAuth: () => ({ identity: authState.identity }) }));

const catalog = {
  schemaVersion: 1,
  specialties: [{ code: "radiology", label: "Radiology", description: "", active: true, sortOrder: 1 }],
  domains: [
    { code: "neuroradiology", label: "Neuroradiology", description: "", parentCode: "radiology", active: true, sortOrder: 1 },
    { code: "cardiothoracic", label: "Cardiothoracic", description: "", parentCode: "radiology", active: true, sortOrder: 2 },
  ],
  topics: [
    { code: "brain-tumors", label: "Brain tumors", description: "", parentCode: "neuroradiology", active: true, sortOrder: 1 },
    { code: "chest", label: "Chest", description: "", parentCode: "cardiothoracic", active: true, sortOrder: 2 },
  ],
  subtopics: [
    { code: "glioma", label: "Glioma", description: "", parentCode: "brain-tumors", active: true, sortOrder: 1 },
    { code: "lung-nodule", label: "Lung nodule", description: "", parentCode: "chest", active: true, sortOrder: 2 },
  ],
  modalities: [{ code: "MRI", label: "MRI", description: "", active: true, sortOrder: 1 }],
  competencies: [{ code: "diagnosis", label: "Diagnosis", description: "", active: true, sortOrder: 1 }],
  trainingLevels: [{ code: "junior_resident", label: "Junior resident", description: "", active: true, sortOrder: 1 }],
  difficulties: [1, 2, 3, 4, 5].map((value) => ({ value, code: String(value), label: `Level ${value}`, description: "", active: true, sortOrder: value })),
  tags: [{ code: "oncology", label: "Oncology", description: "", active: true, sortOrder: 1 }],
  supportedQuestionTypes: ["single_best_answer", "image_based_sba", "case_based_sba"],
  supportedSourceTypes: ["original", "textbook", "exam"],
  supportedProvenanceRelationships: ["original", "adapted", "unknown"],
};

const createdQuestion = {
  id: 55, externalId: "RAD-NEURO-055", questionBank: { code: "radiology-main", name: "Radiology Main" },
  specialtyCode: "radiology", createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z", retiredAt: null,
  revisions: [{
    id: 56, version: 1, revisionNumber: 1, status: "draft" as const, type: "single_best_answer" as const, stem: "Synthetic educational question.",
    classification: { specialty: { code: "radiology" }, domain: { code: "neuroradiology" }, topic: null, subtopic: null }, difficulty: 3,
    trainingLevel: "junior_resident", case: null,
    explanation: { summary: "Evidence summary.", teachingPoint: "Teaching point.", furtherDiscussion: null },
    options: [{ key: "A", text: "Answer A", isCorrect: false, explanation: null }, { key: "B", text: "Answer B", isCorrect: true, explanation: null }],
    modalities: [], competencies: [], tags: [], sources: [], references: [], assets: [],
    authorship: { kind: "human_authored", modelName: null },
    audit: { createdBy: "author-1", submittedAt: null, reviewedBy: null, reviewedAt: null, publishedBy: null, publishedAt: null, retiredAt: null, importBatchId: null, createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z" },
  }],
};

function renderEditor() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={queryClient}><MemoryRouter initialEntries={["/teaching/admin/questions/new"]}><Routes>
    <Route path="/teaching/admin/questions/new" element={<TeachingQuestionEditorPage />} />
    <Route path="/teaching/admin/questions/:id" element={<TeachingQuestionEditorPage />} />
  </Routes></MemoryRouter></QueryClientProvider>);
}

describe("Teaching question editor", () => {
  afterEach(() => { cleanup(); vi.resetAllMocks(); });

  it("creates a manual Draft through the canonical question API and shows server validation issues", async () => {
    apiMocks.fetchCatalog.mockResolvedValue(catalog);
    apiMocks.fetchBanks.mockResolvedValue({ items: [{ code: "radiology-main", name: "Radiology Main", specialtyCode: "radiology" }] });
    apiMocks.fetchQuestion.mockResolvedValue(createdQuestion);
    apiMocks.listCases.mockResolvedValue({ items: [] });
    apiMocks.listAssets.mockResolvedValue({ items: [] });
    apiMocks.listReferences.mockResolvedValue({ items: [] });
    apiMocks.listSources.mockResolvedValue({ items: [] });
    apiMocks.validate.mockResolvedValue({ errors: [{ code: "content", message: "A required item is missing." }], warnings: [{ code: "metadata", message: "Add a supporting reference." }] });
    apiMocks.uploadAsset.mockResolvedValue({ id: 88, mimeType: "image/png", originalFilename: "synthetic-teaching-image.png", altText: "", sizeBytes: 32 });
    apiMocks.createQuestion.mockResolvedValue(createdQuestion);
    renderEditor();

    const externalId = await screen.findByLabelText("External ID");
    fireEvent.change(externalId, { target: { value: "rad-neuro-055" } });
    fireEvent.change(screen.getByLabelText("Question stem"), { target: { value: "Synthetic educational question." } });
    fireEvent.change(screen.getByLabelText("Option A text"), { target: { value: "Answer A" } });
    fireEvent.change(screen.getByLabelText("Option B text"), { target: { value: "Answer B" } });
    fireEvent.click(screen.getByLabelText("Mark option A correct"));
    expect((screen.getByLabelText("Mark option A correct") as HTMLInputElement).checked).toBe(true);
    expect((screen.getByLabelText("Mark option B correct") as HTMLInputElement).checked).toBe(false);

    fireEvent.click(screen.getByRole("button", { name: "Add option" }));
    expect(screen.getByLabelText("Option C text")).toBeTruthy();
    fireEvent.click(screen.getByLabelText("Move option C up"));
    const optionKeys = () => Array.from(document.querySelectorAll('span[aria-label^="Option "]')).map((item) => item.textContent);
    expect(optionKeys()).toEqual(["A", "C", "B"]);
    fireEvent.click(screen.getByLabelText("Delete option C"));
    expect(screen.queryByLabelText("Option C text")).toBeNull();
    expect((screen.getByLabelText("Delete option B") as HTMLButtonElement).disabled).toBe(true);

    const image = new File([new Uint8Array([1, 2, 3])], "synthetic-teaching-image.png", { type: "image/png" });
    fireEvent.change(screen.getByLabelText("Upload Teaching image"), { target: { files: [image] } });
    await waitFor(() => expect(apiMocks.uploadAsset).toHaveBeenCalledWith(image));
    expect(await screen.findByLabelText("Alt text · synthetic-teaching-image.png")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Validate content" }));
    expect(await screen.findByText("A required item is missing.")).toBeTruthy();
    expect(screen.getByText("Add a supporting reference.")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Create Draft" }));
    await waitFor(() => expect(apiMocks.createQuestion).toHaveBeenCalledOnce());
    expect(apiMocks.createQuestion).toHaveBeenCalledWith(expect.objectContaining({
      externalId: "RAD-NEURO-055",
      questionBankCode: "radiology-main",
      type: "single_best_answer",
      stem: "Synthetic educational question.",
      options: expect.arrayContaining([
        expect.objectContaining({ key: "A", isCorrect: true }),
        expect.objectContaining({ key: "B", isCorrect: false }),
      ]),
      assetIds: [88],
      assetAltTexts: [{ assetId: 88, altText: "" }],
    }));
    expect(await screen.findByText("Draft question created.")).toBeTruthy();
  });

  it("clears lower classification levels when a parent changes and shows source-type-specific fields", async () => {
    apiMocks.fetchCatalog.mockResolvedValue(catalog);
    apiMocks.fetchBanks.mockResolvedValue({ items: [{ code: "radiology-main", name: "Radiology Main", specialtyCode: "radiology" }] });
    apiMocks.fetchQuestion.mockResolvedValue(createdQuestion);
    apiMocks.listCases.mockResolvedValue({ items: [] });
    apiMocks.listAssets.mockResolvedValue({ items: [] });
    apiMocks.listReferences.mockResolvedValue({ items: [] });
    apiMocks.listSources.mockResolvedValue({ items: [] });
    renderEditor();

    await screen.findByLabelText("Question stem");
    fireEvent.change(screen.getByLabelText("Topic"), { target: { value: "brain-tumors" } });
    fireEvent.change(screen.getByLabelText("Subtopic"), { target: { value: "glioma" } });
    expect((screen.getByLabelText("Subtopic") as HTMLSelectElement).value).toBe("glioma");

    fireEvent.change(screen.getByLabelText("Domain"), { target: { value: "cardiothoracic" } });
    expect((screen.getByLabelText("Topic") as HTMLSelectElement).value).toBe("");
    expect((screen.getByLabelText("Subtopic") as HTMLSelectElement).value).toBe("");
    expect((screen.getByLabelText("Subtopic") as HTMLSelectElement).disabled).toBe(true);

    fireEvent.click(screen.getByRole("button", { name: "New source" }));
    expect(await screen.findByRole("heading", { name: "New question source" })).toBeTruthy();
    expect(screen.getByLabelText("Edition")).toBeTruthy();
    fireEvent.change(screen.getByLabelText("Source type"), { target: { value: "exam" } });
    expect(screen.getByLabelText("Exam name")).toBeTruthy();
    expect(screen.getByLabelText("Sitting")).toBeTruthy();
    expect(screen.queryByLabelText("Edition")).toBeNull();
    expect(screen.queryByLabelText("Chapter")).toBeNull();
  });
});
