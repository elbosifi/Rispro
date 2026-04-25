import { HttpError } from "../utils/http-error.js";
import { logAuditEntry } from "./audit-service.js";
import { readSonicDicomReportSettings, type SonicDicomReportSettings } from "./sonicdicom-report-settings.js";

export type SonicDicomReportState =
  | "final"
  | "draft"
  | "no_report"
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
}

export interface SonicDicomSqlTestResult {
  foundStudy: boolean;
  foundReport: boolean;
  normalizedState: SonicDicomReportState;
  canViewReport: boolean;
  statusCode: number | null;
  diagnostic: string;
}

interface CacheEntry {
  expiresAt: number;
  result: ReportStatusResult;
}

interface SqlReadinessRow {
  FoundStudy?: number;
  FoundReport?: number;
  Status?: number | null;
}

type SqlModule = {
  ConnectionPool: new (config: unknown) => {
    connect: () => Promise<void>;
    close: () => Promise<void>;
    request: () => {
      input: (name: string, type: unknown, value: unknown) => unknown;
      query: <T = unknown>(sql: string) => Promise<{ recordset: T[] }>;
    };
  };
  NVarChar: (size?: number) => unknown;
};

const statusCache = new Map<number, CacheEntry>();

function validateDatabaseName(name: string, fallback: string): string {
  const trimmed = String(name || "").trim() || fallback;
  if (!/^[A-Za-z0-9_]+$/.test(trimmed)) return fallback;
  return trimmed;
}

