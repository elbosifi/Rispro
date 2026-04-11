/**
 * Appointments V2 — Evaluate booking decision (DB-backed).
 *
 * This is the public-facing service entry point. It acquires a database
 * connection, loads all rule data, delegates to the pure `pureEvaluate()`
 * engine, and releases the connection.
 *
 * Stage 5: Wired to the real database via evaluateWithDb.
 * Stage 4: Was a stub returning "available".
 */

import type { BookingDecision, BookingDecisionInput } from "../models/booking-decision.js";
import { evaluateWithDb } from "./evaluate-with-db.js";
import { pool } from "../../../../db/pool.js";

export async function evaluateBookingDecision(
  input: BookingDecisionInput,
  policySetKey: string = "default"
): Promise<BookingDecision> {
  const client = await pool.connect();
  try {
    return evaluateWithDb(client, input, policySetKey);
  } finally {
    client.release();
  }
}
