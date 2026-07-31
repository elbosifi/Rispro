import assert from "node:assert/strict";
import { mock, test } from "node:test";
import { pool } from "../db/pool.js";
import { listRequestScanJobs, type RequestScanJob } from "./request-scan-service.js";

test("listRequestScanJobs sanitizes a historical clinical export error before returning it", async () => {
  const unsafeError = String.raw`Failed to open C:\Patient Documents\John Doe.pdf Authorization: Bearer secret`;
  const job = {
    id: 91,
    filename: "safe-fixture.pdf",
    source_relative_path: "Requests\\Processed\\safe-fixture.pdf",
    mime_type: "application/pdf",
    status: "processed",
    barcode_value: null,
    appointment_id: 17,
    document_id: 23,
    error_message: null,
    attempt_count: 1,
    created_at: "2026-08-01T00:00:00.000Z",
    updated_at: "2026-08-01T00:00:00.000Z",
    completed_at: "2026-08-01T00:00:00.000Z",
    clinical_document_export_last_error: unsafeError,
  } satisfies RequestScanJob;

  mock.method(pool, "query", async (query: unknown) => {
    const sql = String(query);
    if (sql.includes("from request_scan_jobs j")) return { rows: [job], rowCount: 1 };
    if (sql.includes("from request_scan_job_appointments link")) return { rows: [], rowCount: 0 };
    throw new Error(`Unexpected query: ${sql}`);
  });

  const returned = (await listRequestScanJobs("all")).find(({ id }) => Number(id) === job.id);
  assert.ok(returned);
  const message = returned.clinical_document_export_last_error ?? "";
  for (const value of ["John Doe", "Doe.pdf", String.raw`C:\Patient`, "secret", "Bearer"]) assert.ok(!message.includes(value), `${JSON.stringify(value)} remained in ${JSON.stringify(message)}`);
  assert.match(message, /Failed to open/);
});
