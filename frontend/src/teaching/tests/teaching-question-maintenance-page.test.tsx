import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter } from "react-router-dom";
import { TeachingQuestionMaintenancePage } from "../pages/teaching-question-maintenance-page";

const maintenanceApi = vi.hoisted(() => ({ catalog: vi.fn(), download: vi.fn(), preview: vi.fn(), confirm: vi.fn() }));

vi.mock("../api/teaching-api", () => ({
  fetchTeachingCatalog: maintenanceApi.catalog,
  downloadTeachingMaintenanceWorkbook: maintenanceApi.download,
  previewTeachingMaintenanceWorkbook: maintenanceApi.preview,
  confirmTeachingMaintenanceWorkbook: maintenanceApi.confirm,
}));

const catalog = {
  schemaVersion: 1,
  specialties: [],
  domains: [
    { code: "neuroradiology", label: "Neuroradiology", description: "", parentCode: "radiology", active: true, sortOrder: 1 },
    { code: "musculoskeletal", label: "Musculoskeletal", description: "", parentCode: "radiology", active: true, sortOrder: 2 },
    { code: "inactive-domain", label: "Inactive domain", description: "", parentCode: "radiology", active: false, sortOrder: 3 },
  ],
  topics: [
    { code: "brain-tumors", label: "Brain tumors", description: "", parentCode: "neuroradiology", active: true, sortOrder: 1 },
    { code: "shared-topic", label: "Neuroradiology shared topic", description: "", parentCode: "neuroradiology", active: true, sortOrder: 2 },
    { code: "acl-injuries", label: "ACL injuries", description: "", parentCode: "musculoskeletal", active: true, sortOrder: 2 },
    { code: "shared-topic", label: "Musculoskeletal shared topic", description: "", parentCode: "musculoskeletal", active: true, sortOrder: 3 },
    { code: "inactive-topic", label: "Inactive topic", description: "", parentCode: "neuroradiology", active: false, sortOrder: 3 },
  ],
  subtopics: [], modalities: [], competencies: [], trainingLevels: [], difficulties: [], tags: [],
  supportedQuestionTypes: [], supportedSourceTypes: [], supportedProvenanceRelationships: [],
};

