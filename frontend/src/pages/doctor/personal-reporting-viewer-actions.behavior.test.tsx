import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { PersonalReportingViewerActions } from "./personal-reporting-viewer-actions";
import type { OhifViewerAvailability, ReportingBoardMobileCase } from "@/types/api";

const testState = vi.hoisted(() => ({
  fetchRetrieval: vi.fn(),
  launchOhif: vi.fn(),
  isWindows: vi.fn(() => false),
}));

vi.mock("@/lib/api-hooks", () => ({
  fetchOhifRetrievalJob: testState.fetchRetrieval,
  launchReportingBoardCaseInOhif: testState.launchOhif,
}));

vi.mock("./doctor-reporting-board-page.helpers", () => ({
  buildRadiantPacsTagUrl: (tag: string, value: string) => `radiant:///?tag=${tag}&value=${value}`,
  isWindowsWorkstation: testState.isWindows,
}));

const originalMatchMedia = window.matchMedia;
const originalPlatform = navigator.platform;
const originalUserAgent = navigator.userAgent;

function setViewport(isMobile: boolean) {
  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    value: vi.fn().mockImplementation((media: string) => ({
      matches: isMobile,
      media,
      onchange: null,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })),
  });
}

function setWindowsWorkstation(isWindows: boolean) {
  testState.isWindows.mockReturnValue(isWindows);
  Object.defineProperty(navigator, "platform", { configurable: true, value: isWindows ? "Win32" : "Linux x86_64" });
  Object.defineProperty(navigator, "userAgent", { configurable: true, value: isWindows ? "Mozilla/5.0 (Windows NT 10.0; Win64; x64)" : "Mozilla/5.0 (X11; Linux x86_64)" });
}

function makeRow(overrides: Partial<ReportingBoardMobileCase> = {}): ReportingBoardMobileCase {
  return {
    caseType: "appointment",
    caseKey: "appointment:42",
    appointmentId: 42,
    comparisonRequestId: null,
    patientName: "Patient One",
    mrn: "MRN-42",
    accessionNumber: "ACC-42",
    date: "2026-09-02",
    time: "09:30",
    modality: "MR",
    exam: "MRI Knee",
    category: "non_oncology",
    assignedDoctor: "Dr Reader",
    assignedDoctorId: 7,
    assignmentOrigin: "rispro",
    finalizedByDoctorId: null,
    finalizedByDoctorName: null,
    sonicDicomFinalizedByAccount: null,
    assignmentMatch: "not_applicable",
    priority: "Routine",
    priorityCode: "routine",
    reportStatus: "draft",
    requiresReport: true,
    appointmentStatus: "completed",
    assignmentStatus: "assigned",
    canAssign: true,
    exclusionReason: null,
    completedAt: "2026-09-02T07:00:00.000Z",
    firstAssignedAt: "2026-09-02T07:15:00.000Z",
    currentAssignedAt: "2026-09-02T07:15:00.000Z",
    reportFinalAt: null,
    completedToAssignedMinutes: 15,
    currentAssignmentAgeMinutes: 135,
    completedUnassignedAgeMinutes: null,
    completedAgeMinutes: 150,
    overdue: false,
    canAssignToMe: false,
    canReassign: false,
    canUnassign: false,
    actionDisabledReason: null,
    ...overrides,
  };
}

const enabledOhif: OhifViewerAvailability = { enabled: true, configured: true, openMode: "same_tab" };
const readyLaunch = {
  status: "ready" as const,
  launchUrl: "/api/ohif/launch/test-token",
  openMode: "same_tab" as const,
  currentStudy: { studyInstanceUid: "1.2.840.42" },
  priorStudies: [],
  priorStudyCount: 0,
};

