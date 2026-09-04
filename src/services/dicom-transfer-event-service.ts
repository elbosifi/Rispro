import { createHash } from "node:crypto";
import { pool } from "../db/pool.js";
import { HttpError } from "../utils/http-error.js";
import { normalizeOptionalText } from "../utils/normalize.js";
import { redactDiagnosticText } from "./system-diagnostics-service.js";

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

export type RecordOutboundDicomTransferInput = {
  orthancJobId?: unknown;
  patientId?: unknown;
  patientName?: unknown;
  accessionNumber?: unknown;
  studyInstanceUid?: unknown;
  studyDescription?: unknown;
  sourceAet?: unknown;
  destinationAet?: unknown;
  instanceCount?: unknown;
  status?: unknown;
  firstSeenAt?: unknown;
  lastSeenAt?: unknown;
  completedAt?: unknown;
  errorCode?: unknown;
  errorMessage?: unknown;
  orthancResourceId?: unknown;
};

export type RecordOutboundDicomTransferResult = {
  event: DicomTransferEvent;
};

export type DicomTransferHistoryDirection = "all" | "received" | "sent";
export type DicomTransferHistoryStatus = "all" | "active" | "successful" | "failed";
export type DicomTransferHistoryPageSize = 25 | 50 | 100;
export type DicomTransferHistoryView = "transfers" | "studies";

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
  view?: unknown;
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

export type DicomTransferStudyHistoryItem = {
  studyInstanceUid: string;
  patientId: string | null;
  patientName: string | null;
  accessionNumber: string | null;
  studyDescription: string | null;
  received: {
    count: number;
    successful: number;
    active: number;
    failed: number;
    sources: string[];
    latestAt: string | null;
  };
  sent: {
    count: number;
    successful: number;
    active: number;
    failed: number;
    destinations: string[];
    latestAt: string | null;
  };
  eventCount: number;
  firstActivityAt: string;
  lastActivityAt: string;
};

