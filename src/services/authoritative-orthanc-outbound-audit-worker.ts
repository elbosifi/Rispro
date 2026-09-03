import os from "node:os";
import type { PoolClient } from "pg";
import { pool } from "../db/pool.js";
import { redactDiagnosticText } from "./system-diagnostics-service.js";
import { recordOutboundDicomTransfer } from "./dicom-transfer-event-service.js";
import {
  createAuthoritativeOrthancClient,
  type OrthancTransferredStudySummary,
} from "./authoritative-orthanc-service.js";

export const AUTHORITATIVE_ORTHANC_OUTBOUND_AUDIT_LOCK_KEY = 712364094;
const DEFAULT_OUTBOUND_AUDIT_INTERVAL_MS = 60_000;
const STUDY_RESOLUTION_CONCURRENCY = 4;

type Queryable = Pick<PoolClient, "query">;
type OutboundStatus = "ACTIVE" | "SUCCESS" | "FAILED";

type OutboundJob = {
  id: string;
  status: OutboundStatus;
  creationTime: number;
  completionTime: number | null;
  content: Record<string, unknown>;
  instanceCount: number | null;
  errorCode: string | null;
  errorMessage: string | null;
};

type ResolvedStudy = OrthancTransferredStudySummary & { studyInstanceUid: string };

export interface AuthoritativeOrthancOutboundAuditClient {
  listJobs(): Promise<unknown>;
  getStudySummaryForTransferredResource(resourceId: string): Promise<OrthancTransferredStudySummary | null>;
}

export interface AuthoritativeOrthancOutboundAuditWorker {
  stop(): Promise<void>;
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function text(value: unknown): string | null {
  const normalized = String(value ?? "").trim();
  return normalized || null;
}

function first(...values: unknown[]): string | null {
  for (const value of values) {
    if (typeof value !== "string" && typeof value !== "number") continue;
    const normalized = String(value).trim();
    if (normalized) return normalized;
  }
  return null;
}

function validResourceId(value: string): boolean {
  return /^[A-Za-z0-9_-]{1,256}$/.test(value);
}

function resourceIds(value: unknown): string[] {
  const values = Array.isArray(value) ? value : [value];
  return [...new Set(values.map((item) => first(item, record(item).ID, record(item).Id, record(item).id)).filter((item): item is string => Boolean(item)).filter(validResourceId))];
}

function fallbackResourceIds(content: Record<string, unknown>): string[] {
  const parents = resourceIds(content.ParentResources);
  if (parents.length) return parents;
  return resourceIds(content.Resources);
}

/** Orthanc compact timestamps use UTC and may carry microseconds; Date keeps the first millisecond safely. */
export function parseAuthoritativeOrthancTimestamp(value: unknown): Date | null {
  const normalized = text(value);
  if (!normalized) return null;
  const compact = normalized.match(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})(?:\.(\d{1,9}))?$/);
  if (compact) {
    const year = Number(compact[1]);
    const month = Number(compact[2]);
    const day = Number(compact[3]);
    const hour = Number(compact[4]);
    const minute = Number(compact[5]);
    const second = Number(compact[6]);
    const milliseconds = Number((compact[7] || "").slice(0, 3).padEnd(3, "0"));
    const timestamp = Date.UTC(year, month - 1, day, hour, minute, second, milliseconds);
    const parsed = new Date(timestamp);
    if (Number.isFinite(timestamp)
      && parsed.getUTCFullYear() === year
      && parsed.getUTCMonth() === month - 1
      && parsed.getUTCDate() === day
      && parsed.getUTCHours() === hour
      && parsed.getUTCMinutes() === minute
      && parsed.getUTCSeconds() === second
      && parsed.getUTCMilliseconds() === milliseconds) return parsed;
    return null;
  }
  const timestamp = Date.parse(normalized);
  return Number.isFinite(timestamp) ? new Date(timestamp) : null;
}

function safeError(value: unknown): string {
  return redactDiagnosticText(value).replace(/[\r\n\t]+/g, " ").slice(0, 1_000) || "Outbound audit cycle failed.";
}

function warning(type: string, values: Record<string, unknown>): void {
  console.warn(JSON.stringify({ type, worker: `${os.hostname()}:${process.pid}`, ...values }));
}

