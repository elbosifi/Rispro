import { HttpError } from "../utils/http-error.js";
import { logAuditEntry } from "./audit-service.js";
import { readSonicDicomReportSettings, type SonicDicomReportSettings } from "./sonicdicom-report-settings.js";
import { resolveSonicDicomBrowserBaseUrl } from "./sonicdicom-browser-url.js";

export type SonicDicomReportState =
  | "final"
  | "draft"
  | "no_report"
  | "study_not_found"
  | "unavailable"
  | "not_required"
  | "not_completed"
  | "disabled";

export interface ReportLookupContext {
  bookingId: number;
  accessionNumber: string;
  studyInstanceUid: string | null;
  requiresReport: boolean;
  status: string;
}

export interface ReportStatusResult {
  state: SonicDicomReportState;
  canViewReport: boolean;
  source: "sonicdicom" | "rispro";
  reportFinalAt: string | null;
  latestDocumentId?: string | null;
  finalizedByAccount?: string | null;
  correlationMethod?: "study_instance_uid" | "accession_fallback" | null;
  /** Present for durable Reporting Board batch refreshes. */
  studyNote?: string | null;
}

export interface SonicDicomSqlTestResult {
  foundStudy: boolean;
  foundReport: boolean;
  normalizedState: SonicDicomReportState;
  canViewReport: boolean;
  statusCode: number | null;
  reportFinalAt: string | null;
  diagnostic: string;
}

export interface StudyExistenceResult {
  foundStudy: boolean;
}

export interface SonicDicomStudyNoteLookupContext {
  bookingId: number;
  accessionNumber: string | null;
  studyInstanceUid: string | null;
}

export interface SonicDicomStudyNoteResult {
  note: string | null;
  checkedAt: string | null;
  source: "sonicdicom" | null;
}

export interface SonicDicomStudyNoteSqlRow {
  AccessionNumber?: string | null;
  StudyInstanceUID?: string | null;
  Note?: string | null;
}

interface CacheEntry {
  expiresAt: number;
  result: ReportStatusResult;
}

interface StudyNoteCacheEntry {
  expiresAt: number;
  result: SonicDicomStudyNoteResult;
}

interface SqlReadinessRow {
  StudyInstanceUID?: string | null;
  AccessionNumber?: string | null;
  FoundStudy?: number;
  FoundReport?: number;
  Id?: string | number | null;
  Account?: string | null;
  Status?: number | null;
  UpdatedAt?: Date | string | null;
}

/** Metadata-only document history for a single resolved SonicDICOM report. */
export interface SonicDicomDocumentHistoryLookupContext {
  lookupKey: string;
  accessionNumber: string;
  studyInstanceUid: string | null;
}

export interface SonicDicomReportDocument {
  reportNo: number;
  documentId: string;
  account: string | null;
  statusCode: number | null;
  updatedAt: string | null;
}

export interface SonicDicomDocumentHistoryResult {
  foundStudy: boolean;
  foundReport: boolean;
  reportNo: number | null;
  correlationMethod: "study_instance_uid" | "accession_fallback" | null;
  documents: SonicDicomReportDocument[];
}

export interface SonicDicomComparisonDocumentSelection {
  storedDocumentId: string | null;
  storedDocumentStatusCode?: number | null;
  primaryDocumentId: string | null;
  primaryCachedReportStatus?: string | null;
  assignedDoctorUsername: string | null;
  assignedAt: string;
}

interface SqlReadiness {
  foundStudy: boolean;
  foundReport: boolean;
  statusCode: number | null;
  documentUpdatedAt: string | null;
  latestDocumentId: string | null;
  finalizedByAccount: string | null;
}

interface SqlDocumentHistoryRow extends SqlReadinessRow {
  ReportNo?: number | string | null;
}

interface SqlRequest {
  input: (name: string, type: unknown, value: unknown) => unknown;
  query: <T = unknown>(sql: string) => Promise<{ recordset: T[] }>;
}

interface SqlConnectionPool {
  connect: () => Promise<void>;
  close: () => Promise<void>;
  request: () => SqlRequest;
}

type SqlModule = {
  ConnectionPool: new (config: unknown) => SqlConnectionPool;
  NVarChar: (size?: number) => unknown;
};

const statusCache = new Map<number, CacheEntry>();
const studyNoteCache = new Map<string, StudyNoteCacheEntry>();

function normalizedSonicAccount(value: string | null | undefined): string {
  return String(value ?? "").trim().toLowerCase();
}

function activeDocumentPredicate(request: SqlRequest, sql: SqlModule, statusCodes: number[], prefix: string, column = "d.Status"): string {
  const codes = [...new Set(statusCodes.filter((value) => Number.isInteger(value)))];
  if (!codes.length) return "1 = 1";
  codes.forEach((code, index) => request.input(`${prefix}${index}`, sql.NVarChar(16), code));
  return `${column} not in (${codes.map((_, index) => `@${prefix}${index}`).join(", ")})`;
}

/** SonicDICOM GUID equality is case-insensitive but audit storage preserves original text. */
export function normalizeSonicDicomDocumentId(value: string | null | undefined): string {
  return String(value ?? "").trim().toLowerCase();
}

function newerDocumentFirst(left: SonicDicomReportDocument, right: SonicDicomReportDocument): number {
  const leftAt = Date.parse(left.updatedAt ?? "");
  const rightAt = Date.parse(right.updatedAt ?? "");
  if (leftAt !== rightAt) return rightAt - leftAt;
  return normalizeSonicDicomDocumentId(right.documentId).localeCompare(normalizeSonicDicomDocumentId(left.documentId));
}

