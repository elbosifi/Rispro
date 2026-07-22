import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import userEvent from "@testing-library/user-event";
import RequestScansPage from "./request-scans-page";

const response = (value: unknown) => ({ ok: true, json: async () => value }) as Response;
afterEach(() => vi.restoreAllMocks());
describe("RequestScansPage", () => {
  it("renders status tabs and failed recovery actions, then manually assigns", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
      const url = String(input);
      if (url.includes("/status")) return response({ enabled: true, pending: 1, processedToday: 2, failed: 1 });
      if (url.includes("eligible-appointments")) return response({ appointments: [{ id: 12, accession_number: "V2-000012", patient_name: "Patient" }] });
      if (url.includes("?status=failed")) return response({ jobs: [{ id: 7, filename: "failed.jpg", status: "failed", barcode_value: null, appointment_id: null, document_id: null, error_message: "No valid V2 accession found", attempt_count: 1, created_at: "2026-07-22T10:00:00Z" }] });
      return response({ jobs: [] });
    });
    render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><MemoryRouter><RequestScansPage /></MemoryRouter></QueryClientProvider>);
    expect(await screen.findByText("Automation")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Failed" }));
    expect(await screen.findByText("failed.jpg")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Retry" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Return" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Manually assign" }));
    expect(await screen.findByText("Manually assign request scan")).toBeTruthy();
    await screen.findByRole("option", { name: /V2-000012/ });
    await userEvent.setup().selectOptions(screen.getByRole("combobox"), "12");
    await waitFor(() => expect(screen.getByRole("button", { name: "Attach and process" }).hasAttribute("disabled")).toBe(false));
    fireEvent.click(screen.getByRole("button", { name: "Attach and process" }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith(expect.stringContaining("/api/request-scans/7/manual-assign"), expect.objectContaining({ method: "POST" })));
  });
});
