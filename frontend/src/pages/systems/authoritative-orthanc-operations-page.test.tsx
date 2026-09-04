import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Role } from "@/types/api";
import AuthoritativeOrthancOperationsPage from "./authoritative-orthanc-operations-page";
import { api } from "@/lib/api-client";
import { formatDateTimeLy, tripoliDateTimeLocalToIso } from "@/lib/date-format";

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
  startedAt: string | null; progressAt: string | null; isStalled: boolean; stalledForSeconds: number | null; lastSuccessAt: string | null; lastFullSyncAt: string | null; lastAttemptAt: string | null; lastChangeSequence: number | null; lastError: string | null;
};
function historicalPacsFixture() {
  return { indexStatus: "ready" as const, runStatus: "idle" as const, mode: null, indexedStudies: 31192, historicalPatientIds: 18406, orthancStudies: 31192, processed: null, total: null, progressPercent: null, startedAt: null, progressAt: "2026-08-17T00:32:00.000Z", isStalled: false, stalledForSeconds: null, lastSuccessAt: "2026-08-17T00:32:00.000Z", lastFullSyncAt: "2026-08-17T00:31:00.000Z", lastAttemptAt: "2026-08-17T00:32:00.000Z", lastChangeSequence: 284731, lastError: null };
}
type HistoryItem = {
  id: string;
  direction: "RECEIVED" | "SENT";
  status: "ACTIVE" | "SUCCESS" | "FAILED";
  patientId: string | null;
  patientName: string | null;
  accessionNumber: string | null;
  studyInstanceUid: string;
  studyDescription: string | null;
  sourceAet: string | null;
  sourceIp: string | null;
  destinationAet: string | null;
  instanceCount: number | null;
  firstSeenAt: string;
  lastSeenAt: string;
  completedAt: string | null;
  occurredAt: string;
  errorCode: string | null;
  errorMessage: string | null;
  orthancJobId: string | null;
  orthancChangeSequence: number | null;
  orthancResourceId: string | null;
  createdAt: string;
  updatedAt: string;
};
type HistoryResponse = { items: HistoryItem[]; page: number; pageSize: 25 | 50 | 100; total: number; totalPages: number };
type StudyHistoryItem = {
  studyInstanceUid: string;
  patientId: string | null;
  patientName: string | null;
  accessionNumber: string | null;
  studyDescription: string | null;
  received: { count: number; successful: number; active: number; failed: number; sources: string[]; latestAt: string | null };
  sent: { count: number; successful: number; active: number; failed: number; destinations: string[]; latestAt: string | null };
  eventCount: number;
  firstActivityAt: string;
  lastActivityAt: string;
};
type StudyHistoryResponse = { items: StudyHistoryItem[]; page: number; pageSize: 25 | 50 | 100; total: number; totalPages: number };
function historyFixture(): HistoryResponse {
  return {
    items: [{ id: "history-1", direction: "RECEIVED", status: "SUCCESS", patientId: "PAT-1042", patientName: "History Patient", accessionNumber: "HIST-ACC-1042", studyInstanceUid: "1.2.840.10008.1.2.3.1042", studyDescription: "History CT chest", sourceAet: "MODALITY_AET", sourceIp: "192.0.2.42", destinationAet: "ORTHANCPG", instanceCount: 1234, firstSeenAt: "2026-08-12T08:00:00.000Z", lastSeenAt: "2026-08-12T08:15:00.000Z", completedAt: "2026-08-12T08:15:00.000Z", occurredAt: "2026-08-12T08:15:00.000Z", errorCode: null, errorMessage: null, orthancJobId: null, orthancChangeSequence: 1042, orthancResourceId: "resource-1042", createdAt: "2026-08-12T08:00:00.000Z", updatedAt: "2026-08-12T08:15:00.000Z" }],
    page: 1,
    pageSize: 25,
    total: 1,
    totalPages: 1,
  };
}
function studyHistoryFixture(): StudyHistoryResponse {
  return {
    items: [{ studyInstanceUid: "1.2.840.10008.1.2.3.104200000000000000000000000000", patientId: "STUDY-PAT-1042", patientName: "Study Patient", accessionNumber: "STUDY-ACC-1042", studyDescription: "Study MRI brain", received: { count: 3, successful: 2, active: 0, failed: 1, sources: ["BROKER", "CT99"], latestAt: "2026-08-12T08:15:00.000Z" }, sent: { count: 2, successful: 1, active: 0, failed: 1, destinations: ["OSIRIXR", "PACS1"], latestAt: "2026-08-12T09:15:00.000Z" }, eventCount: 5, firstActivityAt: "2026-08-12T08:00:00.000Z", lastActivityAt: "2026-08-12T09:15:00.000Z" }],
    page: 1,
    pageSize: 25,
    total: 51,
    totalPages: 3,
  };
}
let historyResponse = historyFixture();
let studyHistoryResponse = studyHistoryFixture();
let historyError = false;
function installApi() {
  vi.mocked(api).mockImplementation(async (path, options) => {
    if (path === "/integrations/authoritative-orthanc/operations/summary") return summary as never;
    if (path === "/integrations/authoritative-orthanc/operations/historical-pacs-index/status") return historicalPacsStatus as never;
    if (path.includes("/operations/dicom-transfer-history")) {
      if (historyError) throw new Error("History unavailable.");
      const params = new URL(`http://test${path}`).searchParams;
      const pageSize = Number(params.get("pageSize"));
      if (params.get("view") === "studies") return { ...studyHistoryResponse, page: Number(params.get("page")), pageSize, totalPages: studyHistoryResponse.total === 0 ? 0 : Math.ceil(studyHistoryResponse.total / pageSize) } as never;
      return { ...historyResponse, page: Number(params.get("page")), pageSize, totalPages: historyResponse.total === 0 ? 0 : Math.ceil(historyResponse.total / pageSize) } as never;
    }
    if (path.includes("/operations/studies/search")) return ({ status: "matched", matchKey: "accession_number", study: { orthancStudyId: "study-1", studyInstanceUid: "1.2.3", accessionNumber: "ACC-1", patientId: "P-1", patientName: "Sample Patient", patientBirthDate: "19900101", patientSex: "F", studyDate: "20260812", studyDescription: "CT chest", modalitiesInStudy: ["CT"], seriesCount: 2, instanceCount: 50 } }) as never;
    if (options?.method === "POST") return {} as never;
    throw new Error(`Unexpected API call ${path}`);
  });
}
function renderPage() { return render(<MemoryRouter><QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })}><AuthoritativeOrthancOperationsPage/></QueryClientProvider></MemoryRouter>); }
async function openTransferHistory() { await userEvent.click(screen.getByRole("tab", { name: "Transfer History" })); }

