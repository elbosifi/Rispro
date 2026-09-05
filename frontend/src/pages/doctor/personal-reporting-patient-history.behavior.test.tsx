import { fireEvent, render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { PersonalReportingHistoryButton, PersonalReportingPatientHistory, type PersonalReportingHistoryCase } from "./personal-reporting-patient-history";
import type { HistoricalPacsCandidate, ProtocolingPatientHistoryItem, ProtocolingPatientHistoryResponse } from "@/types/api";

const testState = vi.hoisted(() => ({
  fetchHistory: vi.fn(),
  fetchCandidates: vi.fn(),
  fetchComparisonHistory: vi.fn(),
  fetchComparisonCandidates: vi.fn(),
  isWindows: vi.fn(() => false),
}));

vi.mock("@/lib/api-hooks", () => ({
  fetchReportingBoardPatientHistory: testState.fetchHistory,
  fetchReportingBoardHistoricalPacsCandidates: testState.fetchCandidates,
  fetchReportingBoardComparisonHistory: testState.fetchComparisonHistory,
  fetchReportingBoardComparisonHistoricalPacsCandidates: testState.fetchComparisonCandidates,
}));

vi.mock("./doctor-reporting-board-page.helpers", () => ({
  buildRadiantPacsTagUrl: (tag: string, value: string) => `radiant:///?tag=${tag}&value=${value}`,
  isWindowsWorkstation: testState.isWindows,
}));

const originalMatchMedia = window.matchMedia;

function setViewport(isMobile: boolean) {
  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    value: vi.fn().mockImplementation((media: string) => ({
      matches: isMobile,
      media,
      onchange: null,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    })),
  });
}

function getDialogContent(): HTMLDivElement {
  const content = screen.getByRole("dialog").querySelector<HTMLDivElement>("div[tabindex='-1']");
  if (!content) throw new Error("Expected Dialog content");
  return content;
}

function makeCase(overrides: Partial<PersonalReportingHistoryCase> = {}): PersonalReportingHistoryCase {
  return {
    caseType: "appointment",
    appointmentId: 42,
    comparisonRequestId: null,
    patientName: "Patient One",
    linkedPreviousStudyDate: null,
    linkedPreviousAccessionNumber: null,
    comparisonReason: null,
    ...overrides,
  };
}

function makeItem(overrides: Partial<ProtocolingPatientHistoryItem> = {}): ProtocolingPatientHistoryItem {
  return {
    appointmentId: 1,
    orthancStudyId: null,
    studyInstanceUid: null,
    accessionNumber: "ACC-1",
    date: "2026-09-01",
    time: null,
    modalities: ["CT"],
    description: "CT Head",
    appointmentStatus: "completed",
    reportAvailable: true,
    source: "rispro_pacs",
    identityDiscrepancy: null,
    ...overrides,
  };
}

function makeHistory(items: ProtocolingPatientHistoryItem[] = [makeItem()]): ProtocolingPatientHistoryResponse {
  return {
    items,
    pacsStatus: "available",
    historicalPacsIndexStatus: "ready",
    historicalPacsLastSuccessAt: null,
    currentPatient: { id: 1, patientId: "PAT-1", name: "Patient One", birthDate: "1980-01-01" },
  };
}

function makeCandidate(): HistoricalPacsCandidate {
  return {
    historicalPatientId: "OLD-PAT-1",
    patientName: "Patient One Legacy",
    patientBirthDate: "1980-01-01",
    patientSex: "F",
    classification: "exact",
    reasons: ["Name and date of birth match"],
    authoritative: true,
    matchRank: 1,
    nameSimilarity: 1,
    phoneticMatchCount: 2,
    studyCount: 1,
    studies: [{
      orthancStudyId: "orthanc-1",
      studyInstanceUid: "1.2.3",
      accessionNumber: "OLD-ACC-1",
      patientId: "OLD-PAT-1",
      patientName: "Patient One Legacy",
      patientBirthDate: "1980-01-01",
      patientSex: "F",
      studyDate: "2020-01-01",
      studyDescription: "Legacy CT",
      modalitiesInStudy: ["CT"],
      seriesCount: 1,
      instanceCount: 1,
    }],
  };
}

