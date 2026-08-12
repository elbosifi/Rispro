import test, { afterEach } from "node:test";
import assert from "node:assert/strict";
import type { AuthoritativeOrthancSettings } from "./authoritative-orthanc-service.js";
import type { AuthoritativeOrthancOperationsDependencies } from "./authoritative-orthanc-operations-service.js";
process.env.DATABASE_URL ||= "postgres://user:password@localhost:5432/rispro_test";
process.env.JWT_SECRET ||= "test-secret";
const [{ HttpError }, operations] = await Promise.all([import("../utils/http-error.js"), import("./authoritative-orthanc-operations-service.js")]);
const { __resetAuthoritativeOrthancOperationsForTests, getAuthoritativeOrthancOperationsSummary, normalizeOrthancJob, retryAuthoritativeOrthancOperationalJob, searchAuthoritativeOrthancOperationalStudy, synchronizeAuthoritativeOrthancOperationalRoutes, testAllAuthoritativeOrthancOperationalRoutes, testAuthoritativeOrthancOperationalRoute } = operations;

const settings: AuthoritativeOrthancSettings = { enabled: true, autoExportClinicalDocuments: true, autoRouteEnabled: true, autoRouteDestinationKey: "SonicDICOM", autoRouteDestinationKeys: ["SonicDICOM", "Backup PACS"], baseUrl: "http://orthanc.test:8042", username: "", password: "", timeoutSeconds: 5, verifyTls: true, displayName: "ORTHANCPG" };
const clinical = { pending: 2, processing: 1, retryable: 1, failed: 1, completed: 10, oldestPendingOrRetryableAt: "2026-08-12T08:00:00.000Z", latestFailures: [] };

function dependencies(overrides: Partial<AuthoritativeOrthancOperationsDependencies> = {}): AuthoritativeOrthancOperationsDependencies {
  const client = {
    getSystem: async () => ({ name: "ORTHANCPG", version: "1.12.4", apiVersion: "19" }),
    getStatistics: async () => ({ studies: 12, series: 34, instances: 56, diskSizeBytes: 1024, diskSizeMb: 1, uncompressedSizeBytes: 2048, uncompressedSizeMb: 2 }),
    listRemoteModalityKeys: async () => ["rispro_route_sonicdicom", "rispro_route_backup_pacs", "unrelated"],
    listJobs: async () => ({
      failed: { ID: "failed", Type: "DicomModalityStore", State: "Failure", Progress: 72, CreationTime: "20260812T090000", CompletionTime: "20260812T090100", ErrorDescription: "Connection failed", Content: { Description: "DICOM store to managed route" } },
      running: { ID: "running", Type: "Archive", State: "Running", Progress: 42, CreationTime: "20260812T091000" },
      success: { ID: "success", Type: "DicomModalityStore", State: "Success", Progress: 100, CreationTime: "20260811T091000" },
    }),
    getJob: async (jobId: string) => ({ ID: jobId, Type: "DicomModalityStore", State: "Failure", ErrorDescription: "Authorization: Basic secret" }),
    resubmitJob: async () => undefined,
    echoRemoteModality: async () => undefined,
    findStudy: async () => ({ status: "matched" as const, matchKey: "accession_number" as const, study: { orthancStudyId: "study-1", studyInstanceUid: "1.2.3", accessionNumber: "ACC-1", patientId: "P-1", patientName: "Patient", patientBirthDate: "19900101", patientSex: "F", studyDate: "20260812", studyDescription: "CT", modalitiesInStudy: ["CT"], seriesCount: 2, instanceCount: 50 } }),
  };
  return {
    readSettings: async () => settings,
    loadPacsDestinations: async () => ({ modalities: [
      { key: "SonicDICOM", aet: "SONIC", host: "10.0.0.10", port: 104 },
      { key: "Backup PACS", aet: "BACKUP", host: "10.0.0.11", port: 11112 },
    ] }),
    createClient: () => client as never,
    loadClinicalDocumentSummary: async () => clinical,
    synchronizeRoutes: async () => ({ created: 1, updated: 1, unchanged: 0, removed: 1, warnings: [] }),
    audit: async () => undefined,
    now: () => new Date("2026-08-12T10:00:00.000Z"),
    ...overrides,
  };
}

