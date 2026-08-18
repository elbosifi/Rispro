import assert from "node:assert/strict";
import test, { afterEach, mock } from "node:test";
process.env.DATABASE_URL ||= "postgres://user:password@localhost:5432/rispro_test";
process.env.JWT_SECRET ||= "test-secret";
const queue = await import("./clinical-document-export-queue-service.js");
const exports = await import("./clinical-document-export-service.js");
const { pool } = await import("../db/pool.js");

const clinicalSettings = (enabled: boolean, destinationKey = "OSIRIX_IMAC") => [{ category: "clinical_document_export", setting_key: "enabled", setting_value: { value: enabled ? "enabled" : "disabled" } }, { category: "clinical_document_export", setting_key: "destination_key", setting_value: { value: destinationKey } }];
afterEach(() => { mock.restoreAll(); });

test("automatic worker is gated by clinical document export settings and does not reconcile history", async () => {
  const queries: string[] = [];
  mock.method(pool, "query", async (sql: unknown) => { queries.push(String(sql)); return { rows: clinicalSettings(false), rowCount: 2 }; });
  assert.deepEqual(await exports.runClinicalDocumentExportTick(), { reconciled: 0, processed: 0, exported: 0, failed: 0 });
  assert.equal(queries.some((sql) => sql.includes("insert into clinical_document_exports")), false);
  assert.equal(queries.some((sql) => sql.includes("status='exporting'")), false);
});

test("automatic worker claims only selected remote PACS rows", async () => {
  const queries: string[] = [];
  mock.method(pool, "query", async (sql: unknown) => { queries.push(String(sql)); return { rows: String(sql).includes("from system_settings") ? clinicalSettings(true) : [], rowCount: 0 }; });
  assert.deepEqual(await exports.runClinicalDocumentExportTick(), { reconciled: 0, processed: 0, exported: 0, failed: 0 });
  assert.equal(queries.some((sql) => sql.includes("insert into clinical_document_exports")), false);
  assert.ok(queries.some((sql) => sql.includes("destination_key like")));
});

test("automatic appointment enqueue uses selected remote PACS destination", async () => {
  const queries: Array<{ sql: string; values: unknown[] }> = [];
  mock.method(pool, "query", async (sql: unknown, values?: unknown[]) => { queries.push({ sql: String(sql), values: values || [] }); return { rows: String(sql).includes("from system_settings") ? clinicalSettings(false) : [], rowCount: 0 }; });
  assert.deepEqual(await queue.enqueueClinicalDocumentExportsForAppointmentAutomatically(42), []);
  mock.restoreAll();
  mock.method(pool, "query", async (sql: unknown, values?: unknown[]) => { queries.push({ sql: String(sql), values: values || [] }); return { rows: String(sql).includes("from system_settings") ? clinicalSettings(true) : [], rowCount: 0 }; });
  assert.deepEqual(await queue.enqueueClinicalDocumentExportsForAppointmentAutomatically(42), []);
  assert.ok(queries.some((entry) => entry.values.includes("orthanc_remote:OSIRIX_IMAC")));
});

test("export eligibility is semantic and independent of upload source", () => {
  for (const documentType of ["appointment_request", "clinical_document"]) {
    assert.equal(queue.isClinicalDocumentExportDocumentType(documentType), true);
  }
  for (const documentType of ["referral_request", "other", "", null]) {
    assert.equal(queue.isClinicalDocumentExportDocumentType(documentType), false);
  }
});
