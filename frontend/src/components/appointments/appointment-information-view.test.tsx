import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AppointmentWithDetails } from "@/lib/mappers";
import { LanguageProvider } from "@/providers/language-provider-component";
import { AppointmentDetailsReadOnly, AppointmentInformationView } from "./appointment-information-view";

const fetchPatientDirectorySummaryMock = vi.fn();
const updateAppointmentMock = vi.fn();

vi.mock("@/lib/api-hooks", () => ({
  fetchPatientDirectorySummary: (...args: unknown[]) => fetchPatientDirectorySummaryMock(...args),
  updateAppointment: (...args: unknown[]) => updateAppointmentMock(...args),
}));

vi.mock("@/v2/appointments/api", () => ({ useV2ExamTypes: () => ({ data: [], isLoading: false }) }));
vi.mock("@/lib/toast", () => ({ pushToast: vi.fn() }));

const appointment = {
  id: 42, patientId: 7, modalityId: 1, examTypeId: 3, reportingPriorityId: 2, accessionNumber: "ACC-42", appointmentDate: "2026-07-26", bookingTime: null, dailySequence: 1, status: "scheduled", isWalkIn: false, requiresReport: true, notes: "Original note", arabicFullName: "المريض", englishFullName: "Test Patient", nationalId: null, mrn: "MRN-42", ageYears: 40, sex: "F", phone1: null, modalityNameAr: "التصوير", modalityNameEn: "CT", modalityCode: "CT", modalityGeneralInstructionAr: null, modalityGeneralInstructionEn: null, examNameAr: "الرأس", examNameEn: "Head", examSpecificInstructionAr: null, examSpecificInstructionEn: null, priorityNameAr: null, priorityNameEn: "Routine", modalitySlotNumber: null, protocolAssignmentSummary: null,
} as AppointmentWithDetails;

beforeEach(() => {
  localStorage.setItem("rispro-language", "en");
  fetchPatientDirectorySummaryMock.mockReset();
  fetchPatientDirectorySummaryMock.mockResolvedValue({ demographics: { id: 7, mrn: "MRN-42", arabicFullName: "المريض", englishFullName: "Test Patient", sex: "F", ageYears: 40, demographicsEstimated: false, dateOfBirth: "1986-01-01" }, identifiers: { nationalId: "NAT-42", identifierType: "national_id", identifierValue: "NAT-42", items: [{ id: 1, typeCode: "national_id", value: "NAT-42", isPrimary: true }] }, contact: { phone1: "0912345678", phone2: null, address: "Tripoli" }, category: "non_oncology", registration: { createdAt: null, createdByUserId: null, createdByName: null, createdByUsername: null }, warnings: { missingPhone: false, missingDob: false, missingSex: false, missingName: false, incompleteData: false, possibleDuplicate: false, duplicateReasons: [] }, lastAppointment: null, nextAppointment: null, recentAppointments: [], noShow: { noShowCount: 0, bookingRestricted: false, lastNoShowAppointment: null, lastAuthorizationUser: null, lastAuthorizationDate: null, lastAuthorizationReason: null } });
  updateAppointmentMock.mockResolvedValue({ ...appointment, notes: "Saved note" });
});

afterEach(() => { cleanup(); localStorage.removeItem("rispro-language"); vi.restoreAllMocks(); });

function renderInformation(appointmentOverride: AppointmentWithDetails = appointment, props: Partial<Parameters<typeof AppointmentInformationView>[0]> = {}) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(<LanguageProvider><QueryClientProvider client={queryClient}><AppointmentInformationView appointment={appointmentOverride} lookups={{ modalities: [], examTypes: [], priorities: [{ id: 2, code: "routine", nameAr: "عادي", nameEn: "Routine", sortOrder: 1 }], specialReasons: [] }} onBack={vi.fn()} onOpenPatientProfile={vi.fn()} onOpenStatus={vi.fn()} onAppointmentUpdated={vi.fn()} {...props} /></QueryClientProvider></LanguageProvider>);
}

