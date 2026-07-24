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
  workerOnline: true,
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

  it("queues one failed retry, remains on Failed, and does not wait for worker completion", async () => {
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

    expect(await screen.findByText("failed.jpg was queued for retry.")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Failed (1)" }).className).toContain("border-teal-600");
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith("/api/request-scans?status=failed", expect.anything()));
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

  it("stops only an eligible recognition job after confirmation and hides Stop at attachment", async () => {
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(true);
    const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      const url = String(input);
      if (url.endsWith("/status")) return response(status);
      if (url.includes("?status=active")) return response({ jobs: [{ ...processingJob, processing_stage: "scanning_original_300_dpi", attachment_completed_at: null }, { ...processingJob, id: 10, filename: "attaching.pdf", processing_stage: "attaching_document" }] });
      if (url.endsWith("/8/stop")) return response({ job: { ...processingJob, cancel_requested_at: new Date().toISOString() } });
      return response({ jobs: [] });
    });
    renderPage();
    await screen.findByText("processing.jpg");
    expect(screen.getAllByRole("button", { name: "Stop" })).toHaveLength(1);
    fireEvent.click(screen.getByRole("button", { name: "Stop" }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith("/api/request-scans/8/stop", expect.objectContaining({ method: "POST" })));
    expect(confirm).toHaveBeenCalledOnce();
    expect(await screen.findByText("Automatic scanning was stopped. The document is ready for manual assignment.")).toBeTruthy();
  });

  it("does not request Stop when confirmation is cancelled", async () => {
    vi.spyOn(window, "confirm").mockReturnValue(false);
    const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      const url = String(input);
      if (url.endsWith("/status")) return response(status);
      if (url.includes("?status=active")) return response({ jobs: [{ ...processingJob, processing_stage: "verifying_identifier" }] });
      return response({ jobs: [] });
    });
    renderPage();
    fireEvent.click(await screen.findByRole("button", { name: "Stop" }));
    expect(fetchMock.mock.calls.some(([input]) => String(input).endsWith("/8/stop"))).toBe(false);
  });

  it("shows the server conflict when attachment wins the Stop race", async () => {
    vi.spyOn(window, "confirm").mockReturnValue(true);
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      const url = String(input);
      if (url.endsWith("/status")) return response(status);
      if (url.includes("?status=active")) return response({ jobs: [{ ...processingJob, processing_stage: "verifying_identifier" }] });
      if (url.endsWith("/8/stop")) return { ok: false, status: 409, json: async () => ({ error: { message: "Automatic scanning can no longer be stopped because document attachment or completion has already begun." } }) } as Response;
      return response({ jobs: [] });
    });
    renderPage();
    fireEvent.click(await screen.findByRole("button", { name: "Stop" }));
    expect(await screen.findByText("Automatic scanning can no longer be stopped because document attachment or completion has already begun.")).toBeTruthy();
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
  it("uses Resume archive and hides Return after attachment", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      const url = String(input); if (url.endsWith("/status")) return response(status);
      if (url.includes("?status=failed")) return response({ jobs: [{ ...failedJob, attachment_completed_at: "2026-07-24T10:00:00Z", document_id: 55 }] });
      return response({ jobs: [] });
    });
    renderPage(); fireEvent.click(await screen.findByRole("button", { name: "Failed (1)" })); await screen.findByText("failed.jpg");
    expect(screen.getByText("Document attached. Archive pending.")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Resume archive" })).toBeTruthy(); expect(screen.queryByRole("button", { name: "Return" })).toBeNull();
  });

  it("shows one document linked to several appointments without exposing token data", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      const url = String(input); if (url.endsWith("/status")) return response(status);
      if (url.includes("?status=active")) return response({ jobs: [{ ...processingJob, appointment_id: 21, matchedAppointments: [{ id: 21, accessionNumber: "V2-000021", patientId: 5, examination: "CT head" }, { id: 22, accessionNumber: "V2-000022", patientId: 5, examination: "MRI brain" }] }] });
      return response({ jobs: [] });
    });
    renderPage();
    expect(await screen.findByText("Attached to 2 appointments")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Appointments (2)" }));
    expect(screen.getByText("V2-000021")).toBeTruthy(); expect(screen.getByText("V2-000022")).toBeTruthy();
    expect(screen.queryByText(/token|pa_/i)).toBeNull();
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
  it("shows development reset only when enabled and requires exact confirmation", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      const url = String(input);
      if (url.endsWith("/status")) return response({ ...status, devResetEnabled: true });
      if (url.endsWith("/dev-reset/preview")) return response({ enabled: true, jobs: 2, pending: 0, processing: 0, failed: 2, processed: 0, duplicates: 0, automatedDocuments: 1, filesIncoming: 0, filesProcessed: 1, filesFailed: 1, pathConflicts: 0 });
      if (url.endsWith("/dev-reset")) return response({ completed: true });
      return response({ jobs: [] });
    });
    renderPage(); const button = await screen.findByRole("button", { name: "Reset Request Scan development data" }); expect(button.hasAttribute("disabled")).toBe(true);
    fireEvent.change(screen.getByLabelText(/Type RESET REQUEST SCANS/), { target: { value: "RESET REQUEST SCANS" } }); expect(button.hasAttribute("disabled")).toBe(false); fireEvent.click(button);
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith("/api/request-scans/dev-reset", expect.objectContaining({ method: "POST" })));
    expect(await screen.findByText("Request Scan development data was reset. Incoming files will be discovered as new jobs.")).toBeTruthy();
  });
});
