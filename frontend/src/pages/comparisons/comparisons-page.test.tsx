import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import type { ComparisonRequest } from "@/types/api";

const authState = vi.hoisted(() => ({ role: "supervisor" as string }));
const languageState = vi.hoisted(() => ({ language: "en" as "en" | "ar" }));
const apiMocks = vi.hoisted(() => ({
  cancel: vi.fn(),
  confirm: vi.fn(),
  fetchOne: vi.fn(),
  fetchMany: vi.fn(),
  searchPatients: vi.fn(),
  fetchIrReferrals: vi.fn(),
}));

vi.mock("@/providers/auth-provider", () => ({
  useAuth: () => ({ user: { id: 9, role: authState.role } }),
}));
vi.mock("@/providers/language-provider", () => ({ useLanguage: () => ({ language: languageState.language }) }));
vi.mock("@/lib/api-hooks", () => ({
  cancelComparisonRequest: apiMocks.cancel,
  confirmComparisonMaterials: apiMocks.confirm,
  fetchComparisonRequest: apiMocks.fetchOne,
  fetchComparisonRequests: apiMocks.fetchMany,
}));
vi.mock("@/lib/toast", () => ({ pushToast: vi.fn() }));
vi.mock("@/lib/api/patients", () => ({ searchPatients: apiMocks.searchPatients }));
vi.mock("@/lib/api/ir-referrals", () => ({ fetchIrReferrals: apiMocks.fetchIrReferrals }));
vi.mock("@/components/patients/request-comparison-modal", () => ({ RequestComparisonModal: () => <div>Comparison modal launched</div> }));
vi.mock("@/components/patients/request-ir-referral-modal", () => ({ RequestIrReferralModal: () => <div>IR consultation modal launched</div> }));
vi.mock("./comparison-documents-panel", () => ({
  ComparisonDocumentsPanel: ({ comparisonRequestId, canAttach, canDelete }: { comparisonRequestId: number; canAttach: boolean; canDelete: boolean }) => (
    <div aria-label={`Documents for ${comparisonRequestId}`} data-can-attach={String(canAttach)} data-can-delete={String(canDelete)}>Upload Scan View</div>
  ),
}));

import ComparisonsPage from "./comparisons-page";

const root = path.resolve(__dirname, "../../..");

describe("comparison request frontend contract", () => {
  it("provides a comparison preparation worklist using existing material systems", () => {
    const page = readFileSync(path.join(root, "src/pages/comparisons/comparisons-page.tsx"), "utf8");
    const app = readFileSync(path.join(root, "src/App.tsx"), "utf8");
    const documentsPanel = readFileSync(path.join(root, "src/pages/comparisons/comparison-documents-panel.tsx"), "utf8");
    const remapPage = readFileSync(path.join(root, "src/pages/pacs/pacs-remap-page.tsx"), "utf8");
    const drawer = readFileSync(path.join(root, "src/components/patients/patient-drawer.tsx"), "utf8");
    const reportingApi = readFileSync(path.join(root, "src/lib/api/doctor-portal-reporting.ts"), "utf8");

    expect(drawer).toContain("Request comparison");
    expect(page).toContain("comparisons.confirmAndRelease");
    expect(page).toContain("comparisons.uploadRemap");
    expect(page).toContain("comparisons.cancelTitle");
    expect(page).toContain("ComparisonDocumentsPanel");
    expect(page).toContain("comparisons.openDetails");
    expect(documentsPanel).toContain("uploadComparisonDocument");
    expect(documentsPanel).toContain("scanAppointmentRequest");
    expect(documentsPanel).toContain("DocumentPreviewWorkspace");
    expect(reportingApi).toContain("confirmComparisonMaterials");
    expect(remapPage).toContain("PacsRemapPage");
    expect(app).toContain('path="/comparisons/:id/remap"');
  });
});

