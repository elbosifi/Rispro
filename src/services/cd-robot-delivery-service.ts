import { pool } from "../db/pool.js";
import type { PoolClient } from "pg";
import { HttpError } from "../utils/http-error.js";
import type { UserId } from "../types/http.js";
import { normalizeRisproModalityCode } from "./clinical-document-dicom.js";
import { listOrthancRemoteModalities } from "./orthanc-pacs-service.js";
import { AuthoritativeOrthancClient, createAuthoritativeOrthancClient, resolveAuthoritativeOrthancCdAlias, synchronizeAuthoritativeOrthancCdRobots } from "./authoritative-orthanc-service.js";

const REASONS = new Set(["patient_requested_additional_copy", "previous_disc_damaged", "disc_unreadable", "additional_copy_for_referring_physician", "other"]);
type DeliveryStatus = "sending" | "success" | "failed";
type DeliveryRow = { id:number; patient_id:number; booking_id:number; study_instance_uid:string|null; destination_key:string; orthanc_study_id:string|null; orthanc_job_id:string|null; status:DeliveryStatus; attempt_count:number; resend_reason_code:string|null; resend_reason_text:string|null; requested_by_user_id:number; requested_at:string; completed_at:string|null; last_checked_at:string|null; last_error:string|null };
type BookingRow = { id:number; patient_id:number; status:string; study_instance_uid:string|null; accession_number:string; patient_primary_id:string|null; national_id:string|null; mrn:string|null; modality_code:string|null; booking_date:string };
const defaultDependencies = { listRemoteModalities: listOrthancRemoteModalities, synchronizeCdRobots: synchronizeAuthoritativeOrthancCdRobots, createClient: createAuthoritativeOrthancClient, resolveAlias: resolveAuthoritativeOrthancCdAlias };
let dependencies = { ...defaultDependencies };
export const __cdRobotDeliveryTestables = {
  setDependenciesForTests(overrides: Partial<typeof defaultDependencies>) { dependencies = { ...dependencies, ...overrides }; },
  resetTestOverrides() { dependencies = { ...defaultDependencies }; },
};

function id(value: unknown, field: string): number { const parsed = Number(value); if (!Number.isSafeInteger(parsed) || parsed < 1) throw new HttpError(400, `${field} must be a positive integer.`); return parsed; }
function meaningful(value: string): boolean { return value.replace(/\s+/g, " ").trim().length >= 5; }
function jobState(job: Record<string, unknown>): string { return String(job.State ?? job.state ?? job.Status ?? job.status ?? "").trim().toLowerCase(); }
function errorMessage(error: unknown): string { return error instanceof Error ? error.message.slice(0, 500) : "Authoritative Orthanc CD delivery failed."; }

