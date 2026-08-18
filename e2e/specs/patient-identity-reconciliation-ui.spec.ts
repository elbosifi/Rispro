import { expect, test, type Page } from "@playwright/test";

const appointment = {
  appointmentId: 42, accessionNumber: "V2-000042", patientId: 9, patientMrn: "MRN-9", patientNationalId: "LEGACY-9",
  patientArabicName: "Synthetic Patient", patientEnglishName: "Current Patient", patientDicomId: "NEW-9", studyInstanceUid: null,
  ageYears: 35, sex: "M", appointmentDate: "2026-08-18", appointmentTime: "09:00:00", requiresReport: true,
  modalityId: 4, modalityCode: "CT", modalityName: "CT", modalitySafetyWorkflowType: "standard_acknowledgement",
  mriPrimaryScreeningResult: null, examTypeId: 10, examTypeName: "CT Chest", caseCategory: "non_oncology",
  clinicalNotes: "Synthetic browser fixture.", appointmentStatus: "scheduled", protocolStatus: "NOT_PROTOCOLLED", assignment: null,
};

async function mockShell(page: Page, role: "doctor" | "super_admin") {
  await page.addInitScript(() => localStorage.setItem("rispro-language", "en"));
  await page.route("http://127.0.0.1:5173/api/**", async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    if (path === "/api/auth/me") return route.fulfill({ json: { user: { id: 1, username: role, fullName: role === "doctor" ? "Synthetic Doctor" : "Super Admin", role } } });
    if (path === "/api/settings/users-and-roles/page-visibility") return route.fulfill({ json: { matrix: { settings: ["super_admin"], "doctor.protocols": ["doctor", "super_admin"] } } });
    if (path === "/api/doctor/me") return route.fulfill({ json: role === "doctor" ? { hasActiveDoctorProfile: true, canAccessClinicalDoctorPortal: true, canAccessDoctorPortal: true, canAccessDoctorAdmin: false, canAccessCoreWorkspace: true, doctorRole: "specialist", canFinalizeReports: false, canAssignProtocols: true, canSupervise: true, allowedModalities: [], moduleCapabilities: [], profile: null } : { hasActiveDoctorProfile: false, canAccessDoctorPortal: false, canAccessDoctorAdmin: false, canAccessCoreWorkspace: true, profile: null } });
    if (path === "/api/v2/scheduling-override-requests") return route.fulfill({ json: { requests: [], total: 0 } });
    if (path === "/api/integrations/authoritative-orthanc/settings") return route.fulfill({ json: { settings: { enabled: true, autoExportClinicalDocuments: true, autoRouteEnabled: false, autoRouteDestinationKey: "", autoRouteDestinationKeys: [], baseUrl: "http://orthanc:8042", username: "rispro", timeoutSeconds: 10, verifyTls: true, displayName: "Authoritative", passwordConfigured: true } } });
    if (path === "/api/pacs/orthanc-modalities") return route.fulfill({ json: { modalities: [] } });
    if (path === "/api/integrations/authoritative-orthanc/operations/patient-identity-reconciliations") return route.fulfill({ json: { jobs: [{ id: 1, requested_at: "2026-08-18T10:00:00Z", study_date: "20240102", accession_number: "OLD-ACC", study_instance_uid: "1.2.3.4", old_patient_id: "OLD-9", new_patient_id: "NEW-9", operator_name: "Synthetic Doctor", operation_type: "reconcile", status: "completed", failure_code: null, reversed_by_job_id: null }], total: 1 } });
    if (path === "/api/doctor/protocoling/appointments") return route.fulfill({ json: { appointments: [appointment] } });
    if (path === "/api/doctor/protocoling/appointments/42") return route.fulfill({ json: { detail: { appointment, assignmentDetail: null } } });
    if (path === "/api/documents/protocol-eligibility-policy") return route.fulfill({ json: { requireRequestDocumentForProtocolQueue: false, protocolQueueAppliesToAppointment: null, hasQualifyingRequestDocument: null } });
    if (path === "/api/doctor/protocol-library/protocols") return route.fulfill({ json: { protocols: [] } });
    if (path === "/api/doctor/protocol-library/scanners") return route.fulfill({ json: { scanners: [] } });
    if (path === "/api/doctor/protocoling/appointments/42/history") return route.fulfill({ json: { pacsStatus: "available", historicalPacsIndexStatus: "ready", historicalPacsLastSuccessAt: null, canReconcilePatientIdentity: true, currentPatient: { id: 9, patientId: "NEW-9", name: "Current Patient", birthDate: "1990-01-02" }, items: [{ appointmentId: 7, orthancStudyId: null, studyInstanceUid: null, accessionNumber: "RIS-ONLY", date: "2024-01-02", time: null, modalities: ["CT"], description: "RISpro-only prior appointment", appointmentStatus: "completed", reportAvailable: false, source: "rispro_only", identityDiscrepancy: null }] } });
    if (path === "/api/doctor/protocoling/appointments/42/history/historical-candidates") return route.fulfill({ json: { historicalCandidates: [{ historicalPatientId: "OLD-9", patientName: "Candidate summary", patientBirthDate: "19700101", patientSex: "M", classification: "possible", reasons: ["fuzzy_english_name"], authoritative: false, matchRank: 7, nameSimilarity: 0.75, phoneticMatchCount: 2, studyCount: 2, studies: [{ orthancStudyId: "resource-one", studyInstanceUid: "1.2.3.4.1", accessionNumber: "OLD-ACC", patientId: "OLD-9", patientName: "Old^Patient^One", patientBirthDate: "19800102", patientSex: "M", studyDate: "20240102", studyDescription: "Historical CT", modalitiesInStudy: ["CT"], seriesCount: 2, instanceCount: 20, reconciliation: null }, { orthancStudyId: "resource-two", studyInstanceUid: "1.2.3.4.2", accessionNumber: "OLD-ACC", patientId: "OLD-9", patientName: "Old^Patient^Two", patientBirthDate: "19800102", patientSex: "M", studyDate: "20240102", studyDescription: "Historical CT", modalitiesInStudy: ["CT"], seriesCount: 3, instanceCount: 30, reconciliation: null }] }], historicalPacsIndexStatus: "ready", historicalPacsLastSuccessAt: null } });
    if (path.startsWith("/api/patients/9")) return route.fulfill({ json: { patient: { id: 9, englishFullName: "Current Patient" } } });
    return route.fulfill({ json: {} });
  });
}

