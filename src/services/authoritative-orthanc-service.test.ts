import test, { afterEach, beforeEach } from "node:test";
import assert from "node:assert/strict";
process.env.DATABASE_URL ||= "postgres://user:password@localhost:5432/rispro_test";
process.env.JWT_SECRET ||= "test-secret";
const service = await import("./authoritative-orthanc-service.js");

const enabled = { enabled: true, autoExportClinicalDocuments: true, autoRouteEnabled: false, autoRouteDestinationKey: "", autoRouteDestinationKeys: [] as string[], baseUrl: "http://orthanc.test:8042", username: "", password: "", timeoutSeconds: 1, verifyTls: true, displayName: "" };
const study = (overrides: Record<string, unknown> = {}) => ({ MainDicomTags: { StudyInstanceUID: "1.2.3", AccessionNumber: "V2-000042", StudyDate: "20260727", ModalitiesInStudy: "CT", ...overrides }, PatientMainDicomTags: { PatientID: "MRN42" }, CountSeries: 2, CountInstances: 5 });
const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status, headers: { "content-type": "application/json" } });

beforeEach(() => service.__setAuthoritativeOrthancSettingsForTests(enabled));
afterEach(() => service.__resetAuthoritativeOrthancForTests());

function installStudyFetch(ids: string[], payloads: Record<string, Record<string, unknown>> = {}) {
  service.__setAuthoritativeOrthancFetchForTests(async (url, init) => {
    const path = new URL(String(url)).pathname;
    if (path === "/tools/find") return json(ids);
    const id = path.split("/")[2] || "";
    if (path.endsWith("/statistics")) return json({ CountSeries: 2, CountInstances: 5 });
    if (path.startsWith("/studies/")) return json(study(payloads[id]));
    throw new Error(`Unexpected ${init?.method || "GET"} ${path}`);
  });
}

test("connects without authentication and validates the compact system response", async () => {
  service.__setAuthoritativeOrthancFetchForTests(async (_url, init) => { assert.equal(new Headers(init?.headers).has("authorization"), false); return json({ Name: "Authoritative", Version: "1.12.4", ApiVersion: "19" }); });
  assert.deepEqual(await new service.AuthoritativeOrthancClient(enabled).getSystem(), { name: "Authoritative", version: "1.12.4", apiVersion: "19" });
});

test("uses optional Basic Authentication and normalizes authentication failures", async () => {
  const settings = { ...enabled, username: "rispro", password: "secret" };
  service.__setAuthoritativeOrthancFetchForTests(async (_url, init) => { assert.equal(new Headers(init?.headers).get("authorization"), "Basic cmlzcHJvOnNlY3JldA=="); return json({}, 401); });
  await assert.rejects(() => new service.AuthoritativeOrthancClient(settings).getSystem(), /authentication failed/i);
});

test("normalizes timeouts and does not expose a configured password", async () => {
  service.__setAuthoritativeOrthancSettingsForTests({ ...enabled, password: "secret" });
  service.__setAuthoritativeOrthancFetchForTests(async () => { const error = new Error("aborted"); error.name = "AbortError"; throw error; });
  await assert.rejects(() => new service.AuthoritativeOrthancClient({ ...enabled, password: "secret" }).getSystem(), /timed out/i);
  const display = await service.readAuthoritativeOrthancSettingsForDisplay();
  assert.equal(display.passwordConfigured, true);
  assert.equal("password" in display, false);
});

test("disabled integration cannot make a network request", async () => {
  service.__setAuthoritativeOrthancSettingsForTests({ ...enabled, enabled: false });
  service.__setAuthoritativeOrthancFetchForTests(async () => { throw new Error("network must not be called"); });
  await assert.rejects(() => new service.AuthoritativeOrthancClient({ ...enabled, enabled: false }).getSystem(), /disabled/i);
});

test("automatic clinical-document export requires both settings", () => {
  assert.equal(service.isClinicalDocumentAutoExportEnabled(enabled), true);
  assert.equal(service.isClinicalDocumentAutoExportEnabled({ ...enabled, autoExportClinicalDocuments: false }), false);
  assert.equal(service.isClinicalDocumentAutoExportEnabled({ ...enabled, enabled: false }), false);
});

