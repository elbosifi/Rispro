import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { IrReferral } from "@/lib/api/ir-referrals";

const apiMocks = vi.hoisted(() => ({
  confirm: vi.fn(),
  createSchedule: vi.fn(),
  deleteDocument: vi.fn(),
  fetchIrReferral: vi.fn(),
  listDocuments: vi.fn(),
  recordDecision: vi.fn(),
  uploadDocument: vi.fn(),
}));

vi.mock("@/lib/api/ir-referrals", () => ({
  confirmIrReferralMaterials: apiMocks.confirm,
  createIrReferralScheduleRequest: apiMocks.createSchedule,
  deleteIrReferralDocument: apiMocks.deleteDocument,
  fetchIrReferral: apiMocks.fetchIrReferral,
  listIrReferralDocuments: apiMocks.listDocuments,
  recordIrReferralDecision: apiMocks.recordDecision,
  uploadIrReferralDocument: apiMocks.uploadDocument,
}));
vi.mock("@/providers/language-provider", () => ({ useLanguage: () => ({ language: "en" }) }));
vi.mock("@/lib/toast", () => ({ pushToast: vi.fn() }));
vi.mock("@/v2/appointments/api", () => ({
  useV2ExamTypes: () => ({ data: [] }),
  useV2Lookups: () => ({ data: { modalities: [] } }),
}));

import IrReferralDetailPage from "./ir-referral-detail-page";

const baseReferral: IrReferral = {
  id: 42,
  patientId: 7,
  patientMrn: "MRN-123",
  patientDicomId: "DICOM-777",
  patientEnglishName: "IR Patient",
  patientArabicName: null,
  requestedProcedure: "Biopsy",
  clinicalIndication: "Clinical indication",
  status: "needs_information",
  assignedDoctorId: 11,
  assignedDoctorName: "Doctor",
  assignedDoctorNameAr: null,
  assignedDoctorNameEn: "Doctor",
  notifyAssignedDoctor: false,
  documentsConfirmed: true,
  imagesConfirmed: true,
  materialsConfirmed: true,
  assessmentText: "Prior assessment",
  decision: "needs_information",
  decisionNote: "Please add the prior report",
  createdAt: "2026-09-14T08:00:00Z",
  documentCount: 0,
  scheduleRequestId: null,
};

function renderPage(referral: IrReferral) {
  apiMocks.fetchIrReferral.mockResolvedValue(referral);
  apiMocks.listDocuments.mockResolvedValue([]);
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={["/comparisons/ir/42"]}>
        <Routes>
          <Route path="/comparisons/ir/:id" element={<IrReferralDetailPage />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("IR referral detail page", () => {
  it("opens material preparation for needs_information and preserves the doctor request history", async () => {
    renderPage(baseReferral);

    expect(await screen.findByText("Additional information requested")).toBeTruthy();
    expect(screen.getByText("Please add the prior report")).toBeTruthy();
    expect(screen.getByText(/Assessment: Prior assessment/)).toBeTruthy();
    expect(screen.getByLabelText("Choose document")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Confirm & Send for IR Review" })).toBeTruthy();
    expect(screen.getByRole("link", { name: "PACS Remap" })).toBeTruthy();
    expect(screen.queryByText("Clinical IR decision")).toBeNull();
  });

  it("uses only the canonical DICOM PatientID for patient studies and omits the link when unavailable", async () => {
    renderPage(baseReferral);

    const patientStudies = await screen.findByRole("link", { name: /Open patient studies/ });
    expect(patientStudies.getAttribute("href")).toContain("DICOM-777");
    expect(patientStudies.getAttribute("href")).not.toContain("MRN-123");

    cleanup();
    apiMocks.fetchIrReferral.mockResolvedValue({ ...baseReferral, patientDicomId: null });
    apiMocks.listDocuments.mockResolvedValue([]);
    renderPage({ ...baseReferral, patientDicomId: null });

    expect(await screen.findByText("Patient PACS identifier unavailable")).toBeTruthy();
    expect(screen.queryByRole("link", { name: /Open patient studies/ })).toBeNull();
  });
});