function mapStatus(value: unknown): OutboundStatus | null {
  const normalized = text(value)?.toUpperCase();
  if (normalized === "PENDING" || normalized === "RUNNING" || normalized === "PAUSED" || normalized === "RETRY") return "ACTIVE";
  if (normalized === "SUCCESS") return "SUCCESS";
  if (normalized === "FAILURE") return "FAILED";
  return null;
}

function nonNegativeInteger(value: unknown): number | null {
  const normalized = first(value);
  if (normalized == null) return null;
  const parsed = Number(normalized);
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : null;
}

function jobError(row: Record<string, unknown>, status: OutboundStatus): { errorCode: string | null; errorMessage: string | null } {
  if (status !== "FAILED") return { errorCode: null, errorMessage: null };
  const errorCode = first(row.ErrorCode, row.errorCode);
  const description = first(row.ErrorDescription, row.errorDescription);
  const details = first(row.ErrorDetails, row.errorDetails);
  const message = [description, details].filter((value): value is string => Boolean(value)).join(" ");
  return { errorCode: errorCode ? safeError(errorCode).slice(0, 128) : null, errorMessage: safeError(message || "Orthanc job failed.") };
}

function normalizeJob(value: unknown, fallbackId = ""): OutboundJob | null {
  const row = record(value);
  const id = first(row.ID, row.Id, row.id, fallbackId);
  const type = first(row.Type, row.type);
  if (!type || !/^DicomModalityStore$/i.test(type)) return null;
  if (!id) {
    warning("authoritative_orthanc_outbound_audit_job_invalid", { reason: "missing_job_id" });
    return null;
  }
  const status = mapStatus(row.State ?? row.state);
  if (!status) {
    warning("authoritative_orthanc_outbound_audit_job_invalid", { jobId: id, reason: "unsupported_state" });
    return null;
  }
  const creationTime = parseAuthoritativeOrthancTimestamp(row.CreationTime ?? row.creationTime);
  if (!creationTime) {
    warning("authoritative_orthanc_outbound_audit_job_skipped", { jobId: id, reason: "invalid_creation_time" });
    return null;
  }
  const completionTime = status === "ACTIVE" ? null : parseAuthoritativeOrthancTimestamp(row.CompletionTime ?? row.completionTime);
  const content = record(row.Content ?? row.content);
  const errors = jobError(row, status);
  return {
    id,
    status,
    creationTime: creationTime.getTime(),
    completionTime: completionTime?.getTime() ?? null,
    content,
    instanceCount: nonNegativeInteger(content.InstancesCount ?? content.instancesCount),
    errorCode: errors.errorCode,
    errorMessage: errors.errorMessage,
  };
}

async function mapBounded<T, R>(values: T[], concurrency: number, operation: (value: T) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(values.length);
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(Math.max(1, concurrency), values.length) }, async () => {
    for (;;) {
      const index = next++;
      if (index >= values.length) return;
      results[index] = await operation(values[index]!);
    }
  }));
  return results;
}

function mergeStudy(current: ResolvedStudy, next: OrthancTransferredStudySummary): ResolvedStudy {
  return {
    ...current,
    orthancStudyId: next.orthancStudyId || current.orthancStudyId,
    studyInstanceUid: current.studyInstanceUid,
    patientId: next.patientId ?? current.patientId,
    patientName: next.patientName ?? current.patientName,
    accessionNumber: next.accessionNumber ?? current.accessionNumber,
    studyDate: next.studyDate ?? current.studyDate,
    studyDescription: next.studyDescription ?? current.studyDescription,
    modalitiesInStudy: next.modalitiesInStudy.length ? next.modalitiesInStudy : current.modalitiesInStudy,
  };
}

