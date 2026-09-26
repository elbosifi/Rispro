import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { TeachingImportHistoryPage } from "../pages/teaching-import-history-page";

const historyApi = vi.hoisted(() => ({ fetch: vi.fn() }));
vi.mock("../api/teaching-api", () => ({ fetchTeachingImportBatches: historyApi.fetch }));

function LocationDisplay() {
  const location = useLocation();
  return <p data-testid="current-location">{location.pathname}</p>;
}

function renderHistory(path = "/teaching/admin/import/history") {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={client}><MemoryRouter initialEntries={[path]}><Routes>
    <Route path="/teaching/admin/import/history" element={<><TeachingImportHistoryPage /><LocationDisplay /></>} />
    <Route path="/teaching/admin/import/batches/:batchId" element={<LocationDisplay />} />
  </Routes></MemoryRouter></QueryClientProvider>);
}

describe("Teaching import history", () => {
  afterEach(() => { cleanup(); vi.resetAllMocks(); });

  it("shows import lineage, publication counts, and opens a previous batch", async () => {
    historyApi.fetch.mockResolvedValue({
      items: [{
        id: "batch-old-123", originalFilename: "synthetic-neuro.json", inputType: "json", schemaVersion: "1.0",
        status: "confirmed", questionCount: 12, caseCount: 0, assetCount: 0,
        uploader: { identityIssuer: "teaching", identitySubject: "editor@example.test" },
        createdAt: "2026-09-01T12:00:00.000Z", confirmedAt: "2026-09-01T12:05:00.000Z",
        publication: { total: 12, draft: 4, inReview: 0, published: 8, retired: 0 },
      }],
      pagination: { limit: 20, offset: 0, total: 41 },
    });
    renderHistory();

    const row = await screen.findByRole("row", { name: /synthetic-neuro\.json/ });
    expect(within(row).getByText("editor@example.test")).toBeTruthy();
    expect(within(row).getByText("1.0")).toBeTruthy();
    expect(within(row).getByText("12")).toBeTruthy();
    expect(within(row).getByText(/4 Draft.*8 Published/)).toBeTruthy();
    expect(screen.getByText("Page 1 of 3 · 41 imports")).toBeTruthy();
    fireEvent.click(within(row).getByRole("link", { name: "Open batch" }));
    expect((await screen.findByTestId("current-location")).textContent).toBe("/teaching/admin/import/batches/batch-old-123");
  });

  it("uses server pagination for the history URL state", async () => {
    historyApi.fetch.mockResolvedValue({ items: [], pagination: { limit: 20, offset: 20, total: 41 } });
    renderHistory("/teaching/admin/import/history?page=2");

    expect(await screen.findByText("No Teaching imports yet. Confirm an import to see its batch here.")).toBeTruthy();
    await waitFor(() => expect(historyApi.fetch).toHaveBeenCalledWith(20, 20));
    expect(screen.getByText("Page 2 of 3 · 41 imports")).toBeTruthy();
  });
});
