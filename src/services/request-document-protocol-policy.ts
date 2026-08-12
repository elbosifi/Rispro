import { pool } from "../db/pool.js";
import { HttpError } from "../utils/http-error.js";
import { loadSettingsMap } from "./settings-service.js";

export const REQUEST_DOCUMENT_PROTOCOL_SETTING_CATEGORY = "documents_and_uploads";
export const REQUEST_DOCUMENT_PROTOCOL_SETTING_KEY = "require_request_document_for_protocol_queue";
export const QUALIFYING_REQUEST_DOCUMENT_TYPE = "appointment_request";

function isEnabled(value: unknown): boolean {
  return String(value ?? "").trim().toLowerCase() === "enabled";
}

export async function isRequestDocumentRequiredForProtocolQueue(): Promise<boolean> {
  const settings = await loadSettingsMap([REQUEST_DOCUMENT_PROTOCOL_SETTING_CATEGORY]);
  return isEnabled(settings[REQUEST_DOCUMENT_PROTOCOL_SETTING_CATEGORY]?.[REQUEST_DOCUMENT_PROTOCOL_SETTING_KEY]);
}

export function qualifyingRequestDocumentExistsSql(bookingIdSql: string): string {
  return `exists (
    select 1
    from documents request_document
    where request_document.document_type = '${QUALIFYING_REQUEST_DOCUMENT_TYPE}'
      and (
        request_document.v2_booking_id = ${bookingIdSql}
        or exists (
          select 1
          from document_appointment_links request_link
          where request_link.document_id = request_document.id
            and request_link.appointment_id = ${bookingIdSql}
        )
      )
  )`;
}

export async function hasQualifyingRequestDocument(appointmentId: number): Promise<boolean> {
  const result = await pool.query<{ qualifies: boolean }>(
    `select ${qualifyingRequestDocumentExistsSql("$1::bigint")} as qualifies`,
    [appointmentId]
  );
  return Boolean(result.rows[0]?.qualifies);
}

export async function assertRequestDocumentProtocolEligibility(appointmentId: number): Promise<void> {
  if (!await isRequestDocumentRequiredForProtocolQueue()) return;
  if (await hasQualifyingRequestDocument(appointmentId)) return;
  throw new HttpError(409, "A request document must be attached before this appointment can be protocolled.");
}
