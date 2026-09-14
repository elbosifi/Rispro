import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { User } from "@/types/api";
import type { IrReferral } from "@/lib/api/ir-referrals";

const apiMocks = vi.hoisted(() => ({
  confirm: vi.fn(),
  createSchedule: vi.fn(),
  deleteDocument: vi.fn(),
  fetchDoctorMe: vi.fn(),
  fetchIrReferral: vi.fn(),
  listDocuments: vi.fn(),
  recordDecision: vi.fn(),
  uploadDocument: vi.fn(),
}));
const authState = vi.hoisted(() => ({
  user: { id: 101, username: "reception", fullName: "Reception", role: "receptionist" as User["role"] },
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
vi.mock("@/lib/api/doctor-portal-reporting", () => ({ fetchDoctorMe: apiMocks.fetchDoctorMe }));
vi.mock("@/providers/auth-provider", () => ({ useAuth: () => ({ user: authState.user, isLoading: false }) }));
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
  reviewedByDoctorId: null,
  reviewedByDoctorName: null,
  reviewedByDoctorNameAr: null,
  reviewedByDoctorNameEn: null,
  reviewedAt: null,
  createdAt: "2026-09-14T08:00:00Z",
  documentCount: 0,
  scheduleRequestId: null,
};

const preparationDocument = { id: 9, originalFilename: "supporting-report.pdf" };

function activeDoctorMe(profileId: number) {
  return { hasActiveDoctorProfile: true, profile: { id: profileId } };
}

function configureViewer(role: User["role"], profileId: number | null = null) {
  authState.user = { id: 101, username: role, fullName: role, role };
  apiMocks.fetchDoctorMe.mockResolvedValue(profileId == null ? { hasActiveDoctorProfile: false, profile: null } : activeDoctorMe(profileId));
}

function renderPage(referral: IrReferral, documents: Array<{ id: number; originalFilename: string }> = []) {
  apiMocks.fetchIrReferral.mockResolvedValue(referral);
  apiMocks.listDocuments.mockResolvedValue(documents);
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

beforeEach(() => {
  configureViewer("receptionist");
  apiMocks.fetchDoctorMe.mockReset().mockResolvedValue({ hasActiveDoctorProfile: false, profile: null });
  apiMocks.recordDecision.mockResolvedValue(undefined);
});

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

  it("shows and safely rehydrates a previously eligible assessment for editing", async () => {
    configureViewer("doctor", 11);
    const reviewedAt = "2026-09-14T09:30:00Z";
    const reviewedReferral = {
      ...baseReferral,
      status: "ready_for_review",
      assessmentText: "Suitable for CT-guided biopsy.",
      decision: "eligible_for_intervention",
      decisionNote: null,
      reviewedByDoctorId: 11,
      reviewedByDoctorName: "Dr IR",
      reviewedByDoctorNameAr: "Dr IR Arabic",
      reviewedByDoctorNameEn: "Dr IR",
      reviewedAt,
    };
    renderPage(reviewedReferral);

    expect(await screen.findByText("IR Assessment")).toBeTruthy();
    expect(screen.getByText("Suitable for CT-guided biopsy.")).toBeTruthy();
    expect(screen.getByText("Eligible for intervention")).toBeTruthy();
    expect(screen.getByText("Dr IR")).toBeTruthy();
    expect(screen.getByText(new Date(reviewedAt).toLocaleString())).toBeTruthy();
    expect(screen.queryByText("Clinical IR decision")).toBeNull();

    await userEvent.click(screen.getByRole("button", { name: "Edit assessment" }));
    expect(screen.getByText("Clinical IR decision")).toBeTruthy();
    expect((screen.getByLabelText("Assessment") as HTMLTextAreaElement).value).toBe("Suitable for CT-guided biopsy.");
    expect((screen.getByLabelText("Decision") as HTMLSelectElement).value).toBe("eligible_for_intervention");
  });

  it("shows Review new information and preloads the previous needs-information review", async () => {
    configureViewer("doctor", 11);
    const returnedReferral = {
      ...baseReferral,
      status: "ready_for_review",
      assessmentText: "Potential biopsy candidate.",
      reviewedByDoctorId: 11,
      reviewedByDoctorName: "Dr IR",
      reviewedByDoctorNameAr: "Dr IR Arabic",
      reviewedByDoctorNameEn: "Dr IR",
      reviewedAt: "2026-09-14T09:30:00Z",
    };
    renderPage(returnedReferral);

    expect(await screen.findByText("IR Assessment")).toBeTruthy();
    expect(screen.getByText("Potential biopsy candidate.")).toBeTruthy();
    expect(screen.getByText("Needs additional information")).toBeTruthy();
    expect(screen.getByText("Please add the prior report")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Review new information" })).toBeTruthy();

    await userEvent.click(screen.getByRole("button", { name: "Review new information" }));
    expect((screen.getByLabelText("Assessment") as HTMLTextAreaElement).value).toBe("Potential biopsy candidate.");
    expect((screen.getByLabelText("Decision") as HTMLSelectElement).value).toBe("needs_information");
    expect((screen.getByLabelText("Decision note") as HTMLTextAreaElement).value).toBe("Please add the prior report");
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

  it.each(["receptionist", "modality_staff"] as const)("%s can prepare but cannot review, schedule, or delete", async (role) => {
    configureViewer(role);
    renderPage({ ...baseReferral, status: "preparing" }, [preparationDocument]);

    expect(await screen.findByLabelText("Choose document")).toBeTruthy();
    expect(screen.getByRole("link", { name: "PACS Remap" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Confirm & Send for IR Review" })).toBeTruthy();
    expect(screen.queryByText("Clinical IR decision")).toBeNull();
    expect(screen.queryByText("Request Appointment")).toBeNull();
    expect(screen.queryByRole("button", { name: "Remove document 9" })).toBeNull();
  });

  it("allows the assigned doctor to review and request an appointment after an eligible decision", async () => {
    configureViewer("doctor", 11);
    const reviewedReferral = {
      ...baseReferral,
      status: "ready_for_review",
      decision: "eligible_for_intervention",
      decisionNote: null,
      reviewedByDoctorId: 11,
      reviewedByDoctorName: "Dr IR",
      reviewedByDoctorNameAr: "Dr IR Arabic",
      reviewedByDoctorNameEn: "Dr IR",
      reviewedAt: "2026-09-14T09:30:00Z",
    };
    renderPage(reviewedReferral);

    expect(await screen.findByRole("button", { name: "Edit assessment" })).toBeTruthy();
    expect(screen.queryByText("Clinical IR decision")).toBeNull();
    expect(screen.getByText("Request Appointment")).toBeTruthy();
  });

  it("shows a different doctor's saved assessment read-only without clinical mutation controls", async () => {
    configureViewer("doctor", 12);
    const reviewedReferral = {
      ...baseReferral,
      status: "ready_for_review",
      decision: "eligible_for_intervention",
      decisionNote: null,
      reviewedByDoctorId: 11,
      reviewedByDoctorName: "Dr IR",
      reviewedByDoctorNameAr: "Dr IR Arabic",
      reviewedByDoctorNameEn: "Dr IR",
      reviewedAt: "2026-09-14T09:30:00Z",
    };
    renderPage(reviewedReferral);

    expect(await screen.findByText("IR Assessment")).toBeTruthy();
    expect(screen.getByText("Prior assessment")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Edit assessment" })).toBeNull();
    expect(screen.queryByText("Clinical IR decision")).toBeNull();
    expect(screen.queryByText("Request Appointment")).toBeNull();
  });

  it("allows a supervisor with an active profile to review as manager and delete preparation documents", async () => {
    configureViewer("supervisor", 99);
    renderPage({ ...baseReferral, status: "ready_for_review", decision: null, reviewedAt: null });
    expect(await screen.findByText("Clinical IR decision")).toBeTruthy();

    cleanup();
    apiMocks.fetchIrReferral.mockResolvedValue({ ...baseReferral, status: "needs_information" });
    renderPage({ ...baseReferral, status: "needs_information" }, [preparationDocument]);
    expect(await screen.findByRole("button", { name: "Remove document 9" })).toBeTruthy();
  });

  it("allows a supervisor without an active profile to prepare/delete but not make clinical decisions", async () => {
    configureViewer("supervisor");
    renderPage(baseReferral, [preparationDocument]);

    expect(await screen.findByRole("button", { name: "Remove document 9" })).toBeTruthy();
    expect(screen.queryByText("Clinical IR decision")).toBeNull();
    expect(screen.queryByText("Request Appointment")).toBeNull();
  });

  it("uses the saved values after a successful decision edit", async () => {
    configureViewer("doctor", 11);
    const reviewedReferral = {
      ...baseReferral,
      status: "ready_for_review",
      decision: "eligible_for_intervention",
      decisionNote: null,
      reviewedByDoctorId: 11,
      reviewedByDoctorName: "Dr IR",
      reviewedByDoctorNameAr: "Dr IR Arabic",
      reviewedByDoctorNameEn: "Dr IR",
      reviewedAt: "2026-09-14T09:30:00Z",
    };
    apiMocks.recordDecision.mockResolvedValue(reviewedReferral);
    renderPage(reviewedReferral);

    await userEvent.click(await screen.findByRole("button", { name: "Edit assessment" }));
    await userEvent.click(screen.getByRole("button", { name: "Record decision" }));
    await waitFor(() => expect(screen.queryByText("Clinical IR decision")).toBeNull());
    expect(screen.getByText("IR Assessment")).toBeTruthy();
  });
});
