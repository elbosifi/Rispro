import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { TeachingImportBatchPage } from "../pages/teaching-import-batch-page";

const batchApi = vi.hoisted(() => ({ fetch: vi.fn(), validate: vi.fn(), publish: vi.fn() }));
vi.mock("../api/teaching-api", () => ({
  fetchTeachingImportBatch: batchApi.fetch,
  validateTeachingImportBatch: batchApi.validate,
  publishTeachingImportBatch: batchApi.publish,
}));
vi.mock("../auth/teaching-auth-context", () => ({
  useTeachingAuth: () => ({ identity: { permissions: ["teaching.access", "teaching.author", "teaching.review", "teaching.publish"] } }),
}));

const batch = {
  status: "confirmed",
  originalFilename: "radiology-neuro-qbank.zip",
  questionCount: 10,
  schemaVersion: "1.0",
  uploader: { identitySubject: "author-1" },
  createdAt: "2026-09-01T00:00:00.000Z",
  confirmedAt: "2026-09-01T00:01:00.000Z",
  confirmedBy: { identitySubject: "author-1" },
  publication: { total: 10, draft: 10, inReview: 0, published: 0, retired: 0 },
};

function question(id: number, validationStatus: "valid" | "valid_with_warnings" | "invalid"): {
  questionId: number; externalId: string; stemPreview: string; revisionId: number; revisionVersion: number;
  revisionStatus: string; validationStatus: "valid" | "valid_with_warnings" | "invalid";
  eligibleForPublish: boolean; errors: Array<{ code: string; message: string }>;
  warnings: Array<{ code: string; message: string }>;
} {
  const errors = validationStatus === "invalid" ? [{ code: "missing_asset", message: "An image-based question requires at least one image asset." }] : [];
  const warnings = validationStatus === "valid_with_warnings" ? [{ code: "references_missing", message: "No supporting references are recorded." }] : [];
  return {
    questionId: id,
    externalId: `RAD-NEURO-${String(id).padStart(4, "0")}`,
    stemPreview: `Synthetic question ${id}`,
    revisionId: id + 100,
    revisionVersion: 1,
    revisionStatus: "draft",
    validationStatus,
    eligibleForPublish: validationStatus !== "invalid",
    errors,
    warnings,
  };
}

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(<QueryClientProvider client={client}><MemoryRouter initialEntries={["/teaching/admin/import/batches/batch-143"]}><Routes>
    <Route path="/teaching/admin/import/batches/:batchId" element={<TeachingImportBatchPage />} />
  </Routes></MemoryRouter></QueryClientProvider>);
}

describe("Teaching import batch bulk validation and publication", () => {
  beforeEach(() => { batchApi.fetch.mockResolvedValue(batch); });
  afterEach(() => { cleanup(); vi.resetAllMocks(); });

  it("validates the full batch, confirms once, publishes eligible questions, and leaves the invalid Draft visible", async () => {
    batchApi.fetch.mockResolvedValue(batch);
    const validatedQuestions = [
      ...Array.from({ length: 8 }, (_, index) => question(index + 1, "valid")),
      question(9, "valid_with_warnings"),
      question(10, "invalid"),
    ];
    batchApi.validate.mockResolvedValue({ scopeFingerprint: "batch-fingerprint", total: 10, draft: 10, inReview: 0, published: 0, retired: 0, valid: 8, validWithWarnings: 1, invalid: 1, conflicts: 0, eligibleForPublish: 9, questions: validatedQuestions });
    batchApi.publish.mockResolvedValue({
      requested: 10, published: 9, alreadyPublished: 0, invalid: 1, conflicts: 0, requiresReview: 0, retired: 0, failed: 0, warnings: 1,
      results: validatedQuestions.map((item) => item.validationStatus === "invalid"
        ? { ...item, publishStatus: "invalid" as const }
        : { ...item, revisionStatus: "published", publishStatus: "published" as const }),
    });
    renderPage();

    expect(await screen.findByText(/radiology-neuro-qbank\.zip/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Validate & publish…" }));
    await waitFor(() => expect(batchApi.validate).toHaveBeenCalledOnce());
    const confirmation = await screen.findByRole("dialog", { name: "Review validation before publishing" });
    expect(confirmation.textContent).toContain("9 questions are eligible for publication.");
    expect(confirmation.textContent).toContain("1 invalid and will remain Draft.");
    expect(confirmation.textContent).toContain("1 eligible question contains 1 warning.");
    fireEvent.click(screen.getByText("View warnings"));
    expect(screen.getAllByText("No supporting references are recorded.")).toHaveLength(2);
    expect(batchApi.publish).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "Publish 9 questions" }));
    await waitFor(() => expect(batchApi.publish).toHaveBeenCalledOnce());
    expect(batchApi.publish).toHaveBeenCalledWith("batch-143", "batch-fingerprint");
    expect(await screen.findByText("8 published · 1 published with warnings · 1 require attention · 0 conflicts")).toBeTruthy();
    expect(await screen.findByText(/1 require attention/)).toBeTruthy();
    expect(screen.getByRole("link", { name: "Edit" }).getAttribute("href")).toBe("/teaching/admin/questions/10");
    expect(screen.getByText("An image-based question requires at least one image asset.")).toBeTruthy();
  });

  it("shows persisted validation and publication state after a batch reload without authorizing publication", async () => {
    batchApi.fetch.mockResolvedValue({
      ...batch,
      publication: { total: 10, draft: 10, inReview: 0, published: 0, retired: 0 },
      lastValidation: {
        total: 1, valid: 1, validWithWarnings: 0, invalid: 0, eligibleForPublish: 1,
        questions: [question(33, "valid")],
      },
    });
    renderPage();

    expect(await screen.findByText("Last validation result")).toBeTruthy();
    expect(screen.getByText("Saved classifications are informational. Current validation is required before publication.")).toBeTruthy();
    expect(screen.getByText("10", { selector: "dd" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Validate & publish…" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "View last validation classifications" }));
    expect(await screen.findByText("RAD-NEURO-0033")).toBeTruthy();
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(batchApi.publish).not.toHaveBeenCalled();
  });
});
