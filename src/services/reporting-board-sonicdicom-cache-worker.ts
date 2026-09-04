import os from "node:os";
import type { PoolClient } from "pg";
import { pool } from "../db/pool.js";
import {
  enqueueReportingBoardSonicDicomCacheRows,
  refreshReportingBoardSonicDicomCacheCandidates,
  selectDueComparisonSonicDicomCacheCandidates,
  selectDueReportingBoardSonicDicomCacheCandidates,
} from "./reporting-board-sonicdicom-cache-service.js";

const DEFAULT_INTERVAL_MS = 45_000;
const DEFAULT_BATCH_SIZE = 200;
const ADVISORY_LOCK_KEY = 712364091;

export interface ReportingBoardSonicDicomCacheWorker { stop(): Promise<void>; }
export interface ReportingBoardSonicDicomCacheTick { lockAcquired: boolean; candidates: number; successful: number; changedStatus: number; final: number; failed: number; durationMs: number; }

let running = false;
let stopped = false;
let interval: NodeJS.Timeout | null = null;

export async function runReportingBoardSonicDicomCacheTick(options: { batchSize?: number } = {}): Promise<ReportingBoardSonicDicomCacheTick> {
  const started = Date.now();
  if (running || stopped) return { lockAcquired: false, candidates: 0, successful: 0, changedStatus: 0, final: 0, failed: 0, durationMs: 0 };
  running = true;
  const client = await pool.connect();
  try {
    const lock = await client.query<{ acquired: boolean }>("select pg_try_advisory_lock($1) as acquired", [ADVISORY_LOCK_KEY]);
    if (!lock.rows[0]?.acquired) return { lockAcquired: false, candidates: 0, successful: 0, changedStatus: 0, final: 0, failed: 0, durationMs: Date.now() - started };
    try {
      // Seed only a bounded default scope; due selection remains indexed.
      await enqueueReportingBoardSonicDicomCacheRowsFromDefaultScope(client, Math.max(1, Math.min(options.batchSize ?? DEFAULT_BATCH_SIZE, 200)));
      const candidates = await selectDueReportingBoardSonicDicomCacheCandidates(options.batchSize ?? DEFAULT_BATCH_SIZE, client);
      const comparisonCandidates = await selectDueComparisonSonicDicomCacheCandidates(options.batchSize ?? DEFAULT_BATCH_SIZE, client);
      const result = await refreshReportingBoardSonicDicomCacheCandidates(candidates, comparisonCandidates);
      return { lockAcquired: true, ...result, durationMs: Date.now() - started };
    } finally { await client.query("select pg_advisory_unlock($1)", [ADVISORY_LOCK_KEY]).catch(() => null); }
  } finally { client.release(); running = false; }
}

async function enqueueReportingBoardSonicDicomCacheRowsFromDefaultScope(client: PoolClient, limit: number): Promise<void> {
  const rows = await client.query<{ id: number }>(`
    select b.id from appointments_v2.bookings b
    left join doctor_portal.reporting_board_sonicdicom_cache cache on cache.appointment_id = b.id
    where b.status = 'completed' and b.requires_report = true and cache.appointment_id is null
    order by b.completed_at desc nulls last, b.id desc limit $1
  `, [limit]);
  await enqueueReportingBoardSonicDicomCacheRows(rows.rows.map((row) => Number(row.id)), client);
}

export async function startReportingBoardSonicDicomCacheWorker(options: { intervalMs?: number; batchSize?: number } = {}): Promise<ReportingBoardSonicDicomCacheWorker> {
  const intervalMs = Math.max(30_000, options.intervalMs ?? DEFAULT_INTERVAL_MS);
  const batchSize = Math.max(1, Math.min(options.batchSize ?? DEFAULT_BATCH_SIZE, 200));
  stopped = false;
  const logTick = async () => {
    const tick = await runReportingBoardSonicDicomCacheTick({ batchSize });
    console.info(JSON.stringify({ type: "reporting_board_sonicdicom_cache_tick", worker: `${os.hostname()}:${process.pid}`, ...tick }));
  };
  await logTick().catch((error) => console.warn(JSON.stringify({ type: "reporting_board_sonicdicom_cache_startup_tick_failed", error: error instanceof Error ? error.message : String(error) })));
  interval = setInterval(() => { void logTick().catch((error) => console.warn(JSON.stringify({ type: "reporting_board_sonicdicom_cache_tick_failed", error: error instanceof Error ? error.message : String(error) }))); }, intervalMs);
  interval.unref();
  return { async stop() { stopped = true; if (interval) { clearInterval(interval); interval = null; } while (running) await new Promise((resolve) => setTimeout(resolve, 50)); } };
}
