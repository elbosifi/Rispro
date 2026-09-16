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

async function mockIrShell(page: Page, role: BrowserRole, referral: typeof reviewedReferral | typeof preparingReferral, language: "en" | "ar" = "en", options: { coreComparisonsAccess?: boolean } = {}) {
  const coreComparisonsAccess = options.coreComparisonsAccess ?? true;
  await page.addInitScript((selectedLanguage) => localStorage.setItem("rispro-language", selectedLanguage), language);
  await page.route("http://127.0.0.1:5173/api/**", async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    if (path === "/api/auth/me") return route.fulfill({ json: { user: { id: 1, username: role, fullName: role === "doctor" ? "IR Doctor" : "Reception", role } } });
    if (path === "/api/settings/users-and-roles/page-visibility") return route.fulfill({ json: { matrix: { comparisons: coreComparisonsAccess ? ["receptionist", "modality_staff", "doctor", "supervisor", "super_admin"] : [] } } });
    if (path === "/api/doctor/me") return route.fulfill({ json: role === "doctor" ? { hasActiveDoctorProfile: true, canAccessClinicalDoctorPortal: true, canAccessDoctorPortal: true, canAccessCoreWorkspace: coreComparisonsAccess, doctorRole: "specialist", canFinalizeReports: false, canAssignProtocols: true, canSupervise: false, allowedModalities: [], moduleCapabilities: ["doctor"], profile: { id: 11 } } : { hasActiveDoctorProfile: false, canAccessDoctorPortal: false, canAccessCoreWorkspace: true, doctorRole: null, canFinalizeReports: false, canAssignProtocols: false, canSupervise: false, allowedModalities: [], moduleCapabilities: [], profile: null } });
    if (path === "/api/v2/scheduling-override-requests") return route.fulfill({ json: { requests: [], total: 0 } });
    if (path === "/api/doctor/reporting-board/notifications") return route.fulfill({ json: { notifications: [] } });
    if (path === "/api/ir-referrals/my-worklist") return route.fulfill({ json: { referrals: role === "doctor" ? [referral] : [] } });
    if (path === "/api/ir-referrals/42") return route.fulfill({ json: { referral } });
    if (path === "/api/ir-referrals/42/documents") return route.fulfill({ json: { documents: role === "receptionist" ? [{ id: 9, originalFilename: "supporting-report.pdf" }] : [] } });
    if (path === "/api/v2/lookups/modalities") return route.fulfill({ json: { items: [] } });
    if (path === "/api/ir-referrals/42/decision" && request.method() === "POST") return route.fulfill({ json: { referral } });
    return route.fulfill({ json: {} });
  });
}

const reviewComparison = {
  id: 71,
  patientId: 8,
  patientMrn: "MRN-COMP",
  patientEnglishName: "Comparison Patient",
  patientArabicName: null,
  linkedPreviousBookingId: 3056,
  linkedPreviousAccessionNumber: "ACC-3056",
  linkedModalityCode: "CT",
  linkedExamName: "CT Chest",
  reason: "Compare interval change",
  status: "active",
  materialsConfirmed: false,
  imageAvailabilityConfirmed: false,
  documentsAvailabilityConfirmed: false,
  selectedPriorConfirmed: false,
  documentsDisposition: null,
  assignedDoctorId: null,
  plannedReportingDoctorId: null,
  createdBy: 1,
  createdAt: "2026-09-14T08:00:00Z",
  updatedAt: "2026-09-14T08:00:00Z",
  documentCount: 0,
};

const reviewIrReferral = {
  ...preparingReferral,
  id: 43,
  patientId: 9,
  patientMrn: "MRN-IR",
  patientEnglishName: "IR Review Patient",
  requestedProcedure: "CT-guided biopsy",
  status: "needs_information",
  assignedDoctorName: "Dr IR",
  assignedDoctorNameEn: "Dr IR",
  decisionNote: "Please add the prior report",
  documentCount: 2,
  scheduleRequestId: 19,
};

