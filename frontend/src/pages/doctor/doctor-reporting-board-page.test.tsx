import { MemoryRouter, Route, Routes } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { DoctorReportingBoardPage, buildReportingBoardPrintUrl } from "./doctor-reporting-board-page";
import type { DoctorMe, ReportingBoardCaseRow } from "@/types/api";

const fetchReportingBoardSettingsMock = vi.fn();
const updateReportingBoardSettingsMock = vi.fn();
const fetchReportingBoardCasesMock = vi.fn();
const fetchReportingBoardSavedViewsMock = vi.fn();
const createReportingBoardSavedViewMock = vi.fn();
const updateReportingBoardSavedViewMock = vi.fn();
const fetchReportingBoardSavedViewByTokenMock = vi.fn();
const bulkAssignNextReportingCasesMock = vi.fn();
const fetchRosterDoctorsMock = vi.fn();
const fetchAppointmentLookupsMock = vi.fn();
const assignDoctorCaseMock = vi.fn();

vi.mock("@/lib/api-hooks", () => ({
  fetchReportingBoardSettings: (...args: unknown[]) => fetchReportingBoardSettingsMock(...args),
  updateReportingBoardSettings: (...args: unknown[]) => updateReportingBoardSettingsMock(...args),
  fetchReportingBoardCases: (...args: unknown[]) => fetchReportingBoardCasesMock(...args),
  fetchReportingBoardSavedViews: (...args: unknown[]) => fetchReportingBoardSavedViewsMock(...args),
  createReportingBoardSavedView: (...args: unknown[]) => createReportingBoardSavedViewMock(...args),
  updateReportingBoardSavedView: (...args: unknown[]) => updateReportingBoardSavedViewMock(...args),
  fetchReportingBoardSavedViewByToken: (...args: unknown[]) => fetchReportingBoardSavedViewByTokenMock(...args),
  bulkAssignNextReportingCases: (...args: unknown[]) => bulkAssignNextReportingCasesMock(...args),
  fetchRosterDoctors: (...args: unknown[]) => fetchRosterDoctorsMock(...args),
  fetchAppointmentLookups: (...args: unknown[]) => fetchAppointmentLookupsMock(...args),
  assignDoctorCase: (...args: unknown[]) => assignDoctorCaseMock(...args),
}));

const managerMe: DoctorMe = {
  hasActiveDoctorProfile: true,
  canAccessClinicalDoctorPortal: true,
  profile: {
    id: 1,
    userId: 10,
    displayName: "Dr Manager",
    doctorRole: "specialist",
    active: true,
    canFinalizeReports: true,
    canAssignProtocols: true,
    canSupervise: true,
  },
  doctorRole: "specialist",
  canFinalizeReports: true,
  canAssignProtocols: true,
  canSupervise: true,
  allowedModalities: [],
  moduleCapabilities: ["doctor", "doctor_supervisor"],
  canAccessCoreWorkspace: true,
};

const caseRow: ReportingBoardCaseRow = {
  appointmentId: 42,
  patientId: 7,
  patientMrn: "MRN-7",
  patientEnglishName: "Alpha Patient",
  patientArabicName: null,
  accessionNumber: "V2-000042",
  studyInstanceUid: null,
  bookingDate: "2026-05-25",
  bookingTime: "08:30",
  modalityId: 1,
  modalityCode: "CT",
  modalityName: "CT",
  examTypeId: 2,
  examTypeName: "CT Brain",
  caseCategory: "oncology",
  appointmentStatus: "scheduled",
  requiresReport: true,
  reportingPriorityId: 3,
  reportingPriorityCode: "stat",
  reportingPriorityName: "STAT",
  reportingPrioritySortOrder: 0,
  assignedDoctorId: null,
  assignedDoctorName: null,
  assignmentStatus: "unassigned",
  reportStatus: "draft",
  reportStatusCheckedAt: "2026-05-29T08:00:00.000Z",
  canAssign: true,
  exclusionReason: null,
};

function renderPage(path = "/doctor/reporting-board") {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route path="/doctor/reporting-board" element={<DoctorReportingBoardPage me={managerMe} />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>
  );
}

