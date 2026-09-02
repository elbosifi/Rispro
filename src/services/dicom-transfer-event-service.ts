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
  orthanc_change_sequence: number | null;
  orthanc_resource_id: string | null;
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
  destinationAet?: unknown;
  instanceCount?: unknown;
  firstSeenAt?: unknown;
  lastSeenAt?: unknown;
  completedAt?: unknown;
  orthancChangeSequence?: unknown;
  orthancResourceId?: unknown;
};

export type RecordInboundDicomReceptionResult = {
  event: DicomTransferEvent;
  deduplicated: boolean;
};

export type DicomTransferHistoryDirection = "all" | "received" | "sent";
export type DicomTransferHistoryStatus = "all" | "active" | "successful" | "failed";
export type DicomTransferHistoryPageSize = 25 | 50 | 100;

export type ListDicomTransferHistoryInput = {
  direction?: unknown;
  status?: unknown;
  search?: unknown;
  source?: unknown;
  destination?: unknown;
  from?: unknown;
  to?: unknown;
  page?: unknown;
  pageSize?: unknown;
};

export type DicomTransferHistoryItem = {
  id: string;
  direction: "RECEIVED" | "SENT";
  status: "ACTIVE" | "SUCCESS" | "FAILED";
  patientId: string | null;
  patientName: string | null;
  accessionNumber: string | null;
  studyInstanceUid: string;
  studyDescription: string | null;
  sourceAet: string | null;
  sourceIp: string | null;
  destinationAet: string | null;
  instanceCount: number | null;
  firstSeenAt: string;
  lastSeenAt: string;
  completedAt: string | null;
  occurredAt: string;
  errorCode: string | null;
  errorMessage: string | null;
  orthancJobId: string | null;
  orthancChangeSequence: number | null;
  orthancResourceId: string | null;
  createdAt: string;
  updatedAt: string;
};

export type DicomTransferHistoryResponse = {
  items: DicomTransferHistoryItem[];
  page: number;
  pageSize: DicomTransferHistoryPageSize;
  total: number;
  totalPages: number;
};

type DicomTransferHistoryDbRow = {
  id: string | number | bigint;
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
  first_seen_at: string | Date;
  last_seen_at: string | Date;
  completed_at: string | Date | null;
  error_code: string | null;
  error_message: string | null;
  orthanc_job_id: string | null;
  orthanc_change_sequence: string | number | bigint | null;
  orthanc_resource_id: string | null;
  created_at: string | Date;
  updated_at: string | Date;
  occurred_at: string | Date;
};

const DICOM_TRANSFER_HISTORY_PAGE_SIZES = [25, 50, 100] as const;
const DICOM_TRANSFER_HISTORY_DIRECTIONS = ["all", "received", "sent"] as const;
const DICOM_TRANSFER_HISTORY_STATUSES = ["all", "active", "successful", "failed"] as const;
const DICOM_TRANSFER_HISTORY_OCCURRED_AT_SQL = "coalesce(completed_at, last_seen_at, first_seen_at, created_at)";
const DICOM_TRANSFER_HISTORY_LIKE_ESCAPE_SQL = "E'\\\\'";

function queryScalarText(value: unknown, field: string): string | null {
  if (value == null || value === "") return null;
  if (typeof value !== "string") throw new HttpError(400, `${field} must be a single value.`);
  const normalized = value.trim();
  return normalized || null;
}

function normalizeHistoryTextFilter(value: unknown, field: string, maximumLength: number): string | null {
  const normalized = queryScalarText(value, field);
  if (normalized && normalized.length > maximumLength) throw new HttpError(400, `${field} must not exceed ${maximumLength} characters.`);
  return normalized;
}

function normalizeHistoryDirection(value: unknown): DicomTransferHistoryDirection {
  const normalized = queryScalarText(value, "direction") ?? "all";
  if (!DICOM_TRANSFER_HISTORY_DIRECTIONS.includes(normalized as DicomTransferHistoryDirection)) throw new HttpError(400, "direction must be all, received, or sent.");
  return normalized as DicomTransferHistoryDirection;
}

