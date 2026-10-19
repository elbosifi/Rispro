import type { PoolClient } from "pg";
import { pool } from "../db/pool.js";
import { HttpError } from "../utils/http-error.js";
import { normalizePositiveInteger } from "../utils/normalize.js";
import { logAuditEntry } from "./audit-service.js";
import { getDocumentById, readDocumentContent } from "./document-service.js";

export type PatientIdentityDocumentStatus =
  | "not_uploaded"
  | "pending"
  | "verified";

export interface PatientIdentityDocumentState {
  status: PatientIdentityDocumentStatus;
  document: {
    id: number;
    originalFilename: string;
    mimeType: string;
    uploadedAt: string;
    verifiedAt: string | null;
    verifiedByUserId: number | null;
    verifiedByName: string | null;
  } | null;
}

interface IdentityDocumentQueryRow {
  id: number;
  patient_id: number;
  original_filename: string;
  mime_type: string;
  created_at: string | Date;
  identity_verified_at: string | Date | null;
  identity_verified_by_user_id: number | string | null;
  verified_by_name: string | null;
  document_type: string;
  appointment_id: number | null;
  v2_booking_id: number | null;
  incident_id: number | null;
}

const latestIdentityDocumentSql = `
  select
    d.id,
    d.patient_id,
    d.original_filename,
    d.mime_type,
    d.created_at,
    d.identity_verified_at,
    d.identity_verified_by_user_id,
    u.full_name as verified_by_name,
    d.document_type,
    d.appointment_id,
    d.v2_booking_id,
    d.incident_id
  from documents d
  left join users u
    on u.id = d.identity_verified_by_user_id
  where d.patient_id = $1
    and d.document_type = 'patient_identity_document'
    and d.appointment_id is null
    and d.v2_booking_id is null
    and d.incident_id is null
  order by d.created_at desc, d.id desc
  limit 1
`;
const latestIdentityDocumentForUpdateSql = `${latestIdentityDocumentSql}\nfor update of d`;

function toIsoTimestamp(value: string | Date): string {
  return new Date(value).toISOString();
}

function toState(document: IdentityDocumentQueryRow | undefined): PatientIdentityDocumentState {
  if (!document) {
    return { status: "not_uploaded", document: null };
  }

  return {
    status: document.identity_verified_at ? "verified" : "pending",
    document: {
      id: Number(document.id),
      originalFilename: document.original_filename,
      mimeType: document.mime_type,
      uploadedAt: toIsoTimestamp(document.created_at),
      verifiedAt: document.identity_verified_at ? toIsoTimestamp(document.identity_verified_at) : null,
      verifiedByUserId: document.identity_verified_by_user_id == null ? null : Number(document.identity_verified_by_user_id),
      verifiedByName: document.verified_by_name ?? null,
    },
  };
}

async function requirePatient(patientId: number, executor: { query: typeof pool.query }): Promise<void> {
  const result = await executor.query("select id from patients where id = $1 limit 1", [patientId]);
  if (result.rowCount !== 1) throw new HttpError(404, "Patient not found.");
}

export async function getPatientIdentityDocumentState(
  patientId: number
): Promise<PatientIdentityDocumentState> {
  const cleanPatientId = normalizePositiveInteger(patientId, "patientId") as number;
  await requirePatient(cleanPatientId, pool);
  const result = await pool.query<IdentityDocumentQueryRow>(latestIdentityDocumentSql, [cleanPatientId]);
  return toState(result.rows[0]);
}

