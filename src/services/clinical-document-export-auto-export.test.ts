import assert from "node:assert/strict";
import test, { afterEach, mock } from "node:test";
process.env.DATABASE_URL ||= "postgres://user:password@localhost:5432/rispro_test";
process.env.JWT_SECRET ||= "test-secret";
const orthanc = await import("./authoritative-orthanc-service.js");
const queue = await import("./clinical-document-export-queue-service.js");
const exports = await import("./clinical-document-export-service.js");
const { pool } = await import("../db/pool.js");

const settings = { enabled: true, autoExportClinicalDocuments: true, baseUrl: "http://orthanc.test:8042", username: "", password: "", timeoutSeconds: 1, verifyTls: true, displayName: "" };
afterEach(() => { mock.restoreAll(); orthanc.__resetAuthoritativeOrthancForTests(); });

test("automatic worker does not reconcile or claim when either export gate is off", async () => {
  let queries = 0;
  mock.method(pool, "query", async () => { queries += 1; return { rows: [], rowCount: 0 }; });
  for (const disabled of [{ ...settings, autoExportClinicalDocuments: false }, { ...settings, enabled: false }]) {
    orthanc.__setAuthoritativeOrthancSettingsForTests(disabled);
    assert.deepEqual(await exports.runClinicalDocumentExportTick(), { reconciled: 0, processed: 0, exported: 0, failed: 0 });
  }
  assert.equal(queries, 0);
});

test("automatic worker reconciles and checks for claims when both export gates are on", async () => {
  const queries: string[] = [];
  mock.method(pool, "query", async (sql: unknown) => { queries.push(String(sql)); return { rows: [], rowCount: 0 }; });
  orthanc.__setAuthoritativeOrthancSettingsForTests(settings);
  assert.deepEqual(await exports.runClinicalDocumentExportTick(), { reconciled: 0, processed: 0, exported: 0, failed: 0 });
  assert.ok(queries.some((sql) => sql.includes("insert into clinical_document_exports")));
  assert.ok(queries.some((sql) => sql.includes("status='exporting'")));
});

test("automatic appointment enqueue does not create rows while export is off", async () => {
  let queries = 0;
  mock.method(pool, "query", async () => { queries += 1; return { rows: [], rowCount: 0 }; });
  orthanc.__setAuthoritativeOrthancSettingsForTests({ ...settings, autoExportClinicalDocuments: false });
  assert.deepEqual(await queue.enqueueClinicalDocumentExportsForAppointmentAutomatically(42), []);
  assert.equal(queries, 0);
  orthanc.__setAuthoritativeOrthancSettingsForTests(settings);
  assert.deepEqual(await queue.enqueueClinicalDocumentExportsForAppointmentAutomatically(42), []);
  assert.equal(queries, 1);
});