describe("Teaching question maintenance page", () => {
  afterEach(() => { cleanup(); vi.resetAllMocks(); });

  it("exports, previews, shows Topic proposals, and confirms a workbook", async () => {
    maintenanceApi.catalog.mockResolvedValue(catalog);
    maintenanceApi.download.mockResolvedValue(undefined);
    maintenanceApi.preview.mockResolvedValue({
      workbookHash: "sha256", summary: { total: 2, unchanged: 1, updateDraft: 0, createDraftRevision: 1, invalid: 0, staleConflict: 0, inReviewConflict: 0, retired: 0, missingQuestion: 0 },
      topicProposals: [{ specialty: "radiology", domain: "neuroradiology", code: "demyelination", label: "Demyelination", description: "", questionCount: 1, alreadyExists: false, warnings: [], errors: [] }],
      errors: [], warnings: [], rows: [{ externalId: "TEST-MAINT-001", currentStatus: "published", action: "create_draft_revision", changedFields: ["stem"], warnings: [], errors: [] }],
    });
    maintenanceApi.confirm.mockResolvedValue({ updatedDraft: 0, newDraftRevision: 1, unchanged: 1, invalid: 0, conflicts: 0, proposedTopicsCreated: 1 });
    render(<MemoryRouter><TeachingQuestionMaintenancePage /></MemoryRouter>);

    fireEvent.click(screen.getByRole("button", { name: "Export all questions XLSX" }));
    await waitFor(() => expect(maintenanceApi.download).toHaveBeenCalledOnce());
    expect(maintenanceApi.download).toHaveBeenCalledWith();
    const file = new File(["workbook"], "questions.xlsx", { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
    fireEvent.change(screen.getByLabelText("Updated XLSX workbook"), { target: { files: [file] } });
    fireEvent.click(screen.getByRole("button", { name: "Preview changes" }));
    expect(await screen.findByRole("heading", { name: "Proposed Topics" })).toBeTruthy();
    expect(screen.getByRole("listitem").textContent).toContain("Demyelination");
    expect(screen.getByText(/createDraftRevision: 1/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Confirm Updates" }));
    await waitFor(() => expect(maintenanceApi.confirm).toHaveBeenCalledWith(file, "sha256"));
    expect(await screen.findByText(/1 new Draft revisions created/)).toBeTruthy();
  });

  it("blocks confirmation for structural or row-level validation errors", async () => {
    maintenanceApi.catalog.mockResolvedValue(catalog);
    maintenanceApi.preview.mockResolvedValue({
      workbookHash: "sha256", summary: { total: 1, unchanged: 0, updateDraft: 0, createDraftRevision: 0, invalid: 1, staleConflict: 0, inReviewConflict: 0, retired: 0, missingQuestion: 0 }, topicProposals: [],
      errors: [{ code: "malformed_headers", message: "Questions is missing required columns." }], warnings: [], rows: [],
    });
    render(<MemoryRouter><TeachingQuestionMaintenancePage /></MemoryRouter>);
    const file = new File(["workbook"], "questions.xlsx", { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
    fireEvent.change(screen.getByLabelText("Updated XLSX workbook"), { target: { files: [file] } });
    fireEvent.click(screen.getByRole("button", { name: "Preview changes" }));
    expect(await screen.findByText("Questions is missing required columns.")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Confirm Updates" }).hasAttribute("disabled")).toBe(true);
  });

  it("exports the selected Draft status and domain and shows the approximate scope", async () => {
    maintenanceApi.catalog.mockResolvedValue(catalog);
    maintenanceApi.download.mockResolvedValue(undefined);
    render(<MemoryRouter><TeachingQuestionMaintenancePage /></MemoryRouter>);

    fireEvent.change(await screen.findByLabelText("Domain"), { target: { value: "neuroradiology" } });
    expect(screen.getByText("Draft · Neuroradiology · All topics")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Export selected XLSX" }));

    await waitFor(() => expect(maintenanceApi.download).toHaveBeenCalledWith({ status: "draft", domainCode: "neuroradiology" }));
  });

  it("only shows active topics belonging to the selected domain", async () => {
    maintenanceApi.catalog.mockResolvedValue(catalog);
    render(<MemoryRouter><TeachingQuestionMaintenancePage /></MemoryRouter>);

    fireEvent.change(await screen.findByLabelText("Domain"), { target: { value: "neuroradiology" } });
    const topicSelect = screen.getByLabelText("Topic") as HTMLSelectElement;
    const optionLabels = Array.from(topicSelect.options).map((option) => option.textContent);

    expect(topicSelect.disabled).toBe(false);
    expect(optionLabels).toEqual(["All topics", "Brain tumors", "Neuroradiology shared topic"]);
  });

  it("disables Topic and offers no domain topics while All domains is selected", async () => {
    maintenanceApi.catalog.mockResolvedValue(catalog);
    render(<MemoryRouter><TeachingQuestionMaintenancePage /></MemoryRouter>);

    const topicSelect = await screen.findByLabelText("Topic") as HTMLSelectElement;
    await waitFor(() => expect(screen.getByLabelText("Domain").querySelectorAll("option")).toHaveLength(3));

    expect(topicSelect.disabled).toBe(true);
    expect(topicSelect.value).toBe("");
    expect(Array.from(topicSelect.options).map((option) => option.textContent)).toEqual(["All topics"]);
  });

  it("clears an incompatible topic when the selected domain changes", async () => {
    maintenanceApi.catalog.mockResolvedValue(catalog);
    render(<MemoryRouter><TeachingQuestionMaintenancePage /></MemoryRouter>);

    fireEvent.change(await screen.findByLabelText("Domain"), { target: { value: "neuroradiology" } });
    fireEvent.change(screen.getByLabelText("Topic"), { target: { value: "brain-tumors" } });
    expect((screen.getByLabelText("Topic") as HTMLSelectElement).value).toBe("brain-tumors");

    fireEvent.change(screen.getByLabelText("Domain"), { target: { value: "musculoskeletal" } });
    expect((screen.getByLabelText("Topic") as HTMLSelectElement).value).toBe("");
  });

  it("never sends a topic from the previous domain with the selected export", async () => {
    maintenanceApi.catalog.mockResolvedValue(catalog);
    maintenanceApi.download.mockResolvedValue(undefined);
    render(<MemoryRouter><TeachingQuestionMaintenancePage /></MemoryRouter>);

    fireEvent.change(await screen.findByLabelText("Domain"), { target: { value: "neuroradiology" } });
    fireEvent.change(screen.getByLabelText("Topic"), { target: { value: "brain-tumors" } });
    fireEvent.change(screen.getByLabelText("Domain"), { target: { value: "musculoskeletal" } });
    fireEvent.click(screen.getByRole("button", { name: "Export selected XLSX" }));

    await waitFor(() => expect(maintenanceApi.download).toHaveBeenCalledWith({ status: "draft", domainCode: "musculoskeletal" }));
  });

  it("clears Topic when Domain is cleared and never exports a topic without its domain", async () => {
    maintenanceApi.catalog.mockResolvedValue(catalog);
    maintenanceApi.download.mockResolvedValue(undefined);
    render(<MemoryRouter><TeachingQuestionMaintenancePage /></MemoryRouter>);

    fireEvent.change(await screen.findByLabelText("Domain"), { target: { value: "neuroradiology" } });
    fireEvent.change(screen.getByLabelText("Topic"), { target: { value: "brain-tumors" } });
    fireEvent.change(screen.getByLabelText("Domain"), { target: { value: "" } });

    const topicSelect = screen.getByLabelText("Topic") as HTMLSelectElement;
    expect(topicSelect.value).toBe("");
    expect(topicSelect.disabled).toBe(true);
    expect(Array.from(topicSelect.options).map((option) => option.textContent)).toEqual(["All topics"]);

    fireEvent.click(screen.getByRole("button", { name: "Export selected XLSX" }));

    await waitFor(() => expect(maintenanceApi.download).toHaveBeenCalledWith({ status: "draft" }));
    expect(maintenanceApi.download).not.toHaveBeenCalledWith(expect.objectContaining({ topicCode: "brain-tumors" }));
  });

  it("shows a busy label and disables export actions while a workbook is being prepared", async () => {
    maintenanceApi.catalog.mockResolvedValue(catalog);
    maintenanceApi.download.mockReturnValue(new Promise(() => {}));
    render(<MemoryRouter><TeachingQuestionMaintenancePage /></MemoryRouter>);

    const selected = await screen.findByRole("button", { name: "Export selected XLSX" }) as HTMLButtonElement;
    const exportAll = screen.getByRole("button", { name: "Export all questions XLSX" }) as HTMLButtonElement;
    fireEvent.click(selected);

    expect(await screen.findByRole("button", { name: "Preparing selected workbook…" })).toBeTruthy();
    expect(selected.disabled).toBe(true);
    expect(exportAll.disabled).toBe(true);
  });

  it("surfaces selected export failures through the Maintenance alert", async () => {
    maintenanceApi.catalog.mockResolvedValue(catalog);
    maintenanceApi.download.mockRejectedValue(new Error("Could not export the Teaching maintenance workbook."));
    render(<MemoryRouter><TeachingQuestionMaintenancePage /></MemoryRouter>);

    fireEvent.click(await screen.findByRole("button", { name: "Export selected XLSX" }));

    expect(await screen.findByRole("alert")).toBeTruthy();
    expect(screen.getByText("Could not export the Teaching maintenance workbook.")).toBeTruthy();
  });
});