function comparison(overrides: Partial<ComparisonRequest> = {}): ComparisonRequest {
  return {
    id: 77,
    patientId: 10,
    patientMrn: "MRN-10",
    patientEnglishName: "Comparison Patient",
    patientArabicName: null,
    linkedPreviousBookingId: 3056,
    linkedPreviousStudyUid: "1.2.3",
    linkedPreviousAccessionNumber: "V2-003056",
    linkedModalityId: 2,
    linkedModalityCode: "CT",
    linkedModalityName: "CT",
    linkedExamTypeId: 4,
    linkedExamName: "CT Chest",
    linkedStudyDate: "2026-07-13",
    reason: "Compare interval change",
    status: "pending_upload_confirmation",
    materialsConfirmed: false,
    materialsConfirmedBy: null,
    materialsConfirmedByName: null,
    materialsConfirmedAt: null,
    materialsConfirmationNote: null,
    imageAvailabilityConfirmed: false,
    documentsAvailabilityConfirmed: false,
    selectedPriorConfirmed: false,
    assignedDoctorId: null,
    assignedDoctorName: null,
    finalizedBy: null,
    finalizedByName: null,
    finalizedAt: null,
    finalText: null,
    createdBy: 8,
    createdByName: "Creator One",
    createdAt: "2026-08-11T08:00:00Z",
    updatedAt: "2026-08-11T08:00:00Z",
    cancelledBy: null,
    cancelledAt: null,
    cancellationReason: null,
    documentCount: 0,
    remapJobId: null,
    remapJobStatus: null,
    remapProcessingStage: null,
    remapSendErrorCode: null,
    remapErrorMessage: null,
    remapUpdatedAt: null,
    ...overrides,
  };
}