export async function verifyPatientIdentityDocument(
  patientId: number,
  documentId: number,
  userId: number
): Promise<PatientIdentityDocumentState> {
  const cleanPatientId = normalizePositiveInteger(patientId, "patientId") as number;
  const cleanDocumentId = normalizePositiveInteger(documentId, "documentId") as number;
  const cleanUserId = normalizePositiveInteger(userId, "userId") as number;
  const client = await pool.connect();

  try {
    await client.query("begin");
    const patientLock = await client.query("select id from patients where id = $1 for update", [cleanPatientId]);
    if (patientLock.rowCount !== 1) throw new HttpError(404, "Patient not found.");

    const latestResult = await client.query<IdentityDocumentQueryRow>(latestIdentityDocumentForUpdateSql, [cleanPatientId]);
    const latest = latestResult.rows[0];
    if (!latest) throw new HttpError(404, "No patient identity document has been uploaded.");

    const selectedResult = await client.query<IdentityDocumentQueryRow>(
      `
        select
          d.id,
          d.patient_id,
          d.original_filename,
          d.mime_type,
          d.created_at,
          d.identity_verified_at,
          d.identity_verified_by_user_id,
          u.full_name as verified_by_name,
          d.document_type,
          d.appointment_id,
          d.v2_booking_id,
          d.incident_id
        from documents d
        left join users u on u.id = d.identity_verified_by_user_id
        where d.id = $1
        for update of d
      `,
      [cleanDocumentId]
    );
    const selected = selectedResult.rows[0];
    if (!selected || Number(selected.patient_id) !== cleanPatientId) {
      throw new HttpError(409, "The identity document does not belong to this patient.");
    }
    if (selected.document_type !== "patient_identity_document") {
      throw new HttpError(400, "The selected document is not a patient identity document.");
    }
    if (selected.appointment_id != null || selected.v2_booking_id != null || selected.incident_id != null) {
      throw new HttpError(400, "Patient identity documents cannot reference an appointment or incident.");
    }
    if (Number(latest.id) !== cleanDocumentId) {
      throw new HttpError(409, "Only the most recently uploaded identity document can be verified.");
    }

    const document = await getDocumentById(cleanDocumentId, client);
    let content: Buffer;
    try {
      content = await readDocumentContent(document);
    } catch {
      throw new HttpError(422, "The identity document file is unavailable or unreadable.");
    }
    if (content.length === 0) {
      throw new HttpError(422, "The identity document file is empty.");
    }

    await client.query(
      `
        update documents
        set
          identity_verified_at = null,
          identity_verified_by_user_id = null
        where patient_id = $1
          and document_type = 'patient_identity_document'
          and identity_verified_at is not null
      `,
      [cleanPatientId]
    );
    const verified = await client.query(
      `
        update documents
        set
          identity_verified_at = now(),
          identity_verified_by_user_id = $2
        where id = $1
          and document_type = 'patient_identity_document'
        returning identity_verified_at
      `,
      [cleanDocumentId, cleanUserId]
    );
    if (verified.rowCount !== 1) throw new HttpError(409, "The identity document could not be verified.");

    await logAuditEntry(
      {
        entityType: "patient_identity_document",
        entityId: cleanDocumentId,
        actionType: "identity_verified",
        oldValues: null,
        newValues: { patientId: cleanPatientId, documentId: cleanDocumentId },
        changedByUserId: cleanUserId,
      },
      client
    );
    await client.query("commit");
    return getPatientIdentityDocumentState(cleanPatientId);
  } catch (error) {
    await client.query("rollback").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

export async function revokePatientIdentityDocumentVerification(
  patientId: number,
  userId: number
): Promise<PatientIdentityDocumentState> {
  const cleanPatientId = normalizePositiveInteger(patientId, "patientId") as number;
  const cleanUserId = normalizePositiveInteger(userId, "userId") as number;
  const client = await pool.connect();

  try {
    await client.query("begin");
    const patientLock = await client.query("select id from patients where id = $1 for update", [cleanPatientId]);
    if (patientLock.rowCount !== 1) throw new HttpError(404, "Patient not found.");
    const revoked = await client.query<{ id: number }>(
      `
        update documents
        set
          identity_verified_at = null,
          identity_verified_by_user_id = null
        where patient_id = $1
          and document_type = 'patient_identity_document'
          and identity_verified_at is not null
        returning id
      `,
      [cleanPatientId]
    );
    for (const row of revoked.rows) {
      await logAuditEntry(
        {
          entityType: "patient_identity_document",
          entityId: Number(row.id),
          actionType: "identity_verification_revoked",
          oldValues: { patientId: cleanPatientId, documentId: Number(row.id) },
          newValues: null,
          changedByUserId: cleanUserId,
        },
        client
      );
    }
    await client.query("commit");
    return getPatientIdentityDocumentState(cleanPatientId);
  } catch (error) {
    await client.query("rollback").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

export async function getVerifiedPatientIds(patientIds: number[]): Promise<Set<number>> {
  if (patientIds.length === 0) return new Set<number>();
  const cleanPatientIds = patientIds.map((patientId) => normalizePositiveInteger(patientId, "patientId") as number);
  const result = await pool.query<{ patient_id: number | string }>(
    `
      select distinct patient_id
      from documents
      where patient_id = any($1::bigint[])
        and document_type = 'patient_identity_document'
        and identity_verified_at is not null
    `,
    [cleanPatientIds]
  );
  return new Set(result.rows.map((row) => Number(row.patient_id)));
}
