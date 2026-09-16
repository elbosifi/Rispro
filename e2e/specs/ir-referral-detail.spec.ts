import { expect, test, type Page, type TestInfo } from "@playwright/test";

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
  await expect(page.getByRole("heading", { level: 1, name: "IR Consultation" })).toBeVisible();
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

const workflowPatient = {
  id: 7,
  mrn: "MRN-IR-E2E",
  national_id: "100000009901",
  identifier_type: "national_id",
  identifier_value: "100000009901",
  english_full_name: "IR Workflow Patient",
  arabic_full_name: "مريض مسار الأشعة التداخلية",
  sex: "F",
  age_years: 52,
  phone_1: "0910009901",
  category: "non_oncology",
};

const workflowDecision = {
  isAllowed: true,
  requiresSupervisorOverride: false,
  displayStatus: "available",
  suggestedBookingMode: "standard",
  consumedCapacityMode: null,
  remainingStandardCapacity: 4,
  remainingSpecialQuota: null,
  matchedRuleIds: [],
  reasons: [],
  policy: { policySetKey: "default", versionId: 1, versionNo: 1, configHash: "e2e-ir-workflow" },
  decisionTrace: { evaluatedAt: "2026-09-16T08:00:00Z", input: null },
};

async function captureWorkflowScreenshot(page: Page, testInfo: TestInfo, name: string) {
  await page.evaluate(() => {
    window.scrollTo(0, 0);
    document.scrollingElement?.scrollTo(0, 0);
    for (const element of document.querySelectorAll<HTMLElement>("*")) {
      const style = window.getComputedStyle(element);
      if ((style.overflowY === "auto" || style.overflowY === "scroll") && element.scrollHeight > element.clientHeight) element.scrollTop = 0;
      if ((style.overflowX === "auto" || style.overflowX === "scroll") && element.scrollWidth > element.clientWidth) element.scrollLeft = 0;
    }
  });
  await page.screenshot({ path: testInfo.outputPath(name), fullPage: true });
}

