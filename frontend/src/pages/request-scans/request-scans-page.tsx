import { useEffect, useRef, useState, type ReactNode } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Activity,
  AlertCircle,
  CalendarDays,
  CheckCircle2,
  ChevronDown,
  CircleDashed,
  ExternalLink,
  FileText,
  LoaderCircle,
  Play,
  RotateCcw,
  RefreshCw,
  ScanLine,
  Square,
  Undo2,
  UserPlus,
  XCircle,
} from "lucide-react";
import { sanitizeClinicalDocumentExportError } from "./request-scans-utils";
import {
  Alert,
  AlertDescription,
  AlertTitle,
  Badge,
  Button,
  Checkbox,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  EmptyState,
  ErrorState,
  LoadingState,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/shared";
import { AppointmentManageModal } from "@/components/appointments/appointment-manage-modal";
import { chooseLocalized, t, type Language, type TranslationKey } from "@/lib/i18n";
import { normalizeAppointmentId } from "@/lib/appointment-id";
import { useLanguage } from "@/providers/language-provider";
import { useAuth } from "@/providers/auth-provider";
import type { Role } from "@/types/api";
import { deriveRequestScanActions, extractFilenameAccession, type RequestScanActionKind } from "./request-scan-action-policy";

type Job = {
  id: number;
  scoped_file_url?: string;
  filename: string;
  status: "pending" | "processing" | "processed" | "duplicate" | "failed";
  barcode_value: string | null;
  appointment_id: number | null;
  modality_id?: number | string | null;
  document_id: number | null;
  attachment_completed_at?: string | null;
  source_moved_at?: string | null;
  archive_attempt_count?: number;
  last_archive_attempt_at?: string | null;
  archive_last_error?: string | null;
  archive_next_retry_at?: string | null;
  error_message: string | null;
  failure_category?: string | null;
  attempt_count: number;
  created_at: string;
  processing_stage?: string | null;
  cancel_requested_at?: string | null;
  dismissed_at?: string | null;
  return_source_path?: string | null;
  return_destination_path?: string | null;
  patient_name?: string | null;
  patient_name_ar?: string | null;
  patient_name_en?: string | null;
  patient_mrn?: string | null;
  patient_date_of_birth?: string | null;
  modality_name?: string | null;
  modality_name_ar?: string | null;
  modality_name_en?: string | null;
  exam_name?: string | null;
  exam_name_ar?: string | null;
  exam_name_en?: string | null;
  appointment_date?: string | null;
  accession_number?: string | null;
  appointment_status?: string | null;
  clinical_document_export_status?: "pending" | "exporting" | "exported" | "failed" | "blocked" | null;
  clinical_document_export_id?: number | null;
  clinical_document_export_representation_type?: "encapsulated_pdf" | "secondary_capture" | null;
  clinical_document_export_expected_page_count?: number | null;
  clinical_document_export_exported_page_count?: number | null;
  clinical_document_export_verified_page_count?: number | null;
  clinical_document_export_failed_page_number?: number | null;
  clinical_document_export_last_attempt_at?: string | null;
  clinical_document_export_next_retry_at?: string | null;
  clinical_document_exported_at?: string | null;
  clinical_document_export_last_error?: string | null;
  matchedAppointments?: Array<{ id: number; accessionNumber: string }>;
};

type Appointment = {
  id: number;
  patient_id?: number;
  accession_number: string;
  patient_name: string | null;
  patient_name_ar?: string | null;
  patient_name_en?: string | null;
  patient_mrn?: string | null;
  modality_id?: number | null;
  national_id?: string | null;
  patient_date_of_birth?: string | null;
  sex?: string | null;
  modality_name?: string | null;
  modality_name_ar?: string | null;
  modality_name_en?: string | null;
  exam_name?: string | null;
  exam_name_ar?: string | null;
  exam_name_en?: string | null;
  appointment_date?: string | null;
  appointment_time?: string | null;
  appointment_status?: string | null;
};

type ArchiveHealth = {
  name: string | null;
  state: "connected" | "unavailable" | "degraded" | "unknown";
  affectedCount: number;
  lastConnectionCheck: string | null;
  lastSuccessfulArchive: string | null;
  nextRetryAt: string | null;
  lastError: string | null;
};

type RequestScanStatus = {
  enabled: boolean;
  lastRunAt: string | null;
  lastError: string | null;
  running: boolean;
  workerOnline: boolean;
  pending: number;
  processing: number;
  processedToday: number;
  duplicatesToday?: number;
  failed: number;
  dismissed?: number;
  canRetryArchives?: boolean;
  archiveDestination: ArchiveHealth;
};

type RequestScanTab = "active" | "processed" | "duplicate" | "failed" | "dismissed" | "all";
type WorkerTrigger = { status: "accepted" | "already_running" | "disabled" };
type StageState = "completed" | "processing" | "pending" | "attention" | "failed";

const TRIPOLI_TIME_ZONE = "Africa/Tripoli";
const requestScanFileUrl = (jobId: number) => `/api/request-scans/${jobId}/file`;
const attachedDocumentUrl = (documentId: number) => `/api/documents/${documentId}/view`;
const archivePending = (job: Job) => Boolean(job.attachment_completed_at && job.document_id && !job.source_moved_at);
const actionItemClass = "flex w-full cursor-pointer items-center gap-2 rounded-lg px-3 py-2 text-start text-sm text-foreground transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50 active:bg-muted/80";

function exportLabel(language: Language, english: string, arabic: string): string { return chooseLocalized(language, arabic, english); }

function exportProgress(job: Job, language: Language): string | null {
  const failedPage = Number(job.clinical_document_export_failed_page_number);
  if ((job.clinical_document_export_status === "failed" || job.clinical_document_export_status === "blocked") && Number.isSafeInteger(failedPage) && failedPage > 0) return exportLabel(language, `Failed on page ${failedPage}`, `فشل في الصفحة ${failedPage}`);
  const expected = Number(job.clinical_document_export_expected_page_count);
  const verified = Number(job.clinical_document_export_verified_page_count ?? 0);
  if (Number.isSafeInteger(expected) && expected > 0 && Number.isSafeInteger(verified) && verified >= 0) return exportLabel(language, `${verified}/${expected} pages verified`, `${verified}/${expected} صفحات تم التحقق منها`);
  return null;
}

function requestScanStatusPollInterval(status?: RequestScanStatus): number {
  return status && (status.running || status.processing > 0 || status.pending > 0) ? 2_500 : 15_000;
}

function requestScanJobsPollInterval(tab: RequestScanTab, status?: RequestScanStatus): number | false {
  const work = Boolean(status && (status.running || status.processing > 0 || status.pending > 0));
  return tab === "active" ? (work ? 2_500 : 15_000) : (work ? 15_000 : false);
}

async function message(response: Response, fallback: string): Promise<string> {
  const body = await response.json().catch(() => null) as { error?: { message?: string } | string; message?: string } | null;
  return typeof body?.error === "object" && body.error?.message
    ? body.error.message
    : typeof body?.error === "string"
      ? body.error
      : body?.message || fallback;
}

async function requestBase<T>(url: string, options?: RequestInit): Promise<T> {
  const response = await fetch(`/api/request-scans${url}`, {
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    ...options,
  });
  if (!response.ok) throw new Error(await message(response, "requestScans.actionFailed"));
  return response.json() as Promise<T>;
}

function formatDateTime(language: Language, value?: string | null): string {
  if (!value) return t(language, "requestScans.dateUnknown");
  return new Intl.DateTimeFormat(language === "ar" ? "ar-LY" : "en-GB", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: TRIPOLI_TIME_ZONE,
  }).format(new Date(value));
}

function formatDate(language: Language, value?: string | null): string {
  if (!value) return t(language, "requestScans.dateUnknown");
  return new Intl.DateTimeFormat(language === "ar" ? "ar-LY" : "en-GB", {
    dateStyle: "medium",
    timeZone: TRIPOLI_TIME_ZONE,
  }).format(new Date(value));
}

function localizeError(language: Language, error: unknown): string {
  const messageValue = error instanceof Error ? error.message : String(error);
  return messageValue === "requestScans.actionFailed" ? t(language, "requestScans.actionFailed") : messageValue;
}

function BilingualValue({ language, arabic, english, fallback, className = "" }: { language: Language; arabic?: string | null; english?: string | null; fallback?: string | null; className?: string }) {
  const primary = chooseLocalized(language, arabic, english) || fallback || t(language, "requestScans.notRecorded");
  const secondary = language === "ar" ? String(english ?? "").trim() : String(arabic ?? "").trim();
  return <div className={`min-w-0 text-start ${className}`}>
    <p className="truncate font-medium" title={primary}>{primary}</p>
    {secondary && secondary !== primary ? <p className="truncate text-xs text-muted-foreground" title={secondary}>{secondary}</p> : null}
  </div>;
}

