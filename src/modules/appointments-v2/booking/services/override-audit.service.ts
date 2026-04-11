/**
 * Appointments V2 — Override audit service (stub).
 *
 * TODO (Stage 6): Record override audit events for supervisor-approved overrides.
 */

export async function recordOverride(
  _bookingId: number,
  _supervisorUserId: number,
  _reason: string
): Promise<void> {
  // TODO: Record override audit (Stage 6)
}