describe("DoctorReportingBoardPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    fetchReportingBoardSettingsMock.mockResolvedValue({
      cutoffMode: "days_back",
      defaultCutoffDate: null,
      daysBack: 14,
      enabledModalityCodes: ["CT", "MR"],
      defaultRequiresReport: true,
      defaultReportStatusFilter: "required_not_final",
    });
    updateReportingBoardSettingsMock.mockResolvedValue({});
    fetchReportingBoardCasesMock.mockResolvedValue({ cases: [caseRow], filters: { dateFrom: "2026-05-15", cutoffDate: "2026-05-15", reportStatus: "required_not_final" } });
    fetchReportingBoardSavedViewsMock.mockResolvedValue([
      { id: 9, ownerUserId: 10, ownerDoctorId: 1, name: "Urgent CT", token: "tok-9", filters: { priorityCode: "urgent" }, notificationSettings: { notifyUnassignedUrgent: true }, active: true, createdAt: "", updatedAt: "" },
    ]);
    fetchReportingBoardSavedViewByTokenMock.mockResolvedValue({ id: 9, ownerUserId: 10, ownerDoctorId: 1, name: "Urgent CT", token: "tok-9", filters: { priorityCode: "urgent" }, notificationSettings: { notifyUnassignedUrgent: true }, active: true, createdAt: "", updatedAt: "" });
    createReportingBoardSavedViewMock.mockResolvedValue({ id: 10, name: "Saved", token: "tok-10", filters: {}, notificationSettings: {}, active: true });
    updateReportingBoardSavedViewMock.mockResolvedValue({ id: 9, name: "Urgent CT", token: "tok-9", filters: {}, notificationSettings: {}, active: true });
    bulkAssignNextReportingCasesMock.mockResolvedValue({ requestedCount: 2, assignedCount: 2, skippedCount: 0, assignedAppointmentIds: [42, 43], skipped: [] });
    fetchRosterDoctorsMock.mockResolvedValue([{ id: 5, userId: 50, displayName: "Dr Target", doctorRole: "specialist", active: true, canFinalizeReports: true, canAssignProtocols: true, canSupervise: false }]);
    fetchAppointmentLookupsMock.mockResolvedValue({
      modalities: [{ id: 1, code: "CT", nameEn: "CT", nameAr: "CT" }],
      examTypes: [],
      priorities: [{ id: 3, code: "stat", nameEn: "STAT", nameAr: "STAT", sortOrder: 0 }],
    });
    assignDoctorCaseMock.mockResolvedValue({ assignmentId: 100 });
  });

  it("renders priority and status chips with board rows", async () => {
    renderPage();

    expect(await screen.findByText("Reporting Assignment Board")).toBeTruthy();
    expect((await screen.findAllByText("STAT")).length).toBeGreaterThan(0);
    expect(screen.getByText("draft")).toBeTruthy();
    expect(screen.getByText("V2-000042")).toBeTruthy();
  });

  it("opens and applies a saved view token", async () => {
    renderPage("/doctor/reporting-board?savedViewToken=tok-9");

    expect(await screen.findByText("Urgent CT")).toBeTruthy();
    await waitFor(() => {
      expect(fetchReportingBoardCasesMock).toHaveBeenCalledWith(expect.objectContaining({ priorityCode: "urgent" }));
    });
  });

  it("validates and submits the bulk assignment modal", async () => {
    renderPage();

    fireEvent.click(await screen.findByRole("button", { name: /Bulk assign next cases/i }));
    const submit = screen.getByRole("button", { name: "Assign next cases" }) as HTMLButtonElement;
    expect(submit.disabled).toBe(true);

    fireEvent.change(screen.getByLabelText("Doctor"), { target: { value: "5" } });
    fireEvent.change(screen.getByLabelText("Number of cases"), { target: { value: "2" } });
    fireEvent.change(screen.getByLabelText("Reason"), { target: { value: "daily distribution" } });
    expect(submit.disabled).toBe(false);
    fireEvent.click(submit);

    await waitFor(() => expect(bulkAssignNextReportingCasesMock).toHaveBeenCalledWith(expect.objectContaining({
      doctorId: 5,
      count: 2,
      unassignedOnly: true,
      reason: "daily distribution",
    })));
    expect(await screen.findByText(/2\/2 assigned/)).toBeTruthy();
  });

  it("does not expose editable settings for non-superadmin managers", async () => {
    renderPage();

    expect(await screen.findByText("Read-only. Only superadmin can update cutoff settings.")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Save settings" })).toBeNull();
  });

  it("builds print URLs with reporting board parameters", () => {
    const url = buildReportingBoardPrintUrl({
      filters: { reportStatus: "required_not_final", assignedDoctorId: 5 },
      savedViewToken: "tok",
      selectedAppointmentIds: [42],
      autoprint: true,
    });

    expect(url).toContain("/print/reporting-board?");
    expect(url).toContain("savedViewToken=tok");
    expect(url).toContain("assignedDoctorId=5");
    expect(url).toContain("appointmentIds=42");
    expect(url).toContain("autoprint=1");
  });
});