async function bookingForDelivery(bookingId: number): Promise<BookingRow> {
  const { rows } = await pool.query<BookingRow>(`select b.id,b.patient_id,b.status,b.study_instance_uid,('V2-' || lpad(b.id::text,6,'0')) accession_number,p.identifier_value patient_primary_id,p.national_id,p.mrn,m.code modality_code,b.booking_date::text booking_date from appointments_v2.bookings b join patients p on p.id=b.patient_id left join modalities m on m.id=b.modality_id where b.id=$1`, [bookingId]);
  if (!rows[0]) throw new HttpError(404, "Appointment not found.");
  if (rows[0].status !== "completed") throw new HttpError(409, "CD sending is available only for completed appointments.");
  return rows[0];
}
async function cdDestination(key: string) {
  const { modalities } = await dependencies.listRemoteModalities();
  const destination = modalities.find((item) => item.key === key && item.isCdRobot);
  if (!destination || !destination.aet || !destination.host || destination.port == null || destination.configurationError) throw new HttpError(409, "Selected CD robot is not available.");
  return destination;
}
function validateReason(successfulCount: number, code: unknown, text: unknown): { code: string | null; text: string | null } {
  if (successfulCount === 0) return { code: null, text: null };
  const cleanCode = String(code ?? "").trim();
  if (!REASONS.has(cleanCode)) throw new HttpError(400, "A reason for the additional CD is required.");
  const cleanText = String(text ?? "").replace(/\s+/g, " ").trim();
  if (cleanCode === "other" && !meaningful(cleanText)) throw new HttpError(400, "Other reason must contain at least 5 meaningful characters.");
  return { code: cleanCode, text: cleanCode === "other" ? cleanText : null };
}
async function insertDelivery(booking: BookingRow, destinationKey: string, reason: { code:string|null; text:string|null }, userId: UserId, db: PoolClient | typeof pool = pool): Promise<DeliveryRow> {
  try {
    const { rows } = await db.query<DeliveryRow>(`insert into cd_robot_deliveries(patient_id,booking_id,study_instance_uid,destination_key,status,resend_reason_code,resend_reason_text,requested_by_user_id) values($1,$2,$3,$4,'sending',$5,$6,$7) returning *`, [booking.patient_id, booking.id, booking.study_instance_uid, destinationKey, reason.code, reason.text, userId]);
    return rows[0]!;
  } catch (error: unknown) {
    if ((error as { code?: string }).code === "23505") throw new HttpError(409, "This patient already has a CD send in progress.");
    throw error;
  }
}
async function matchAndCheck(client: AuthoritativeOrthancClient, booking: BookingRow) {
  const modality = normalizeRisproModalityCode(booking.modality_code);
  if (!modality) throw new HttpError(409, "The RISpro modality code cannot be mapped to DICOM.");
  const byUid = booking.study_instance_uid ? await client.findStudy({ studyInstanceUid: booking.study_instance_uid }) : { status: "not_found" as const, study: null };
  const result = byUid.status === "not_found" ? await client.findStudy({ accessionNumber: booking.accession_number, expectedPatientIds: [booking.patient_primary_id || "", booking.national_id || "", booking.mrn || ""], expectedModalityCode: modality, expectedStudyDate: booking.booking_date }) : byUid;
  if (result.status === "not_found") throw new HttpError(404, "Study not found in Authoritative Orthanc.");
  if (result.status !== "matched" || !result.study) throw new HttpError(409, "Unable to identify one matching study safely.");
  const patientIds = [booking.patient_primary_id, booking.national_id, booking.mrn].filter(Boolean).map((value) => value!.toUpperCase());
  if (patientIds.length && result.study.patientId && !patientIds.includes(result.study.patientId.toUpperCase())) throw new HttpError(409, "Unable to identify one matching study safely.");
  if (result.study.modalitiesInStudy.length && !result.study.modalitiesInStudy.map((value) => value.toUpperCase()).includes(modality.toUpperCase())) throw new HttpError(409, "Unable to identify one matching study safely.");
  if (result.study.studyDate && result.study.studyDate.replace(/\D/g, "").slice(0,8) !== booking.booking_date.replace(/\D/g, "").slice(0,8)) throw new HttpError(409, "Unable to identify one matching study safely.");
  return client.assertStudyStableAndNonEmpty(result.study.orthancStudyId);
}
async function terminalFailure(deliveryId: number, message: string): Promise<void> { await pool.query(`update cd_robot_deliveries set status='failed',completed_at=now(),last_checked_at=now(),last_error=$2,updated_at=now() where id=$1 and status='sending'`, [deliveryId, message]); }

export async function startCdRobotDelivery(input: { bookingId: unknown; destinationKey: unknown; resendReasonCode?: unknown; resendReasonText?: unknown; userId: UserId }): Promise<DeliveryRow> {
  const booking = await bookingForDelivery(id(input.bookingId, "bookingId"));
  const destinationKey = String(input.destinationKey ?? "").trim();
  await cdDestination(destinationKey);
  const tx = await pool.connect();
  let delivery: DeliveryRow;
  try {
    await tx.query("begin");
    await tx.query("select id from patients where id=$1 for update", [booking.patient_id]);
    const active = await tx.query(`select 1 from cd_robot_deliveries where patient_id=$1 and status='sending' limit 1`, [booking.patient_id]);
    if (active.rowCount) throw new HttpError(409, "This patient already has a CD send in progress.");
    const count = await tx.query<{ count:string }>(`select count(*)::text count from cd_robot_deliveries where booking_id=$1 and status='success'`, [booking.id]);
    delivery = await insertDelivery(booking, destinationKey, validateReason(Number(count.rows[0]?.count || 0), input.resendReasonCode, input.resendReasonText), input.userId, tx);
    await tx.query("commit");
  } catch (error) { await tx.query("rollback"); throw error; } finally { tx.release(); }
  return attemptCdRobotDelivery(delivery.id);
}

