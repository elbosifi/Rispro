import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import userEvent from "@testing-library/user-event";
import RequestScansPage from "./request-scans-page";

const response = (value: unknown) => ({ ok: true, json: async () => value }) as Response;
const jobs = [{ id: 7, filename: "request.pdf", status: "pending", barcode_value: null, appointment_id: null, document_id: null, error_message: null, attempt_count: 1, created_at: "2026-07-22T10:00:00Z" }, { id: 8, filename: "request.jpg", status: "pending", barcode_value: null, appointment_id: null, document_id: null, error_message: null, attempt_count: 1, created_at: "2026-07-22T10:00:00Z" }];

function renderPage() {
  return render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><MemoryRouter><RequestScansPage /></MemoryRouter></QueryClientProvider>);
}

afterEach(() => vi.restoreAllMocks());

describe("RequestScansPage", () => {
  it("renders status tabs and failed recovery actions, then manually assigns", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
      const url = String(input);
      if (url.includes("/status")) return response({ enabled: true, pending: 1, processedToday: 2, failed: 1 });
      if (url.includes("eligible-appointments")) return response({ appointments: [{ id: 12, accession_number: "V2-000012", patient_name: "Patient" }] });
      if (url.includes("?status=failed")) return response({ jobs: [{ ...jobs[0], filename: "failed.jpg", status: "failed", error_message: "No valid V2 accession found" }] });
      return response({ jobs: [] });
    });
    renderPage();
    expect(await screen.findByText("Automation")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Failed" }));
    expect(await screen.findByText("failed.jpg")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Manually assign" }));
    await screen.findByRole("option", { name: /V2-000012/ });
    await userEvent.setup().selectOptions(screen.getByRole("combobox"), "12");
    fireEvent.click(screen.getByRole("button", { name: "Attach and process" }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith(expect.stringContaining("/api/request-scans/7/manual-assign"), expect.objectContaining({ method: "POST" })));
  });

  it("loads PDF previews through a Blob URL and revokes it when closed or replaced", async () => {
    const createObjectURL = vi.fn().mockReturnValueOnce("blob:pdf-preview").mockReturnValueOnce("blob:image-preview");
    const revokeObjectURL = vi.fn();
    vi.stubGlobal("URL", { ...URL, createObjectURL, revokeObjectURL });
    const blob = new Blob(["preview"], { type: "application/pdf" });
    const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      const url = String(input);
      if (url.includes("/status")) return response({ enabled: true, pending: 2, processedToday: 0, failed: 0 });
      if (url.includes("?status=pending")) return response({ jobs });
      if (url === "/api/request-scans/7/file" || url === "/api/request-scans/8/file") return { ok: true, blob: async () => blob } as Response;
      return response({ jobs: [] });
    });
    renderPage();
    await screen.findByText("request.pdf");
    fireEvent.click(screen.getAllByRole("button", { name: "Preview" })[0]!);
    expect(screen.getByText("Loading preview…")).toBeTruthy();
    const frame = await screen.findByTitle("Request scan preview");
    expect(frame.getAttribute("src")).toBe("blob:pdf-preview");
    expect(fetchMock).toHaveBeenCalledWith("/api/request-scans/7/file", { credentials: "include" });
    expect(frame.getAttribute("src")).not.toBe("/api/request-scans/7/file");
    fireEvent.click(screen.getAllByRole("button", { name: "Preview" })[1]!);
    await waitFor(() => expect(revokeObjectURL).toHaveBeenCalledWith("blob:pdf-preview"));
    expect((await screen.findByAltText("request.jpg")).getAttribute("src")).toBe("blob:image-preview");
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(revokeObjectURL).toHaveBeenCalledWith("blob:image-preview");
  });

  it("shows a safe backend preview error without navigation", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      const url = String(input);
      if (url.includes("/status")) return response({ enabled: true, pending: 1, processedToday: 0, failed: 0 });
      if (url.includes("?status=pending")) return response({ jobs: [jobs[0]] });
      if (url === "/api/request-scans/7/file") return { ok: false, json: async () => ({ error: { message: "Request file is unavailable." } }) } as Response;
      return response({ jobs: [] });
    });
    renderPage();
    await screen.findByText("request.pdf");
    fireEvent.click(screen.getByRole("button", { name: "Preview" }));
    expect(await screen.findByText("Preview could not be loaded: Request file is unavailable.")).toBeTruthy();
    expect(fetchMock).toHaveBeenCalledWith("/api/request-scans/7/file", { credentials: "include" });
  });
});
