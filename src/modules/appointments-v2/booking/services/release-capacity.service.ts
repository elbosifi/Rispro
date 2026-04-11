/**
 * Appointments V2 — Release capacity service.
 *
 * In the V2 design, capacity is implicitly released when a booking is
 * cancelled or rescheduled because all capacity queries use
 * `WHERE status <> 'cancelled'`.
 *
 * This service exists for explicit documentation purposes and future
 * use if capacity tracking becomes more complex (e.g., separate quota
 * consumption counters).
 */

import type { PoolClient } from "pg";

export async function releaseCapacity(
  _client: PoolClient,
  _modalityId: number,
  _date: string,
  _caseCategory: string
): Promise<void> {
  // Capacity is implicitly released by the `WHERE status <> 'cancelled'`
  // clause in capacity queries. No explicit action needed.
  // If future quota consumption tracking is added, this is where
  // you'd decrement the quota counters.
}