test("upserts and deletes a descriptive route modality with 404 accepted", async () => {
  const calls: Array<{ path: string; method: string; body: unknown }> = [];
  service.__setAuthoritativeOrthancFetchForTests(async (url, init) => {
    calls.push({ path: new URL(String(url)).pathname, method: init?.method || "GET", body: init?.body ? JSON.parse(String(init.body)) : null });
    return new Response(null, { status: init?.method === "DELETE" ? 404 : 200 });
  });
  const client = new service.AuthoritativeOrthancClient(enabled);
  await client.upsertRemoteModality("rispro_route_imac", { aet: "PACS_AE", host: "10.0.0.10", port: 104 });
  await client.deleteRemoteModality("rispro_route_imac");
  assert.deepEqual(calls, [
    { path: "/modalities/rispro_route_imac", method: "PUT", body: { AET: "PACS_AE", Host: "10.0.0.10", Port: 104 } },
    { path: "/modalities/rispro_route_imac", method: "DELETE", body: null },
  ]);
});

test("builds recognizable descriptive aliases and resolves slug collisions deterministically", () => {
  assert.deepEqual(service.buildAuthoritativeOrthancRouteAliases(["iMac", "SonicDICOM", "Backup PACS"]), [
    { destinationKey: "iMac", alias: "rispro_route_imac" },
    { destinationKey: "SonicDICOM", alias: "rispro_route_sonicdicom" },
    { destinationKey: "Backup PACS", alias: "rispro_route_backup_pacs" },
  ]);
  const forward = service.buildAuthoritativeOrthancRouteAliases(["A B", "A-B"]);
  const reverse = service.buildAuthoritativeOrthancRouteAliases(["A-B", "A B"]);
  assert.equal(new Set(forward.map((route) => route.alias)).size, 2);
  assert.ok(forward.every((route) => route.alias.startsWith("rispro_route_a_b_")));
  assert.deepEqual(Object.fromEntries(forward.map((route) => [route.destinationKey, route.alias])), Object.fromEntries(reverse.map((route) => [route.destinationKey, route.alias])));
});

test("keeps CD robot aliases separate from automatic routing aliases", () => {
  assert.deepEqual(service.buildAuthoritativeOrthancCdAliases(["Epson Robot 1", "Epson Robot 2"]), [
    { destinationKey: "Epson Robot 1", alias: "rispro_cd_epson_robot_1" },
    { destinationKey: "Epson Robot 2", alias: "rispro_cd_epson_robot_2" },
  ]);
  assert.throws(() => service.buildAuthoritativeOrthancCdAliases(["Epson Robot", "Epson Robot"]), /ambiguous/i);
  const long = "CD robot ".repeat(20);
  assert.throws(() => service.buildAuthoritativeOrthancCdAliases([long, long]), /ambiguous/i);
});

test("resolves the same CD alias that synchronization creates from the complete CD robot set", async () => {
  const modalities = [
    { key: "Epson Robot", aet: "EPSON_AE", host: "10.0.0.10", port: 104, isCdRobot: true },
    { key: "Epson-Robot", aet: "EPSON_2_AE", host: "10.0.0.11", port: 104, isCdRobot: true },
  ];
  const calls: Array<{ path: string; body: unknown }> = [];
  service.__setAuthoritativeOrthancAutoRouteDestinationLoaderForTests(async () => ({ modalities }));
  service.__setAuthoritativeOrthancFetchForTests(async (url, init) => {
    const path = new URL(String(url)).pathname;
    if (path === "/modalities") return json([]);
    calls.push({ path, body: init?.body ? JSON.parse(String(init.body)) : null });
    return new Response(null, { status: 200 });
  });
  await service.synchronizeAuthoritativeOrthancCdRobots();
  const resolved = await service.resolveAuthoritativeOrthancCdAlias("Epson-Robot");
  assert.equal(resolved, calls.find((call) => (call.body as { AET?: string }).AET === "EPSON_2_AE")!.path.split("/").at(-1));
});

test("uses Authoritative Orthanc for C-ECHO and whole-study asynchronous C-STORE", async () => {
  const calls: Array<{ path: string; method: string; body: unknown }> = [];
  service.__setAuthoritativeOrthancFetchForTests(async (url, init) => {
    const path = new URL(String(url)).pathname;
    calls.push({ path, method: init?.method || "GET", body: init?.body ? JSON.parse(String(init.body)) : null });
    return path.endsWith("/store") ? json({ ID: "job-cd-1" }) : new Response(null, { status: 200 });
  });
  const client = new service.AuthoritativeOrthancClient(enabled);
  await client.echoRemoteModality("rispro_cd_robot_1");
  assert.equal(await client.enqueueStudyStore("rispro_cd_robot_1", "study-1"), "job-cd-1");
  assert.deepEqual(calls, [
    { path: "/modalities/rispro_cd_robot_1/echo", method: "POST", body: { Timeout: 1 } },
    { path: "/modalities/rispro_cd_robot_1/store", method: "POST", body: { Resources: ["study-1"], Synchronous: false } },
  ]);
});

