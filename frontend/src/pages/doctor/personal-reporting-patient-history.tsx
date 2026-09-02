import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { AlertTriangle, ExternalLink, History as HistoryIcon, Monitor } from "lucide-react";

import {
  fetchReportingBoardComparisonHistoricalPacsCandidates,
  fetchReportingBoardComparisonHistory,
  fetchReportingBoardHistoricalPacsCandidates,
  fetchReportingBoardPatientHistory,
} from "@/lib/api-hooks";
import { Badge, Button, Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/shared";
import type { HistoricalPacsCandidate, HistoricalPacsIndexStatus, ProtocolingPatientHistoryItem, ProtocolingPatientHistoryResponse, ReportingBoardMobileCase } from "@/types/api";
import { buildRadiantPacsTagUrl, isWindowsWorkstation } from "./doctor-reporting-board-page.helpers";

export type PersonalReportingHistoryCase = Pick<
  ReportingBoardMobileCase,
  | "caseType"
  | "appointmentId"
  | "comparisonRequestId"
  | "patientName"
  | "linkedPreviousStudyDate"
  | "linkedPreviousAccessionNumber"
  | "comparisonReason"
>;

function useIsMobileViewport(): boolean {
  const matchesMobile = () => typeof window !== "undefined"
    && typeof window.matchMedia === "function"
    && window.matchMedia("(max-width: 767px)").matches;
  const [isMobile, setIsMobile] = useState(matchesMobile);

  useEffect(() => {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") return undefined;
    const media = window.matchMedia("(max-width: 767px)");
    const update = () => setIsMobile(media.matches);
    update();
    media.addEventListener?.("change", update);
    return () => media.removeEventListener?.("change", update);
  }, []);

  return isMobile;
}

function historySourceLabel(source: ProtocolingPatientHistoryItem["source"]): string {
  if (source === "rispro_pacs") return "RISpro + PACS";
  if (source === "rispro_only") return "RISpro only";
  return "PACS only";
}

function historyStatusLabel(status: string | null): string | null {
  if (!status) return null;
  return status.replaceAll("_", " ").replace(/^(.)/, (character) => character.toUpperCase());
}

function candidateClassificationLabel(classification: HistoricalPacsCandidate["classification"]): string {
  if (classification === "strong_demographic") return "Strong demographic match";
  if (classification === "possible") return "Possible match";
  if (classification === "ambiguous") return "Ambiguous match";
  return "Exact match";
}

function dateSortValue(value: string | null): string | null {
  const clean = value?.trim();
  if (!clean) return null;
  const isoDate = clean.match(/^\d{4}-\d{2}-\d{2}/)?.[0];
  if (isoDate) return isoDate;
  const compactDate = clean.match(/^\d{8}/)?.[0];
  return compactDate ?? clean;
}

function sortCurrentHistory(items: ProtocolingPatientHistoryItem[]): ProtocolingPatientHistoryItem[] {
  return [...items].sort((left, right) => {
    const leftDate = dateSortValue(left.date);
    const rightDate = dateSortValue(right.date);
    if (!leftDate && !rightDate) return 0;
    if (!leftDate) return 1;
    if (!rightDate) return -1;
    return rightDate.localeCompare(leftDate);
  });
}

function historyStudyPath(caseIdentity: PersonalReportingHistoryCase, accession: string): string {
  const base = caseIdentity.caseType === "appointment"
    ? `/api/doctor/reporting-board/cases/${caseIdentity.appointmentId}/history/open-sonicdicom`
    : `/api/doctor/reporting-board/comparisons/${caseIdentity.comparisonRequestId}/history/open-sonicdicom`;
  return `${base}?accession=${encodeURIComponent(accession)}`;
}

function HistoryStudyActions({ caseIdentity, accession }: { caseIdentity: PersonalReportingHistoryCase; accession: string | null }) {
  const isMobile = useIsMobileViewport();
  const normalizedAccession = accession?.trim() ?? "";
  if (!normalizedAccession) return null;
  const actionClasses = isMobile
    ? "btn-secondary inline-flex h-9 w-9 items-center justify-center p-0"
    : "btn-secondary inline-flex h-9 items-center gap-1.5 px-2.5 text-sm";
  return (
    <div className="flex min-w-0 flex-wrap items-center gap-2">
      <a
        href={historyStudyPath(caseIdentity, normalizedAccession)}
        target="_blank"
        rel="noopener noreferrer"
        aria-label="Open in SonicDICOM"
        title="Open in SonicDICOM"
        className={actionClasses}
      >
        <ExternalLink size={15} aria-hidden="true" />
        <span className={isMobile ? "sr-only" : undefined}>SonicDICOM</span>
      </a>
      {!isMobile && isWindowsWorkstation() ? (
        <a
          href={buildRadiantPacsTagUrl("00080050", normalizedAccession)}
          target="_blank"
          rel="noopener noreferrer"
          aria-label="Open in RadiAnt"
          title="Open in RadiAnt"
          className={actionClasses}
        >
          <Monitor size={15} aria-hidden="true" />
          <span>RadiAnt</span>
        </a>
      ) : null}
    </div>
  );
}

export function PersonalReportingHistoryButton({ onClick }: { onClick: () => void }) {
  return (
    <Button
      type="button"
      variant="secondary"
      size="sm"
      onClick={onClick}
      aria-label="Patient History"
      title="Patient History"
      className="w-9 px-0 sm:w-auto sm:px-3"
    >
      <HistoryIcon size={15} aria-hidden="true" />
      <span className="sr-only sm:not-sr-only">History</span>
    </Button>
  );
}

function CurrentStudyRow({ caseIdentity, item, requestedAccession }: { caseIdentity: PersonalReportingHistoryCase; item: ProtocolingPatientHistoryItem; requestedAccession: string | null }) {
  const status = historyStatusLabel(item.appointmentStatus);
  const isRequestedPrior = Boolean(requestedAccession && item.accessionNumber?.trim() === requestedAccession);
  return (
    <article className="min-w-0 rounded-lg border border-slate-200 bg-white p-3 text-sm">
      <div className="flex min-w-0 flex-wrap items-start justify-between gap-2">
        <p className="min-w-0 break-words font-semibold">
          {item.date ?? "Unknown date"} · {item.description ?? "Study"}
        </p>
        {isRequestedPrior ? <Badge variant="info" size="sm">Requested prior</Badge> : null}
      </div>
      <p className="mt-1 min-w-0 break-words">Modality: {item.modalities.length ? item.modalities.join("/") : "Unknown"}</p>
      <p className="min-w-0 break-all">Accession: {item.accessionNumber ?? "Unavailable"}</p>
      <p className="mt-1 text-xs text-slate-600">
        Source: {historySourceLabel(item.source)}{status ? ` · Status: ${status}` : ""}
      </p>
      {item.identityDiscrepancy === "patient_id_mismatch" ? (
        <p className="mt-2 flex items-start gap-2 text-xs font-medium text-amber-800">
          <AlertTriangle size={14} className="mt-0.5 shrink-0" aria-hidden="true" />
          Patient ID mismatch detected. Verify identity before clinical use.
        </p>
      ) : null}
      <div className="mt-2">
        <HistoryStudyActions caseIdentity={caseIdentity} accession={item.accessionNumber} />
      </div>
    </article>
  );
}

function HistoricalCandidateCard({ caseIdentity, candidate }: { caseIdentity: PersonalReportingHistoryCase; candidate: HistoricalPacsCandidate }) {
  return (
    <article className="min-w-0 rounded-lg border border-amber-300 bg-amber-50/80 p-3 text-sm">
      <div className="flex min-w-0 flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="break-all font-semibold">Historical Patient ID: {candidate.historicalPatientId}</p>
          {candidate.patientName ? <p className="mt-1 break-words">Patient name: {candidate.patientName}</p> : null}
        </div>
        <Badge variant="warning" size="sm">{candidateClassificationLabel(candidate.classification)}</Badge>
      </div>
      <p className="mt-2 text-xs text-amber-900">
        Study count: {candidate.studyCount}
        {candidate.patientBirthDate ? ` · DOB: ${candidate.patientBirthDate}` : ""}
        {candidate.patientSex ? ` · Sex: ${candidate.patientSex}` : ""}
      </p>
      {candidate.reasons.length ? (
        <details className="mt-2 text-xs text-amber-900">
          <summary className="cursor-pointer font-semibold">Why this matched</summary>
          <ul className="mt-1 list-disc space-y-1 pl-5">
            {candidate.reasons.map((reason) => <li key={reason}>{reason}</li>)}
          </ul>
        </details>
      ) : null}
      <div className="mt-3 space-y-2">
        {candidate.studies.map((study) => (
          <div key={`${candidate.historicalPatientId}-${study.studyInstanceUid ?? study.accessionNumber ?? study.orthancStudyId}`} className="min-w-0 rounded-md border border-amber-200 bg-white/70 p-2">
            <p className="min-w-0 break-words font-medium">{study.studyDate ?? "Unknown date"} · {study.studyDescription ?? "Study"}</p>
            <p className="mt-1 min-w-0 break-words">Modality: {study.modalitiesInStudy.length ? study.modalitiesInStudy.join("/") : "Unknown"}</p>
            <p className="min-w-0 break-all">Accession: {study.accessionNumber ?? "Unavailable"}</p>
            <div className="mt-2">
              <HistoryStudyActions caseIdentity={caseIdentity} accession={study.accessionNumber} />
            </div>
          </div>
        ))}
      </div>
    </article>
  );
}

function historicalIndexWarning(status: HistoricalPacsIndexStatus | undefined): string | null {
  if (status === "stale") return "The historical PACS index is stale; no candidates is not proof that no historical study exists.";
  if (status === "unavailable") return "The historical PACS index is unavailable; no candidates is not proof that no historical study exists.";
  if (status === "uninitialized") return "The historical PACS index has not been initialized; no candidates is not proof that no historical study exists.";
  return null;
}

export function PersonalReportingPatientHistory({
  caseIdentity,
  authorized,
  onClose,
}: {
  caseIdentity: PersonalReportingHistoryCase;
  authorized: boolean;
  onClose: () => void;
}) {
  const isAppointment = caseIdentity.caseType === "appointment";
  const historyQuery = useQuery<ProtocolingPatientHistoryResponse>({
    queryKey: ["personal-reporting-desk", "history", caseIdentity.caseType, isAppointment ? caseIdentity.appointmentId : caseIdentity.comparisonRequestId],
    queryFn: () => isAppointment
      ? fetchReportingBoardPatientHistory(caseIdentity.appointmentId)
      : fetchReportingBoardComparisonHistory(caseIdentity.comparisonRequestId!),
    enabled: authorized,
  });
  const historicalCandidatesQuery = useQuery({
    queryKey: ["personal-reporting-desk", "historical-candidates", caseIdentity.caseType, isAppointment ? caseIdentity.appointmentId : caseIdentity.comparisonRequestId],
    queryFn: () => isAppointment
      ? fetchReportingBoardHistoricalPacsCandidates(caseIdentity.appointmentId)
      : fetchReportingBoardComparisonHistoricalPacsCandidates(caseIdentity.comparisonRequestId!),
    enabled: authorized,
  });

  if (!authorized) return null;

  const history = historyQuery.data;
  const candidates = historicalCandidatesQuery.data?.historicalCandidates ?? [];
  const requestedAccession = caseIdentity.linkedPreviousAccessionNumber?.trim() || null;
  const sortedItems = history ? sortCurrentHistory(history.items) : [];
  const indexStatus = historicalCandidatesQuery.data?.historicalPacsIndexStatus ?? history?.historicalPacsIndexStatus;

  return (
    <Dialog open onClose={onClose}>
      <DialogContent
        maxWidth="860px"
        scrollable={false}
        className="flex min-h-0 min-w-0 flex-col overflow-hidden sm:max-h-[calc(100vh-32px)]"
      >
        <DialogHeader>
          <DialogTitle>Patient History</DialogTitle>
        </DialogHeader>
        <div className="min-h-0 max-h-[calc(92dvh-140px)] flex-1 space-y-5 overflow-x-hidden overflow-y-auto overscroll-contain pr-1 sm:max-h-[calc(100vh-220px)]">
          {caseIdentity.caseType === "comparison" ? (
            <section className="min-w-0 rounded-lg border border-teal-100 bg-teal-50/50 p-3 text-sm" aria-label="Requested comparison prior">
              <h3 className="font-semibold">Requested comparison prior</h3>
              <div className="mt-2 grid min-w-0 gap-2 sm:grid-cols-3">
                <p className="min-w-0 break-words"><b>Date:</b> {caseIdentity.linkedPreviousStudyDate ?? "Unavailable"}</p>
                <p className="min-w-0 break-all"><b>Accession:</b> {caseIdentity.linkedPreviousAccessionNumber ?? "Unavailable"}</p>
                <p className="min-w-0 break-words sm:col-span-3"><b>Reason:</b> {caseIdentity.comparisonReason ?? "Unavailable"}</p>
              </div>
            </section>
          ) : null}

          <section aria-labelledby="current-history-heading">
            <h3 id="current-history-heading" className="text-base font-semibold">Current RISpro / PACS studies</h3>
            {historyQuery.isLoading ? <p className="mt-2 text-sm text-slate-600">Loading patient history…</p> : null}
            {historyQuery.isError ? <p className="mt-2 text-sm text-red-700">Unable to load patient history.</p> : null}
            {history?.pacsStatus === "unavailable" ? <p className="mt-2 rounded-md bg-amber-50 p-2 text-xs text-amber-900">PACS history could not currently be queried. RISpro history remains usable.</p> : null}
            {history?.pacsStatus === "patient_id_unavailable" ? <p className="mt-2 rounded-md bg-amber-50 p-2 text-xs text-amber-900">PACS Patient ID is unavailable; PACS history may be incomplete.</p> : null}
            {history?.items.some((item) => item.identityDiscrepancy === "patient_id_mismatch") ? <p className="mt-2 rounded-md bg-amber-50 p-2 text-xs text-amber-900">A patient ID mismatch was detected in current history. Verify identity before clinical use.</p> : null}
            {history && sortedItems.length === 0 ? <p className="mt-2 text-sm text-slate-500">No current RISpro/PACS history found.</p> : null}
            {sortedItems.length ? <div className="mt-2 space-y-2">{sortedItems.map((item) => <CurrentStudyRow key={`${item.appointmentId ?? "pacs"}-${item.accessionNumber ?? item.orthancStudyId}`} caseIdentity={caseIdentity} item={item} requestedAccession={requestedAccession} />)}</div> : null}
          </section>

          <section aria-labelledby="historical-history-heading" className="min-w-0 border-t border-amber-200 pt-4">
            <h3 id="historical-history-heading" className="text-base font-semibold text-amber-950">Possible historical PACS matches</h3>
            <p className="mt-1 text-xs text-amber-900">These studies may belong to this patient under an older Patient ID. Verify identity before clinical use.</p>
            {historicalCandidatesQuery.isLoading ? <p className="mt-2 text-sm text-slate-600">Searching historical PACS…</p> : null}
            {historicalCandidatesQuery.isError ? <p className="mt-2 text-sm text-red-700">Historical PACS search is unavailable. Current history remains usable.</p> : null}
            {historicalIndexWarning(indexStatus) ? <p className="mt-2 rounded-md bg-amber-100 p-2 text-xs text-amber-950">{historicalIndexWarning(indexStatus)}</p> : null}
            {!historicalCandidatesQuery.isLoading && !historicalCandidatesQuery.isError && historicalCandidatesQuery.data && candidates.length === 0 ? <p className="mt-2 text-sm text-slate-500">No possible historical PACS matches found.</p> : null}
            {candidates.length ? <div className="mt-2 space-y-3">{candidates.map((candidate) => <HistoricalCandidateCard key={`${candidate.historicalPatientId}-${candidate.matchRank}`} caseIdentity={caseIdentity} candidate={candidate} />)}</div> : null}
          </section>
        </div>
        <DialogFooter>
          <Button variant="secondary" onClick={onClose}>Back to case</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
