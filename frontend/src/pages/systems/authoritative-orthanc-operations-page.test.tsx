import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Role } from "@/types/api";
import AuthoritativeOrthancOperationsPage from "./authoritative-orthanc-operations-page";
import { api } from "@/lib/api-client";

vi.mock("@/lib/api-client", () => ({ api: vi.fn() }));
let role: Role = "super_admin";
vi.mock("@/providers/auth-provider", () => ({ useAuth: () => ({ user: { id: 1, username: "operator", fullName: "Operator", role } }) }));

function fixture(state: "healthy" | "degraded" | "offline" | "disabled" = "healthy") {
  return {
    overallState: state,
    connectionState: state === "healthy" ? "connected" : state === "offline" ? "unavailable" : state,
    healthSentence: state === "healthy" ? "Routing healthy — 2/2 selected destinations are configured and no relevant failed DICOM Store jobs were found." : state === "degraded" ? "Operational attention is required: one route is missing." : state === "offline" ? "Authoritative Orthanc is unavailable." : "Authoritative Orthanc is disabled in Settings.",
    reasons: state === "healthy" ? [] : [{ code: state.toUpperCase(), message: state === "degraded" ? "One route is missing." : `Orthanc is ${state}.` }],
    system: state === "offline" || state === "disabled" ? null : { name: "ORTHANCPG", version: "1.12.4", apiVersion: "19", uptimeSeconds: null },
    statistics: { data: state === "offline" || state === "disabled" ? null : { studies: 12, series: 34, instances: 56, diskSizeBytes: 1073741824, diskSizeMb: 1024, uncompressedSizeBytes: 2147483648, uncompressedSizeMb: 2048 }, error: null },
    routing: { autoRouteEnabled: true, selected: 2, configured: state === "degraded" ? 1 : 2, missing: state === "degraded" ? 1 : 0, invalid: 0, error: null, routes: [
      { destinationKey: "SonicDICOM", destinationName: "SonicDICOM", alias: "rispro_route_sonicdicom", aet: "SONIC", host: "10.0.0.10", port: 104, selectedForAutoRouting: true, autoRouteActive: true, managedAliasExists: true, configurationState: "configured", configurationError: null, dicomTest: { state: state === "degraded" ? "reachable" : "not_tested", connected: state === "degraded" ? true : null, testedAt: state === "degraded" ? "2026-08-12T10:00:00.000Z" : null, code: null, message: null } },
      { destinationKey: "Backup PACS", destinationName: "Backup PACS", alias: "rispro_route_backup_pacs", aet: "BACKUP", host: "10.0.0.11", port: 11112, selectedForAutoRouting: true, autoRouteActive: true, managedAliasExists: state !== "degraded", configurationState: state === "degraded" ? "missing_managed_route" : "configured", configurationError: null, dicomTest: { state: state === "degraded" ? "unreachable" : "reachable", connected: state !== "degraded", testedAt: "2026-08-12T10:00:00.000Z", code: state === "degraded" ? "orthanc_timeout" : null, message: null } },
    ] },
    jobs: { error: null as { code: string; message: string } | null, summary: { total: 3, running: 1, pending: 0, failed: 1, successful: 1, paused: 0, recentRelevantFailed: state === "degraded" ? 1 : 0, recentFailureWindowHours: 24 }, items: [
      { id: "failed-job", type: "DicomModalityStore", state: "Failure", progress: 60, creationTime: "20260812T090000", startTime: null, completionTime: "20260812T090100", updatedAt: null, description: "REST API", error: "Connection failed.", retryPermitted: true, transfer: { remoteAet: "SONIC", localAet: "RISPRO", destinationName: "SonicDICOM", instanceCount: 220, failedInstanceCount: 2, parentResourceIds: ["series-1"], contextStatus: "resolved", study: { orthancStudyId: "study-1", patientId: "P-1042", patientName: "Sample Patient", accessionNumber: "ACC-1042", studyDate: "20260812", studyDescription: "CT chest", modalitiesInStudy: ["CT"] } } },
      { id: "running-job", type: "Archive", state: "Running", progress: 42, creationTime: "20260812T091000", startTime: null, completionTime: null, updatedAt: "20260812T091100", description: "Archive", error: null, retryPermitted: false, transfer: null },
      { id: "success-job", type: "DicomModalityStore", state: "Success", progress: 100, creationTime: "20260811T091000", startTime: null, completionTime: "20260812T215657.381990", updatedAt: null, description: "REST API", error: null, retryPermitted: false, transfer: { remoteAet: "SONIC", localAet: "RISPRO", destinationName: "SonicDICOM", instanceCount: 220, failedInstanceCount: null, parentResourceIds: ["series-1"], contextStatus: "resolved", study: { orthancStudyId: "study-1", patientId: "P-1042", patientName: "Sample Patient", accessionNumber: "ACC-1042", studyDate: "20260812", studyDescription: "CT chest", modalitiesInStudy: ["CT"] } } },
    ] },
    clinicalDocuments: { error: null, data: { pending: 2, processing: 1, retryable: 1, failed: 1, completed: 10, oldestPendingOrRetryableAt: "2026-08-12T08:00:00.000Z", latestFailures: [{ id: 88, appointmentId: 42, status: "failed", lastAttemptAt: "2026-08-12T09:00:00.000Z", updatedAt: "2026-08-12T09:00:00.000Z", error: "Upload failed.", retryPermitted: true }] } },
    generatedAt: "2026-08-12T10:00:00.000Z",
  };
}