function renderPage(pathname = "/comparisons") {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[pathname]}>
        <Routes>
          <Route path="/comparisons" element={<ComparisonsPage />} />
          <Route path="/comparisons/:id" element={<ComparisonsPage />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

afterEach(() => {
  cleanup();
  window.sessionStorage.clear();
  authState.role = "supervisor";
  languageState.language = "en";
  vi.clearAllMocks();
});

beforeEach(() => {
  window.sessionStorage.clear();
  apiMocks.fetchIrReferrals.mockResolvedValue([]);
});

describe("comparison preparation worklist behavior", () => {
  it("uses canonical patient search and offers both review-request actions", async () => {
    apiMocks.fetchMany.mockResolvedValue([]);
    apiMocks.fetchIrReferrals.mockResolvedValue([]);
    apiMocks.searchPatients.mockResolvedValue([{ id: 41, englishFullName: "Shared Entry Patient", arabicFullName: null, mrn: "MRN-41" }]);
    renderPage();
    fireEvent.click(await screen.findByRole("button", { name: "Search Patient" }));
    fireEvent.change(screen.getByRole("textbox", { name: "Search Patient" }), { target: { value: "sh" } });
    expect(await screen.findByText("Shared Entry Patient")).toBeTruthy();
    expect(apiMocks.searchPatients).toHaveBeenCalledWith("sh");
    fireEvent.click(screen.getByText("Shared Entry Patient"));
    fireEvent.click(screen.getByRole("button", { name: "Create Comparison" }));
    expect(await screen.findByText("Comparison modal launched")).toBeTruthy();
    cleanup();
    renderPage();
    fireEvent.click(await screen.findByRole("button", { name: "Search Patient" }));
    fireEvent.change(screen.getByRole("textbox", { name: "Search Patient" }), { target: { value: "sh" } });
    fireEvent.click(await screen.findByText("Shared Entry Patient"));
    fireEvent.click(screen.getByRole("button", { name: "Create IR Consultation" }));
    expect(await screen.findByText("IR consultation modal launched")).toBeTruthy();
  });

  it("renders the worklist in Arabic with RTL direction", async () => {
    languageState.language = "ar";
    apiMocks.fetchMany.mockResolvedValue([]);
    renderPage();

    expect(await screen.findByRole("heading", { name: "طلبات المراجعة" })).toBeTruthy();
    expect(screen.getByRole("main").getAttribute("dir")).toBe("rtl");
    expect(screen.queryByLabelText("حالة المقارنة")).toBeNull();
    expect(screen.getByPlaceholderText("المريض أو رقم الملف أو رقم الفحص أو اسم الفحص أو الإجراء")).toBeTruthy();
  });

  it("shows an auditable cancellation dialog only to eligible roles and requires a reason", async () => {
    const row = comparison();
    apiMocks.fetchMany.mockResolvedValue([row]);
    apiMocks.cancel.mockResolvedValue({ ...row, status: "cancelled" });
    renderPage();

    fireEvent.click(await screen.findByRole("button", { name: "Cancel request" }));
    const dialog = screen.getByRole("dialog");
    expect(within(dialog).getByText(/Comparison Patient/)).toBeTruthy();
    expect(within(dialog).getByText(/CT Chest/)).toBeTruthy();
    expect(within(dialog).getByText("Compare interval change")).toBeTruthy();
    const confirmCancel = within(dialog).getByRole("button", { name: "Cancel request" }) as HTMLButtonElement;
    expect(confirmCancel.disabled).toBe(true);
    fireEvent.change(within(dialog).getByLabelText("Cancellation reason"), { target: { value: "Wrong prior study" } });
    expect(confirmCancel.disabled).toBe(false);
    fireEvent.click(confirmCancel);
    await waitFor(() => expect(apiMocks.cancel).toHaveBeenCalledWith(77, { reason: "Wrong prior study" }));

    cleanup();
    authState.role = "modality_staff";
    apiMocks.fetchMany.mockResolvedValue([row]);
    renderPage();
    await screen.findByText("Comparison Patient");
    expect(screen.queryByRole("button", { name: "Cancel request" })).toBeNull();
  });

  it("hides destructive or remap actions for terminal rows and exposes cancellation history", async () => {
    apiMocks.fetchMany.mockResolvedValue([
      comparison({ id: 78, status: "finalized", patientEnglishName: "Final Patient", finalizedAt: "2026-08-11T09:00:00Z", finalizedByName: "Doctor One" }),
      comparison({ id: 79, status: "cancelled", patientEnglishName: "Cancelled Patient", cancellationReason: "Duplicate request", cancelledAt: "2026-08-11T09:30:00Z" }),
    ]);
    renderPage();
    await screen.findByText("Final Patient");
    expect(screen.queryByRole("button", { name: "Cancel request" })).toBeNull();
    expect(screen.getByText(/Duplicate request/)).toBeTruthy();
    expect(screen.queryByRole("link", { name: /Upload \/ remap comparison study/ })).toBeNull();
  });

  it("filters both request domains on All and keeps domain-specific status selectors separate", async () => {
    apiMocks.fetchMany.mockResolvedValue([comparison({ patientEnglishName: "Comparison result" })]);
    apiMocks.fetchIrReferrals.mockResolvedValue([{ id: 91, patientId: 10, patientMrn: "MRN-91", patientEnglishName: "IR result", patientArabicName: null, requestedProcedure: "Biopsy", clinicalIndication: null, status: "ready_for_review", assignedDoctorId: null, assignedDoctorName: null, assignedDoctorNameAr: null, assignedDoctorNameEn: null, notifyAssignedDoctor: false, documentsConfirmed: false, imagesConfirmed: true, materialsConfirmed: false, assessmentText: null, decision: null, decisionNote: null, reviewedByDoctorId: null, reviewedByDoctorName: null, reviewedByDoctorNameAr: null, reviewedByDoctorNameEn: null, reviewedAt: null, createdAt: "2026-08-11T08:00:00Z", documentCount: 2, scheduleRequestId: null }]);
    renderPage();
    await waitFor(() => expect(apiMocks.fetchMany).toHaveBeenCalledWith({ status: "all", q: null }));
    await waitFor(() => expect(apiMocks.fetchIrReferrals).toHaveBeenCalledWith({ status: "all", q: null }));
    expect(screen.queryByLabelText("Comparison status")).toBeNull();
    expect(await screen.findByText("Comparison result")).toBeTruthy();
    expect(await screen.findByText("IR result")).toBeTruthy();
    fireEvent.change(screen.getByRole("textbox", { name: "Search" }), { target: { value: "MRN-123" } });
    fireEvent.click(screen.getByRole("button", { name: "Search" }));
    await waitFor(() => expect(apiMocks.fetchMany).toHaveBeenCalledWith({ status: "all", q: "MRN-123" }));
    await waitFor(() => expect(apiMocks.fetchIrReferrals).toHaveBeenCalledWith({ status: "all", q: "MRN-123" }));

    fireEvent.click(screen.getByRole("button", { name: "Comparisons" }));
    expect(screen.getByLabelText("Comparison status")).toBeTruthy();
    expect(screen.queryByLabelText("IR consultation status")).toBeNull();
    await waitFor(() => expect(apiMocks.fetchMany).toHaveBeenCalledWith({ status: "active", q: "MRN-123" }));

    fireEvent.click(screen.getByRole("button", { name: "IR Consultations" }));
    expect(screen.getByLabelText("IR consultation status")).toBeTruthy();
    expect(screen.queryByLabelText("Comparison status")).toBeNull();
    fireEvent.change(screen.getByLabelText("IR consultation status"), { target: { value: "needs_information" } });
    await waitFor(() => expect(apiMocks.fetchIrReferrals).toHaveBeenCalledWith({ status: "needs_information", q: "MRN-123" }));
  });

  it("uses the Comparison default status when opening the Comparisons tab", async () => {
    apiMocks.fetchMany.mockResolvedValue([]);
    renderPage();
    fireEvent.click(screen.getByRole("button", { name: "Comparisons" }));
    await waitFor(() => expect(apiMocks.fetchMany).toHaveBeenCalledWith({ status: "active", q: null }));
    fireEvent.change(screen.getByLabelText("Comparison status"), { target: { value: "cancelled" } });
    await waitFor(() => expect(apiMocks.fetchMany).toHaveBeenCalledWith({ status: "cancelled", q: null }));
    fireEvent.change(screen.getByRole("textbox", { name: "Search" }), { target: { value: "  MRN-10  " } });
    fireEvent.click(screen.getByRole("button", { name: "Search" }));
    await waitFor(() => expect(apiMocks.fetchMany).toHaveBeenCalledWith({ status: "cancelled", q: "MRN-10" }));
  });

  it("localizes current assigned and planned doctor names with legacy fallback", async () => {
    apiMocks.fetchMany.mockResolvedValue([
      comparison({ id: 83, status: "assigned", assignedDoctorId: 2, assignedDoctorName: "Legacy Doctor", assignedDoctorNameAr: "Arabic Doctor", assignedDoctorNameEn: "English Doctor" }),
      comparison({ id: 84, status: "pending_upload_confirmation", plannedReportingDoctorId: 3, plannedReportingDoctorName: "Legacy Plan", plannedReportingDoctorNameAr: null, plannedReportingDoctorNameEn: null }),
    ]);
    renderPage();
    expect(await screen.findByText(/Assigned doctor: English Doctor/)).toBeTruthy();
    expect(screen.getByText(/Target doctor: Legacy Plan/)).toBeTruthy();

    cleanup();
    languageState.language = "ar";
    apiMocks.fetchMany.mockResolvedValue([comparison({ id: 85, status: "assigned", assignedDoctorId: 2, assignedDoctorName: "Legacy Doctor", assignedDoctorNameAr: "Arabic Doctor", assignedDoctorNameEn: "English Doctor" })]);
    renderPage();
    expect(await screen.findByText(/Arabic Doctor/)).toBeTruthy();
  });

  it("renders truthful remap evidence and launches the existing workflow with comparison context", async () => {
    apiMocks.fetchMany.mockResolvedValue([
      comparison({ id: 80, patientEnglishName: "Processing Patient", remapJobId: 501, remapJobStatus: "processing", remapProcessingStage: "rewriting" }),
      comparison({ id: 81, patientEnglishName: "Ready Patient", remapJobId: 502, remapJobStatus: "sent" }),
      comparison({ id: 82, patientEnglishName: "Failed Patient", remapJobId: 503, remapJobStatus: "failed", remapErrorMessage: "PACS destination unavailable" }),
    ]);
    renderPage();
    await screen.findByText("Processing Patient");
    expect(screen.getByText("Processing")).toBeTruthy();
    expect(screen.getByText("Sent / PACS ready")).toBeTruthy();
    expect(screen.getByText("Failed")).toBeTruthy();
    expect(screen.getByText("PACS destination unavailable")).toBeTruthy();
    const link = screen.getAllByRole("link", { name: /Upload \/ remap comparison study/ })[0] as HTMLAnchorElement;
    expect(link.getAttribute("href")).toBe("/comparisons/80/remap?comparisonRequestId=80&patientId=10&returnPath=%2Fcomparisons%2F80");
  });

  it("requires a truthful paper disposition before release", async () => {
    apiMocks.fetchMany.mockResolvedValue([comparison({ documentCount: 2, remapJobStatus: "sent" })]);
    apiMocks.confirm.mockResolvedValue(comparison({ status: "ready_for_reporting", materialsConfirmed: true }));
    renderPage();
    const release = await screen.findByRole("button", { name: "Confirm and send to reporting pool" }) as HTMLButtonElement;
    expect(release.disabled).toBe(true);
    for (const checkbox of screen.getAllByRole("checkbox")) fireEvent.click(checkbox);
    expect(release.disabled).toBe(true);
    fireEvent.click(screen.getByRole("radio", { name: "Papers attached and verified" }));
    expect(release.disabled).toBe(false);
    fireEvent.click(release);
    await waitFor(() => expect(apiMocks.confirm).toHaveBeenCalledWith(77, {
      imageAvailabilityConfirmed: true,
      documentsAvailabilityConfirmed: true,
      documentsDisposition: "attached_verified",
      selectedPriorConfirmed: true,
      materialsConfirmationNote: null,
    }));
  });
});