async function mockStatefulIrWorkflow(page: Page) {
  const state = {
    role: "receptionist" as BrowserRole,
    patient: workflowPatient,
    documents: [] as Array<{ id: number; originalFilename: string }>,
    referral: {
      ...preparingReferral,
      id: 42,
      patientId: workflowPatient.id,
      patientMrn: workflowPatient.mrn,
      patientDicomId: "DICOM-IR-E2E",
      patientEnglishName: "IR Workflow Patient",
      patientArabicName: "مريض مسار الأشعة التداخلية",
      requestedProcedure: "CT-guided liver biopsy",
      clinicalIndication: "Focal hepatic lesion requiring tissue diagnosis",
      assignedDoctorId: 11,
      assignedDoctorName: "IR Doctor",
      assignedDoctorNameAr: "طبيب الأشعة التداخلية",
      assignedDoctorNameEn: "IR Doctor",
      notifyAssignedDoctor: true,
      documentCount: 0,
      scheduleRequestId: null,
    } as Record<string, unknown>,
    scheduleRequest: null as null | Record<string, unknown>,
    appointmentId: null as number | null,
    requests: [] as string[],
  };

  await page.addInitScript(() => localStorage.setItem("rispro-language", "en"));
  await page.route("http://127.0.0.1:5173/api/**", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const path = url.pathname;
    state.requests.push(`${request.method()} ${path}${url.search}`);

    const respond = (json: unknown, status = 200) => route.fulfill({ status, contentType: "application/json", body: JSON.stringify(json) });
    const doctor = state.role === "doctor";
    const referral = { ...state.referral };

    if (path === "/api/auth/me") return respond({ user: { id: doctor ? 2 : 1, username: doctor ? "ir-doctor" : "reception", fullName: doctor ? "IR Doctor" : "Reception", role: state.role } });
    if (path === "/api/settings/users-and-roles/page-visibility") return respond({ matrix: { comparisons: doctor ? [] : ["receptionist", "modality_staff", "supervisor", "super_admin"], appointments: ["receptionist", "doctor", "supervisor", "super_admin"], "recall.requests": ["receptionist", "doctor", "supervisor", "super_admin"] } });
    if (path === "/api/doctor/me") return respond(doctor ? { hasActiveDoctorProfile: true, canAccessClinicalDoctorPortal: true, canAccessDoctorPortal: true, canAccessCoreWorkspace: false, doctorRole: "consultant", canFinalizeReports: false, canAssignProtocols: true, canSupervise: false, allowedModalities: [], moduleCapabilities: ["doctor"], profile: { id: 11 } } : { hasActiveDoctorProfile: false, canAccessDoctorPortal: false, canAccessCoreWorkspace: true, doctorRole: null, canFinalizeReports: false, canAssignProtocols: false, canSupervise: false, allowedModalities: [], moduleCapabilities: [], profile: null });
    if (path === "/api/v2/scheduling-override-requests") return respond({ requests: [], total: 0 });
    if (path === "/api/doctor/reporting-board/notifications") return respond({ notifications: [] });
    if (path === "/api/comparisons") return respond({ comparisonRequests: [] });
    if (path === "/api/patients") return respond({ patients: [state.patient] });
    if (path === "/api/ir-referrals/doctors") return respond({ doctors: [{ id: 11, displayName: "IR Doctor", fullName: null, englishName: "IR Doctor", username: "ir.doctor" }] });
    if (path === "/api/ir-referrals/my-worklist") return respond({ referrals: doctor ? [referral] : [] });
    if (path === "/api/ir-referrals" && request.method() === "GET") return respond({ referrals: [referral] });
    if (path === "/api/ir-referrals/42" && request.method() === "GET") return respond({ referral });
    if (path === "/api/ir-referrals/42/documents" && request.method() === "GET") return respond({ documents: state.documents });
    if (path === "/api/ir-referrals" && request.method() === "POST") {
      state.referral.status = "preparing";
      return respond({ referral: { ...state.referral } }, 201);
    }
    if (path === "/api/ir-referrals/42/documents" && request.method() === "POST") {
      const body = request.postDataJSON() as { originalFilename?: string };
      const document = { id: state.documents.length + 501, originalFilename: body.originalFilename ?? "Referral-request.pdf" };
      state.documents.push(document);
      state.referral.documentCount = state.documents.length;
      return respond({ document }, 201);
    }
    if (path === "/api/ir-referrals/42/confirm-materials" && request.method() === "POST") {
      state.referral.status = "ready_for_review";
      state.referral.documentsConfirmed = true;
      state.referral.imagesConfirmed = true;
      state.referral.materialsConfirmed = true;
      return respond({ referral: { ...state.referral } });
    }
    if (path === "/api/ir-referrals/42/decision" && request.method() === "POST") {
      const body = request.postDataJSON() as { assessmentText?: string | null; decision: string; decisionNote?: string | null };
      state.referral.assessmentText = body.assessmentText ?? null;
      state.referral.decision = body.decision;
      state.referral.decisionNote = body.decisionNote ?? null;
      state.referral.reviewedByDoctorId = 11;
      state.referral.reviewedByDoctorName = "IR Doctor";
      state.referral.reviewedByDoctorNameAr = "طبيب الأشعة التداخلية";
      state.referral.reviewedByDoctorNameEn = "IR Doctor";
      state.referral.reviewedAt = "2026-09-16T08:30:00Z";
      state.referral.status = body.decision === "needs_information" ? "needs_information" : "ready_for_review";
      return respond({ referral: { ...state.referral } });
    }
    if (path === "/api/ir-referrals/42/schedule-requests" && request.method() === "POST") {
      const body = request.postDataJSON() as Record<string, unknown>;
      state.referral.status = "appointment_requested";
      state.referral.scheduleRequestId = 88;
      state.scheduleRequest = {
        id: 88,
        irReferralCaseId: 42,
        patientId: 7,
        patientMrn: "MRN-IR-E2E",
        patientEnglishName: "IR Workflow Patient",
        patientArabicName: "مريض مسار الأشعة التداخلية",
        requestedProcedure: "CT-guided liver biopsy",
        assignedDoctorName: "IR Doctor",
        requestedModalityId: 21,
        requestedModalityNameAr: "Ø§Ù„ØªØµÙˆÙŠØ± Ø§Ù„Ù…Ù‚Ø·Ø¹ÙŠ",
        requestedModalityNameEn: "CT",
        requestedExamTypeId: 22,
        requestedExamTypeNameAr: "Ø®Ø²Ø¹Ø© Ù…ÙˆØ¬Ù‡Ø© Ø¨Ø§Ù„ØªØµÙˆÙŠØ± Ø§Ù„Ù…Ù‚Ø·Ø¹ÙŠ",
        requestedExamTypeNameEn: "CT-guided biopsy",
        preferredDate: body.preferredDate ?? "2026-09-22",
        urgency: body.urgency ?? "within_72_hours",
        receptionInstruction: body.receptionInstruction ?? null,
        technologistInstruction: body.technologistInstruction ?? "Prepare CT biopsy tray and standard biopsy setup.",
        status: "pending_scheduling",
        appointmentId: null,
        requestedAt: "2026-09-16T08:45:00Z",
        scheduledAt: null,
      };
      return respond({ request: state.scheduleRequest }, 201);
    }
    if (path === "/api/ir-referrals/schedule-requests" && request.method() === "GET") return respond({ requests: state.scheduleRequest?.status === "pending_scheduling" ? [state.scheduleRequest] : [] });
    if (path === "/api/ir-referrals/schedule-requests/88/booking-context" && request.method() === "GET") return respond({ request: state.scheduleRequest });
    if (path === "/api/v2/lookups/modalities") return respond({ items: [{ id: 21, name: "CT", nameAr: "التصوير المقطعي", nameEn: "CT", code: "CT", isActive: true, safetyWarningEnabled: false, safetyWarningEn: null, safetyWarningAr: null }] });
    if (path === "/api/v2/lookups/modalities/21/exam-types") return respond({ modalityId: 21, items: [{ id: 22, name: "CT-guided biopsy", nameAr: "خزعة موجهة بالتصوير المقطعي", nameEn: "CT-guided biopsy", code: "CT_BIOPSY", modalityId: 21, isActive: true }] });
    if (path === "/api/v2/lookups/priorities") return respond({ items: [{ id: 1, code: "routine", nameAr: "روتيني", nameEn: "Routine", isActive: true }] });
    if (path === "/api/v2/lookups/special-reason-codes") return respond({ items: [] });
    if (path === "/api/settings/patient_qr_self_service") return respond({ settings: [] });
    if (path === "/api/settings/queue_and_arrival") return respond({ settings: [] });
    if (path === "/api/settings/scheduling-and-capacity/public") return respond({ settings: [] });
    if (path === "/api/integrations/status") return respond({ status: {} });
    if (path === "/api/v2/read/appointments" && request.method() === "GET") {
      if (/\/api\/v2\/read\/appointments\/9001$/.test(path)) return respond({ appointment: { id: 9001, patient_id: 7, patient_english_name: "IR Workflow Patient", patient_mrn: "MRN-IR-E2E", phone_1: "0910009901", booking_date: "2026-09-22", status: "scheduled", modality_name_en: "CT", modality_name_ar: "التصوير المقطعي", exam_name_en: "CT-guided biopsy", exam_name_ar: "خزعة موجهة بالتصوير المقطعي" } });
      return respond({ appointments: [] });
    }
    if (path === "/api/v2/scheduling/availability") return respond({ items: [{ date: "2026-09-22", bucketMode: "total_only", modalityTotalCapacity: 5, bookedTotal: 1, oncology: { reserved: null, filled: 0, remaining: null }, nonOncology: { reserved: null, filled: 1, remaining: 4 }, specialQuotaSummary: null, dailyCapacity: 5, bookedCount: 1, remainingCapacity: 4, isFull: false, rowDisplayStatus: "available", decision: workflowDecision }] });
    if (path === "/api/v2/scheduling/evaluate") return respond(workflowDecision);
    if (path === "/api/v2/appointments" && request.method() === "POST") {
      const body = request.postDataJSON() as Record<string, unknown>;
      state.appointmentId = 9001;
      state.referral.status = "scheduled";
      if (state.scheduleRequest) state.scheduleRequest = { ...state.scheduleRequest, status: "scheduled", appointmentId: 9001, scheduledAt: "2026-09-16T09:00:00Z" };
      return respond({ booking: { id: 9001, patientId: 7, modalityId: body.modalityId, examTypeId: body.examTypeId, reportingPriorityId: body.reportingPriorityId ?? null, bookingDate: body.bookingDate, bookingTime: null, caseCategory: "non_oncology", status: "scheduled", notes: null, policyVersionId: 1, capacityResolutionMode: "standard", usesSpecialQuota: false, createdAt: "2026-09-16T09:00:00Z", updatedAt: "2026-09-16T09:00:00Z" }, decision: workflowDecision, wasOverride: false }, 201);
    }
    if (path === "/api/v2/read/appointments/9001" && request.method() === "GET") return respond({ appointment: { id: 9001, patient_id: 7, patient_english_name: "IR Workflow Patient", patient_mrn: "MRN-IR-E2E", phone_1: "0910009901", booking_date: "2026-09-22", status: "scheduled", modality_name_en: "CT", modality_name_ar: "التصوير المقطعي", exam_name_en: "CT-guided biopsy", exam_name_ar: "خزعة موجهة بالتصوير المقطعي" } });
    if (path === "/api/patients/7") return respond({ patient: state.patient });
    if (path === "/api/v2/appointments/patient-selection/7/risk") return respond({ patient: { id: 7, arabicFullName: "مريض مسار الأشعة التداخلية", englishFullName: "IR Workflow Patient", mrn: "MRN-IR-E2E", category: "non_oncology", sex: "F", estimatedDateOfBirth: null, demographicsEstimated: false, primaryIdentifierType: "mrn", primaryIdentifierTypeLabelAr: "رقم الملف", primaryIdentifierTypeLabelEn: "MRN", maskedPrimaryIdentifier: "MRN-IR-E2E", maskedPhone1: "0910009901", identityRisk: "low", similarPatientCount: 0, availableVerificationMethods: [], ambiguityRuleVersion: "name_prefix_configurable_primary_identifier_v3" } });
    if (path === "/api/v2/complementary-recall-requests") return respond({ recalls: [] });
    if (path === "/api/v2/complementary-recall-requests/reception-summary") return respond({ pendingCount: 0, unseenPendingCount: 0, dueTodayCount: 0, overdueCount: 0, followUpDueCount: 0 });
    return respond({});
  });

  return state;
}

