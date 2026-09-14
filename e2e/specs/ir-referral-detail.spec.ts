import { expect, test, type Page } from "@playwright/test";

type BrowserRole = "receptionist" | "doctor";

const reviewedReferral = {
  id: 42,
  patientId: 7,
  patientMrn: "MRN-123",
  patientDicomId: "DICOM-777",
  patientEnglishName: "IR Patient",
  patientArabicName: null,
  requestedProcedure: "Biopsy",
  clinicalIndication: "Clinical indication",
  status: "ready_for_review",
  assignedDoctorId: 11,
  assignedDoctorName: "Doctor",
  assignedDoctorNameAr: null,
  assignedDoctorNameEn: "Doctor",
  notifyAssignedDoctor: false,
  documentsConfirmed: true,
  imagesConfirmed: true,
  materialsConfirmed: true,
  assessmentText: "Suitable for CT-guided biopsy.",
  decision: "eligible_for_intervention",
  decisionNote: null,
  reviewedByDoctorId: 11,
  reviewedByDoctorName: "Dr IR",
  reviewedByDoctorNameAr: "Dr IR Arabic",
  reviewedByDoctorNameEn: "Dr IR",
  reviewedAt: "2026-09-14T09:30:00Z",
  createdAt: "2026-09-14T08:00:00Z",
  documentCount: 0,
  scheduleRequestId: null,
};

const preparingReferral = {
  ...reviewedReferral,
  status: "preparing",
  assessmentText: null,
  decision: null,
  decisionNote: null,
  reviewedByDoctorId: null,
  reviewedByDoctorName: null,
  reviewedByDoctorNameAr: null,
  reviewedByDoctorNameEn: null,
  reviewedAt: null,
};

async function mockIrShell(page: Page, role: BrowserRole, referral: typeof reviewedReferral | typeof preparingReferral) {
  await page.addInitScript(() => localStorage.setItem("rispro-language", "en"));
  await page.route("http://127.0.0.1:5173/api/**", async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    if (path === "/api/auth/me") return route.fulfill({ json: { user: { id: 1, username: role, fullName: role === "doctor" ? "IR Doctor" : "Reception", role } } });
    if (path === "/api/settings/users-and-roles/page-visibility") return route.fulfill({ json: { matrix: { comparisons: ["receptionist", "modality_staff", "doctor", "supervisor", "super_admin"] } } });
    if (path === "/api/doctor/me") return route.fulfill({ json: role === "doctor" ? { hasActiveDoctorProfile: true, canAccessClinicalDoctorPortal: true, canAccessDoctorPortal: true, canAccessCoreWorkspace: true, profile: { id: 11 } } : { hasActiveDoctorProfile: false, canAccessDoctorPortal: false, canAccessCoreWorkspace: true, profile: null } });
    if (path === "/api/v2/scheduling-override-requests") return route.fulfill({ json: { requests: [], total: 0 } });
    if (path === "/api/ir-referrals/42") return route.fulfill({ json: { referral } });
    if (path === "/api/ir-referrals/42/documents") return route.fulfill({ json: { documents: role === "receptionist" ? [{ id: 9, originalFilename: "supporting-report.pdf" }] : [] } });
    if (path === "/api/v2/lookups/modalities") return route.fulfill({ json: { items: [] } });
    if (path === "/api/ir-referrals/42/decision" && request.method() === "POST") return route.fulfill({ json: { referral } });
    return route.fulfill({ json: {} });
  });
}

test("assigned doctor sees and records a persisted IR assessment", async ({ page }) => {
  await mockIrShell(page, "doctor", reviewedReferral);
  await page.goto("/comparisons/ir/42");

  await expect(page.getByRole("heading", { name: "IR Assessment" })).toBeVisible();
  await expect(page.getByText("Suitable for CT-guided biopsy.")).toBeVisible();
  await expect(page.getByText("Eligible for intervention")).toBeVisible();
  await expect(page.getByText("Dr IR")).toBeVisible();
  await expect(page.getByRole("heading", { name: "Clinical IR decision" })).not.toBeVisible();

  await page.getByRole("button", { name: "Edit assessment" }).click();
  await expect(page.getByRole("textbox", { name: "Assessment" })).toHaveValue("Suitable for CT-guided biopsy.");
  await expect(page.getByRole("combobox", { name: "Decision" })).toHaveValue("eligible_for_intervention");
  await page.getByRole("button", { name: "Record decision" }).click();
  await expect(page.getByRole("button", { name: "Edit assessment" })).toBeVisible();
});

test("receptionist sees material preparation but no clinical or delete controls", async ({ page }) => {
  await mockIrShell(page, "receptionist", preparingReferral);
  await page.goto("/comparisons/ir/42");

  await expect(page.getByLabel("Choose document")).toBeVisible();
  await expect(page.getByRole("link", { name: "PACS Remap" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Confirm & Send for IR Review" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Clinical IR decision" })).not.toBeVisible();
  await expect(page.getByText("Request Appointment")).not.toBeVisible();
  await expect(page.getByRole("button", { name: "Remove document 9" })).not.toBeVisible();
});
