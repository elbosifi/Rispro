import assert from "node:assert/strict";
import test from "node:test";
import { getRequestScanStatus, queueRequestScanRetry, requestRequestScanRunNow, setRequestScanFileHeaders } from "./request-scans.js";
import { parseRequestScanJobFilter, type RequestScanJob } from "../services/request-scan-service.js";

test("Request Scan file response is private and inline for PDF and JPEG previews", () => {
  const headers = new Map<string, string>();
  const response = { setHeader(name: string, value: string) { headers.set(name, value); } };
  setRequestScanFileHeaders(response as never, { filename: 'request".pdf', mime_type: "application/pdf" });
  assert.equal(headers.get("Content-Type"), "application/pdf");
  assert.equal(headers.get("Content-Disposition"), 'inline; filename="request.pdf"');
  assert.equal(headers.get("Cache-Control"), "private, no-store");
  setRequestScanFileHeaders(response as never, { filename: "request.jpg", mime_type: "image/jpeg" });
  assert.equal(headers.get("Content-Type"), "image/jpeg");
  setRequestScanFileHeaders(response as never, { filename: "https___rispro.nccb.com.ly_public_appointment_t=pa_private_token.pdf", mime_type: "application/pdf" });
  assert.equal(headers.get("Content-Disposition"), 'inline; filename="Patient appointment QR.pdf"');
  assert.equal([...headers.values()].some((value) => value.includes("pa_private_token")), false);
});

test("Request Scan status uses aggregate counts, Tripoli boundaries, and worker runtime state", async () => {
  let query = "";
  let values: unknown[] | undefined;
  const status = await getRequestScanStatus(new Date("2026-07-22T22:30:00.000Z"), {
    readSettings: async () => ({ enabled: true } as never),
    workerStatus: () => ({ lastRunAt: "2026-07-22T20:00:00.000Z", lastError: "SMB server unavailable.", running: true }),
    query: async (text, params) => {
      query = text;
      values = params;
      return { rows: [{ pending: 4, processing: 2, processed_today: 301, duplicates_today: 5, failed: 409 }] };
    },
  });
  assert.deepEqual(status, { enabled: true, lastRunAt: "2026-07-22T20:00:00.000Z", lastError: "SMB server unavailable.", running: true, pending: 4, processing: 2, processedToday: 301, duplicatesToday: 5, failed: 409 });
  assert.deepEqual(values, ["2026-07-23"]);
  assert.match(query, /count\(\*\) filter \(where status = 'pending'\)/);
  assert.match(query, /count\(\*\) filter \(where status = 'processing'\)/);
  assert.match(query, /status = 'processed'.*Africa\/Tripoli/s);
  assert.match(query, /status = 'duplicate'.*Africa\/Tripoli/s);
  assert.doesNotMatch(query, /limit 250/i);
});

test("Request Scan status propagates aggregate query failures to the standard route error handler", async () => {
  await assert.rejects(
    () => getRequestScanStatus(new Date(), { readSettings: async () => ({ enabled: true } as never), workerStatus: () => ({ lastRunAt: null, lastError: null, running: false }), query: async () => { throw new Error("database unavailable"); } }),
    /database unavailable/
  );
});

test("Request Scan status filter accepts only explicit API values", () => {
  assert.equal(parseRequestScanJobFilter("active"), "active");
  assert.equal(parseRequestScanJobFilter("processed"), "processed");
  assert.equal(parseRequestScanJobFilter("duplicate"), "duplicate");
  assert.equal(parseRequestScanJobFilter("failed"), "failed");
  assert.equal(parseRequestScanJobFilter("all"), "all");
  assert.equal(parseRequestScanJobFilter(undefined), "all");
  assert.throws(() => parseRequestScanJobFilter("processing"), /Invalid Request Scan status filter/);
  assert.throws(() => parseRequestScanJobFilter("pending' or true --"), /Invalid Request Scan status filter/);
});

test("Run Now delegates to the controlled worker trigger", async () => {
  let triggerCalls = 0;
  const result = await requestRequestScanRunNow({
    triggerWorker: async () => {
      triggerCalls += 1;
      return { status: "accepted" };
    },
  });
  assert.deepEqual(result, { status: "accepted" });
  assert.equal(triggerCalls, 1);
});

test("Retry queues the failed job and requests the controlled worker", async () => {
  const events: string[] = [];
  const queuedJob = {
    id: 7,
    filename: "failed-request.pdf",
    source_relative_path: "Incoming\\failed-request.pdf",
    mime_type: "application/pdf",
    status: "pending",
    barcode_value: null,
    appointment_id: null,
    document_id: null,
    error_message: null,
    attempt_count: 2,
    created_at: "2026-07-23T10:00:00.000Z",
    updated_at: "2026-07-23T10:01:00.000Z",
    completed_at: null,
  } satisfies RequestScanJob;

  const result = await queueRequestScanRetry(7, {
    retryJob: async (id) => {
      assert.equal(id, 7);
      events.push("queued");
      return queuedJob;
    },
    triggerWorker: async () => {
      events.push("triggered");
      return { status: "accepted" };
    },
  });

  assert.deepEqual(events, ["queued", "triggered"]);
  assert.equal(result.job.status, "pending");
  assert.deepEqual(result.trigger, { status: "accepted" });
});
