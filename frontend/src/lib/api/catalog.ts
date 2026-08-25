import { api } from "@/lib/api-client";
import { mapNameDictionary } from "@/lib/mappers";
import type { PersistedDictionaryEntry } from "@/lib/name-generation";

type RawRecord = Record<string, unknown>;
const CATALOG_IMPORT_TIMEOUT_MS = 180_000;

export interface PatientNotAllowedNameWord {
  id: number;
  arabicText: string;
  normalizedArabicText: string;
  isActive: boolean;
  createdAt: string | null;
  updatedAt: string | null;
}

export async function fetchExamTypes(includeInactive = false): Promise<{ modalities: RawRecord[]; examTypes: RawRecord[] }> {
  const query = includeInactive ? "?includeInactive=true" : "";
  const raw = await api<{ modalities: RawRecord[]; examTypes: RawRecord[] }>(`/settings/exam-types${query}`);
  return raw;
}

export type ModalitySettingsRow = RawRecord & {
  id: number;
  code: string;
  name_ar: string;
  name_en: string;
  daily_capacity: number | null;
  general_instruction_ar: string | null;
  general_instruction_en: string | null;
  is_active: boolean;
  safety_warning_ar: string | null;
  safety_warning_en: string | null;
  safety_warning_enabled: boolean;
    safety_workflow_type?: "standard_acknowledgement" | "mri_primary_implant_screening";
};

export async function fetchModalitiesSettings(includeInactive = false): Promise<{ modalities: ModalitySettingsRow[] }> {
  const query = includeInactive ? "?includeInactive=true" : "";
  const raw = await api<{ modalities: ModalitySettingsRow[] }>(`/settings/modalities${query}`);
  return raw;
}

export async function fetchNameDictionary(): Promise<{ entries: PersistedDictionaryEntry[]; meta: RawRecord }> {
  const raw = await api<{ entries: RawRecord[]; meta?: RawRecord }>("/settings/name-dictionary");
  return {
    entries: mapNameDictionary(raw.entries ?? []),
    meta: raw.meta ?? {}
  };
}

export interface UnresolvedNameDictionaryPatient {
  id: number;
  arabicFullName: string;
  englishFullName: string | null;
  missingTokens: string[];
}

export interface UnresolvedNameDictionaryResponse {
  scannedCount: number;
  unresolvedCount: number;
  patients: UnresolvedNameDictionaryPatient[];
}

export async function fetchUnresolvedNameDictionaryPatients(): Promise<UnresolvedNameDictionaryResponse> {
  return api<UnresolvedNameDictionaryResponse>("/settings/name-dictionary/unresolved-patients");
}

export async function upsertNameDictionaryEntry(arabicText: string, englishText: string) {
  return api<{ entry: RawRecord }>("/settings/name-dictionary", {
    method: "POST",
    body: JSON.stringify({ arabicText, englishText })
  });
}

export async function deleteNameDictionaryEntry(entryId: number) {
  return api<{ entry: RawRecord }>(`/settings/name-dictionary/${entryId}`, { method: "DELETE" });
}

export async function applyNameDictionaryToPatients() {
  return api<{ scannedCount: number; updatedCount: number; skippedMissingTokensCount: number }>("/settings/name-dictionary/apply-to-patients", {
    method: "POST",
    body: JSON.stringify({})
  }, 120_000);
}

export async function importNameDictionary(entries: { arabicText: string; englishText: string }[]) {
  return api<{ entries: RawRecord[] }>("/name-dictionary/import", {
    method: "POST",
    body: JSON.stringify({ entries })
  });
}

function mapPatientNotAllowedNameWord(raw: RawRecord): PatientNotAllowedNameWord {
  return {
    id: Number(raw.id || 0),
    arabicText: String(raw.arabic_text || raw.arabicText || ""),
    normalizedArabicText: String(raw.normalized_arabic_text || raw.normalizedArabicText || ""),
    isActive: raw.is_active === undefined && raw.isActive === undefined
      ? true
      : Boolean(raw.is_active ?? raw.isActive),
    createdAt: raw.created_at || raw.createdAt ? String(raw.created_at || raw.createdAt) : null,
    updatedAt: raw.updated_at || raw.updatedAt ? String(raw.updated_at || raw.updatedAt) : null
  };
}

export async function fetchPatientNotAllowedNameWords(): Promise<{ entries: PatientNotAllowedNameWord[]; meta: RawRecord }> {
  const raw = await api<{ entries: RawRecord[]; meta?: RawRecord }>("/settings/not-allowed-name-words");
  return {
    entries: (raw.entries ?? []).map(mapPatientNotAllowedNameWord),
    meta: raw.meta ?? {}
  };
}