test("parses global resource statistics and rejects an unusable statistics response", async () => {
  service.__setAuthoritativeOrthancFetchForTests(async () => json({ CountStudies: 12, CountSeries: "34", CountInstances: 56, TotalDiskSize: "1024", TotalDiskSizeMB: 1, TotalUncompressedSize: "2048", TotalUncompressedSizeMB: 2 }));
  assert.deepEqual(await new service.AuthoritativeOrthancClient(enabled).getStatistics(), { studies: 12, series: 34, instances: 56, diskSizeBytes: 1024, diskSizeMb: 1, uncompressedSizeBytes: 2048, uncompressedSizeMb: 2 });
  service.__setAuthoritativeOrthancFetchForTests(async () => json({ unexpected: true }));
  await assert.rejects(() => new service.AuthoritativeOrthancClient(enabled).getStatistics(), /invalid statistics response/i);
});

test("lists expanded jobs and resubmits only through the purpose-specific client method", async () => {
  const calls: Array<{ path: string; method: string; body: unknown }> = [];
  service.__setAuthoritativeOrthancFetchForTests(async (url, init) => {
    const parsed = new URL(String(url));
    calls.push({ path: `${parsed.pathname}${parsed.search}`, method: init?.method || "GET", body: init?.body ? JSON.parse(String(init.body)) : null });
    return parsed.pathname === "/jobs" ? json({ "job-1": { ID: "job-1", Type: "DicomModalityStore", State: "Failure" } }) : new Response(null, { status: 200 });
  });
  const client = new service.AuthoritativeOrthancClient(enabled);
  assert.deepEqual(await client.listJobs(), { "job-1": { ID: "job-1", Type: "DicomModalityStore", State: "Failure" } });
  await client.resubmitJob("job-1");
  assert.deepEqual(calls, [
    { path: "/jobs?expand", method: "GET", body: null },
    { path: "/jobs/job-1/resubmit", method: "POST", body: {} },
  ]);
});

test("reconciles descriptive aliases, updates details in place, and removes only deselected routes", async () => {
  const calls: Array<{ path: string; method: string; body: unknown }> = [];
  let modalities = [
    { key: "iMac", aet: "IMAC_AE", host: "10.0.0.10", port: 104 },
    { key: "Backup PACS", aet: "BACKUP_AE", host: "10.0.0.11", port: 11112 },
  ];
  service.__setAuthoritativeOrthancAutoRouteDestinationLoaderForTests(async () => ({ modalities }));
  let existing = ["rispro_autoroute", "rispro_autoroute_2", "unrelated"];
  service.__setAuthoritativeOrthancFetchForTests(async (url, init) => { const path = new URL(String(url)).pathname; if (path === "/modalities") return json(existing); calls.push({ path, method: init?.method || "GET", body: init?.body ? JSON.parse(String(init.body)) : null }); return new Response(null, { status: 200 }); });
  await service.synchronizeAuthoritativeOrthancAutoRoute({ ...enabled, autoRouteEnabled: true, autoRouteDestinationKey: "iMac", autoRouteDestinationKeys: ["iMac", "Backup PACS"] });
  assert.deepEqual(calls, [
    { path: "/modalities/rispro_route_imac", method: "PUT", body: { AET: "IMAC_AE", Host: "10.0.0.10", Port: 104 } },
    { path: "/modalities/rispro_route_backup_pacs", method: "PUT", body: { AET: "BACKUP_AE", Host: "10.0.0.11", Port: 11112 } },
    { path: "/modalities/rispro_autoroute", method: "DELETE", body: null },
    { path: "/modalities/rispro_autoroute_2", method: "DELETE", body: null },
  ]);
  calls.length = 0;
  existing = ["rispro_route_imac", "rispro_route_backup_pacs", "unrelated"];
  modalities = [{ ...modalities[0]!, host: "10.0.0.20" }, modalities[1]!];
  await service.synchronizeAuthoritativeOrthancAutoRoute({ ...enabled, autoRouteEnabled: true, autoRouteDestinationKey: "iMac", autoRouteDestinationKeys: ["iMac", "Backup PACS"] });
  assert.deepEqual(calls.map((call) => call.path), ["/modalities/rispro_route_imac", "/modalities/rispro_route_backup_pacs"]);
  assert.deepEqual(calls[0]!.body, { AET: "IMAC_AE", Host: "10.0.0.20", Port: 104 });
  calls.length = 0;
  await service.synchronizeAuthoritativeOrthancAutoRoute({ ...enabled, autoRouteEnabled: true, autoRouteDestinationKey: "Backup PACS", autoRouteDestinationKeys: ["Backup PACS"] });
  assert.deepEqual(calls, [
    { path: "/modalities/rispro_route_backup_pacs", method: "PUT", body: { AET: "BACKUP_AE", Host: "10.0.0.11", Port: 11112 } },
    { path: "/modalities/rispro_route_imac", method: "DELETE", body: null },
  ]);
});

