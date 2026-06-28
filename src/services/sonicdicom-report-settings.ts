import { getSettingsByCategory } from "./settings-service.js";

export type SonicDicomLookupKey =
  | "accession_number"
  | "study_instance_uid"
  | "prefer_study_uid_then_accession"
  | "prefer_accession_then_study_uid";

export type SonicDicomSearchMode = "api" | "html_scrape" | "auto";
export type SonicDicomReadinessMode = "sql_server" | "api" | "html_scrape";

export interface SonicDicomReportSettings {
  sonicDicomReportsEnabled: boolean;
  sonicDicomPublicBaseUrl: string;
  sonicDicomPublicReportViewerUrlTemplate: string;
  sonicDicomPublicPdfUrlTemplate: string;
  sonicDicomPublicImageViewerUrlTemplate: string;
  sonicDicomStaffImageViewerUrlTemplate: string;
  sonicDicomInternalBaseUrl: string;
  sonicDicomInternalSearchUrlTemplate: string;
  sonicDicomInternalReportViewerUrlTemplate: string;
  sonicDicomInternalPdfUrlTemplate: string;
  sonicDicomReportViewerUsername: string;
  sonicDicomReportViewerPassword: string;
  sonicDicomReportLookupKey: SonicDicomLookupKey;
  sonicDicomReadinessMode: SonicDicomReadinessMode;
  sonicDicomSearchMode: SonicDicomSearchMode;
  sonicDicomFinalStatusTerms: string[];
  sonicDicomDraftStatusTerms: string[];
  sonicDicomNoReportStatusTerms: string[];
  sonicDicomUnavailableStatusTerms: string[];
  sonicDicomTimeoutMs: number;
  sonicDicomStatusCacheTtlSeconds: number;
  sonicDicomVerifyTls: boolean;
  allowPublicFallbackForStatusCheck: boolean;
  auditPatientReportAccess: boolean;
  auditReportStatusChecks: boolean;
  sonicDicomSqlEnabled: boolean;
  sonicDicomSqlServer: string;
  sonicDicomSqlUsername: string;
  sonicDicomSqlPassword: string;
  sonicDicomSqlEncrypt: boolean;
  sonicDicomSqlTrustServerCertificate: boolean;
  sonicDicomSqlTimeoutMs: number;
  sonicDicomDicomDatabaseName: string;
  sonicDicomReportDatabaseName: string;
  sonicDicomSqlFinalStatusCodes: number[];
  sonicDicomSqlDraftStatusCodes: number[];
}

export const DEFAULT_SONICDICOM_REPORT_SETTINGS: SonicDicomReportSettings = {
  sonicDicomReportsEnabled: false,
  sonicDicomPublicBaseUrl: "https://ris.nccb.com.ly/viewer",
  sonicDicomPublicReportViewerUrlTemplate:
    "{{publicBaseUrl}}/#/report?id={{username}}&password={{password}}&accessionnumber={{accessionNumber}}&pdf=true",
  sonicDicomPublicPdfUrlTemplate:
    "{{publicBaseUrl}}/#/report?id={{username}}&password={{password}}&accessionnumber={{accessionNumber}}&pdf=true",
  sonicDicomPublicImageViewerUrlTemplate:
    "{{publicBaseUrl}}/#/viewer?id={{username}}&password={{password}}&accessionnumber={{accessionNumber}}",
  sonicDicomStaffImageViewerUrlTemplate:
    "{{publicBaseUrl}}/#/viewer?accessionnumber={{accessionNumber}}",
  sonicDicomInternalBaseUrl: "",
  sonicDicomInternalSearchUrlTemplate: "",
  sonicDicomInternalReportViewerUrlTemplate:
    "{{internalBaseUrl}}/#/report?id={{username}}&password={{password}}&accessionnumber={{accessionNumber}}&pdf=true",
  sonicDicomInternalPdfUrlTemplate:
    "{{internalBaseUrl}}/#/report?id={{username}}&password={{password}}&accessionnumber={{accessionNumber}}&pdf=true",
  sonicDicomReportViewerUsername: "patient",
  sonicDicomReportViewerPassword: "patient",
  sonicDicomReportLookupKey: "accession_number",
  sonicDicomReadinessMode: "sql_server",
  sonicDicomSearchMode: "auto",
  sonicDicomFinalStatusTerms: ["Final", "Signed", "Approved"],
  sonicDicomDraftStatusTerms: ["Draft", "Preliminary", "In review", "Unsigned"],
  sonicDicomNoReportStatusTerms: ["No report", "Not found", "Empty", "No matching report"],
  sonicDicomUnavailableStatusTerms: ["Unavailable", "Timeout", "Login failed"],
  sonicDicomTimeoutMs: 8000,
  sonicDicomStatusCacheTtlSeconds: 60,
  sonicDicomVerifyTls: true,
  allowPublicFallbackForStatusCheck: false,
  auditPatientReportAccess: true,
  auditReportStatusChecks: true,
  sonicDicomSqlEnabled: false,
  sonicDicomSqlServer: "",
  sonicDicomSqlUsername: "",
  sonicDicomSqlPassword: "",
  sonicDicomSqlEncrypt: true,
  sonicDicomSqlTrustServerCertificate: false,
  sonicDicomSqlTimeoutMs: 8000,
  sonicDicomDicomDatabaseName: "dicom",
  sonicDicomReportDatabaseName: "report",
  sonicDicomSqlFinalStatusCodes: [6],
  sonicDicomSqlDraftStatusCodes: [1],
};

