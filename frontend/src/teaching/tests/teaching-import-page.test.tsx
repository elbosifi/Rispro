import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { TeachingAuthContext } from "../auth/teaching-auth-context";
import { TeachingImportPage } from "../pages/teaching-import-page";

const importApi = vi.hoisted(() => ({
  confirm: vi.fn(),
  download: vi.fn(),
  inspect: vi.fn(),
  preview: vi.fn(),
}));

vi.mock("../api/teaching-api", () => ({
  confirmTeachingImport: importApi.confirm,
  downloadTeachingImportTemplate: importApi.download,
  inspectTeachingImport: importApi.inspect,
  previewTeachingImport: importApi.preview,
}));

function LocationDisplay() {
  const location = useLocation();
  return <p data-testid="current-location">{location.pathname}</p>;
}

function renderImportPage() {
  return render(<TeachingAuthContext.Provider value={{ identity: { permissions: ["teaching.author"] } } as never}><MemoryRouter initialEntries={["/teaching/admin/import"]}><Routes>
    <Route path="/teaching/admin/import" element={<><TeachingImportPage /><LocationDisplay /></>} />
    <Route path="/teaching/admin/import/batches/:batchId" element={<LocationDisplay />} />
  </Routes></MemoryRouter></TeachingAuthContext.Provider>);
}