afterEach(__resetAuthoritativeOrthancOperationsForTests);

test("returns a degraded connected summary when a recent DICOM Store job failed", async () => {
  const summary = await getAuthoritativeOrthancOperationsSummary(dependencies());
  assert.equal(summary.overallState, "degraded");
  assert.equal(summary.connectionState, "degraded");
  assert.equal(summary.statistics.data?.studies, 12);
  assert.equal(summary.routing.configured, 2);
  assert.equal(summary.jobs.summary.recentRelevantFailed, 1);
  assert.match(summary.healthSentence, /DICOM Store/i);
});

test("returns healthy when routes exist and there are no recent relevant failures", async () => {
  const deps = dependencies({ createClient: () => ({
    ...dependencies().createClient(settings) as object,
    listJobs: async () => [{ ID: "success", Type: "DicomModalityStore", State: "Success", Progress: 100, CreationTime: "20260812T091000" }],
  } as never) });
  const summary = await getAuthoritativeOrthancOperationsSummary(deps);
  assert.equal(summary.overallState, "healthy");
  assert.match(summary.healthSentence, /2\/2 selected destinations/i);
});

test("keeps the base health available when optional statistics are unavailable", async () => {
  const base = dependencies();
  const client = base.createClient(settings) as unknown as Record<string, unknown>;
  const summary = await getAuthoritativeOrthancOperationsSummary(dependencies({ createClient: () => ({ ...client, getStatistics: async () => { throw new HttpError(502, "Optional endpoint unavailable."); } } as never) }));
  assert.equal(summary.overallState, "degraded");
  assert.equal(summary.system?.name, "ORTHANCPG");
  assert.equal(summary.statistics.data, null);
  assert.equal(summary.statistics.error?.message, "Optional endpoint unavailable.");
});

test("distinguishes disabled, unavailable, authentication, and timeout states", async () => {
  const disabled = await getAuthoritativeOrthancOperationsSummary(dependencies({ readSettings: async () => ({ ...settings, enabled: false }) }));
  assert.equal(disabled.overallState, "disabled");
  for (const [code, expected] of [["orthanc_unavailable", "ORTHANC_UNAVAILABLE"], ["orthanc_auth_failed", "ORTHANC_AUTHENTICATION_FAILED"], ["orthanc_timeout", "ORTHANC_TIMEOUT"]] as const) {
    const summary = await getAuthoritativeOrthancOperationsSummary(dependencies({ createClient: () => ({ ...dependencies().createClient(settings) as object, getSystem: async () => { throw new HttpError(502, `failure password=secret`, { code }); } } as never) }));
    assert.equal(summary.overallState, "offline");
    assert.equal(summary.reasons[0]?.code, expected);
    assert.doesNotMatch(summary.healthSentence, /secret/);
  }
});

test("normalizes supported job states and rejects malformed jobs without exposing secrets", () => {
  for (const state of ["Pending", "Running", "Success", "Failure", "Paused", "Retry"] as const) assert.equal(normalizeOrthancJob({ ID: state, Type: "DicomModalityStore", State: state }).state, state);
  const failed = normalizeOrthancJob({ ID: "job-1", Type: "DicomModalityStore", State: "Failure", ErrorDescription: "Authorization: Bearer secret" });
  assert.equal(failed.retryPermitted, true);
  assert.doesNotMatch(failed.error || "", /secret/);
  assert.throws(() => normalizeOrthancJob({ ID: "bad", Type: "Archive" }), /malformed job/i);
});

