import { api } from "@/lib/api-client";
import { mapAuditEntries } from "@/lib/mappers";
import type { AuditEntriesResponse } from "@/types/api";

type RawRecord = Record<string, unknown>;

export interface AuditQueryParams {
  page?: number;
  pageSize?: number;
  dateFrom?: string;
  dateTo?: string;
  changedByUserId?: number | string;
  entityType?: string;
  actionType?: string;
  category?: string;
  search?: string;
  outcome?: string;
}

function auditQueryString(filters: AuditQueryParams): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(filters)) {
    if (value !== undefined && value !== "") params.set(key, String(value));
  }
  const query = params.toString();
  return query ? `?${query}` : "";
}

export async function fetchAuditEntries(filters: AuditQueryParams | number = {}): Promise<AuditEntriesResponse> {
  const params = typeof filters === "number" ? { pageSize: filters } : filters;
  const raw = await api<{ entries: RawRecord[]; pagination: RawRecord; summary: RawRecord; meta: RawRecord }>(`/audit${auditQueryString(params)}`);
  return {
    entries: mapAuditEntries(raw.entries ?? []),
    pagination: raw.pagination as unknown as AuditEntriesResponse["pagination"],
    summary: raw.summary as unknown as AuditEntriesResponse["summary"],
    meta: raw.meta as unknown as AuditEntriesResponse["meta"]
  };
}

export async function exportAuditCSV(filters: AuditQueryParams = {}) {
  // Use fetch directly for blob download
  const response = await fetch(`/api/audit/export${auditQueryString(filters)}`, { credentials: "include" });
  if (!response.ok) throw new Error("Audit export failed");
  const blob = await response.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `audit-export-${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

export async function fetchSystemDiagnosticsSummary() {
  return api<Record<string, unknown>>("/admin/system-diagnostics/summary");
}

export async function fetchSystemDiagnosticEvents(params: Record<string, string | number | undefined> = {}) {
  const query = new URLSearchParams(Object.entries(params).filter(([, value]) => value !== undefined && value !== "").map(([key, value]) => [key, String(value)])).toString();
  return api<{ events: RawRecord[]; page: number; pageSize: number; total: number }>(`/admin/system-diagnostics/events${query ? `?${query}` : ""}`);
}

export async function fetchSystemDiagnosticEvent(eventId: string) {
  return api<{ event: RawRecord }>(`/admin/system-diagnostics/events/${encodeURIComponent(eventId)}`);
}