function readRawValue(value: unknown): unknown {
  if (value && typeof value === "object" && !Array.isArray(value) && "value" in (value as Record<string, unknown>)) {
    return (value as Record<string, unknown>).value;
  }
  return value;
}

function asBoolean(value: unknown, fallback: boolean): boolean {
  if (typeof value === "boolean") return value;
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (["true", "1", "enabled", "yes", "on"].includes(normalized)) return true;
    if (["false", "0", "disabled", "no", "off"].includes(normalized)) return false;
  }
  return fallback;
}

function asString(value: unknown, fallback = ""): string {
  if (value == null) return fallback;
  return String(value).trim();
}

function asStringArray(value: unknown, fallback: string[]): string[] {
  if (Array.isArray(value)) return value.map((item) => String(item).trim()).filter(Boolean);
  if (typeof value === "string") return value.split(/[\n,]/).map((item) => item.trim()).filter(Boolean);
  return [...fallback];
}

function asPositiveInteger(value: unknown, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : fallback;
}

function asNumberArray(value: unknown, fallback: number[]): number[] {
  if (Array.isArray(value)) {
    const parsed = value.map((item) => Number(item)).filter((item) => Number.isFinite(item)).map((item) => Math.trunc(item));
    return parsed.length ? parsed : [...fallback];
  }
  if (typeof value === "string") {
    const parsed = value
      .split(/[,\n]/)
      .map((item) => Number(item.trim()))
      .filter((item) => Number.isFinite(item))
      .map((item) => Math.trunc(item));
    return parsed.length ? parsed : [...fallback];
  }
  return [...fallback];
}

function asLookupKey(value: unknown): SonicDicomLookupKey {
  const raw = asString(value, DEFAULT_SONICDICOM_REPORT_SETTINGS.sonicDicomReportLookupKey);
  if (
    raw === "accession_number" ||
    raw === "study_instance_uid" ||
    raw === "prefer_study_uid_then_accession" ||
    raw === "prefer_accession_then_study_uid"
  ) {
    return raw;
  }
  return DEFAULT_SONICDICOM_REPORT_SETTINGS.sonicDicomReportLookupKey;
}

function asSearchMode(value: unknown): SonicDicomSearchMode {
  const raw = asString(value, DEFAULT_SONICDICOM_REPORT_SETTINGS.sonicDicomSearchMode);
  return raw === "api" || raw === "html_scrape" || raw === "auto" ? raw : DEFAULT_SONICDICOM_REPORT_SETTINGS.sonicDicomSearchMode;
}

function asReadinessMode(value: unknown): SonicDicomReadinessMode {
  const raw = asString(value, DEFAULT_SONICDICOM_REPORT_SETTINGS.sonicDicomReadinessMode);
  return raw === "sql_server" || raw === "api" || raw === "html_scrape" ? raw : DEFAULT_SONICDICOM_REPORT_SETTINGS.sonicDicomReadinessMode;
}

