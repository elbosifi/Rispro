import { api } from "@/lib/api-client";

export type RequestScanReceptionSummary = {
  needsAttentionCount: number;
  latestProcessedAt: string | null;
  latestFailedAt: string | null;
};

export type RequestScanStatus = {
  failed: number;
};

export async function fetchRequestScanReceptionSummary(): Promise<RequestScanReceptionSummary> {
  return api<RequestScanReceptionSummary>("/request-scans/reception-summary");
}

export async function fetchRequestScanStatus(workflowSource: "modality", modalityId: number): Promise<RequestScanStatus> {
  const params = new URLSearchParams({ workflowSource, modalityId: String(modalityId) });
  return api<RequestScanStatus>(`/request-scans/status?${params.toString()}`);
}
