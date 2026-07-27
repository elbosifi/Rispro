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
