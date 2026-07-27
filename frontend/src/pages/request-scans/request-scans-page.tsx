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
  RefreshCw,
  ScanLine,
} from "lucide-react";
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

type Job = {
  id: number;
  scoped_file_url?: string;
  filename: string;
  status: "pending" | "processing" | "processed" | "duplicate" | "failed";
  barcode_value: string | null;
  appointment_id: number | null;
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
  canRetryArchives?: boolean;
  archiveDestination: ArchiveHealth;
};

type RequestScanTab = "active" | "processed" | "duplicate" | "failed" | "all";
type WorkerTrigger = { status: "accepted" | "already_running" | "disabled" };
type StageState = "completed" | "processing" | "pending" | "attention" | "failed";

const TRIPOLI_TIME_ZONE = "Africa/Tripoli";
const requestScanFileUrl = (jobId: number) => `/api/request-scans/${jobId}/file`;
const attachedDocumentUrl = (documentId: number) => `/api/documents/${documentId}/view`;
const archivePending = (job: Job) => Boolean(job.attachment_completed_at && job.document_id && !job.source_moved_at);
const actionItemClass = "flex w-full cursor-pointer items-center gap-2 rounded-lg px-3 py-2 text-start text-sm text-foreground transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50 active:bg-muted/80";

export function requestScanStatusPollInterval(status?: RequestScanStatus): number {
  return status && (status.running || status.processing > 0 || status.pending > 0) ? 2_500 : 15_000;
}

