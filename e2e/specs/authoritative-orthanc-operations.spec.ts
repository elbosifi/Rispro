import { expect, test, type Page } from "@playwright/test";

const summary = {
  overallState: "healthy",
  connectionState: "connected",
  healthSentence: "Routing healthy — 2/2 selected destinations are configured and no relevant failed DICOM Store jobs were found.",
  reasons: [],
  system: { name: "ORTHANCPG", version: "1.12.4", apiVersion: "19", uptimeSeconds: null },
  statistics: { data: { studies: 12482, series: 48911, instances: 288417, diskSizeBytes: 734003200000, diskSizeMb: 700000, uncompressedSizeBytes: 0, uncompressedSizeMb: 0 }, error: null },
  routing: { autoRouteEnabled: true, selected: 2, configured: 2, missing: 0, invalid: 0, error: null, routes: [
    { destinationKey: "SonicDICOM", destinationName: "SonicDICOM", alias: "rispro_route_sonicdicom", aet: "SONIC", host: "10.0.0.10", port: 104, selectedForAutoRouting: true, autoRouteActive: true, managedAliasExists: true, configurationState: "configured", configurationError: null, dicomTest: { state: "reachable", connected: true, testedAt: "2026-08-12T10:00:00.000Z", code: null, message: "DICOM C-ECHO succeeded." } },
    { destinationKey: "Backup PACS", destinationName: "Backup PACS", alias: "rispro_route_backup_pacs", aet: "BACKUP", host: "10.0.0.11", port: 11112, selectedForAutoRouting: true, autoRouteActive: true, managedAliasExists: true, configurationState: "configured", configurationError: null, dicomTest: { state: "not_tested", connected: null, testedAt: null, code: null, message: null } },
  ] },
  jobs: { error: null, summary: { total: 3, running: 1, pending: 1, failed: 1, successful: 0, paused: 0, recentRelevantFailed: 0, recentFailureWindowHours: 24 }, items: [
    { id: "failed-job", type: "DicomModalityStore", state: "Failure", progress: 60, creationTime: "20260811T090000", startTime: null, completionTime: "20260811T090100", updatedAt: null, description: "REST API", error: "Connection failed.", retryPermitted: true, transfer: { remoteAet: "SONIC", localAet: "RISPRO", destinationName: "SonicDICOM", instanceCount: 220, failedInstanceCount: 2, parentResourceIds: ["series-1"], contextStatus: "resolved", study: { orthancStudyId: "study-1", patientId: "P-1042", patientName: "Sample Patient", accessionNumber: "ACC-1042", studyDate: "20260812", studyDescription: "CT chest", modalitiesInStudy: ["CT"] } } },
    { id: "running-job", type: "DicomModalityStore", state: "Running", progress: 42, creationTime: "20260812T091000", startTime: null, completionTime: null, updatedAt: "20260812T091100", description: "REST API", error: null, retryPermitted: false, transfer: { remoteAet: "SONIC", localAet: "RISPRO", destinationName: "SonicDICOM", instanceCount: 220, failedInstanceCount: null, parentResourceIds: ["series-1"], contextStatus: "resolved", study: { orthancStudyId: "study-1", patientId: "P-1042", patientName: "Sample Patient", accessionNumber: "ACC-1042", studyDate: "20260812", studyDescription: "CT chest", modalitiesInStudy: ["CT"] } } },
    { id: "pending-job", type: "Archive", state: "Pending", progress: 0, creationTime: "20260812T092000", startTime: null, completionTime: null, updatedAt: null, description: "Archive", error: null, retryPermitted: false, transfer: null },
  ] },
  clinicalDocuments: { error: null, data: { pending: 2, processing: 1, retryable: 1, failed: 1, completed: 218, oldestPendingOrRetryableAt: "2026-08-12T08:00:00.000Z", latestFailures: [{ id: 88, appointmentId: 42, status: "failed", lastAttemptAt: "2026-08-12T09:00:00.000Z", updatedAt: "2026-08-12T09:00:00.000Z", error: "Upload failed after a bounded timeout.", retryPermitted: true }] } },
  generatedAt: "2026-08-12T10:00:00.000Z",
};

const historicalPacsStatus = {
  indexStatus: "ready",
  runStatus: "idle",
  mode: null,
  indexedStudies: 42,
  historicalPatientIds: 20,
  orthancStudies: 42,
  processed: null,
  total: null,
  progressPercent: null,
  startedAt: null,
  progressAt: null,
  isStalled: false,
  stalledForSeconds: null,
  lastSuccessAt: "2026-08-20T00:00:00.000Z",
  lastFullSyncAt: "2026-08-20T00:00:00.000Z",
  lastAttemptAt: "2026-08-20T00:00:00.000Z",
  lastChangeSequence: 123,
  lastError: null,
};