function renderHistory(caseIdentity = makeCase(), onClose = vi.fn()) {
  const view = render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <PersonalReportingPatientHistory caseIdentity={caseIdentity} authorized onClose={onClose} />
    </QueryClientProvider>,
  );
  return { ...view, onClose };
}

describe("PersonalReportingPatientHistory", () => {
  beforeEach(() => {
    setViewport(true);
    testState.isWindows.mockReturnValue(false);
    testState.fetchHistory.mockResolvedValue(makeHistory());
    testState.fetchCandidates.mockResolvedValue({ historicalCandidates: [], historicalPacsIndexStatus: "ready", historicalPacsLastSuccessAt: null });
    testState.fetchComparisonHistory.mockResolvedValue(makeHistory());
    testState.fetchComparisonCandidates.mockResolvedValue({ historicalCandidates: [], historicalPacsIndexStatus: "ready", historicalPacsLastSuccessAt: null });
  });

  afterEach(() => {
    vi.clearAllMocks();
    vi.restoreAllMocks();
    Object.defineProperty(window, "matchMedia", { configurable: true, value: originalMatchMedia });
  });

  it("shows the History label on the Personal Desk button on mobile", () => {
    const onClick = vi.fn();
    render(<PersonalReportingHistoryButton onClick={onClick} />);

    expect(screen.getByRole("button", { name: "Patient History" }).textContent).toContain("History");
  });

  it("uses a full-height, edge-to-edge mobile History panel contract", async () => {
    setViewport(true);
    renderHistory();

    await screen.findByText(/CT Head/);
    const content = getDialogContent();

    expect(content.className).toContain("!h-[100dvh]");
    expect(content.className).toContain("!max-h-[100dvh]");
    expect(content.className).toContain("!m-0");
    expect(content.className).toContain("!rounded-none");
    expect(content.className).toContain("!w-full");
    expect(screen.getByRole("button", { name: "Back to case" }).className).toContain("w-full");
  });

  it("keeps the scrollable history body distinct from the header and footer", async () => {
    renderHistory();

    await screen.findByText(/CT Head/);
    const content = getDialogContent();
    const [header, body, footer] = Array.from(content.children);
    if (!header || !body || !footer) throw new Error("Expected History header, body, and footer");

    expect(body.className).toContain("flex-1");
    expect(body.className).toContain("overflow-y-auto");
    expect(body).not.toBe(header);
    expect(body).not.toBe(footer);
    expect(header.contains(screen.getByRole("heading", { name: "Patient History" }))).toBe(true);
    expect(footer.contains(screen.getByRole("button", { name: "Back to case" }))).toBe(true);
  });

  it("keeps both History close actions wired to onClose", async () => {
    const { onClose } = renderHistory();

    expect(await screen.findByRole("heading", { name: "Patient History" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Back to case" }));
    fireEvent.click(screen.getByRole("button", { name: "Close dialog" }));

    expect(onClose).toHaveBeenCalledTimes(2);
  });

  it("retains the bounded centered desktop modal contract", async () => {
    setViewport(false);
    renderHistory();

    await screen.findByText(/CT Head/);
    const dialog = screen.getByRole("dialog");
    const content = getDialogContent();

    expect(dialog.style.alignItems).toBe("center");
    expect(dialog.style.justifyContent).toBe("center");
    expect(content.style.maxWidth).toBe("860px");
    expect(content.className).toContain("sm:!m-4");
    expect(content.className).toContain("sm:!h-auto");
    expect(content.className).toContain("sm:!max-h-[calc(100vh-32px)]");
    expect(content.className).toContain("sm:!rounded-xl");
    expect(content.className).toContain("sm:!p-6");
  });

  it("renders current history before distinct historical candidates, newest first", async () => {
    testState.fetchHistory.mockResolvedValue(makeHistory([
      makeItem({ accessionNumber: "ACC-OLD", date: "2024-01-01", description: "Old RISpro study" }),
      makeItem({ accessionNumber: "ACC-NEW", date: "2026-01-01", description: "New RISpro study" }),
      makeItem({ accessionNumber: "ACC-UNKNOWN", date: null, description: "Undated study" }),
    ]));
    testState.fetchCandidates.mockResolvedValue({ historicalCandidates: [makeCandidate()], historicalPacsIndexStatus: "ready", historicalPacsLastSuccessAt: null });
    renderHistory();

    await screen.findByText(/New RISpro study/);
    const dialog = screen.getByRole("dialog");
    const content = dialog.textContent ?? "";
    expect(content.indexOf("Current RISpro / PACS studies")).toBeLessThan(content.indexOf("Possible historical PACS matches"));
    expect(content.indexOf("2026-01-01")).toBeLessThan(content.indexOf("2024-01-01"));
    expect(content.indexOf("2024-01-01")).toBeLessThan(content.indexOf("Unknown date"));
    expect(screen.getByText("Historical Patient ID: OLD-PAT-1")).toBeTruthy();
    expect(screen.getByText("Exact match")).toBeTruthy();
    expect(screen.getByText("Study count: 1 · DOB: 1980-01-01 · Sex: F")).toBeTruthy();
  });

  it("shows comparison context and marks a matching requested prior", async () => {
    const caseIdentity = makeCase({ caseType: "comparison", comparisonRequestId: 9, linkedPreviousStudyDate: "2025-08-01", linkedPreviousAccessionNumber: "ACC-PRIOR", comparisonReason: "Assess interval change" });
    testState.fetchComparisonHistory.mockResolvedValue(makeHistory([makeItem({ accessionNumber: "ACC-PRIOR", date: "2025-08-01" })]));
    renderHistory(caseIdentity);

    expect(await screen.findByText("Requested comparison prior")).toBeTruthy();
    expect(screen.getByText("2025-08-01")).toBeTruthy();
    expect(screen.getByText("ACC-PRIOR")).toBeTruthy();
    expect(screen.getByText("Assess interval change")).toBeTruthy();
    expect(await screen.findByText("Requested prior")).toBeTruthy();
    expect(testState.fetchComparisonHistory).toHaveBeenCalledWith(9);
    expect(testState.fetchComparisonCandidates).toHaveBeenCalledWith(9);
  });

  it("warns on patient ID discrepancy without reconciliation controls", async () => {
    testState.fetchHistory.mockResolvedValue(makeHistory([makeItem({ identityDiscrepancy: "patient_id_mismatch" })]));
    renderHistory();

    expect(await screen.findByText(/Patient ID mismatch detected/)).toBeTruthy();
    expect(screen.queryByText(/Reconcile|Remap|Merge|Search old Patient ID/i)).toBeNull();
  });

  it("keeps current history visible when historical search fails", async () => {
    testState.fetchCandidates.mockRejectedValue(new Error("historical unavailable"));
    renderHistory();

    expect(await screen.findByText(/CT Head/)).toBeTruthy();
    expect(await screen.findByText(/Historical PACS search is unavailable/)).toBeTruthy();
    expect(screen.getByText("Current RISpro / PACS studies")).toBeTruthy();
  });

  it("opens prior studies in SonicDICOM on mobile and omits RadiAnt", async () => {
    testState.fetchCandidates.mockResolvedValue({ historicalCandidates: [makeCandidate()], historicalPacsIndexStatus: "ready", historicalPacsLastSuccessAt: null });
    renderHistory();

    const links = await screen.findAllByRole("link", { name: "Open in SonicDICOM" });
    expect(links).toHaveLength(2);
    expect(links.every((link) => link.getAttribute("target") === "_blank" && link.getAttribute("rel") === "noopener noreferrer")).toBe(true);
    expect(links.every((link) => link.textContent?.includes("SonicDICOM"))).toBe(true);
    expect(screen.queryByRole("link", { name: "Open in RadiAnt" })).toBeNull();
    expect(screen.queryByRole("button", { name: /OHIF/i })).toBeNull();
  });

  it("shows RadiAnt for Windows desktop history studies only", async () => {
    setViewport(false);
    testState.isWindows.mockReturnValue(true);
    const firstRender = renderHistory();
    expect(await screen.findByRole("link", { name: "Open in SonicDICOM" })).toBeTruthy();
    expect(screen.getByRole("link", { name: "Open in RadiAnt" }).getAttribute("href")).toContain("00080050");

    firstRender.unmount();
    testState.isWindows.mockReturnValue(false);
    renderHistory();
    expect(await screen.findByRole("link", { name: "Open in SonicDICOM" })).toBeTruthy();
    expect(screen.queryByRole("link", { name: "Open in RadiAnt" })).toBeNull();
  });
});
