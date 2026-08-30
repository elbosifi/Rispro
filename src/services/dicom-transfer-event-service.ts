import { createHash } from "node:crypto";
import { pool } from "../db/pool.js";
import { HttpError } from "../utils/http-error.js";
import { normalizeOptionalText } from "../utils/normalize.js";

const AUTHORITATIVE_ORTHANC_AET = "ORTHANCPG";

export type DicomTransferEvent = {
  id: number;
  direction: "RECEIVED" | "SENT";
  status: "ACTIVE" | "SUCCESS" | "FAILED";
  patient_id: string | null;
  patient_name: string | null;
  accession_number: string | null;
  study_instance_uid: string;
  study_description: string | null;
  source_aet: string | null;
  source_ip: string | null;
  destination_aet: string | null;
  instance_count: number | null;
  first_seen_at: string;
  last_seen_at: string;
  completed_at: string | null;
  error_code: string | null;
  error_message: string | null;
  orthanc_job_id: string | null;
  created_at: string;
  updated_at: string;
};

export type RecordInboundDicomReceptionInput = {
  patientId?: unknown;
  patientName?: unknown;
  accessionNumber?: unknown;
  studyInstanceUid?: unknown;
  studyDescription?: unknown;
  sourceAet?: unknown;
  sourceIp?: unknown;
  instanceCount?: unknown;
  firstSeenAt?: unknown;
  lastSeenAt?: unknown;
  completedAt?: unknown;
};

export type RecordInboundDicomReceptionResult = {
  event: DicomTransferEvent;
  deduplicated: boolean;
};

function optionalText(value: unknown, field: string, maximumLength = 1_000): string | null {
  const normalized = normalizeOptionalText(value);
  if (!normalized) return null;
  if (normalized.length > maximumLength) throw new HttpError(400, `${field} must not exceed ${maximumLength} characters.`);
  return normalized;
}

function requiredText(value: unknown, field: string, maximumLength = 1_000): string {
  const normalized = optionalText(value, field, maximumLength);
  if (!normalized) throw new HttpError(400, `${field} is required.`);
  return normalized;
}

function optionalTimestamp(value: unknown, field: string): string | null {
  if (value == null || value === "") return null;
  const parsed = new Date(String(value));
  if (Number.isNaN(parsed.getTime())) throw new HttpError(400, `${field} must be a valid timestamp.`);
  return parsed.toISOString();
}

function optionalInstanceCount(value: unknown): number | null {
  if (value == null || value === "") return null;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 0) throw new HttpError(400, "instanceCount must be a non-negative whole number.");
  return parsed;
}

function inboundIdempotencyKey(input: {
  patientId: string | null;
  patientName: string | null;
  accessionNumber: string | null;
  studyInstanceUid: string;
  studyDescription: string | null;
  sourceAet: string | null;
  sourceIp: string | null;
  instanceCount: number | null;
  completedAt: string | null;
}): string | null {
  if (!input.completedAt) return null;
  return createHash("sha256")
    .update(["RECEIVED", input.patientId, input.patientName, input.accessionNumber, input.studyInstanceUid, input.studyDescription, input.sourceAet, input.sourceIp, input.instanceCount, input.completedAt].map((value) => value ?? "").join("\u0000"))
    .digest("hex");
}

export async function recordInboundDicomReception(input: RecordInboundDicomReceptionInput): Promise<RecordInboundDicomReceptionResult> {
  const patientId = optionalText(input.patientId, "patientId");
  const patientName = optionalText(input.patientName, "patientName");
  const accessionNumber = optionalText(input.accessionNumber, "accessionNumber");
  const studyInstanceUid = requiredText(input.studyInstanceUid, "studyInstanceUid");
  const studyDescription = optionalText(input.studyDescription, "studyDescription");
  const sourceAet = optionalText(input.sourceAet, "sourceAet")?.toUpperCase() ?? null;
  const sourceIp = optionalText(input.sourceIp, "sourceIp", 128);
  const instanceCount = optionalInstanceCount(input.instanceCount);
  const firstSeenAt = optionalTimestamp(input.firstSeenAt, "firstSeenAt") ?? new Date().toISOString();
  const lastSeenAt = optionalTimestamp(input.lastSeenAt, "lastSeenAt") ?? firstSeenAt;
  const completedAt = optionalTimestamp(input.completedAt, "completedAt") ?? lastSeenAt;
  const idempotencyKey = inboundIdempotencyKey({ patientId, patientName, accessionNumber, studyInstanceUid, studyDescription, sourceAet, sourceIp, instanceCount, completedAt: input.completedAt == null || input.completedAt === "" ? null : completedAt });
  const values = [patientId, patientName, accessionNumber, studyInstanceUid, studyDescription, sourceAet, sourceIp, instanceCount, firstSeenAt, lastSeenAt, completedAt, idempotencyKey];
  const inserted = await pool.query<DicomTransferEvent>(`
    insert into dicom_transfer_events (
      direction,status,patient_id,patient_name,accession_number,study_instance_uid,study_description,
      source_aet,source_ip,destination_aet,instance_count,first_seen_at,last_seen_at,completed_at,idempotency_key
    ) values (
      'RECEIVED','SUCCESS',$1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13
    )
    on conflict (idempotency_key) where idempotency_key is not null do nothing
    returning *
  `, [...values.slice(0, 7), AUTHORITATIVE_ORTHANC_AET, ...values.slice(7)]);
  if (inserted.rows[0]) return { event: inserted.rows[0], deduplicated: false };

  const existing = await pool.query<DicomTransferEvent>("select * from dicom_transfer_events where idempotency_key=$1", [idempotencyKey]);
  if (!existing.rows[0]) throw new HttpError(409, "A DICOM reception event could not be recorded safely.");
  return { event: existing.rows[0], deduplicated: true };
}
