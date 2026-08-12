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
const directPrintRegistrationRowsMock = vi.fn();
const pushToastMock = vi.fn();
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
  pushToast: (...args: unknown[]) => pushToastMock(...args),
}));
vi.mock("@/lib/registration-list-printing", () => ({
  directPrintRegistrationRows: (...args: unknown[]) => directPrintRegistrationRowsMock(...args),
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
    fetchAppointmentLookupsMock.mockResolvedValue({ modalities: [{ id: 1, nameEn: "CT", nameAr: "CT" }], priorities: [{ id: 1, nameEn: "Urgent", nameAr: "Urgent" }] });
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
    directPrintRegistrationRowsMock.mockResolvedValue(undefined);
  });

  it("exposes only supported templates, with routine workflows separate from operations", () => {
    expect(REPORT_TEMPLATES.filter((template) => template.source === "appointments")).toHaveLength(11);
    expect(REPORT_TEMPLATES).toHaveLength(13);
    expect(REPORT_TEMPLATES.some((template) => template.id === "appointment-slips" || template.id === "preparation-instructions" || template.id === "capacity-utilization")).toBe(false);
  });

  it("routes appointment and patient physical Print through finalized Report Center direct printing", async () => {
    renderCenter();
    await screen.findAllByText("Print & Reports Center");
    await userEvent.click(screen.getByRole("button", { name: "Print" }));
    expect(directPrintReportCenterMock).toHaveBeenCalledWith(expect.objectContaining({ source: "appointments", orientation: "landscape", templateId: "daily-appointments" }));
    expect(recordReportOutputMock).toHaveBeenCalledWith(expect.objectContaining({ outputType: "print" }));

    await userEvent.selectOptions(screen.getByLabelText("Report template"), "patient-directory");
    await screen.findByText("Patient One");
    await userEvent.click(screen.getByRole("button", { name: "Print" }));
    expect(directPrintReportCenterMock).toHaveBeenLastCalledWith(expect.objectContaining({ source: "patients", templateId: "patient-directory" }));
  });

  it("routes the enabled audit source through Report Center direct printing for super admin", async () => {
    role = "super_admin";
    renderCenter();
    await screen.findAllByText("Print & Reports Center");
    await userEvent.selectOptions(screen.getByLabelText("Report template"), "printed-documents-audit");
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
    await userEvent.selectOptions(screen.getAllByLabelText("Modality")[0], "1");

    await waitFor(() => {
      expect(fetchAppointmentsMock).toHaveBeenCalledWith(expect.objectContaining({ modalityId: "1" }));
    });
  });

  it("audits CSV exports and saves local presets", async () => {
    renderCenter();

    expect((await screen.findAllByText("Print & Reports Center")).length).toBeGreaterThan(0);
    await userEvent.click(screen.getByRole("button", { name: "Saved views / advanced" }));
    await userEvent.type(screen.getByLabelText("Saved view name"), "Morning CT");
    await userEvent.click(screen.getByRole("button", { name: "Save" }));
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
    expect(recordReportOutputMock).not.toHaveBeenCalledWith(expect.objectContaining({ outputType: "xlsx" }));
  });

  it("sends a real priority filter and keeps fixed report conditions out of the status selector", async () => {
    renderCenter();
    await screen.findAllByText("Print & Reports Center");
    await userEvent.selectOptions(screen.getByLabelText("Report template"), "priority-urgent");
    await userEvent.selectOptions(screen.getByLabelText("Reporting priority"), "Urgent");
    await waitFor(() => expect(fetchAppointmentsMock).toHaveBeenCalledWith(expect.objectContaining({ priority: "Urgent" })));

    await userEvent.selectOptions(screen.getByLabelText("Report template"), "no-show-list");
    expect(screen.queryByRole("combobox", { name: "Status" })).toBeNull();
    expect(screen.getByText(/Status:/).textContent).toContain("no-show");
  });

  it("uses exam grouping and the specialized registration printer", async () => {
    renderCenter();
    await screen.findAllByText("Print & Reports Center");
    await userEvent.selectOptions(screen.getByLabelText("Report template"), "exam-type-volume");
    expect(await screen.findByText((_, element) => element?.textContent === "Grouped by: exam")).toBeTruthy();
    expect((await screen.findAllByText("Brain")).length).toBeGreaterThan(0);

    await userEvent.selectOptions(screen.getByLabelText("Report template"), "registration-list");
    await userEvent.click(screen.getByRole("button", { name: "Print" }));
    expect(directPrintRegistrationRowsMock).toHaveBeenCalledWith([expect.objectContaining({ id: 1 })], expect.any(String));
    expect(directPrintReportCenterMock).not.toHaveBeenCalledWith(expect.objectContaining({ templateId: "registration-list" }));
  });

  it("uses the same effective appointment columns for preview, print, and Excel", async () => {
    renderCenter();
    await userEvent.click(screen.getByLabelText("Select column: Accession"));
    expect(screen.queryByRole("columnheader", { name: "Accession" })).toBeNull();
    await userEvent.click(screen.getByRole("button", { name: "Print" }));
    expect(directPrintReportCenterMock).toHaveBeenLastCalledWith(expect.objectContaining({ columns: expect.not.arrayContaining([expect.objectContaining({ key: "accession" })]) }));
    await userEvent.click(screen.getByRole("button", { name: "Excel" }));
    expect(exportReportXlsxMock).toHaveBeenLastCalledWith(expect.objectContaining({ rows: [expect.not.objectContaining({ Accession: expect.anything() })] }));
  });

  it("hides generic controls for Registration List while retaining its specialized print", async () => {
    renderCenter();
    await userEvent.selectOptions(screen.getByLabelText("Report template"), "registration-list");
    expect(screen.queryByLabelText("Orientation")).toBeNull();
    expect(screen.queryByText("Show grouped counts")).toBeNull();
    expect(screen.queryByLabelText("Include patient phones")).toBeNull();
    expect(screen.queryByText(/Columns \(/)).toBeNull();
    expect(screen.queryByRole("button", { name: "Download PDF" })).toBeNull();
    expect(screen.getByText("Layout is fixed for this document.")).toBeTruthy();
  });

  it("uses source-specific audit query and document labels", async () => {
    role = "super_admin";
    renderCenter();
    await userEvent.selectOptions(screen.getByLabelText("Report template"), "patient-directory");
    await screen.findByText("Patient One");
    await userEvent.click(screen.getByRole("button", { name: "Print" }));
    expect(directPrintReportCenterMock).toHaveBeenLastCalledWith(expect.objectContaining({ dateLabel: "Current directory result" }));
    await userEvent.selectOptions(screen.getByLabelText("Report template"), "printed-documents-audit");
    await waitFor(() => expect(fetchAuditEntriesMock).toHaveBeenCalledWith({ entityType: "report_output", page: 1, pageSize: 200 }));
    await userEvent.click(screen.getByRole("button", { name: "Print" }));
    expect(directPrintReportCenterMock).toHaveBeenLastCalledWith(expect.objectContaining({ dateLabel: "Most recent report outputs" }));
  });

  it("does not fall back to a global template for a role with no workflows", async () => {
    role = "doctor";
    renderCenter();
    expect(await screen.findByText("No Print Center workflows are available for this role.")).toBeTruthy();
    expect(screen.queryByLabelText("Report template")).toBeNull();
  });

  it("keeps fixed summaries mandatory and only exposes ordinary summary controls after grouping", async () => {
    renderCenter();
    expect(screen.queryByText("Show grouped counts")).toBeNull();
    await userEvent.selectOptions(screen.getByLabelText("Grouping"), "modality");
    expect(screen.getByText("Show grouped counts")).toBeTruthy();
    await userEvent.selectOptions(screen.getByLabelText("Report template"), "exam-type-volume");
    expect(screen.queryByText("Show grouped counts")).toBeNull();
    expect(await screen.findByText("Grouped counts")).toBeTruthy();
  });

  it("disables output actions when no permitted appointment columns remain", async () => {
    renderCenter();
    await userEvent.click(screen.getByLabelText("Select column: Phone"));
    for (const label of ["Time", "Patient", "Accession", "Modality", "Exam", "Category", "Priority", "Status"]) await userEvent.click(screen.getByLabelText(`Select column: ${label}`));
    expect(screen.getByRole("button", { name: "Print" }).hasAttribute("disabled")).toBe(true);
    expect(screen.getByRole("button", { name: "Download PDF" }).hasAttribute("disabled")).toBe(true);
  });

  it("reports clipboard success and failure", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal("navigator", { ...navigator, clipboard: { writeText } });
    renderCenter();
    await userEvent.click(screen.getByRole("button", { name: "Copy" }));
    await waitFor(() => expect(pushToastMock).toHaveBeenCalledWith(expect.objectContaining({ type: "success", title: "Report copied" })));
    writeText.mockRejectedValueOnce(new Error("Denied"));
    await userEvent.click(screen.getByRole("button", { name: "Copy" }));
    await waitFor(() => expect(pushToastMock).toHaveBeenCalledWith(expect.objectContaining({ type: "error", title: "Copy failed" })));
    vi.unstubAllGlobals();
  });
});