/** Account and assignment time constrain correlation; a tombstoned current document can be replaced. */
export function selectSonicDicomComparisonDocument(
  candidate: SonicDicomComparisonDocumentSelection,
  history: SonicDicomDocumentHistoryResult,
  options: { noReportStatusCodes?: number[]; finalStatusCodes?: number[] } = {}
): { document: SonicDicomReportDocument | null; multipleCandidates: boolean; storedDocument: SonicDicomReportDocument | null; bootstrapRejected: boolean } {
  const storedId = normalizeSonicDicomDocumentId(candidate.storedDocumentId);
  const primaryId = normalizeSonicDicomDocumentId(candidate.primaryDocumentId);
  const storedDocument = storedId ? history.documents.find((document) => normalizeSonicDicomDocumentId(document.documentId) === storedId) ?? null : null;
  const tombstones = new Set(options.noReportStatusCodes ?? [7]);
  const finals = new Set(options.finalStatusCodes ?? [6]);
  if (storedDocument && !tombstones.has(Number(storedDocument.statusCode))) {
    return { document: storedDocument, multipleCandidates: false, storedDocument, bootstrapRejected: false };
  }
  const assignedAccount = normalizedSonicAccount(candidate.assignedDoctorUsername);
  const assignedAt = Date.parse(candidate.assignedAt);
  if (!assignedAccount || !Number.isFinite(assignedAt)) return { document: storedDocument, multipleCandidates: false, storedDocument, bootstrapRejected: false };
  const matches = history.documents.filter((document) => {
    const updatedAt = Date.parse(document.updatedAt ?? "");
    const documentId = normalizeSonicDicomDocumentId(document.documentId);
    return documentId !== storedId && documentId !== primaryId &&
      normalizedSonicAccount(document.account) === assignedAccount &&
      Number.isFinite(updatedAt) && updatedAt >= assignedAt;
  }).filter((document) => !storedDocument || Date.parse(document.updatedAt ?? "") > Date.parse(storedDocument.updatedAt ?? ""))
    .sort(newerDocumentFirst);
  if (matches.length) return { document: matches[0], multipleCandidates: matches.length > 1, storedDocument, bootstrapRejected: false };

  const cachedPrimary = primaryId ? history.documents.find((document) => normalizeSonicDicomDocumentId(document.documentId) === primaryId) ?? null : null;
  const primaryWasNonFinal = candidate.primaryCachedReportStatus !== "final";
  const primaryUpdatedAt = Date.parse(cachedPrimary?.updatedAt ?? "");
  const alternatePrimary = history.documents.some((document) => {
    const updatedAt = Date.parse(document.updatedAt ?? "");
    return normalizeSonicDicomDocumentId(document.documentId) !== primaryId && finals.has(Number(document.statusCode)) &&
      Number.isFinite(updatedAt) && (updatedAt < assignedAt || updatedAt < primaryUpdatedAt);
  });
  const bootstrapCandidate = cachedPrimary && primaryWasNonFinal &&
    normalizedSonicAccount(cachedPrimary.account) === assignedAccount && Number.isFinite(primaryUpdatedAt) && primaryUpdatedAt >= assignedAt;
  if (bootstrapCandidate && alternatePrimary) return { document: cachedPrimary, multipleCandidates: false, storedDocument, bootstrapRejected: false };
  return { document: storedDocument, multipleCandidates: false, storedDocument, bootstrapRejected: Boolean(bootstrapCandidate) };
}

function validateDatabaseName(name: string, fallback: string): string {
  const trimmed = String(name || "").trim() || fallback;
  if (!/^[A-Za-z0-9_]+$/.test(trimmed)) return fallback;
  return trimmed;
}

function encodeStaffViewerValue(value: string | null | undefined): string {
  return encodeURIComponent(String(value ?? ""));
}

export function buildSonicDicomStaffViewerUrl(input: {
  settings: SonicDicomReportSettings;
  requestHostname: string;
  target: "studyViewer" | "patientList";
  value: string;
}): string {
  if (!input.settings.sonicDicomReportsEnabled) throw new HttpError(503, "SonicDICOM integration is disabled.");
  const value = String(input.value || "").trim();
  if (!value) throw new HttpError(400, "SonicDICOM viewer identifier is required.");
  const baseUrl = resolveSonicDicomBrowserBaseUrl(input.requestHostname, input.settings);
  const route = input.target === "studyViewer" ? "viewer" : "list";
  const queryKey = input.target === "studyViewer" ? "accessionnumber" : "patientid";
  const rendered = `${baseUrl}/#/${route}?${queryKey}=${encodeStaffViewerValue(value)}`;

  try {
    const parsed = new URL(rendered);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") throw new Error("Unsupported protocol");
    return parsed.toString();
  } catch {
    throw new HttpError(503, "SonicDICOM browser URL produced a malformed viewer URL.");
  }
}

async function loadSqlModule(): Promise<SqlModule | null> {
  try {
    const imported = await import("mssql");
    const sql = ((imported as { default?: unknown })?.default ?? imported) as Partial<SqlModule>;
    if (typeof sql.ConnectionPool !== "function") {
      throw new Error("mssql module loaded but ConnectionPool constructor was not found");
    }
    return sql as SqlModule;
  } catch {
    return null;
  }
}

async function withSqlConnection<T>(
  settings: SonicDicomReportSettings,
  work: (ctx: { sql: SqlModule; pool: SqlConnectionPool }) => Promise<T>
): Promise<T> {
  const sql = await loadSqlModule();
  if (!sql) throw new HttpError(503, "mssql module loaded but ConnectionPool constructor was not found");
  if (!settings.sonicDicomSqlEnabled) throw new HttpError(503, "SonicDICOM SQL readiness is disabled.");
  if (!settings.sonicDicomSqlServer.trim()) throw new HttpError(503, "SonicDICOM SQL server is not configured.");
  if (!settings.sonicDicomSqlUsername.trim()) throw new HttpError(503, "SonicDICOM SQL username is not configured.");

  const pool = new sql.ConnectionPool({
    server: settings.sonicDicomSqlServer.trim(),
    user: settings.sonicDicomSqlUsername.trim(),
    password: settings.sonicDicomSqlPassword,
    options: {
      encrypt: Boolean(settings.sonicDicomSqlEncrypt),
      trustServerCertificate: Boolean(settings.sonicDicomSqlTrustServerCertificate),
      enableArithAbort: true,
    },
    requestTimeout: settings.sonicDicomSqlTimeoutMs,
    connectionTimeout: settings.sonicDicomSqlTimeoutMs,
  });

  await pool.connect();
  try {
    return await work({ sql, pool });
  } finally {
    await pool.close().catch(() => null);
  }
}

async function queryStudyUidByAccession(
  pool: SqlConnectionPool,
  sql: SqlModule,
  dicomDb: string,
  accessionNumber: string
): Promise<string | null> {
  const request = pool.request();
  request.input("accessionNumber", sql.NVarChar(128), accessionNumber);
  const result = await request.query<{ StudyInstanceUID?: string }>(
    `select top 1 s.StudyInstanceUID
     from [${dicomDb}].[dbo].[Studies] s
     where s.AccessionNumber = @accessionNumber
     order by s.StudyDate desc, s.StudyTime desc`
  );
  return String(result.recordset?.[0]?.StudyInstanceUID || "").trim() || null;
}

async function queryStudyNotes(
  pool: SqlConnectionPool,
  sql: SqlModule,
  dicomDb: string,
  accessions: string[],
  studyInstanceUids: string[]
): Promise<SonicDicomStudyNoteSqlRow[]> {
  const request = pool.request();
  const clauses: string[] = [];
  if (accessions.length > 0) {
    accessions.forEach((accession, index) => request.input(`accession${index}`, sql.NVarChar(128), accession));
    clauses.push(`s.AccessionNumber in (${accessions.map((_, index) => `@accession${index}`).join(", ")})`);
  }
  if (studyInstanceUids.length > 0) {
    studyInstanceUids.forEach((uid, index) => request.input(`studyInstanceUid${index}`, sql.NVarChar(128), uid));
    clauses.push(`s.StudyInstanceUID in (${studyInstanceUids.map((_, index) => `@studyInstanceUid${index}`).join(", ")})`);
  }
  if (clauses.length === 0) return [];

  const result = await request.query<SonicDicomStudyNoteSqlRow>(
    `select s.AccessionNumber, s.StudyInstanceUID, s.Note
     from [${dicomDb}].[dbo].[Studies] s
     where ${clauses.join(" or ")}
     order by s.StudyDate desc, s.StudyTime desc`
  );
  return result.recordset ?? [];
}