function renderReadOnly(appointmentOverride: AppointmentWithDetails = appointment) {
  return render(<LanguageProvider><AppointmentDetailsReadOnly appointment={appointmentOverride} /></LanguageProvider>);
}

describe("AppointmentInformationView", () => {
  it("keeps patient identity visible while the appointment section enters controlled edit mode", async () => {
    renderInformation();
    expect(await screen.findByText("Test Patient")).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Appointment details" })).toBeTruthy();
    expect(screen.queryByLabelText("Notes")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Edit" }));
    expect(screen.getByLabelText("Notes")).toBeTruthy();
    expect(screen.getAllByText("Test Patient").length).toBeGreaterThan(0);
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.queryByLabelText("Notes")).toBeNull();
    expect(screen.getByRole("button", { name: "Edit" })).toBeTruthy();
  });

  it("uses direction-aware back icons and removes the embedded duplicate profile action", async () => {
    renderInformation();
    expect(screen.getByTestId("appointment-information-back-icon").getAttribute("data-direction")).toBe("left");
    expect(screen.queryByRole("button", { name: "Patient profile" })).toBeNull();
  });

  it("uses a right-pointing back icon for Arabic RTL", () => {
    localStorage.setItem("rispro-language", "ar");
    renderInformation();
    expect(screen.getByTestId("appointment-information-back-icon").getAttribute("data-direction")).toBe("right");
  });

  it("shows complementary reporting semantics and an assigned free-text protocol", async () => {
    renderInformation({
      ...appointment,
      isAdditionalImaging: true,
      requiresReport: false,
      protocolAssignmentSummary: { assignmentId: 1, protocolName: null, versionNumber: null, freeTextProtocol: "Repeat delayed phase.", scannerName: null, assignedBy: null, assignedAt: null, protocolNotes: null, contrastNotes: null },
    } as AppointmentWithDetails);

    expect(await screen.findByText("With original examination")).toBeTruthy();
    expect(screen.queryByText("Not required")).toBeNull();
    expect(screen.getByRole("heading", { name: "Protocol" })).toBeTruthy();
    expect(screen.getByText("Repeat delayed phase.")).toBeTruthy();
  });

  it("uses warning for draft and success for final report states", () => {
    const { rerender } = renderInformation({ ...appointment, reportStatus: "draft" } as AppointmentWithDetails, { reportStatus: { state: "draft" } });
    expect(screen.getByTestId("report-status-badge").className).toContain("state-chip--warning");
    rerender(<LanguageProvider><QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><AppointmentInformationView appointment={{ ...appointment, reportStatus: "final" } as AppointmentWithDetails} lookups={{ modalities: [], examTypes: [], priorities: [], specialReasons: [] }} reportStatus={{ state: "final" }} onBack={vi.fn()} onOpenPatientProfile={vi.fn()} onOpenStatus={vi.fn()} onAppointmentUpdated={vi.fn()} /></QueryClientProvider></LanguageProvider>);
    expect(screen.getByTestId("report-status-badge").className).toContain("state-chip--success");
  });

  it("hides reporting details and lets the remaining cards reflow when a report is not required", () => {
    renderInformation({
      ...appointment,
      requiresReport: false,
      assignedReportingDoctorName: "Dr Noor",
      reportStatus: "final",
    } as AppointmentWithDetails, { reportStatus: { canViewReport: true, state: "final" } });

    expect(screen.getByText("Report requirement")).toBeTruthy();
    expect(screen.getByText("Not required")).toBeTruthy();
    expect(screen.queryByTestId("appointment-reporting-card")).toBeNull();
    expect(screen.queryByText("Assigned doctor")).toBeNull();
    expect(screen.queryByTestId("report-status-badge")).toBeNull();
    expect(screen.getByTestId("appointment-details-primary-grid").className).toContain("xl:grid-cols-2");
    expect(screen.getByTestId("appointment-details-primary-grid").className).not.toContain("xl:grid-cols-3");
  });

  it("keeps assigned doctor and report status visible when a report is required", () => {
    renderInformation({ ...appointment, requiresReport: true, assignedReportingDoctorName: "Dr Noor", reportStatus: "final" } as AppointmentWithDetails, { reportStatus: { state: "final" } });

    expect(screen.getByTestId("appointment-reporting-card")).toBeTruthy();
    expect(screen.getByText("Assigned doctor")).toBeTruthy();
    expect(screen.getByText("Dr Noor")).toBeTruthy();
    expect(screen.getByTestId("report-status-badge").textContent).toContain("Final");
  });

  it("renders only real recall context and opens its linked appointment", () => {
    const onOpenAppointment = vi.fn();
    renderInformation({ ...appointment, complementaryImagingContext: { relationship: "original_with_recall", recallRequestId: 9, recallStatus: "scheduled", reasonCode: "missing_sequence_phase", originalAppointmentId: 42, originalAccession: "ACC-42", additionalAppointmentId: 88, additionalAccession: "ACC-88", additionalAppointmentDate: null, additionalAppointmentTime: null, additionalAppointmentStatus: "scheduled" } } as AppointmentWithDetails, { recallContext: { id: 9, originalAppointmentId: 42, recallAppointmentId: 88, receptionInstruction: "Call before booking", technologistInstruction: "Use repeat sequence", status: "scheduled", requestedByUserId: 4, requestedAt: "2026-07-25T08:00:00Z", receptionSeenAt: null, receptionAcknowledgedAt: null, receptionAcknowledgedByUserId: null, scheduledAt: null, completedAt: null, cancelledAt: null, reasonCode: "missing_sequence_phase", qaClassification: null, urgency: null, dueAt: null, reportingDisposition: null, contactAttempts: [], requesterDisplayName: "Dr Noor", recallAppointmentAccession: "ACC-88" }, onOpenAppointment });
    expect(screen.getByTestId("appointment-additional-imaging-context").textContent).toContain("Call before booking");
    fireEvent.click(screen.getByRole("button", { name: "Open additional appointment" }));
    expect(onOpenAppointment).toHaveBeenCalledWith(88);
  });

  it("restores void audit identity, time, and reason only for voided appointments", () => {
    renderInformation({
      ...appointment,
      status: "voided",
      voidedByName: "Reception Supervisor",
      voidedAt: "2026-07-26T10:30:00Z",
      voidReason: "Duplicate booking",
    } as AppointmentWithDetails);

    fireEvent.click(screen.getByText("Administrative and audit details"));
    expect(screen.getByText("Voided by")).toBeTruthy();
    expect(screen.getByText("Reception Supervisor")).toBeTruthy();
    expect(screen.getByText("Voided date/time")).toBeTruthy();
    expect(screen.getByText("Void reason")).toBeTruthy();
    expect(screen.getByText("Duplicate booking")).toBeTruthy();
  });

  it("does not render void audit rows for an appointment without void metadata", () => {
    renderInformation();
    fireEvent.click(screen.getByText("Administrative and audit details"));
    expect(screen.queryByText("Voided by")).toBeNull();
    expect(screen.queryByText("Voided date/time")).toBeNull();
    expect(screen.queryByText("Void reason")).toBeNull();
  });

  it("keeps named and free-text protocol data separate and retains assignment time", () => {
    renderInformation({
      ...appointment,
      protocolAssignmentSummary: {
        assignmentId: 3,
        status: "active",
        protocolName: "CT abdomen multiphase",
        versionNumber: "v4",
        freeTextProtocol: "Add a delayed excretory phase.",
        scannerName: "CT-2",
        assignedBy: "Dr Noor",
        assignedAt: "2026-07-26T10:30:00Z",
        protocolNotes: "Use thin slices.",
        contrastNotes: "Use IV contrast.",
      },
    } as AppointmentWithDetails);

    expect(screen.getByText("Protocol state")).toBeTruthy();
    expect(screen.getByText("CT abdomen multiphase")).toBeTruthy();
    expect(screen.getByText("v4")).toBeTruthy();
    expect(screen.getByText("Add a delayed excretory phase.")).toBeTruthy();
    expect(screen.getByText("Assigned date/time")).toBeTruthy();
    expect(screen.getByText("Dr Noor")).toBeTruthy();
  });

  it("uses arrivedAt as the waiting-duration fallback and omits a live timer after completion", () => {
    const arrivedAt = new Date(Date.now() - 5 * 60_000).toISOString();
    const { rerender } = renderInformation({ ...appointment, status: "waiting", arrivedAt, waitingStartedAt: null } as AppointmentWithDetails);

    expect(screen.getByText("Waiting duration")).toBeTruthy();
    expect(screen.getByText(/^\d+m$/)).toBeTruthy();

    rerender(<LanguageProvider><QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><AppointmentInformationView appointment={{ ...appointment, status: "completed", arrivedAt, waitingStartedAt: null } as AppointmentWithDetails} lookups={{ modalities: [], examTypes: [], priorities: [], specialReasons: [] }} onBack={vi.fn()} onOpenPatientProfile={vi.fn()} onOpenStatus={vi.fn()} onAppointmentUpdated={vi.fn()} /></QueryClientProvider></LanguageProvider>);
    expect(screen.queryByText("Waiting duration")).toBeNull();
  });

  it("keeps the doctor read-only surface clinically complete without edit or workflow actions", () => {
    renderReadOnly({
      ...appointment,
      priorityNameEn: "STAT",
      modalityGeneralInstructionEn: "Fast for four hours.",
      examSpecificInstructionEn: "Bring prior CT images.",
      isOverbooked: true,
      overbookingReason: "Urgent add-on",
      approvedByName: "Capacity Lead",
      specialReasonCode: "oncology",
      specialReasonLabelEn: "Oncology quota",
      voidedByUsername: "audit.user",
      voidedAt: "2026-07-26T10:30:00Z",
      voidReason: "Superseded appointment",
      studyInstanceUid: "1.2.840.113619.2.55.3.604688.1",
      protocolAssignmentSummary: {
        assignmentId: 4,
        status: "active",
        protocolName: "CT chest",
        versionNumber: "v2",
        freeTextProtocol: "Include high-resolution images.",
        scannerName: "CT-1",
        assignedBy: "Dr Noor",
        assignedAt: "2026-07-26T10:30:00Z",
        protocolNotes: "Supine.",
        contrastNotes: "No contrast.",
      },
    } as AppointmentWithDetails);

    expect(screen.getByText("Reporting priority")).toBeTruthy();
    expect(screen.getByText("STAT")).toBeTruthy();
    expect(screen.getByText("Report requirement")).toBeTruthy();
    expect(screen.getByText("Required")).toBeTruthy();
    expect(screen.getByText("Appointment notes")).toBeTruthy();
    expect(screen.getByText("Fast for four hours.")).toBeTruthy();
    expect(screen.getByText("Bring prior CT images.")).toBeTruthy();
    expect(screen.getByText("CT chest")).toBeTruthy();
    expect(screen.getByText("Include high-resolution images.")).toBeTruthy();

    fireEvent.click(screen.getByText("Capacity and booking exceptions"));
    expect(screen.getByText("Urgent add-on")).toBeTruthy();
    expect(screen.getByText("Oncology quota")).toBeTruthy();
    fireEvent.click(screen.getByText("Administrative and audit details"));
    expect(screen.getByText("audit.user")).toBeTruthy();
    expect(screen.getByText("Superseded appointment")).toBeTruthy();
    fireEvent.click(screen.getByText("Technical PACS details"));
    expect(screen.getByText("Study Instance UID")).toBeTruthy();

    expect(screen.queryByRole("button", { name: "Edit" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Reschedule" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Change status" })).toBeNull();
  });
});
