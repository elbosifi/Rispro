import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import DoctorPage from "./doctor-page";
import { LanguageProvider } from "@/providers/language-provider";
import type { DoctorMe } from "@/types/api";

const fetchDoctorMeMock = vi.fn();
const fetchMyDoctorRosterMock = vi.fn();
const fetchDoctorRosterWeekMock = vi.fn();
const fetchAppointmentLookupsMock = vi.fn();
const fetchRosterDoctorsMock = vi.fn();
const fetchMyDoctorCasesMock = vi.fn();
const fetchTeamDoctorCasesMock = vi.fn();
const fetchUnassignedDoctorCasesMock = vi.fn();
const runDoctorCaseAssignmentMock = vi.fn();
const fetchProtocolTasksMock = vi.fn();
const fetchProtocolDetailsMock = vi.fn();
const saveProtocolDraftMock = vi.fn();
const assignProtocolMock = vi.fn();
const requestProtocolClarificationMock = vi.fn();
const cancelProtocolMock = vi.fn();
const fetchTeamWorkloadSummaryMock = vi.fn();
const runWorkloadCalculationMock = vi.fn();
const fetchWorkloadCatalogMock = vi.fn();
const fetchRosterWeekConflictsMock = vi.fn();
const fetchMyDoctorAvailabilityMock = vi.fn();
const fetchTeamDoctorAvailabilityMock = vi.fn();
const createMyDoctorAvailabilityMock = vi.fn();
const fetchMyDoctorLeaveMock = vi.fn();
const fetchTeamDoctorLeaveMock = vi.fn();
const createMyDoctorLeaveMock = vi.fn();

vi.mock("@/lib/api-hooks", () => ({
  fetchDoctorMe: () => fetchDoctorMeMock(),
  fetchMyDoctorRoster: (...args: unknown[]) => fetchMyDoctorRosterMock(...args),
  fetchDoctorRosterWeek: (...args: unknown[]) => fetchDoctorRosterWeekMock(...args),
  fetchAppointmentLookups: (...args: unknown[]) => fetchAppointmentLookupsMock(...args),
  fetchRosterDoctors: (...args: unknown[]) => fetchRosterDoctorsMock(...args),
  fetchMyDoctorCases: (...args: unknown[]) => fetchMyDoctorCasesMock(...args),
  fetchTeamDoctorCases: (...args: unknown[]) => fetchTeamDoctorCasesMock(...args),
  fetchUnassignedDoctorCases: (...args: unknown[]) => fetchUnassignedDoctorCasesMock(...args),
  runDoctorCaseAssignment: (...args: unknown[]) => runDoctorCaseAssignmentMock(...args),
  fetchProtocolTasks: (...args: unknown[]) => fetchProtocolTasksMock(...args),
  fetchProtocolDetails: (...args: unknown[]) => fetchProtocolDetailsMock(...args),
  saveProtocolDraft: (...args: unknown[]) => saveProtocolDraftMock(...args),
  assignProtocol: (...args: unknown[]) => assignProtocolMock(...args),
  requestProtocolClarification: (...args: unknown[]) => requestProtocolClarificationMock(...args),
  cancelProtocol: (...args: unknown[]) => cancelProtocolMock(...args),
  fetchTeamWorkloadSummary: (...args: unknown[]) => fetchTeamWorkloadSummaryMock(...args),
  runWorkloadCalculation: (...args: unknown[]) => runWorkloadCalculationMock(...args),
  fetchWorkloadCatalog: (...args: unknown[]) => fetchWorkloadCatalogMock(...args),
  fetchRosterWeekConflicts: (...args: unknown[]) => fetchRosterWeekConflictsMock(...args),
  fetchMyDoctorAvailability: (...args: unknown[]) => fetchMyDoctorAvailabilityMock(...args),
  fetchTeamDoctorAvailability: (...args: unknown[]) => fetchTeamDoctorAvailabilityMock(...args),
  createMyDoctorAvailability: (...args: unknown[]) => createMyDoctorAvailabilityMock(...args),
  fetchMyDoctorLeave: (...args: unknown[]) => fetchMyDoctorLeaveMock(...args),
  fetchTeamDoctorLeave: (...args: unknown[]) => fetchTeamDoctorLeaveMock(...args),
  createMyDoctorLeave: (...args: unknown[]) => createMyDoctorLeaveMock(...args),
  createDoctorRosterWeek: vi.fn(),
  copyPreviousDoctorRosterWeek: vi.fn(),
  publishDoctorRosterWeek: vi.fn(),
  createDoctorRosterAssignment: vi.fn(),
  deleteDoctorRosterAssignment: vi.fn(),
  addDoctorRosterMember: vi.fn(),
  deleteDoctorRosterMember: vi.fn(),
}));

