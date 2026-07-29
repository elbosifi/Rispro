import test, { afterEach, beforeEach } from "node:test";
import assert from "node:assert/strict";
process.env.DATABASE_URL ||= "postgres://user:password@localhost:5432/rispro_test";
process.env.JWT_SECRET ||= "test-secret";
const service = await import("./authoritative-orthanc-service.js");

const enabled = { enabled: true, baseUrl: "http://orthanc.test:8042", username: "", password: "", timeoutSeconds: 1, verifyTls: true, displayName: "" };
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
    if (path === "/instances/instance-1/simplified-tags") return json({ StudyInstanceUID: "1.2.3", SeriesInstanceUID: "2.25.3", SOPInstanceUID: "2.25.4", PatientID: "PATIENT-1", AccessionNumber: "V2-000042" });
    throw new Error(`Unexpected ${init?.method || "GET"} ${path}`);
  });
  const instance = await new service.AuthoritativeOrthancClient(enabled).uploadDicomInstance(Buffer.from("DICOM"), "1.2.3");
  assert.deepEqual(instance, { orthancInstanceId: "instance-1", orthancSeriesId: "series-1", orthancStudyId: "study-1", studyInstanceUid: "1.2.3", seriesInstanceUid: "2.25.3", sopInstanceUid: "2.25.4", patientId: "PATIENT-1", accessionNumber: "V2-000042", modality: null });
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
