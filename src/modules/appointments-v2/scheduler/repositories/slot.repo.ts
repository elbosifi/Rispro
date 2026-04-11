/**
 * Appointments V2 — Slot repository (stub).
 *
 * TODO (Stage 3/5): Implement DB queries for slot data.
 */

import type { PoolClient } from "pg";

export async function getSlotsForDate(
  _client: PoolClient | null,
  _modalityId: number,
  _date: string
): Promise<unknown[]> {
  // TODO: Query slots
  return [];
}