export async function attemptCdRobotDelivery(deliveryId: number): Promise<DeliveryRow> {
  const { rows } = await pool.query<DeliveryRow>(`update cd_robot_deliveries set attempt_count=attempt_count+1,last_error=null,updated_at=now() where id=$1 and status='sending' and orthanc_job_id is null and attempt_count < 2 returning *`, [deliveryId]);
  const delivery = rows[0];
  if (!delivery) return (await pool.query<DeliveryRow>(`select * from cd_robot_deliveries where id=$1`, [deliveryId])).rows[0]!;
  let booking: BookingRow;
  let client: AuthoritativeOrthancClient;
  let study: Awaited<ReturnType<typeof matchAndCheck>>;
  let alias: string;
  try {
    booking = await bookingForDelivery(delivery.booking_id);
    await cdDestination(delivery.destination_key);
    await dependencies.synchronizeCdRobots();
    client = await dependencies.createClient();
    study = await matchAndCheck(client, booking);
    alias = await dependencies.resolveAlias(delivery.destination_key);
  } catch (error) {
    await terminalFailure(delivery.id, errorMessage(error));
    return (await pool.query<DeliveryRow>(`select * from cd_robot_deliveries where id=$1`, [delivery.id])).rows[0]!;
  }
  try {
    await client.echoRemoteModality(alias);
  } catch (error) {
    if (delivery.attempt_count < 2) return attemptCdRobotDelivery(delivery.id);
    await terminalFailure(delivery.id, errorMessage(error));
    return (await pool.query<DeliveryRow>(`select * from cd_robot_deliveries where id=$1`, [delivery.id])).rows[0]!;
  }
  try {
    const orthancJobId = await client.enqueueStudyStore(alias, study.orthancStudyId);
    const result = await pool.query<DeliveryRow>(`update cd_robot_deliveries set orthanc_study_id=$2,orthanc_job_id=$3,last_checked_at=now(),updated_at=now() where id=$1 and status='sending' returning *`, [delivery.id, study.orthancStudyId, orthancJobId]);
    return result.rows[0]!;
  } catch (error) {
    await terminalFailure(delivery.id, "CD send submission was interrupted and may have reached Authoritative Orthanc. Manual retry is required.");
    return (await pool.query<DeliveryRow>(`select * from cd_robot_deliveries where id=$1`, [delivery.id])).rows[0]!;
  }
}

export async function monitorCdRobotDeliveries(limit = 25): Promise<{ checked:number }> {
  await pool.query(`update cd_robot_deliveries set status='failed',completed_at=now(),last_checked_at=now(),last_error='CD send was interrupted before an Orthanc job ID was recorded; its outcome may be uncertain. Manual retry is required.',updated_at=now() where status='sending' and orthanc_job_id is null and requested_at < now()-interval '10 minutes'`);
  const { rows } = await pool.query<DeliveryRow>(`select * from cd_robot_deliveries where status='sending' and orthanc_job_id is not null order by last_checked_at asc nulls first,requested_at asc limit $1`, [Math.max(1, Math.min(limit, 100))]);
  const client = await dependencies.createClient();
  for (const delivery of rows) {
    try {
      const state = jobState(await client.getJob(delivery.orthanc_job_id!));
      if (["success", "completed", "done"].includes(state)) await pool.query(`update cd_robot_deliveries set status='success',completed_at=now(),last_checked_at=now(),last_error=null,updated_at=now() where id=$1 and status='sending' and orthanc_job_id=$2`, [delivery.id, delivery.orthanc_job_id]);
      else if (["failure", "failed", "error", "cancelled", "canceled"].includes(state)) {
        await pool.query(`update cd_robot_deliveries set orthanc_job_id=null,last_checked_at=now(),last_error='Authoritative Orthanc CD send job failed.',updated_at=now() where id=$1 and status='sending' and orthanc_job_id=$2`, [delivery.id, delivery.orthanc_job_id]);
        if (delivery.attempt_count < 2) await attemptCdRobotDelivery(delivery.id); else await terminalFailure(delivery.id, "Authoritative Orthanc CD send job failed.");
      } else await pool.query(`update cd_robot_deliveries set last_checked_at=now(),updated_at=now() where id=$1 and status='sending' and orthanc_job_id=$2`, [delivery.id, delivery.orthanc_job_id]);
    } catch { /* Monitoring transport failures are non-terminal and do not enqueue another C-STORE. */ }
  }
  return { checked: rows.length };
}

export async function listCdRobotDestinations() { const { modalities } = await dependencies.listRemoteModalities(); return modalities.filter((item) => item.isCdRobot && item.aet && item.host && item.port != null && !item.configurationError).map((item) => ({ key:item.key, name:item.key })); }
export async function listCdRobotDeliveries(bookingId: unknown) { const clean = id(bookingId, "bookingId"); const { rows } = await pool.query(`select d.id,d.destination_key,d.status,d.attempt_count,d.resend_reason_code,d.resend_reason_text,d.requested_at,d.completed_at,d.last_error,coalesce(u.full_name,u.username) requested_by from cd_robot_deliveries d join users u on u.id=d.requested_by_user_id where d.booking_id=$1 order by d.requested_at desc`, [clean]); return rows; }
export async function retryCdRobotDelivery(deliveryId: unknown, userId: UserId) { const clean = id(deliveryId, "deliveryId"); const { rows } = await pool.query<DeliveryRow>(`select * from cd_robot_deliveries where id=$1 and status='failed'`, [clean]); if (!rows[0]) throw new HttpError(409, "Only a failed CD delivery can be retried."); const original=rows[0]; const booking=await bookingForDelivery(original.booking_id); const delivery=await insertDelivery(booking, original.destination_key, { code:original.resend_reason_code, text:original.resend_reason_text }, userId); return attemptCdRobotDelivery(delivery.id); }
