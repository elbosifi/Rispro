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