let summary = fixture();
let historicalPacsStatus: {
  indexStatus: "ready" | "stale" | "unavailable" | "uninitialized"; runStatus: "idle" | "running" | "failed"; mode: "full" | "incremental" | null;
  indexedStudies: number; historicalPatientIds: number; orthancStudies: number | null; processed: number | null; total: number | null; progressPercent: number | null;
  startedAt: string | null; progressAt: string | null; lastSuccessAt: string | null; lastFullSyncAt: string | null; lastAttemptAt: string | null; lastChangeSequence: number | null; lastError: string | null;
};
function historicalPacsFixture() {
  return { indexStatus: "ready" as const, runStatus: "idle" as const, mode: null, indexedStudies: 31192, historicalPatientIds: 18406, orthancStudies: 31192, processed: null, total: null, progressPercent: null, startedAt: null, progressAt: "2026-08-17T00:32:00.000Z", lastSuccessAt: "2026-08-17T00:32:00.000Z", lastFullSyncAt: "2026-08-17T00:31:00.000Z", lastAttemptAt: "2026-08-17T00:32:00.000Z", lastChangeSequence: 284731, lastError: null };
}
function installApi() {
  vi.mocked(api).mockImplementation(async (path, options) => {
    if (path === "/integrations/authoritative-orthanc/operations/summary") return summary as never;
    if (path === "/integrations/authoritative-orthanc/operations/historical-pacs-index/status") return historicalPacsStatus as never;
    if (path.includes("/operations/studies/search")) return ({ status: "matched", matchKey: "accession_number", study: { orthancStudyId: "study-1", studyInstanceUid: "1.2.3", accessionNumber: "ACC-1", patientId: "P-1", patientName: "Sample Patient", patientBirthDate: "19900101", patientSex: "F", studyDate: "20260812", studyDescription: "CT chest", modalitiesInStudy: ["CT"], seriesCount: 2, instanceCount: 50 } }) as never;
    if (options?.method === "POST") return {} as never;
    throw new Error(`Unexpected API call ${path}`);
  });
}
function renderPage() { return render(<MemoryRouter><QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })}><AuthoritativeOrthancOperationsPage/></QueryClientProvider></MemoryRouter>); }

beforeEach(() => { role = "super_admin"; summary = fixture(); historicalPacsStatus = historicalPacsFixture(); vi.clearAllMocks(); installApi(); });