function normalizeHistoryStatus(value: unknown): DicomTransferHistoryStatus {
  const normalized = queryScalarText(value, "status") ?? "all";
  if (!DICOM_TRANSFER_HISTORY_STATUSES.includes(normalized as DicomTransferHistoryStatus)) throw new HttpError(400, "status must be all, active, successful, or failed.");
  return normalized as DicomTransferHistoryStatus;
}

function normalizeHistoryInteger(value: unknown, field: string, defaultValue: number): number {
  if (value == null || value === "") return defaultValue;
  let normalized: string | number;
  if (typeof value === "string") {
    normalized = value.trim();
    if (!normalized) return defaultValue;
    if (!/^\d+$/.test(normalized)) throw new HttpError(400, `${field} must be a positive integer.`);
  } else if (typeof value === "number") {
    normalized = value;
  } else {
    throw new HttpError(400, `${field} must be a positive integer.`);
  }
  const parsed = Number(normalized);
  if (!Number.isSafeInteger(parsed) || parsed < 1) throw new HttpError(400, `${field} must be a positive integer.`);
  return parsed;
}

function normalizeHistoryPageSize(value: unknown): DicomTransferHistoryPageSize {
  const parsed = normalizeHistoryInteger(value, "pageSize", 25);
  if (!DICOM_TRANSFER_HISTORY_PAGE_SIZES.includes(parsed as DicomTransferHistoryPageSize)) throw new HttpError(400, "pageSize must be one of 25, 50, or 100.");
  return parsed as DicomTransferHistoryPageSize;
}

function normalizeHistoryTimestamp(value: unknown, field: string): { iso: string; milliseconds: number } | null {
  const normalized = queryScalarText(value, field);
  if (!normalized) return null;
  const parsed = new Date(normalized);
  if (Number.isNaN(parsed.getTime())) throw new HttpError(400, `${field} must be a valid ISO timestamp.`);
  return { iso: parsed.toISOString(), milliseconds: parsed.getTime() };
}

function escapeHistoryLikeLiteral(value: string): string {
  return value.replaceAll("\\", "\\\\").replaceAll("%", "\\%").replaceAll("_", "\\_");
}

function buildDicomTransferHistoryWhere(input: {
  direction: DicomTransferHistoryDirection;
  status: DicomTransferHistoryStatus;
  search: string | null;
  source: string | null;
  destination: string | null;
  from: string | null;
  to: string | null;
}): { whereClause: string; params: unknown[] } {
  const clauses: string[] = [];
  const params: unknown[] = [];
  const add = (value: unknown): string => {
    params.push(value);
    return `$${params.length}`;
  };
  if (input.direction !== "all") clauses.push(`direction = ${add(input.direction === "received" ? "RECEIVED" : "SENT")}`);
  if (input.status !== "all") {
    const status = input.status === "active" ? "ACTIVE" : input.status === "successful" ? "SUCCESS" : "FAILED";
    clauses.push(`status = ${add(status)}`);
  }
  if (input.search) {
    const pattern = add(`%${escapeHistoryLikeLiteral(input.search)}%`);
    clauses.push(`(
      coalesce(patient_name, '') ilike ${pattern} escape ${DICOM_TRANSFER_HISTORY_LIKE_ESCAPE_SQL}
      or coalesce(patient_id, '') ilike ${pattern} escape ${DICOM_TRANSFER_HISTORY_LIKE_ESCAPE_SQL}
      or coalesce(accession_number, '') ilike ${pattern} escape ${DICOM_TRANSFER_HISTORY_LIKE_ESCAPE_SQL}
      or coalesce(study_instance_uid, '') ilike ${pattern} escape ${DICOM_TRANSFER_HISTORY_LIKE_ESCAPE_SQL}
    )`);
  }
  if (input.source) {
    const pattern = add(`%${escapeHistoryLikeLiteral(input.source)}%`);
    clauses.push(`(
      coalesce(source_aet, '') ilike ${pattern} escape ${DICOM_TRANSFER_HISTORY_LIKE_ESCAPE_SQL}
      or coalesce(source_ip, '') ilike ${pattern} escape ${DICOM_TRANSFER_HISTORY_LIKE_ESCAPE_SQL}
    )`);
  }
  if (input.destination) {
    const pattern = add(`%${escapeHistoryLikeLiteral(input.destination)}%`);
    clauses.push(`coalesce(destination_aet, '') ilike ${pattern} escape ${DICOM_TRANSFER_HISTORY_LIKE_ESCAPE_SQL}`);
  }
  if (input.from) clauses.push(`${DICOM_TRANSFER_HISTORY_OCCURRED_AT_SQL} >= ${add(input.from)}::timestamptz`);
  if (input.to) clauses.push(`${DICOM_TRANSFER_HISTORY_OCCURRED_AT_SQL} <= ${add(input.to)}::timestamptz`);
  return { whereClause: clauses.length ? `where ${clauses.join(" and ")}` : "", params };
}