async function querySqlReportReadinessByAccession(
  pool: SqlConnectionPool,
  sql: SqlModule,
  dicomDb: string,
  reportDb: string,
  accessionNumber: string,
  noReportStatusCodes: number[]
): Promise<SqlReadiness> {
  const request = pool.request();
  request.input("accessionNumber", sql.NVarChar(128), accessionNumber);
  const activeDocument = activeDocumentPredicate(request, sql, noReportStatusCodes, "noReportStatus");
  const result = await request.query<SqlReadinessRow>(
    `with StudyMatch as (
       select top 1 s.StudyInstanceUID
       from [${dicomDb}].[dbo].[Studies] s
       where s.AccessionNumber = @accessionNumber
       order by s.StudyDate desc, s.StudyTime desc
     ),
     ReportMatch as (
       select top 1 r.No as ReportNo, r.StudyInstanceUID, r.DocumentCount
       from [${reportDb}].[dbo].[Reports] r
       inner join StudyMatch s
         on s.StudyInstanceUID = r.StudyInstanceUID
       order by r.No desc
     ),
     LatestDocument as (
       select top 1 d.Id, d.Report, d.Account, d.Status, d.UpdatedAt
       from [${reportDb}].[dbo].[Documents] d
       inner join ReportMatch r
         on d.Report = r.ReportNo
       where ${activeDocument}
       order by d.UpdatedAt desc, d.Id desc
     )
     select
       case when exists (select 1 from StudyMatch) then 1 else 0 end as FoundStudy,
       case when exists (select 1 from ReportMatch) then 1 else 0 end as FoundReport,
       (select top 1 Id from LatestDocument) as Id,
       (select top 1 Account from LatestDocument) as Account,
      (select top 1 Status from LatestDocument) as Status,
      (select top 1 UpdatedAt from LatestDocument) as UpdatedAt`
  );

  const row = result.recordset?.[0] ?? {};
  const foundStudy = Number(row.FoundStudy || 0) === 1;
  const foundReport = Number(row.FoundReport || 0) === 1;
  const numericStatus = Number(row.Status);
  const statusCode = row.Status == null ? null : Number.isFinite(numericStatus) ? Math.trunc(numericStatus) : null;
  const documentUpdatedAt = row.UpdatedAt instanceof Date ? row.UpdatedAt.toISOString() : row.UpdatedAt ? String(row.UpdatedAt) : null;
  const latestDocumentId = row.Id == null ? null : String(row.Id).trim() || null;
  const finalizedByAccount = String(row.Account ?? "").trim() || null;
  return { foundStudy, foundReport, statusCode, documentUpdatedAt, latestDocumentId, finalizedByAccount };
}

async function querySqlReportReadinessByStudyInstanceUid(
  pool: SqlConnectionPool,
  sql: SqlModule,
  dicomDb: string,
  reportDb: string,
  studyInstanceUid: string,
  noReportStatusCodes: number[]
): Promise<SqlReadiness> {
  const request = pool.request();
  request.input("studyInstanceUid", sql.NVarChar(128), studyInstanceUid);
  const activeDocument = activeDocumentPredicate(request, sql, noReportStatusCodes, "noReportStatus");
  const result = await request.query<SqlReadinessRow>(
    `with StudyMatch as (
       select top 1 s.StudyInstanceUID
       from [${dicomDb}].[dbo].[Studies] s
       where s.StudyInstanceUID = @studyInstanceUid
     ),
     ReportMatch as (
       select top 1 r.No as ReportNo, r.StudyInstanceUID, r.DocumentCount
       from [${reportDb}].[dbo].[Reports] r
       inner join StudyMatch s
         on s.StudyInstanceUID = r.StudyInstanceUID
       order by r.No desc
     ),
     LatestDocument as (
       select top 1 d.Id, d.Report, d.Account, d.Status, d.UpdatedAt
       from [${reportDb}].[dbo].[Documents] d
       inner join ReportMatch r
         on d.Report = r.ReportNo
       where ${activeDocument}
       order by d.UpdatedAt desc, d.Id desc
     )
     select
       case when exists (select 1 from StudyMatch) then 1 else 0 end as FoundStudy,
       case when exists (select 1 from ReportMatch) then 1 else 0 end as FoundReport,
       (select top 1 Id from LatestDocument) as Id,
       (select top 1 Account from LatestDocument) as Account,
       (select top 1 Status from LatestDocument) as Status,
       (select top 1 UpdatedAt from LatestDocument) as UpdatedAt`
  );
  return sqlReadinessFromRow(result.recordset?.[0] ?? {});
}

async function querySqlReportReadinessBatch(
  pool: SqlConnectionPool,
  sql: SqlModule,
  dicomDb: string,
  reportDb: string,
  identifiers: string[],
  method: "study_instance_uid" | "accession_fallback",
  noReportStatusCodes: number[]
): Promise<Map<string, SqlReadiness>> {
  const uniqueIdentifiers = [...new Set(identifiers.map((value) => value.trim()).filter(Boolean))];
  if (!uniqueIdentifiers.length) return new Map();
  const request = pool.request();
  const activeDocument = activeDocumentPredicate(request, sql, noReportStatusCodes, `noReportStatus${method}`);
  const parameterPrefix = method === "study_instance_uid" ? "studyInstanceUid" : "accession";
  const valueRows = uniqueIdentifiers.map((identifier, index) => {
    request.input(`${parameterPrefix}${index}`, sql.NVarChar(128), identifier);
    return `(@${parameterPrefix}${index})`;
  });
  const inputColumn = method === "study_instance_uid" ? "StudyInstanceUID" : "AccessionNumber";
  const studyPredicate = method === "study_instance_uid"
    ? "s.StudyInstanceUID = input.StudyInstanceUID"
    : "s.AccessionNumber = input.AccessionNumber";
  const studyOrder = method === "study_instance_uid" ? "s.StudyInstanceUID" : "s.StudyDate desc, s.StudyTime desc";
  const rows = (await request.query<SqlReadinessRow>(`
    with InputIdentifiers(${inputColumn}) as (select * from (values ${valueRows.join(", ")}) v(${inputColumn}))
    select input.${inputColumn},
      case when study.StudyInstanceUID is null then 0 else 1 end as FoundStudy,
      case when report.ReportNo is null then 0 else 1 end as FoundReport,
      document.Id, document.Account, document.Status, document.UpdatedAt
    from InputIdentifiers input
    outer apply (select top 1 s.StudyInstanceUID from [${dicomDb}].[dbo].[Studies] s where ${studyPredicate} order by ${studyOrder}) study
    outer apply (select top 1 r.No as ReportNo from [${reportDb}].[dbo].[Reports] r where r.StudyInstanceUID = study.StudyInstanceUID order by r.No desc) report
    outer apply (select top 1 d.Id, d.Account, d.Status, d.UpdatedAt from [${reportDb}].[dbo].[Documents] d where d.Report = report.ReportNo and ${activeDocument} order by d.UpdatedAt desc, d.Id desc) document
  `)).recordset;
  return new Map(rows.map((row) => [
    String(method === "study_instance_uid" ? row.StudyInstanceUID ?? "" : row.AccessionNumber ?? "").trim(),
    sqlReadinessFromRow(row),
  ]));
}