describe("PersonalReportingViewerActions", () => {
  beforeEach(() => {
    testState.fetchRetrieval.mockReset();
    testState.launchOhif.mockReset();
    setViewport(false);
    setWindowsWorkstation(false);
    testState.launchOhif.mockResolvedValue(readyLaunch);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    Object.defineProperty(window, "matchMedia", { configurable: true, value: originalMatchMedia });
    Object.defineProperty(navigator, "platform", { configurable: true, value: originalPlatform });
    Object.defineProperty(navigator, "userAgent", { configurable: true, value: originalUserAgent });
  });

  it("does not render privileged viewer actions when the page is anonymous", () => {
    render(<PersonalReportingViewerActions row={makeRow()} authorized={false} ohifAvailability={enabledOhif} />);

    expect(screen.queryByRole("link", { name: "Open in SonicDICOM" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Open in OHIF" })).toBeNull();
    expect(screen.queryByRole("link", { name: "Open in RadiAnt" })).toBeNull();
  });

  it("shows SonicDICOM and configured OHIF on mobile but never RadiAnt", () => {
    setViewport(true);
    setWindowsWorkstation(true);
    expect(testState.isWindows()).toBe(true);
    render(<PersonalReportingViewerActions row={makeRow()} authorized ohifAvailability={enabledOhif} />);

    expect(screen.getByRole("link", { name: "Open in SonicDICOM" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Open in OHIF" })).toBeTruthy();
    expect(screen.queryByRole("link", { name: "Open in RadiAnt" })).toBeNull();
  });

  it("shows all supported viewers on a Windows desktop and omits RadiAnt elsewhere", () => {
    setWindowsWorkstation(true);
    const { unmount } = render(<PersonalReportingViewerActions row={makeRow()} authorized ohifAvailability={enabledOhif} />);

    expect(screen.getByRole("link", { name: "Open in SonicDICOM" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Open in OHIF" })).toBeTruthy();
    expect(screen.getByRole("link", { name: "Open in RadiAnt" })).toBeTruthy();
    expect(screen.getByRole("link", { name: "Open in RadiAnt" }).getAttribute("href")).toContain("00080050");

    unmount();
    setWindowsWorkstation(false);
    render(<PersonalReportingViewerActions row={makeRow()} authorized ohifAvailability={enabledOhif} />);
    expect(screen.queryByRole("link", { name: "Open in RadiAnt" })).toBeNull();
  });

  it("hides OHIF when it is disabled or unconfigured", () => {
    render(<PersonalReportingViewerActions row={makeRow()} authorized ohifAvailability={{ ...enabledOhif, enabled: false }} />);
    expect(screen.queryByRole("button", { name: "Open in OHIF" })).toBeNull();
  });

  it("opens SonicDICOM in a new tab without replacing the desk", () => {
    render(<PersonalReportingViewerActions row={makeRow()} authorized ohifAvailability={null} />);

    const link = screen.getByRole("link", { name: "Open in SonicDICOM" });
    expect(link.getAttribute("href")).toBe("/api/doctor/reporting-board/cases/42/open-sonicdicom?scope=study");
    expect(link.getAttribute("target")).toBe("_blank");
    expect(link.getAttribute("rel")).toBe("noopener noreferrer");
  });

  it("opens an OHIF placeholder synchronously and navigates it after an immediate ready response", async () => {
    const placeholder = { opener: window, location: { href: "about:blank" }, close: vi.fn() } as unknown as Window;
    const open = vi.spyOn(window, "open").mockReturnValue(placeholder);
    testState.launchOhif.mockImplementation(async () => {
      expect(open).toHaveBeenCalledWith("about:blank", "_blank");
      return readyLaunch;
    });
    render(<PersonalReportingViewerActions row={makeRow()} authorized ohifAvailability={enabledOhif} />);

    fireEvent.click(screen.getByRole("button", { name: "Open in OHIF" }));

    await waitFor(() => expect(placeholder.location.href).toBe(readyLaunch.launchUrl));
    expect(placeholder.opener).toBeNull();
    expect(placeholder.close).not.toHaveBeenCalled();
  });

  it("polls a retrieving OHIF launch and completes when retrieval becomes ready", async () => {
    const placeholder = { opener: window, location: { href: "about:blank" }, close: vi.fn() } as unknown as Window;
    vi.spyOn(window, "open").mockReturnValue(placeholder);
    testState.launchOhif.mockResolvedValueOnce({ status: "retrieving", message: "Retrieving study.", retrievalJobId: 99 });
    testState.launchOhif.mockResolvedValueOnce(readyLaunch);
    testState.fetchRetrieval.mockResolvedValue({ status: "ready", retrievalJobId: 99, message: "The study is ready." });
    vi.useFakeTimers();
    render(<PersonalReportingViewerActions row={makeRow()} authorized ohifAvailability={enabledOhif} />);

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Open in OHIF" }));
      await Promise.resolve();
      await vi.advanceTimersByTimeAsync(2_000);
      await Promise.resolve();
    });
    expect(testState.fetchRetrieval).toHaveBeenCalledWith(99);
    expect(testState.launchOhif).toHaveBeenCalledTimes(2);
    expect(placeholder.location.href).toBe(readyLaunch.launchUrl);
    expect(screen.queryByText("The study retrieval failed.")).toBeNull();
  });

  it("closes the placeholder and displays a terminal retrieval error", async () => {
    const placeholder = { opener: window, location: { href: "about:blank" }, close: vi.fn() } as unknown as Window;
    vi.spyOn(window, "open").mockReturnValue(placeholder);
    testState.launchOhif.mockResolvedValue({ status: "retrieving", message: "Retrieving study.", retrievalJobId: 99 });
    testState.fetchRetrieval.mockResolvedValue({ status: "retrieval_failed", retrievalJobId: 99, message: "Retrieval failed for this study." });
    vi.useFakeTimers();
    render(<PersonalReportingViewerActions row={makeRow()} authorized ohifAvailability={enabledOhif} />);

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Open in OHIF" }));
      await Promise.resolve();
      await vi.advanceTimersByTimeAsync(2_000);
      await Promise.resolve();
    });
    expect(screen.getByRole("alert").textContent).toContain("Retrieval failed for this study.");
    expect(placeholder.close).toHaveBeenCalledOnce();
  });

  it("reports a blocked placeholder and does not launch a second request", async () => {
    const open = vi.spyOn(window, "open").mockReturnValue(null);
    render(<PersonalReportingViewerActions row={makeRow()} authorized ohifAvailability={enabledOhif} />);

    fireEvent.click(screen.getByRole("button", { name: "Open in OHIF" }));

    expect((await screen.findByRole("alert")).textContent).toContain("The browser blocked the OHIF tab. Allow popups for RISpro and try again.");
    expect(open).toHaveBeenCalledWith("about:blank", "_blank");
    expect(testState.launchOhif).not.toHaveBeenCalled();
  });

  it("does not start another OHIF launch while the first request is resolving", async () => {
    const placeholder = { opener: window, location: { href: "about:blank" }, close: vi.fn() } as unknown as Window;
    vi.spyOn(window, "open").mockReturnValue(placeholder);
    let resolveLaunch!: (value: typeof readyLaunch) => void;
    testState.launchOhif.mockReturnValue(new Promise<typeof readyLaunch>((resolve) => { resolveLaunch = resolve; }));
    render(<PersonalReportingViewerActions row={makeRow()} authorized ohifAvailability={enabledOhif} />);

    const button = screen.getByRole("button", { name: "Open in OHIF" });
    fireEvent.click(button);
    fireEvent.click(button);

    expect(testState.launchOhif).toHaveBeenCalledOnce();
    resolveLaunch(readyLaunch);
    await waitFor(() => expect(placeholder.location.href).toBe(readyLaunch.launchUrl));
  });
});
