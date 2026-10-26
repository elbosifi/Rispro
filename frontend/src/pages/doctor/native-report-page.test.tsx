import { render, screen, cleanup } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, expect, it, vi } from "vitest";
import { api } from "@/lib/api-client";
import { NativeReportPage } from "./native-report-page";

vi.mock("@/lib/api-client", () => ({ api: vi.fn() }));
afterEach(() => { cleanup(); vi.resetAllMocks(); });
function openReport(id = "42") {
  render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
    <MemoryRouter initialEntries={[`/reporting/native/${id}`]}><Routes>
      <Route path="/reporting/native/:appointmentId" element={<NativeReportPage />} />
    </Routes></MemoryRouter>
  </QueryClientProvider>);
}
it("reopens saved content through the API client's relative reporting route", async () => {
  vi.mocked(api).mockResolvedValue({ report: {
    appointmentId: 42, status: "final", revision: 3,
    identity: { patientName: "Synthetic patient", patientIdentifier: "SYN-42", accession: "V2-42", examination: "CT", studyDate: "20261026" },
    sections: { findings: "Preserved findings", impression: "Saved impression" },
    author: "Reader", finalizer: "Signer", finalizedAt: "2026-10-26T12:00:00Z", keyImages: [], addenda: []
  } });
  openReport();
  expect(await screen.findByText("Saved impression")).toBeTruthy();
  expect(api).toHaveBeenCalledWith("/native-reporting/appointments/42");
  expect(screen.getByText("Final — signed")).toBeTruthy();
});
it("shows a read failure without presenting an empty report as saved", async () => {
  vi.mocked(api).mockRejectedValue(new Error("Case access revoked"));
  openReport();
  expect(await screen.findByText("Case access revoked")).toBeTruthy();
  expect(screen.queryByText("Final — signed")).toBeNull();
});