export function normalizeSonicDicomReportSettings(raw: unknown): SonicDicomReportSettings {
  const record = raw && typeof raw === "object" && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
  const defaults = DEFAULT_SONICDICOM_REPORT_SETTINGS;
  return {
    sonicDicomReportsEnabled: asBoolean(record.sonicDicomReportsEnabled, defaults.sonicDicomReportsEnabled),
    sonicDicomPublicBaseUrl: asString(record.sonicDicomPublicBaseUrl, defaults.sonicDicomPublicBaseUrl),
    sonicDicomPublicReportViewerUrlTemplate: asString(record.sonicDicomPublicReportViewerUrlTemplate, defaults.sonicDicomPublicReportViewerUrlTemplate),
    sonicDicomPublicPdfUrlTemplate: asString(record.sonicDicomPublicPdfUrlTemplate, defaults.sonicDicomPublicPdfUrlTemplate),
    sonicDicomPublicImageViewerUrlTemplate: asString(record.sonicDicomPublicImageViewerUrlTemplate, defaults.sonicDicomPublicImageViewerUrlTemplate),
    sonicDicomStaffImageViewerUrlTemplate: asString(record.sonicDicomStaffImageViewerUrlTemplate, defaults.sonicDicomStaffImageViewerUrlTemplate),
    sonicDicomInternalBaseUrl: asString(record.sonicDicomInternalBaseUrl, defaults.sonicDicomInternalBaseUrl),
    sonicDicomInternalSearchUrlTemplate: asString(record.sonicDicomInternalSearchUrlTemplate, defaults.sonicDicomInternalSearchUrlTemplate),
    sonicDicomInternalReportViewerUrlTemplate: asString(record.sonicDicomInternalReportViewerUrlTemplate, defaults.sonicDicomInternalReportViewerUrlTemplate),
    sonicDicomInternalPdfUrlTemplate: asString(record.sonicDicomInternalPdfUrlTemplate, defaults.sonicDicomInternalPdfUrlTemplate),
    sonicDicomReportViewerUsername: asString(record.sonicDicomReportViewerUsername, defaults.sonicDicomReportViewerUsername),
    sonicDicomReportViewerPassword: asString(record.sonicDicomReportViewerPassword, defaults.sonicDicomReportViewerPassword),
    sonicDicomReportLookupKey: asLookupKey(record.sonicDicomReportLookupKey),
    sonicDicomReadinessMode: asReadinessMode(record.sonicDicomReadinessMode),
    sonicDicomSearchMode: asSearchMode(record.sonicDicomSearchMode),
    sonicDicomFinalStatusTerms: asStringArray(record.sonicDicomFinalStatusTerms, defaults.sonicDicomFinalStatusTerms),
    sonicDicomDraftStatusTerms: asStringArray(record.sonicDicomDraftStatusTerms, defaults.sonicDicomDraftStatusTerms),
    sonicDicomNoReportStatusTerms: asStringArray(record.sonicDicomNoReportStatusTerms, defaults.sonicDicomNoReportStatusTerms),
    sonicDicomUnavailableStatusTerms: asStringArray(record.sonicDicomUnavailableStatusTerms, defaults.sonicDicomUnavailableStatusTerms),
    sonicDicomTimeoutMs: asPositiveInteger(record.sonicDicomTimeoutMs, defaults.sonicDicomTimeoutMs),
    sonicDicomStatusCacheTtlSeconds: asPositiveInteger(record.sonicDicomStatusCacheTtlSeconds, defaults.sonicDicomStatusCacheTtlSeconds),
    sonicDicomVerifyTls: asBoolean(record.sonicDicomVerifyTls, defaults.sonicDicomVerifyTls),
    allowPublicFallbackForStatusCheck: asBoolean(record.allowPublicFallbackForStatusCheck, defaults.allowPublicFallbackForStatusCheck),
    auditPatientReportAccess: asBoolean(record.auditPatientReportAccess, defaults.auditPatientReportAccess),
    auditReportStatusChecks: asBoolean(record.auditReportStatusChecks, defaults.auditReportStatusChecks),
    sonicDicomSqlEnabled: asBoolean(record.sonicDicomSqlEnabled, defaults.sonicDicomSqlEnabled),
    sonicDicomSqlServer: asString(record.sonicDicomSqlServer, defaults.sonicDicomSqlServer),
    sonicDicomSqlUsername: asString(record.sonicDicomSqlUsername, defaults.sonicDicomSqlUsername),
    sonicDicomSqlPassword: asString(record.sonicDicomSqlPassword, defaults.sonicDicomSqlPassword),
    sonicDicomSqlEncrypt: asBoolean(record.sonicDicomSqlEncrypt, defaults.sonicDicomSqlEncrypt),
    sonicDicomSqlTrustServerCertificate: asBoolean(record.sonicDicomSqlTrustServerCertificate, defaults.sonicDicomSqlTrustServerCertificate),
    sonicDicomSqlTimeoutMs: asPositiveInteger(record.sonicDicomSqlTimeoutMs, defaults.sonicDicomSqlTimeoutMs),
    sonicDicomDicomDatabaseName: asString(record.sonicDicomDicomDatabaseName, defaults.sonicDicomDicomDatabaseName),
    sonicDicomReportDatabaseName: asString(record.sonicDicomReportDatabaseName, defaults.sonicDicomReportDatabaseName),
    sonicDicomSqlFinalStatusCodes: asNumberArray(record.sonicDicomSqlFinalStatusCodes, defaults.sonicDicomSqlFinalStatusCodes),
    sonicDicomSqlDraftStatusCodes: asNumberArray(record.sonicDicomSqlDraftStatusCodes, defaults.sonicDicomSqlDraftStatusCodes),
  };
}

export async function readSonicDicomReportSettings(): Promise<SonicDicomReportSettings> {
  const rows = await getSettingsByCategory("sonicdicom_reports");
  const configRow = rows.find((row) => row.setting_key === "config");
  return normalizeSonicDicomReportSettings(readRawValue(configRow?.setting_value));
}