async function mockReviewRequestsShell(page: Page, language: "en" | "ar" = "en") {
  const listRequests: string[] = [];
  await page.addInitScript((selectedLanguage) => localStorage.setItem("rispro-language", selectedLanguage), language);
  await page.route("http://127.0.0.1:5173/api/**", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    if (url.pathname === "/api/auth/me") return route.fulfill({ json: { user: { id: 1, username: "reception", fullName: "Reception", role: "receptionist" } } });
    if (url.pathname === "/api/settings/users-and-roles/page-visibility") return route.fulfill({ json: { matrix: { comparisons: ["receptionist", "modality_staff", "doctor", "supervisor", "super_admin"] } } });
    if (url.pathname === "/api/doctor/me") return route.fulfill({ json: { hasActiveDoctorProfile: false, canAccessDoctorPortal: false, canAccessCoreWorkspace: true, profile: null } });
    if (url.pathname === "/api/v2/scheduling-override-requests") return route.fulfill({ json: { requests: [], total: 0 } });
    if (url.pathname === "/api/comparisons") {
      listRequests.push(url.toString());
      return route.fulfill({ json: { comparisonRequests: [reviewComparison] } });
    }
    if (url.pathname === "/api/ir-referrals") {
      listRequests.push(url.toString());
      return route.fulfill({ json: { referrals: [reviewIrReferral] } });
    }
    return route.fulfill({ json: {} });
  });
  return listRequests;
}

test("assigned doctor sees and records a persisted IR assessment", async ({ page }, testInfo) => {
  await mockIrShell(page, "doctor", reviewedReferral);
  await page.goto("/comparisons/ir/42");

  await expect(page.getByRole("heading", { name: "IR Assessment" })).toBeVisible();
  await expect(page.getByText("Suitable for CT-guided biopsy.")).toBeVisible();
  await expect(page.getByText("Eligible for intervention")).toBeVisible();
  await expect(page.getByText("Dr IR")).toBeVisible();
  await expect(page.getByRole("heading", { name: "Clinical IR decision" })).not.toBeVisible();
  await page.screenshot({ path: testInfo.outputPath("ir-detail-ready-persisted-assessment.png"), fullPage: true });

  await page.getByRole("button", { name: "Edit assessment" }).click();
  await expect(page.getByRole("textbox", { name: "Assessment" })).toHaveValue("Suitable for CT-guided biopsy.");
  await expect(page.getByRole("combobox", { name: "Decision" })).toHaveValue("eligible_for_intervention");
  await page.getByRole("button", { name: "Record decision" }).click();
  await expect(page.getByRole("button", { name: "Edit assessment" })).toBeVisible();
});

test("assigned doctor opens IR consultation in Doctor Workspace without Core comparisons access", async ({ page }, testInfo) => {
  await mockIrShell(page, "doctor", reviewedReferral, "en", { coreComparisonsAccess: false });
  await page.goto("/doctor/ir-consultations");

  await page.getByRole("link", { name: "Open consultation" }).click();
  await expect(page).toHaveURL(/\/doctor\/ir-consultations\/42$/);
  await expect(page.getByRole("heading", { name: "IR Consultation" })).toBeVisible();
  await expect(page.getByText("IR Patient")).toBeVisible();
  await expect(page.getByText("Ready for review")).toBeVisible();
  await expect(page.getByRole("link", { name: /Open patient studies/ })).toBeVisible();
  await expect(page.getByRole("heading", { name: "IR Assessment" })).toBeVisible();
  await page.getByRole("button", { name: "Edit assessment" }).click();
  await expect(page.getByRole("heading", { name: "Clinical IR decision" })).toBeVisible();
  await expect(page.getByRole("textbox", { name: "Assessment" })).toHaveValue("Suitable for CT-guided biopsy.");
  await expect(page.getByRole("link", { name: "PACS Remap" })).not.toBeVisible();
  await expect(page.getByRole("heading", { name: "Final preparation confirmation" })).not.toBeVisible();
  await expect(page.getByRole("button", { name: "Confirm & Send for IR Review" })).not.toBeVisible();
  await expect(page).not.toHaveURL(/\/comparisons\/ir\/42$/);
  await page.screenshot({ path: testInfo.outputPath("doctor-ir-consultation-detail.png"), fullPage: true });
});

test("receptionist sees material preparation but no clinical or delete controls", async ({ page }, testInfo) => {
  await mockIrShell(page, "receptionist", preparingReferral);
  await page.goto("/comparisons/ir/42");

  await expect(page.getByLabel("Choose document")).toBeVisible();
  await expect(page.getByRole("link", { name: "PACS Remap" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Confirm & Send for IR Review" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Clinical IR decision" })).not.toBeVisible();
  await expect(page.getByText("Request Appointment")).not.toBeVisible();
  await expect(page.getByRole("button", { name: "Remove document 9" })).not.toBeVisible();
  await page.screenshot({ path: testInfo.outputPath("ir-detail-preparing.png"), fullPage: true });
});

