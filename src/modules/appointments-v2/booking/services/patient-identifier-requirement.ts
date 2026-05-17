import type { PoolClient } from "pg";
import type { Role } from "../../../../types/domain.js";
import { SchedulingError } from "../../shared/errors/scheduling-error.js";

export const PATIENT_IDENTIFIER_REQUIRED_MESSAGE =
  "Primary identifier is required. Enter a National ID, passport number, or other identifier before saving this patient.";

export const BOOKING_PATIENT_IDENTIFIER_REQUIRED_MESSAGE =
  "This patient cannot be booked because they do not have a primary identifier. Open the patient record and add a National ID, passport number, or other identifier.";

export const SUPER_ADMIN_IDENTIFIER_BYPASS_MESSAGE =
  "Only a super admin can book or reschedule a patient without a primary identifier.";

async function isIdentifierRequired(client: PoolClient): Promise<boolean> {
  const { rows } = await client.query<{ value: string | null }>(
    `
      select setting_value->>'value' as value
      from system_settings
      where category = 'patient_registration'
        and setting_key = 'national_id_required'
      limit 1
    `
  );

  return String(rows[0]?.value || "required").trim().toLowerCase() !== "optional";
}

export async function assertPatientIdentifierAllowsBooking(
  client: PoolClient,
  patientId: number,
  userRole: Role | undefined
): Promise<void> {
  if (!(await isIdentifierRequired(client))) {
    return;
  }

  const { rows } = await client.query<{ primary_identifier: string | null }>(
    `
      select coalesce(
        nullif(primary_identifier.value, ''),
        nullif(p.identifier_value, ''),
        nullif(p.national_id, '')
      ) as primary_identifier
      from patients p
      left join lateral (
        select pi.value
        from patient_identifiers pi
        where pi.patient_id = p.id
          and pi.is_primary = true
        order by pi.id asc
        limit 1
      ) primary_identifier on true
      where p.id = $1
      limit 1
    `,
    [patientId]
  );

  const row = rows[0];
  if (!row) {
    throw new SchedulingError(404, `Patient ${patientId} not found.`, ["patient_not_found"]);
  }

  if (String(row.primary_identifier || "").trim()) {
    return;
  }

  if (userRole === "super_admin") {
    return;
  }

  throw new SchedulingError(
    400,
    BOOKING_PATIENT_IDENTIFIER_REQUIRED_MESSAGE,
    ["patient_primary_identifier_required"],
    { superAdminOnlyMessage: SUPER_ADMIN_IDENTIFIER_BYPASS_MESSAGE }
  );
}