export function requestScanJobsPollInterval(tab: RequestScanTab, status?: RequestScanStatus): number | false {
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

function RequestScansOperationalHeader({ language, status, refreshedAt, onFilter, onScanNow, scanning }: { language: Language; status?: RequestScanStatus; refreshedAt: number; onFilter: (tab: RequestScanTab) => void; onScanNow: () => void; scanning: boolean }) {
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
        <Button type="button" size="sm" onClick={onScanNow} disabled={scanning} className="rounded-xl px-3 shadow-sm"><RefreshCw size={15} className={scanning ? "animate-spin" : ""} aria-hidden="true" />{scanning ? t(language, "requestScans.scanning") : t(language, "requestScans.scanFolderNow")}</Button>
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

function RequestScanFilters({ language, tab, category, attentionCount, onTabChange, onCategoryChange }: { language: Language; tab: RequestScanTab; category: string; attentionCount?: number; onTabChange: (tab: RequestScanTab) => void; onCategoryChange: (category: string) => void }) {
  return <div className="flex flex-wrap items-center justify-between gap-2 bg-white px-3 py-2.5 text-start">
    <div role="tablist" aria-label={t(language, "requestScans.column.actions")} className="flex flex-wrap items-center gap-1">
      {tabs.map(({ value, key }) => <button key={value} type="button" role="tab" aria-selected={tab === value} onClick={() => onTabChange(value)} className={`rounded-lg px-2.5 py-1.5 text-xs font-semibold transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 ${tab === value ? "bg-slate-900 text-white shadow-sm" : "text-slate-600 hover:bg-slate-100 hover:text-slate-900"}`}>
        {t(language, key)}{value === "failed" && typeof attentionCount === "number" ? ` (${attentionCount})` : ""}
      </button>)}
    </div>
    <label className="flex items-center gap-2 text-xs font-medium text-muted-foreground">
      <span>{t(language, "requestScans.filter.attentionStage")}</span>
      <select aria-label={t(language, "requestScans.filter.attentionStage")} className="input-premium h-8 min-w-40 px-2 text-xs" value={category} onChange={(event) => onCategoryChange(event.target.value)}>
        <option value="">{t(language, "requestScans.filter.all")}</option>
        <option value="smb_storage">{t(language, "requestScans.filter.archiveError")}</option>
        <option value="recognition">{t(language, "requestScans.filter.recognition")}</option>
        <option value="identifier_conflict">{t(language, "requestScans.filter.unmatchedAppointment")}</option>
        <option value="processing_interrupted">{t(language, "requestScans.filter.interruptedProcessing")}</option>
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

function WorkflowStage({ language, labelKey, state }: { language: Language; labelKey: TranslationKey; state: StageState }) {
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
  const label = t(language, labelKey);
  return <li title={`${label}: ${stateLabel}`} aria-label={`${label}: ${stateLabel}`} className={`inline-flex items-center gap-1 rounded-full border px-2 py-1 text-[10px] font-semibold ${classes[state]}`}><Icon size={12} aria-hidden="true" className={state === "processing" ? "animate-spin" : ""} /><span>{label}</span><span className="sr-only">{stateLabel}</span></li>;
}

function RequestScanWorkflowStatus({ language, job }: { language: Language; job: Job }) {
  return <ul aria-label={t(language, "requestScans.column.workflow")} className="flex flex-wrap items-center gap-1" role="list">
    <WorkflowStage language={language} labelKey="requestScans.workflow.matched" state={workflowStageState(job, "matched")} />
    <WorkflowStage language={language} labelKey="requestScans.workflow.attached" state={workflowStageState(job, "attached")} />
    <WorkflowStage language={language} labelKey="requestScans.workflow.archived" state={workflowStageState(job, "archived")} />
  </ul>;
}

function attentionKey(job: Job): TranslationKey | null {
  if (archivePending(job)) return "requestScans.attention.archivePending";
  if (job.status === "duplicate") return "requestScans.attention.duplicate";
  if (job.status !== "failed") return null;
  const keys: Record<string, TranslationKey> = {
    recognition: "requestScans.attention.recognition",
    identifier_conflict: "requestScans.attention.identifierConflict",
    processing_interrupted: "requestScans.attention.processingInterrupted",
    source_missing: "requestScans.attention.sourceMissing",
    internal_processing: "requestScans.attention.internal",
  };
  return keys[job.failure_category || ""] || "requestScans.attention.unknown";
}

function RequestScanActionsMenu({ language, job, open, onToggle, onClose, onPreview, onDetails, onAppointment }: { language: Language; job: Job; open: boolean; onToggle: () => void; onClose: () => void; onPreview: () => void; onDetails: () => void; onAppointment: () => void }) {
  return <div className="relative">
    <button type="button" aria-label={t(language, "requestScans.actions.forFile", { filename: job.filename })} aria-expanded={open} aria-haspopup="menu" aria-controls={`request-scan-actions-${job.id}`} onClick={onToggle} className="inline-flex items-center gap-1 rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-semibold text-foreground transition hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50 active:bg-slate-100"><span>{t(language, "requestScans.actions.more")}</span><ChevronDown className="h-3.5 w-3.5" aria-hidden="true" /></button>
    {open ? <div id={`request-scan-actions-${job.id}`} role="menu" aria-label={t(language, "requestScans.actions.menuForFile", { filename: job.filename })} className="absolute end-0 top-full z-30 mt-1 min-w-64 rounded-xl border border-slate-200 bg-white p-1 shadow-2xl">
      <button type="button" role="menuitem" className={actionItemClass} onClick={() => { onClose(); onPreview(); }}><FileText className="h-4 w-4 shrink-0" aria-hidden="true" />{t(language, "requestScans.actions.preview")}</button>
      <a role="menuitem" href={job.scoped_file_url || requestScanFileUrl(job.id)} target="_blank" rel="noreferrer" className={actionItemClass} onClick={onClose}><ExternalLink className="h-4 w-4 shrink-0" aria-hidden="true" />{t(language, "requestScans.actions.openBrowser")}</a>
      {job.document_id ? <a role="menuitem" href={attachedDocumentUrl(job.document_id)} target="_blank" rel="noreferrer" className={actionItemClass} onClick={onClose}><FileText className="h-4 w-4 shrink-0" aria-hidden="true" />{t(language, "requestScans.actions.viewAttached")}</a> : null}
      {job.appointment_id ? <button type="button" role="menuitem" className={actionItemClass} onClick={() => { onClose(); onAppointment(); }}><CalendarDays className="h-4 w-4 shrink-0" aria-hidden="true" />{t(language, "requestScans.actions.openAppointment")}</button> : null}
      <button type="button" role="menuitem" className={actionItemClass} onClick={() => { onClose(); onDetails(); }}><Activity className="h-4 w-4 shrink-0" aria-hidden="true" />{t(language, "requestScans.actions.processingDetails")}</button>
    </div> : null}
  </div>;
}

function primaryAction(language: Language, job: Job, canRetryArchives: boolean, callbacks: { retryArchive: () => void; retry: () => void; assign: () => void; appointment: () => void }, pending: boolean) {
  if (archivePending(job)) return canRetryArchives ? <Button type="button" size="sm" onClick={callbacks.retryArchive} disabled={pending}>{t(language, "requestScans.actions.retryArchive")}</Button> : <span className="text-xs text-muted-foreground">{t(language, "requestScans.archive.retryRequiresSupervisor")}</span>;
  if (job.status === "failed" && !job.appointment_id) return <Button type="button" size="sm" onClick={callbacks.assign}>{t(language, "requestScans.actions.assignAppointment")}</Button>;
  if (job.status === "failed") return <Button type="button" size="sm" onClick={callbacks.retry} disabled={pending}>{t(language, "requestScans.actions.retry")}</Button>;
  if (job.appointment_id) return <Button type="button" size="sm" variant="secondary" onClick={callbacks.appointment}>{t(language, "requestScans.actions.openAppointment")}</Button>;
  return null;
}

function RequestScanRow({ language, job, showSelection, selected, canRetryArchives, openMenu, onSelect, onToggleMenu, onCloseMenu, onPreview, onDetails, onRetryArchive, onRetry, onAssign, onAppointment, retryPending }: { language: Language; job: Job; showSelection: boolean; selected: boolean; canRetryArchives: boolean; openMenu: boolean; onSelect: (checked: boolean) => void; onToggleMenu: () => void; onCloseMenu: () => void; onPreview: () => void; onDetails: () => void; onRetryArchive: () => void; onRetry: () => void; onAssign: () => void; onAppointment: () => void; retryPending: boolean }) {
  const attention = attentionKey(job);
  const rowTone = archivePending(job) ? "bg-amber-50/60" : job.status === "processing" ? "bg-blue-50/45" : job.status === "pending" ? "bg-slate-50/65" : job.status === "failed" ? "bg-red-50/45" : job.status === "duplicate" ? "bg-violet-50/45" : "bg-white";
  const primary = primaryAction(language, job, canRetryArchives, { retryArchive: onRetryArchive, retry: onRetry, assign: onAssign, appointment: onAppointment }, retryPending);
  return <TableRow data-status={job.status} className={`${rowTone} transition-colors hover:bg-slate-50`}>
    {showSelection ? <TableCell className="w-10 px-2 py-2">{archivePending(job) ? <Checkbox aria-label={t(language, "requestScans.actions.selectFile", { filename: job.filename })} checked={selected} onCheckedChange={(checked) => onSelect(Boolean(checked))} /> : null}</TableCell> : null}
    <TableCell className="max-w-56 px-3 py-2"><div className="min-w-0 text-start"><p dir="ltr" className="truncate font-medium" title={job.filename}>{job.filename}</p><p className="mt-0.5 text-[11px] text-muted-foreground"><TechnicalValue>{formatDateTime(language, job.created_at)}</TechnicalValue></p></div></TableCell>
    <TableCell className="max-w-52 px-3 py-2"><BilingualValue language={language} arabic={job.patient_name_ar} english={job.patient_name_en} fallback={job.patient_name || t(language, "requestScans.unconfirmed")} /><p className="mt-0.5 text-[11px] text-muted-foreground">{t(language, "requestScans.field.mrn")}: <TechnicalValue>{job.patient_mrn || t(language, "requestScans.notRecorded")}</TechnicalValue></p></TableCell>
    <TableCell className="max-w-60 px-3 py-2"><p dir="ltr" className="font-mono-data text-xs font-semibold">{job.barcode_value || job.accession_number || t(language, "requestScans.none")}<span className="font-sans font-normal text-muted-foreground"> · {formatDate(language, job.appointment_date)}</span></p><BilingualValue language={language} arabic={[job.modality_name_ar, job.exam_name_ar].filter(Boolean).join(" · ")} english={[job.modality_name_en, job.exam_name_en].filter(Boolean).join(" · ")} fallback={[job.modality_name, job.exam_name].filter(Boolean).join(" · ")} className="mt-0.5 text-xs" /></TableCell>
    <TableCell className="min-w-48 px-3 py-2"><RequestScanWorkflowStatus language={language} job={job} /></TableCell>
    <TableCell className="max-w-44 px-3 py-2 text-start">{attention ? <span className={`inline-flex max-w-full items-center gap-1 rounded-full px-2 py-1 text-[11px] font-semibold ${attention === "requestScans.attention.archivePending" ? "bg-amber-100 text-amber-900" : job.status === "duplicate" ? "bg-violet-100 text-violet-900" : "bg-red-100 text-red-800"}`} title={job.error_message || undefined}><AlertCircle size={12} aria-hidden="true" /><span className="truncate">{t(language, attention)}</span></span> : <span className="text-muted-foreground">{t(language, "requestScans.none")}</span>}</TableCell>
    <TableCell className="min-w-44 px-3 py-2"><div className="flex flex-wrap items-center gap-1.5">{primary}<RequestScanActionsMenu language={language} job={job} open={openMenu} onToggle={onToggleMenu} onClose={onCloseMenu} onPreview={onPreview} onDetails={onDetails} onAppointment={onAppointment} /></div></TableCell>
  </TableRow>;
}

export default function RequestScansPage({ modality }: { modality?: { id: number; code: string; name: string; onBack: () => void; orthancState?: "connected" | "disabled" | "unavailable" } }) {
  const { language, isArabic } = useLanguage();
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
  const [bulkConfirm, setBulkConfirm] = useState(false);
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
  const archiveRetry = useMutation({ mutationFn: (id: number) => request<{ job: Job; trigger: WorkerTrigger }>(`/${id}/retry-archive`, { method: "POST" }), onSuccess: () => { setNotice(t(language, "requestScans.archive.retryQueued")); refresh(); }, onError: (error: Error) => setNotice(localizeError(language, error)) });
  const genericRetry = useMutation({ mutationFn: (id: number) => request(`/${id}/retry`, { method: "POST" }), onSuccess: refresh, onError: (error: Error) => setNotice(localizeError(language, error)) });
  const bulkRetry = useMutation({ mutationFn: (ids: number[]) => request<{ queued: Job[]; failed: Array<{ id: number; message: string }> }>("/bulk-retry-archives", { method: "POST", body: JSON.stringify({ jobIds: ids }) }), onSuccess: (result) => { setBulkConfirm(false); setSelected([]); setNotice(t(language, "requestScans.archive.bulkQueued", { count: result.queued.length })); refresh(); }, onError: (error: Error) => setNotice(localizeError(language, error)) });
  const testConnection = useMutation({ mutationFn: () => request<{ state: string }>("/archive-destination/test", { method: "POST" }), onSuccess: () => { setNotice(t(language, "requestScans.archive.connectionSucceeded")); refresh(); }, onError: (error: Error) => setNotice(localizeError(language, error)) });
  const assignMutation = useMutation({ mutationFn: () => request(`/${assign!.id}/manual-assign`, { method: "POST", body: JSON.stringify({ appointmentId: Number(appointmentId), patientIdentityConfirmed: assignmentConfirmed }) }), onSuccess: () => { setAssign(null); setNotice(t(language, "requestScans.assignment.queued")); refresh(); }, onError: (error: Error) => setAssignmentError(localizeError(language, error)) });
  const openPreview = async (job: Job) => { const requestId = ++previewRequest.current; revokePreviewUrl(); setPreviewUrl(null); setPreview(job); const response = await fetch(scopeQuery ? `${requestScanFileUrl(job.id)}?${scopeQuery}` : requestScanFileUrl(job.id), { credentials: "include" }); if (!response.ok) { if (requestId === previewRequest.current) setNotice(await message(response, t(language, "requestScans.preview.failed"))); return; } const nextUrl = URL.createObjectURL(await response.blob()); if (requestId !== previewRequest.current) { URL.revokeObjectURL(nextUrl); return; } url.current = nextUrl; setPreviewUrl(nextUrl); };
  const visible = (jobs.data?.jobs ?? []).map((job) => ({ ...job, scoped_file_url: scopeQuery ? `${requestScanFileUrl(job.id)}?${scopeQuery}` : requestScanFileUrl(job.id) }));
  const archiveCandidates = [...visible, ...(archiveJobs.data?.jobs ?? [])].filter(archivePending).filter((job, index, jobsForFilter) => jobsForFilter.findIndex((candidate) => candidate.id === job.id) === index);
  const selectedArchive = archiveCandidates.filter((job) => selected.includes(job.id));
  const selectableArchive = visible.filter(archivePending);
  const selectedAppointment = appointments.data?.appointments.find((item) => String(item.id) === appointmentId);
  const health = status.data?.archiveDestination;
  const setFilter = (nextTab: RequestScanTab) => { setTab(nextTab); setCategory(""); setSelected([]); };
  const setAssignTarget = (job: Job) => { setAssign(job); setAppointmentId(""); setAssignmentConfirmed(false); setAssignmentError(null); };
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
      <RequestScansOperationalHeader language={language} status={status.data} refreshedAt={Math.max(status.dataUpdatedAt, jobs.dataUpdatedAt)} onFilter={setFilter} onScanNow={() => scanNow.mutate()} scanning={scanNow.isPending} />
      {notice ? <Alert className="border-slate-200 bg-white"><AlertDescription>{notice}</AlertDescription></Alert> : null}
      {health?.affectedCount ? <ArchiveIncidentBanner language={language} health={health} canRetry={Boolean(status.data?.canRetryArchives)} onTest={() => testConnection.mutate()} onRetry={() => { const candidates = archiveCandidates.length ? archiveCandidates : visible.filter(archivePending); if (candidates.length) { setSelected(candidates.map((job) => job.id)); setBulkConfirm(true); } else { setTab("failed"); setCategory("smb_storage"); setSelected([]); } }} onDetails={() => setArchiveDetailsOpen(true)} testing={testConnection.isPending} /> : null}
      {status.isError ? <ErrorState message={t(language, "requestScans.statusError", { message: localizeError(language, status.error) })} /> : null}
      <section className="overflow-hidden rounded-2xl border border-slate-200/80 bg-white/95 shadow-[0_10px_24px_rgba(15,23,42,0.05)]">
        <RequestScanFilters language={language} tab={tab} category={category} attentionCount={status.data?.failed} onTabChange={setFilter} onCategoryChange={(nextCategory) => { setCategory(nextCategory); setSelected([]); }} />
        {status.data?.canRetryArchives && selectedArchive.length > 0 ? <div className="flex flex-wrap items-center justify-between gap-2 border-t border-slate-200 bg-amber-50/70 px-3 py-2 text-xs text-amber-950"><span>{selectedArchive.length} {t(language, "requestScans.archive.retryPending").toLowerCase()}</span><Button type="button" size="sm" onClick={() => setBulkConfirm(true)}>{t(language, "requestScans.actions.retrySelected")}</Button></div> : null}
        <div className="border-t border-slate-200">
          {jobs.isLoading ? <div className="p-4"><LoadingState /></div> : jobs.isError ? <div className="p-4"><ErrorState message={t(language, "requestScans.jobsError", { message: localizeError(language, jobs.error) })} /></div> : !visible.length ? <div className="p-4"><EmptyState message={tab === "active" ? t(language, "requestScans.empty.active") : t(language, "requestScans.empty.other")} /></div> : <div className="overflow-x-auto"><Table className="min-w-[1050px] table-fixed"><TableHeader className="bg-slate-50/90"><TableRow>{selectableArchive.length > 0 && status.data?.canRetryArchives ? <TableHead className="w-10 px-2"><Checkbox aria-label={t(language, "requestScans.actions.selectArchive")} checked={selectedArchive.length === selectableArchive.length && selectableArchive.length > 0} onCheckedChange={(checked) => setSelected(checked ? selectableArchive.map((job) => job.id) : [])} /></TableHead> : null}<TableHead className="w-[18%] px-3 py-2 text-start text-[10px] uppercase tracking-[0.12em]">{t(language, "requestScans.column.scan")}</TableHead><TableHead className="w-[17%] px-3 py-2 text-start text-[10px] uppercase tracking-[0.12em]">{t(language, "requestScans.column.patient")}</TableHead><TableHead className="w-[22%] px-3 py-2 text-start text-[10px] uppercase tracking-[0.12em]">{t(language, "requestScans.column.appointment")}</TableHead><TableHead className="w-[21%] px-3 py-2 text-start text-[10px] uppercase tracking-[0.12em]">{t(language, "requestScans.column.workflow")}</TableHead><TableHead className="w-[12%] px-3 py-2 text-start text-[10px] uppercase tracking-[0.12em]">{t(language, "requestScans.column.attention")}</TableHead><TableHead className="w-[18%] px-3 py-2 text-start text-[10px] uppercase tracking-[0.12em]">{t(language, "requestScans.column.actions")}</TableHead></TableRow></TableHeader><TableBody>{visible.map((job) => <RequestScanRow key={job.id} language={language} job={job} showSelection={Boolean(selectableArchive.length > 0 && status.data?.canRetryArchives)} selected={selected.includes(job.id)} canRetryArchives={Boolean(status.data?.canRetryArchives)} openMenu={openMenuJobId === job.id} onSelect={(checked) => setSelected((ids) => checked ? [...new Set([...ids, job.id])] : ids.filter((id) => id !== job.id))} onToggleMenu={() => setOpenMenuJobId(openMenuJobId === job.id ? null : job.id)} onCloseMenu={() => setOpenMenuJobId(null)} onPreview={() => void openPreview(job)} onDetails={() => setDetails(job)} onRetryArchive={() => archiveRetry.mutate(job.id)} onRetry={() => genericRetry.mutate(job.id)} onAssign={() => setAssignTarget(job)} onAppointment={() => openAppointment(job)} retryPending={archiveRetry.isPending || genericRetry.isPending} />)}</TableBody></Table></div>}
        </div>
      </section>
    </div>

    <Dialog open={archiveDetailsOpen} onClose={() => setArchiveDetailsOpen(false)}><DialogContent maxWidth="640px"><DialogHeader closeLabel={t(language, "requestScans.actions.close")}><DialogTitle>{t(language, "requestScans.archive.details")}</DialogTitle></DialogHeader>{health ? <dl className="grid gap-3 text-sm sm:grid-cols-2"><div><dt className="font-semibold">{t(language, "requestScans.archive.destination")}</dt><dd dir="ltr" className="font-mono-data break-all">{health.name || t(language, "requestScans.archive.configured")}</dd></div><div><dt className="font-semibold">{t(language, "requestScans.archive.lastCheck")}</dt><dd dir="ltr" className="font-mono-data">{formatDateTime(language, health.lastConnectionCheck)}</dd></div><div><dt className="font-semibold">{t(language, "requestScans.archive.nextRetry")}</dt><dd dir="ltr" className="font-mono-data">{formatDateTime(language, health.nextRetryAt)}</dd></div><div><dt className="font-semibold">{t(language, "requestScans.archive.latestError")}</dt><dd>{health.lastError || t(language, "requestScans.details.none")}</dd></div></dl> : null}</DialogContent></Dialog>
    <Dialog open={bulkConfirm} onClose={() => setBulkConfirm(false)}><DialogContent maxWidth="560px"><DialogHeader closeLabel={t(language, "requestScans.actions.close")}><DialogTitle>{t(language, "requestScans.bulk.title")}</DialogTitle></DialogHeader><p className="text-sm">{t(language, "requestScans.bulk.body", { count: selectedArchive.length })}</p><DialogFooter><Button type="button" variant="secondary" onClick={() => setBulkConfirm(false)}>{t(language, "requestScans.actions.cancel")}</Button><Button type="button" onClick={() => bulkRetry.mutate(selectedArchive.map((job) => job.id))} disabled={!selectedArchive.length || bulkRetry.isPending}>{t(language, "requestScans.actions.retryBulk")}</Button></DialogFooter></DialogContent></Dialog>
    <Dialog open={Boolean(assign)} onClose={() => setAssign(null)}><DialogContent maxWidth="760px"><DialogHeader closeLabel={t(language, "requestScans.actions.close")}><DialogTitle>{t(language, "requestScans.assignment.title")}</DialogTitle></DialogHeader>{assign ? <div className="grid gap-4 text-sm md:grid-cols-2"><section className="rounded-xl border border-slate-200 p-3"><h3 className="font-semibold">{t(language, "requestScans.assignment.detected")}</h3><p className="mt-2">{t(language, "requestScans.field.filename")}: <TechnicalValue>{assign.filename}</TechnicalValue></p><p>{t(language, "requestScans.column.scanTime")}: <TechnicalValue>{formatDateTime(language, assign.created_at)}</TechnicalValue></p><Button type="button" className="mt-3" size="sm" variant="secondary" onClick={() => void openPreview(assign)}>{t(language, "requestScans.actions.preview")}</Button></section><section className="rounded-xl border border-slate-200 p-3"><label htmlFor="request-scan-appointment-search" className="font-semibold">{t(language, "requestScans.assignment.selected")}</label><input id="request-scan-appointment-search" className="input-premium mt-2 w-full" placeholder={t(language, "requestScans.assignment.search")} value={query} onChange={(event) => setQuery(event.target.value)} /><select className="input-premium mt-2 w-full" value={appointmentId} onChange={(event) => { setAppointmentId(event.target.value); setAssignmentConfirmed(false); setAssignmentError(null); }}><option value="">{t(language, "requestScans.assignment.select")}</option>{appointments.data?.appointments.map((item) => <option key={item.id} value={item.id}>{item.accession_number} · {chooseLocalized(language, item.patient_name_ar, item.patient_name_en) || item.patient_name || t(language, "requestScans.unconfirmed")}</option>)}</select>{selectedAppointment ? <div className="mt-3 space-y-1 text-xs"><BilingualValue language={language} arabic={selectedAppointment.patient_name_ar} english={selectedAppointment.patient_name_en} fallback={selectedAppointment.patient_name} /><p>{t(language, "requestScans.assignment.patientId")}: <TechnicalValue>{selectedAppointment.patient_mrn || selectedAppointment.patient_id || t(language, "requestScans.notRecorded")}</TechnicalValue></p><p>{t(language, "requestScans.assignment.nationalId")}: <TechnicalValue>{selectedAppointment.national_id || t(language, "requestScans.notRecorded")}</TechnicalValue></p><p>{t(language, "requestScans.assignment.dob")}: <TechnicalValue>{selectedAppointment.patient_date_of_birth || t(language, "requestScans.notRecorded")}</TechnicalValue> · {t(language, "requestScans.assignment.sex")}: {selectedAppointment.sex || t(language, "requestScans.notRecorded")}</p><p>{t(language, "requestScans.field.accession")}: <TechnicalValue>{selectedAppointment.accession_number}</TechnicalValue></p><BilingualValue language={language} arabic={selectedAppointment.modality_name_ar} english={selectedAppointment.modality_name_en} fallback={selectedAppointment.modality_name} /><BilingualValue language={language} arabic={selectedAppointment.exam_name_ar} english={selectedAppointment.exam_name_en} fallback={selectedAppointment.exam_name} /></div> : null}</section></div> : null}{selectedAppointment ? <p className="mt-3 rounded-lg border border-amber-300 bg-amber-50 p-2 text-sm">{t(language, "requestScans.assignment.recordWarning")}</p> : null}{assignmentError ? <p className="mt-3 text-sm text-red-700" role="alert">{assignmentError}</p> : null}<label className="mt-4 flex cursor-pointer items-start gap-2 text-sm"><Checkbox checked={assignmentConfirmed} onCheckedChange={(checked) => setAssignmentConfirmed(Boolean(checked))} />{t(language, "requestScans.assignment.confirmIdentity")}</label><DialogFooter><Button type="button" variant="secondary" onClick={() => setAssign(null)}>{t(language, "requestScans.actions.cancel")}</Button><Button type="button" disabled={!appointmentId || !assignmentConfirmed || assignMutation.isPending} onClick={() => assignMutation.mutate()}>{t(language, "requestScans.assignment.confirm")}</Button></DialogFooter></DialogContent></Dialog>
    <Dialog open={Boolean(preview)} onClose={closePreview}><DialogContent maxWidth="min(96vw, 1500px)" className="flex h-[94vh] flex-col overflow-hidden"><DialogHeader closeLabel={t(language, "requestScans.actions.close")} className="shrink-0"><div className="flex min-w-0 flex-wrap items-center gap-2"><DialogTitle className="min-w-0 flex-1 truncate"><TechnicalValue>{preview?.filename}</TechnicalValue></DialogTitle>{preview ? <div className="flex shrink-0 flex-wrap gap-2"><a href={requestScanFileUrl(preview.id)} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 rounded-lg border border-slate-200 px-2.5 py-1.5 text-xs font-semibold transition hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50 active:bg-slate-100"><ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />{t(language, "requestScans.actions.openBrowser")}</a>{preview.document_id ? <a href={attachedDocumentUrl(preview.document_id)} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 rounded-lg border border-slate-200 px-2.5 py-1.5 text-xs font-semibold transition hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50 active:bg-slate-100"><FileText className="h-3.5 w-3.5" aria-hidden="true" />{t(language, "requestScans.actions.viewAttached")}</a> : null}</div> : null}</div></DialogHeader><div className="min-h-0 flex-1 overflow-hidden">{previewUrl ? (preview?.filename.toLowerCase().endsWith(".pdf") ? <iframe className="h-full w-full" src={previewUrl} title={t(language, "requestScans.preview.title")} /> : <div className="flex h-full w-full items-center justify-center"><img className="h-full w-full object-contain" src={previewUrl} alt={preview?.filename} /></div>) : <div className="flex h-full items-center justify-center text-sm text-muted-foreground">{t(language, "requestScans.preview.loading")}</div>}</div></DialogContent></Dialog>
    <Dialog open={Boolean(details)} onClose={() => setDetails(null)}><DialogContent maxWidth="680px"><DialogHeader closeLabel={t(language, "requestScans.actions.close")}><DialogTitle>{t(language, "requestScans.details.title")}</DialogTitle><DialogDescription>{details ? <TechnicalValue>{details.filename}</TechnicalValue> : null}</DialogDescription></DialogHeader>{details ? <dl className="grid gap-3 text-sm sm:grid-cols-2"><div><dt className="font-semibold">{t(language, "requestScans.details.stage")}</dt><dd dir="ltr" className="font-mono-data">{details.processing_stage || t(language, "requestScans.details.notRecorded")}</dd></div><div><dt className="font-semibold">{t(language, "requestScans.details.failureCategory")}</dt><dd dir="ltr" className="font-mono-data">{details.failure_category || t(language, "requestScans.details.notRecorded")}</dd></div><div><dt className="font-semibold">{t(language, "requestScans.details.processingAttempts")}</dt><dd dir="ltr" className="font-mono-data">{details.attempt_count}</dd></div><div><dt className="font-semibold">{t(language, "requestScans.details.archiveAttempts")}</dt><dd dir="ltr" className="font-mono-data">{details.archive_attempt_count ?? 0}</dd></div><div><dt className="font-semibold">{t(language, "requestScans.details.archiveError")}</dt><dd>{details.archive_last_error || t(language, "requestScans.details.none")}</dd></div><div><dt className="font-semibold">{t(language, "requestScans.details.errorMessage")}</dt><dd>{details.error_message || t(language, "requestScans.details.none")}</dd></div></dl> : null}</DialogContent></Dialog>
    <AppointmentManageModal appointmentId={manageAppointmentId} open={manageAppointmentId !== null} onClose={() => setManageAppointmentId(null)} />
  </main>;
}
