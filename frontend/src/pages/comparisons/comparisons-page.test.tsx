import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import type { ComparisonRequest } from "@/types/api";

const authState = vi.hoisted(() => ({ role: "supervisor" as string }));
const apiMocks = vi.hoisted(() => ({
  cancel: vi.fn(),
  confirm: vi.fn(),
  fetchOne: vi.fn(),
  fetchMany: vi.fn(),
}));

vi.mock("@/providers/auth-provider", () => ({
  useAuth: () => ({ user: { id: 9, role: authState.role } }),
}));
vi.mock("@/lib/api-hooks", () => ({
  cancelComparisonRequest: apiMocks.cancel,
  confirmComparisonMaterials: apiMocks.confirm,
  fetchComparisonRequest: apiMocks.fetchOne,
  fetchComparisonRequests: apiMocks.fetchMany,
}));
vi.mock("@/lib/toast", () => ({ pushToast: vi.fn() }));
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
    expect(page).toContain("Confirm and send to reporting pool");
    expect(page).toContain("Upload / remap comparison study");
    expect(page).toContain("Cancel comparison request");
    expect(page).toContain("ComparisonDocumentsPanel");
    expect(page).toContain("Open details");
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
  authState.role = "supervisor";
  vi.clearAllMocks();
});

describe("comparison preparation worklist behavior", () => {
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

  it("uses Active by default and applies simple status and search filters", async () => {
    apiMocks.fetchMany.mockResolvedValue([]);
    renderPage();
    await waitFor(() => expect(apiMocks.fetchMany).toHaveBeenCalledWith({ status: "active", q: null }));
    fireEvent.change(screen.getByLabelText("Comparison status"), { target: { value: "cancelled" } });
    await waitFor(() => expect(apiMocks.fetchMany).toHaveBeenCalledWith({ status: "cancelled", q: null }));
    fireEvent.change(screen.getByLabelText("Search comparison requests"), { target: { value: "  MRN-10  " } });
    fireEvent.click(screen.getByRole("button", { name: "Search" }));
    await waitFor(() => expect(apiMocks.fetchMany).toHaveBeenCalledWith({ status: "cancelled", q: "MRN-10" }));
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

  it("keeps final release disabled until all three human confirmations are checked", async () => {
    apiMocks.fetchMany.mockResolvedValue([comparison({ documentCount: 2, remapJobStatus: "sent" })]);
    apiMocks.confirm.mockResolvedValue(comparison({ status: "ready_for_reporting", materialsConfirmed: true }));
    renderPage();
    const release = await screen.findByRole("button", { name: "Confirm and send to reporting pool" }) as HTMLButtonElement;
    expect(release.disabled).toBe(true);
    for (const checkbox of screen.getAllByRole("checkbox")) fireEvent.click(checkbox);
    expect(release.disabled).toBe(false);
    fireEvent.click(release);
    await waitFor(() => expect(apiMocks.confirm).toHaveBeenCalledWith(77, {
      imageAvailabilityConfirmed: true,
      documentsAvailabilityConfirmed: true,
      selectedPriorConfirmed: true,
      materialsConfirmationNote: null,
    }));
  });
});