test("complete stateful IR consultation workflow from Core to scheduled Appointment V2 booking", async ({ page }, testInfo) => {
  test.setTimeout(180_000);
  const state = await mockStatefulIrWorkflow(page);
  const setRole = async (role: BrowserRole) => {
    state.role = role;
    await page.goto(role === "doctor" ? "/doctor/ir-consultations" : "/comparisons");
  };

  await page.goto("/comparisons");
  await expect(page.getByRole("heading", { name: "Review Requests" })).toBeVisible();
  const reviewRequestTabs = page.getByRole("tablist", { name: "Review Requests" });
  await expect(reviewRequestTabs.getByRole("button", { name: "All", exact: true })).toBeVisible();
  await expect(reviewRequestTabs.getByRole("button", { name: "Comparisons", exact: true })).toBeVisible();
  await expect(reviewRequestTabs.getByRole("button", { name: "IR Consultations", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Search Patient", exact: true })).toBeVisible();
  await captureWorkflowScreenshot(page, testInfo, "01-review-requests.png");

  await page.getByRole("button", { name: "Search Patient", exact: true }).click();
  await page.getByRole("textbox", { name: "Search Patient" }).fill("MRN-IR-E2E");
  await expect(page.getByRole("button", { name: /IR Workflow Patient/ })).toBeVisible();
  await page.getByRole("button", { name: /IR Workflow Patient/ }).click();
  await expect(page.getByRole("dialog").getByText("MRN-IR-E2E", { exact: true }).last()).toBeVisible();
  await expect(page.getByRole("button", { name: "Create Comparison", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Create IR Consultation", exact: true })).toBeVisible();
  await captureWorkflowScreenshot(page, testInfo, "02-search-patient-selected.png");

  await page.getByRole("button", { name: "Create IR Consultation", exact: true }).click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await page.getByLabel("Requested procedure").fill("CT-guided liver biopsy");
  await page.getByLabel("Clinical indication").fill("Focal hepatic lesion requiring tissue diagnosis");
  await page.getByLabel("Assign IR doctor").selectOption("11");
  await expect(page.getByRole("checkbox")).toBeChecked();
  await captureWorkflowScreenshot(page, testInfo, "03-create-ir-consultation.png");
  await page.getByRole("button", { name: "Create IR Consultation", exact: true }).last().click();
  await expect(page).toHaveURL(/\/comparisons\/ir\/42$/);

  await expect(page.getByRole("heading", { level: 1, name: "IR Consultation" })).toBeVisible();
  await expect(page.getByText(/CT-guided liver biopsy/)).toBeVisible();
  await expect(page.getByText("Focal hepatic lesion requiring tissue diagnosis", { exact: true })).toBeVisible();
  await expect(page.getByText("IR Doctor", { exact: true })).toBeVisible();
  await expect(page.getByText("No documents attached", { exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Clinical IR decision" })).not.toBeVisible();
  await expect(page.getByText("Request Appointment", { exact: true })).not.toBeVisible();
  await captureWorkflowScreenshot(page, testInfo, "04-ir-preparing-empty.png");

  await page.locator('input[type="file"]').setInputFiles({ name: "Referral-request.pdf", mimeType: "application/pdf", buffer: Buffer.from("%PDF-1.4\\n% IR referral test fixture\\n") });
  await page.getByRole("button", { name: "Attach document", exact: true }).click();
  await expect(page.getByText("Referral-request.pdf", { exact: true })).toBeVisible();
  await expect(page.getByText("Documents: 1", { exact: true })).toBeVisible();
  await captureWorkflowScreenshot(page, testInfo, "05-ir-preparing-document-attached.png");

  await page.getByRole("checkbox").nth(0).check();
  await page.getByRole("checkbox").nth(1).check();
  await page.getByPlaceholder("Optional preparation note").fill("Referral paper and relevant CT available.");
  await captureWorkflowScreenshot(page, testInfo, "06-ir-preparation-confirmed.png");
  await page.getByRole("button", { name: "Confirm & Send for IR Review", exact: true }).click();
  await expect(page.getByText("Ready for review", { exact: true })).toBeVisible();

  await setRole("doctor");
  await expect(page.getByRole("heading", { name: "IR Consultations" })).toBeVisible();
  await expect(page.getByText("Ready for review", { exact: true })).toBeVisible();
  await expect(page.getByText(/MRN-IR-E2E/)).toBeVisible();
  await expect(page.getByText(/CT-guided liver biopsy/)).toBeVisible();
  await expect(page.getByText("Documents: confirmed", { exact: true })).toBeVisible();
  await expect(page.getByText("Imaging: confirmed", { exact: true })).toBeVisible();
  await captureWorkflowScreenshot(page, testInfo, "07-doctor-ir-worklist-ready.png");
  await page.getByRole("link", { name: "Open consultation", exact: true }).click();
  await expect(page).toHaveURL(/\/doctor\/ir-consultations\/42$/);
  await expect(page).not.toHaveURL(/\/comparisons\/ir\/42$/);
  await expect(page.getByRole("heading", { name: "Clinical IR decision" })).toBeVisible();
  await expect(page.getByRole("link", { name: "PACS Remap", exact: true })).not.toBeVisible();
  await expect(page.getByLabel("Choose document")).not.toBeVisible();
  await expect(page.getByRole("button", { name: "Confirm & Send for IR Review", exact: true })).not.toBeVisible();
  await expect(page.getByRole("button", { name: /Remove document/ })).not.toBeVisible();
  await captureWorkflowScreenshot(page, testInfo, "08-doctor-ir-review.png");

  await page.getByRole("textbox", { name: "Assessment" }).fill("Lesion appears technically accessible; prior pathology and previous CT are required before final decision.");
  await page.getByRole("combobox", { name: "Decision" }).selectOption("needs_information");
  await page.getByRole("textbox", { name: "Decision note" }).fill("Please attach the previous pathology report and prior CT report.");
  await captureWorkflowScreenshot(page, testInfo, "09-doctor-needs-information-form.png");
  await page.getByRole("button", { name: "Record decision", exact: true }).click();
  await expect(page.getByText("Needs additional information", { exact: true }).first()).toBeVisible();

  await setRole("receptionist");
  await page.goto("/comparisons/ir/42");
  await expect(page.getByText("Needs additional information", { exact: true }).first()).toBeVisible();
  await expect(page.getByText("Please attach the previous pathology report and prior CT report.", { exact: true }).first()).toBeVisible();
  await expect(page.getByText("Lesion appears technically accessible; prior pathology and previous CT are required before final decision.", { exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Clinical IR decision" })).not.toBeVisible();
  await expect.soft(page.getByText("Lesion appears technically accessible; prior pathology and previous CT are required before final decision.", { exact: true })).toHaveCount(1);
  await captureWorkflowScreenshot(page, testInfo, "10-core-needs-information.png");
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.getByText("Needs additional information", { exact: true }).first()).toBeVisible();
  await expect(page.getByLabel("Choose document")).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await captureWorkflowScreenshot(page, testInfo, "mobile-core-ir-preparation.png");
  await page.setViewportSize({ width: 1440, height: 960 });

  await page.locator('input[type="file"]').setInputFiles({ name: "Previous-pathology-report.pdf", mimeType: "application/pdf", buffer: Buffer.from("%PDF-1.4\\n% prior pathology test fixture\\n") });
  await page.getByRole("button", { name: "Attach document", exact: true }).click();
  await expect(page.getByText("Previous-pathology-report.pdf", { exact: true })).toBeVisible();
  await page.getByRole("checkbox").nth(0).check();
  await page.getByRole("checkbox").nth(1).check();
  await captureWorkflowScreenshot(page, testInfo, "11-core-additional-information-ready.png");
  await page.getByRole("button", { name: "Confirm & Send for IR Review", exact: true }).click();
  await expect(page.getByText("Ready for review", { exact: true })).toBeVisible();

  await setRole("doctor");
  await page.getByRole("link", { name: "Open consultation", exact: true }).click();
  await expect(page).toHaveURL(/\/doctor\/ir-consultations\/42$/);
  await expect(page.getByText("Lesion appears technically accessible; prior pathology and previous CT are required before final decision.", { exact: true })).toBeVisible();
  await expect(page.getByText("Needs additional information", { exact: true }).first()).toBeVisible();
  await expect(page.getByText("Please attach the previous pathology report and prior CT report.", { exact: true }).first()).toBeVisible();
  await page.getByRole("button", { name: "Review new information", exact: true }).click();
  await expect(page.getByRole("textbox", { name: "Assessment" })).toHaveValue("Lesion appears technically accessible; prior pathology and previous CT are required before final decision.");
  await expect(page.getByRole("combobox", { name: "Decision" })).toHaveValue("needs_information");
  await expect(page.getByRole("textbox", { name: "Decision note" })).toHaveValue("Please attach the previous pathology report and prior CT report.");
  await captureWorkflowScreenshot(page, testInfo, "12-doctor-review-new-information.png");

  await page.getByRole("textbox", { name: "Assessment" }).fill("Prior information reviewed. Lesion is suitable for CT-guided biopsy.");
  await page.getByRole("combobox", { name: "Decision" }).selectOption("eligible_for_intervention");
  await captureWorkflowScreenshot(page, testInfo, "13-doctor-eligible-decision.png");
  await page.getByRole("button", { name: "Record decision", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Request Appointment" })).toBeVisible();

  await page.getByRole("combobox", { name: "Modality", exact: true }).selectOption("21");
  await page.getByRole("combobox", { name: "Examination", exact: true }).selectOption("22");
  await page.getByRole("textbox", { name: "Preferred date", exact: true }).fill("2026-09-22");
  await page.getByRole("combobox", { name: "Urgency", exact: true }).selectOption("within_72_hours");
  await page.getByRole("textbox", { name: /Reception instructions/ }).fill("Contact patient and confirm fasting instructions.");
  await page.getByRole("textbox", { name: /Technologist instructions/ }).fill("Prepare CT biopsy tray and standard biopsy setup.");
  await captureWorkflowScreenshot(page, testInfo, "14-doctor-request-appointment.png");
  await page.getByRole("button", { name: "Request Appointment", exact: true }).click();
  await expect(page.getByText("Appointment requested", { exact: true })).toBeVisible();

  await setRole("receptionist");
  await page.goto("/recall-requests");
  const scheduleCard = page.locator("article").filter({ hasText: "IR Workflow Patient" });
  await expect(scheduleCard).toBeVisible();
  await expect(scheduleCard.getByText("Modality: CT", { exact: true })).toBeVisible();
  await expect(scheduleCard.getByText("Examination: CT-guided biopsy", { exact: true })).toBeVisible();
  await expect(scheduleCard.getByText("Within 72 hours", { exact: true })).toBeVisible();
  await expect(scheduleCard.getByText("Reception instruction: Contact patient and confirm fasting instructions.", { exact: true })).toBeVisible();
  await expect(scheduleCard.getByText("Technologist instruction: Prepare CT biopsy tray and standard biopsy setup.", { exact: true })).toBeVisible();
  await expect(scheduleCard.getByRole("button", { name: "Book Appointment", exact: true })).toBeVisible();
  await captureWorkflowScreenshot(page, testInfo, "15-reception-ir-scheduling-request.png");

  await scheduleCard.getByRole("button", { name: "Book Appointment", exact: true }).click();
  await expect(page).toHaveURL(/\/appointments\?irReferralScheduleRequestId=88$/);
  await expect(page.getByRole("main").getByText("IR referral", { exact: true })).toBeVisible();
  await expect(page.getByText("CT-guided liver biopsy", { exact: true })).toBeVisible();
  await expect(page.getByText("Doctor-authorized patient, modality, and examination are locked for this booking.", { exact: true })).toBeVisible();
  await expect(page.getByRole("combobox", { name: "Modality", exact: true })).toBeDisabled();
  await expect(page.getByRole("combobox", { name: "Exam Type", exact: true })).toBeDisabled();
  await expect(page.getByRole("combobox", { name: "Modality", exact: true })).toHaveValue("21");
  await expect(page.getByRole("combobox", { name: "Exam Type", exact: true })).toHaveValue("22");
  await expect.soft(page.getByText(/Prepare CT biopsy tray and standard biopsy setup\./)).toBeVisible();
  await expect(page.getByRole("button", { name: "Create Appointment", exact: true })).toBeVisible();
  await captureWorkflowScreenshot(page, testInfo, "16-ir-appointment-booking.png");

  await page.getByRole("button", { name: "Create Appointment", exact: true }).click();
  await expect.poll(() => state.appointmentId).toBe(9001);
  await page.goto("/comparisons/ir/42");
  await expect(page.getByText("Scheduled", { exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Request Appointment" })).not.toBeVisible();
  await expect(page.getByRole("button", { name: "Confirm & Send for IR Review", exact: true })).not.toBeVisible();
  await expect(page.getByLabel("Choose document")).not.toBeVisible();
  await captureWorkflowScreenshot(page, testInfo, "17-ir-scheduled-final.png");

  await setRole("doctor");
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/doctor/ir-consultations/42");
  await expect(page.locator("h1", { hasText: "IR Consultation" })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await captureWorkflowScreenshot(page, testInfo, "mobile-doctor-ir-detail.png");

  await setRole("receptionist");
  await page.goto("/comparisons/ir/42");
  await page.setViewportSize({ width: 1440, height: 960 });
  await page.addInitScript(() => localStorage.setItem("rispro-language", "ar"));
  await page.reload();
  await expect(page.getByRole("main").last()).toHaveAttribute("dir", "rtl");
  await expect(page.locator("h1", { hasText: "استشارة الأشعة التداخلية" })).toBeVisible();
  await captureWorkflowScreenshot(page, testInfo, "arabic-ir-detail.png");
  await page.goto("/comparisons");
  await expect(page.getByRole("main").last()).toHaveAttribute("dir", "rtl");
  await expect(page.getByRole("heading", { name: "طلبات المراجعة" })).toBeVisible();
  await captureWorkflowScreenshot(page, testInfo, "arabic-ir-list.png");
});
