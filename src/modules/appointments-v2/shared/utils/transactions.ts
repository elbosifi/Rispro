/**
 * Appointments V2 — Shared transaction utilities.
 *
 * Provides helpers for running database operations inside transactions.
 */

import type { PoolClient } from "pg";
import { pool } from "../../../../db/pool.js";

const TRANSIENT_ERROR_CODES = new Set(["40001", "40P01"]);
const DEFAULT_MAX_RETRIES = 2;
const BASE_RETRY_DELAY_MS = 40;

export interface TransactionOptions {
  isolationLevel?: "read_committed" | "serializable";
  maxRetries?: number;
  retryDelayMs?: number;
  operationName?: string;
}

export async function withTransaction<T>(
  fn: (client: PoolClient) => Promise<T>,
  options: TransactionOptions = {}
): Promise<T> {
  const isolationLevel = options.isolationLevel ?? "read_committed";
  const maxRetries = options.maxRetries ?? DEFAULT_MAX_RETRIES;
  const retryDelayMs = options.retryDelayMs ?? BASE_RETRY_DELAY_MS;
  const operationName = options.operationName ?? "appointments_v2_transaction";

  let attempt = 0;
  while (true) {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      if (isolationLevel === "serializable") {
        await client.query("SET TRANSACTION ISOLATION LEVEL SERIALIZABLE");
      } else {
        await client.query("SET TRANSACTION ISOLATION LEVEL READ COMMITTED");
      }
      const result = await fn(client);
      await client.query("COMMIT");
      return result;
    } catch (err) {
      await client.query("ROLLBACK");
      const code = getPgErrorCode(err);
      const canRetry = code != null && TRANSIENT_ERROR_CODES.has(code) && attempt < maxRetries;
      if (!canRetry) {
        throw err;
      }
      attempt += 1;
      console.warn(
        JSON.stringify({
          type: "appointments_v2_transaction_retry",
          operationName,
          attempt,
          maxRetries,
          errorCode: code,
          isolationLevel,
        })
      );
      await sleep(retryDelayMs * attempt);
    } finally {
      client.release();
    }
  }
}

function getPgErrorCode(error: unknown): string | null {
  if (typeof error !== "object" || error == null) return null;
  if (!("code" in error)) return null;
  return typeof (error as { code?: unknown }).code === "string"
    ? String((error as { code: string }).code)
    : null;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
