/**
 * Appointments V2 — Shared transaction utilities.
 *
 * Provides helpers for running database operations inside transactions.
 */

import type { PoolClient } from "pg";
import { pool } from "../../../../db/pool.js";

export async function withTransaction<T>(
  fn: (client: PoolClient) => Promise<T>
): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const result = await fn(client);
    await client.query("COMMIT");
    return result;
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}