async function resolveStudies(job: OutboundJob, client: AuthoritativeOrthancOutboundAuditClient): Promise<ResolvedStudy[]> {
  const ids = fallbackResourceIds(job.content);
  if (!ids.length) {
    warning("authoritative_orthanc_outbound_audit_job_skipped", { jobId: job.id, reason: "missing_parent_resource" });
    return [];
  }
  const summaries = await mapBounded(ids, STUDY_RESOLUTION_CONCURRENCY, async (resourceId) => {
    try {
      const summary = await client.getStudySummaryForTransferredResource(resourceId);
      if (!summary) warning("authoritative_orthanc_outbound_audit_study_missing", { jobId: job.id, resourceId });
      return summary;
    } catch (error) {
      warning("authoritative_orthanc_outbound_audit_study_resolution_failed", { jobId: job.id, resourceId, error: safeError(error instanceof Error ? error.message : error) });
      return null;
    }
  });
  const studies = new Map<string, ResolvedStudy>();
  for (const summary of summaries) {
    if (!summary) continue;
    const studyInstanceUid = text(summary.studyInstanceUid);
    const orthancStudyId = text(summary.orthancStudyId);
    if (!studyInstanceUid || !orthancStudyId) {
      warning("authoritative_orthanc_outbound_audit_study_skipped", { jobId: job.id, reason: "missing_study_identity" });
      continue;
    }
    const resolved: ResolvedStudy = { ...summary, orthancStudyId, studyInstanceUid };
    const existing = studies.get(studyInstanceUid);
    studies.set(studyInstanceUid, existing ? mergeStudy(existing, resolved) : resolved);
  }
  if (!studies.size) warning("authoritative_orthanc_outbound_audit_job_skipped", { jobId: job.id, reason: "study_context_unavailable" });
  return [...studies.values()];
}

async function listJobs(client: AuthoritativeOrthancOutboundAuditClient): Promise<Array<{ value: unknown; fallbackId?: string }>> {
  const payload = await client.listJobs();
  if (Array.isArray(payload)) return payload.map((value) => ({ value }));
  const rows = record(payload);
  if (payload && typeof payload === "object" && !Array.isArray(payload)) return Object.entries(rows).map(([fallbackId, value]) => ({ value, fallbackId }));
  throw new Error("Authoritative Orthanc returned an invalid jobs response.");
}

async function processJob(job: OutboundJob, client: AuthoritativeOrthancOutboundAuditClient, observedAt: string): Promise<number> {
  const studies = await resolveStudies(job, client);
  if (!studies.length) return 0;
  const firstSeenAt = new Date(job.creationTime).toISOString();
  const completedAt = job.status === "ACTIVE" ? null : job.completionTime == null ? observedAt : new Date(job.completionTime).toISOString();
  const lastSeenAt = job.status === "ACTIVE" ? observedAt : completedAt;
  const instanceCount = studies.length === 1 ? job.instanceCount : null;
  let recorded = 0;
  for (const study of studies) {
    await recordOutboundDicomTransfer({
      orthancJobId: job.id,
      patientId: study.patientId,
      patientName: study.patientName,
      accessionNumber: study.accessionNumber,
      studyInstanceUid: study.studyInstanceUid,
      studyDescription: study.studyDescription,
      sourceAet: first(job.content.LocalAet, job.content.LocalAET),
      destinationAet: first(job.content.RemoteAet, job.content.RemoteAET),
      instanceCount,
      status: job.status,
      firstSeenAt,
      lastSeenAt,
      completedAt,
      errorCode: job.errorCode,
      errorMessage: job.errorMessage,
      orthancResourceId: study.orthancStudyId,
    });
    recorded += 1;
  }
  return recorded;
}

async function ensureState(db: Queryable): Promise<{ initialized: boolean; initializedAt: number }> {
  const inserted = await db.query<{ initialized_at: string }>(
    `insert into authoritative_orthanc_outbound_audit_state(singleton_key,initialized_at,updated_at)
     values(true,now(),now())
     on conflict(singleton_key) do nothing
     returning initialized_at::text`,
  );
  if (inserted.rows[0]) {
    const initializedAt = Date.parse(inserted.rows[0].initialized_at);
    if (!Number.isFinite(initializedAt)) throw new Error("Authoritative Orthanc outbound audit state has an invalid baseline time.");
    return { initialized: true, initializedAt };
  }
  const existing = await db.query<{ initialized_at: string }>("select initialized_at::text from authoritative_orthanc_outbound_audit_state where singleton_key=true");
  const initializedAt = Date.parse(existing.rows[0]?.initialized_at || "");
  if (!Number.isFinite(initializedAt)) throw new Error("Authoritative Orthanc outbound audit baseline is unavailable.");
  return { initialized: false, initializedAt };
}

