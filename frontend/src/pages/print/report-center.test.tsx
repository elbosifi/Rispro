import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ReportCenter } from "./report-center";
import { REPORT_TEMPLATES } from "./report-center-templates";

const fetchAppointmentsMock = vi.fn();
const fetchAppointmentLookupsMock = vi.fn();
const fetchPatientDirectoryMock = vi.fn();
const fetchAuditEntriesMock = vi.fn();
const recordReportOutputMock = vi.fn();
const exportReportXlsxMock = vi.fn();
const directPrintReportCenterMock = vi.fn();
const fetchReportCenterPdfMock = vi.fn();
let role = "supervisor";

vi.mock("@/lib/api-hooks", () => ({
  exportReportXlsx: (...args: unknown[]) => exportReportXlsxMock(...args),
  fetchAppointments: (...args: unknown[]) => fetchAppointmentsMock(...args),
  fetchAppointmentLookups: (...args: unknown[]) => fetchAppointmentLookupsMock(...args),
  fetchAuditEntries: (...args: unknown[]) => fetchAuditEntriesMock(...args),
  fetchPatientDirectory: (...args: unknown[]) => fetchPatientDirectoryMock(...args),
  recordReportOutput: (...args: unknown[]) => recordReportOutputMock(...args),
}));

vi.mock("@/providers/auth-provider", () => ({
  useAuth: () => ({ user: { id: 1, username: role, fullName: "User", role }, isLoading: false }),
}));

vi.mock("@/providers/language-provider", () => ({
  useLanguage: () => ({ language: "en" }),
}));

vi.mock("@/services/printing/direct-print-service", () => ({
  directPrintReportCenter: (...args: unknown[]) => directPrintReportCenterMock(...args),
  fetchReportCenterPdf: (...args: unknown[]) => fetchReportCenterPdfMock(...args),
}));

vi.mock("@/services/printing/direct-print-failure-action", () => ({ resolveDirectPrintFailureAction: () => "NONE" }));
vi.mock("@/services/printing/workstation-printer-settings", () => ({ loadQzPrinterSettings: () => ({ browserPrintFallbackEnabled: true }) }));

vi.mock("@/lib/toast", () => ({
  pushToast: vi.fn(),
}));

function renderCenter() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <ReportCenter />
    </QueryClientProvider>
  );
}