test("disabled auto-routing removes new and legacy owned aliases but preserves unrelated modalities", async () => {
  const calls: string[] = [];
  service.__setAuthoritativeOrthancFetchForTests(async (url, init) => { const path = new URL(String(url)).pathname; if (path === "/modalities") return json(["rispro_route_imac", "rispro_route_backup_pacs", "rispro_autoroute", "rispro_autoroute_3", "unrelated"]); calls.push(`${init?.method || "GET"} ${path}`); return new Response(null, { status: 200 }); });
  await service.synchronizeAuthoritativeOrthancAutoRoute(enabled);
  assert.deepEqual(calls, ["DELETE /modalities/rispro_route_imac", "DELETE /modalities/rispro_route_backup_pacs", "DELETE /modalities/rispro_autoroute", "DELETE /modalities/rispro_autoroute_3"]);
  service.__setAuthoritativeOrthancAutoRouteDestinationLoaderForTests(async () => ({ modalities: [] }));
  await assert.rejects(() => service.synchronizeAuthoritativeOrthancAutoRoute({ ...enabled, autoRouteEnabled: true, autoRouteDestinationKey: "missing", autoRouteDestinationKeys: ["missing"] }), /valid existing PACS destinations/i);
  assert.equal(calls.length, 4);
});

test("uses an exact StudyInstanceUID before accession and returns study metadata", async () => {
  const bodies: string[] = [];
  installStudyFetch(["study-a"]);
  service.__setAuthoritativeOrthancFetchForTests(async (url, init) => { const path = new URL(String(url)).pathname; if (path === "/tools/find") { bodies.push(String(init?.body)); return json(["study-a"]); } if (path.endsWith("/statistics")) return json({ CountSeries: 2, CountInstances: 5 }); return json(study()); });
  const result = await new service.AuthoritativeOrthancClient(enabled).findStudy({ studyInstanceUid: "1.2.3", accessionNumber: "V2-000042" });
  assert.equal(result.status, "matched"); assert.equal(result.matchKey, "study_instance_uid"); assert.equal(result.study?.orthancStudyId, "study-a"); assert.match(bodies[0] || "", /StudyInstanceUID/); assert.doesNotMatch(bodies[0] || "", /AccessionNumber/);
});

test("returns a unique accession match, no-match, and ambiguity safely", async () => {
  installStudyFetch(["study-a"]);
  assert.equal((await new service.AuthoritativeOrthancClient(enabled).findStudy({ accessionNumber: "V2-000042", expectedPatientIds: ["MRN42"], expectedModalityCode: "CT", expectedStudyDate: "2026-07-27" })).status, "matched");
  installStudyFetch([]);
  assert.equal((await new service.AuthoritativeOrthancClient(enabled).findStudy({ accessionNumber: "V2-000042" })).status, "not_found");
  installStudyFetch(["study-a", "study-b"]);
  assert.equal((await new service.AuthoritativeOrthancClient(enabled).findStudy({ accessionNumber: "V2-000042" })).status, "ambiguous");
});

