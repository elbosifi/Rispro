import assert from "node:assert/strict";
import test from "node:test";
import { getRequestScanStatus, setRequestScanFileHeaders } from "./request-scans.js";

test("Request Scan file response is private and inline for PDF and JPEG previews", () => {
  const headers = new Map<string, string>();
  const response = { setHeader(name: string, value: string) { headers.set(name, value); } };
  setRequestScanFileHeaders(response as never, { filename: 'request".pdf', mime_type: "application/pdf" });
  assert.equal(headers.get("Content-Type"), "application/pdf");
  assert.equal(headers.get("Content-Disposition"), 'inline; filename="request.pdf"');
  assert.equal(headers.get("Cache-Control"), "private, no-store");
  setRequestScanFileHeaders(response as never, { filename: "request.jpg", mime_type: "image/jpeg" });
  assert.equal(headers.get("Content-Type"), "image/jpeg");
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