test("renders the doctor reconciliation confirmation at desktop width", async ({ page }, testInfo) => {
  await mockShell(page, "doctor");
  await page.goto("/doctor/protocols");
  await page.getByRole("button", { name: "Assign" }).click();
  await page.getByRole("button", { name: "Patient history" }).click();
  const historicalCandidates = page.getByRole("region", { name: "Possible older PACS studies" });
  await expect(historicalCandidates.getByText("Study UID: 1.2.3.4.1")).toBeVisible();
  await expect(historicalCandidates.getByText("Study UID: 1.2.3.4.2")).toBeVisible();
  const selectedStudy = historicalCandidates.getByText("Study UID: 1.2.3.4.1").locator("xpath=ancestor::div[1]");
  await selectedStudy.getByRole("button", { name: "Reconcile patient identity" }).click();
  const dialog = page.getByRole("heading", { name: "Patient Identity Reconciliation" }).locator("xpath=ancestor::*[@role='dialog'][1]");
  await expect(dialog.getByText("Patient ID: OLD-9")).toBeVisible();
  await expect(dialog.getByText("Patient name: Old^Patient^One")).toBeVisible();
  await expect(dialog.getByText("Patient name: Current Patient")).toBeVisible();
  const submit = dialog.getByRole("button", { name: "Reconcile patient identity" });
  await expect(submit).toBeDisabled();
  await dialog.getByRole("checkbox").check();
  await expect(submit).toBeEnabled();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBeTruthy();
  await page.screenshot({ path: testInfo.outputPath("doctor-reconciliation-desktop.png"), fullPage: true });
});

test("renders bounded reconciliation history and reversal confirmation on mobile", async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await mockShell(page, "super_admin");
  await page.goto("/settings?section=authoritative_orthanc");
  await page.getByRole("button", { name: "Patient Identity Reconciliation" }).click();
  await expect(page.getByText("OLD-ACC")).toBeVisible();
  await page.getByRole("button", { name: "Reverse" }).click();
  await expect(page.getByRole("dialog").getByText(/changing current Patient ID NEW-9 back to OLD-9/)).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBeTruthy();
  await page.screenshot({ path: testInfo.outputPath("admin-reconciliation-mobile.png"), fullPage: true });
});
