import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  language: "en" as "en" | "ar",
  modalityProps: null as null | { id: number; code: string; name: string; onBack: () => void },
}));
vi.mock("@/providers/language-provider", () => ({ useLanguage: () => ({ language: state.language, isArabic: state.language === "ar" }) }));
vi.mock("@/lib/api-hooks", () => ({ fetchAppointmentLookups: vi.fn(async () => ({
  modalities: [
    { id: 7, code: "CT", nameAr: "الأشعة المقطعية", nameEn: "CT", isActive: true },
    { id: 8, code: "MRI", nameAr: "الرنين", nameEn: "MRI", isActive: false },
  ],
})) }));
vi.mock("@/pages/request-scans/request-scans-page", () => ({
  default: (props: { modality: { id: number; code: string; name: string; onBack: () => void } }) => {
    state.modalityProps = props.modality;
    return <div><h1>{props.modality.code} Document Ingestion</h1><button onClick={props.modality.onBack}>Back to Modality Worklist</button></div>;
  },
}));

import DocumentIngestionPage from "./document-ingestion-page";

function Location() {
  return <div data-testid="location">{useLocation().pathname}{useLocation().search}</div>;
}

function renderPage(entry: string) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[entry]}>
        <Routes>
          <Route path="/modality/document-ingestion" element={<><DocumentIngestionPage /><Location /></>} />
          <Route path="/modality" element={<Location />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  state.language = "en";
  state.modalityProps = null;
});

describe("DocumentIngestionPage", () => {
  it("restores CT from the URL and passes only its modality scope to Request Scans", async () => {
    renderPage("/modality/document-ingestion?modalityId=7");
    expect(await screen.findByRole("heading", { name: "CT Document Ingestion" })).toBeTruthy();
    expect(state.modalityProps?.id).toBe(7);
    expect(state.modalityProps?.code).toBe("CT");
    fireEvent.click(screen.getByRole("button", { name: "Back to Modality Worklist" }));
    await waitFor(() => expect(screen.getByTestId("location").textContent).toBe("/modality?modalityId=7"));
  });

  it.each([
    ["/modality/document-ingestion?modalityId=999", "unknown"],
    ["/modality/document-ingestion?modalityId=8", "inactive"],
    ["/modality/document-ingestion?modalityId=../7", "unsafe"],
  ])("shows a safe error for %s modality IDs", async (entry) => {
    renderPage(entry);
    expect(await screen.findByText("Select a valid modality from the Modality Worklist.")).toBeTruthy();
    expect(state.modalityProps).toBeNull();
    expect(screen.queryByText(/Document Ingestion/)).toBeNull();
  });
});
