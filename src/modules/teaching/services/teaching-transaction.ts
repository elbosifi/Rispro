import type { PoolClient } from "pg";
import { pool } from "../../../db/pool.js";
import { HttpError } from "../../../utils/http-error.js";

export async function withTeachingTransaction<T>(operation: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query("begin");
    const result = await operation(client);
    await client.query("commit");
    return result;
  } catch (error) {
    await client.query("rollback");
    if (error instanceof HttpError) throw error;
    const code = typeof error === "object" && error !== null && "code" in error ? String(error.code) : "";
    if (code === "23505") throw new HttpError(409, "Teaching item conflicts with an existing record.");
    if (code === "23503" || code === "23514") throw new HttpError(400, "Teaching content violates a catalog or lifecycle constraint.");
    throw error;
  } finally {
    client.release();
  }
}