function TechnicalValue({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <span dir="ltr" className={`font-mono-data ${className}`}>{children}</span>;
}

function StatusChip({ label, value, tone, pressed, onClick }: { label: string; value: number | string; tone: "blue" | "slate" | "green" | "amber" | "red"; pressed?: boolean; onClick?: () => void }) {
  const colors = {
    blue: "border-blue-200 bg-blue-50 text-blue-800 hover:bg-blue-100",
    slate: "border-slate-200 bg-slate-50 text-slate-700 hover:bg-slate-100",
    green: "border-emerald-200 bg-emerald-50 text-emerald-800 hover:bg-emerald-100",
    amber: "border-amber-200 bg-amber-50 text-amber-900 hover:bg-amber-100",
    red: "border-red-200 bg-red-50 text-red-800 hover:bg-red-100",
  };
  const content = <><span>{label}</span><span className="font-mono-data text-sm font-bold">{value}</span></>;
  if (!onClick) return <Badge className={`inline-flex h-8 items-center gap-1.5 rounded-full border px-2.5 text-xs font-semibold ${colors[tone]}`}>{content}</Badge>;
  return <button type="button" aria-label={`${label} ${value}`} aria-pressed={pressed} onClick={onClick} className={`inline-flex h-8 items-center gap-1.5 rounded-full border px-2.5 text-xs font-semibold transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 ${colors[tone]} ${pressed ? "ring-2 ring-accent/35" : ""}`}>{content}</button>;
}

function RequestScansOperationalHeader({ language, status, refreshedAt, folderLabel, onFilter, onScanNow, scanning }: { language: Language; status?: RequestScanStatus; refreshedAt: number; folderLabel?: string; onFilter: (tab: RequestScanTab) => void; onScanNow: () => void; scanning: boolean }) {
  const watcherLabel = status?.running ? t(language, "requestScans.watcher.running") : status?.workerOnline ? t(language, "requestScans.watcher.idle") : status ? t(language, "requestScans.watcher.offline") : t(language, "requestScans.watcher.unknown");
  return <header className="rounded-2xl border border-slate-200/80 bg-white/95 px-4 py-3 shadow-[0_10px_24px_rgba(15,23,42,0.05)]">
    <div className="flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
      <div className="flex min-w-0 items-center gap-3">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-[linear-gradient(135deg,var(--accent),var(--accent-secondary))] text-white shadow-sm"><ScanLine size={19} aria-hidden="true" /></div>
        <div className="min-w-0 text-start">
          <p className="text-[10px] uppercase tracking-[0.16em] text-muted-foreground">{t(language, "requestScans.watcher")}</p>
          <h1 className="truncate text-xl font-semibold tracking-tight text-foreground">{t(language, "requestScans.title")}</h1>
          <p className="truncate text-xs font-medium text-muted-foreground">{t(language, "requestScans.description")}</p>
        </div>
      </div>
      <div className="flex flex-wrap items-center justify-start gap-1.5 xl:justify-end">
        <StatusChip label={t(language, "requestScans.count.processing")} value={status?.processing ?? t(language, "requestScans.none")} tone="blue" pressed={false} onClick={() => onFilter("active")} />
        <StatusChip label={t(language, "requestScans.count.queued")} value={status?.pending ?? t(language, "requestScans.none")} tone="slate" pressed={false} onClick={() => onFilter("active")} />
        <StatusChip label={t(language, "requestScans.count.processedToday")} value={status?.processedToday ?? t(language, "requestScans.none")} tone="green" pressed={false} onClick={() => onFilter("processed")} />
        <StatusChip label={t(language, "requestScans.count.needsAttention")} value={status?.failed ?? t(language, "requestScans.none")} tone="red" pressed={false} onClick={() => onFilter("failed")} />
        <div className="ms-1 rounded-xl border border-slate-200 bg-slate-50 px-2.5 py-1.5 text-start text-[10px] text-muted-foreground">
          <div className="flex items-center gap-1.5 font-semibold uppercase tracking-[0.12em]"><Activity size={13} aria-hidden="true" /><span>{watcherLabel}</span></div>
          <p className="mt-0.5">{t(language, "requestScans.lastScan")}: <TechnicalValue>{formatDateTime(language, status?.lastRunAt)}</TechnicalValue></p>
          <p>{t(language, "requestScans.lastRefresh")}: <TechnicalValue>{refreshedAt ? formatDateTime(language, new Date(refreshedAt).toISOString()) : t(language, "requestScans.dateUnknown")}</TechnicalValue></p>
        </div>
        <div className="flex flex-col items-start gap-0.5"><Button type="button" size="sm" onClick={onScanNow} disabled={scanning} className="rounded-xl px-3 shadow-sm"><RefreshCw size={15} className={scanning ? "animate-spin" : ""} aria-hidden="true" />{scanning ? t(language, "requestScans.scanning") : folderLabel || t(language, "requestScans.scanFolderNow")}</Button><span className="text-[10px] text-muted-foreground">{t(language, "requestScans.scanFolderHelp")}</span></div>
      </div>
    </div>
  </header>;
}

function ArchiveIncidentBanner({ language, health, canRetry, onTest, onRetry, onDetails, testing }: { language: Language; health: ArchiveHealth; canRetry: boolean; onTest: () => void; onRetry: () => void; onDetails: () => void; testing: boolean }) {
  return <Alert className="border-amber-300 bg-amber-50/90 px-3 py-2.5 text-start">
    <AlertTitle className="flex items-center gap-2 text-sm text-amber-950"><AlertCircle size={16} aria-hidden="true" />{t(language, "requestScans.archive.incidentTitle")}</AlertTitle>
    <AlertDescription className="mt-1 flex flex-wrap items-center gap-x-4 gap-y-2 text-xs text-amber-950">
      <span>{t(language, "requestScans.archive.affectedCount", { count: health.affectedCount })}</span>
      <span>{t(language, "requestScans.archive.lastSuccessful", { value: formatDateTime(language, health.lastSuccessfulArchive) })}</span>
      <div className="flex flex-wrap items-center gap-1.5">
        {canRetry ? <><Button type="button" size="sm" variant="secondary" onClick={onTest} disabled={testing}>{t(language, "requestScans.archive.testConnection")}</Button><Button type="button" size="sm" onClick={onRetry}>{t(language, "requestScans.archive.retryPending")}</Button></> : null}
        <Button type="button" size="sm" variant="secondary" onClick={onDetails}>{t(language, "requestScans.archive.details")}</Button>
      </div>
    </AlertDescription>
  </Alert>;
}

const tabs: Array<{ value: RequestScanTab; key: TranslationKey }> = [
  { value: "active", key: "requestScans.tab.active" },
  { value: "processed", key: "requestScans.tab.processed" },
  { value: "duplicate", key: "requestScans.tab.duplicate" },
  { value: "failed", key: "requestScans.tab.needsAttention" },
  { value: "all", key: "requestScans.tab.all" },
];

function RequestScanFilters({ language, tab, category, attentionCount, dismissedCount, canManageDismissed, onTabChange, onCategoryChange }: { language: Language; tab: RequestScanTab; category: string; attentionCount?: number; dismissedCount?: number; canManageDismissed: boolean; onTabChange: (tab: RequestScanTab) => void; onCategoryChange: (category: string) => void }) {
  return <div className="flex flex-wrap items-center justify-between gap-2 bg-white px-3 py-2.5 text-start">
    <div role="tablist" aria-label={t(language, "requestScans.column.actions")} className="flex flex-wrap items-center gap-1">
      {[...tabs.slice(0, 4), ...(canManageDismissed ? [{ value: "dismissed" as const, key: "requestScans.tab.dismissed" as TranslationKey }] : []), tabs[4]].map(({ value, key }) => <button key={value} type="button" role="tab" aria-selected={tab === value} onClick={() => onTabChange(value)} className={`rounded-lg px-2.5 py-1.5 text-xs font-semibold transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 ${tab === value ? "bg-slate-900 text-white shadow-sm" : "text-slate-600 hover:bg-slate-100 hover:text-slate-900"}`}>
        {t(language, key)}{value === "failed" && typeof attentionCount === "number" ? ` (${attentionCount})` : value === "dismissed" && typeof dismissedCount === "number" ? ` (${dismissedCount})` : ""}
      </button>)}
    </div>
    <label className="flex items-center gap-2 text-xs font-medium text-muted-foreground">
      <span>{t(language, "requestScans.filter.attentionStage")}</span>
      <select aria-label={t(language, "requestScans.filter.attentionStage")} className="input-premium h-8 min-w-40 px-2 text-xs" value={category} onChange={(event) => onCategoryChange(event.target.value)}>
        <option value="">{t(language, "requestScans.filter.all")}</option>
        <option value="smb_storage">{t(language, "requestScans.filter.archiveError")}</option>
        <option value="recognition">{t(language, "requestScans.filter.recognition")}</option>
        <option value="identifier_conflict">{t(language, "requestScans.filter.unmatchedAppointment")}</option>
        <option value="modality_mismatch">{t(language, "requestScans.filter.modalityMismatch")}</option>
        <option value="source_missing">{t(language, "requestScans.filter.sourceMissing")}</option>
        <option value="processing_interrupted">{t(language, "requestScans.filter.interruptedProcessing")}</option>
        <option value="duplicate_or_existing">{t(language, "requestScans.filter.duplicate")}</option>
        <option value="internal_processing">{t(language, "requestScans.filter.internal")}</option>
        <option value="unknown">{t(language, "requestScans.filter.unknown")}</option>
      </select>
    </label>
  </div>;
}

function workflowStageState(job: Job, stage: "matched" | "attached" | "archived"): StageState {
  if (stage === "matched") {
    if (job.appointment_id || job.barcode_value) return "completed";
    if (job.status === "failed") return "attention";
    if (job.status === "processing" && /recogn|match|identifier/i.test(job.processing_stage || "")) return "processing";
    return "pending";
  }
  if (stage === "attached") {
    if (job.attachment_completed_at && job.document_id) return "completed";
    if (job.status === "failed") return "failed";
    if (job.status === "processing" && /attach|document/i.test(job.processing_stage || "")) return "processing";
    return "pending";
  }
  if (job.source_moved_at) return "completed";
  if (archivePending(job)) return job.status === "failed" ? "attention" : "pending";
  if (job.status === "failed") return "failed";
  if (job.status === "processing" && /archive|move/i.test(job.processing_stage || "")) return "processing";
  return "pending";
}

function WorkflowStage({ language, stage, state }: { language: Language; stage: "matched" | "attached" | "archived"; state: StageState }) {
  const stateKey: Record<StageState, TranslationKey> = {
    completed: "requestScans.workflow.completed",
    processing: "requestScans.workflow.processing",
    pending: "requestScans.workflow.pending",
    attention: "requestScans.workflow.attention",
    failed: "requestScans.workflow.failed",
  };
  const Icon = state === "completed" ? CheckCircle2 : state === "processing" ? LoaderCircle : state === "pending" ? CircleDashed : AlertCircle;
  const classes = {
    completed: "border-emerald-200 bg-emerald-50 text-emerald-800",
    processing: "border-blue-200 bg-blue-50 text-blue-800",
    pending: "border-slate-200 bg-slate-50 text-slate-600",
    attention: "border-amber-200 bg-amber-50 text-amber-900",
    failed: "border-red-200 bg-red-50 text-red-800",
  };
  const stateLabel = t(language, stateKey[state]);
  const stageLabels: Record<typeof stage, Record<StageState, TranslationKey>> = {
    matched: { completed: "requestScans.workflow.matchConfirmed", attention: "requestScans.workflow.matchNeedsReview", processing: "requestScans.workflow.matching", pending: "requestScans.workflow.waitingToMatch", failed: "requestScans.workflow.matchNeedsReview" },
    attached: { completed: "requestScans.workflow.attachedOutcome", attention: "requestScans.workflow.notAttached", processing: "requestScans.workflow.attaching", pending: "requestScans.workflow.notAttached", failed: "requestScans.workflow.notAttached" },
    archived: { completed: "requestScans.workflow.archivedOutcome", attention: "requestScans.workflow.archiveNeedsReview", processing: "requestScans.workflow.archiving", pending: "requestScans.workflow.notArchived", failed: "requestScans.workflow.notArchived" },
  };
  const label = t(language, stageLabels[stage][state]);
  return <li title={`${label}: ${stateLabel}`} aria-label={`${label}: ${stateLabel}`} className={`inline-flex items-center gap-1 rounded-full border px-2 py-1 text-[10px] font-semibold ${classes[state]}`}><Icon size={12} aria-hidden="true" className={state === "processing" ? "animate-spin" : ""} /><span>{label}</span></li>;
}

function RequestScanWorkflowStatus({ language, job }: { language: Language; job: Job }) {
  return <ul aria-label={t(language, "requestScans.column.workflow")} className="flex flex-wrap items-center gap-1" role="list">
    <WorkflowStage language={language} stage="matched" state={workflowStageState(job, "matched")} />
    <WorkflowStage language={language} stage="attached" state={workflowStageState(job, "attached")} />
    <WorkflowStage language={language} stage="archived" state={workflowStageState(job, "archived")} />
  </ul>;
}

function ClinicalDocumentExportStatus({ language, job, canRetry, onRetry, onRebuild, rebuildPending }: { language: Language; job: Job; canRetry: boolean; onRetry: () => void; onRebuild: () => void; rebuildPending: boolean }) {
  if (!job.document_id) return null;
  const status = job.clinical_document_export_status;
  const waitingForCompletion = job.appointment_status !== "completed";
  const key: TranslationKey = waitingForCompletion ? "requestScans.export.waiting" : !status ? "requestScans.export.pending" : status === "pending" ? "requestScans.export.pending" : status === "exporting" ? "requestScans.export.exporting" : status === "exported" ? "requestScans.export.exported" : status === "failed" && job.clinical_document_export_next_retry_at ? "requestScans.export.retry" : "requestScans.export.review";
  const tone = !status || status === "pending" ? "border-slate-200 bg-slate-50 text-slate-600" : status === "exporting" ? "border-blue-200 bg-blue-50 text-blue-800" : status === "exported" ? "border-emerald-200 bg-emerald-50 text-emerald-800" : status === "failed" ? "border-amber-200 bg-amber-50 text-amber-900" : "border-red-200 bg-red-50 text-red-800";
  const timestamp = job.clinical_document_exported_at || job.clinical_document_export_last_attempt_at;
  const progress = exportProgress(job, language);
  const detail = sanitizeClinicalDocumentExportError(job.clinical_document_export_last_error) || progress || (timestamp ? formatDateTime(language, timestamp) : undefined);
  const canRetryExport = canRetry && Boolean(job.clinical_document_export_id) && (status === "failed" || status === "blocked");
  const exportId = Number(job.clinical_document_export_id);
  const canRebuildExport = canRetry && Number.isSafeInteger(exportId) && exportId > 0 && Boolean(status && ["pending", "exporting", "failed", "blocked", "exported"].includes(status)) && job.clinical_document_export_representation_type === "secondary_capture";
  const rebuildBlockedByActiveExport = status === "exporting";
  const retryLabel: TranslationKey = status === "blocked" ? "requestScans.export.retryMatching" : "requestScans.actions.retry";
  const rebuildTitle = rebuildBlockedByActiveExport ? exportLabel(language, "The current Secondary Capture export is actively in progress and must finish before rebuilding.", "تصدير الالتقاط الثانوي الحالي قيد التنفيذ ويجب أن يكتمل قبل إعادة البناء.") : undefined;
  return <div className="mt-1 flex max-w-full flex-wrap items-center gap-1"><div className={`inline-flex max-w-full items-center gap-1 rounded-full border px-2 py-1 text-[10px] font-semibold ${tone}`} title={detail}><FileText size={11} aria-hidden="true" /><span className="truncate">{t(language, key)}</span></div>{progress ? <span className="text-[10px] text-muted-foreground">{progress}</span> : null}{canRetryExport ? <button type="button" className="rounded border border-amber-300 px-1.5 py-1 text-[10px] font-semibold text-amber-900 hover:bg-amber-100" onClick={onRetry}>{t(language, retryLabel)}</button> : null}{canRebuildExport ? <button type="button" className="rounded border border-slate-300 px-1.5 py-1 text-[10px] font-semibold text-slate-700 hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-60" onClick={onRebuild} disabled={rebuildPending || rebuildBlockedByActiveExport} title={rebuildTitle}>{exportLabel(language, "Rebuild & resend SC", "إعادة بناء وإرسال SC")}</button> : null}</div>;
}

function attentionKey(job: Job): TranslationKey | null {
  if (archivePending(job)) return job.status === "failed" ? "requestScans.attention.archiveFailed" : "requestScans.attention.archivePending";
  if (job.status === "duplicate") return "requestScans.attention.duplicate";
  if (job.status !== "failed") return null;
  const keys: Record<string, TranslationKey> = {
    recognition: "requestScans.attention.recognition",
    identifier_conflict: "requestScans.attention.identifierConflict",
    modality_mismatch: "requestScans.attention.modalityMismatch",
    processing_interrupted: "requestScans.attention.processingInterrupted",
    source_missing: "requestScans.attention.sourceMissing",
    smb_storage: "requestScans.attention.archivePending",
    duplicate_or_existing: "requestScans.attention.duplicate",
    internal_processing: "requestScans.attention.internal",
  };
  return keys[job.failure_category || ""] || "requestScans.attention.unknown";
}

function actionIcon(kind: RequestScanActionKind) {
  if (kind === "start-now") return <Play className="h-4 w-4 shrink-0" aria-hidden="true" />;
  if (kind === "stop-review") return <Square className="h-4 w-4 shrink-0" aria-hidden="true" />;
  if (kind === "retry" || kind === "retry-automatic" || kind === "retry-matching" || kind === "retry-archive") return <RotateCcw className="h-4 w-4 shrink-0" aria-hidden="true" />;
  if (kind === "assign-appointment") return <UserPlus className="h-4 w-4 shrink-0" aria-hidden="true" />;
  if (kind === "dismiss") return <XCircle className="h-4 w-4 shrink-0" aria-hidden="true" />;
  if (kind === "restore" || kind === "return-to-incoming") return <Undo2 className="h-4 w-4 shrink-0" aria-hidden="true" />;
  if (kind === "open-appointment") return <CalendarDays className="h-4 w-4 shrink-0" aria-hidden="true" />;
  if (kind === "open-browser") return <ExternalLink className="h-4 w-4 shrink-0" aria-hidden="true" />;
  if (kind === "view-attached") return <FileText className="h-4 w-4 shrink-0" aria-hidden="true" />;
  if (kind === "processing-details") return <Activity className="h-4 w-4 shrink-0" aria-hidden="true" />;
  return <FileText className="h-4 w-4 shrink-0" aria-hidden="true" />;
}

const actionLabelKeys: Record<RequestScanActionKind, TranslationKey> = {
  preview: "requestScans.actions.preview",
  "open-browser": "requestScans.actions.openBrowser",
  "view-attached": "requestScans.actions.viewAttached",
  "open-appointment": "requestScans.actions.openAppointment",
  "processing-details": "requestScans.actions.processingDetails",
  "start-now": "requestScans.actions.startNow",
  "stop-review": "requestScans.actions.stopReview",
  "retry-automatic": "requestScans.actions.retryAutomatic",
  "assign-appointment": "requestScans.actions.assignAppointment",
  retry: "requestScans.actions.retry",
  "retry-archive": "requestScans.actions.retryArchive",
  "retry-matching": "requestScans.export.retryMatching",
  dismiss: "requestScans.actions.dismiss",
  restore: "requestScans.actions.restore",
  "return-to-incoming": "requestScans.actions.returnToIncoming",
};

function RequestScanActionsMenu({ language, job, userRole, open, onToggle, onClose, onPreview, onDetails, onAppointment, onAction }: { language: Language; job: Job; userRole?: Role; open: boolean; onToggle: () => void; onClose: () => void; onPreview: () => void; onDetails: () => void; onAppointment: () => void; onAction: (kind: RequestScanActionKind) => void }) {
  const actions = deriveRequestScanActions(job, userRole).secondary.filter((item, index, values) => values.findIndex((candidate) => candidate.kind === item.kind) === index);
  const invoke = (kind: RequestScanActionKind) => { onClose(); if (kind === "preview") onPreview(); else if (kind === "processing-details") onDetails(); else if (kind === "open-appointment") onAppointment(); else onAction(kind); };
  return <div className="relative">
    <button type="button" aria-label={t(language, "requestScans.actions.forFile", { filename: job.filename })} aria-expanded={open} aria-haspopup="menu" aria-controls={`request-scan-actions-${job.id}`} onClick={onToggle} className="inline-flex items-center gap-1 rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-semibold text-foreground transition hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50 active:bg-slate-100"><span>{t(language, "requestScans.actions.more")}</span><ChevronDown className="h-3.5 w-3.5" aria-hidden="true" /></button>
    {open ? <div id={`request-scan-actions-${job.id}`} role="menu" aria-label={t(language, "requestScans.actions.menuForFile", { filename: job.filename })} className="absolute end-0 top-full z-30 mt-1 min-w-64 rounded-xl border border-slate-200 bg-white p-1 shadow-2xl">
      {actions.map(({ kind }) => kind === "open-browser" ? <a key={kind} role="menuitem" href={job.scoped_file_url || requestScanFileUrl(job.id)} target="_blank" rel="noreferrer" className={actionItemClass} onClick={onClose}>{actionIcon(kind)}{t(language, actionLabelKeys[kind])}</a> : kind === "view-attached" ? <a key={kind} role="menuitem" href={attachedDocumentUrl(job.document_id!)} target="_blank" rel="noreferrer" className={actionItemClass} onClick={onClose}>{actionIcon(kind)}{t(language, actionLabelKeys[kind])}</a> : <button key={kind} type="button" role="menuitem" className={actionItemClass} onClick={() => invoke(kind)}>{actionIcon(kind)}{t(language, actionLabelKeys[kind])}</button>)}
    </div> : null}
  </div>;
}

function primaryAction(language: Language, job: Job, userRole: Role | undefined, callbacks: { action: (kind: RequestScanActionKind) => void; appointment: () => void }, pending: boolean, stopping: boolean) {
  const kind = deriveRequestScanActions(job, userRole).primary?.kind;
  if (!kind) return null;
  const label = stopping && kind === "stop-review" ? "requestScans.actions.stopping" : actionLabelKeys[kind];
  return <Button type="button" size="sm" variant={kind === "open-appointment" ? "secondary" : "primary"} onClick={() => kind === "open-appointment" ? callbacks.appointment() : callbacks.action(kind)} disabled={pending || stopping}>{t(language, label)}</Button>;
}

function RequestScanRow({ language, job, userRole, showClinicalExport, canRetryClinicalExports, showSelection, selected, openMenu, onSelect, onToggleMenu, onCloseMenu, onPreview, onDetails, onAction, onRetryClinicalExport, onRebuildClinicalExport, rebuildPending, onAppointment, retryPending, stopping }: { language: Language; job: Job; userRole?: Role; showClinicalExport: boolean; canRetryClinicalExports: boolean; showSelection: boolean; selected: boolean; openMenu: boolean; onSelect: (checked: boolean) => void; onToggleMenu: () => void; onCloseMenu: () => void; onPreview: () => void; onDetails: () => void; onAction: (kind: RequestScanActionKind) => void; onRetryClinicalExport: () => void; onRebuildClinicalExport: () => void; rebuildPending: boolean; onAppointment: () => void; retryPending: boolean; stopping: boolean }) {
  const attention = attentionKey(job);
  const rowTone = archivePending(job) ? "bg-amber-50/60" : job.status === "processing" ? "bg-blue-50/45" : job.status === "pending" ? "bg-slate-50/65" : job.status === "failed" ? "bg-red-50/45" : job.status === "duplicate" ? "bg-violet-50/45" : "bg-white";
  const primary = primaryAction(language, job, userRole, { action: onAction, appointment: onAppointment }, retryPending, stopping);
  return <TableRow data-status={job.status} className={`${rowTone} transition-colors hover:bg-slate-50`}>
    {showSelection ? <TableCell className="w-10 px-2 py-2">{archivePending(job) || ((userRole === "supervisor" || userRole === "super_admin") && job.status === "failed" && !job.dismissed_at) ? <Checkbox aria-label={t(language, "requestScans.actions.selectFile", { filename: job.filename })} checked={selected} onCheckedChange={(checked) => onSelect(Boolean(checked))} /> : null}</TableCell> : null}
    <TableCell className="max-w-56 px-3 py-2"><div className="min-w-0 text-start"><p dir="ltr" className="truncate font-medium" title={job.filename}>{job.filename}</p><p className="mt-0.5 text-[11px] text-muted-foreground"><TechnicalValue>{formatDateTime(language, job.created_at)}</TechnicalValue></p>{job.status === "pending" ? <span className="mt-1 inline-flex items-center gap-1 rounded-full border border-slate-200 bg-slate-50 px-2 py-1 text-[10px] font-semibold text-slate-700"><CircleDashed size={11} aria-hidden="true" />{t(language, "requestScans.row.queued")}</span> : null}</div></TableCell>
    <TableCell className="max-w-52 px-3 py-2"><BilingualValue language={language} arabic={job.patient_name_ar} english={job.patient_name_en} fallback={job.patient_name || t(language, "requestScans.unconfirmed")} /><p className="mt-0.5 text-[11px] text-muted-foreground">{t(language, "requestScans.field.mrn")}: <TechnicalValue>{job.patient_mrn || t(language, "requestScans.notRecorded")}</TechnicalValue></p></TableCell>
    <TableCell className="max-w-60 px-3 py-2"><p dir="ltr" className="font-mono-data text-xs font-semibold">{job.barcode_value || job.accession_number || t(language, "requestScans.none")}<span className="font-sans font-normal text-muted-foreground"> · {formatDate(language, job.appointment_date)}</span></p><BilingualValue language={language} arabic={[job.modality_name_ar, job.exam_name_ar].filter(Boolean).join(" · ")} english={[job.modality_name_en, job.exam_name_en].filter(Boolean).join(" · ")} fallback={[job.modality_name, job.exam_name].filter(Boolean).join(" · ")} className="mt-0.5 text-xs" /></TableCell>
    <TableCell className="min-w-48 px-3 py-2"><RequestScanWorkflowStatus language={language} job={job} />{showClinicalExport ? <ClinicalDocumentExportStatus language={language} job={job} canRetry={canRetryClinicalExports} onRetry={onRetryClinicalExport} onRebuild={onRebuildClinicalExport} rebuildPending={rebuildPending} /> : null}</TableCell>
    <TableCell className="max-w-56 px-3 py-2 text-start">{attention ? <div className="space-y-1"><span className={`inline-flex max-w-full items-center gap-1 rounded-full px-2 py-1 text-[11px] font-semibold ${attention === "requestScans.attention.archivePending" || attention === "requestScans.attention.archiveFailed" ? "bg-amber-100 text-amber-900" : job.status === "duplicate" ? "bg-violet-100 text-violet-900" : "bg-red-100 text-red-800"}`}><AlertCircle size={12} aria-hidden="true" /><span>{t(language, attention)}</span></span>{job.error_message ? <p className="text-xs text-muted-foreground" title={job.error_message}>{job.error_message}</p> : null}</div> : <span className="text-muted-foreground">{t(language, "requestScans.none")}</span>}</TableCell>
    <TableCell className="min-w-44 px-3 py-2"><div className="flex flex-wrap items-center gap-1.5">{primary}<RequestScanActionsMenu language={language} job={job} userRole={userRole} open={openMenu} onToggle={onToggleMenu} onClose={onCloseMenu} onPreview={onPreview} onDetails={onDetails} onAppointment={onAppointment} onAction={onAction} /></div></TableCell>
  </TableRow>;
}

export default function RequestScansPage({ modality }: { modality?: { id: number; code: string; name: string; onBack: () => void; orthancState?: "connected" | "disabled" | "unavailable" } }) {
  const { language, isArabic } = useLanguage();
  const { user } = useAuth();
  const scopeQuery = modality ? `workflowSource=modality&modalityId=${modality.id}` : "";
  const scopeKey = modality ? `modality:${modality.id}` : "reception";
  const scopedUrl = (value: string) => scopeQuery ? `${value}${value.includes("?") ? "&" : "?"}${scopeQuery}` : value;
  const request = <T,>(value: string, options?: RequestInit) => requestBase<T>(scopedUrl(value), options);
  const [tab, setTab] = useState<RequestScanTab>("active");
  const [category, setCategory] = useState("");
  const [selected, setSelected] = useState<number[]>([]);
  const [preview, setPreview] = useState<Job | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [details, setDetails] = useState<Job | null>(null);
  const [archiveDetailsOpen, setArchiveDetailsOpen] = useState(false);
  const [openMenuJobId, setOpenMenuJobId] = useState<number | null>(null);
  const [assign, setAssign] = useState<Job | null>(null);
  const [query, setQuery] = useState("");
  const [appointmentId, setAppointmentId] = useState("");
  const [assignmentConfirmed, setAssignmentConfirmed] = useState(false);
  const [assignmentError, setAssignmentError] = useState<string | null>(null);
  const [stoppingJobIds, setStoppingJobIds] = useState<number[]>([]);
  const [dismissTarget, setDismissTarget] = useState<Job | null>(null);
  const [dismissReason, setDismissReason] = useState("");
  const [bulkDismissOpen, setBulkDismissOpen] = useState(false);
  const [bulkConfirm, setBulkConfirm] = useState(false);
  const [rebuildExportId, setRebuildExportId] = useState<number | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [manageAppointmentId, setManageAppointmentId] = useState<number | null>(null);
  const url = useRef<string | null>(null);
  const previewRequest = useRef(0);
  const client = useQueryClient();
  const revokePreviewUrl = () => { if (url.current) URL.revokeObjectURL(url.current); url.current = null; };
  const closePreview = () => { previewRequest.current += 1; revokePreviewUrl(); setPreviewUrl(null); setPreview(null); };
  useEffect(() => () => { previewRequest.current += 1; revokePreviewUrl(); }, []);

  const status = useQuery({ queryKey: ["request-scans-status", scopeKey], queryFn: () => request<RequestScanStatus>("/status"), refetchInterval: (q) => requestScanStatusPollInterval(q.state.data), refetchIntervalInBackground: false });
  const jobs = useQuery({ queryKey: ["request-scans", scopeKey, tab, category], queryFn: () => request<{ jobs: Job[] }>(`?status=${tab}${category ? `&category=${category}` : ""}`), refetchInterval: () => requestScanJobsPollInterval(tab, status.data), refetchIntervalInBackground: false });
  const archiveJobs = useQuery({ queryKey: ["request-scans", scopeKey, "archive-pending"], queryFn: () => request<{ jobs: Job[] }>("?status=failed&category=smb_storage"), enabled: Boolean(status.data?.archiveDestination.affectedCount && status.data?.canRetryArchives), refetchInterval: false });
  const appointments = useQuery({ queryKey: ["request-scan-appointments", scopeKey, query], queryFn: () => request<{ appointments: Appointment[] }>(`/eligible-appointments?q=${encodeURIComponent(query)}`), enabled: Boolean(assign) });
  const refresh = () => { void client.invalidateQueries({ queryKey: ["request-scans"] }); void client.invalidateQueries({ queryKey: ["request-scans-status"] }); };
  const scanNow = useMutation({ mutationFn: () => request("/run-now", { method: "POST" }), onSuccess: refresh, onError: (error: Error) => setNotice(localizeError(language, error)) });
  const startNow = useMutation({ mutationFn: (id: number) => request(`/${id}/start-now`, { method: "POST" }), onSuccess: refresh, onError: (error: Error) => setNotice(localizeError(language, error)) });
  const stopJob = useMutation({ mutationFn: (id: number) => request(`/${id}/stop`, { method: "POST" }), onSuccess: (_result, id) => { setStoppingJobIds((ids) => ids.filter((jobId) => jobId !== id)); refresh(); }, onError: (error: Error, id: number) => { setStoppingJobIds((ids) => ids.filter((jobId) => jobId !== id)); setNotice(localizeError(language, error)); } });
  const archiveRetry = useMutation({ mutationFn: (id: number) => request<{ job: Job; trigger: WorkerTrigger }>(`/${id}/retry-archive`, { method: "POST" }), onSuccess: () => { setNotice(t(language, "requestScans.archive.retryQueued")); refresh(); }, onError: (error: Error) => setNotice(localizeError(language, error)) });
  const genericRetry = useMutation({ mutationFn: (id: number) => request(`/${id}/retry`, { method: "POST" }), onSuccess: refresh, onError: (error: Error) => setNotice(localizeError(language, error)) });
  const clinicalExportRetry = useMutation({ mutationFn: async (id: number) => { const response = await fetch(`/api/integrations/authoritative-orthanc/document-exports/${id}/retry`, { method: "POST", credentials: "include", headers: { "Content-Type": "application/json" } }); if (!response.ok) throw new Error(await message(response, "requestScans.actionFailed")); return response.json(); }, onSuccess: refresh, onError: (error: Error) => setNotice(localizeError(language, error)) });
  const clinicalExportRebuild = useMutation({ mutationFn: async (id: number) => { const response = await fetch(`/api/integrations/authoritative-orthanc/document-exports/${id}/rebuild-secondary-capture`, { method: "POST", credentials: "include", headers: { "Content-Type": "application/json" } }); if (!response.ok) throw new Error(await message(response, "requestScans.actionFailed")); return response.json(); }, onSuccess: () => { setRebuildExportId(null); setNotice(exportLabel(language, "SC rebuild queued.", "تمت جدولة إعادة بناء SC.")); refresh(); }, onError: (error: Error) => setNotice(localizeError(language, error)) });
  const bulkRetry = useMutation({ mutationFn: (ids: number[]) => request<{ queued: Job[]; failed: Array<{ id: number; message: string }> }>("/bulk-retry-archives", { method: "POST", body: JSON.stringify({ jobIds: ids }) }), onSuccess: (result) => { setBulkConfirm(false); setSelected([]); setNotice(t(language, "requestScans.archive.bulkQueued", { count: result.queued.length })); refresh(); }, onError: (error: Error) => setNotice(localizeError(language, error)) });
  const dismissMutation = useMutation({ mutationFn: ({ id, reason }: { id: number; reason?: string }) => request(`/${id}/dismiss`, { method: "POST", body: JSON.stringify({ reason }) }), onSuccess: () => { setDismissTarget(null); setDismissReason(""); setNotice(t(language, "requestScans.dismiss.success")); refresh(); }, onError: (error: Error) => setNotice(localizeError(language, error)) });
  const restoreMutation = useMutation({ mutationFn: (id: number) => request(`/${id}/restore-dismissed`, { method: "POST" }), onSuccess: () => { setNotice(t(language, "requestScans.restore.success")); refresh(); }, onError: (error: Error) => setNotice(localizeError(language, error)) });
  const bulkDismissMutation = useMutation({ mutationFn: ({ ids, reason }: { ids: number[]; reason?: string }) => request("/bulk-dismiss", { method: "POST", body: JSON.stringify({ jobIds: ids, reason }) }), onSuccess: () => { setBulkDismissOpen(false); setDismissReason(""); setSelected([]); setNotice(t(language, "requestScans.dismiss.success")); refresh(); }, onError: (error: Error) => setNotice(localizeError(language, error)) });
  const testConnection = useMutation({ mutationFn: () => request<{ state: string }>("/archive-destination/test", { method: "POST" }), onSuccess: () => { setNotice(t(language, "requestScans.archive.connectionSucceeded")); refresh(); }, onError: (error: Error) => setNotice(localizeError(language, error)) });
  const assignMutation = useMutation({ mutationFn: () => request(`/${assign!.id}/manual-assign`, { method: "POST", body: JSON.stringify({ appointmentId: Number(appointmentId), patientIdentityConfirmed: assignmentConfirmed }) }), onSuccess: () => { setAssign(null); setNotice(t(language, "requestScans.assignment.queued")); refresh(); }, onError: (error: Error) => setAssignmentError(localizeError(language, error)) });
  const openPreview = async (job: Job) => { const requestId = ++previewRequest.current; revokePreviewUrl(); setPreviewUrl(null); setPreview(job); const response = await fetch(scopeQuery ? `${requestScanFileUrl(job.id)}?${scopeQuery}` : requestScanFileUrl(job.id), { credentials: "include" }); if (!response.ok) { if (requestId === previewRequest.current) setNotice(await message(response, t(language, "requestScans.preview.failed"))); return; } const nextUrl = URL.createObjectURL(await response.blob()); if (requestId !== previewRequest.current) { URL.revokeObjectURL(nextUrl); return; } url.current = nextUrl; setPreviewUrl(nextUrl); };
  const visible = (jobs.data?.jobs ?? []).map((job) => ({ ...job, scoped_file_url: scopeQuery ? `${requestScanFileUrl(job.id)}?${scopeQuery}` : requestScanFileUrl(job.id) }));
  const archiveCandidates = [...visible, ...(archiveJobs.data?.jobs ?? [])].filter(archivePending).filter((job, index, jobsForFilter) => jobsForFilter.findIndex((candidate) => candidate.id === job.id) === index);
  const selectedArchive = archiveCandidates.filter((job) => selected.includes(job.id));
  const selectableArchive = visible.filter(archivePending);
  const canManageDismissed = user?.role === "supervisor" || user?.role === "super_admin";
  const selectableDismiss = visible.filter((job) => job.status === "failed" && !job.dismissed_at);
  const selectableRows = [...new Map([...selectableArchive, ...(canManageDismissed ? selectableDismiss : [])].map((job) => [job.id, job])).values()];
  const selectedDismiss = selectableDismiss.filter((job) => selected.includes(job.id));
  const selectedAppointment = appointments.data?.appointments.find((item) => String(item.id) === appointmentId);
  const selectedAppointmentAllowed = Boolean(selectedAppointment && (!modality || selectedAppointment.modality_id == null || normalizeAppointmentId(selectedAppointment.modality_id) === normalizeAppointmentId(modality.id)));
  const canDismissFromAssignment = user?.role === "supervisor" || user?.role === "super_admin";
  const health = status.data?.archiveDestination;
  const setFilter = (nextTab: RequestScanTab) => { setTab(nextTab); setCategory(""); setSelected([]); };
  const setAssignTarget = (job: Job) => { setAssign(job); setQuery(extractFilenameAccession(job.filename) || ""); setAppointmentId(""); setAssignmentConfirmed(false); setAssignmentError(null); };
  const handleAction = (job: Job, kind: RequestScanActionKind) => {
    if (kind === "start-now") startNow.mutate(job.id);
    else if (kind === "stop-review") { setStoppingJobIds((ids) => ids.includes(job.id) ? ids : [...ids, job.id]); stopJob.mutate(job.id); }
    else if (kind === "retry" || kind === "retry-automatic") genericRetry.mutate(job.id);
    else if (kind === "retry-archive") archiveRetry.mutate(job.id);
    else if (kind === "retry-matching" && job.clinical_document_export_id) clinicalExportRetry.mutate(job.clinical_document_export_id);
    else if (kind === "assign-appointment") setAssignTarget(job);
    else if (kind === "dismiss") { setDismissTarget(job); setDismissReason(""); }
    else if (kind === "restore") restoreMutation.mutate(job.id);
    else if (kind === "return-to-incoming") void request(`/${job.id}/return-to-incoming`, { method: "POST" }).then(refresh).catch((error: unknown) => setNotice(localizeError(language, error)));
  };
  const openAppointment = (job: Job) => {
    setOpenMenuJobId(null);
    const normalizedAppointmentId = normalizeAppointmentId(job.appointment_id);
    if (normalizedAppointmentId === null) {
      setNotice(t(language, "requestScans.appointmentInvalidReference"));
      return;
    }
    setManageAppointmentId(normalizedAppointmentId);
  };

  return <main data-testid="request-scans-page" dir={isArabic ? "rtl" : "ltr"} className="min-h-full bg-[linear-gradient(180deg,rgba(248,250,252,1),rgba(241,245,249,1))]">
    <div className="mx-auto flex min-h-full w-full max-w-[1680px] flex-col gap-3 p-3 sm:p-4 lg:p-5">
      {modality ? <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-slate-200 bg-white px-4 py-3"><div><h1 className="text-xl font-semibold">{chooseLocalized(language, `${modality.code} إدخال المستندات`, `${modality.code} Document Ingestion`)}</h1><p className="text-sm text-muted-foreground">{modality.name}</p>{modality.orthancState ? <p className="mt-1 text-xs text-muted-foreground" data-testid="authoritative-orthanc-status">{chooseLocalized(language, "Orthanc: " + (modality.orthancState === "connected" ? "متصل" : modality.orthancState === "disabled" ? "معطل" : "غير متاح"), `Orthanc: ${modality.orthancState === "connected" ? "Connected" : modality.orthancState === "disabled" ? "Disabled" : "Unavailable"}`)}</p> : null}</div><Button type="button" variant="secondary" onClick={modality.onBack}>{chooseLocalized(language, "العودة إلى قائمة عمل الأجهزة", "Back to Modality Worklist")}</Button></div> : null}
       <RequestScansOperationalHeader language={language} status={status.data} refreshedAt={Math.max(status.dataUpdatedAt, jobs.dataUpdatedAt)} folderLabel={modality ? t(language, "requestScans.scanModalityFolderNow", { modality: modality.code }) : undefined} onFilter={setFilter} onScanNow={() => scanNow.mutate()} scanning={scanNow.isPending} />
      {notice ? <Alert className="border-slate-200 bg-white"><AlertDescription>{notice}</AlertDescription></Alert> : null}
      {health?.affectedCount ? <ArchiveIncidentBanner language={language} health={health} canRetry={Boolean(status.data?.canRetryArchives)} onTest={() => testConnection.mutate()} onRetry={() => { const candidates = archiveCandidates.length ? archiveCandidates : visible.filter(archivePending); if (candidates.length) { setSelected(candidates.map((job) => job.id)); setBulkConfirm(true); } else { setTab("failed"); setCategory("smb_storage"); setSelected([]); } }} onDetails={() => setArchiveDetailsOpen(true)} testing={testConnection.isPending} /> : null}
      {status.isError ? <ErrorState message={t(language, "requestScans.statusError", { message: localizeError(language, status.error) })} /> : null}
      <section className="overflow-hidden rounded-2xl border border-slate-200/80 bg-white/95 shadow-[0_10px_24px_rgba(15,23,42,0.05)]">
         <RequestScanFilters language={language} tab={tab} category={category} attentionCount={status.data?.failed} dismissedCount={status.data?.dismissed} canManageDismissed={Boolean(canManageDismissed)} onTabChange={setFilter} onCategoryChange={(nextCategory) => { setCategory(nextCategory); setSelected([]); }} />
         {(status.data?.canRetryArchives && selectedArchive.length > 0) || (canManageDismissed && selectedDismiss.length > 0) ? <div className="flex flex-wrap items-center justify-between gap-2 border-t border-slate-200 bg-amber-50/70 px-3 py-2 text-xs text-amber-950"><span>{selectedArchive.length > 0 ? `${selectedArchive.length} ${t(language, "requestScans.archive.retryPending").toLowerCase()}` : `${selectedDismiss.length} ${t(language, "requestScans.actions.dismiss").toLowerCase()}`}</span><div className="flex flex-wrap gap-2">{status.data?.canRetryArchives && selectedArchive.length > 0 ? <Button type="button" size="sm" onClick={() => setBulkConfirm(true)}>{t(language, "requestScans.actions.retrySelected")}</Button> : null}{canManageDismissed && selectedDismiss.length > 0 ? <Button type="button" size="sm" variant="secondary" onClick={() => setBulkDismissOpen(true)}>{t(language, "requestScans.actions.dismissSelected")}</Button> : null}</div></div> : null}
        <div className="border-t border-slate-200">
           {jobs.isLoading ? <div className="p-4"><LoadingState /></div> : jobs.isError ? <div className="p-4"><ErrorState message={t(language, "requestScans.jobsError", { message: localizeError(language, jobs.error) })} /></div> : !visible.length ? <div className="p-4"><EmptyState message={tab === "active" ? t(language, "requestScans.empty.active") : t(language, "requestScans.empty.other")} /></div> : <div className="overflow-x-auto"><Table className="min-w-[1050px] table-fixed"><TableHeader className="bg-slate-50/90"><TableRow>{selectableRows.length > 0 ? <TableHead className="w-10 px-2"><Checkbox aria-label={t(language, "requestScans.actions.selectRows")} checked={selected.length === selectableRows.length && selectableRows.length > 0} onCheckedChange={(checked) => setSelected(checked ? selectableRows.map((job) => job.id) : [])} /></TableHead> : null}<TableHead className="w-[18%] px-3 py-2 text-start text-[10px] uppercase tracking-[0.12em]">{t(language, "requestScans.column.scan")}</TableHead><TableHead className="w-[17%] px-3 py-2 text-start text-[10px] uppercase tracking-[0.12em]">{t(language, "requestScans.column.patient")}</TableHead><TableHead className="w-[22%] px-3 py-2 text-start text-[10px] uppercase tracking-[0.12em]">{t(language, "requestScans.column.appointment")}</TableHead><TableHead className="w-[21%] px-3 py-2 text-start text-[10px] uppercase tracking-[0.12em]">{t(language, "requestScans.column.workflow")}</TableHead><TableHead className="w-[12%] px-3 py-2 text-start text-[10px] uppercase tracking-[0.12em]">{t(language, "requestScans.column.attention")}</TableHead><TableHead className="w-[18%] px-3 py-2 text-start text-[10px] uppercase tracking-[0.12em]">{t(language, "requestScans.column.actions")}</TableHead></TableRow></TableHeader><TableBody>{visible.map((job) => <RequestScanRow key={job.id} language={language} job={job} userRole={user?.role} showClinicalExport canRetryClinicalExports={user?.role === "supervisor" || user?.role === "super_admin"} showSelection={selectableRows.length > 0} selected={selected.includes(job.id)} openMenu={openMenuJobId === job.id} onSelect={(checked) => setSelected((ids) => checked ? [...new Set([...ids, job.id])] : ids.filter((id) => id !== job.id))} onToggleMenu={() => setOpenMenuJobId(openMenuJobId === job.id ? null : job.id)} onCloseMenu={() => setOpenMenuJobId(null)} onPreview={() => void openPreview(job)} onDetails={() => setDetails(job)} onAction={(kind) => handleAction(job, kind)} onRetryClinicalExport={() => clinicalExportRetry.mutate(job.clinical_document_export_id!)} onRebuildClinicalExport={() => setRebuildExportId(Number(job.clinical_document_export_id))} rebuildPending={clinicalExportRebuild.isPending} onAppointment={() => openAppointment(job)} retryPending={archiveRetry.isPending || genericRetry.isPending || clinicalExportRetry.isPending || clinicalExportRebuild.isPending || startNow.isPending || stopJob.isPending || restoreMutation.isPending} stopping={stoppingJobIds.includes(job.id) && job.status === "processing"} />)}</TableBody></Table></div>}
        </div>
      </section>
    </div>

    <Dialog open={rebuildExportId !== null} onClose={() => { if (!clinicalExportRebuild.isPending) setRebuildExportId(null); }}><DialogContent maxWidth="600px"><DialogHeader closeLabel={t(language, "requestScans.actions.close")}><DialogTitle>{exportLabel(language, "Rebuild & resend SC", "إعادة بناء وإرسال SC")}</DialogTitle><DialogDescription>{exportLabel(language, "Regenerate this completed appointment's Request and Clinical Document Secondary Capture series using the current DICOM metadata and resend them to the same configured PACS destination. New Series and SOP Instance UIDs will be generated. The Study Instance UID will remain unchanged. Existing remote PACS objects and diagnostic images will not be deleted.", "أعد إنشاء سلاسل الالتقاط الثانوي لمستندات الطلب والمستندات السريرية لهذا الموعد المكتمل باستخدام بيانات DICOM الحالية وأرسلها إلى وجهة PACS نفسها. سيتم إنشاء معرفات Series وSOP جديدة، وسيبقى معرف Study دون تغيير. لن تُحذف كائنات PACS البعيدة الحالية أو الصور التشخيصية.")}</DialogDescription></DialogHeader><DialogFooter><Button type="button" variant="secondary" onClick={() => setRebuildExportId(null)} disabled={clinicalExportRebuild.isPending}>{exportLabel(language, "Cancel", "إلغاء")}</Button><Button type="button" onClick={() => { if (rebuildExportId !== null) clinicalExportRebuild.mutate(rebuildExportId); }} disabled={clinicalExportRebuild.isPending}>{exportLabel(language, "Rebuild & resend", "إعادة البناء والإرسال")}</Button></DialogFooter></DialogContent></Dialog>
    <Dialog open={archiveDetailsOpen} onClose={() => setArchiveDetailsOpen(false)}><DialogContent maxWidth="640px"><DialogHeader closeLabel={t(language, "requestScans.actions.close")}><DialogTitle>{t(language, "requestScans.archive.details")}</DialogTitle></DialogHeader>{health ? <dl className="grid gap-3 text-sm sm:grid-cols-2"><div><dt className="font-semibold">{t(language, "requestScans.archive.destination")}</dt><dd dir="ltr" className="font-mono-data break-all">{health.name || t(language, "requestScans.archive.configured")}</dd></div><div><dt className="font-semibold">{t(language, "requestScans.archive.lastCheck")}</dt><dd dir="ltr" className="font-mono-data">{formatDateTime(language, health.lastConnectionCheck)}</dd></div><div><dt className="font-semibold">{t(language, "requestScans.archive.nextRetry")}</dt><dd dir="ltr" className="font-mono-data">{formatDateTime(language, health.nextRetryAt)}</dd></div><div><dt className="font-semibold">{t(language, "requestScans.archive.latestError")}</dt><dd>{health.lastError || t(language, "requestScans.details.none")}</dd></div></dl> : null}</DialogContent></Dialog>
    <Dialog open={Boolean(dismissTarget) || bulkDismissOpen} onClose={() => { setDismissTarget(null); setBulkDismissOpen(false); }}><DialogContent maxWidth="560px"><DialogHeader closeLabel={t(language, "requestScans.actions.close")}><DialogTitle>{t(language, "requestScans.dismiss.title")}</DialogTitle></DialogHeader><p className="text-sm">{t(language, "requestScans.dismiss.body", { count: dismissTarget ? 1 : selectedDismiss.length })}</p><label className="mt-3 block text-sm font-semibold" htmlFor="request-scan-dismiss-reason">{t(language, "requestScans.dismiss.reason")}</label><textarea id="request-scan-dismiss-reason" className="input-premium mt-1 min-h-24 w-full" maxLength={500} value={dismissReason} onChange={(event) => setDismissReason(event.target.value)} placeholder={t(language, "requestScans.dismiss.reasonOptional")} /><DialogFooter><Button type="button" variant="secondary" onClick={() => { setDismissTarget(null); setBulkDismissOpen(false); }}>{t(language, "requestScans.actions.cancel")}</Button><Button type="button" onClick={() => dismissTarget ? dismissMutation.mutate({ id: dismissTarget.id, reason: dismissReason }) : bulkDismissMutation.mutate({ ids: selectedDismiss.map((job) => job.id), reason: dismissReason })} disabled={dismissMutation.isPending || bulkDismissMutation.isPending}>{t(language, "requestScans.actions.dismiss")}</Button></DialogFooter></DialogContent></Dialog>
    <Dialog open={bulkConfirm} onClose={() => setBulkConfirm(false)}><DialogContent maxWidth="560px"><DialogHeader closeLabel={t(language, "requestScans.actions.close")}><DialogTitle>{t(language, "requestScans.bulk.title")}</DialogTitle></DialogHeader><p className="text-sm">{t(language, "requestScans.bulk.body", { count: selectedArchive.length })}</p><DialogFooter><Button type="button" variant="secondary" onClick={() => setBulkConfirm(false)}>{t(language, "requestScans.actions.cancel")}</Button><Button type="button" onClick={() => bulkRetry.mutate(selectedArchive.map((job) => job.id))} disabled={!selectedArchive.length || bulkRetry.isPending}>{t(language, "requestScans.actions.retryBulk")}</Button></DialogFooter></DialogContent></Dialog>
    <Dialog open={Boolean(assign)} onClose={() => setAssign(null)}><DialogContent maxWidth="900px"><DialogHeader closeLabel={t(language, "requestScans.actions.close")}><DialogTitle>{t(language, "requestScans.assignment.title")}</DialogTitle></DialogHeader>{assign ? <div className="grid gap-4 text-sm md:grid-cols-[minmax(220px,0.75fr)_minmax(0,1.25fr)]"><section className="rounded-xl border border-slate-200 p-3"><h3 className="font-semibold">{t(language, "requestScans.assignment.detected")}</h3><p className="mt-2">{t(language, "requestScans.field.filename")}: <TechnicalValue>{assign.filename}</TechnicalValue></p><p>{t(language, "requestScans.column.scanTime")}: <TechnicalValue>{formatDateTime(language, assign.created_at)}</TechnicalValue></p><p className="mt-3 rounded-lg border border-amber-300 bg-amber-50 p-2 text-xs font-semibold">{t(language, "requestScans.assignment.filenameSuggestion")}</p><Button type="button" className="mt-3 w-full" size="sm" variant="secondary" onClick={() => void openPreview(assign)}>{t(language, "requestScans.actions.preview")}</Button></section><section className="rounded-xl border border-slate-200 p-3"><label htmlFor="request-scan-appointment-search" className="font-semibold">{t(language, "requestScans.assignment.selected")}</label><input id="request-scan-appointment-search" className="input-premium mt-2 w-full" placeholder={t(language, "requestScans.assignment.search")} value={query} onChange={(event) => setQuery(event.target.value)} />{modality ? <p className="mt-2 text-xs text-muted-foreground">{t(language, "requestScans.assignment.todayHint")}</p> : null}<div role="list" aria-label={t(language, "requestScans.assignment.results")} className="mt-2 max-h-64 space-y-2 overflow-y-auto">{appointments.data?.appointments.length === 0 && modality && !query ? <p className="rounded-lg border border-slate-200 p-3 text-sm text-muted-foreground">{t(language, "requestScans.assignment.noAppointmentsToday")}</p> : null}{appointments.data?.appointments.map((item) => { const allowed = !modality || item.modality_id == null || normalizeAppointmentId(item.modality_id) === normalizeAppointmentId(modality.id); return <button key={item.id} type="button" role="listitem" disabled={!allowed} aria-pressed={appointmentId === String(item.id)} className="w-full rounded-lg border border-slate-200 p-3 text-start transition hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent disabled:cursor-not-allowed disabled:opacity-50" onClick={() => { setAppointmentId(String(item.id)); setAssignmentConfirmed(false); setAssignmentError(null); }}><div className="flex flex-wrap items-center justify-between gap-2"><TechnicalValue>{item.accession_number}</TechnicalValue><span className="text-xs text-muted-foreground">{item.appointment_status || t(language, "requestScans.notRecorded")}</span></div><BilingualValue language={language} arabic={item.patient_name_ar} english={item.patient_name_en} fallback={item.patient_name} /><div className="mt-1 grid gap-x-3 gap-y-1 text-xs sm:grid-cols-2"><span>{t(language, "requestScans.assignment.patientId")}: <TechnicalValue>{item.patient_mrn || item.patient_id || t(language, "requestScans.notRecorded")}</TechnicalValue></span><span>{t(language, "requestScans.assignment.nationalId")}: <TechnicalValue>{item.national_id || t(language, "requestScans.notRecorded")}</TechnicalValue></span><span>{t(language, "requestScans.assignment.dob")}: <TechnicalValue>{item.patient_date_of_birth || t(language, "requestScans.notRecorded")}</TechnicalValue></span><span>{t(language, "requestScans.assignment.sex")}: {item.sex || t(language, "requestScans.notRecorded")}</span></div><BilingualValue language={language} arabic={item.modality_name_ar} english={item.modality_name_en} fallback={item.modality_name} className="mt-1" /><BilingualValue language={language} arabic={item.exam_name_ar} english={item.exam_name_en} fallback={item.exam_name} /><p className="mt-1 text-xs text-muted-foreground">{t(language, "requestScans.column.appointmentDate")}: <TechnicalValue>{item.appointment_date || t(language, "requestScans.notRecorded")}{item.appointment_time ? ` · ${item.appointment_time}` : ""}</TechnicalValue></p>{!allowed ? <p className="mt-1 text-xs font-semibold text-red-700">{t(language, "requestScans.assignment.modalityMismatch")}</p> : null}</button>; })}</div><select aria-label={t(language, "requestScans.assignment.select")} className="input-premium sr-only" tabIndex={-1} value={appointmentId} onChange={(event) => { setAppointmentId(event.target.value); setAssignmentConfirmed(false); setAssignmentError(null); }}><option value="">{t(language, "requestScans.assignment.select")}</option>{appointments.data?.appointments.map((item) => <option key={item.id} value={item.id}>{item.accession_number} · {chooseLocalized(language, item.patient_name_ar, item.patient_name_en) || item.patient_name || t(language, "requestScans.unconfirmed")}</option>)}</select>{selectedAppointment ? <div className="mt-3 space-y-1 rounded-lg border border-slate-200 bg-slate-50 p-3 text-xs"><BilingualValue language={language} arabic={selectedAppointment.patient_name_ar} english={selectedAppointment.patient_name_en} fallback={selectedAppointment.patient_name} /><p>{t(language, "requestScans.field.accession")}: <TechnicalValue>{selectedAppointment.accession_number}</TechnicalValue></p><p>{t(language, "requestScans.assignment.patientId")}: <TechnicalValue>{selectedAppointment.patient_mrn || selectedAppointment.patient_id || t(language, "requestScans.notRecorded")}</TechnicalValue></p><p>{t(language, "requestScans.assignment.nationalId")}: <TechnicalValue>{selectedAppointment.national_id || t(language, "requestScans.notRecorded")}</TechnicalValue></p><p>{t(language, "requestScans.assignment.dob")}: <TechnicalValue>{selectedAppointment.patient_date_of_birth || t(language, "requestScans.notRecorded")}</TechnicalValue> · {t(language, "requestScans.assignment.sex")}: {selectedAppointment.sex || t(language, "requestScans.notRecorded")}</p><BilingualValue language={language} arabic={selectedAppointment.modality_name_ar} english={selectedAppointment.modality_name_en} fallback={selectedAppointment.modality_name} /><BilingualValue language={language} arabic={selectedAppointment.exam_name_ar} english={selectedAppointment.exam_name_en} fallback={selectedAppointment.exam_name} /><p>{t(language, "requestScans.column.appointmentDate")}: <TechnicalValue>{selectedAppointment.appointment_date || t(language, "requestScans.notRecorded")}{selectedAppointment.appointment_time ? ` · ${selectedAppointment.appointment_time}` : ""}</TechnicalValue></p></div> : null}</section></div> : null}{selectedAppointment ? <p className="mt-3 rounded-lg border border-amber-300 bg-amber-50 p-2 text-sm">{t(language, "requestScans.assignment.recordWarning")}</p> : null}{assignmentError ? <p className="mt-3 text-sm text-red-700" role="alert">{assignmentError}</p> : null}<label className="mt-4 flex cursor-pointer items-start gap-2 text-sm"><Checkbox checked={assignmentConfirmed} onCheckedChange={(checked) => setAssignmentConfirmed(Boolean(checked))} />{t(language, "requestScans.assignment.confirmIdentity")}</label><DialogFooter>{canDismissFromAssignment && assign ? <Button type="button" variant="secondary" className="border-red-200 text-red-700 hover:bg-red-50" onClick={() => { setAssign(null); setDismissTarget(assign); setDismissReason(""); }}>{t(language, "requestScans.actions.dismissScan")}</Button> : null}<Button type="button" variant="secondary" onClick={() => setAssign(null)}>{t(language, "requestScans.actions.cancel")}</Button><Button type="button" disabled={!appointmentId || !assignmentConfirmed || assignMutation.isPending || !selectedAppointmentAllowed} onClick={() => assignMutation.mutate()}>{assignMutation.isPending ? t(language, "requestScans.assignment.confirming") : t(language, "requestScans.assignment.confirm")}</Button></DialogFooter></DialogContent></Dialog>
    <Dialog open={Boolean(preview)} onClose={closePreview}><DialogContent maxWidth="min(96vw, 1500px)" className="flex h-[94vh] flex-col overflow-hidden"><DialogHeader closeLabel={t(language, "requestScans.actions.close")} className="shrink-0"><div className="flex min-w-0 flex-wrap items-center gap-2"><DialogTitle className="min-w-0 flex-1 truncate"><TechnicalValue>{preview?.filename}</TechnicalValue></DialogTitle>{preview ? <div className="flex shrink-0 flex-wrap gap-2"><a href={preview.scoped_file_url || requestScanFileUrl(preview.id)} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 rounded-lg border border-slate-200 px-2.5 py-1.5 text-xs font-semibold transition hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50 active:bg-slate-100"><ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />{t(language, "requestScans.actions.openBrowser")}</a>{preview.document_id ? <a href={attachedDocumentUrl(preview.document_id)} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 rounded-lg border border-slate-200 px-2.5 py-1.5 text-xs font-semibold transition hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50 active:bg-slate-100"><FileText className="h-3.5 w-3.5" aria-hidden="true" />{t(language, "requestScans.actions.viewAttached")}</a> : null}</div> : null}</div></DialogHeader><div className="min-h-0 flex-1 overflow-hidden">{previewUrl ? (preview?.filename.toLowerCase().endsWith(".pdf") ? <iframe className="h-full w-full" src={previewUrl} title={t(language, "requestScans.preview.title")} /> : <div className="flex h-full w-full items-center justify-center"><img className="h-full w-full object-contain" src={previewUrl} alt={preview?.filename} /></div>) : <div className="flex h-full items-center justify-center text-sm text-muted-foreground">{t(language, "requestScans.preview.loading")}</div>}</div></DialogContent></Dialog>
    <Dialog open={Boolean(details)} onClose={() => setDetails(null)}><DialogContent maxWidth="680px"><DialogHeader closeLabel={t(language, "requestScans.actions.close")}><DialogTitle>{t(language, "requestScans.details.title")}</DialogTitle><DialogDescription>{details ? <TechnicalValue>{details.filename}</TechnicalValue> : null}</DialogDescription></DialogHeader>{details ? <div className="space-y-5"><dl className="grid gap-3 text-sm sm:grid-cols-2"><div><dt className="font-semibold">{t(language, "requestScans.details.stage")}</dt><dd dir="ltr" className="font-mono-data">{details.processing_stage || t(language, "requestScans.details.notRecorded")}</dd></div><div><dt className="font-semibold">{t(language, "requestScans.details.failureCategory")}</dt><dd dir="ltr" className="font-mono-data">{details.failure_category || t(language, "requestScans.details.notRecorded")}</dd></div><div><dt className="font-semibold">{t(language, "requestScans.details.processingAttempts")}</dt><dd dir="ltr" className="font-mono-data">{details.attempt_count}</dd></div><div><dt className="font-semibold">{t(language, "requestScans.details.archiveAttempts")}</dt><dd dir="ltr" className="font-mono-data">{details.archive_attempt_count ?? 0}</dd></div><div><dt className="font-semibold">{t(language, "requestScans.details.archiveError")}</dt><dd>{details.archive_last_error || t(language, "requestScans.details.none")}</dd></div><div><dt className="font-semibold">{t(language, "requestScans.details.errorMessage")}</dt><dd>{details.error_message || t(language, "requestScans.details.none")}</dd></div></dl>{details.clinical_document_export_status ? <section className="rounded-lg border border-slate-200 bg-slate-50 p-3 text-sm" aria-label="Clinical document export details"><h3 className="font-semibold">{exportLabel(language, "Clinical document export", "تصدير المستند السريري")}</h3><dl className="mt-2 grid gap-2 sm:grid-cols-2"><div><dt className="text-muted-foreground">{exportLabel(language, "Representation", "التمثيل")}</dt><dd>{details.clinical_document_export_representation_type === "secondary_capture" ? "Secondary Capture" : details.clinical_document_export_representation_type || t(language, "requestScans.details.notRecorded")}</dd></div><div><dt className="text-muted-foreground">{exportLabel(language, "Pages", "الصفحات")}</dt><dd>{Number.isSafeInteger(Number(details.clinical_document_export_expected_page_count)) && Number(details.clinical_document_export_expected_page_count) > 0 ? `${details.clinical_document_export_exported_page_count ?? 0}/${details.clinical_document_export_expected_page_count} exported; ${details.clinical_document_export_verified_page_count ?? 0}/${details.clinical_document_export_expected_page_count} verified` : t(language, "requestScans.details.notRecorded")}</dd></div><div><dt className="text-muted-foreground">{exportLabel(language, "Failed page", "الصفحة الفاشلة")}</dt><dd>{details.clinical_document_export_failed_page_number ?? t(language, "requestScans.details.none")}</dd></div><div><dt className="text-muted-foreground">{exportLabel(language, "Last attempt", "آخر محاولة")}</dt><dd>{formatDateTime(language, details.clinical_document_export_last_attempt_at)}</dd></div><div><dt className="text-muted-foreground">{exportLabel(language, "Next retry", "إعادة المحاولة التالية")}</dt><dd>{formatDateTime(language, details.clinical_document_export_next_retry_at)}</dd></div><div><dt className="text-muted-foreground">{exportLabel(language, "Exported", "تم التصدير")}</dt><dd>{formatDateTime(language, details.clinical_document_exported_at)}</dd></div><div className="sm:col-span-2"><dt className="text-muted-foreground">{exportLabel(language, "Export error", "خطأ التصدير")}</dt><dd>{sanitizeClinicalDocumentExportError(details.clinical_document_export_last_error) || t(language, "requestScans.details.none")}</dd></div></dl></section> : null}</div> : null}</DialogContent></Dialog>
    <AppointmentManageModal appointmentId={manageAppointmentId} open={manageAppointmentId !== null} onClose={() => setManageAppointmentId(null)} />
  </main>;
}