async function querySqlDocumentHistoryBatch(
  pool: SqlConnectionPool,
  sql: SqlModule,
  dicomDb: string,
  reportDb: string,
  identifiers: string[],
  method: "study_instance_uid" | "accession_fallback"
): Promise<Map<string, Omit<SonicDicomDocumentHistoryResult, "correlationMethod">>> {
  const uniqueIdentifiers = [...new Set(identifiers.map((value) => value.trim()).filter(Boolean))];
  if (!uniqueIdentifiers.length) return new Map();
  const request = pool.request();
  const parameterPrefix = method === "study_instance_uid" ? "studyInstanceUid" : "accession";
  const valueRows = uniqueIdentifiers.map((identifier, index) => {
    request.input(`${parameterPrefix}${index}`, sql.NVarChar(128), identifier);
    return `(@${parameterPrefix}${index})`;
  });
  const inputColumn = method === "study_instance_uid" ? "StudyInstanceUID" : "AccessionNumber";
  const studyPredicate = method === "study_instance_uid"
    ? "s.StudyInstanceUID = input.StudyInstanceUID"
    : "s.AccessionNumber = input.AccessionNumber";
  const studyOrder = method === "study_instance_uid" ? "s.StudyInstanceUID" : "s.StudyDate desc, s.StudyTime desc";
  const rows = (await request.query<SqlDocumentHistoryRow>(`
    with InputIdentifiers(${inputColumn}) as (select * from (values ${valueRows.join(", ")}) v(${inputColumn}))
    select input.${inputColumn},
      case when study.StudyInstanceUID is null then 0 else 1 end as FoundStudy,
      case when report.ReportNo is null then 0 else 1 end as FoundReport,
      report.ReportNo, document.Id, document.Account, document.Status, document.UpdatedAt
    from InputIdentifiers input
    outer apply (select top 1 s.StudyInstanceUID from [${dicomDb}].[dbo].[Studies] s where ${studyPredicate} order by ${studyOrder}) study
    outer apply (select top 1 r.No as ReportNo from [${reportDb}].[dbo].[Reports] r where r.StudyInstanceUID = study.StudyInstanceUID order by r.No desc) report
    outer apply (select d.Id, d.Account, d.Status, d.UpdatedAt from [${reportDb}].[dbo].[Documents] d where d.Report = report.ReportNo) document
    order by document.UpdatedAt desc, document.Id desc
  `)).recordset ?? [];
  const histories = new Map<string, Omit<SonicDicomDocumentHistoryResult, "correlationMethod">>();
  for (const identifier of uniqueIdentifiers) histories.set(identifier, { foundStudy: false, foundReport: false, reportNo: null, documents: [] });
  for (const row of rows) {
    const key = String(method === "study_instance_uid" ? row.StudyInstanceUID ?? "" : row.AccessionNumber ?? "").trim();
    if (!key) continue;
    const history = histories.get(key) ?? { foundStudy: false, foundReport: false, reportNo: null, documents: [] };
    history.foundStudy ||= Number(row.FoundStudy || 0) === 1;
    history.foundReport ||= Number(row.FoundReport || 0) === 1;
    const reportNo = Number(row.ReportNo);
    if (Number.isFinite(reportNo)) history.reportNo = Math.trunc(reportNo);
    if (row.Id != null) {
      const numericStatus = Number(row.Status);
      history.documents.push({
        reportNo: history.reportNo ?? Math.trunc(reportNo),
        documentId: String(row.Id).trim(),
        account: String(row.Account ?? "").trim() || null,
        statusCode: row.Status == null || !Number.isFinite(numericStatus) ? null : Math.trunc(numericStatus),
        updatedAt: row.UpdatedAt instanceof Date ? row.UpdatedAt.toISOString() : row.UpdatedAt ? String(row.UpdatedAt) : null,
      });
    }
    histories.set(key, history);
  }
  for (const history of histories.values()) {
    history.documents.sort((left, right) => {
      const byUpdatedAt = String(right.updatedAt ?? "").localeCompare(String(left.updatedAt ?? ""));
      return byUpdatedAt || right.documentId.localeCompare(left.documentId);
    });
  }
  return histories;
}

/**
 * Resolves all metadata-only Documents rows for the same latest Reports.No
 * used by readiness. This is deliberately separate from the normal readiness
 * API so non-comparison callers retain their existing single-document path.
 */
export async function fetchSonicDicomDocumentHistoriesBatch(
  contexts: SonicDicomDocumentHistoryLookupContext[]
): Promise<Map<string, SonicDicomDocumentHistoryResult>> {
  const unique = [...new Map(contexts.map((context) => [context.lookupKey, context])).values()].slice(0, 200);
  const result = new Map<string, SonicDicomDocumentHistoryResult>();
  if (!unique.length) return result;
  const settings = await readSonicDicomReportSettings();
  if (!settings.sonicDicomReportsEnabled || settings.sonicDicomReadinessMode !== "sql_server") {
    throw new HttpError(503, "SonicDICOM SQL readiness is unavailable.");
  }
  const dicomDb = validateDatabaseName(settings.sonicDicomDicomDatabaseName, "dicom");
  const reportDb = validateDatabaseName(settings.sonicDicomReportDatabaseName, "report");
  await withSqlConnection(settings, async ({ sql, pool }) => {
    const byUid = await querySqlDocumentHistoryBatch(pool, sql, dicomDb, reportDb,
      unique.map((context) => String(context.studyInstanceUid ?? "").trim()), "study_instance_uid");
    const fallbackContexts = unique.filter((context) => {
      const uid = String(context.studyInstanceUid ?? "").trim();
      return !uid || !byUid.get(uid)?.foundStudy;
    });
    const byAccession = await querySqlDocumentHistoryBatch(pool, sql, dicomDb, reportDb,
      fallbackContexts.map((context) => String(context.accessionNumber ?? "").trim()), "accession_fallback");
    for (const context of unique) {
      const uid = String(context.studyInstanceUid ?? "").trim();
      const byUidResult = uid ? byUid.get(uid) : null;
      const selected = byUidResult?.foundStudy ? byUidResult : byAccession.get(String(context.accessionNumber ?? "").trim());
      result.set(context.lookupKey, selected
        ? { ...selected, correlationMethod: byUidResult?.foundStudy ? "study_instance_uid" : "accession_fallback" }
        : { foundStudy: false, foundReport: false, reportNo: null, correlationMethod: null, documents: [] });
    }
  });
  return result;
}

function sqlReadinessFromRow(row: SqlReadinessRow): SqlReadiness {
  const numericStatus = Number(row.Status);
  return {
    foundStudy: Number(row.FoundStudy || 0) === 1,
    foundReport: Number(row.FoundReport || 0) === 1,
    statusCode: row.Status == null ? null : Number.isFinite(numericStatus) ? Math.trunc(numericStatus) : null,
    documentUpdatedAt: row.UpdatedAt instanceof Date ? row.UpdatedAt.toISOString() : row.UpdatedAt ? String(row.UpdatedAt) : null,
    latestDocumentId: row.Id == null ? null : String(row.Id).trim() || null,
    finalizedByAccount: String(row.Account ?? "").trim() || null,
  };
}