describe("Teaching import page", () => {
  afterEach(() => {
    cleanup();
    vi.resetAllMocks();
  });

  it("downloads, inspects, previews and confirms a Teaching import as Draft", async () => {
    importApi.download.mockResolvedValue(undefined);
    importApi.inspect.mockResolvedValue({
      batchId: "batch-1",
      schemaVersion: "1.0",
      questions: 1,
      cases: 0,
      assets: 0,
      structurallyValid: true,
      errors: [],
      warnings: [],
    });
    importApi.preview.mockResolvedValue({
      schemaVersion: "1.0",
      questionCount: 1,
      caseCount: 0,
      assetCount: 0,
      errors: [],
      warnings: [{ code: "source_missing", message: "No source information was supplied." }],
      questions: [{
        externalId: "TEST-SBA-001",
        type: "single_best_answer",
        stem: "Synthetic import preview question.",
        correctOption: { id: "B", text: "Correct answer" },
        options: [
          { id: "A", text: "Distractor", isCorrect: false, explanation: null },
          { id: "B", text: "Correct answer", isCorrect: true, explanation: "Evidence supports B." },
        ],
        explanation: { summary: "Evidence summary.", teachingPoint: "Teaching point.", furtherDiscussion: null, optionExplanations: {} },
        classification: {
          specialty: { code: "radiology", label: "Radiology" },
          domain: { code: "neuroradiology", label: "Neuroradiology" },
          topic: null,
          subtopic: null,
          modalities: [],
          competencies: [],
          trainingLevel: null,
          difficulty: { value: 3, label: "Moderate" },
          tags: [],
        },
        source: null,
        provenance: null,
        referenceCount: 0,
        media: [],
        case: null,
        disposition: "new",
        warnings: [],
        errors: [],
      }],
    });
    importApi.confirm.mockResolvedValue({ batchId: "batch-1", status: "confirmed", questionCount: 1 });

    renderImportPage();

    fireEvent.click(screen.getByRole("button", { name: "Download AI Template" }));
    await waitFor(() => expect(importApi.download).toHaveBeenCalledOnce());

    const file = new File([JSON.stringify({ schemaVersion: "1.0", questions: [] })], "questions.json", { type: "application/json" });
    fireEvent.change(screen.getByLabelText(/Choose JSON or ZIP file/i), { target: { files: [file] } });
    fireEvent.click(screen.getByRole("button", { name: "Inspect upload" }));
    await waitFor(() => expect(importApi.inspect).toHaveBeenCalledWith(file));
    fireEvent.click(await screen.findByRole("button", { name: "Validate and preview" }));

    expect(await screen.findByRole("heading", { name: "3. Preview import" })).toBeTruthy();
    expect(screen.getByText("Correct answer")).toBeTruthy();
    expect(screen.getByText(/Warnings/)).toBeTruthy();
    expect(importApi.confirm).not.toHaveBeenCalled();
    fireEvent.click(screen.getAllByRole("button", { name: "Import 1 Draft Questions" })[0]!);
    await waitFor(() => expect(importApi.confirm).toHaveBeenCalledWith("batch-1"));
    await waitFor(() => expect(screen.getByTestId("current-location").textContent).toBe("/teaching/admin/import/batches/batch-1"));
  });

  it("shows validation errors and blocks confirmation", async () => {
    importApi.inspect.mockResolvedValue({
      batchId: "batch-2", schemaVersion: "1.0", questions: 1, cases: 0, assets: 0,
      structurallyValid: true, errors: [], warnings: [],
    });
    importApi.preview.mockResolvedValue({
      schemaVersion: "1.0", questionCount: 1, caseCount: 0, assetCount: 0,
      errors: [{ code: "unknown_specialty", message: "Unknown specialty." }], warnings: [], questions: [],
    });

    renderImportPage();
    const file = new File(["{}"], "questions.json", { type: "application/json" });
    fireEvent.change(screen.getByLabelText(/Choose JSON or ZIP file/i), { target: { files: [file] } });
    fireEvent.click(screen.getByRole("button", { name: "Inspect upload" }));
    fireEvent.click(await screen.findByRole("button", { name: "Validate and preview" }));

    expect(await screen.findByText("Unknown specialty.")).toBeTruthy();
    expect(screen.getAllByRole("button", { name: "Import 0 Draft Questions" }).every((button) => button.hasAttribute("disabled"))).toBe(true);
    expect(importApi.confirm).not.toHaveBeenCalled();
  });

  it("uploads ZIP files and prevents double submission while confirmation is pending", async () => {
    importApi.inspect.mockResolvedValue({
      batchId: "zip-batch", schemaVersion: "1.0", questions: 1, cases: 0, assets: 1,
      structurallyValid: true, errors: [], warnings: [],
    });
    importApi.preview.mockResolvedValue({
      schemaVersion: "1.0", questionCount: 1, caseCount: 0, assetCount: 1, errors: [], warnings: [],
      questions: [{
        externalId: "TEST-ZIP-001", type: "image_based_sba", stem: "Synthetic ZIP image question.",
        correctOption: { id: "B", text: "Correct answer" },
        options: [{ id: "A", text: "Distractor", isCorrect: false, explanation: null }, { id: "B", text: "Correct answer", isCorrect: true, explanation: null }],
        explanation: { summary: "Synthetic explanation.", teachingPoint: "Synthetic point.", furtherDiscussion: null, optionExplanations: {} },
        classification: {
          specialty: { code: "radiology", label: "Radiology" }, domain: { code: "neuroradiology", label: "Neuroradiology" },
          topic: null, subtopic: null, modalities: [], competencies: [], trainingLevel: null, difficulty: null, tags: [],
        },
        source: null, provenance: null, referenceCount: 0,
        media: [{ assetKey: "TEST-ZIP-001-01", filename: "synthetic.png", type: "image", altText: "Synthetic image" }],
        case: null, disposition: "new", warnings: [], errors: [],
      }],
    });
    let finishConfirm!: (result: { batchId: string; status: string; questionCount: number }) => void;
    importApi.confirm.mockImplementation(() => new Promise((resolve) => { finishConfirm = resolve; }));

    renderImportPage();
    const file = new File(["synthetic ZIP bytes"], "questions.zip", { type: "application/zip" });
    fireEvent.change(document.getElementById("teaching-import-file")!, { target: { files: [file] } });
    fireEvent.click(screen.getByRole("button", { name: "Inspect upload" }));
    await waitFor(() => expect(importApi.inspect).toHaveBeenCalledWith(file));
    fireEvent.click(await screen.findByRole("button", { name: "Validate and preview" }));
    await screen.findByRole("heading", { name: "3. Preview import" });

    const confirmButtons = screen.getAllByRole("button", { name: "Import 1 Draft Questions" });
    act(() => {
      confirmButtons[0]!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      confirmButtons[1]!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    await waitFor(() => expect(importApi.confirm).toHaveBeenCalledOnce());
    finishConfirm({ batchId: "zip-batch", status: "confirmed", questionCount: 1 });
    await waitFor(() => expect(screen.getByTestId("current-location").textContent).toBe("/teaching/admin/import/batches/zip-batch"));
  });

  it("stays on the import screen when confirmation fails", async () => {
    importApi.inspect.mockResolvedValue({
      batchId: "batch-failed", schemaVersion: "1.0", questions: 1, cases: 0, assets: 0,
      structurallyValid: true, errors: [], warnings: [],
    });
    importApi.preview.mockResolvedValue({
      schemaVersion: "1.0", questionCount: 1, caseCount: 0, assetCount: 0,
      errors: [], warnings: [], questions: [{
        externalId: "SYNTHETIC-FAIL", type: "single_best_answer", stem: "Synthetic", disposition: "new",
        classification: {
          specialty: { label: "Radiology" }, domain: { label: "Neuroradiology" }, topic: null, subtopic: null,
          modalities: [], competencies: [], trainingLevel: null, difficulty: null, tags: [],
        },
        explanation: { summary: "Synthetic explanation.", teachingPoint: "Synthetic point." },
        options: [], source: null, provenance: null, referenceCount: 0, media: [], case: null, errors: [], warnings: [],
      }],
    });
    importApi.confirm.mockRejectedValue(new Error("The import could not be confirmed."));
    renderImportPage();

    const file = new File(["{}"], "questions.json", { type: "application/json" });
    fireEvent.change(screen.getByLabelText(/Choose JSON or ZIP file/i), { target: { files: [file] } });
    fireEvent.click(screen.getByRole("button", { name: "Inspect upload" }));
    fireEvent.click(await screen.findByRole("button", { name: "Validate and preview" }));
    fireEvent.click((await screen.findAllByRole("button", { name: "Import 1 Draft Questions" }))[0]!);

    expect((await screen.findByRole("alert")).textContent).toContain("The import could not be confirmed.");
    expect(screen.getByTestId("current-location").textContent).toBe("/teaching/admin/import");
  });
});