test("rejects ineligible jobs and resubmits eligible failed jobs with audit", async () => {
  const audits: unknown[] = [];
  const base = dependencies();
  const client = base.createClient(settings) as unknown as Record<string, unknown>;
  let resubmitted = "";
  const eligible = dependencies({ createClient: () => ({ ...client, resubmitJob: async (id: string) => { resubmitted = id; } } as never), audit: async (entry) => { audits.push(entry); } });
  assert.equal((await retryAuthoritativeOrthancOperationalJob("job-1", 9, eligible)).state, "Pending");
  assert.equal(resubmitted, "job-1");
  assert.equal(audits.length, 1);
  const ineligible = dependencies({ createClient: () => ({ ...client, getJob: async () => ({ ID: "job-2", Type: "Archive", State: "Running" }) } as never) });
  await assert.rejects(() => retryAuthoritativeOrthancOperationalJob("job-2", 9, ineligible), /only failed/i);
});

test("detects missing managed routes and keeps Not Tested distinct from failed", async () => {
  const base = dependencies();
  const client = base.createClient(settings) as unknown as Record<string, unknown>;
  const summary = await getAuthoritativeOrthancOperationsSummary(dependencies({ createClient: () => ({ ...client, listRemoteModalityKeys: async () => ["rispro_route_sonicdicom", "unrelated"], listJobs: async () => [] } as never) }));
  assert.equal(summary.routing.missing, 1);
  assert.equal(summary.routing.routes[0]?.dicomTest.state, "not_tested");
  assert.equal(summary.routing.routes[1]?.configurationState, "missing_managed_route");
});

test("C-ECHO supports success, failure, and Test All partial results without aborting siblings", async () => {
  const base = dependencies();
  const client = base.createClient(settings) as unknown as Record<string, unknown>;
  const echoes: string[] = [];
  const deps = dependencies({ createClient: () => ({ ...client, echoRemoteModality: async (alias: string) => { echoes.push(alias); if (alias.includes("backup")) throw new HttpError(502, "timed out password=secret", { code: "orthanc_timeout" }); } } as never) });
  const one = await testAuthoritativeOrthancOperationalRoute("rispro_route_sonicdicom", 7, deps);
  assert.equal(one.route.dicomTest.state, "reachable");
  const all = await testAllAuthoritativeOrthancOperationalRoutes(7, deps);
  assert.deepEqual({ total: all.total, reachable: all.reachable, failed: all.failed }, { total: 2, reachable: 1, failed: 1 });
  assert.equal(all.results[1]?.dicomTest.state, "timeout");
  assert.doesNotMatch(all.results[1]?.dicomTest.message || "", /secret/);
  assert.equal(echoes.length, 3);
});

test("Test All bounds concurrent C-ECHO calls", async () => {
  const keys = ["One", "Two", "Three", "Four", "Five"];
  const base = dependencies();
  const client = base.createClient(settings) as unknown as Record<string, unknown>;
  let active = 0;
  let maximumActive = 0;
  const deps = dependencies({
    readSettings: async () => ({ ...settings, autoRouteDestinationKey: keys[0]!, autoRouteDestinationKeys: keys }),
    loadPacsDestinations: async () => ({ modalities: keys.map((key, index) => ({ key, aet: `AE${index}`, host: `10.0.0.${index + 1}`, port: 104 })) }),
    createClient: () => ({ ...client, listRemoteModalityKeys: async () => keys.map((key) => `rispro_route_${key.toLowerCase()}`), echoRemoteModality: async () => { active += 1; maximumActive = Math.max(maximumActive, active); await new Promise((resolve) => setTimeout(resolve, 5)); active -= 1; } } as never),
  });
  const result = await testAllAuthoritativeOrthancOperationalRoutes(7, deps);
  assert.equal(result.reachable, 5);
  assert.ok(maximumActive <= 3);
  assert.ok(maximumActive > 1);
});

