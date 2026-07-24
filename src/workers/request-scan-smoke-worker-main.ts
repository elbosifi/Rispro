import fs from "node:fs/promises";
import path from "node:path";
import { pool } from "../db/pool.js";
import { findDocumentByIdempotencyKey, getDocumentById, uploadDocumentIdempotently } from "../services/document-service.js";
import { assertRequestScanLeaseOwned, claimNextRequestScanJob, finishRequestScanJob, renewRequestScanLease, updateRequestScanCheckpoint, type ClaimedRequestScanJob } from "../services/request-scan-processing-service.js";
import { runRequestScanJobPool, type RequestScanCycleResult } from "../services/request-scan-service.js";
import { startRequestScanWorkerRuntime } from "../services/request-scan-worker-runtime.js";

if (process.env.RISPRO_REQUEST_SCAN_SMOKE_MODE !== "1" || process.env.NODE_ENV !== "test") {
  throw new Error("Request Scan smoke worker requires RISPRO_REQUEST_SCAN_SMOKE_MODE=1 and NODE_ENV=test.");
}

type Control = {
  job_id: string; booking_id: string; source_path: string; destination_path: string;
  release_requested: boolean; crash_stage: string | null;
};

async function control(jobId: number): Promise<Control> {
  const result = await pool.query<Control>("select * from request_scan_smoke_controls where job_id=$1", [jobId]);
  if (!result.rows[0]) throw new Error(`Missing smoke control for job ${jobId}.`);
  return result.rows[0];
}

async function waitForRelease(claim: ClaimedRequestScanJob): Promise<Control> {
  while (true) {
    const current = await control(claim.job.id);
    if (current.release_requested) return current;
    if (!(await renewRequestScanLease(claim.job.id, claim.lease))) throw new Error("Smoke job lease was lost.");
    await new Promise((resolve) => setTimeout(resolve, 1_000));
  }
}

async function processSmokeJob(claim: ClaimedRequestScanJob) {
  const jobId = claim.job.id;
  await pool.query("update request_scan_smoke_controls set started_at=coalesce(started_at,now()) where job_id=$1", [jobId]);
  let current = await waitForRelease(claim);
  const bookingId = Number(current.booking_id);
  const key = `request-scan:v2-booking:${bookingId}:appointment-request`;
  let documentId = claim.job.document_id ? Number(claim.job.document_id) : null;
  let created = Boolean(claim.job.attachment_created);

  if (claim.job.attachment_completed_at && documentId) {
    await getDocumentById(documentId);
  } else {
    const existing = await findDocumentByIdempotencyKey(key);
    const booking = await pool.query<{ patient_id: string }>("select patient_id from appointments_v2.bookings where id=$1", [bookingId]);
    if (!booking.rows[0]) throw new Error("Smoke booking is missing.");
    const body = await fs.readFile(current.source_path);
    const attached = existing
      ? { document: existing, created: false }
      : await uploadDocumentIdempotently({
          patientId: Number(booking.rows[0].patient_id), appointmentId: bookingId, appointmentRefType: "v2_booking",
          documentType: "appointment_request", originalFilename: claim.job.filename, mimeType: claim.job.mime_type,
          fileContentBuffer: body, source: "request_scan_automation", requestScanJobId: jobId,
        }, null, key);
    documentId = Number(attached.document.id);
    created = attached.created || Number(attached.document.request_scan_job_id) === jobId;
    await assertRequestScanLeaseOwned(jobId, claim.lease);
    await updateRequestScanCheckpoint(jobId, claim.lease, {
      appointment_id: bookingId, document_id: documentId, barcode_value: `V2-${String(bookingId).padStart(6, "0")}`,
      attachment_completed_at: new Date(), attachment_created: created,
    });
    if (current.crash_stage === "after_attachment") process.exit(71);
  }

  current = await control(jobId);
  await updateRequestScanCheckpoint(jobId, claim.lease, { intended_destination_path: current.destination_path });
  await assertRequestScanLeaseOwned(jobId, claim.lease);
  const sourceExists = await fs.stat(current.source_path).then(() => true, () => false);
  const destinationExists = await fs.stat(current.destination_path).then(() => true, () => false);
  if (sourceExists && destinationExists) throw new Error("Smoke storage reconciliation conflict.");
  if (!sourceExists && !destinationExists) throw new Error("Smoke source and destination are both missing.");
  if (sourceExists) {
    await fs.mkdir(path.dirname(current.destination_path), { recursive: true });
    await fs.rename(current.source_path, current.destination_path);
  }
  if (current.crash_stage === "after_move") process.exit(72);
  await updateRequestScanCheckpoint(jobId, claim.lease, {
    source_relative_path: current.destination_path, source_moved_at: new Date(),
  });
  await assertRequestScanLeaseOwned(jobId, claim.lease);
  const completed = await finishRequestScanJob(jobId, claim.lease, {
    status: created ? "processed" : "duplicate", appointment_id: bookingId, document_id: documentId,
    failure_category: null, error_message: null,
  });
  await pool.query("update request_scan_smoke_controls set completed_at=now() where job_id=$1", [jobId]);
  if (!completed) throw new Error("Smoke terminal update lost its lease.");
  return completed;
}

async function smokeCycle(_settings: unknown, _dependencies: unknown, workerId: string): Promise<RequestScanCycleResult> {
  const pooled = await runRequestScanJobPool({
    limit: 100,
    maxConcurrency: Number(process.env.REQUEST_SCAN_MAX_CONCURRENCY) as 1 | 2,
    claimNext: () => claimNextRequestScanJob(workerId),
    processClaimed: processSmokeJob,
  });
  return pooled.result;
}

const runtime = await startRequestScanWorkerRuntime(smokeCycle as Parameters<typeof startRequestScanWorkerRuntime>[0]);
const shutdown = async () => {
  const graceful = await runtime.stop();
  if (graceful) await pool.end();
  process.exit(0);
};
process.once("SIGTERM", () => { void shutdown(); });
process.once("SIGINT", () => { void shutdown(); });