beforeEach(() => { role = "super_admin"; summary = fixture(); historicalPacsStatus = historicalPacsFixture(); historyResponse = historyFixture(); studyHistoryResponse = studyHistoryFixture(); historyError = false; vi.clearAllMocks(); installApi(); });

describe("AuthoritativeOrthancOperationsPage", () => {
  it("defaults to Operations and loads transfer history only when selected", async () => {
    renderPage();
    const operationsTab = screen.getByRole("tab", { name: "Operations" });
    const historyTab = screen.getByRole("tab", { name: "Transfer History" });
    expect(operationsTab.getAttribute("aria-selected")).toBe("true");
    expect(historyTab.getAttribute("aria-selected")).toBe("false");
    expect(await screen.findByText("Routing destinations")).toBeTruthy();
    expect(screen.queryByTestId("dicom-transfer-history-card")).toBeNull();
    expect(vi.mocked(api).mock.calls.some(([path]) => path.includes("/operations/dicom-transfer-history"))).toBe(false);

    await openTransferHistory();
    expect(await screen.findByTestId("dicom-transfer-history-card")).toBeTruthy();
    await waitFor(() => expect(api).toHaveBeenCalledWith("/integrations/authoritative-orthanc/operations/dicom-transfer-history?direction=all&status=all&page=1&pageSize=25"));
    expect(screen.queryByText("Routing destinations")).toBeNull();

    await userEvent.click(operationsTab);
    expect(await screen.findByText("Routing destinations")).toBeTruthy();
    expect(screen.queryByTestId("dicom-transfer-history-card")).toBeNull();
  });

  it("requests default durable history and renders the received stable row", async () => {
    renderPage();
    await openTransferHistory();
    const card = await screen.findByTestId("dicom-transfer-history-card");
    await waitFor(() => expect(api).toHaveBeenCalledWith("/integrations/authoritative-orthanc/operations/dicom-transfer-history?direction=all&status=all&page=1&pageSize=25"));
    const historyViews = within(card).getByRole("group", { name: "History views" });
    expect((within(historyViews).getByRole("button", { name: "Transfers" }) as HTMLButtonElement).getAttribute("aria-pressed")).toBe("true");
    expect((within(historyViews).getByRole("button", { name: "Studies" }) as HTMLButtonElement).getAttribute("aria-pressed")).toBe("false");
    for (const heading of ["Direction", "Status", "Patient", "Accession", "Study", "Source", "Destination", "Instances", "Time"]) expect(within(card).getByRole("columnheader", { name: heading })).toBeTruthy();
    for (const text of ["Received", "Received / stable", "History Patient", "PAT-1042", "HIST-ACC-1042", "History CT chest", "MODALITY_AET", "192.0.2.42", "ORTHANCPG", "1,234", formatDateTimeLy("2026-08-12T08:15:00.000Z")]) expect(within(card).getAllByText(text, { exact: true }).length).toBeGreaterThan(0);
  });

  it("applies direction and status immediately and resets the history page", async () => {
    historyResponse = { ...historyFixture(), total: 51, totalPages: 3 };
    renderPage();
    await openTransferHistory();
    const card = await screen.findByTestId("dicom-transfer-history-card");
    await userEvent.click(within(card).getByRole("button", { name: "Next" }));
    await waitFor(() => expect(api).toHaveBeenCalledWith("/integrations/authoritative-orthanc/operations/dicom-transfer-history?direction=all&status=all&page=2&pageSize=25"));
    await userEvent.click(within(card).getByRole("button", { name: /^Received$/ }));
    await waitFor(() => expect(api).toHaveBeenCalledWith("/integrations/authoritative-orthanc/operations/dicom-transfer-history?direction=received&status=all&page=1&pageSize=25"));
    await userEvent.click(within(card).getByRole("button", { name: /^Sent$/ }));
    await waitFor(() => expect(api).toHaveBeenCalledWith("/integrations/authoritative-orthanc/operations/dicom-transfer-history?direction=sent&status=all&page=1&pageSize=25"));
    await userEvent.click(within(card).getByRole("button", { name: /^Failed$/ }));
    await waitFor(() => expect(api).toHaveBeenCalledWith("/integrations/authoritative-orthanc/operations/dicom-transfer-history?direction=sent&status=failed&page=1&pageSize=25"));
  });

  it("holds draft text filters until Apply and sends trimmed values", async () => {
    renderPage();
    await openTransferHistory();
    const card = await screen.findByTestId("dicom-transfer-history-card");
    await userEvent.type(within(card).getByLabelText("Search"), "  patient phrase  ");
    await userEvent.type(within(card).getByLabelText("Source"), "  SOURCE-AET  ");
    await userEvent.type(within(card).getByLabelText("Destination"), "  DEST-AET  ");
    expect(vi.mocked(api).mock.calls.some(([path]) => path.includes("patient+phrase") || path.includes("SOURCE-AET") || path.includes("DEST-AET"))).toBe(false);
    await userEvent.click(within(card).getByRole("button", { name: "Apply filters" }));
    const expected = new URLSearchParams({ direction: "all", status: "all", page: "1", pageSize: "25", search: "patient phrase", source: "SOURCE-AET", destination: "DEST-AET" });
    await waitFor(() => expect(api).toHaveBeenCalledWith(`/integrations/authoritative-orthanc/operations/dicom-transfer-history?${expected.toString()}`));
  });

  it("converts Tripoli datetime-local filters before requesting history", async () => {
    renderPage();
    await openTransferHistory();
    const card = await screen.findByTestId("dicom-transfer-history-card");
    const from = "2026-08-12T10:30";
    const to = "2026-08-12T12:45";
    await userEvent.type(within(card).getByLabelText("From"), from);
    await userEvent.type(within(card).getByLabelText("To"), to);
    await userEvent.click(within(card).getByRole("button", { name: "Apply filters" }));
    const expected = new URLSearchParams({ direction: "all", status: "all", page: "1", pageSize: "25", from: tripoliDateTimeLocalToIso(from)!, to: tripoliDateTimeLocalToIso(to)! });
    await waitFor(() => expect(api).toHaveBeenCalledWith(`/integrations/authoritative-orthanc/operations/dicom-transfer-history?${expected.toString()}`));
  });

  it("clears history filters while preserving the selected page size", async () => {
    renderPage();
    await openTransferHistory();
    const card = await screen.findByTestId("dicom-transfer-history-card");
    await userEvent.selectOptions(within(card).getByLabelText("History page size"), "50");
    await waitFor(() => expect(api).toHaveBeenCalledWith("/integrations/authoritative-orthanc/operations/dicom-transfer-history?direction=all&status=all&page=1&pageSize=50"));
    await userEvent.click(within(card).getByRole("button", { name: /^Sent$/ }));
    await userEvent.type(within(card).getByLabelText("Search"), "history");
    await userEvent.type(within(card).getByLabelText("Source"), "source");
    await userEvent.type(within(card).getByLabelText("Destination"), "destination");
    await userEvent.type(within(card).getByLabelText("From"), "2026-08-12T10:30");
    await userEvent.type(within(card).getByLabelText("To"), "2026-08-12T12:45");
    await userEvent.click(within(card).getByRole("button", { name: "Apply filters" }));
    await userEvent.click(within(card).getByRole("button", { name: "Clear filters" }));
    await waitFor(() => expect(api).toHaveBeenCalledWith("/integrations/authoritative-orthanc/operations/dicom-transfer-history?direction=all&status=all&page=1&pageSize=50"));
    expect((within(card).getByLabelText("Search") as HTMLInputElement).value).toBe("");
    const directionFilters = within(card).getByRole("group", { name: "Direction filters" });
    expect((within(directionFilters).getByRole("button", { name: /^All$/ }) as HTMLButtonElement).getAttribute("aria-pressed")).toBe("true");
    expect((within(directionFilters).getByRole("button", { name: /^Sent$/ }) as HTMLButtonElement).getAttribute("aria-pressed")).toBe("false");
    const statusFilters = within(card).getByRole("group", { name: "Status filters" });
    expect((within(statusFilters).getByRole("button", { name: /^All$/ }) as HTMLButtonElement).getAttribute("aria-pressed")).toBe("true");
    for (const label of ["Source", "Destination", "From", "To"]) expect((within(card).getByLabelText(label) as HTMLInputElement).value).toBe("");
    expect((within(card).getByLabelText("History page size") as HTMLSelectElement).value).toBe("50");
  });

  it("uses server pagination and page-size changes without slicing client-side", async () => {
    historyResponse = { ...historyFixture(), total: 51, totalPages: 3 };
    renderPage();
    await openTransferHistory();
    const card = await screen.findByTestId("dicom-transfer-history-card");
    await userEvent.click(within(card).getByRole("button", { name: "Next" }));
    await waitFor(() => expect(api).toHaveBeenCalledWith("/integrations/authoritative-orthanc/operations/dicom-transfer-history?direction=all&status=all&page=2&pageSize=25"));
    expect(within(card).getByText("Showing 26–50 of 51 transfers")).toBeTruthy();
    expect(within(card).getByText("Page 2 of 3")).toBeTruthy();
    await userEvent.click(within(card).getByRole("button", { name: "Previous" }));
    await waitFor(() => expect(api).toHaveBeenCalledWith("/integrations/authoritative-orthanc/operations/dicom-transfer-history?direction=all&status=all&page=1&pageSize=25"));
    expect(within(card).getByText("Showing 1–25 of 51 transfers")).toBeTruthy();
    await userEvent.selectOptions(within(card).getByLabelText("History page size"), "50");
    await waitFor(() => expect(api).toHaveBeenCalledWith("/integrations/authoritative-orthanc/operations/dicom-transfer-history?direction=all&status=all&page=1&pageSize=50"));
    expect(within(card).getByText("Page 1 of 2")).toBeTruthy();
  });

  it("switches server-grouped views while preserving filters and resetting the page", async () => {
    historyResponse = { ...historyFixture(), total: 51, totalPages: 3 };
    renderPage();
    await openTransferHistory();
    const card = await screen.findByTestId("dicom-transfer-history-card");
    await userEvent.type(within(card).getByLabelText("Search"), "kept search");
    await userEvent.type(within(card).getByLabelText("Source"), "BROKER");
    await userEvent.type(within(card).getByLabelText("Destination"), "PACS1");
    await userEvent.click(within(card).getByRole("button", { name: "Apply filters" }));
    await userEvent.click(within(card).getByRole("button", { name: "Next" }));
    await waitFor(() => expect(api).toHaveBeenCalledWith(`/integrations/authoritative-orthanc/operations/dicom-transfer-history?${new URLSearchParams({ direction: "all", status: "all", page: "2", pageSize: "25", search: "kept search", source: "BROKER", destination: "PACS1" }).toString()}`));
    await userEvent.click(within(card).getByRole("button", { name: "Studies" }));
    const expectedStudies = new URLSearchParams({ direction: "all", status: "all", page: "1", pageSize: "25", search: "kept search", source: "BROKER", destination: "PACS1", view: "studies" });
    await waitFor(() => expect(api).toHaveBeenCalledWith(`/integrations/authoritative-orthanc/operations/dicom-transfer-history?${expectedStudies.toString()}`));
    expect((within(card).getByLabelText("Search") as HTMLInputElement).value).toBe("kept search");
    expect((within(card).getByLabelText("Source") as HTMLInputElement).value).toBe("BROKER");
    expect((within(card).getByLabelText("Destination") as HTMLInputElement).value).toBe("PACS1");
    for (const heading of ["Patient", "Accession", "Study", "Received", "Sent", "Events", "Last activity"]) expect(within(card).getByRole("columnheader", { name: heading })).toBeTruthy();
    expect(within(card).getByText("Showing 1\u201325 of 51 studies")).toBeTruthy();
    await userEvent.click(within(card).getByRole("button", { name: "Next" }));
    await waitFor(() => expect(api).toHaveBeenCalledWith(`/integrations/authoritative-orthanc/operations/dicom-transfer-history?${new URLSearchParams({ direction: "all", status: "all", page: "2", pageSize: "25", search: "kept search", source: "BROKER", destination: "PACS1", view: "studies" }).toString()}`));
    await userEvent.selectOptions(within(card).getByLabelText("History page size"), "50");
    await waitFor(() => expect(api).toHaveBeenCalledWith(`/integrations/authoritative-orthanc/operations/dicom-transfer-history?${new URLSearchParams({ direction: "all", status: "all", page: "1", pageSize: "50", search: "kept search", source: "BROKER", destination: "PACS1", view: "studies" }).toString()}`));
    expect(within(card).getByText("Page 1 of 2")).toBeTruthy();
    await userEvent.click(within(card).getByRole("button", { name: "Transfers" }));
    await waitFor(() => expect(api).toHaveBeenCalledWith(`/integrations/authoritative-orthanc/operations/dicom-transfer-history?${new URLSearchParams({ direction: "all", status: "all", page: "1", pageSize: "50", search: "kept search", source: "BROKER", destination: "PACS1" }).toString()}`));
    expect(within(card).getByRole("columnheader", { name: "Direction" })).toBeTruthy();
    expect(within(card).getByText("History Patient")).toBeTruthy();
    expect((within(card).getByLabelText("Search") as HTMLInputElement).value).toBe("kept search");
  });

  it("renders grouped study metadata, status summaries, destinations, counts, and Tripoli time", async () => {
    renderPage();
    await openTransferHistory();
    const card = await screen.findByTestId("dicom-transfer-history-card");
    await userEvent.click(within(card).getByRole("button", { name: "Studies" }));
    const studyRow = (await within(card).findByText("Study Patient")).closest("tr")!;
    for (const text of ["Study Patient", "STUDY-PAT-1042", "STUDY-ACC-1042", "Study MRI brain", "3 received", "BROKER · CT99", "1 failed", "1 successful · 1 failed", "OSIRIXR · PACS1", "5", formatDateTimeLy("2026-08-12T09:15:00.000Z")]) expect(within(studyRow).getAllByText(text, { exact: true }).length).toBeGreaterThan(0);
    const uid = "1.2.840.10008.1.2.3.104200000000000000000000000000";
    expect(studyRow.querySelector(`[title="${uid}"]`)).toBeTruthy();
    expect(within(studyRow).getByText("1 successful · 1 failed").className).toContain("text-red-700");
  });

  it("renders an em dash for studies with no sent events and the exact studies empty state", async () => {
    studyHistoryResponse = { ...studyHistoryFixture(), items: [{ ...studyHistoryFixture().items[0]!, sent: { count: 0, successful: 0, active: 0, failed: 0, destinations: [], latestAt: null } }], total: 1, totalPages: 1 };
    const populatedView = renderPage();
    await openTransferHistory();
    const card = await screen.findByTestId("dicom-transfer-history-card");
    await userEvent.click(within(card).getByRole("button", { name: "Studies" }));
    const studyRow = (await within(card).findByText("Study Patient")).closest("tr")!;
    expect(studyRow.querySelectorAll("td")[4]?.textContent).toContain("—");
    expect(within(card).getByText("Showing 1–1 of 1 studies")).toBeTruthy();
    expect(within(card).getByText("Page 1 of 1")).toBeTruthy();
    populatedView.unmount();
    studyHistoryResponse = { ...studyHistoryFixture(), items: [], total: 0, totalPages: 0 };
    const view = renderPage();
    await openTransferHistory();
    const emptyCard = await screen.findByTestId("dicom-transfer-history-card");
    await userEvent.click(within(emptyCard).getByRole("button", { name: "Studies" }));
    expect(await within(emptyCard).findByText("No studies match the current transfer filters.")).toBeTruthy();
    view.unmount();
  });

  it("renders history empty and error states with a retry action", async () => {
    historyResponse = { ...historyFixture(), items: [], total: 0, totalPages: 0 };
    const emptyView = renderPage();
    await openTransferHistory();
    const card = await screen.findByTestId("dicom-transfer-history-card");
    expect(within(card).getByText("No DICOM transfers match the current filters.")).toBeTruthy();
    expect(within(card).getByText("Page 1 of 1")).toBeTruthy();
    emptyView.unmount();
    historyError = true;
    renderPage();
    await openTransferHistory();
    expect(await screen.findByText("History unavailable.")).toBeTruthy();
    const historyCallsBeforeRetry = vi.mocked(api).mock.calls.filter(([path]) => path.includes("dicom-transfer-history")).length;
    await userEvent.click(within(screen.getByTestId("dicom-transfer-history-card")).getByRole("button", { name: "Retry" }));
    await waitFor(() => expect(vi.mocked(api).mock.calls.filter(([path]) => path.includes("dicom-transfer-history")).length).toBeGreaterThan(historyCallsBeforeRetry));
  });

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

  it("recovers a stalled synchronization only through the dedicated confirmed endpoint", async () => {
    historicalPacsStatus = { ...historicalPacsFixture(), runStatus: "running", mode: "full", processed: 0, total: 31141, startedAt: "2026-08-17T00:00:00.000Z", progressAt: "2026-08-17T00:00:00.000Z", isStalled: true, stalledForSeconds: 240 };
    renderPage();
    expect(await screen.findByText(/synchronization appears stalled/)).toBeTruthy();
    expect(screen.getByRole("button", { name: "Sync now" }).hasAttribute("disabled")).toBe(true);
    await userEvent.click(screen.getByRole("button", { name: "Restart full reconciliation" }));
    const dialog = screen.getByRole("dialog");
    expect(within(dialog).getByText(/local historical index/)).toBeTruthy();
    await userEvent.click(within(dialog).getByRole("button", { name: "Restart full reconciliation" }));
    await waitFor(() => expect(api).toHaveBeenCalledWith("/integrations/authoritative-orthanc/operations/historical-pacs-index/recover-and-full-reconcile", expect.objectContaining({ method: "POST" })));
    expect(api).not.toHaveBeenCalledWith("/integrations/authoritative-orthanc/operations/historical-pacs-index/sync", expect.anything());
  });

  it("shows a recovery conflict and refetches the authoritative status", async () => {
    historicalPacsStatus = { ...historicalPacsFixture(), runStatus: "running", mode: "full", isStalled: true, stalledForSeconds: 240 };
    installApi();
    vi.mocked(api).mockImplementation(async (path, options) => {
      if (path === "/integrations/authoritative-orthanc/operations/historical-pacs-index/recover-and-full-reconcile") throw new Error("A genuinely active Historical PACS synchronization cannot be superseded safely.");
      if (path === "/integrations/authoritative-orthanc/operations/summary") return summary as never;
      if (path === "/integrations/authoritative-orthanc/operations/historical-pacs-index/status") return historicalPacsStatus as never;
      if (path.includes("/operations/dicom-transfer-history")) return historyResponse as never;
      if (options?.method === "POST") return {} as never;
      throw new Error(`Unexpected API call ${path}`);
    });
    renderPage();
    await userEvent.click(await screen.findByRole("button", { name: "Restart full reconciliation" }));
    await userEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Restart full reconciliation" }));
    expect(await screen.findByText(/cannot be superseded safely/)).toBeTruthy();
    await waitFor(() => expect(vi.mocked(api).mock.calls.filter(([path]) => path === "/integrations/authoritative-orthanc/operations/historical-pacs-index/status").length).toBeGreaterThan(1));
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
    const outboundCard = screen.getByText("Outbound transfer jobs").closest("div.card-shell") as HTMLElement;
    await userEvent.click(within(outboundCard).getByRole("button", { name: "Successful" }));
    expect(screen.getByText("CT chest")).toBeTruthy();
    expect(screen.queryByText("REST API")).toBeNull();
    await userEvent.click(within(outboundCard).getByRole("button", { name: "Failed" }));
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
    vi.mocked(api).mockImplementation(async (path) => path.includes("studies/search") ? ({ status: "not_found", matchKey: "accession_number", study: null }) as never : path.includes("dicom-transfer-history") ? historyResponse as never : summary as never);
    await userEvent.click(screen.getByRole("button", { name: /Search/ }));
    expect(await screen.findByText("No study matched that identifier.")).toBeTruthy();
    vi.mocked(api).mockImplementation(async (path) => path.includes("studies/search") ? ({ status: "ambiguous", matchKey: "accession_number", reason: "multiple_studies", study: null }) as never : path.includes("dicom-transfer-history") ? historyResponse as never : summary as never);
    await userEvent.click(screen.getByRole("button", { name: /Search/ }));
    expect(await screen.findByText(/Multiple or conflicting studies/)).toBeTruthy();
  });

  it("shows transfer context and technical details while safely handling unavailable context", async () => {
    summary = fixture();
    summary.jobs.items.push({ id: "unknown-context", type: "DicomModalityStore", state: "Success", progress: 100, creationTime: "20260812T100000", startTime: null, completionTime: null, updatedAt: null, description: "REST API", error: null, retryPermitted: false, transfer: { remoteAet: "UNKNOWN", localAet: "RISPRO", destinationName: "UNKNOWN", instanceCount: null, failedInstanceCount: null, parentResourceIds: [], contextStatus: "unavailable", study: null } } as never);
    renderPage();
    expect(await screen.findByText("Outbound transfer jobs")).toBeTruthy();
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
    await screen.findByText("Selected-PACS clinical-document export health");
    expect(screen.queryByRole("button", { name: "Reconcile exports" })).toBeNull();
  });

  it("keeps other sections useful when the jobs section fails", async () => {
    summary = { ...fixture(), jobs: { ...fixture().jobs, items: [], error: { code: "orthanc_invalid_response", message: "Orthanc jobs are unavailable." } } };
    renderPage();
    expect(await screen.findByText("Orthanc jobs are unavailable.")).toBeTruthy();
    expect(screen.getByText("Routing destinations")).toBeTruthy();
    expect(screen.getByText("Study lookup")).toBeTruthy();
  });
});