async function mockOperations(page: Page) {
  await page.addInitScript(() => localStorage.setItem("rispro-language", "en"));
  await page.route("http://127.0.0.1:5173/api/**", async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path === "/api/auth/me") return route.fulfill({ json: { user: { id: 1, username: "super_admin", fullName: "Super Admin", role: "super_admin" } } });
    if (path === "/api/settings/users-and-roles/page-visibility") return route.fulfill({ json: { matrix: { "authoritative.orthanc": ["modality_staff", "supervisor", "super_admin"], pacs: ["super_admin"], "worklist.monitor": ["super_admin"], settings: ["super_admin"] } } });
    if (path === "/api/doctor/me") return route.fulfill({ json: { hasActiveDoctorProfile: false, canAccessDoctorPortal: false, canAccessDoctorAdmin: false, canAccessCoreWorkspace: true, profile: null } });
    if (path === "/api/v2/scheduling-override-requests") return route.fulfill({ json: { requests: [], total: 0 } });
    if (path === "/api/integrations/authoritative-orthanc/operations/summary") return route.fulfill({ json: summary });
    if (path === "/api/integrations/authoritative-orthanc/operations/historical-pacs-index/status") return route.fulfill({ json: historicalPacsStatus });
    if (path === "/api/integrations/authoritative-orthanc/operations/studies/search") return route.fulfill({ json: { status: "matched", matchKey: "accession_number", study: { orthancStudyId: "study-1", studyInstanceUid: "1.2.840.113619.2.55.3", accessionNumber: "ACC-1042", patientId: "P-1042", patientName: "Sample Patient", patientBirthDate: "19870214", patientSex: "F", studyDate: "20260812", studyDescription: "CT chest", modalitiesInStudy: ["CT"], seriesCount: 4, instanceCount: 220 } } });
    return route.fulfill({ json: {} });
  });
}

test("renders the Authoritative Orthanc operational workspace at desktop width", async ({ page }, testInfo) => {
  await mockOperations(page);
  await page.goto("/systems/authoritative-orthanc");
  await expect(page.getByRole("heading", { name: "Authoritative Orthanc", level: 1 })).toBeVisible();
  await expect(page.getByText("Healthy", { exact: true })).toBeVisible();
  await expect(page.getByText("rispro_route_sonicdicom")).toBeVisible();
  await expect(page.getByText("Not tested")).toBeVisible();
  await expect(page.getByText("Reachable")).toBeVisible();
  for (const text of ["Sample Patient", "P-1042", "ACC-1042", "CT chest", "CT", "SonicDICOM", "220 instances"]) await expect(page.getByText(text, { exact: false }).first()).toBeVisible();
  await page.getByRole("button", { name: "Synchronize routes" }).click();
  await expect(page.getByRole("dialog").getByText("Synchronize managed routes?")).toBeVisible();
  await page.getByRole("dialog").getByRole("button", { name: "Cancel" }).click();
  await page.getByRole("button", { name: "Retry", exact: true }).first().click();
  await expect(page.getByRole("dialog").getByText("Retry failed Orthanc job?")).toBeVisible();
  await page.getByRole("dialog").getByRole("button", { name: "Confirm" }).click();
  await expect(page.getByText("Action completed.")).toBeVisible();
  const navLabels = ["PACS configuration", "Authoritative Orthanc", "MWL monitor"];
  const navPositions = await Promise.all(navLabels.map(async (name) => (await page.getByRole("button", { name, exact: true }).boundingBox())?.y ?? -1));
  expect(navPositions[0]).toBeLessThan(navPositions[1]);
  expect(navPositions[1]).toBeLessThan(navPositions[2]);
  await page.getByLabel("Study lookup value").fill("ACC-1042");
  await page.getByRole("button", { name: /Search/ }).click();
  await expect(page.getByText("Sample Patient")).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBeTruthy();
  await page.screenshot({ path: testInfo.outputPath("authoritative-orthanc-desktop.png"), fullPage: true });
});

test("remains usable on a narrow viewport", async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await mockOperations(page);
  await page.goto("/systems/authoritative-orthanc");
  await expect(page.getByText("Routing destinations")).toBeVisible();
  await expect(page.getByText("Clinical-document export health")).toBeVisible();
  await page.getByRole("button", { name: "Toggle navigation" }).click();
  await expect(page.getByRole("dialog").getByRole("button", { name: "Authoritative Orthanc" })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBeTruthy();
  await page.screenshot({ path: testInfo.outputPath("authoritative-orthanc-mobile.png"), fullPage: true });
});
