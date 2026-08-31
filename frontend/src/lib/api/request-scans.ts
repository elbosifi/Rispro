import { api } from "@/lib/api-client";

export type RequestScanReceptionSummary = {
  needsAttentionCount: number;
  latestProcessedAt: string | null;
  latestFailedAt: string | null;
};

export async function fetchRequestScanReceptionSummary(): Promise<RequestScanReceptionSummary> {
  return api<RequestScanReceptionSummary>("/request-scans/reception-summary");
}