async function markSuccess(db: Queryable): Promise<void> {
  await db.query("update authoritative_orthanc_outbound_audit_state set last_success_at=now(),last_error=null,updated_at=now() where singleton_key=true");
}

async function markFailure(db: Queryable, error: unknown): Promise<void> {
  await db.query("update authoritative_orthanc_outbound_audit_state set last_error=$1,updated_at=now() where singleton_key=true", [safeError(error instanceof Error ? error.message : error)]);
}

export type OutboundAuditCycleResult = {
  lockAcquired: boolean;
  mode: "initialized" | "processed" | "failed";
  recorded: number;
};

export async function runAuthoritativeOrthancOutboundAuditCycle(
  clientFactory: () => Promise<AuthoritativeOrthancOutboundAuditClient> = createAuthoritativeOrthancClient,
): Promise<OutboundAuditCycleResult> {
  const db = await pool.connect();
  let recorded = 0;
  try {
    const lock = await db.query<{ acquired: boolean }>("select pg_try_advisory_lock($1) acquired", [AUTHORITATIVE_ORTHANC_OUTBOUND_AUDIT_LOCK_KEY]);
    if (!lock.rows[0]?.acquired) return { lockAcquired: false, mode: "processed", recorded: 0 };
    try {
      const state = await ensureState(db);
      if (state.initialized) {
        await markSuccess(db);
        return { lockAcquired: true, mode: "initialized", recorded: 0 };
      }
      const client = await clientFactory();
      const observedAt = new Date().toISOString();
      let cycleError: unknown = null;
      for (const entry of await listJobs(client)) {
        const job = normalizeJob(entry.value, entry.fallbackId);
        if (!job) continue;
        const creationTime = job.creationTime;
        if (creationTime < state.initializedAt) continue;
        try {
          recorded += await processJob(job, client, observedAt);
        } catch (error) {
          warning("authoritative_orthanc_outbound_audit_job_failed", { jobId: job.id, error: safeError(error instanceof Error ? error.message : error) });
          cycleError ||= error;
        }
      }
      if (cycleError) throw cycleError;
      await markSuccess(db);
      return { lockAcquired: true, mode: "processed", recorded };
    } catch (error) {
      await markFailure(db, error).catch(() => null);
      return { lockAcquired: true, mode: "failed", recorded };
    } finally {
      await db.query("select pg_advisory_unlock($1)", [AUTHORITATIVE_ORTHANC_OUTBOUND_AUDIT_LOCK_KEY]).catch(() => null);
    }
  } finally {
    db.release();
  }
}

let workerRunning = false;
let workerStopped = false;
let workerInterval: NodeJS.Timeout | null = null;

export async function startAuthoritativeOrthancOutboundAuditWorker(options: { intervalMs?: number } = {}): Promise<AuthoritativeOrthancOutboundAuditWorker> {
  const intervalMs = Math.max(30_000, options.intervalMs ?? DEFAULT_OUTBOUND_AUDIT_INTERVAL_MS);
  workerStopped = false;
  const tick = async () => {
    if (workerRunning || workerStopped) return;
    workerRunning = true;
    try {
      const result = await runAuthoritativeOrthancOutboundAuditCycle();
      console.info(JSON.stringify({ type: "authoritative_orthanc_outbound_audit_tick", worker: `${os.hostname()}:${process.pid}`, ...result }));
    } finally {
      workerRunning = false;
    }
  };
  void tick().catch((error) => warning("authoritative_orthanc_outbound_audit_tick_failed", { error: safeError(error instanceof Error ? error.message : error) }));
  workerInterval = setInterval(() => { void tick().catch((error) => warning("authoritative_orthanc_outbound_audit_tick_failed", { error: safeError(error instanceof Error ? error.message : error) })); }, intervalMs);
  workerInterval.unref();
  return {
    async stop() {
      workerStopped = true;
      if (workerInterval) {
        clearInterval(workerInterval);
        workerInterval = null;
      }
      while (workerRunning) await new Promise((resolve) => setTimeout(resolve, 50));
    },
  };
}