async function queryReportStatusByReportNo(
  pool: SqlConnectionPool,
  sql: SqlModule,
  reportDb: string,
  reportNo: string,
  noReportStatusCodes: number[]
): Promise<{ statusCode: number | null; foundRow: boolean; documentUpdatedAt: string | null }> {
  const request = pool.request();
  request.input("reportNo", sql.NVarChar(128), reportNo);
  const activeDocument = activeDocumentPredicate(request, sql, noReportStatusCodes, "noReportStatus");
  const result = await request.query<{ Status?: number; UpdatedAt?: Date | string | null }>(
    `select top 1 d.Status, d.UpdatedAt
     from [${reportDb}].[dbo].[Documents] d
     where d.Report = @reportNo
       and ${activeDocument}
     order by d.UpdatedAt desc, d.Id desc`
  );
  const row = result.recordset?.[0];
  if (!row) return { statusCode: null, foundRow: false, documentUpdatedAt: null };
  const numeric = Number(row.Status);
  return {
    statusCode: Number.isFinite(numeric) ? Math.trunc(numeric) : null,
    foundRow: true,
    documentUpdatedAt: row.UpdatedAt instanceof Date ? row.UpdatedAt.toISOString() : row.UpdatedAt ? String(row.UpdatedAt) : null,
  };
}

export function mapSonicDicomDocumentStatus(
  settings: SonicDicomReportSettings,
  statusCode: number | null,
  documentUpdatedAt: string | null = null,
  latestDocumentId: string | null = null,
  finalizedByAccount: string | null = null,
  correlationMethod: ReportStatusResult["correlationMethod"] = null
): ReportStatusResult {
  const common = { latestDocumentId, correlationMethod };
  if (statusCode == null) return { state: "no_report", canViewReport: false, source: "sonicdicom", reportFinalAt: null, finalizedByAccount: null, ...common };
  if (settings.sonicDicomSqlFinalStatusCodes.includes(statusCode)) {
    return { state: "final", canViewReport: true, source: "sonicdicom", reportFinalAt: documentUpdatedAt, finalizedByAccount: String(finalizedByAccount ?? "").trim() || null, ...common };
  }
  if (settings.sonicDicomSqlDraftStatusCodes.includes(statusCode)) {
    return { state: "draft", canViewReport: false, source: "sonicdicom", reportFinalAt: null, finalizedByAccount: null, ...common };
  }
  if (settings.sonicDicomSqlNoReportStatusCodes.includes(statusCode)) {
    return { state: "no_report", canViewReport: false, source: "sonicdicom", reportFinalAt: null, finalizedByAccount: null, ...common };
  }
  return { state: "unavailable", canViewReport: false, source: "sonicdicom", reportFinalAt: null, finalizedByAccount: null, ...common };
}

export const __mapSonicDicomSqlStatusCodeForTest = mapSonicDicomDocumentStatus;

export async function __resolveSonicDicomCorrelationForTest(
  settings: SonicDicomReportSettings,
  context: Pick<ReportLookupContext, "studyInstanceUid" | "accessionNumber">,
  queryByUid: (uid: string) => Promise<SqlReadiness>,
  queryByAccession: (accession: string) => Promise<SqlReadiness>
): Promise<ReportStatusResult> {
  const uid = String(context.studyInstanceUid ?? "").trim();
  if (uid) {
    const readiness = await queryByUid(uid);
    if (readiness.foundStudy) return readinessResult(settings, readiness, "study_instance_uid").result;
  }
  const accession = String(context.accessionNumber ?? "").trim();
  if (!accession) return { state: "study_not_found", canViewReport: false, source: "sonicdicom", reportFinalAt: null, correlationMethod: null };
  const readiness = await queryByAccession(accession);
  if (!readiness.foundStudy) return { state: "study_not_found", canViewReport: false, source: "sonicdicom", reportFinalAt: null, correlationMethod: null };
  return readinessResult(settings, readiness, "accession_fallback").result;
}

async function resolveSqlReadiness(
  settings: SonicDicomReportSettings,
  context: { accessionNumber: string; studyInstanceUid?: string | null }
): Promise<{ foundStudy: boolean; foundReport: boolean; statusCode: number | null; result: ReportStatusResult; diagnostic: string }> {
  const dicomDb = validateDatabaseName(settings.sonicDicomDicomDatabaseName, "dicom");
  const reportDb = validateDatabaseName(settings.sonicDicomReportDatabaseName, "report");
  return withSqlConnection(settings, async ({ sql, pool }) => {
    const studyInstanceUid = String(context.studyInstanceUid || "").trim();
    const accession = String(context.accessionNumber || "").trim();
    let correlationMethod: ReportStatusResult["correlationMethod"] = null;
    let readiness: SqlReadiness | null = null;
    if (studyInstanceUid) {
      readiness = await querySqlReportReadinessByStudyInstanceUid(pool, sql, dicomDb, reportDb, studyInstanceUid, settings.sonicDicomSqlNoReportStatusCodes);
      if (readiness.foundStudy) correlationMethod = "study_instance_uid";
    }
    if (!readiness?.foundStudy && accession) {
      readiness = await querySqlReportReadinessByAccession(pool, sql, dicomDb, reportDb, accession, settings.sonicDicomSqlNoReportStatusCodes);
      if (readiness.foundStudy) correlationMethod = "accession_fallback";
    }
    if (!accession) {
      if (readiness?.foundStudy) return readinessResult(settings, readiness, correlationMethod);
      if (studyInstanceUid) {
        return {
          foundStudy: false,
          foundReport: false,
          statusCode: null,
          result: { state: "study_not_found", canViewReport: false, source: "sonicdicom", reportFinalAt: null, correlationMethod: null },
          diagnostic: "The supplied StudyInstanceUID was not found and no accession fallback was available.",
        };
      }
      return {
        foundStudy: false,
        foundReport: false,
        statusCode: null,
        result: { state: "no_report", canViewReport: false, source: "sonicdicom", reportFinalAt: null },
        diagnostic: "No accession number was provided for SQL readiness lookup.",
      };
    }

    if (!readiness) readiness = await querySqlReportReadinessByAccession(pool, sql, dicomDb, reportDb, accession, settings.sonicDicomSqlNoReportStatusCodes);
    if (!readiness.foundStudy) {
      return {
        foundStudy: false,
        foundReport: false,
        statusCode: null,
        result: { state: "study_not_found", canViewReport: false, source: "sonicdicom", reportFinalAt: null },
        diagnostic: "No matching StudyInstanceUID was found in dicom.dbo.Studies.",
      };
    }
    return readinessResult(settings, readiness, correlationMethod);
  });
}

