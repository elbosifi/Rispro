import os from "node:os";
import type { PoolClient } from "pg";
import { pool } from "../db/pool.js";
import { recordInboundDicomReception } from "./dicom-transfer-event-service.js";
import {
  createAuthoritativeOrthancClient,
  type OrthancChangesPage,
  type OrthancInboundAuditStudy,
  type OrthancInstanceReceptionMetadata,
} from "./authoritative-orthanc-service.js";

const INBOUND_AUDIT_LOCK_KEY = 712364093;
const DEFAULT_INBOUND_AUDIT_INTERVAL_MS = 60_000;
const CHANGE_BATCH_SIZE = 200;
const METADATA_CONCURRENCY = 4;
const PENDING_INSTANCE_RETENTION_DAYS = 7;

type Queryable = Pick<PoolClient, "query"> | typeof pool;
type PendingInstance = { change_sequence: string; orthanc_instance_id: string };

export interface AuthoritativeOrthancInboundAuditClient {
  getChanges(since: number, limit?: number): Promise<OrthancChangesPage>;
  getLastChangeSequenceFromMetrics?(): Promise<number | null>;
  getStudyForInboundAudit(orthancStudyId: string): Promise<OrthancInboundAuditStudy | null>;
  getInstanceReceptionMetadata(orthancInstanceId: string): Promise<OrthancInstanceReceptionMetadata | null>;
}

export interface AuthoritativeOrthancInboundAuditWorker { stop(): Promise<void>; }

function text(value: unknown): string | null {
  const normalized = String(value ?? "").trim();
  return normalized || null;
}

function orthancTimestamp(value: string | null, fallback: string): string {
  if (!value) return fallback;
  const compact = value.match(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})/);
  const parsed = compact
    ? Date.UTC(Number(compact[1]), Number(compact[2]) - 1, Number(compact[3]), Number(compact[4]), Number(compact[5]), Number(compact[6]))
    : Date.parse(value);
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : fallback;
}

function optionalOrthancTimestamp(value: string | null): string | null {
  if (!value) return null;
  const compact = value.match(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})/);
  const parsed = compact
    ? Date.UTC(Number(compact[1]), Number(compact[2]) - 1, Number(compact[3]), Number(compact[4]), Number(compact[5]), Number(compact[6]))
    : Date.parse(value);
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : null;
}

