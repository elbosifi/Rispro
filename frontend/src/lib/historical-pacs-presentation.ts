import type { HistoricalPacsStudy } from "@/types/api";

export function historicalDicomDateToIso(value: string | null | undefined): string | null {
  const match = value?.trim().match(/^(\d{4})(\d{2})(\d{2})$/);
  if (!match) return null;
  const [, year, month, day] = match;
  const date = new Date(Date.UTC(Number(year), Number(month) - 1, Number(day)));
  return date.getUTCFullYear() === Number(year) && date.getUTCMonth() === Number(month) - 1 && date.getUTCDate() === Number(day) ? `${year}-${month}-${day}` : null;
}

export function shouldHideHistoricalCandidateStudy(study: HistoricalPacsStudy): boolean {
  const reconciliation = study.reconciliation;
  if (!reconciliation) return false;
  if (reconciliation.operationType === "reconcile" && reconciliation.status === "completed") return true;
  return reconciliation.operationType === "reverse" && ["queued", "processing", "failed"].includes(reconciliation.status);
}