function readinessResult(
  settings: SonicDicomReportSettings,
  readiness: SqlReadiness,
  correlationMethod: ReportStatusResult["correlationMethod"]
): { foundStudy: boolean; foundReport: boolean; statusCode: number | null; result: ReportStatusResult; diagnostic: string } {
  if (!readiness.foundReport) return {
    foundStudy: true, foundReport: false, statusCode: null,
    result: { state: "no_report", canViewReport: false, source: "sonicdicom", reportFinalAt: null, latestDocumentId: null, finalizedByAccount: null, correlationMethod },
    diagnostic: "No report mapping was found in report.dbo.Reports for the study.",
  };
  if (readiness.statusCode == null) return {
    foundStudy: true, foundReport: true, statusCode: null,
    result: { state: "no_report", canViewReport: false, source: "sonicdicom", reportFinalAt: null, latestDocumentId: readiness.latestDocumentId, finalizedByAccount: null, correlationMethod },
    diagnostic: "No matching document status row was found in report.dbo.Documents.",
  };
  const mapped = mapSonicDicomDocumentStatus(settings, readiness.statusCode, readiness.documentUpdatedAt, readiness.latestDocumentId, readiness.finalizedByAccount, correlationMethod);
  return {
    foundStudy: true, foundReport: true, statusCode: readiness.statusCode, result: mapped,
    diagnostic: mapped.state === "unavailable" ? "Document status code is unknown for current SQL mapping and was treated as unavailable." : "SQL readiness lookup completed.",
  };
}

export function messageForReportState(
  state: SonicDicomReportState,
  settings: {
    qrReportFinalMessage?: string;
    qrReportDraftMessage?: string;
    qrReportNoReportMessage?: string;
    qrReportUnavailableMessage?: string;
    qrReportNotRequiredMessage?: string;
    qrReportNotCompletedMessage?: string;
    qrReportStudyNotFoundMessage?: string;
  }
): string {
  if (state === "final") return settings.qrReportFinalMessage || "";
  if (state === "draft") return settings.qrReportDraftMessage || "";
  if (state === "no_report") return settings.qrReportNoReportMessage || "";
  if (state === "study_not_found") return settings.qrReportStudyNotFoundMessage || settings.qrReportNoReportMessage || "";
  if (state === "not_required") return settings.qrReportNotRequiredMessage || "";
  if (state === "not_completed") return settings.qrReportNotCompletedMessage || "";
  return settings.qrReportUnavailableMessage || "";
}

export async function checkSonicDicomReportStatus(
  context: ReportLookupContext,
  options: { useCache?: boolean } = {}
): Promise<ReportStatusResult> {
  const settings = await readSonicDicomReportSettings();
  if (!settings.sonicDicomReportsEnabled) return { state: "disabled", canViewReport: false, source: "rispro", reportFinalAt: null };
  if (settings.sonicDicomReadinessMode !== "sql_server") return { state: "unavailable", canViewReport: false, source: "sonicdicom", reportFinalAt: null };

  if (options.useCache !== false) {
    const cached = statusCache.get(context.bookingId);
    if (cached && cached.expiresAt > Date.now()) return cached.result;
  }

  let result: ReportStatusResult = { state: "unavailable", canViewReport: false, source: "sonicdicom", reportFinalAt: null };
  try {
    const resolved = await resolveSqlReadiness(settings, { accessionNumber: context.accessionNumber, studyInstanceUid: context.studyInstanceUid });
    result = resolved.result;
  } catch {
    result = { state: "unavailable", canViewReport: false, source: "sonicdicom", reportFinalAt: null };
  }

  const ttlMs = Math.max(0, settings.sonicDicomStatusCacheTtlSeconds) * 1000;
  if (ttlMs > 0) statusCache.set(context.bookingId, { result, expiresAt: Date.now() + ttlMs });

  if (settings.auditReportStatusChecks) {
    await logAuditEntry({
      entityType: "patient_report",
      entityId: context.bookingId,
      actionType: `report_status_${result.state}`,
      oldValues: null,
      newValues: { state: result.state, canViewReport: result.canViewReport },
      changedByUserId: null,
    }).catch(() => null);
  }

  return result;
}

/**
 * Resolve a bounded set of readiness checks on one SQL Server connection.
 * This deliberately bypasses the process-local cache: callers are durable
 * cache writers or state-changing assignment safety checks.
 */
export async function checkSonicDicomReportStatusesBatch(
  contexts: ReportLookupContext[],
  options: { audit?: boolean } = {}
): Promise<Map<number, ReportStatusResult>> {
  const results = new Map<number, ReportStatusResult>();
  const unique = [...new Map(contexts.map((context) => [context.bookingId, context])).values()].slice(0, 200);
  if (!unique.length) return results;
  const settings = await readSonicDicomReportSettings();
  if (!settings.sonicDicomReportsEnabled || settings.sonicDicomReadinessMode !== "sql_server") {
    for (const context of unique) results.set(context.bookingId, {
      state: settings.sonicDicomReportsEnabled ? "unavailable" : "disabled",
      canViewReport: false,
      source: settings.sonicDicomReportsEnabled ? "sonicdicom" : "rispro",
      reportFinalAt: null,
    });
    return results;
  }
  const dicomDb = validateDatabaseName(settings.sonicDicomDicomDatabaseName, "dicom");
  const reportDb = validateDatabaseName(settings.sonicDicomReportDatabaseName, "report");
  try {
    await withSqlConnection(settings, async ({ sql, pool }) => {
      const readinessByUid = await querySqlReportReadinessBatch(
        pool, sql, dicomDb, reportDb,
        unique.map((context) => String(context.studyInstanceUid || "").trim()),
        "study_instance_uid", settings.sonicDicomSqlNoReportStatusCodes
      );
      const fallbackContexts = unique.filter((context) => {
        const uid = String(context.studyInstanceUid || "").trim();
        return !uid || !readinessByUid.get(uid)?.foundStudy;
      });
      const readinessByAccession = await querySqlReportReadinessBatch(
        pool, sql, dicomDb, reportDb,
        fallbackContexts.map((context) => String(context.accessionNumber || "").trim()),
        "accession_fallback", settings.sonicDicomSqlNoReportStatusCodes
      );
      for (const context of unique) {
        const uid = String(context.studyInstanceUid || "").trim();
        const uidReadiness = uid ? readinessByUid.get(uid) : null;
        if (uidReadiness?.foundStudy) {
          results.set(context.bookingId, readinessResult(settings, uidReadiness, "study_instance_uid").result);
          continue;
        }
        const accessionReadiness = readinessByAccession.get(String(context.accessionNumber || "").trim());
        results.set(context.bookingId, !accessionReadiness?.foundStudy
          ? { state: "study_not_found", canViewReport: false, source: "sonicdicom", reportFinalAt: null, correlationMethod: null }
          : readinessResult(settings, accessionReadiness, "accession_fallback").result);
      }
      const noteRows = await queryStudyNotes(
        pool,
        sql,
        dicomDb,
        [...new Set(unique.map((context) => String(context.accessionNumber || "").trim()).filter(Boolean))],
        [...new Set(unique.map((context) => String(context.studyInstanceUid || "").trim()).filter(Boolean))]
      );
      const notes = resolveSonicDicomStudyNotes(unique, noteRows, new Date().toISOString());
      for (const context of unique) {
        const result = results.get(context.bookingId);
        if (result) result.studyNote = notes.get(context.bookingId)?.note ?? null;
      }
    });
  } catch {
    for (const context of unique) results.set(context.bookingId, { state: "unavailable", canViewReport: false, source: "sonicdicom", reportFinalAt: null });
  }
  if (options.audit && settings.auditReportStatusChecks) {
    // Explicit callers retain existing audit semantics. Polling workers pass
    // audit:false to avoid a patient-access audit row per appointment/tick.
    await Promise.all([...results.entries()].map(([bookingId, result]) => logAuditEntry({
      entityType: "patient_report", entityId: bookingId, actionType: `report_status_${result.state}`,
      oldValues: null, newValues: { state: result.state, canViewReport: result.canViewReport }, changedByUserId: null,
    }).catch(() => null)));
  }
  return results;
}