describe("ReportCenter", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    role = "supervisor";
    recordReportOutputMock.mockResolvedValue(undefined);
    exportReportXlsxMock.mockResolvedValue(undefined);
    fetchAppointmentLookupsMock.mockResolvedValue({ modalities: [{ id: 1, nameEn: "CT", nameAr: "CT" }] });
    directPrintReportCenterMock.mockResolvedValue({ success: true, printerName: "A4", jobName: "report" });
    fetchReportCenterPdfMock.mockResolvedValue(new Blob(["%PDF-1.4"], { type: "application/pdf" }));
    fetchPatientDirectoryMock.mockResolvedValue({ patients: [{ id: 4, englishFullName: "Patient One", arabicFullName: "", mrn: "MRN-4", sex: "F", ageYears: 40, phone1: "091", category: "oncology" }], pagination: { page: 1, pageSize: 100, total: 1, totalPages: 1 } });
    fetchAuditEntriesMock.mockResolvedValue({ entries: [{ id: 8, entityType: "report_output", actionType: "report_output", createdAt: "2026-08-07", changedByUserId: 1, newValues: { outputType: "print", reportTemplate: "daily-appointments", rowCount: 1 } }], meta: {} });
    fetchAppointmentsMock.mockResolvedValue([
      {
        id: 1,
        appointmentDate: "2026-05-02",
        bookingTime: "08:00",
        accessionNumber: "V2-000001",
        arabicFullName: "Alpha One",
        englishFullName: "Alpha One",
        modalityNameAr: "CT",
        modalityNameEn: "CT",
        examNameAr: "Brain",
        examNameEn: "Brain",
        status: "scheduled",
      },
    ]);
  });

  it("defines fourteen enabled appointment templates and sixteen enabled templates overall", () => {
    expect(REPORT_TEMPLATES.filter((template) => template.source === "appointments")).toHaveLength(14);
    expect(REPORT_TEMPLATES.filter((template) => template.source !== "disabled")).toHaveLength(16);
    expect(REPORT_TEMPLATES.filter((template) => template.source === "disabled")).toHaveLength(5);
  });

  it("routes appointment and patient physical Print through finalized Report Center direct printing", async () => {
    renderCenter();
    await screen.findAllByText("Print & Reports Center");
    await userEvent.click(screen.getByRole("button", { name: "Print" }));
    expect(directPrintReportCenterMock).toHaveBeenCalledWith(expect.objectContaining({ source: "appointments", orientation: "landscape", templateId: "daily-appointments" }));
    expect(recordReportOutputMock).toHaveBeenCalledWith(expect.objectContaining({ outputType: "print" }));

    await userEvent.selectOptions(screen.getByDisplayValue("Daily appointment list"), "patient-directory");
    await screen.findByText("Patient One");
    await userEvent.click(screen.getByRole("button", { name: "Print" }));
    expect(directPrintReportCenterMock).toHaveBeenLastCalledWith(expect.objectContaining({ source: "patients", templateId: "patient-directory" }));
  });

  it("routes the enabled audit source through Report Center direct printing for super admin", async () => {
    role = "super_admin";
    renderCenter();
    await screen.findAllByText("Print & Reports Center");
    await userEvent.selectOptions(screen.getByDisplayValue("Daily appointment list"), "printed-documents-audit");
    await screen.findByText("daily-appointments");
    await userEvent.click(screen.getByRole("button", { name: "Print" }));
    expect(directPrintReportCenterMock).toHaveBeenCalledWith(expect.objectContaining({ source: "audit", templateId: "printed-documents-audit" }));
  });

  it("downloads the same structured Chromium presentation without direct printing", async () => {
    const createObjectURL = vi.fn(() => "blob:report");
    const revokeObjectURL = vi.fn();
    vi.stubGlobal("URL", { ...URL, createObjectURL, revokeObjectURL });
    renderCenter();
    await screen.findAllByText("Print & Reports Center");
    await userEvent.click(screen.getByRole("button", { name: "Download PDF" }));
    expect(fetchReportCenterPdfMock).toHaveBeenCalledWith(expect.objectContaining({ templateId: "daily-appointments", source: "appointments" }));
    expect(directPrintReportCenterMock).not.toHaveBeenCalled();
    expect(recordReportOutputMock).toHaveBeenCalledWith(expect.objectContaining({ outputType: "pdf" }));
    vi.unstubAllGlobals();
  });

  it("loads the report center and updates preview filters", async () => {
    renderCenter();

    expect((await screen.findAllByText("Print & Reports Center")).length).toBeGreaterThan(0);
    await screen.findByRole("option", { name: "CT" });
    await userEvent.selectOptions(screen.getByLabelText("Modality"), "1");

    await waitFor(() => {
      expect(fetchAppointmentsMock).toHaveBeenCalledWith(expect.objectContaining({ modalityId: "1" }));
    });
  });

  it("audits CSV exports and saves local presets", async () => {
    renderCenter();

    expect((await screen.findAllByText("Print & Reports Center")).length).toBeGreaterThan(0);
    await userEvent.type(screen.getByLabelText("Preset name"), "Morning CT");
    await userEvent.click(screen.getByRole("button", { name: "Save preset" }));
    expect(screen.getByRole("option", { name: "Morning CT" })).toBeTruthy();

    await userEvent.click(screen.getByRole("button", { name: "CSV" }));
    expect(recordReportOutputMock).toHaveBeenCalledWith(expect.objectContaining({
      reportTemplate: "daily-appointments",
      outputType: "csv",
      rowCount: 1,
      includePhoneNumbers: false,
      includePatientIdentifiers: true,
    }));
  });

  it("exports Excel through the backend workbook endpoint", async () => {
    renderCenter();

    expect((await screen.findAllByText("Print & Reports Center")).length).toBeGreaterThan(0);
    await userEvent.click(screen.getByRole("button", { name: "Excel" }));

    expect(exportReportXlsxMock).toHaveBeenCalledWith(expect.objectContaining({
      reportTemplate: "daily-appointments",
      includePhoneNumbers: false,
      includePatientIdentifiers: true,
      rows: [expect.objectContaining({ Accession: "V2-000001" })],
    }));
  });
});
