import { api } from "@/lib/api-client";

export type SopStatus = "draft" | "published" | "archived";
export type SopVersionStatus = "draft" | "published" | "superseded";
export interface SopSectionDefinition { key: string; title: string; required: boolean; }
export interface SopSection { key: string; title: string; required: boolean; content: Record<string, unknown>; }
export interface SopDocument { type: "sop"; version: 1; sections: SopSection[]; }
export interface SopVersion {
  id: number;
  sopId: number;
  version: string;
  status: SopVersionStatus;
  contentJson: SopDocument;
  changeSummary: string;
  effectiveDate: string | null;
  createdByUserId: number;
  createdByName: string | null;
  createdByUsername: string | null;
  createdAt: string;
  updatedByUserId: number | null;
  updatedByName: string | null;
  updatedAt: string;
  publishedByUserId: number | null;
  publishedByName: string | null;
  publishedByUsername: string | null;
  publishedAt: string | null;
}
export interface SopSummary {
  id: number;
  code: string;
  title: string;
  category: string;
  status: SopStatus;
  currentVersion: string | null;
  draftVersion: string | null;
  currentEffectiveDate: string | null;
  createdByUserId: number;
  createdByName: string | null;
  createdAt: string;
  updatedByUserId: number | null;
  updatedByName: string | null;
  updatedAt: string;
}
export interface SopDetail { sop: SopSummary; versions: SopVersion[]; }
export interface SopMeta { categories: string[]; sections: SopSectionDefinition[]; }
export interface SopXlsxSectionPreview {
  sectionKey: string;
  sectionTitle: string;
  action: "changed" | "unchanged" | "invalid";
  errors: string[];
  currentText: string;
  importedText: string;
}
export interface SopXlsxInspect {
  format: "xlsx";
  formatVersion: string | null;
  sheetName: string;
  columns: string[];
  missingColumns: string[];
  sectionCount: number;
  metadata: {
    sopCode: string | null;
    title: string | null;
    category: string | null;
    sourceVersion: string | null;
    effectiveDate: string | null;
    changeSummary: string | null;
  };
  structuralErrors: string[];
}
export interface SopXlsxPreview {
  format: "xlsx";
  formatVersion: string | null;
  sheetName: string;
  columns: string[];
  missingColumns: string[];
  sectionCount: number;
  sopCode: string | null;
  title: string | null;
  category: string | null;
  sourceVersion: string | null;
  targetVersion: string;
  targetUpdatedAt: string;
  sections: SopXlsxSectionPreview[];
  effectiveDate: { current: string | null; imported: string | null; changed: boolean };
  changeSummary: { current: string; imported: string; changed: boolean };
  errors: string[];
  canConfirm: boolean;
}
export interface SopXlsxConfirmResult {
  sop: SopSummary;
  version: SopVersion;
  summary: {
    changedSectionKeys: string[];
    effectiveDateChanged: boolean;
    changeSummaryChanged: boolean;
    sourceVersion: string;
    targetVersion: string;
  };
}

export const fetchSopMeta = () => api<SopMeta>("/sops/meta");
export const fetchSops = (filters: { search?: string; category?: string; status?: string } = {}) => {
  const params = new URLSearchParams();
  if (filters.search) params.set("search", filters.search);
  if (filters.category) params.set("category", filters.category);
  if (filters.status) params.set("status", filters.status);
  const query = params.toString();
  return api<{ sops: SopSummary[] }>(`/sops${query ? `?${query}` : ""}`);
};
export const fetchSop = (id: number) => api<SopDetail>(`/sops/${id}`);
export const fetchSopVersion = (id: number, version: string) => api<{ version: SopVersion }>(`/sops/${id}/versions/${encodeURIComponent(version)}`);
export const createSop = (payload: { title: string; code: string; category: string; version: string; effectiveDate: string; changeSummary: string; contentJson: SopDocument }) => api<{ sop: SopSummary; version: SopVersion }>("/sops", { method: "POST", body: JSON.stringify(payload) });
export const updateSopDraft = (id: number, version: string, payload: { title: string; category: string; effectiveDate: string; changeSummary: string; contentJson: SopDocument }) => api<{ sop: SopSummary; version: SopVersion }>(`/sops/${id}/versions/${encodeURIComponent(version)}`, { method: "PATCH", body: JSON.stringify(payload) });
export const createSopRevision = (id: number, payload: { version: string; changeSummary: string; effectiveDate?: string }) => api<{ version: SopVersion }>(`/sops/${id}/revisions`, { method: "POST", body: JSON.stringify(payload) });
export const publishSopVersion = (id: number, version: string) => api<{ sop: SopSummary; version: SopVersion }>(`/sops/${id}/versions/${encodeURIComponent(version)}/publish`, { method: "POST", body: JSON.stringify({}) });
export const archiveSop = (id: number) => api<{ sop: SopSummary }>(`/sops/${id}/archive`, { method: "POST", body: JSON.stringify({}) });

export async function downloadSopXlsx(id: number, version: string): Promise<void> {
  const response = await fetch(`/api/sops/${id}/versions/${encodeURIComponent(version)}/export.xlsx`, { credentials: "include" });
  if (!response.ok) {
    let message = "Workbook download failed.";
    try {
      const body = await response.json() as { error?: { message?: string } };
      message = body.error?.message || message;
    } catch { /* Keep the safe fallback for non-JSON download errors. */ }
    throw new Error(message);
  }
  const disposition = response.headers.get("Content-Disposition") || "";
  const filename = disposition.match(/filename="?([^";]+)"?/i)?.[1] || `sop-v${version}.xlsx`;
  const url = URL.createObjectURL(await response.blob());
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}

export const inspectSopXlsxImport = (id: number, version: string, payload: { fileContentBase64: string; fileName?: string | null }) =>
  api<SopXlsxInspect>(`/sops/${id}/versions/${encodeURIComponent(version)}/import/inspect`, { method: "POST", body: JSON.stringify(payload) });
export const previewSopXlsxImport = (id: number, version: string, payload: { fileContentBase64: string; fileName?: string | null }) =>
  api<SopXlsxPreview>(`/sops/${id}/versions/${encodeURIComponent(version)}/import/preview`, { method: "POST", body: JSON.stringify(payload) });
export const confirmSopXlsxImport = (id: number, version: string, payload: { fileContentBase64: string; fileName?: string | null; expectedDraftUpdatedAt: string }) =>
  api<SopXlsxConfirmResult>(`/sops/${id}/versions/${encodeURIComponent(version)}/import/confirm`, { method: "POST", body: JSON.stringify(payload) });
