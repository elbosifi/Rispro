import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AppointmentWithDetails } from "@/lib/mappers";
import { LanguageProvider } from "@/providers/language-provider-component";
import { AppointmentInformationView } from "./appointment-information-view";

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

function renderInformation(appointmentOverride: AppointmentWithDetails = appointment) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(<LanguageProvider><QueryClientProvider client={queryClient}><AppointmentInformationView appointment={appointmentOverride} lookups={{ modalities: [], examTypes: [], priorities: [{ id: 2, code: "routine", nameAr: "عادي", nameEn: "Routine", sortOrder: 1 }], specialReasons: [] }} onBack={vi.fn()} onOpenPatientProfile={vi.fn()} onOpenStatus={vi.fn()} onAppointmentUpdated={vi.fn()} /></QueryClientProvider></LanguageProvider>);
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

    expect(await screen.findByText("Reported with original examination")).toBeTruthy();
    expect(screen.queryByText("Not required")).toBeNull();
    expect(screen.getByText("Free-text protocol")).toBeTruthy();
    expect(screen.getByText("Repeat delayed phase.")).toBeTruthy();
  });
});
