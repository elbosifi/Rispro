import type { PoolClient } from "pg";
import { pool } from "../../../db/pool.js";

export type TeachingImportBatchStatus = "uploaded" | "inspected" | "invalid" | "validated" | "confirmed" | "failed" | "expired";
export type TeachingImportInputType = "json" | "zip";

export interface TeachingImportBatch {
  id: string;
  uploaded_by_identity_issuer: string;
  uploaded_by_identity_subject: string;
  original_filename: string;
  input_type: TeachingImportInputType;
  schema_version: string | null;
  status: TeachingImportBatchStatus;
  question_count: number;
  case_count: number;
  asset_count: number;
  validation_summary_json: Record<string, unknown>;
  payload_json: unknown | null;
  expires_at: Date;
  created_at: Date;
  inspected_at: Date | null;
  validated_at: Date | null;
  confirmed_at: Date | null;
  confirmed_by_identity_issuer: string | null;
  confirmed_by_identity_subject: string | null;
  failure_message: string | null;
}

const BATCH_COLUMNS = `id, uploaded_by_identity_issuer, uploaded_by_identity_subject, original_filename, input_type,
  schema_version, status, question_count, case_count, asset_count, validation_summary_json, payload_json,
  expires_at, created_at, inspected_at, validated_at, confirmed_at,
  confirmed_by_identity_issuer, confirmed_by_identity_subject, failure_message`;

export async function getTeachingImportBatch(batchId: string, client?: PoolClient, forUpdate = false): Promise<TeachingImportBatch | null> {
  const sql = `select ${BATCH_COLUMNS} from teaching.import_batches where id = $1${forUpdate ? " for update" : ""}`;
  const result = client ? await client.query<TeachingImportBatch>(sql, [batchId]) : await pool.query<TeachingImportBatch>(sql, [batchId]);
  return result.rows[0] ?? null;
}

export async function createTeachingImportBatch(
  batch: {
    id: string;
    actor: { identityIssuer: string; identitySubject: string };
    filename: string;
    inputType: TeachingImportInputType;
    schemaVersion: string | null;
    status: TeachingImportBatchStatus;
    questionCount: number;
    caseCount: number;
    assetCount: number;
    summary: Record<string, unknown>;
    payload: unknown | null;
  },
): Promise<void> {
  await pool.query(
    `insert into teaching.import_batches (
       id, uploaded_by_identity_issuer, uploaded_by_identity_subject, original_filename, input_type,
       schema_version, status, question_count, case_count, asset_count, validation_summary_json, payload_json,
       inspected_at, validated_at, failure_message
     ) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11::jsonb,$12::jsonb,now(),case when $7 = 'validated' then now() else null end,
       case when $7 = 'invalid' then 'Validation failed; inspect the stored issue summary.' else null end)`,
    [batch.id, batch.actor.identityIssuer, batch.actor.identitySubject, batch.filename, batch.inputType,
      batch.schemaVersion, batch.status, batch.questionCount, batch.caseCount, batch.assetCount,
      JSON.stringify(batch.summary), batch.payload === null ? null : JSON.stringify(batch.payload)],
  );
}

export async function listTeachingImportBatches(limit: number, offset: number) {
  const [count, rows] = await Promise.all([
    pool.query<{ total: string }>("select count(*)::text as total from teaching.import_batches"),
    pool.query<TeachingImportBatch>(
      `select ${BATCH_COLUMNS.replace(", payload_json", ", null::jsonb as payload_json")}
       from teaching.import_batches order by created_at desc, id desc limit $1 offset $2`,
      [limit, offset],
    ),
  ]);
  return {
    items: rows.rows.map(({ payload_json: _payload, validation_summary_json: validation, uploaded_by_identity_issuer: issuer, uploaded_by_identity_subject: subject, ...row }) => ({
      ...row,
      validation_summary_json: withoutQuestionPreview(validation),
      uploadedBy: { identityIssuer: issuer, identitySubject: subject },
    })),
    pagination: { limit, offset, total: Number(count.rows[0]?.total ?? 0) },
  };
}

function withoutQuestionPreview(summary: Record<string, unknown>): Record<string, unknown> {
  const { questions: _questionPreview, ...auditSummary } = summary;
  return auditSummary;
}

export function toTeachingImportBatchDto(batch: TeachingImportBatch) {
  return {
    id: batch.id,
    originalFilename: batch.original_filename,
    inputType: batch.input_type,
    schemaVersion: batch.schema_version,
    status: batch.status,
    questionCount: batch.question_count,
    caseCount: batch.case_count,
    assetCount: batch.asset_count,
    validation: withoutQuestionPreview(batch.validation_summary_json),
    uploader: { identityIssuer: batch.uploaded_by_identity_issuer, identitySubject: batch.uploaded_by_identity_subject },
    createdAt: batch.created_at,
    expiresAt: batch.expires_at,
    inspectedAt: batch.inspected_at,
    validatedAt: batch.validated_at,
    confirmedAt: batch.confirmed_at,
    confirmedBy: batch.confirmed_by_identity_subject === null ? null : {
      identityIssuer: batch.confirmed_by_identity_issuer,
      identitySubject: batch.confirmed_by_identity_subject,
    },
    failureMessage: batch.failure_message,
  };
}