describe("AuthoritativeOrthancOperationsPage", () => {
  it("renders the ready Historical PACS index metrics and triggers Sync now", async () => {
    renderPage();
    expect(await screen.findByTestId("historical-pacs-index-card")).toBeTruthy();
    for (const text of ["Historical PACS Index", "Ready", "31,192", "18,406", "284,731", "No synchronization errors"]) expect(screen.getAllByText(text).length).toBeGreaterThan(0);
    await userEvent.click(screen.getByRole("button", { name: "Sync now" }));
    await waitFor(() => expect(api).toHaveBeenCalledWith("/integrations/authoritative-orthanc/operations/historical-pacs-index/sync", expect.objectContaining({ method: "POST" })));
  });

  it("renders full progress, an unknown total without a fake percentage, and incremental progress", async () => {
    historicalPacsStatus = { ...historicalPacsFixture(), runStatus: "running", mode: "full", processed: 18000, total: 31192, progressPercent: 57.7, startedAt: "2026-08-17T00:00:00.000Z" };
    const view = renderPage();
    expect(await screen.findByText("Full synchronization in progress")).toBeTruthy();
    expect(screen.getByText("18,000 / 31,192 studies · 57.7%")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Sync now" }).hasAttribute("disabled")).toBe(true);
    view.unmount();
    historicalPacsStatus = { ...historicalPacsStatus, total: null, progressPercent: null };
    const unknown = renderPage();
    expect(await screen.findByText("18,000 studies processed")).toBeTruthy();
    expect(screen.queryByText("57.7%")).toBeNull();
    unknown.unmount();
    historicalPacsStatus = { ...historicalPacsFixture(), runStatus: "running", mode: "incremental", processed: 0 };
    renderPage();
    expect(await screen.findByText("Incremental synchronization in progress")).toBeTruthy();
  });

  it("shows stale and failed warnings safely and confirms full reconciliation", async () => {
    historicalPacsStatus = { ...historicalPacsFixture(), indexStatus: "stale", runStatus: "failed", mode: "full", processed: 1000, lastError: "Orthanc inventory request failed." };
    renderPage();
    expect(await screen.findByText("Failed", { selector: "span" })).toBeTruthy();
    expect(screen.getByText("Orthanc inventory request failed.")).toBeTruthy();
    expect(screen.getByText(/absence in PACS is not definitive/)).toBeTruthy();
    await userEvent.click(screen.getByRole("button", { name: "Run full reconciliation" }));
    const dialog = screen.getByRole("dialog");
    expect(within(dialog).getByText(/read the complete Authoritative Orthanc study inventory/)).toBeTruthy();
    await userEvent.click(within(dialog).getByRole("button", { name: "Run full reconciliation" }));
    await waitFor(() => expect(api).toHaveBeenCalledWith("/integrations/authoritative-orthanc/operations/historical-pacs-index/full-reconciliation", expect.objectContaining({ method: "POST" })));
  });

  it.each(["healthy", "degraded", "offline", "disabled"] as const)("renders the %s state without crashing", async (state) => {
    summary = fixture(state);
    renderPage();
    expect(await screen.findByText(state[0].toUpperCase() + state.slice(1))).toBeTruthy();
    expect(screen.getByTestId("authoritative-orthanc-operations-page")).toBeTruthy();
    if (state === "offline" || state === "disabled") expect(screen.getAllByText("Unavailable").length).toBeGreaterThan(0);
  });

  it("shows routing configuration and keeps Not tested distinct from failed", async () => {
    renderPage();
    expect(await screen.findByText("rispro_route_sonicdicom")).toBeTruthy();
    expect(screen.getByText("Not tested")).toBeTruthy();
    expect(screen.queryByText("Failed", { selector: "span" })).toBeNull();
  });

  it("runs individual and Test All C-ECHO actions while preserving partial-failure results", async () => {
    renderPage();
    const row = (await screen.findByText("rispro_route_sonicdicom")).closest("tr")!;
    await userEvent.click(within(row).getByRole("button", { name: "Test" }));
    await waitFor(() => expect(api).toHaveBeenCalledWith("/integrations/authoritative-orthanc/operations/routes/rispro_route_sonicdicom/test", expect.objectContaining({ method: "POST" })));
    summary = fixture("degraded");
    await userEvent.click(screen.getAllByRole("button", { name: "Test all destinations" })[0]!);
    await waitFor(() => expect(api).toHaveBeenCalledWith("/integrations/authoritative-orthanc/operations/routes/test-all", expect.objectContaining({ method: "POST" })));
    await waitFor(() => expect(screen.getByText("Unreachable")).toBeTruthy());
    expect(screen.getByText("Reachable")).toBeTruthy();
  });

  it("filters jobs and confirms a failed-job retry", async () => {
    renderPage();
    await screen.findByText("failed-job", { exact: false }).catch(() => undefined);
    await userEvent.click(screen.getByRole("button", { name: "Successful" }));
    expect(screen.getByText("CT chest")).toBeTruthy();
    expect(screen.queryByText("REST API")).toBeNull();
    await userEvent.click(screen.getByRole("button", { name: "Failed" }));
    await userEvent.click(screen.getAllByRole("button", { name: "Retry" })[0]!);
    expect(screen.getByRole("dialog")).toBeTruthy();
    await userEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Confirm" }));
    await waitFor(() => expect(api).toHaveBeenCalledWith("/integrations/authoritative-orthanc/operations/jobs/failed-job/retry", expect.objectContaining({ method: "POST" })));
  });

  it("handles found, not found, and ambiguous study lookup states", async () => {
    renderPage();
    await screen.findByText("Study lookup");
    await userEvent.type(screen.getByLabelText("Study lookup value"), "ACC-1");
    await userEvent.click(screen.getByRole("button", { name: /Search/ }));
    expect((await screen.findAllByText("Sample Patient")).length).toBeGreaterThan(0);
    vi.mocked(api).mockImplementation(async (path) => path.includes("studies/search") ? ({ status: "not_found", matchKey: "accession_number", study: null }) as never : summary as never);
    await userEvent.click(screen.getByRole("button", { name: /Search/ }));
    expect(await screen.findByText("No study matched that identifier.")).toBeTruthy();
    vi.mocked(api).mockImplementation(async (path) => path.includes("studies/search") ? ({ status: "ambiguous", matchKey: "accession_number", reason: "multiple_studies", study: null }) as never : summary as never);
    await userEvent.click(screen.getByRole("button", { name: /Search/ }));
    expect(await screen.findByText(/Multiple or conflicting studies/)).toBeTruthy();
  });

  it("shows transfer context and technical details while safely handling unavailable context", async () => {
    summary = fixture();
    summary.jobs.items.push({ id: "unknown-context", type: "DicomModalityStore", state: "Success", progress: 100, creationTime: "20260812T100000", startTime: null, completionTime: null, updatedAt: null, description: "REST API", error: null, retryPermitted: false, transfer: { remoteAet: "UNKNOWN", localAet: "RISPRO", destinationName: "UNKNOWN", instanceCount: null, failedInstanceCount: null, parentResourceIds: [], contextStatus: "unavailable", study: null } } as never);
    renderPage();
    expect(await screen.findByText("Recent DICOM transfers")).toBeTruthy();
    for (const text of ["Sample Patient", "P-1042", "ACC-1042", "CT chest", "CT", "SonicDICOM", "220 instances", "Connection failed.", "Context unavailable"]) expect(screen.getAllByText(text).length).toBeGreaterThan(0);
    expect(screen.queryByText("Archive")).toBeNull();
    expect(screen.queryByText("DicomModalityStore")).toBeNull();
    expect(screen.queryByText("20260812T215657.381990")).toBeNull();
    await userEvent.click(screen.getAllByRole("button", { name: "Details" })[0]!);
    const dialog = screen.getByRole("dialog");
    for (const text of ["failed-job", "DicomModalityStore", "RISPRO", "SONIC", "REST API"]) expect(within(dialog).getAllByText(text, { exact: false }).length).toBeGreaterThan(0);
  });

  it("matches privileged actions to role and exposes clinical-document recovery", async () => {
    role = "modality_staff";
    const view = renderPage();
    await screen.findByText("Routing destinations");
    expect(screen.queryByRole("button", { name: "Test all destinations" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Synchronize routes" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Retry" })).toBeNull();
    expect(screen.getAllByRole("button", { name: "Details" }).length).toBeGreaterThan(0);
    view.unmount();
    role = "super_admin";
    renderPage();
    await screen.findByText("Clinical-document export health");
    await userEvent.click(screen.getByRole("button", { name: "Reconcile exports" }));
    await userEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Confirm" }));
    await waitFor(() => expect(api).toHaveBeenCalledWith("/integrations/authoritative-orthanc/document-exports/reconcile", expect.objectContaining({ method: "POST" })));
  });

  it("keeps other sections useful when the jobs section fails", async () => {
    summary = { ...fixture(), jobs: { ...fixture().jobs, items: [], error: { code: "orthanc_invalid_response", message: "Orthanc jobs are unavailable." } } };
    renderPage();
    expect(await screen.findByText("Orthanc jobs are unavailable.")).toBeTruthy();
    expect(screen.getByText("Routing destinations")).toBeTruthy();
    expect(screen.getByText("Study lookup")).toBeTruthy();
  });
});
