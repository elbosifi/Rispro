import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { assertRequestScanJobScope, buildInlineContentDisposition, getRequestScanStatus, queueRequestScanRetry, requestRequestScanRunNow, requestScanScope, sendRequestScanFileResponse, setRequestScanFileHeaders } from "./request-scans.js";
import { parseRequestScanJobFilter, type RequestScanJob } from "../services/request-scan-service.js";

test("Request Scan file response is private and inline for PDF and JPEG previews", () => {
  const headers = new Map<string, string>();
  const response = { setHeader(name: string, value: string) { headers.set(name, value); } };
  setRequestScanFileHeaders(response as never, { filename: 'request".pdf', mime_type: "application/pdf" });
  assert.equal(headers.get("Content-Type"), "application/pdf");
  assert.equal(headers.get("Content-Disposition"), `inline; filename="request-scan.pdf"; filename*=UTF-8''request.pdf`);
  assert.equal(headers.get("Cache-Control"), "private, no-store");
  setRequestScanFileHeaders(response as never, { filename: "request.jpg", mime_type: "image/jpeg" });
  assert.equal(headers.get("Content-Type"), "image/jpeg");
  setRequestScanFileHeaders(response as never, { filename: "https___rispro.nccb.com.ly_public_appointment_t=pa_private_token.pdf", mime_type: "application/pdf" });
  assert.equal(headers.get("Content-Disposition"), `inline; filename="request-scan.pdf"; filename*=UTF-8''Patient%20appointment%20QR.pdf`);
  assert.equal([...headers.values()].some((value) => value.includes("pa_private_token")), false);
});

test("Request Scan inline filenames use an ASCII fallback and RFC 5987 Unicode encoding", () => {
  assert.equal(buildInlineContentDisposition("إبراهيم محمد رمضان.pdf", "application/pdf"), `inline; filename="request-scan.pdf"; filename*=UTF-8''%D8%A5%D8%A8%D8%B1%D8%A7%D9%87%D9%8A%D9%85%20%D9%85%D8%AD%D9%85%D8%AF%20%D8%B1%D9%85%D8%B6%D8%A7%D9%86.pdf`);
  assert.equal(buildInlineContentDisposition("تقرير أشعة.jpg", "image/jpeg"), `inline; filename="request-scan.jpg"; filename*=UTF-8''%D8%AA%D9%82%D8%B1%D9%8A%D8%B1%20%D8%A3%D8%B4%D8%B9%D8%A9.jpg`);
  assert.match(buildInlineContentDisposition("quote' (100%).pdf", "application/pdf"), /quote%27%20%28100%25%29\.pdf$/);
  const injected = buildInlineContentDisposition("safe.pdf\r\nX-Evil: yes", "application/pdf");
  assert.doesNotMatch(injected, /[\r\n]/);
});

test("modality staff cannot request Reception ingestion scope", () => {
  const request = { user: { role: "modality_staff" }, query: { workflowSource: "reception" } };
  assert.throws(() => requestScanScope(request as never), /cannot access Reception ingestion jobs/);
  assert.deepEqual(requestScanScope({ user: { role: "modality_staff" }, query: { workflowSource: "modality", modalityId: "7" } } as never), { workflowSource: "modality", modalityId: 7 });
});

test("direct Request Scan job access enforces workflow and modality scope", () => {
  const modalityScope = { workflowSource: "modality" as const, modalityId: 7 };
  const receptionJob = { workflow_source: "reception", modality_id: null } as unknown as RequestScanJob;
  const ownJob = { workflow_source: "modality", modality_id: 7 } as unknown as RequestScanJob;
  const otherModalityJob = { workflow_source: "modality", modality_id: 8 } as unknown as RequestScanJob;
  assert.throws(() => assertRequestScanJobScope("modality_staff", modalityScope, receptionJob), /outside the requested workflow scope/);
  assert.throws(() => assertRequestScanJobScope("modality_staff", modalityScope, otherModalityJob), /another modality/);
  assert.doesNotThrow(() => assertRequestScanJobScope("modality_staff", modalityScope, ownJob));
  assert.doesNotThrow(() => assertRequestScanJobScope("supervisor", { workflowSource: "reception", modalityId: null }, ownJob));
  assert.doesNotThrow(() => assertRequestScanJobScope("super_admin", modalityScope, receptionJob));
});

