import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ReportingBoardMobileCase, User } from "@/types/api";
import { ReportingWorklistDocumentsPage } from "./reporting-worklist-documents-page";

const testState = vi.hoisted(() => ({
  user: { id: 4, username: "reader", fullName: "Dr Reader", role: "doctor" } as User | null,
  fetchCase: vi.fn(),
}));

vi.mock("@/providers/auth-provider", () => ({ useAuth: () => ({ user: testState.user }) }));
vi.mock("@/lib/api/doctor-portal-reporting", () => ({ fetchReportingBoardMobileCase: testState.fetchCase }));
vi.mock("@/components/documents/request-documents-panel", () => ({
  RequestDocumentsPanel: (props: Record<string, unknown>) => {
    const scope = props.reportingBoardScope as { token?: string; caseId?: number } | undefined;
    return <div data-testid="documents-panel" data-appointment-id={props.appointmentId} data-patient-id={String(props.patientId)} data-ref-type={props.appointmentRefType} data-preview-mode={props.previewMode} data-layout={props.layout} data-read-only={String(Boolean(props.readOnly))} data-local-scan={String(Boolean(props.enableLocalScan))} data-annotations={String(Boolean(props.enableAnnotations))} data-sizing={props.pdfInitialSizingMode} data-scope-token={scope?.token} data-scope-case-id={scope?.caseId}>{String(props.title)}</div>;
  },
}));

function caseRow(overrides: Partial<ReportingBoardMobileCase> = {}): ReportingBoardMobileCase {
  return {
    caseType: "appointment", caseKey: "appointment:42", appointmentId: 42, comparisonRequestId: null,
    patientName: "Patient One", mrn: "MRN-42", patientDicomId: "PID-42", accessionNumber: "V2-000042",
    date: "2026-09-27", time: "09:00", modality: "CT", exam: "CT Chest", category: "oncology",
    assignedDoctor: "Dr Reader", assignedDoctorId: 4, assignmentOrigin: "rispro", finalizedByDoctorId: null,
    finalizedByDoctorName: null, sonicDicomFinalizedByAccount: null, assignmentMatch: "not_applicable",
    priority: "Routine", priorityCode: "routine", reportStatus: "draft", requiresReport: true,
    activeComplementaryRecallStatus: null, latestComplementaryRecallStatus: null, appointmentStatus: "completed",
    assignmentStatus: "assigned", canAssign: true, exclusionReason: null, completedAt: null, firstAssignedAt: null,
    currentAssignedAt: null, reportFinalAt: null, completedToAssignedMinutes: null, currentAssignmentAgeMinutes: null,
    completedUnassignedAgeMinutes: null, completedAgeMinutes: null, overdue: false, canAssignToMe: false,
    canReassign: false, canUnassign: false, actionDisabledReason: null, ...overrides,
  };
}

function renderPage() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <MemoryRouter initialEntries={["/reporting/worklist/token/cases/42/documents"]}>
      <QueryClientProvider client={queryClient}>
        <Routes><Route path="/reporting/worklist/:token/cases/:caseId/documents" element={<ReportingWorklistDocumentsPage />} /></Routes>
      </QueryClientProvider>
    </MemoryRouter>,
  );
}

function authorizedResponse(row = caseRow(), overrides: Partial<{ authenticated: boolean; readOnly: boolean }> = {}) {
  return {
    case: row,
    savedView: { id: 2, name: "My cases", token: "token", linkKind: "doctor_worklist" as const, targetDoctorId: 4 },
    allowedActions: { authenticated: overrides.authenticated ?? true, accessLevel: "doctor" as const, readOnly: overrides.readOnly ?? false, readOnlyReason: null, assignToMe: false, reassign: false, unassign: false, batchReassign: false, finalizeOwnReports: false, copyAccession: true, copyMrn: true },
    refreshedAt: "2026-09-27T09:00:00.000Z",
  };
}

describe("Reporting worklist documents page", () => {
  beforeEach(() => {
    testState.user = { id: 4, username: "reader", fullName: "Dr Reader", role: "doctor" };
    testState.fetchCase.mockReset();
  });

  it("renders the read-only document panel after the authorized appointment scope check", async () => {
    testState.fetchCase.mockResolvedValue(authorizedResponse());
    renderPage();

    expect(await screen.findByTestId("documents-panel")).toBeTruthy();
    expect(testState.fetchCase).toHaveBeenCalledWith("token", 42);
    const panel = screen.getByTestId("documents-panel");
    expect(panel.getAttribute("data-appointment-id")).toBe("42");
    expect(panel.getAttribute("data-patient-id")).toBe("null");
    expect(panel.getAttribute("data-ref-type")).toBe("v2_booking");
    expect(panel.getAttribute("data-preview-mode")).toBe("inline");
    expect(panel.getAttribute("data-layout")).toBe("workspace");
    expect(panel.getAttribute("data-read-only")).toBe("true");
    expect(panel.getAttribute("data-local-scan")).toBe("false");
    expect(panel.getAttribute("data-annotations")).toBe("false");
    expect(panel.getAttribute("data-sizing")).toBe("fit-width");
    expect(panel.getAttribute("data-scope-token")).toBe("token");
    expect(panel.getAttribute("data-scope-case-id")).toBe("42");
  });

  it("shows case context before and with the document panel", async () => {
    testState.fetchCase.mockResolvedValue(authorizedResponse());
    renderPage();

    expect(await screen.findByText("Patient One")).toBeTruthy();
    expect(screen.getByText("MRN-42")).toBeTruthy();
    expect(screen.getByText("PID-42")).toBeTruthy();
    expect(screen.getByText("V2-000042")).toBeTruthy();
    expect(screen.getByText("CT")).toBeTruthy();
    expect(screen.getByText("CT Chest")).toBeTruthy();
  });

  it.each([
    ["read-only cross-doctor", authorizedResponse(caseRow(), { readOnly: true })],
    ["comparison", authorizedResponse(caseRow({ caseType: "comparison", caseKey: "comparison:42", appointmentId: 0, comparisonRequestId: 42 }))],
  ])("does not mount the document panel for %s responses", async (_label, response) => {
    testState.fetchCase.mockResolvedValue(response);
    renderPage();

    expect((await screen.findByRole("alert")).textContent).toContain("Access denied");
    expect(screen.queryByTestId("documents-panel")).toBeNull();
  });
});