async function loadSqlModule(): Promise<SqlModule | null> {
  try {
    const importer = new Function("specifier", "return import(specifier)") as (specifier: string) => Promise<unknown>;
    const imported = await importer("mssql");
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
  work: (ctx: { sql: SqlModule; pool: any }) => Promise<T>
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
  pool: any,
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

async function querySqlReportReadinessByAccession(
  pool: any,
  sql: SqlModule,
  dicomDb: string,
  reportDb: string,
  accessionNumber: string
): Promise<{ foundStudy: boolean; foundReport: boolean; statusCode: number | null }> {
  const request = pool.request();
  request.input("accessionNumber", sql.NVarChar(128), accessionNumber);
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
       select top 1 d.Report, d.Status, d.UpdatedAt
       from [${reportDb}].[dbo].[Documents] d
       inner join ReportMatch r
         on d.Report = r.ReportNo
       order by d.UpdatedAt desc
     )
     select
       case when exists (select 1 from StudyMatch) then 1 else 0 end as FoundStudy,
       case when exists (select 1 from ReportMatch) then 1 else 0 end as FoundReport,
       (select top 1 Status from LatestDocument) as Status`
  );

  const row = result.recordset?.[0] ?? {};
  const foundStudy = Number(row.FoundStudy || 0) === 1;
  const foundReport = Number(row.FoundReport || 0) === 1;
  const numericStatus = Number(row.Status);
  const statusCode = row.Status == null ? null : Number.isFinite(numericStatus) ? Math.trunc(numericStatus) : null;
  return { foundStudy, foundReport, statusCode };
}

async function queryReportStatusByReportNo(
  pool: any,
  sql: SqlModule,
  reportDb: string,
  reportNo: string
): Promise<{ statusCode: number | null; foundRow: boolean }> {
  const request = pool.request();
  request.input("reportNo", sql.NVarChar(128), reportNo);
  const result = await request.query<{ Status?: number }>(
    `select top 1 d.Status
     from [${reportDb}].[dbo].[Documents] d
     where d.Report = @reportNo
     order by d.UpdatedAt desc`
  );
  const row = result.recordset?.[0];
  if (!row) return { statusCode: null, foundRow: false };
  const numeric = Number(row.Status);
  return { statusCode: Number.isFinite(numeric) ? Math.trunc(numeric) : null, foundRow: true };
}

function mapStatusCode(settings: SonicDicomReportSettings, statusCode: number | null): ReportStatusResult {
  if (statusCode == null) return { state: "no_report", canViewReport: false, source: "sonicdicom" };
  if (settings.sonicDicomSqlFinalStatusCodes.includes(statusCode)) return { state: "final", canViewReport: true, source: "sonicdicom" };
  if (settings.sonicDicomSqlDraftStatusCodes.includes(statusCode)) return { state: "draft", canViewReport: false, source: "sonicdicom" };
  return { state: "unavailable", canViewReport: false, source: "sonicdicom" };
}

async function resolveSqlReadiness(
  settings: SonicDicomReportSettings,
  context: { accessionNumber: string }
): Promise<{ foundStudy: boolean; foundReport: boolean; statusCode: number | null; result: ReportStatusResult; diagnostic: string }> {
  const dicomDb = validateDatabaseName(settings.sonicDicomDicomDatabaseName, "dicom");
  const reportDb = validateDatabaseName(settings.sonicDicomReportDatabaseName, "report");
  return withSqlConnection(settings, async ({ sql, pool }) => {
    const accession = String(context.accessionNumber || "").trim();
    if (!accession) {
      return {
        foundStudy: false,
        foundReport: false,
        statusCode: null,
        result: { state: "no_report", canViewReport: false, source: "sonicdicom" },
        diagnostic: "No accession number was provided for SQL readiness lookup.",
      };
    }

    const readiness = await querySqlReportReadinessByAccession(pool, sql, dicomDb, reportDb, accession);
    if (!readiness.foundStudy) {
      return {
        foundStudy: false,
        foundReport: false,
        statusCode: null,
        result: { state: "no_report", canViewReport: false, source: "sonicdicom" },
        diagnostic: "No matching StudyInstanceUID was found in dicom.dbo.Studies.",
      };
    }
    if (!readiness.foundReport) {
      return {
        foundStudy: true,
        foundReport: false,
        statusCode: null,
        result: { state: "no_report", canViewReport: false, source: "sonicdicom" },
        diagnostic: "No report mapping was found in report.dbo.Reports for the study.",
      };
    }
    if (readiness.statusCode == null) {
      return {
        foundStudy: true,
        foundReport: true,
        statusCode: null,
        result: { state: "no_report", canViewReport: false, source: "sonicdicom" },
        diagnostic: "No matching document status row was found in report.dbo.Documents.",
      };
    }

    const mapped = mapStatusCode(settings, readiness.statusCode);
    return {
      foundStudy: true,
      foundReport: true,
      statusCode: readiness.statusCode,
      result: mapped,
      diagnostic:
        mapped.state === "unavailable"
          ? "Document status code is unknown for current SQL mapping and was treated as unavailable."
          : "SQL readiness lookup completed.",
    };
  });
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
  }
): string {
  if (state === "final") return settings.qrReportFinalMessage || "";
  if (state === "draft") return settings.qrReportDraftMessage || "";
  if (state === "no_report") return settings.qrReportNoReportMessage || "";
  if (state === "not_required") return settings.qrReportNotRequiredMessage || "";
  if (state === "not_completed") return settings.qrReportNotCompletedMessage || "";
  return settings.qrReportUnavailableMessage || "";
}

export async function checkSonicDicomReportStatus(
  context: ReportLookupContext,
  options: { useCache?: boolean } = {}
): Promise<ReportStatusResult> {
  const settings = await readSonicDicomReportSettings();
  if (!settings.sonicDicomReportsEnabled) return { state: "disabled", canViewReport: false, source: "rispro" };
  if (settings.sonicDicomReadinessMode !== "sql_server") return { state: "unavailable", canViewReport: false, source: "sonicdicom" };

  if (options.useCache !== false) {
    const cached = statusCache.get(context.bookingId);
    if (cached && cached.expiresAt > Date.now()) return cached.result;
  }

  let result: ReportStatusResult = { state: "unavailable", canViewReport: false, source: "sonicdicom" };
  try {
    const resolved = await resolveSqlReadiness(settings, { accessionNumber: context.accessionNumber });
    result = resolved.result;
  } catch {
    result = { state: "unavailable", canViewReport: false, source: "sonicdicom" };
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
          diagnostic: "Report number is required for report-status test.",
        };
      }
      const statusLookup = await withSqlConnection(settings, async ({ sql, pool }) =>
        queryReportStatusByReportNo(pool, sql, reportDb, reportNo)
      );
      const mapped = statusLookup.foundRow
        ? mapStatusCode(settings, statusLookup.statusCode)
        : { state: "no_report", canViewReport: false, source: "sonicdicom" as const };
      return {
        foundStudy: false,
        foundReport: statusLookup.foundRow,
        normalizedState: mapped.state,
        canViewReport: mapped.canViewReport,
        statusCode: statusLookup.statusCode,
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
      diagnostic: full.diagnostic,
    };
  } catch (error) {
    return {
      foundStudy: false,
      foundReport: false,
      normalizedState: "unavailable",
      canViewReport: false,
      statusCode: null,
      diagnostic: error instanceof Error ? error.message : "SQL readiness test failed.",
    };
  }
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

export async function buildPublicSonicDicomReportUrl(context: ReportLookupContext): Promise<string> {
  const settings = await readSonicDicomReportSettings();
  const publicBaseUrl = settings.sonicDicomPublicBaseUrl.trim();
  if (!publicBaseUrl) throw new HttpError(503, "Public SonicDICOM URL is not configured.");
  try {
    new URL(publicBaseUrl);
  } catch {
    throw new HttpError(503, "Public SonicDICOM URL is malformed.");
  }
  const targets = resolveLookupTargets(settings, context);
  const target = targets[0];
  if (!target) throw new HttpError(503, "No valid report lookup key is available.");
  let template = settings.sonicDicomPublicReportViewerUrlTemplate || settings.sonicDicomPublicPdfUrlTemplate;
  if (target === "study_instance_uid") {
    template = template.replace(/accessionnumber=\{\{accessionNumber\}\}/i, "studyinstanceuid={{studyInstanceUid}}");
  }
  return renderTemplate(template, settings, context, publicBaseUrl, "publicBaseUrl");
}
