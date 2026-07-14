import type { PoolClient } from "pg";
import { pool } from "../db/pool.js";
import { sanitizeNotificationText } from "./internal-notification-formatters.js";

/** Reads only the explicitly-primary identifier. Legacy identifiers and MRN are deliberately excluded. */
export async function resolvePatientPrimaryIdentifier(patientId: number, db: PoolClient | typeof pool = pool): Promise<string | null> {
  const result = await db.query<{ value: string | null }>(
    `select nullif(trim(value), '') as value from patient_identifiers where patient_id = $1 and is_primary = true limit 1`,
    [patientId]
  );
  const rawValue = sanitizeNotificationText(result.rows[0]?.value);
  return rawValue || null;
}