test("rejects conflicting StudyInstanceUID search results and never calls mutation endpoints", async () => {
  const calls: Array<{ path: string; method: string }> = [];
  installStudyFetch(["study-a", "study-b"], { "study-b": { StudyInstanceUID: "9.9.9" } });
  service.__setAuthoritativeOrthancFetchForTests(async (url, init) => { const path = new URL(String(url)).pathname; calls.push({ path, method: init?.method || "GET" }); if (path === "/tools/find") return json(["study-a", "study-b"]); if (path.endsWith("/statistics")) return json({}); return json(study(path.includes("study-b") ? { StudyInstanceUID: "9.9.9" } : {})); });
  const result = await new service.AuthoritativeOrthancClient(enabled).findStudy({ studyInstanceUid: "1.2.3" });
  assert.equal(result.status, "ambiguous");
  assert.ok(calls.every((call) => call.method === "GET" || (call.method === "POST" && call.path === "/tools/find")));
});

test("uploads one DICOM instance and verifies the returned study, series, and SOP identifiers", async () => {
  const calls: Array<{ path: string; method: string }> = [];
  service.__setAuthoritativeOrthancFetchForTests(async (url, init) => {
    const path = new URL(String(url)).pathname;
    calls.push({ path, method: init?.method || "GET" });
    if (path === "/instances") {
      assert.equal(init?.method, "POST");
      assert.equal(new Headers(init?.headers).get("content-type"), "application/dicom");
      assert.ok(Buffer.isBuffer(init?.body));
      return json({ ID: "instance-1", ParentSeries: "series-1", ParentStudy: "study-1" });
    }
    if (path === "/instances/instance-1") return json({ ParentSeries: "series-1", ParentStudy: "study-1" });
    if (path === "/instances/instance-1/simplified-tags") return json({ StudyInstanceUID: "1.2.3", SeriesInstanceUID: "2.25.3", SOPInstanceUID: "2.25.4", PatientID: "PATIENT-1", AccessionNumber: "V2-000042", Modality: "MR" });
    throw new Error(`Unexpected ${init?.method || "GET"} ${path}`);
  });
  const instance = await new service.AuthoritativeOrthancClient(enabled).uploadDicomInstance(Buffer.from("DICOM"), "1.2.3");
  assert.deepEqual(instance, { orthancInstanceId: "instance-1", orthancSeriesId: "series-1", orthancStudyId: "study-1", studyInstanceUid: "1.2.3", seriesInstanceUid: "2.25.3", sopInstanceUid: "2.25.4", patientId: "PATIENT-1", accessionNumber: "V2-000042", modality: "MR" });
  assert.deepEqual(calls.map((call) => `${call.method} ${call.path}`), ["POST /instances", "GET /instances/instance-1", "GET /instances/instance-1/simplified-tags"]);
});

test("finds an existing SOPInstanceUID for retry idempotency without mutating Orthanc", async () => {
  service.__setAuthoritativeOrthancFetchForTests(async (url, init) => {
    const path = new URL(String(url)).pathname;
    if (path === "/tools/find") { assert.match(String(init?.body), /SOPInstanceUID/); return json(["instance-1"]); }
    if (path === "/instances/instance-1") return json({ ParentSeries: "series-1", ParentStudy: "study-1" });
    if (path === "/instances/instance-1/simplified-tags") return json({ StudyInstanceUID: "1.2.3", SeriesInstanceUID: "2.25.3", SOPInstanceUID: "2.25.4", PatientID: "PATIENT-1", AccessionNumber: "V2-000042" });
    throw new Error(`Unexpected ${path}`);
  });
  const instance = await new service.AuthoritativeOrthancClient(enabled).findInstanceBySopInstanceUid("2.25.4");
  assert.equal(instance?.orthancInstanceId, "instance-1");
});

test("rejects a returned instance whose study does not match the intended study", async () => {
  service.__setAuthoritativeOrthancFetchForTests(async (url) => {
    const path = new URL(String(url)).pathname;
    if (path === "/instances") return json({ ID: "instance-1" });
    if (path === "/instances/instance-1") return json({ ParentSeries: "series-1", ParentStudy: "study-1" });
    if (path === "/instances/instance-1/simplified-tags") return json({ StudyInstanceUID: "9.9.9", SeriesInstanceUID: "2.25.3", SOPInstanceUID: "2.25.4" });
    throw new Error(`Unexpected ${path}`);
  });
  await assert.rejects(() => new service.AuthoritativeOrthancClient(enabled).uploadDicomInstance(Buffer.from("DICOM"), "1.2.3"), /different study/i);
});