export type DicomTransferStudyHistoryResponse = {
  items: DicomTransferStudyHistoryItem[];
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

type DicomTransferStudyHistoryDbRow = {
  study_instance_uid: string;
  patient_id: string | null;
  patient_name: string | null;
  accession_number: string | null;
  study_description: string | null;
  received_count: string | number | bigint;
  received_successful: string | number | bigint;
  received_active: string | number | bigint;
  received_failed: string | number | bigint;
  received_sources: string[];
  received_latest_at: string | Date | null;
  sent_count: string | number | bigint;
  sent_successful: string | number | bigint;
  sent_active: string | number | bigint;
  sent_failed: string | number | bigint;
  sent_destinations: string[];
  sent_latest_at: string | Date | null;
  event_count: string | number | bigint;
  first_activity_at: string | Date;
  last_activity_at: string | Date;
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

function normalizeHistoryView(value: unknown): DicomTransferHistoryView {
  const normalized = queryScalarText(value, "view") ?? "transfers";
  if (normalized !== "transfers" && normalized !== "studies") throw new HttpError(400, "view must be transfers or studies.");
  return normalized;
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

function historyCountToNumber(value: string | number | bigint): number {
  return Number(value);
}

function dicomTransferStudyHistoryRowToApi(row: DicomTransferStudyHistoryDbRow): DicomTransferStudyHistoryItem {
  return {
    studyInstanceUid: row.study_instance_uid,
    patientId: row.patient_id,
    patientName: row.patient_name,
    accessionNumber: row.accession_number,
    studyDescription: row.study_description,
    received: {
      count: historyCountToNumber(row.received_count),
      successful: historyCountToNumber(row.received_successful),
      active: historyCountToNumber(row.received_active),
      failed: historyCountToNumber(row.received_failed),
      sources: row.received_sources,
      latestAt: historyNullableTimestampToIso(row.received_latest_at)
    },
    sent: {
      count: historyCountToNumber(row.sent_count),
      successful: historyCountToNumber(row.sent_successful),
      active: historyCountToNumber(row.sent_active),
      failed: historyCountToNumber(row.sent_failed),
      destinations: row.sent_destinations,
      latestAt: historyNullableTimestampToIso(row.sent_latest_at)
    },
    eventCount: historyCountToNumber(row.event_count),
    firstActivityAt: historyTimestampToIso(row.first_activity_at),
    lastActivityAt: historyTimestampToIso(row.last_activity_at)
  };
}

type ListDicomTransferHistoryTransfersInput = Omit<ListDicomTransferHistoryInput, "view"> & { view?: "transfers" };
type ListDicomTransferHistoryStudiesInput = Omit<ListDicomTransferHistoryInput, "view"> & { view: "studies" };

export function listDicomTransferHistory(input?: ListDicomTransferHistoryTransfersInput): Promise<DicomTransferHistoryResponse>;
export function listDicomTransferHistory(input: ListDicomTransferHistoryStudiesInput): Promise<DicomTransferStudyHistoryResponse>;
export function listDicomTransferHistory(input: ListDicomTransferHistoryInput): Promise<DicomTransferHistoryResponse | DicomTransferStudyHistoryResponse>;
export async function listDicomTransferHistory(input: ListDicomTransferHistoryInput = {}): Promise<DicomTransferHistoryResponse | DicomTransferStudyHistoryResponse> {
  const direction = normalizeHistoryDirection(input.direction);
  const status = normalizeHistoryStatus(input.status);
  const view = normalizeHistoryView(input.view);
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

  if (view === "studies") {
    const countResult = await pool.query<{ total: string }>(`select count(distinct study_instance_uid)::text as total from dicom_transfer_events ${whereClause}`, params);
    const total = Number(countResult.rows[0]?.total ?? "0");
    const pageParams = [...params, pageSize, offset];
    const pageResult = await pool.query<DicomTransferStudyHistoryDbRow>(
      `with filtered as (
         select id, direction, status, patient_id, patient_name, accession_number, study_instance_uid, study_description,
           source_aet, destination_aet, ${DICOM_TRANSFER_HISTORY_OCCURRED_AT_SQL} as occurred_at
         from dicom_transfer_events
         ${whereClause}
       ), grouped as (
         select study_instance_uid,
           (array_agg(patient_id order by occurred_at desc, id desc) filter (where patient_id is not null))[1] as patient_id,
           (array_agg(patient_name order by occurred_at desc, id desc) filter (where patient_name is not null))[1] as patient_name,
           (array_agg(accession_number order by occurred_at desc, id desc) filter (where accession_number is not null))[1] as accession_number,
           (array_agg(study_description order by occurred_at desc, id desc) filter (where study_description is not null))[1] as study_description,
           count(*) filter (where direction = 'RECEIVED')::text as received_count,
           count(*) filter (where direction = 'RECEIVED' and status = 'SUCCESS')::text as received_successful,
           count(*) filter (where direction = 'RECEIVED' and status = 'ACTIVE')::text as received_active,
           count(*) filter (where direction = 'RECEIVED' and status = 'FAILED')::text as received_failed,
           coalesce(array_agg(distinct source_aet order by source_aet) filter (where direction = 'RECEIVED' and source_aet is not null), array[]::text[]) as received_sources,
           max(occurred_at) filter (where direction = 'RECEIVED') as received_latest_at,
           count(*) filter (where direction = 'SENT')::text as sent_count,
           count(*) filter (where direction = 'SENT' and status = 'SUCCESS')::text as sent_successful,
           count(*) filter (where direction = 'SENT' and status = 'ACTIVE')::text as sent_active,
           count(*) filter (where direction = 'SENT' and status = 'FAILED')::text as sent_failed,
           coalesce(array_agg(distinct destination_aet order by destination_aet) filter (where direction = 'SENT' and destination_aet is not null), array[]::text[]) as sent_destinations,
           max(occurred_at) filter (where direction = 'SENT') as sent_latest_at,
           count(*)::text as event_count,
           min(occurred_at) as first_activity_at,
           max(occurred_at) as last_activity_at
         from filtered
         group by study_instance_uid
       )
       select study_instance_uid, patient_id, patient_name, accession_number, study_description,
         received_count, received_successful, received_active, received_failed, received_sources, received_latest_at,
         sent_count, sent_successful, sent_active, sent_failed, sent_destinations, sent_latest_at,
         event_count, first_activity_at, last_activity_at
       from grouped
       order by last_activity_at desc, study_instance_uid desc
       limit $${pageParams.length - 1} offset $${pageParams.length}`,
      pageParams
    );
    return {
      items: pageResult.rows.map(dicomTransferStudyHistoryRowToApi),
      page,
      pageSize,
      total,
      totalPages: total === 0 ? 0 : Math.ceil(total / pageSize)
    };
  }

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

function outboundStatus(value: unknown): "ACTIVE" | "SUCCESS" | "FAILED" {
  const normalized = requiredText(value, "status", 16).toUpperCase();
  if (normalized !== "ACTIVE" && normalized !== "SUCCESS" && normalized !== "FAILED") throw new HttpError(400, "status must be ACTIVE, SUCCESS, or FAILED.");
  return normalized;
}

function boundedDiagnosticText(value: unknown): string | null {
  const normalized = normalizeOptionalText(value);
  if (!normalized) return null;
  return redactDiagnosticText(normalized).replace(/[\r\n\t]+/g, " ").slice(0, 1_000) || null;
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

export async function recordOutboundDicomTransfer(input: RecordOutboundDicomTransferInput): Promise<RecordOutboundDicomTransferResult> {
  const orthancJobId = requiredText(input.orthancJobId, "orthancJobId", 128);
  const patientId = optionalText(input.patientId, "patientId");
  const patientName = optionalText(input.patientName, "patientName");
  const accessionNumber = optionalText(input.accessionNumber, "accessionNumber");
  const studyInstanceUid = requiredText(input.studyInstanceUid, "studyInstanceUid");
  const studyDescription = optionalText(input.studyDescription, "studyDescription");
  const sourceAet = optionalText(input.sourceAet, "sourceAet")?.toUpperCase() ?? null;
  const destinationAet = optionalText(input.destinationAet, "destinationAet")?.toUpperCase() ?? null;
  const instanceCount = optionalInstanceCount(input.instanceCount);
  const status = outboundStatus(input.status);
  const firstSeenAt = optionalTimestamp(input.firstSeenAt, "firstSeenAt") ?? new Date().toISOString();
  const requestedLastSeenAt = optionalTimestamp(input.lastSeenAt, "lastSeenAt") ?? firstSeenAt;
  const requestedCompletedAt = optionalTimestamp(input.completedAt, "completedAt");
  const completedAt = status === "ACTIVE" ? null : requestedCompletedAt ?? requestedLastSeenAt;
  const lastSeenAt = status === "ACTIVE" ? requestedLastSeenAt : completedAt;
  const errorCode = status === "FAILED" ? optionalText(input.errorCode, "errorCode", 128) : null;
  const errorMessage = status === "FAILED" ? boundedDiagnosticText(input.errorMessage) : null;
  const orthancResourceId = optionalText(input.orthancResourceId, "orthancResourceId", 256);
  const inserted = await pool.query<DicomTransferEvent>(`
    insert into dicom_transfer_events (
      direction,status,patient_id,patient_name,accession_number,study_instance_uid,study_description,
      source_aet,source_ip,destination_aet,instance_count,first_seen_at,last_seen_at,completed_at,
      error_code,error_message,orthanc_job_id,orthanc_change_sequence,orthanc_resource_id
    ) values (
      'SENT',$1,$2,$3,$4,$5,$6,$7,null,$8,$9,$10,$11,$12,$13,$14,$15,null,$16
    )
    on conflict (orthanc_job_id, study_instance_uid)
      where direction = 'SENT' and orthanc_job_id is not null
    do update set
      status = excluded.status,
      patient_id = coalesce(excluded.patient_id, dicom_transfer_events.patient_id),
      patient_name = coalesce(excluded.patient_name, dicom_transfer_events.patient_name),
      accession_number = coalesce(excluded.accession_number, dicom_transfer_events.accession_number),
      study_description = coalesce(excluded.study_description, dicom_transfer_events.study_description),
      source_aet = coalesce(excluded.source_aet, dicom_transfer_events.source_aet),
      source_ip = null,
      destination_aet = coalesce(excluded.destination_aet, dicom_transfer_events.destination_aet),
      instance_count = excluded.instance_count,
      first_seen_at = dicom_transfer_events.first_seen_at,
      last_seen_at = case
        when excluded.status in ('SUCCESS', 'FAILED') and dicom_transfer_events.status = excluded.status
          then least(coalesce(dicom_transfer_events.completed_at, excluded.completed_at), excluded.completed_at)
        else excluded.last_seen_at
      end,
      completed_at = case
        when excluded.status in ('SUCCESS', 'FAILED') and dicom_transfer_events.status = excluded.status
          then least(coalesce(dicom_transfer_events.completed_at, excluded.completed_at), excluded.completed_at)
        else excluded.completed_at
      end,
      error_code = excluded.error_code,
      error_message = excluded.error_message,
      orthanc_change_sequence = null,
      orthanc_resource_id = coalesce(excluded.orthanc_resource_id, dicom_transfer_events.orthanc_resource_id),
      updated_at = now()
    returning *
  `, [status, patientId, patientName, accessionNumber, studyInstanceUid, studyDescription, sourceAet, destinationAet, instanceCount, firstSeenAt, lastSeenAt, completedAt, errorCode, errorMessage, orthancJobId, orthancResourceId]);
  if (!inserted.rows[0]) throw new HttpError(409, "A DICOM transmission event could not be recorded safely.");
  return { event: inserted.rows[0] };
}
