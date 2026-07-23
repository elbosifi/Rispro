import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { readFileSync } from "node:fs";
import path from "node:path";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import RequestScansPage, { requestScanJobsPollInterval, requestScanStatusPollInterval } from "./request-scans-page";

const response = (value: unknown) => ({ ok: true, json: async () => value }) as Response;
const status = {
  enabled: true,
  lastRunAt: null,
  lastError: null,
  running: false,
  pending: 1,
  processing: 1,
  processedToday: 2,
  duplicatesToday: 0,
  failed: 1,
};
const pendingJob = {
  id: 7,
  filename: "request.pdf",
  status: "pending",
  barcode_value: null,
  appointment_id: null,
  document_id: null,
  error_message: null,
  attempt_count: 1,
  created_at: "2026-07-22T10:00:00Z",
};
const processingJob = { ...pendingJob, id: 8, filename: "processing.jpg", status: "processing" };
const failedJob = { ...pendingJob, id: 9, filename: "failed.jpg", status: "failed", error_message: "No valid appointment identifier could be confirmed." };

function renderPage(client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })) {
  return {
    client,
    ...render(<QueryClientProvider client={client}><MemoryRouter><RequestScansPage /></MemoryRouter></QueryClientProvider>),
  };
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("RequestScansPage", () => {
  it("shows pending and processing jobs together in Active with truthful worker counts", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      const url = String(input);
      if (url.endsWith("/status")) return response(status);
      if (url.includes("?status=active")) return response({ jobs: [processingJob, pendingJob] });
      return response({ jobs: [] });
    });

    renderPage();

    expect(await screen.findByText("processing.jpg")).toBeTruthy();
    expect(screen.getByText("request.pdf")).toBeTruthy();
    expect(screen.getAllByText("Queued").length).toBe(2);
    expect(screen.getByText("Waiting for worker")).toBeTruthy();
    expect(screen.getAllByText("Processing").length).toBeGreaterThanOrEqual(2);
    expect(screen.getByRole("button", { name: "Active (2)" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Failed (1)" })).toBeTruthy();
    expect(screen.getByText("Idle")).toBeTruthy();
    expect(screen.getByText("Queued", { selector: "p" }).closest("section")?.textContent).toContain("1");
    expect(screen.getByText("Processing", { selector: "p" }).closest("section")?.textContent).toContain("1");
  });

  it("shows the active empty state without dropping the live queue view", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      const url = String(input);
      if (url.endsWith("/status")) return response({ ...status, pending: 0, processing: 0 });
      return response({ jobs: [] });
    });
    renderPage();
    expect(await screen.findByText("No active request scans. New scans and retries will appear here automatically.")).toBeTruthy();
  });

  it("queues one failed retry, switches to Active, and does not wait for worker completion", async () => {
    let resolveRetry!: (value: Response) => void;
    let activeJobs: typeof pendingJob[] = [];
    const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation((input) => {
      const url = String(input);
      if (url.endsWith("/status")) return Promise.resolve(response(status));
      if (url.includes("?status=failed")) return Promise.resolve(response({ jobs: [failedJob] }));
      if (url.includes("?status=active")) return Promise.resolve(response({ jobs: activeJobs }));
      if (url.endsWith("/9/retry")) {
        return new Promise<Response>((resolve) => {
          resolveRetry = resolve;
        });
      }
      return Promise.resolve(response({ jobs: [] }));
    });

    renderPage();
    fireEvent.click(await screen.findByRole("button", { name: "Failed (1)" }));
    expect(await screen.findByText("failed.jpg")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect((await screen.findByRole("button", { name: "Queuing..." })).hasAttribute("disabled")).toBe(true);

    activeJobs = [{ ...failedJob, status: "pending", error_message: null }];
    resolveRetry(response({ job: activeJobs[0], trigger: { status: "accepted" } }));

    expect(await screen.findByText("Retry queued. The worker will process this file.")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Active (2)" }).className).toContain("border-teal-600");
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith("/api/request-scans?status=active", expect.anything()));
    expect(await screen.findByText("failed.jpg")).toBeTruthy();
  });

  it("Run Now shows Starting only for the trigger request and then reports acceptance", async () => {
    let resolveRunNow!: (value: Response) => void;
    vi.spyOn(globalThis, "fetch").mockImplementation((input) => {
      const url = String(input);
      if (url.endsWith("/status")) return Promise.resolve(response({ ...status, pending: 0, processing: 0 }));
      if (url.endsWith("/run-now")) return new Promise<Response>((resolve) => { resolveRunNow = resolve; });
      return Promise.resolve(response({ jobs: [] }));
    });

    renderPage();
    fireEvent.click(await screen.findByRole("button", { name: "Scan folder now" }));
    expect((await screen.findByRole("button", { name: "Starting..." })).hasAttribute("disabled")).toBe(true);
    resolveRunNow(response({ ok: true, trigger: { status: "accepted" } }));
    expect(await screen.findByText("Request Scan worker start requested.")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Scan folder now" }).hasAttribute("disabled")).toBe(false);
  });

  it("retains failed recovery actions and manual assignment", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      const url = String(input);
      if (url.endsWith("/status")) return response(status);
      if (url.includes("eligible-appointments")) return response({ appointments: [{ id: 12, accession_number: "V2-000012", patient_name: "Patient" }] });
      if (url.includes("?status=failed")) return response({ jobs: [failedJob] });
      return response({ jobs: [] });
    });
    renderPage();
    fireEvent.click(await screen.findByRole("button", { name: "Failed (1)" }));
    await screen.findByText("failed.jpg");
    fireEvent.click(screen.getByRole("button", { name: "Manually assign" }));
    await screen.findByRole("option", { name: /V2-000012/ });
    await userEvent.setup().selectOptions(screen.getByRole("combobox"), "12");
    fireEvent.click(screen.getByRole("button", { name: "Attach and process" }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith(expect.stringContaining("/api/request-scans/9/manual-assign"), expect.objectContaining({ method: "POST" })));
  });

  it("loads PDF previews through a private Blob URL", async () => {
    const createObjectURL = vi.fn().mockReturnValue("blob:pdf-preview");
    const revokeObjectURL = vi.fn();
    vi.stubGlobal("URL", { ...URL, createObjectURL, revokeObjectURL });
    const blob = new Blob(["preview"], { type: "application/pdf" });
    const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      const url = String(input);
      if (url.endsWith("/status")) return response({ ...status, processing: 0 });
      if (url.includes("?status=active")) return response({ jobs: [pendingJob] });
      if (url.endsWith("/7/file")) return { ok: true, blob: async () => blob } as Response;
      return response({ jobs: [] });
    });
    renderPage();
    await screen.findByText("request.pdf");
    fireEvent.click(screen.getByRole("button", { name: "Preview" }));
    const frame = await screen.findByTitle("Request scan preview");
    expect(frame.getAttribute("src")).toBe("blob:pdf-preview");
    expect(fetchMock).toHaveBeenCalledWith("/api/request-scans/7/file", { credentials: "include" });
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(revokeObjectURL).toHaveBeenCalledWith("blob:pdf-preview");
  });

  it("shows unavailable status while retaining the Active job table", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      const url = String(input);
      if (url.endsWith("/status")) return { ok: false, json: async () => ({ error: { message: "Status service unavailable." } }) } as Response;
      if (url.includes("?status=active")) return response({ jobs: [pendingJob] });
      return response({ jobs: [] });
    });
    renderPage();
    expect((await screen.findAllByText("Unavailable")).length).toBe(2);
    expect(screen.getByText("Request Scan status could not be loaded: Status service unavailable.")).toBeTruthy();
    expect(await screen.findByText("request.pdf")).toBeTruthy();
  });

  it("uses fast work polling, slow idle polling, and no idle polling for history tabs", () => {
    expect(requestScanStatusPollInterval(status)).toBe(2_500);
    expect(requestScanStatusPollInterval({ ...status, running: false, pending: 0, processing: 0 })).toBe(15_000);
    expect(requestScanJobsPollInterval("active", status)).toBe(2_500);
    expect(requestScanJobsPollInterval("active", { ...status, pending: 0, processing: 0 })).toBe(15_000);
    expect(requestScanJobsPollInterval("processed", status)).toBe(15_000);
    expect(requestScanJobsPollInterval("processed", { ...status, pending: 0, processing: 0 })).toBe(false);
  });

  it("invalidates only Request Scan query keys", () => {
    const source = readFileSync(path.join(process.cwd(), "src/pages/request-scans/request-scans-page.tsx"), "utf8");
    const invalidations = [...source.matchAll(/invalidateQueries\(\{ queryKey: \[(.*?)\]/g)].map((match) => match[1]);
    expect(invalidations.length).toBeGreaterThan(0);
    expect(invalidations.every((key) => key.includes("request-scan"))).toBe(true);
    expect(source).not.toContain("window.location.reload");
    expect(source).not.toContain("navigate(0)");
  });
});