test("every direct Request Scan job route is protected by the shared id scope guard", async () => {
  const source = await readFile("src/routes/request-scans.ts", "utf8");
  assert.match(source, /requestScansRouter\.param\("id",[\s\S]*requireRequestScanJobAccess/);
  for (const route of ["/:id/file", "/:id/start-now", "/:id/retry", "/:id/retry-archive", "/:id/stop", "/:id/dismiss", "/:id/restore", "/:id/return-to-incoming", "/:id/manual-assign"]) {
    assert.match(source, new RegExp(route.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  }
  assert.match(source, /post\("\/bulk-retry"[\s\S]*requireRequestScanJobsAccess/);
  assert.match(source, /post\("\/bulk-retry-archives", requireAnyRole\(\["supervisor", "super_admin"\]\)/);
});
test("Arabic Request Scan preview sends HTTP 200 and exact PDF bytes", () => {
  const headers = new Map<string, string>(); let status = 0; let sent: Buffer | null = null; const bytes = Buffer.from([0x25, 0x50, 0x44, 0x46, 0, 0xff]);
  const response = { setHeader(name: string, value: string) { headers.set(name, value); }, status(value: number) { status = value; return this; }, send(value: Buffer) { sent = value; return this; } };
  sendRequestScanFileResponse(response as never, { filename: "إبراهيم محمد رمضان.pdf", mime_type: "application/pdf" }, bytes);
  assert.equal(status, 200); assert.deepEqual(sent, bytes); assert.equal(headers.get("Content-Type"), "application/pdf"); assert.match(headers.get("Content-Disposition")!, /filename="request-scan\.pdf"; filename\*=UTF-8''%D8/);
});

test("Request Scan status uses aggregate counts, Tripoli boundaries, and worker runtime state", async () => {
  let query = "";
  let values: unknown[] | undefined;
  const status = await getRequestScanStatus(new Date("2026-07-22T22:30:00.000Z"), {
    readSettings: async () => ({ enabled: true } as never),
    readRuntime: async () => ({ request_sequence: "10", acknowledged_sequence: "9", run_requested_at: null, worker_id: "worker-a", worker_started_at: "2026-07-22T20:00:00.000Z", worker_heartbeat_at: "2026-07-22T22:29:59.000Z", cycle_started_at: "2026-07-22T22:29:00.000Z", cycle_completed_at: null, last_success_at: "2026-07-22T20:00:00.000Z", last_error_at: "2026-07-22T20:10:00.000Z", last_error: "SMB server unavailable." }),
    query: async (text, params) => {
      query = text;
      values = params;
      return { rows: [{ pending: 4, processing: 2, processed_today: 301, duplicates_today: 5, failed: 409, dismissed: 7 }] };
    },
  });
  assert.deepEqual(status, { enabled: true, running: true, lastRunAt: "2026-07-22T20:00:00.000Z", lastError: "SMB server unavailable.", workerOnline: true, workerId: "worker-a", workerStartedAt: "2026-07-22T20:00:00.000Z", workerHeartbeatAt: "2026-07-22T22:29:59.000Z", cycleStartedAt: "2026-07-22T22:29:00.000Z", cycleCompletedAt: null, pending: 4, processing: 2, processedToday: 301, duplicatesToday: 5, failed: 409, dismissed: 7, archiveDestination: { name: null, state: "unknown", affectedCount: 0, lastConnectionCheck: null, lastSuccessfulArchive: null, nextRetryAt: null, lastError: null } });
  assert.deepEqual(values, ["2026-07-23"]);
  assert.match(query, /count\(\*\) filter \(where status = 'pending'\)/);
  assert.match(query, /count\(\*\) filter \(where status = 'processing'\)/);
  assert.match(query, /status = 'processed'.*Africa\/Tripoli/s);
  assert.match(query, /status = 'duplicate'.*Africa\/Tripoli/s);
  assert.match(query, /archive_pending/);
  assert.doesNotMatch(query, /limit 250/i);
});

test("Request Scan status propagates aggregate query failures to the standard route error handler", async () => {
  await assert.rejects(
    () => getRequestScanStatus(new Date(), { readSettings: async () => ({ enabled: true } as never), readRuntime: async () => ({}) as never, query: async () => { throw new Error("database unavailable"); } }),
    /database unavailable/
  );
});

test("Request Scan status reports a stale PostgreSQL worker heartbeat as offline", async () => {
  const status = await getRequestScanStatus(new Date("2026-07-22T22:30:00.000Z"), {
    readSettings: async () => ({ enabled: true } as never),
    readRuntime: async () => ({ request_sequence: "1", acknowledged_sequence: "1", run_requested_at: null, worker_id: "old-worker", worker_started_at: null, worker_heartbeat_at: "2026-07-22T22:28:00.000Z", cycle_started_at: "2026-07-22T22:00:00.000Z", cycle_completed_at: null, last_success_at: null, last_error_at: null, last_error: null }),
    query: async () => ({ rows: [{ pending: 1, processing: 0, processed_today: 0, duplicates_today: 0, failed: 0, dismissed: 0 }] }),
  });
  assert.equal(status.workerOnline, false);
  assert.equal(status.running, false);
});

test("Request Scan status reports a fresh completed cycle as online and idle", async () => {
  const status = await getRequestScanStatus(new Date("2026-07-22T22:30:00.000Z"), {
    readSettings: async () => ({ enabled: true } as never),
    readRuntime: async () => ({ request_sequence: "3", acknowledged_sequence: "3", run_requested_at: null, worker_id: "idle-worker", worker_started_at: "2026-07-22T22:00:00.000Z", worker_heartbeat_at: "2026-07-22T22:29:59.000Z", cycle_started_at: "2026-07-22T22:20:00.000Z", cycle_completed_at: "2026-07-22T22:20:03.000Z", last_success_at: "2026-07-22T22:20:03.000Z", last_error_at: null, last_error: null }),
    query: async () => ({ rows: [{ pending: 0, processing: 0, processed_today: 0, duplicates_today: 0, failed: 0, dismissed: 0 }] }),
  });
  assert.equal(status.workerOnline, true);
  assert.equal(status.running, false);
  assert.equal(status.lastRunAt, "2026-07-22T22:20:03.000Z");
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

test("both Request Scan SMB test routes invoke the full archive workflow with existing role enforcement", async () => {
  const [requestScans, settings] = await Promise.all([
    readFile("src/routes/request-scans.ts", "utf8"),
    readFile("src/routes/settings.ts", "utf8"),
  ]);
  assert.match(requestScans, /post\("\/archive-destination\/test", requireAnyRole\(\["supervisor", "super_admin"\]\).*await testRequestScanSmb\(settings\).*archiveWorkflowVerified: true/s);
  assert.doesNotMatch(requestScans, /archive-destination\/test".*listRequestScanFiles/s);
  assert.match(settings, /post\("\/request-scan-automation\/test".*request\.user\.role !== "super_admin".*await testRequestScanSmb\(await resolveRequestScanSettingsForTest.*archiveWorkflowVerified: true/s);
});