function CorePlaceholder() {
  const location = useLocation();
  return <div data-testid="core-page">{location.pathname}</div>;
}

const normalDoctor: DoctorMe = {
  hasActiveDoctorProfile: true,
  profile: {
    id: 1,
    userId: 10,
    displayName: "Dr Normal",
    doctorRole: "specialist",
    active: true,
    canFinalizeReports: false,
    canAssignProtocols: true,
    canSupervise: false,
  },
  doctorRole: "specialist",
  canFinalizeReports: false,
  canAssignProtocols: true,
  canSupervise: false,
  allowedModalities: [],
  moduleCapabilities: ["doctor"],
  canAccessCoreWorkspace: true,
};

function renderDoctorPortal(initialPath = "/doctor") {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });

  return render(
    <LanguageProvider>
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={[initialPath]}>
          <Routes>
            <Route path="/" element={<CorePlaceholder />} />
            <Route path="/dashboard" element={<CorePlaceholder />} />
            <Route path="/doctor/*" element={<DoctorPage />} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>
    </LanguageProvider>
  );
}

describe("Doctor Portal shell", () => {
  beforeEach(() => {
    localStorage.setItem("rispro-language", "en");
    fetchDoctorMeMock.mockReset();
    fetchMyDoctorRosterMock.mockReset();
    fetchDoctorRosterWeekMock.mockReset();
    fetchAppointmentLookupsMock.mockReset();
    fetchRosterDoctorsMock.mockReset();
    fetchMyDoctorCasesMock.mockReset();
    fetchTeamDoctorCasesMock.mockReset();
    fetchUnassignedDoctorCasesMock.mockReset();
    runDoctorCaseAssignmentMock.mockReset();
    fetchProtocolTasksMock.mockReset();
    fetchProtocolDetailsMock.mockReset();
    saveProtocolDraftMock.mockReset();
    assignProtocolMock.mockReset();
    requestProtocolClarificationMock.mockReset();
    cancelProtocolMock.mockReset();
    fetchTeamWorkloadSummaryMock.mockReset();
    runWorkloadCalculationMock.mockReset();
    fetchWorkloadCatalogMock.mockReset();
    fetchRosterWeekConflictsMock.mockReset();
    fetchMyDoctorAvailabilityMock.mockReset();
    fetchTeamDoctorAvailabilityMock.mockReset();
    createMyDoctorAvailabilityMock.mockReset();
    fetchMyDoctorLeaveMock.mockReset();
    fetchTeamDoctorLeaveMock.mockReset();
    createMyDoctorLeaveMock.mockReset();
    fetchMyDoctorRosterMock.mockResolvedValue({ week: null, assignments: [] });
    fetchDoctorRosterWeekMock.mockResolvedValue({ week: null, assignments: [] });
    fetchAppointmentLookupsMock.mockResolvedValue({ modalities: [] });
    fetchRosterDoctorsMock.mockResolvedValue([]);
    fetchMyDoctorCasesMock.mockResolvedValue([]);
    fetchTeamDoctorCasesMock.mockResolvedValue([]);
    fetchUnassignedDoctorCasesMock.mockResolvedValue([]);
    runDoctorCaseAssignmentMock.mockResolvedValue({
      assignedCount: 0,
      alreadyAssignedCount: 0,
      unassignedNoRosterCount: 0,
      skippedCancelledCount: 0,
      errors: [],
    });
    fetchProtocolTasksMock.mockResolvedValue([]);
    fetchProtocolDetailsMock.mockResolvedValue({
      appointment: {
        appointmentId: 77,
        patientId: 5,
        patientMrn: "MRN-5",
        patientNationalId: "NID-5",
        patientArabicName: "Arabic Name",
        patientEnglishName: "Protocol Patient",
        ageYears: 42,
        sex: "F",
        appointmentDate: "2027-01-04",
        appointmentTime: "09:00",
        modalityId: 1,
        modalityCode: "CT",
        modalityName: "CT",
        examTypeId: 2,
        examTypeName: "CT Brain",
        caseCategory: "oncology",
        requiresReport: true,
        clinicalIndication: "Headache",
        appointmentStatus: "scheduled",
        rosterAssignmentId: 9,
        teamName: "CT Team",
        protocolStatus: null,
        assignedByDoctorName: null,
        updatedAt: null,
      },
      protocol: null,
    });
    saveProtocolDraftMock.mockResolvedValue({});
    assignProtocolMock.mockResolvedValue({});
    requestProtocolClarificationMock.mockResolvedValue({});
    cancelProtocolMock.mockResolvedValue({});
    fetchTeamWorkloadSummaryMock.mockResolvedValue([]);
    runWorkloadCalculationMock.mockResolvedValue({
      calculatedCount: 0,
      alreadyCurrentCount: 0,
      defaultedNoCatalogRuleCount: 0,
      skippedCount: 0,
      errors: [],
    });
    fetchWorkloadCatalogMock.mockResolvedValue([]);
    fetchRosterWeekConflictsMock.mockResolvedValue([]);
    fetchMyDoctorAvailabilityMock.mockResolvedValue([]);
    fetchTeamDoctorAvailabilityMock.mockResolvedValue([]);
    createMyDoctorAvailabilityMock.mockResolvedValue({});
    fetchMyDoctorLeaveMock.mockResolvedValue([]);
    fetchTeamDoctorLeaveMock.mockResolvedValue([]);
    createMyDoctorLeaveMock.mockResolvedValue({});
  });

  it("allows an active doctor to access /doctor", async () => {
    fetchDoctorMeMock.mockResolvedValue(normalDoctor);
    renderDoctorPortal();

    expect(await screen.findByRole("heading", { name: "Doctor Portal" })).toBeTruthy();
    expect(await screen.findByText("Dr Normal")).toBeTruthy();
    expect(screen.getByRole("button", { name: /Dashboard/i })).toBeTruthy();
  });

  it("redirects a non-doctor away from /doctor", async () => {
    fetchDoctorMeMock.mockResolvedValue({
      ...normalDoctor,
      hasActiveDoctorProfile: false,
      profile: null,
      doctorRole: null,
      moduleCapabilities: [],
    });

    renderDoctorPortal();

    await waitFor(() => {
      expect(screen.getByTestId("core-page").textContent).toBe("/");
    });
  });

  it("shows management menu items to doctor supervisors", async () => {
    fetchDoctorMeMock.mockResolvedValue({
      ...normalDoctor,
      canSupervise: true,
      moduleCapabilities: ["doctor", "doctor_supervisor"],
    });

    renderDoctorPortal("/doctor/dashboard");

    expect(await screen.findByRole("button", { name: /Roster Management/i })).toBeTruthy();
    expect(screen.getByRole("button", { name: /Team Workload/i })).toBeTruthy();
    expect(screen.getByRole("button", { name: /Doctors\/Admin/i })).toBeTruthy();
  });

  it("does not show management menu items to normal doctors", async () => {
    fetchDoctorMeMock.mockResolvedValue(normalDoctor);
    renderDoctorPortal("/doctor/dashboard");

    expect(await screen.findByRole("button", { name: /My Roster/i })).toBeTruthy();
    expect(screen.getByRole("button", { name: /Team Workload/i })).toBeTruthy();
    expect(screen.queryByRole("button", { name: /Doctors\/Admin/i })).toBeNull();
  });

  it("does not render appointment editing or rescheduling controls", async () => {
    fetchDoctorMeMock.mockResolvedValue(normalDoctor);
    renderDoctorPortal("/doctor/dashboard");

    expect(await screen.findByText("Dr Normal")).toBeTruthy();
    expect(screen.queryByTestId("appointment-editor")).toBeNull();
    expect(screen.queryByRole("button", { name: /Print/i })).toBeNull();
    expect(screen.queryByText(/reschedule/i)).toBeNull();
  });

  it("normal doctor sees My Roster empty state without management controls", async () => {
    fetchDoctorMeMock.mockResolvedValue(normalDoctor);
    renderDoctorPortal("/doctor/roster");

    expect((await screen.findAllByText("My Roster")).length).toBeGreaterThan(0);
    expect(await screen.findByText("No roster assignments for this week.")).toBeTruthy();
    expect(screen.queryByRole("button", { name: /Create draft week/i })).toBeNull();
    expect(screen.queryByRole("button", { name: /Publish week/i })).toBeNull();
  });

  it("doctor supervisor sees roster management controls", async () => {
    fetchDoctorMeMock.mockResolvedValue({
      ...normalDoctor,
      canSupervise: true,
      moduleCapabilities: ["doctor", "doctor_supervisor"],
    });
    renderDoctorPortal("/doctor/admin/roster");

    expect((await screen.findAllByText("Roster Management")).length).toBeGreaterThan(0);
    expect(screen.getByRole("button", { name: /Create draft week/i })).toBeTruthy();
  });

  it("publish action is visible only for supervisor draft roster", async () => {
    fetchDoctorRosterWeekMock.mockResolvedValue({
      week: {
        id: 99,
        weekStartDate: "2027-01-04",
        weekEndDate: "2027-01-10",
        status: "draft",
        createdBy: 1,
        publishedBy: null,
        publishedAt: null,
        createdAt: "2027-01-01",
        updatedAt: "2027-01-01",
      },
      assignments: [],
    });
    fetchDoctorMeMock.mockResolvedValue({
      ...normalDoctor,
      canSupervise: true,
      moduleCapabilities: ["doctor", "doctor_supervisor"],
    });
    renderDoctorPortal("/doctor/admin/roster");

    expect(await screen.findByRole("button", { name: /Publish week/i })).toBeTruthy();
  });

  it("availability page renders and doctor can add unavailable day", async () => {
    fetchDoctorMeMock.mockResolvedValue(normalDoctor);
    renderDoctorPortal("/doctor/availability");

    expect(await screen.findByRole("heading", { name: /Doctor availability and leave/i })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /Add unavailable day/i }));

    await waitFor(() => {
      expect(createMyDoctorAvailabilityMock).toHaveBeenCalled();
    });
  });

  it("supervisor sees team availability", async () => {
    fetchDoctorMeMock.mockResolvedValue({
      ...normalDoctor,
      canSupervise: true,
      moduleCapabilities: ["doctor", "doctor_supervisor"],
    });
    fetchTeamDoctorAvailabilityMock.mockResolvedValue([
      { id: 1, doctorId: 2, doctorName: "Dr Team", date: "2027-01-04", startTime: null, endTime: null, availabilityStatus: "unavailable", note: null },
    ]);
    renderDoctorPortal("/doctor/availability");

    expect(await screen.findByText("Team availability")).toBeTruthy();
    expect(await screen.findByText(/Dr Team/)).toBeTruthy();
  });

  it("roster page shows conflict warnings and labels conflicted doctors", async () => {
    fetchDoctorRosterWeekMock.mockResolvedValue({
      week: {
        id: 99,
        weekStartDate: "2027-01-04",
        weekEndDate: "2027-01-10",
        status: "draft",
        createdBy: 1,
        publishedBy: null,
        publishedAt: null,
        createdAt: "2027-01-01",
        updatedAt: "2027-01-01",
      },
      assignments: [
        {
          id: 44,
          rosterWeekId: 99,
          date: "2027-01-04",
          modalityId: 1,
          modalityCode: "CT",
          modalityNameEn: "CT",
          modalityNameAr: "CT",
          dutyType: "ct_protocol_day",
          sessionName: "day",
          startTime: "08:00",
          endTime: "14:00",
          teamName: "CT Team",
          status: "active",
          members: [],
        },
      ],
    });
    fetchRosterDoctorsMock.mockResolvedValue([{ ...normalDoctor.profile!, id: 7, displayName: "Dr Conflict" }]);
    fetchRosterWeekConflictsMock.mockResolvedValue([
      { assignmentId: 44, memberId: null, doctorId: 7, severity: "error", code: "doctor_unavailable", message: "Dr Conflict is unavailable." },
    ]);
    fetchDoctorMeMock.mockResolvedValue({
      ...normalDoctor,
      canSupervise: true,
      moduleCapabilities: ["doctor", "doctor_supervisor"],
    });
    renderDoctorPortal("/doctor/admin/roster");

    expect(await screen.findByText("Roster conflicts")).toBeTruthy();
    expect((await screen.findAllByText(/Dr Conflict is unavailable/)).length).toBeGreaterThan(0);
    expect(await screen.findByRole("option", { name: /Dr Conflict · conflict/i })).toBeTruthy();
  });

  it("normal doctor My Cases page renders empty state without assignment controls", async () => {
    fetchDoctorMeMock.mockResolvedValue(normalDoctor);
    renderDoctorPortal("/doctor/cases");

    expect(await screen.findByText("No cases found for this filter.")).toBeTruthy();
    expect(screen.queryByRole("button", { name: /Run assignment/i })).toBeNull();
    expect(screen.queryByRole("button", { name: /Unassigned cases/i })).toBeNull();
  });

  it("doctor supervisor sees case assignment controls and unassigned view", async () => {
    fetchDoctorMeMock.mockResolvedValue({
      ...normalDoctor,
      canSupervise: true,
      moduleCapabilities: ["doctor", "doctor_supervisor"],
    });
    renderDoctorPortal("/doctor/cases");

    expect(await screen.findByRole("button", { name: /Run assignment/i })).toBeTruthy();
    expect(screen.getByRole("button", { name: /Team cases/i })).toBeTruthy();
    expect(screen.getByRole("button", { name: /Unassigned cases/i })).toBeTruthy();
  });

  it("renders case assignment result summary", async () => {
    runDoctorCaseAssignmentMock.mockResolvedValue({
      assignedCount: 2,
      alreadyAssignedCount: 1,
      unassignedNoRosterCount: 3,
      skippedCancelledCount: 4,
      errors: [],
    });
    fetchDoctorMeMock.mockResolvedValue({
      ...normalDoctor,
      canSupervise: true,
      moduleCapabilities: ["doctor", "doctor_supervisor"],
    });
    renderDoctorPortal("/doctor/cases");

    fireEvent.click(await screen.findByRole("button", { name: /Run assignment/i }));

    expect(await screen.findByText("Assigned")).toBeTruthy();
    expect(screen.getByText("Already assigned")).toBeTruthy();
    expect(screen.getByText("No roster match")).toBeTruthy();
    expect(screen.getByText("Skipped cancelled")).toBeTruthy();
  });

  it("normal doctor sees Protocols page empty state", async () => {
    fetchDoctorMeMock.mockResolvedValue(normalDoctor);
    renderDoctorPortal("/doctor/protocols");

    expect(await screen.findByText("No protocol tasks found.")).toBeTruthy();
    expect(screen.queryByText(/reschedule/i)).toBeNull();
  });

  it("protocol form renders appointment summary and actions", async () => {
    fetchProtocolTasksMock.mockResolvedValue([
      {
        appointmentId: 77,
        patientId: 5,
        patientMrn: "MRN-5",
        patientNationalId: "NID-5",
        patientArabicName: "Arabic Name",
        patientEnglishName: "Protocol Patient",
        ageYears: 42,
        sex: "F",
        appointmentDate: "2027-01-04",
        appointmentTime: "09:00",
        modalityId: 1,
        modalityCode: "CT",
        modalityName: "CT",
        examTypeId: 2,
        examTypeName: "CT Brain",
        caseCategory: "oncology",
        requiresReport: true,
        clinicalIndication: "Headache",
        appointmentStatus: "scheduled",
        rosterAssignmentId: 9,
        teamName: "CT Team",
        protocolStatus: null,
        assignedByDoctorName: null,
        updatedAt: null,
      },
    ]);
    fetchDoctorMeMock.mockResolvedValue(normalDoctor);
    renderDoctorPortal("/doctor/protocols");

    fireEvent.click(await screen.findByText("Protocol Patient"));

    expect(await screen.findByText(/Clinical indication:/)).toBeTruthy();
    expect(screen.getByText("Save draft")).toBeTruthy();
    expect(screen.getByText("Assign protocol")).toBeTruthy();
    expect(screen.getByText("Clarification requires a note.")).toBeTruthy();
    expect(screen.queryByText(/reschedule/i)).toBeNull();
  });

  it("supervisor sees team protocol task controls", async () => {
    fetchDoctorMeMock.mockResolvedValue({
      ...normalDoctor,
      canSupervise: true,
      moduleCapabilities: ["doctor", "doctor_supervisor"],
    });
    renderDoctorPortal("/doctor/protocols");

    expect(await screen.findByText("Supervisor/admin team and unassigned protocol tasks are visible here.")).toBeTruthy();
  });

  it("normal doctor sees team workload empty state without calculation controls", async () => {
    fetchDoctorMeMock.mockResolvedValue(normalDoctor);
    renderDoctorPortal("/doctor/team-workload");

    expect(await screen.findByText("My team workload")).toBeTruthy();
    expect(screen.getByText("No workload summary for this filter.")).toBeTruthy();
    expect(screen.queryByRole("button", { name: /Calculate workload/i })).toBeNull();
    expect(screen.queryByText(/ranking|salary|payment/i)).toBeNull();
  });

  it("supervisor sees workload calculation controls", async () => {
    fetchDoctorMeMock.mockResolvedValue({
      ...normalDoctor,
      canSupervise: true,
      moduleCapabilities: ["doctor", "doctor_supervisor"],
    });
    renderDoctorPortal("/doctor/team-workload");

    expect(await screen.findByText("Department team workload")).toBeTruthy();
    expect(screen.getByRole("button", { name: /Calculate workload/i })).toBeTruthy();
  });

  it("renders workload summary rows and calculation summary", async () => {
    fetchTeamWorkloadSummaryMock.mockResolvedValue([
      {
        rosterAssignmentId: 44,
        teamName: "CT Team",
        dutyType: "ct_protocol_day",
        date: "2027-01-04",
        modalityId: 1,
        modalityName: "CT",
        caseCategory: "oncology",
        caseCount: 3,
        totalWorkloadUnits: 5,
        reportRequiredCount: 2,
        noReportCount: 1,
        pendingCount: 1,
        finalizedCount: 1,
        overdueCount: 0,
      },
    ]);
    runWorkloadCalculationMock.mockResolvedValue({
      calculatedCount: 2,
      alreadyCurrentCount: 1,
      defaultedNoCatalogRuleCount: 1,
      skippedCount: 0,
      errors: [],
    });
    fetchDoctorMeMock.mockResolvedValue({
      ...normalDoctor,
      canSupervise: true,
      moduleCapabilities: ["doctor", "doctor_supervisor"],
    });
    renderDoctorPortal("/doctor/team-workload");

    expect(await screen.findByText("CT Team")).toBeTruthy();
    expect(screen.getByText("5")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /Calculate workload/i }));
    expect(await screen.findByText("Calculated")).toBeTruthy();
    expect(screen.getByText("Defaulted")).toBeTruthy();
  });
});
