import { pool } from "../db/pool.js";
import { logAuditEntry } from "./audit-service.js";
import type { OptionalUserId } from "../types/http.js";
import { readClinicalDocumentExportSettings } from "./clinical-document-export-settings-service.js";
import { HttpError } from "../utils/http-error.js";

export const CLINICAL_DOCUMENT_EXPORT_DESTINATION = "authoritative_orthanc";
export const ORTHANC_REMOTE_DESTINATION_PREFIX = "orthanc_remote:";
export const clinicalDocumentExportDestinationKey = (remoteKey: string) => `${ORTHANC_REMOTE_DESTINATION_PREFIX}${remoteKey}`;
export const isOrthancRemoteClinicalDocumentExportDestination = (key: string) => key.startsWith(ORTHANC_REMOTE_DESTINATION_PREFIX) && key.length > ORTHANC_REMOTE_DESTINATION_PREFIX.length;
export const remoteKeyFromClinicalDocumentExportDestination = (key: string) => isOrthancRemoteClinicalDocumentExportDestination(key) ? key.slice(ORTHANC_REMOTE_DESTINATION_PREFIX.length) : null;
const EXPORTABLE_DOCUMENT_TYPES = ["appointment_request", "clinical_document"] as const;

export function isClinicalDocumentExportDocumentType(documentType: unknown): boolean {
  return EXPORTABLE_DOCUMENT_TYPES.includes(String(documentType) as (typeof EXPORTABLE_DOCUMENT_TYPES)[number]);
}

export async function enqueueClinicalDocumentExportsForAppointment(
  appointmentId: number,
  changedByUserId: OptionalUserId = null,
): Promise<number[]> {
  const result = await pool.query<{ id: number; appointment_id: number }>(
    `
      insert into clinical_document_exports (document_id, appointment_id, destination_key, representation_type, next_retry_at)
      select distinct d.id, b.id, $2, 'secondary_capture', now()
      from appointments_v2.bookings b
      join documents d
        on d.document_type in ('appointment_request', 'clinical_document')
       and (
         d.v2_booking_id = b.id
         or exists (
           select 1
           from document_appointment_links link
           where link.document_id = d.id
             and link.appointment_id = b.id
         )
       )
      where b.id = $1
      on conflict (document_id, appointment_id, destination_key) do nothing
      returning id
    `,
    [appointmentId, CLINICAL_DOCUMENT_EXPORT_DESTINATION],
  );

  for (const row of result.rows) {
    await logAuditEntry({
      entityType: "clinical_document_export",
      entityId: Number(row.id),
      actionType: "clinical_document_export_queued",
      oldValues: null,
      newValues: { destinationKey: CLINICAL_DOCUMENT_EXPORT_DESTINATION, appointmentId },
      changedByUserId,
    });
  }

  return result.rows.map((row) => Number(row.id));
}

export async function enqueueClinicalDocumentExportsForAppointmentAutomatically(
  appointmentId: number,
  changedByUserId: OptionalUserId = null,
): Promise<number[]> {
  const settings = await readClinicalDocumentExportSettings();
  if (!settings.enabled || !settings.destinationKey) return [];
  const destinationKey = clinicalDocumentExportDestinationKey(settings.destinationKey);
  const result = await pool.query<{ id: number }>(`
    insert into clinical_document_exports (document_id, appointment_id, destination_key, representation_type, next_retry_at)
    select distinct d.id, b.id, $2, 'secondary_capture', now()
    from appointments_v2.bookings b join documents d on d.document_type in ('appointment_request', 'clinical_document') and (d.v2_booking_id=b.id or exists(select 1 from document_appointment_links link where link.document_id=d.id and link.appointment_id=b.id))
    where b.id=$1 and not exists (select 1 from clinical_document_exports prior where prior.document_id=d.id and prior.appointment_id=b.id and prior.destination_key like 'orthanc_remote:%')
    on conflict (document_id, appointment_id, destination_key) do nothing returning id
  `, [appointmentId, destinationKey]);
  for (const row of result.rows) await logAuditEntry({ entityType: "clinical_document_export", entityId: Number(row.id), actionType: "clinical_document_export_queued", oldValues: null, newValues: { destinationKey, appointmentId }, changedByUserId });
  return result.rows.map((row) => Number(row.id));
}

export async function generateMissingClinicalDocumentSecondaryCaptureExports(
  appointmentId: number,
  changedByUserId: OptionalUserId = null,
): Promise<{ queued: number; exportIds: number[] }> {
  const appointment = await pool.query<{ status: string }>("select status from appointments_v2.bookings where id=$1", [appointmentId]);
  if (!appointment.rows[0]) throw new HttpError(404, "Appointment not found.");
  if (appointment.rows[0].status !== "completed") throw new HttpError(409, "Secondary Capture exports can only be generated for completed appointments.");

  const settings = await readClinicalDocumentExportSettings();
  if (!settings.enabled) throw new HttpError(409, "Clinical-document PACS export is disabled.");
  if (!settings.destinationKey) throw new HttpError(409, "No clinical-document PACS destination is configured.");

  const exportIds = await enqueueClinicalDocumentExportsForAppointmentAutomatically(appointmentId, changedByUserId);
  return { queued: exportIds.length, exportIds };
}

export async function reconcileClinicalDocumentExports(changedByUserId: OptionalUserId = null): Promise<number> {
  const result = await pool.query<{ id: number; appointment_id: number }>(
    `
      insert into clinical_document_exports (document_id, appointment_id, destination_key, representation_type, next_retry_at)
      select distinct d.id, b.id, $1, 'secondary_capture', now()
      from documents d
      join appointments_v2.bookings b
        on d.v2_booking_id = b.id
        or exists (
          select 1
          from document_appointment_links link
          where link.document_id = d.id
            and link.appointment_id = b.id
        )
      where d.document_type in ('appointment_request', 'clinical_document')
      on conflict (document_id, appointment_id, destination_key) do nothing
      returning id, appointment_id
    `,
    [CLINICAL_DOCUMENT_EXPORT_DESTINATION],
  );

  for (const row of result.rows) {
    await logAuditEntry({
      entityType: "clinical_document_export",
      entityId: Number(row.id),
      actionType: "clinical_document_export_queued",
      oldValues: null,
      newValues: { destinationKey: CLINICAL_DOCUMENT_EXPORT_DESTINATION, appointmentId: Number(row.appointment_id) },
      changedByUserId,
    });
  }

  return result.rowCount ?? 0;
}

export async function queueClinicalDocumentExportsForLinkedAppointments(
  appointmentIds: number[],
): Promise<number> {
  const ids = [...new Set(appointmentIds.map(Number).filter((value) => Number.isSafeInteger(value) && value > 0))];
  let queued = 0;
  for (const appointmentId of ids) {
    queued += (await enqueueClinicalDocumentExportsForAppointmentAutomatically(appointmentId)).length;
  }
  return queued;
}