test("reads ParentStudy from the series only when the instance resource omits it", async () => {
  service.__setAuthoritativeOrthancFetchForTests(async (url) => {
    const path = new URL(String(url)).pathname;
    if (path === "/instances/instance-1") return json({ ParentSeries: "series-1" });
    if (path === "/series/series-1") return json({ ParentStudy: "study-1" });
    if (path === "/instances/instance-1/simplified-tags") return json({ StudyInstanceUID: "1.2.3", SeriesInstanceUID: "2.25.3", SOPInstanceUID: "2.25.4" });
    throw new Error(`Unexpected ${path}`);
  });
  const instance = await new service.AuthoritativeOrthancClient(enabled).getInstance("instance-1");
  assert.equal(instance.orthancStudyId, "study-1");
});

test("falls back to detailed Orthanc tags and parses detailed values", async () => {
  const calls: string[] = [];
  service.__setAuthoritativeOrthancFetchForTests(async (url) => {
    const path = new URL(String(url)).pathname;
    calls.push(path);
    if (path === "/instances/instance-1") return json({ ParentSeries: "series-1", ParentStudy: "study-1" });
    if (path === "/instances/instance-1/simplified-tags") return json({ PatientID: "PATIENT-1" });
    if (path === "/instances/instance-1/tags") return json({ "00080018": { Value: "2.25.4" }, "00080050": { Value: "V2-000042" }, "00100020": { Value: "PATIENT-1" }, "0020000D": { Value: "1.2.3" }, "0020000E": { Value: "2.25.3" } });
    throw new Error(`Unexpected ${path}`);
  });
  const instance = await new service.AuthoritativeOrthancClient(enabled).getInstance("instance-1");
  assert.deepEqual(instance, { orthancInstanceId: "instance-1", orthancSeriesId: "series-1", orthancStudyId: "study-1", studyInstanceUid: "1.2.3", seriesInstanceUid: "2.25.3", sopInstanceUid: "2.25.4", patientId: "PATIENT-1", accessionNumber: "V2-000042", modality: null });
  assert.deepEqual(calls, ["/instances/instance-1", "/instances/instance-1/simplified-tags", "/instances/instance-1/tags"]);
});

test("fails safely when required instance UIDs remain incomplete", async () => {
  service.__setAuthoritativeOrthancFetchForTests(async (url) => {
    const path = new URL(String(url)).pathname;
    if (path === "/instances/instance-1") return json({ ParentSeries: "series-1", ParentStudy: "study-1" });
    if (path === "/instances/instance-1/simplified-tags") return json({ StudyInstanceUID: "1.2.3", SeriesInstanceUID: "2.25.3" });
    if (path === "/instances/instance-1/tags") return json({ SOPInstanceUID: null });
    throw new Error(`Unexpected ${path}`);
  });
  await assert.rejects(() => new service.AuthoritativeOrthancClient(enabled).getInstance("instance-1"), /incomplete instance metadata/i);
});

test("preserves Orthanc availability errors while trying tag fallbacks", async () => {
  service.__setAuthoritativeOrthancFetchForTests(async (url) => {
    const path = new URL(String(url)).pathname;
    if (path === "/instances/instance-1") return json({ ParentSeries: "series-1", ParentStudy: "study-1" });
    throw new Error("fetch failed");
  });
  await assert.rejects(() => new service.AuthoritativeOrthancClient(enabled).getInstance("instance-1"), /unavailable/i);
});

test("resolves transferred series, direct studies, and unavailable resources read-only", async () => {
  for (const [resource, expected, responses] of [
    ["series-1", "study-1", { "/series/series-1/study": json({ ID: "study-1", MainDicomTags: { PatientName: "Sample Patient", PatientID: "P-1042", AccessionNumber: "ACC-1042", StudyDescription: "CT chest", ModalitiesInStudy: "CT" } }) }],
    ["study-1", "study-1", { "/series/study-1/study": json({}, 404), "/studies/study-1": json({ ID: "study-1", MainDicomTags: { PatientName: "Sample Patient" } }) }],
    ["missing", null, { "/series/missing/study": json({}, 404), "/studies/missing": json({}, 404) }],
  ] as const) {
    service.__setAuthoritativeOrthancFetchForTests(async (url) => responses[new URL(String(url)).pathname as keyof typeof responses] || json({}, 404));
    assert.equal((await new service.AuthoritativeOrthancClient(enabled).getStudySummaryForTransferredResource(resource))?.orthancStudyId || null, expected);
  }
});