function warning(type: string, values: Record<string, unknown>): void {
  console.warn(JSON.stringify({ type, worker: `${os.hostname()}:${process.pid}`, ...values }));
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

async function readChangesTail(client: AuthoritativeOrthancInboundAuditClient): Promise<number> {
  const metricTail = await client.getLastChangeSequenceFromMetrics?.();
  if (metricTail != null) return metricTail;
  let cursor = 0;
  for (;;) {
    const page = await client.getChanges(cursor, 1000);
    if (!page.done && page.lastSequence <= cursor) throw new Error("Authoritative Orthanc changes cursor did not advance while baselining inbound audit.");
    cursor = page.lastSequence;
    if (page.done) return cursor;
  }
}

type ReceptionGroup = { remoteAet: string | null; remoteIp: string | null; calledAet: string | null; receptionDates: string[]; instanceCount: number };

function receptionGroups(instances: OrthancInstanceReceptionMetadata[], completedAt: string): ReceptionGroup[] {
  const groups = new Map<string, ReceptionGroup>();
  for (const instance of instances) {
    if (text(instance.origin)?.toUpperCase() !== "DICOMPROTOCOL") continue;
    const remoteAet = text(instance.remoteAet)?.toUpperCase() ?? null;
    const remoteIp = text(instance.remoteIp);
    const calledAet = text(instance.calledAet)?.toUpperCase() ?? null;
    const key = [remoteAet, remoteIp, calledAet].map((value) => value ?? "").join("\u0000");
    const group = groups.get(key) || { remoteAet, remoteIp, calledAet, receptionDates: [], instanceCount: 0 };
    group.instanceCount += 1;
    group.receptionDates.push(orthancTimestamp(text(instance.receptionDate), completedAt));
    groups.set(key, group);
  }
  return [...groups.values()];
}

async function persistPendingInstance(change: OrthancChangesPage["changes"][number], db: Queryable): Promise<void> {
  if (!change.resourceId) return;
  await db.query(
    `insert into authoritative_orthanc_inbound_pending_instances(change_sequence,orthanc_instance_id,change_date)
     values($1,$2,$3)
     on conflict(change_sequence) do nothing`,
    [change.sequence, change.resourceId, optionalOrthancTimestamp(change.date ?? null)],
  );
}

async function pendingStudyInstances(studyInstanceIds: string[], stableSequence: number, db: Queryable): Promise<PendingInstance[]> {
  if (!studyInstanceIds.length) return [];
  const result = await db.query<PendingInstance>(
    `select change_sequence::text,orthanc_instance_id
       from authoritative_orthanc_inbound_pending_instances
      where orthanc_instance_id = any($1::text[])
        and change_sequence <= $2
      order by change_sequence`,
    [studyInstanceIds, stableSequence],
  );
  return result.rows;
}

async function consumePendingInstances(instances: PendingInstance[], db: Queryable): Promise<void> {
  if (!instances.length) return;
  await db.query(
    "delete from authoritative_orthanc_inbound_pending_instances where change_sequence = any($1::bigint[])",
    [instances.map((instance) => Number(instance.change_sequence))],
  );
}

async function cleanupStalePendingInstances(db: Queryable): Promise<void> {
  await db.query(
    "delete from authoritative_orthanc_inbound_pending_instances where created_at < now() - ($1::text || ' days')::interval",
    [String(PENDING_INSTANCE_RETENTION_DAYS)],
  );
}

async function recordStableStudy(change: OrthancChangesPage["changes"][number], client: AuthoritativeOrthancInboundAuditClient, db: Queryable): Promise<number> {
  if (!change.resourceId) return 0;
  const observedAt = new Date().toISOString();
  const completedAt = orthancTimestamp(change.date ?? null, observedAt);
  const inboundStudy = await client.getStudyForInboundAudit(change.resourceId);
  if (!inboundStudy) {
    warning("authoritative_orthanc_inbound_audit_study_missing", { changeSequence: change.sequence, orthancStudyId: change.resourceId });
    return 0;
  }
  const pending = await pendingStudyInstances(inboundStudy.instanceIds, change.sequence, db);
  if (!pending.length) return 0;
  const metadata = await mapBounded(pending, METADATA_CONCURRENCY, async (instance) => {
    const received = await client.getInstanceReceptionMetadata(instance.orthanc_instance_id);
    if (!received) warning("authoritative_orthanc_inbound_audit_instance_missing", { changeSequence: change.sequence, orthancStudyId: change.resourceId, orthancInstanceId: instance.orthanc_instance_id });
    return received;
  });
  let recorded = 0;
  for (const group of receptionGroups(metadata.filter((instance): instance is OrthancInstanceReceptionMetadata => instance !== null), completedAt)) {
    const receptionDates = group.receptionDates.sort();
    const result = await recordInboundDicomReception({
      patientId: inboundStudy.study.patientId,
      patientName: inboundStudy.study.patientName,
      accessionNumber: inboundStudy.study.accessionNumber,
      studyInstanceUid: inboundStudy.study.studyInstanceUid,
      studyDescription: inboundStudy.study.studyDescription,
      sourceAet: group.remoteAet,
      sourceIp: group.remoteIp,
      destinationAet: group.calledAet,
      instanceCount: group.instanceCount,
      firstSeenAt: receptionDates[0] || completedAt,
      lastSeenAt: receptionDates.at(-1) || completedAt,
      completedAt,
      orthancChangeSequence: change.sequence,
      orthancResourceId: change.resourceId,
    });
    if (!result.deduplicated) recorded += 1;
  }
  await consumePendingInstances(pending, db);
  return recorded;
}

async function ensureState(db: Queryable) {
  await db.query("insert into authoritative_orthanc_inbound_audit_state(singleton_key) values(true) on conflict(singleton_key) do nothing");
  const result = await db.query<{ last_change_sequence: string | null }>("select last_change_sequence::text from authoritative_orthanc_inbound_audit_state where singleton_key=true");
  return result.rows[0]?.last_change_sequence == null ? null : Number(result.rows[0].last_change_sequence);
}

async function updateState(db: Queryable, sequence: number, error: string | null): Promise<void> {
  await db.query(
    "update authoritative_orthanc_inbound_audit_state set last_change_sequence=$1,last_success_at=case when $2::text is null then now() else last_success_at end,last_error=$2,updated_at=now() where singleton_key=true",
    [sequence, error],
  );
}

export type InboundAuditCycleResult = { lockAcquired: boolean; mode: "initialized" | "processed" | "rebaselined" | "failed"; recorded: number; lastSequence: number | null };

export async function runAuthoritativeOrthancInboundAuditCycle(
  clientFactory: () => Promise<AuthoritativeOrthancInboundAuditClient> = createAuthoritativeOrthancClient,
): Promise<InboundAuditCycleResult> {
  const db = await pool.connect();
  try {
    const lock = await db.query<{ acquired: boolean }>("select pg_try_advisory_lock($1) acquired", [INBOUND_AUDIT_LOCK_KEY]);
    if (!lock.rows[0]?.acquired) return { lockAcquired: false, mode: "processed", recorded: 0, lastSequence: null };
    try {
      await cleanupStalePendingInstances(db);
      const client = await clientFactory();
      let cursor = await ensureState(db);
      if (cursor == null) {
        cursor = await readChangesTail(client);
        await updateState(db, cursor, null);
        return { lockAcquired: true, mode: "initialized", recorded: 0, lastSequence: cursor };
      }
      let processedCursor = cursor;
      let recorded = 0;
      for (;;) {
        const page = await client.getChanges(processedCursor, CHANGE_BATCH_SIZE);
        if (page.lastSequence < processedCursor) {
          const baseline = await readChangesTail(client);
          const message = `Authoritative Orthanc changes sequence moved backwards from ${processedCursor} to ${page.lastSequence}; inbound audit cursor rebaselined at ${baseline}.`;
          warning("authoritative_orthanc_inbound_audit_rebaselined", { previousSequence: processedCursor, observedSequence: page.lastSequence, baseline });
          await updateState(db, baseline, message);
          return { lockAcquired: true, mode: "rebaselined", recorded: 0, lastSequence: baseline };
        }
        if (!page.done && page.lastSequence <= processedCursor) throw new Error("Authoritative Orthanc changes cursor did not advance.");
        const changes = page.changes.filter((change) => change.sequence > processedCursor).sort((a, b) => a.sequence - b.sequence);
        for (const change of changes) {
          if (change.changeType === "NewInstance") await persistPendingInstance(change, db);
          if (change.changeType === "StableStudy") recorded += await recordStableStudy(change, client, db);
        }
        processedCursor = page.lastSequence;
        await updateState(db, processedCursor, null);
        if (page.done) return { lockAcquired: true, mode: "processed", recorded, lastSequence: processedCursor };
      }
    } catch (error) {
      const message = error instanceof Error ? error.message.slice(0, 1_000) : String(error).slice(0, 1_000);
      await db.query("update authoritative_orthanc_inbound_audit_state set last_error=$1,updated_at=now() where singleton_key=true", [message]).catch(() => null);
      return { lockAcquired: true, mode: "failed", recorded: 0, lastSequence: null };
    } finally {
      await db.query("select pg_advisory_unlock($1)", [INBOUND_AUDIT_LOCK_KEY]).catch(() => null);
    }
  } finally {
    db.release();
  }
}

let workerRunning = false;
let workerStopped = false;
let workerInterval: NodeJS.Timeout | null = null;

export async function startAuthoritativeOrthancInboundAuditWorker(options: { intervalMs?: number } = {}): Promise<AuthoritativeOrthancInboundAuditWorker> {
  const intervalMs = Math.max(30_000, options.intervalMs ?? DEFAULT_INBOUND_AUDIT_INTERVAL_MS);
  workerStopped = false;
  const tick = async () => {
    if (workerRunning || workerStopped) return;
    workerRunning = true;
    try {
      const result = await runAuthoritativeOrthancInboundAuditCycle();
      console.info(JSON.stringify({ type: "authoritative_orthanc_inbound_audit_tick", worker: `${os.hostname()}:${process.pid}`, ...result }));
    } finally { workerRunning = false; }
  };
  void tick().catch((error) => warning("authoritative_orthanc_inbound_audit_tick_failed", { error: error instanceof Error ? error.message : String(error) }));
  workerInterval = setInterval(() => { void tick().catch((error) => warning("authoritative_orthanc_inbound_audit_tick_failed", { error: error instanceof Error ? error.message : String(error) })); }, intervalMs);
  workerInterval.unref();
  return { async stop() { workerStopped = true; if (workerInterval) { clearInterval(workerInterval); workerInterval = null; } while (workerRunning) await new Promise((resolve) => setTimeout(resolve, 50)); } };
}