test("Review Requests All searches both domains and renders both result types", async ({ page }, testInfo) => {
  const listRequests = await mockReviewRequestsShell(page);
  await page.goto("/comparisons");

  await expect(page.getByRole("heading", { name: "Review Requests" })).toBeVisible();
  await expect(page.getByText("Comparison Patient")).toBeVisible();
  await expect(page.getByText("IR Review Patient")).toBeVisible();
  await expect(page.getByRole("combobox", { name: "Comparison status" })).not.toBeVisible();
  await page.screenshot({ path: testInfo.outputPath("review-requests-all.png"), fullPage: true });

  await page.getByRole("textbox", { name: "Search" }).fill("MRN-IR");
  await page.getByRole("button", { name: "Search", exact: true }).click();
  await expect.poll(() => listRequests.some((requestUrl) => {
    const url = new URL(requestUrl);
    return url.pathname === "/api/comparisons" && url.searchParams.get("status") === "all" && url.searchParams.get("q") === "MRN-IR";
  })).toBe(true);
  await expect.poll(() => listRequests.some((requestUrl) => {
    const url = new URL(requestUrl);
    return url.pathname === "/api/ir-referrals" && url.searchParams.get("status") === "all" && url.searchParams.get("q") === "MRN-IR";
  })).toBe(true);

});

test("Review Requests IR tab uses its own status filter", async ({ page }, testInfo) => {
  const listRequests = await mockReviewRequestsShell(page);
  await page.goto("/comparisons");
  await page.getByRole("button", { name: "IR Consultations" }).click();

  await expect(page.getByRole("combobox", { name: "IR consultation status" })).toBeVisible();
  await expect(page.getByRole("combobox", { name: "Comparison status" })).not.toBeVisible();
  await page.getByRole("combobox", { name: "IR consultation status" }).selectOption("needs_information");
  await expect(page.locator("article").getByText("Needs additional information", { exact: true })).toBeVisible();
  await expect.poll(() => listRequests.some((requestUrl) => {
    const url = new URL(requestUrl);
    return url.pathname === "/api/ir-referrals" && url.searchParams.get("status") === "needs_information" && !url.searchParams.get("q");
  })).toBe(true);
  await page.screenshot({ path: testInfo.outputPath("review-requests-ir-filtered.png"), fullPage: true });
});

test("Review Requests remains mobile-safe", async ({ page }, testInfo) => {
  const listRequests = await mockReviewRequestsShell(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/comparisons");
  await page.getByRole("button", { name: "IR Consultations" }).click();
  await page.getByRole("combobox", { name: "IR consultation status" }).selectOption("needs_information");
  await expect(page.locator("article").getByText("Needs additional information", { exact: true })).toBeVisible();
  await expect.poll(() => listRequests.some((requestUrl) => {
    const url = new URL(requestUrl);
    return url.pathname === "/api/ir-referrals" && url.searchParams.get("status") === "needs_information";
  })).toBe(true);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);

  await page.screenshot({ path: testInfo.outputPath("review-requests-ir-mobile.png"), fullPage: true });
});

test("Arabic Review Requests keeps the operational layout in RTL", async ({ page }, testInfo) => {
  await mockReviewRequestsShell(page, "ar");
  await page.goto("/comparisons");

  await expect(page.getByRole("main").last()).toHaveAttribute("dir", "rtl");
  await expect(page.getByRole("heading", { name: "طلبات المراجعة" })).toBeVisible();
  await expect(page.getByRole("button", { name: "استشارات الأشعة التداخلية" })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.screenshot({ path: testInfo.outputPath("review-requests-arabic.png"), fullPage: true });
});

test("Arabic IR detail exposes localized status and RTL controls", async ({ page }, testInfo) => {
  await mockIrShell(page, "receptionist", preparingReferral, "ar");
  await page.goto("/comparisons/ir/42");

  await expect(page.getByRole("main").last()).toHaveAttribute("dir", "rtl");
  await expect(page.getByRole("heading", { level: 1, name: "استشارة الأشعة التداخلية" })).toBeVisible();
  await expect(page.getByText("قيد التجهيز", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "تأكيد وإرسال إلى مراجعة الأشعة التداخلية" })).toBeVisible();
  await expect(page.getByRole("link", { name: "إعادة ربط PACS" })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.screenshot({ path: testInfo.outputPath("ir-detail-arabic.png"), fullPage: true });
});