function normalizeStudyNote(value: unknown): string | null {
  const trimmed = String(value ?? "").trim();
  return trimmed || null;
}

function studyNoteCacheKey(context: SonicDicomStudyNoteLookupContext): string | null {
  const uid = String(context.studyInstanceUid ?? "").trim();
  if (uid) return `uid:${uid}`;
  const accession = String(context.accessionNumber ?? "").trim();
  return accession ? `accession:${accession}` : null;
}

export function resolveSonicDicomStudyNotes(
  contexts: SonicDicomStudyNoteLookupContext[],
  rows: SonicDicomStudyNoteSqlRow[],
  checkedAt: string
): Map<number, SonicDicomStudyNoteResult> {
  const byAccession = new Map<string, string | null>();
  const byUid = new Map<string, string | null>();
  for (const row of rows) {
    const note = normalizeStudyNote(row.Note);
    const accession = String(row.AccessionNumber ?? "").trim();
    const uid = String(row.StudyInstanceUID ?? "").trim();
    if (accession && !byAccession.has(accession)) byAccession.set(accession, note);
    if (uid && !byUid.has(uid)) byUid.set(uid, note);
  }

  const results = new Map<number, SonicDicomStudyNoteResult>();
  for (const context of contexts) {
    const uid = String(context.studyInstanceUid ?? "").trim();
    const accession = String(context.accessionNumber ?? "").trim();
    const uidNote = uid ? byUid.get(uid) ?? null : null;
    const accessionNote = accession ? byAccession.get(accession) ?? null : null;
    const note = uidNote ?? accessionNote;
    results.set(context.bookingId, { note, checkedAt, source: note ? "sonicdicom" : null });
  }
  return results;
}

export const __resolveSonicDicomStudyNotesForTest = resolveSonicDicomStudyNotes;

export async function fetchSonicDicomStudyNotes(
  contexts: SonicDicomStudyNoteLookupContext[],
  options: { useCache?: boolean } = {}
): Promise<Map<number, SonicDicomStudyNoteResult>> {
  const results = new Map<number, SonicDicomStudyNoteResult>();
  const settings = await readSonicDicomReportSettings();
  if (!settings.sonicDicomReportsEnabled || settings.sonicDicomReadinessMode !== "sql_server") return results;

  const pending: SonicDicomStudyNoteLookupContext[] = [];
  const now = Date.now();
  for (const context of contexts) {
    const key = studyNoteCacheKey(context);
    if (!key) continue;
    const cached = options.useCache !== false ? studyNoteCache.get(key) : null;
    if (cached && cached.expiresAt > now) {
      results.set(context.bookingId, cached.result);
    } else {
      pending.push(context);
    }
  }
  if (pending.length === 0) return results;

  const dicomDb = validateDatabaseName(settings.sonicDicomDicomDatabaseName, "dicom");
  const studyInstanceUids = [
    ...new Set(
      pending
        .map((context) => String(context.studyInstanceUid ?? "").trim())
        .filter(Boolean)
    ),
  ];
  const accessions = [
    ...new Set(
      pending
        .map((context) => String(context.accessionNumber ?? "").trim())
        .filter(Boolean)
    ),
  ];
  const checkedAt = new Date().toISOString();
  const rows = await withSqlConnection(settings, ({ sql, pool }) => queryStudyNotes(pool, sql, dicomDb, accessions, studyInstanceUids));
  const resolved = resolveSonicDicomStudyNotes(pending, rows, checkedAt);

  const ttlMs = Math.max(0, settings.sonicDicomStatusCacheTtlSeconds) * 1000;
  for (const context of pending) {
    const result = resolved.get(context.bookingId) ?? { note: null, checkedAt, source: null };
    results.set(context.bookingId, result);
    const key = studyNoteCacheKey(context);
    if (key && ttlMs > 0) studyNoteCache.set(key, { result, expiresAt: Date.now() + ttlMs });
  }

  return results;
}

