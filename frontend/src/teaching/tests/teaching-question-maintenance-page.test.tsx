import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter } from "react-router-dom";
import { TeachingQuestionMaintenancePage } from "../pages/teaching-question-maintenance-page";

const maintenanceApi = vi.hoisted(() => ({ download: vi.fn(), preview: vi.fn(), confirm: vi.fn() }));

vi.mock("../api/teaching-api", () => ({
  downloadTeachingMaintenanceWorkbook: maintenanceApi.download,
  previewTeachingMaintenanceWorkbook: maintenanceApi.preview,
  confirmTeachingMaintenanceWorkbook: maintenanceApi.confirm,
}));

describe("Teaching question maintenance page", () => {
  afterEach(() => { cleanup(); vi.resetAllMocks(); });

  it("exports, previews, shows Topic proposals, and confirms a workbook", async () => {
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
});
