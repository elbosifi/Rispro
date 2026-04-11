/**
 * Appointments V2 — Schedule repository (stub).
 *
 * TODO (Stage 3/5): Implement DB queries for schedule data.
 */

import type { PoolClient } from "pg";

export async function getScheduleForDateRange(
  _client: PoolClient | null,
  _modalityId: number,
  _startDate: string,
  _endDate: string
): Promise<unknown[]> {
  // TODO: Query schedule data
  return [];
}