function historyTimestampToIso(value: string | Date): string {
  const parsed = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(parsed.getTime())) throw new Error("Invalid DICOM transfer event timestamp returned by the database.");
  return parsed.toISOString();
}

function historyNullableTimestampToIso(value: string | Date | null): string | null {
  return value == null ? null : historyTimestampToIso(value);
}

function dicomTransferHistoryRowToApi(row: DicomTransferHistoryDbRow): DicomTransferHistoryItem {
  return {
    id: String(row.id),
    direction: row.direction,
    status: row.status,
    patientId: row.patient_id,
    patientName: row.patient_name,
    accessionNumber: row.accession_number,
    studyInstanceUid: row.study_instance_uid,
    studyDescription: row.study_description,
    sourceAet: row.source_aet,
    sourceIp: row.source_ip,
    destinationAet: row.destination_aet,
    instanceCount: row.instance_count,
    firstSeenAt: historyTimestampToIso(row.first_seen_at),
    lastSeenAt: historyTimestampToIso(row.last_seen_at),
    completedAt: historyNullableTimestampToIso(row.completed_at),
    occurredAt: historyTimestampToIso(row.occurred_at),
    errorCode: row.error_code,
    errorMessage: row.error_message,
    orthancJobId: row.orthanc_job_id,
    orthancChangeSequence: row.orthanc_change_sequence == null ? null : Number(row.orthanc_change_sequence),
    orthancResourceId: row.orthanc_resource_id,
    createdAt: historyTimestampToIso(row.created_at),
    updatedAt: historyTimestampToIso(row.updated_at)
  };
}