test("synchronization reuses the configured reconciliation dependency and returns its summary", async () => {
  let received: AuthoritativeOrthancSettings | null = null;
  const summary = await synchronizeAuthoritativeOrthancOperationalRoutes(1, dependencies({ synchronizeRoutes: async (value) => { received = value; return { created: 1, updated: 0, unchanged: 0, removed: 2, warnings: [] }; } }));
  assert.equal(received, settings);
  assert.deepEqual(summary, { created: 1, updated: 0, unchanged: 0, removed: 2, warnings: [] });
});

test("study lookup supports accession and StudyInstanceUID and rejects missing or mixed keys", async () => {
  const calls: unknown[] = [];
  const base = dependencies();
  const client = base.createClient(settings) as unknown as Record<string, unknown>;
  const deps = dependencies({ createClient: () => ({ ...client, findStudy: async (query: unknown) => { calls.push(query); return { status: "not_found", matchKey: "accession_number", study: null }; } } as never) });
  assert.equal((await searchAuthoritativeOrthancOperationalStudy({ accessionNumber: "ACC-1" }, deps)).status, "not_found");
  await searchAuthoritativeOrthancOperationalStudy({ studyInstanceUid: "1.2.3" }, deps);
  assert.deepEqual(calls, [{ studyInstanceUid: "", accessionNumber: "ACC-1" }, { studyInstanceUid: "1.2.3", accessionNumber: "" }]);
  await assert.rejects(() => searchAuthoritativeOrthancOperationalStudy({}, deps), /required/i);
  await assert.rejects(() => searchAuthoritativeOrthancOperationalStudy({ studyInstanceUid: "1", accessionNumber: "A" }, deps), /only one/i);
});

test("enriches DICOM transfers without changing job sorting, health, or retry behavior", async () => {
  const normalized = normalizeOrthancJob({ ID: "store", Type: "DicomModalityStore", State: "Failure", Content: { RemoteAET: "sonic", LocalAET: "RISPRO", InstancesCount: 220, FailedInstancesCount: 2, ParentResources: ["series-1"] } });
  assert.deepEqual(normalized.transfer && { remote: normalized.transfer.remoteAet, local: normalized.transfer.localAet, instances: normalized.transfer.instanceCount, failed: normalized.transfer.failedInstanceCount, parents: normalized.transfer.parentResourceIds }, { remote: "sonic", local: "RISPRO", instances: 220, failed: 2, parents: ["series-1"] });
  assert.equal(normalizeOrthancJob({ ID: "archive", Type: "Archive", State: "Success" }).transfer, null);
  const base = dependencies(); const client = base.createClient(settings) as unknown as Record<string, unknown>;
  const summary = await getAuthoritativeOrthancOperationsSummary(dependencies({ createClient: () => ({ ...client, listJobs: async () => [
    { ID: "failed", Type: "DicomModalityStore", State: "Failure", CreationTime: "20260812T090000", Content: { RemoteAet: "SONIC", ParentResources: ["series-1"] } },
    { ID: "multiple", Type: "DicomModalityStore", State: "Success", Content: { ParentResources: ["a", "b"] } },
  ], getStudySummaryForTransferredResource: async (id: string) => id === "series-1" ? { orthancStudyId: "study-1", patientId: "P-1042", patientName: "Sample Patient", accessionNumber: "ACC-1042", studyDate: "20260812", studyDescription: "CT chest", modalitiesInStudy: ["CT"] } : Promise.reject(new Error("gone")) } as never) }));
  assert.equal(summary.jobs.items[0]?.transfer?.destinationName, "SonicDICOM");
  assert.equal(summary.jobs.items[0]?.transfer?.study?.patientId, "P-1042");
  assert.equal(summary.jobs.items[1]?.transfer?.contextStatus, "multiple_resources");
  assert.equal(summary.jobs.summary.recentRelevantFailed, 1);
});