export async function testSonicDicomSqlReadiness(input: {
  mode: "sql_connection" | "accession_to_study" | "report_status" | "full_readiness";
  accessionNumber?: string;
  reportNo?: string;
}): Promise<SonicDicomSqlTestResult> {
  const settings = await readSonicDicomReportSettings();
  if (!settings.sonicDicomReportsEnabled) {
    return {
      foundStudy: false,
      foundReport: false,
      normalizedState: "disabled",
      canViewReport: false,
      statusCode: null,
      reportFinalAt: null,
      diagnostic: "SonicDICOM integration is disabled.",
    };
  }

  if (settings.sonicDicomReadinessMode !== "sql_server") {
    return {
      foundStudy: false,
      foundReport: false,
      normalizedState: "unavailable",
      canViewReport: false,
      statusCode: null,
      reportFinalAt: null,
      diagnostic: "Readiness mode is not SQL Server. Set sonicDicomReadinessMode to sql_server.",
    };
  }

  try {
    const dicomDb = validateDatabaseName(settings.sonicDicomDicomDatabaseName, "dicom");
    const reportDb = validateDatabaseName(settings.sonicDicomReportDatabaseName, "report");

    if (input.mode === "sql_connection") {
      await withSqlConnection(settings, async ({ pool }) => {
        await pool.request().query("select 1 as ok");
      });
      return {
        foundStudy: false,
        foundReport: false,
        normalizedState: "no_report",
        canViewReport: false,
        statusCode: null,
        reportFinalAt: null,
        diagnostic: "SQL connection succeeded.",
      };
    }

    if (input.mode === "accession_to_study") {
      const accession = String(input.accessionNumber || "").trim();
      if (!accession) {
        return {
          foundStudy: false,
          foundReport: false,
          normalizedState: "no_report",
          canViewReport: false,
          statusCode: null,
          reportFinalAt: null,
          diagnostic: "Accession number is required for accession-to-study test.",
        };
      }
      const foundStudy = await withSqlConnection(settings, async ({ sql, pool }) => {
        const uid = await queryStudyUidByAccession(pool, sql, dicomDb, accession);
        return Boolean(uid);
      });
      return {
        foundStudy,
        foundReport: false,
        normalizedState: "no_report",
        canViewReport: false,
        statusCode: null,
        reportFinalAt: null,
        diagnostic: foundStudy ? "StudyInstanceUID was resolved from accession." : "No StudyInstanceUID found for accession.",
      };
    }

    if (input.mode === "report_status") {
      const reportNo = String(input.reportNo || "").trim();
      if (!reportNo) {
        return {
          foundStudy: false,
          foundReport: false,
          normalizedState: "no_report",
          canViewReport: false,
        statusCode: null,
        reportFinalAt: null,
        diagnostic: "Report number is required for report-status test.",
        };
      }
      const statusLookup = await withSqlConnection(settings, async ({ sql, pool }) =>
        queryReportStatusByReportNo(pool, sql, reportDb, reportNo, settings.sonicDicomSqlNoReportStatusCodes)
      );
      const mapped: ReportStatusResult = statusLookup.foundRow
        ? mapSonicDicomDocumentStatus(settings, statusLookup.statusCode, statusLookup.documentUpdatedAt)
        : { state: "no_report", canViewReport: false, source: "sonicdicom" as const, reportFinalAt: null };
      return {
        foundStudy: false,
        foundReport: statusLookup.foundRow,
        normalizedState: mapped.state,
        canViewReport: mapped.canViewReport,
        statusCode: statusLookup.statusCode,
        reportFinalAt: mapped.reportFinalAt,
        diagnostic: statusLookup.foundRow ? "Report status lookup completed." : "No report document row found for report number.",
      };
    }

    const accession = String(input.accessionNumber || "").trim();
    if (!accession) {
      return {
        foundStudy: false,
        foundReport: false,
        normalizedState: "no_report",
        canViewReport: false,
        statusCode: null,
        reportFinalAt: null,
        diagnostic: "Accession number is required for full readiness test.",
      };
    }
    const full = await resolveSqlReadiness(settings, { accessionNumber: accession });
    return {
      foundStudy: full.foundStudy,
      foundReport: full.foundReport,
      normalizedState: full.result.state,
      canViewReport: full.result.canViewReport,
      statusCode: full.statusCode,
      reportFinalAt: full.result.reportFinalAt,
      diagnostic: full.diagnostic,
    };
  } catch (error) {
    return {
      foundStudy: false,
      foundReport: false,
      normalizedState: "unavailable",
      canViewReport: false,
      statusCode: null,
      reportFinalAt: null,
      diagnostic: error instanceof Error ? error.message : "SQL readiness test failed.",
    };
  }
}

export async function checkSonicDicomStudyExists(context: ReportLookupContext): Promise<StudyExistenceResult> {
  const settings = await readSonicDicomReportSettings();
  const dicomDb = validateDatabaseName(settings.sonicDicomDicomDatabaseName, "dicom");
  const accession = String(context.accessionNumber || "").trim();
  if (!accession) return { foundStudy: false };
  const foundStudy = await withSqlConnection(settings, async ({ sql, pool }) => {
    const uid = await queryStudyUidByAccession(pool, sql, dicomDb, accession);
    return Boolean(uid);
  });
  return { foundStudy };
}

function encodeTemplateValue(value: string): string {
  return encodeURIComponent(value);
}

function renderTemplate(
  template: string,
  settings: SonicDicomReportSettings,
  context: ReportLookupContext,
  baseUrl: string,
  baseToken: "publicBaseUrl" | "internalBaseUrl"
): string {
  const values: Record<string, string> = {
    publicBaseUrl: settings.sonicDicomPublicBaseUrl.replace(/\/+$/, ""),
    internalBaseUrl: settings.sonicDicomInternalBaseUrl.replace(/\/+$/, ""),
    [baseToken]: baseUrl.replace(/\/+$/, ""),
    username: settings.sonicDicomReportViewerUsername,
    password: settings.sonicDicomReportViewerPassword,
    accessionNumber: context.accessionNumber,
    studyInstanceUid: context.studyInstanceUid ?? "",
  };
  return template.replace(/\{\{(\w+)\}\}/g, (_match, key: string) => {
    const value = values[key] ?? "";
    return key === "publicBaseUrl" || key === "internalBaseUrl" ? value : encodeTemplateValue(value);
  });
}

function resolveLookupTargets(settings: SonicDicomReportSettings, context: ReportLookupContext): Array<"accession_number" | "study_instance_uid"> {
  switch (settings.sonicDicomReportLookupKey) {
    case "study_instance_uid":
      return context.studyInstanceUid ? ["study_instance_uid"] : [];
    case "prefer_study_uid_then_accession":
      return context.studyInstanceUid ? ["study_instance_uid", "accession_number"] : ["accession_number"];
    case "prefer_accession_then_study_uid":
      return context.studyInstanceUid ? ["accession_number", "study_instance_uid"] : ["accession_number"];
    case "accession_number":
    default:
      return ["accession_number"];
  }
}

export function buildSonicDicomReportBrowserUrlWithSettings(
  context: ReportLookupContext,
  requestHostname: string,
  settings: SonicDicomReportSettings
): string {
  const browserBaseUrl = resolveSonicDicomBrowserBaseUrl(requestHostname, settings);
  const targets = resolveLookupTargets(settings, context);
  const target = targets[0];
  if (!target) throw new HttpError(503, "No valid report lookup key is available.");
  let template = settings.sonicDicomPublicReportViewerUrlTemplate || settings.sonicDicomPublicPdfUrlTemplate;
  if (target === "study_instance_uid") {
    template = template.replace(/accessionnumber=\{\{accessionNumber\}\}/i, "studyinstanceuid={{studyInstanceUid}}");
  }
  return renderTemplate(template, settings, context, browserBaseUrl, "publicBaseUrl");
}

export async function buildSonicDicomReportBrowserUrl(context: ReportLookupContext, requestHostname: string): Promise<string> {
  return buildSonicDicomReportBrowserUrlWithSettings(context, requestHostname, await readSonicDicomReportSettings());
}

export function buildSonicDicomImageBrowserUrlWithSettings(
  context: ReportLookupContext,
  requestHostname: string,
  settings: SonicDicomReportSettings
): string {
  const browserBaseUrl = resolveSonicDicomBrowserBaseUrl(requestHostname, settings);
  const targets = resolveLookupTargets(settings, context);
  const target = targets[0];
  if (!target) throw new HttpError(503, "No valid report lookup key is available.");
  let template =
    settings.sonicDicomPublicImageViewerUrlTemplate ||
    settings.sonicDicomPublicReportViewerUrlTemplate ||
    settings.sonicDicomPublicPdfUrlTemplate;
  if (target === "study_instance_uid") {
    template = template.replace(/accessionnumber=\{\{accessionNumber\}\}/i, "studyinstanceuid={{studyInstanceUid}}");
  }
  return renderTemplate(template, settings, context, browserBaseUrl, "publicBaseUrl");
}

export async function buildSonicDicomImageBrowserUrl(context: ReportLookupContext, requestHostname: string): Promise<string> {
  return buildSonicDicomImageBrowserUrlWithSettings(context, requestHostname, await readSonicDicomReportSettings());
}
