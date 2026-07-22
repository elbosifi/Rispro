import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { DoctorMe, DoctorProtocolingAppointment } from "@/types/api";
import { DoctorProtocolsPage } from "./doctor-protocols-page";

const appointment: DoctorProtocolingAppointment = {
  appointmentId: 42,
  accessionNumber: "V2-000042",
  patientId: 9,
  patientMrn: "MRN-9",
  patientNationalId: null,
  patientArabicName: null,
  patientEnglishName: "Request Scan Patient",
  ageYears: 35,
  sex: "M",
  appointmentDate: "2026-07-22",
  appointmentTime: "09:00:00",
  modalityId: 4,
  modalityCode: "CT",
  modalityName: "CT",
  examTypeId: null,
  examTypeName: null,
  caseCategory: "non_oncology",
  clinicalNotes: null,
  appointmentStatus: "scheduled",
  protocolStatus: "NOT_PROTOCOLLED",
  assignment: null,
};

vi.mock("@/lib/api-hooks", () => ({
  activateProtocolLibraryVersion: vi.fn(), cancelDoctorProtocolAssignment: vi.fn(), createDoctorProtocolAssignment: vi.fn(),
  createProtocolLibraryAnatomyRegion: vi.fn(), createProtocolLibraryCtPhasePreset: vi.fn(), createProtocolLibraryCtPhaseRow: vi.fn(),
  createProtocolLibraryDraftFromActive: vi.fn(), createProtocolLibraryMriSequencePreset: vi.fn(), createProtocolLibraryMriSequenceRow: vi.fn(),
  createProtocolLibraryProtocol: vi.fn(), deleteProtocolLibraryCtPhaseRow: vi.fn(), deleteProtocolLibraryMriSequenceRow: vi.fn(),
  confirmMriSequenceImport: vi.fn(), downloadMriSequenceImportTemplate: vi.fn(), exportMriSequencePresetsWorkbook: vi.fn(),
  fetchDoctorProtocolingAppointmentDetail: vi.fn(async () => ({ appointment, assignmentDetail: null })),
  fetchDoctorProtocolingAppointments: vi.fn(async () => [appointment]),
  fetchProtocolLibraryAnatomyRegions: vi.fn(async () => []), fetchProtocolLibraryCtPhasePresets: vi.fn(async () => []),
  fetchProtocolLibraryMriSequencePresets: vi.fn(async () => []), fetchProtocolLibraryVersionDetail: vi.fn(async () => null),
  fetchProtocolLibraryProtocols: vi.fn(async () => []), fetchProtocolLibraryScanners: vi.fn(async () => []),
  inspectMriSequenceImport: vi.fn(), previewMriSequenceImport: vi.fn(), reorderProtocolLibraryCtPhaseRows: vi.fn(),
  reorderProtocolLibraryMriSequenceRows: vi.fn(), updateProtocolLibraryCtPhaseRow: vi.fn(), updateProtocolLibraryAnatomyRegion: vi.fn(),
  updateProtocolLibraryCtPhasePreset: vi.fn(), updateProtocolLibraryMriSequenceRow: vi.fn(), updateProtocolLibraryMriSequencePreset: vi.fn(),
  updateProtocolLibraryProtocol: vi.fn(), updateProtocolLibraryScanner: vi.fn(), updateProtocolLibraryVersion: vi.fn(),
}));

vi.mock("@/lib/toast", () => ({ pushToast: vi.fn() }));
vi.mock("@/lib/protocol-printing", () => ({ printProtocolSheet: vi.fn() }));
vi.mock("@/components/documents/request-documents-panel", () => ({
  RequestDocumentsPanel: ({ appointmentId, patientId, appointmentRefType, title }: { appointmentId: number; patientId: number; appointmentRefType: string; title: string }) => (
    <div data-testid="protocoling-request-documents" data-appointment-id={appointmentId} data-patient-id={patientId} data-ref-type={appointmentRefType}>{title}</div>
  ),
}));

const me = {
  hasActiveDoctorProfile: true,
  profile: null,
  doctorRole: "specialist",
  canFinalizeReports: false,
  canAssignProtocols: true,
  canSupervise: false,
  allowedModalities: [],
  moduleCapabilities: [],
  canAccessCoreWorkspace: true,
} as DoctorMe;

describe("Doctor protocoling request documents", () => {
  it("renders the existing request-document panel for the selected V2 appointment", async () => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
    render(<QueryClientProvider client={queryClient}><DoctorProtocolsPage me={me} /></QueryClientProvider>);

    await userEvent.click(await screen.findByRole("button", { name: "Assign" }));
    const panel = await screen.findByTestId("protocoling-request-documents");
    expect(panel.textContent).toBe("Appointment request documents");
    expect(panel.getAttribute("data-appointment-id")).toBe("42");
    expect(panel.getAttribute("data-patient-id")).toBe("9");
    expect(panel.getAttribute("data-ref-type")).toBe("v2_booking");
  });
});