export async function listDicomTransferHistory(input: ListDicomTransferHistoryInput = {}): Promise<DicomTransferHistoryResponse> {
  const direction = normalizeHistoryDirection(input.direction);
  const status = normalizeHistoryStatus(input.status);
  const search = normalizeHistoryTextFilter(input.search, "search", 200);
  const source = normalizeHistoryTextFilter(input.source, "source", 128);
  const destination = normalizeHistoryTextFilter(input.destination, "destination", 128);
  const fromTimestamp = normalizeHistoryTimestamp(input.from, "from");
  const toTimestamp = normalizeHistoryTimestamp(input.to, "to");
  if (fromTimestamp && toTimestamp && fromTimestamp.milliseconds > toTimestamp.milliseconds) throw new HttpError(400, "from cannot be later than to.");
  const page = normalizeHistoryInteger(input.page, "page", 1);
  const pageSize = normalizeHistoryPageSize(input.pageSize);
  const offset = (page - 1) * pageSize;
  if (!Number.isSafeInteger(offset)) throw new HttpError(400, "page is too large.");
  const { whereClause, params } = buildDicomTransferHistoryWhere({
    direction,
    status,
    search,
    source,
    destination,
    from: fromTimestamp?.iso ?? null,
    to: toTimestamp?.iso ?? null
  });
  const countResult = await pool.query<{ total: string }>(`select count(*)::text as total from dicom_transfer_events ${whereClause}`, params);
  const total = Number(countResult.rows[0]?.total ?? "0");
  const pageParams = [...params, pageSize, offset];
  const pageResult = await pool.query<DicomTransferHistoryDbRow>(
    `select id, direction, status, patient_id, patient_name, accession_number, study_instance_uid, study_description,
      source_aet, source_ip, destination_aet, instance_count, first_seen_at, last_seen_at, completed_at,
      error_code, error_message, orthanc_job_id, orthanc_change_sequence, orthanc_resource_id,
      created_at, updated_at, ${DICOM_TRANSFER_HISTORY_OCCURRED_AT_SQL} as occurred_at
     from dicom_transfer_events
     ${whereClause}
     order by occurred_at desc, id desc
     limit $${pageParams.length - 1} offset $${pageParams.length}`,
    pageParams
  );
  return {
    items: pageResult.rows.map(dicomTransferHistoryRowToApi),
    page,
    pageSize,
    total,
    totalPages: total === 0 ? 0 : Math.ceil(total / pageSize)
  };
}

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
  destinationAet: string | null;
  instanceCount: number | null;
  completedAt: string | null;
  orthancChangeSequence: number | null;
  orthancResourceId: string | null;
}): string | null {
  if (input.orthancChangeSequence != null) {
    return createHash("sha256")
      .update(["RECEIVED", "orthanc-change", input.orthancChangeSequence, input.sourceAet, input.sourceIp, input.destinationAet].map((value) => value ?? "").join("\u0000"))
      .digest("hex");
  }
  if (!input.completedAt) return null;
  return createHash("sha256")
    .update(["RECEIVED", input.patientId, input.patientName, input.accessionNumber, input.studyInstanceUid, input.studyDescription, input.sourceAet, input.sourceIp, input.instanceCount, input.completedAt].map((value) => value ?? "").join("\u0000"))
    .digest("hex");
}

function optionalChangeSequence(value: unknown): number | null {
  if (value == null || value === "") return null;
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 0) throw new HttpError(400, "orthancChangeSequence must be a non-negative whole number.");
  return parsed;
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
  const orthancChangeSequence = optionalChangeSequence(input.orthancChangeSequence);
  const orthancResourceId = optionalText(input.orthancResourceId, "orthancResourceId", 256);
  const destinationAet = optionalText(input.destinationAet, "destinationAet")?.toUpperCase() ?? AUTHORITATIVE_ORTHANC_AET;
  const idempotencyKey = inboundIdempotencyKey({ patientId, patientName, accessionNumber, studyInstanceUid, studyDescription, sourceAet, sourceIp, destinationAet, instanceCount, completedAt: input.completedAt == null || input.completedAt === "" ? null : completedAt, orthancChangeSequence, orthancResourceId });
  const values = [patientId, patientName, accessionNumber, studyInstanceUid, studyDescription, sourceAet, sourceIp, destinationAet, instanceCount, firstSeenAt, lastSeenAt, completedAt, orthancChangeSequence, orthancResourceId, idempotencyKey];
  const inserted = await pool.query<DicomTransferEvent>(`
    insert into dicom_transfer_events (
      direction,status,patient_id,patient_name,accession_number,study_instance_uid,study_description,
      source_aet,source_ip,destination_aet,instance_count,first_seen_at,last_seen_at,completed_at,
      orthanc_change_sequence,orthanc_resource_id,idempotency_key
    ) values (
      'RECEIVED','SUCCESS',$1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15
    )
    on conflict (idempotency_key) where idempotency_key is not null do nothing
    returning *
  `, values);
  if (inserted.rows[0]) return { event: inserted.rows[0], deduplicated: false };

  const existing = await pool.query<DicomTransferEvent>("select * from dicom_transfer_events where idempotency_key=$1", [idempotencyKey]);
  if (!existing.rows[0]) throw new HttpError(409, "A DICOM reception event could not be recorded safely.");
  return { event: existing.rows[0], deduplicated: true };
}