export async function upsertPatientNotAllowedNameWord(arabicText: string) {
  return api<{ entry: RawRecord }>("/settings/not-allowed-name-words", {
    method: "POST",
    body: JSON.stringify({ arabicText })
  });
}

export async function deletePatientNotAllowedNameWord(entryId: number) {
  return api<{ entry: RawRecord }>(`/settings/not-allowed-name-words/${entryId}`, { method: "DELETE" });
}

export async function createModality(payload: RawRecord) {
  return api<{ modality: RawRecord }>("/settings/modalities", {
    method: "POST",
    body: JSON.stringify(payload)
  });
}

export async function updateModality(id: number, payload: RawRecord) {
  return api<{ modality: RawRecord }>(`/settings/modalities/${id}`, {
    method: "PUT",
    body: JSON.stringify(payload)
  });
}

export async function deactivateModality(id: number) {
  return api<{ modality: RawRecord }>(`/settings/modalities/${id}/deactivate`, {
    method: "POST"
  });
}

export async function deleteModality(id: number) {
  return api<{ modality: RawRecord }>(`/settings/modalities/${id}`, { method: "DELETE" });
}

export async function createExamType(payload: RawRecord) {
  return api<{ examType: RawRecord }>("/settings/exam-types", {
    method: "POST",
    body: JSON.stringify(payload)
  });
}

export async function updateExamType(id: number, payload: RawRecord) {
  return api<{ examType: RawRecord }>(`/settings/exam-types/${id}`, {
    method: "PUT",
    body: JSON.stringify(payload)
  });
}

export async function deleteExamType(id: number) {
  return api<{ examType: RawRecord }>(`/settings/exam-types/${id}`, { method: "DELETE" });
}

export async function hardDeleteExamType(id: number) {
  return api<{ examType: RawRecord }>(`/settings/exam-types/${id}/hard-delete`, { method: "DELETE" });
}

export async function exportCatalogWorkbook() {
  const response = await fetch("/api/settings/catalog-import-export.xlsx", { credentials: "include" });
  if (!response.ok) throw new Error("Catalog export failed");
  const blob = await response.blob();
  const url = URL.createObjectURL(blob);
  const disposition = response.headers.get("Content-Disposition") || "";
  const filenameMatch = disposition.match(/filename="?([^"]+)"?/i);
  const filename = filenameMatch?.[1] || "rispro-modalities-exam-types.xlsx";
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export async function importCatalogWorkbook(payload: { fileContentBase64: string }) {
  return api<{
    summary: {
      modalitiesCreated: number;
      modalitiesUpdated: number;
      examTypesCreated: number;
      examTypesUpdated: number;
      skipped: number;
      errors: Array<{ sheet: string; rowNumber: number; column: string | null; message: string }>;
    };
  }>("/settings/catalog-import-export", {
    method: "POST",
    body: JSON.stringify(payload)
  }, CATALOG_IMPORT_TIMEOUT_MS);
}

export async function previewCatalogWorkbookImport(payload: { fileContentBase64: string }) {
  return api<{
    preview: {
      workbook: { sheetNames: string[]; requiredSheets: string[] };
      progressNotes: string[];
      canApply: boolean;
      modalities: Array<Record<string, unknown>>;
      examTypes: Array<Record<string, unknown>>;
      summary: {
        modalitiesTotal: number;
        examTypesTotal: number;
        selectedModalities: number;
        selectedExamTypes: number;
        errors: number;
        warnings: number;
      };
      errors: Array<{ sheet: string; rowNumber: number; column: string | null; message: string; errorType?: string; severity?: string }>;
    };
  }>("/settings/catalog-import-export/preview", {
    method: "POST",
    body: JSON.stringify(payload)
  }, CATALOG_IMPORT_TIMEOUT_MS);
}

export async function applyCatalogWorkbookImport(payload: {
  modalities: Array<Record<string, unknown>>;
  examTypes: Array<Record<string, unknown>>;
}) {
  return api<{
    summary: {
      modalitiesCreated: number;
      modalitiesUpdated: number;
      examTypesCreated: number;
      examTypesUpdated: number;
      skipped: number;
      errors: Array<{ sheet: string; rowNumber: number; column: string | null; message: string }>;
    };
  }>("/settings/catalog-import-export/apply", {
    method: "POST",
    body: JSON.stringify(payload)
  }, CATALOG_IMPORT_TIMEOUT_MS);
}
