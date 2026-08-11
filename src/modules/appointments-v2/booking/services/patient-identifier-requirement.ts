import type { PoolClient } from "pg";
import type { Role } from "../../../../types/domain.js";
import { SchedulingError } from "../../shared/errors/scheduling-error.js";

export const PATIENT_IDENTIFIER_REQUIRED_MESSAGE =
  "Primary identifier is required. Enter a National ID, passport number, or other identifier before saving this patient.";

export const BOOKING_PATIENT_IDENTIFIER_REQUIRED_MESSAGE =
  "This patient cannot be booked or entered into the queue because they do not have a primary identifier. Open the patient record and add a National ID, passport number, or other identifier.";

export const BOOKING_PATIENT_PHONE_REQUIRED_MESSAGE =
  "This patient cannot be booked or entered into the queue because Phone 1 is missing. Open the patient record and add a phone number.";

export const BOOKING_PATIENT_PHONE_AND_IDENTIFIER_REQUIRED_MESSAGE =
  "This patient cannot be booked or entered into the queue because Phone 1 and primary identifier are missing. Open the patient record and add a phone number and a National ID, passport number, or other identifier.";

interface RequirementSettings {
  phoneRequired: boolean;
  identifierRequired: boolean;
}

interface PatientRequirementRow {
  phone_1: string | null;
  primary_identifier: string | null;
}

function isRequiredSetting(value: unknown, defaultValue: "required" | "optional"): boolean {
  return String(value || defaultValue).trim().toLowerCase() !== "optional";
}

async function loadRequirementSettings(client: PoolClient): Promise<RequirementSettings> {
  const { rows } = await client.query<{ setting_key?: string; value: string | null }>(
    `
      select setting_key, setting_value->>'value' as value
      from system_settings
      where category = 'patient_registration'
        and setting_key in ('phone1_required', 'national_id_required')
    `
  );

  const settings = new Map(rows.map((row) => [String(row.setting_key || ""), row.value]));
  return {
    phoneRequired: isRequiredSetting(settings.get("phone1_required"), "required"),
    identifierRequired: isRequiredSetting(settings.get("national_id_required"), "required"),
  };
}

async function loadPatientRequirements(client: PoolClient, patientId: number): Promise<PatientRequirementRow> {
  const { rows } = await client.query<PatientRequirementRow>(
    `
      select
        p.phone_1,
        coalesce(
          nullif(trim(primary_identifier.value), ''),
          nullif(trim(p.identifier_value), ''),
          nullif(trim(p.national_id), '')
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

  return row;
}

function throwPatientRequirementError(patientId: number, reasonCodes: string[]): never {
  const hasPhone = reasonCodes.includes("patient_phone_required");
  const hasIdentifier = reasonCodes.includes("patient_primary_identifier_required");
  const details = {
    patientId,
    missingPhone: hasPhone,
    missingIdentifier: hasIdentifier,
  };

  if (hasPhone && hasIdentifier) {
    throw new SchedulingError(422, BOOKING_PATIENT_PHONE_AND_IDENTIFIER_REQUIRED_MESSAGE, reasonCodes, details);
  }

  if (hasPhone) {
    throw new SchedulingError(422, BOOKING_PATIENT_PHONE_REQUIRED_MESSAGE, reasonCodes, details);
  }

  throw new SchedulingError(422, BOOKING_PATIENT_IDENTIFIER_REQUIRED_MESSAGE, reasonCodes, details);
}

export async function assertPatientMeetsBookingQueueRequirements(
  client: PoolClient,
  patientId: number,
  _userRole: Role | undefined
): Promise<void> {
  const settings = await loadRequirementSettings(client);
  if (!settings.phoneRequired && !settings.identifierRequired) {
    return;
  }

  const patient = await loadPatientRequirements(client, patientId);
  const reasonCodes: string[] = [];

  if (settings.phoneRequired && !String(patient.phone_1 || "").trim()) {
    reasonCodes.push("patient_phone_required");
  }

  if (
    settings.identifierRequired &&
    !String(patient.primary_identifier || "").trim()
  ) {
    reasonCodes.push("patient_primary_identifier_required");
  }

  if (reasonCodes.length === 0) {
    return;
  }

  throwPatientRequirementError(patientId, reasonCodes);
}

export async function assertPatientIdentifierAllowsBooking(
  client: PoolClient,
  patientId: number,
  _userRole: Role | undefined
): Promise<void> {
  const settings = await loadRequirementSettings(client);
  if (!settings.identifierRequired) {
    return;
  }

  const patient = await loadPatientRequirements(client, patientId);
  if (String(patient.primary_identifier || "").trim()) {
    return;
  }

  throwPatientRequirementError(patientId, ["patient_primary_identifier_required"]);
}
