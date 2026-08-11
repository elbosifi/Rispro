import { api } from "@/lib/api-client";
import type { PatientImportBatch, PatientImportStagingRow } from "@/types/api";

const IMPORT_WORKBOOK_TIMEOUT_MS = 180_000;
const IMPORT_PREVIEW_TIMEOUT_MS = 180_000;
const IMPORT_CONFIRM_TIMEOUT_MS = 180_000;

export async function previewPatientImport(payload: {
  fileName: string;
  fileContentBase64: string;
  sheetName?: string;
  patientCategory?: "oncology" | "non_oncology";
  mapping: {
    arabic_full_name: string;
    national_id: string;
    phone?: string;
  };
}): Promise<{
  batch: PatientImportBatch;
  summary: Record<string, number>;
  workbook: { sheetNames: string[]; selectedSheetName: string; headers: string[] };
}> {
  return api("/settings/patient-import/preview", {
    method: "POST",
    body: JSON.stringify(payload)
  }, IMPORT_PREVIEW_TIMEOUT_MS);
}

export async function inspectPatientImportWorkbook(payload: {
  fileContentBase64: string;
  sheetName?: string;
}): Promise<{ workbook: { sheetNames: string[]; selectedSheetName: string; headers: string[] } }> {
  return api("/settings/patient-import/workbook", {
    method: "POST",
    body: JSON.stringify(payload)
  }, IMPORT_WORKBOOK_TIMEOUT_MS);
}

export async function fetchPatientImportBatch(batchId: number): Promise<PatientImportBatch> {
  const raw = await api<{ batch: PatientImportBatch }>(`/settings/patient-import/batches/${batchId}`);
  return raw.batch;
}

export async function fetchPatientImportRows(batchId: number): Promise<PatientImportStagingRow[]> {
  const raw = await api<{ rows: PatientImportStagingRow[] }>(`/settings/patient-import/batches/${batchId}/rows`);
  return raw.rows || [];
}

export async function selectPatientImportRows(batchId: number, rowIds: number[], selected: boolean): Promise<{ updated: number }> {
  return api<{ updated: number }>(`/settings/patient-import/batches/${batchId}/select`, {
    method: "POST",
    body: JSON.stringify({ rowIds, selected })
  });
}

export async function confirmPatientImportBatch(batchId: number): Promise<{ migrated: number; skipped: number }> {
  return api<{ migrated: number; skipped: number }>(`/settings/patient-import/batches/${batchId}/confirm`, {
    method: "POST"
  }, IMPORT_CONFIRM_TIMEOUT_MS);
}
