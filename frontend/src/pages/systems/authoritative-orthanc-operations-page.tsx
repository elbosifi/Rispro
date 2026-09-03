import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Activity, AlertTriangle, Database, HardDrive, Search, Server } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "@/providers/auth-provider";
import { api } from "@/lib/api-client";
import { formatDateTimeLy, tripoliDateTimeLocalToIso } from "@/lib/date-format";
import { Badge, Button, Card, Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, EmptyState, ErrorState, Input, LoadingState, Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/shared";

type SectionError = { code: string; message: string } | null;
type RouteTestState = "not_tested" | "reachable" | "unreachable" | "timeout" | "missing_route" | "configuration_error";
type OperationalRoute = {
  destinationKey: string; destinationName: string; alias: string; aet: string; host: string; port: number | null;
  selectedForAutoRouting: true; autoRouteActive: boolean; managedAliasExists: boolean | null;
  configurationState: "configured" | "missing_managed_route" | "invalid_pacs_configuration" | "not_checked";
  configurationError: string | null;
  dicomTest: { state: RouteTestState; connected: boolean | null; testedAt: string | null; code: string | null; message: string | null };
};
type TransferContext = { remoteAet: string | null; localAet: string | null; destinationName: string | null; instanceCount: number | null; failedInstanceCount: number | null; parentResourceIds: string[]; contextStatus: "resolved" | "unavailable" | "multiple_resources"; study: { orthancStudyId: string; patientId: string | null; patientName: string | null; accessionNumber: string | null; studyDate: string | null; studyDescription: string | null; modalitiesInStudy: string[] } | null };
type OperationalJob = { id: string; type: string; state: "Pending" | "Running" | "Success" | "Failure" | "Paused" | "Retry"; progress: number | null; creationTime: string | null; startTime: string | null; completionTime: string | null; updatedAt: string | null; description: string; error: string | null; retryPermitted: boolean; transfer: TransferContext | null };
type ClinicalFailure = { id: number; appointmentId: number; status: "failed" | "blocked"; lastAttemptAt: string | null; updatedAt: string; error: string; retryPermitted: true };
type OperationsSummary = {
  overallState: "healthy" | "degraded" | "offline" | "disabled";
  connectionState: "connected" | "degraded" | "unavailable" | "disabled";
  healthSentence: string;
  reasons: Array<{ code: string; message: string }>;
  system: { name: string | null; version: string | null; apiVersion: string | null; uptimeSeconds: number | null } | null;
  statistics: { data: { studies: number | null; series: number | null; instances: number | null; diskSizeBytes: number | null; diskSizeMb: number | null; uncompressedSizeBytes: number | null; uncompressedSizeMb: number | null } | null; error: SectionError };
  routing: { autoRouteEnabled: boolean; selected: number; configured: number; missing: number; invalid: number; routes: OperationalRoute[]; error: SectionError };
  jobs: { items: OperationalJob[]; summary: { total: number; running: number; pending: number; failed: number; successful: number; paused: number; recentRelevantFailed: number; recentFailureWindowHours: number }; error: SectionError };
  clinicalDocuments: { data: { pending: number; processing: number; retryable: number; failed: number; completed: number; oldestPendingOrRetryableAt: string | null; latestFailures: ClinicalFailure[] }; error: SectionError };
  generatedAt: string;
};
type StudyResult = { status: "matched" | "not_found" | "ambiguous"; matchKey: "study_instance_uid" | "accession_number"; reason?: string; study: { orthancStudyId: string; studyInstanceUid: string | null; accessionNumber: string | null; patientId: string | null; patientName: string | null; patientBirthDate: string | null; patientSex: string | null; studyDate: string | null; studyDescription: string | null; modalitiesInStudy: string[]; seriesCount: number; instanceCount: number } | null };
type HistoricalPacsStatus = {
  indexStatus: "ready" | "stale" | "unavailable" | "uninitialized"; runStatus: "idle" | "running" | "failed"; mode: "full" | "incremental" | null;
  indexedStudies: number; historicalPatientIds: number; orthancStudies: number | null; processed: number | null; total: number | null; progressPercent: number | null;
  startedAt: string | null; progressAt: string | null; isStalled: boolean; stalledForSeconds: number | null; lastSuccessAt: string | null; lastFullSyncAt: string | null; lastAttemptAt: string | null;
  lastChangeSequence: number | null; lastError: string | null;
};
type DicomTransferHistoryDirection = "all" | "received" | "sent";
type DicomTransferHistoryStatus = "all" | "active" | "successful" | "failed";
type DicomTransferHistoryPageSize = 25 | 50 | 100;
type DicomTransferHistoryItem = {
  id: string;
  direction: "RECEIVED" | "SENT";
  status: "ACTIVE" | "SUCCESS" | "FAILED";
  patientId: string | null;
  patientName: string | null;
  accessionNumber: string | null;
  studyInstanceUid: string;
  studyDescription: string | null;
  sourceAet: string | null;
  sourceIp: string | null;
  destinationAet: string | null;
  instanceCount: number | null;
  firstSeenAt: string;
  lastSeenAt: string;
  completedAt: string | null;
  occurredAt: string;
  errorCode: string | null;
  errorMessage: string | null;
  orthancJobId: string | null;
  orthancChangeSequence: number | null;
  orthancResourceId: string | null;
  createdAt: string;
  updatedAt: string;
};
type DicomTransferHistoryResponse = {
  items: DicomTransferHistoryItem[];
  page: number;
  pageSize: DicomTransferHistoryPageSize;
  total: number;
  totalPages: number;
};
type Confirmation = { title: string; description: string; confirmLabel?: string; run: () => void } | null;

const statePresentation = {
  healthy: { label: "Healthy", variant: "success" as const, className: "border-emerald-300 bg-emerald-50 dark:border-emerald-800 dark:bg-emerald-950/30" },
  degraded: { label: "Degraded", variant: "warning" as const, className: "border-amber-300 bg-amber-50 dark:border-amber-800 dark:bg-amber-950/30" },
  offline: { label: "Offline", variant: "error" as const, className: "border-red-300 bg-red-50 dark:border-red-800 dark:bg-red-950/30" },
  disabled: { label: "Disabled", variant: "neutral" as const, className: "border-slate-300 bg-slate-50 dark:border-slate-700 dark:bg-slate-900/40" },
};

function formatDate(value: string | null): string { if (!value) return "—"; const compact = value.match(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})(?:\.(\d+))?$/); const parsed = compact ? new Date(Date.UTC(Number(compact[1]), Number(compact[2]) - 1, Number(compact[3]), Number(compact[4]), Number(compact[5]), Number(compact[6]), Number((compact[7] || "").slice(0, 3).padEnd(3, "0")))) : new Date(value); return Number.isNaN(parsed.getTime()) ? value : parsed.toLocaleString(); }
function formatDicomDate(value: string | null): string { if (!value) return "—"; return /^\d{8}$/.test(value) ? `${value.slice(0, 4)}-${value.slice(4, 6)}-${value.slice(6, 8)}` : value; }
function formatStorage(bytes: number | null, mb: number | null): string { const value = bytes ?? (mb == null ? null : mb * 1024 * 1024); if (value == null) return "Unavailable"; const units = ["B", "KB", "MB", "GB", "TB"]; let scaled = value; let index = 0; while (scaled >= 1024 && index < units.length - 1) { scaled /= 1024; index += 1; } return `${scaled >= 10 || index === 0 ? scaled.toFixed(0) : scaled.toFixed(1)} ${units[index]}`; }
function formatCount(value: number): string { return value.toLocaleString("en-US"); }
function formatRelativeDate(value: string | null): string { if (!value) return "—"; const time = new Date(value).getTime(); if (!Number.isFinite(time)) return formatDate(value); const seconds = Math.round((time - Date.now()) / 1000); const magnitude = Math.abs(seconds); const [amount, unit] = magnitude < 60 ? [seconds, "second"] : magnitude < 3600 ? [Math.round(seconds / 60), "minute"] : magnitude < 86400 ? [Math.round(seconds / 3600), "hour"] : [Math.round(seconds / 86400), "day"]; return new Intl.RelativeTimeFormat(undefined, { numeric: "auto" }).format(amount, unit as Intl.RelativeTimeFormatUnit); }
function MetricCard({ label, value, icon }: { label: string; value: string | number; icon: React.ReactNode }) { return <Card variant="compact" className="flex min-w-0 items-center gap-3"><span className="rounded-lg bg-accent/10 p-2 text-accent">{icon}</span><span className="min-w-0"><span className="block text-xs font-medium text-muted-foreground">{label}</span><strong className="block truncate text-xl text-foreground">{value}</strong></span></Card>; }
function SectionHeading({ title, description, action }: { title: string; description: string; action?: React.ReactNode }) { return <div className="flex flex-wrap items-start justify-between gap-3"><div><h2 className="text-lg font-semibold text-foreground">{title}</h2><p className="text-sm text-muted-foreground">{description}</p></div>{action}</div>; }
function RouteTestBadge({ state }: { state: RouteTestState }) { const display = { not_tested: ["Not tested", "neutral"], reachable: ["Reachable", "success"], unreachable: ["Unreachable", "error"], timeout: ["Timeout", "error"], missing_route: ["Missing route", "warning"], configuration_error: ["Configuration error", "warning"] } as const; return <Badge variant={display[state][1]}>{display[state][0]}</Badge>; }
function isDicomTransferHistoryPageSize(value: number): value is DicomTransferHistoryPageSize { return value === 25 || value === 50 || value === 100; }

export default function AuthoritativeOrthancOperationsPage() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [notice, setNotice] = useState<string | null>(null);
  const [jobFilter, setJobFilter] = useState<"all" | "active" | "failed" | "successful">("all");
  const [lookupType, setLookupType] = useState<"accessionNumber" | "studyInstanceUid">("accessionNumber");
  const [lookupValue, setLookupValue] = useState("");
  const [studyResult, setStudyResult] = useState<StudyResult | null>(null);
  const [confirmation, setConfirmation] = useState<Confirmation>(null);
  const [selectedJob, setSelectedJob] = useState<OperationalJob | null>(null);
  const [historyDirection, setHistoryDirection] = useState<DicomTransferHistoryDirection>("all");
  const [historyStatus, setHistoryStatus] = useState<DicomTransferHistoryStatus>("all");
  const [historyPage, setHistoryPage] = useState(1);
  const [historyPageSize, setHistoryPageSize] = useState<DicomTransferHistoryPageSize>(25);
  const [historyDraftSearch, setHistoryDraftSearch] = useState("");
  const [historyDraftSource, setHistoryDraftSource] = useState("");
  const [historyDraftDestination, setHistoryDraftDestination] = useState("");
  const [historyDraftFrom, setHistoryDraftFrom] = useState("");
  const [historyDraftTo, setHistoryDraftTo] = useState("");
  const [historyAppliedSearch, setHistoryAppliedSearch] = useState("");
  const [historyAppliedSource, setHistoryAppliedSource] = useState("");
  const [historyAppliedDestination, setHistoryAppliedDestination] = useState("");
  const [historyAppliedFrom, setHistoryAppliedFrom] = useState("");
  const [historyAppliedTo, setHistoryAppliedTo] = useState("");
  const canOperate = user?.role === "supervisor" || user?.role === "super_admin";
  const isSuperAdmin = user?.role === "super_admin";
  const summary = useQuery({ queryKey: ["authoritative-orthanc", "operations", "summary"], queryFn: () => api<OperationsSummary>("/integrations/authoritative-orthanc/operations/summary"), refetchInterval: 30_000, retry: false });
  const historicalPacs = useQuery({
    queryKey: ["authoritative-orthanc", "operations", "historical-pacs-index"],
    queryFn: () => api<HistoricalPacsStatus>("/integrations/authoritative-orthanc/operations/historical-pacs-index/status"),
    refetchInterval: (query) => query.state.data?.runStatus === "running" ? 2_500 : 30_000,
    retry: false,
  });
  const history = useQuery({
    queryKey: ["authoritative-orthanc", "operations", "dicom-transfer-history", historyDirection, historyStatus, historyAppliedSearch, historyAppliedSource, historyAppliedDestination, historyAppliedFrom, historyAppliedTo, historyPage, historyPageSize],
    queryFn: () => {
      const params = new URLSearchParams({ direction: historyDirection, status: historyStatus, page: String(historyPage), pageSize: String(historyPageSize) });
      if (historyAppliedSearch) params.set("search", historyAppliedSearch);
      if (historyAppliedSource) params.set("source", historyAppliedSource);
      if (historyAppliedDestination) params.set("destination", historyAppliedDestination);
      if (historyAppliedFrom) params.set("from", historyAppliedFrom);
      if (historyAppliedTo) params.set("to", historyAppliedTo);
      return api<DicomTransferHistoryResponse>(`/integrations/authoritative-orthanc/operations/dicom-transfer-history?${params.toString()}`);
    },
    refetchInterval: 30_000,
    retry: false,
  });
  const applyHistoryFilters = () => {
    setHistoryAppliedSearch(historyDraftSearch.trim());
    setHistoryAppliedSource(historyDraftSource.trim());
    setHistoryAppliedDestination(historyDraftDestination.trim());
    setHistoryAppliedFrom(historyDraftFrom ? tripoliDateTimeLocalToIso(historyDraftFrom.trim()) ?? "" : "");
    setHistoryAppliedTo(historyDraftTo ? tripoliDateTimeLocalToIso(historyDraftTo.trim()) ?? "" : "");
    setHistoryPage(1);
  };
  const clearHistoryFilters = () => {
    setHistoryDirection("all");
    setHistoryStatus("all");
    setHistoryDraftSearch("");
    setHistoryDraftSource("");
    setHistoryDraftDestination("");
    setHistoryDraftFrom("");
    setHistoryDraftTo("");
    setHistoryAppliedSearch("");
    setHistoryAppliedSource("");
    setHistoryAppliedDestination("");
    setHistoryAppliedFrom("");
    setHistoryAppliedTo("");
    setHistoryPage(1);
  };
  const refresh = async () => { await Promise.all([summary.refetch(), historicalPacs.refetch(), history.refetch()]); setNotice("Operations status refreshed."); };
  const mutation = useMutation({
    mutationFn: async ({ path, method = "POST" }: { path: string; method?: string }) => api<unknown>(path, { method }),
    onSuccess: async () => { setConfirmation(null); setNotice("Action completed."); await queryClient.invalidateQueries({ queryKey: ["authoritative-orthanc", "operations"] }); },
    onError: (error: Error) => { setConfirmation(null); setNotice(error.message); },
  });
  const historicalPacsMutation = useMutation({
    mutationFn: (kind: "sync" | "full" | "recover") => api(`/integrations/authoritative-orthanc/operations/historical-pacs-index/${kind === "full" ? "full-reconciliation" : kind === "recover" ? "recover-and-full-reconcile" : "sync"}`, { method: "POST" }),
    onSuccess: async (_result, kind) => { setConfirmation(null); setNotice(kind === "recover" ? "Stalled Historical PACS synchronization recovered; full reconciliation started." : kind === "full" ? "Full Historical PACS reconciliation started." : "Historical PACS synchronization started."); await historicalPacs.refetch(); },
    onError: (error: Error) => { setConfirmation(null); setNotice(error.message); void historicalPacs.refetch(); },
  });
  const lookup = useMutation({
    mutationFn: () => api<StudyResult>(`/integrations/authoritative-orthanc/operations/studies/search?${new URLSearchParams({ [lookupType]: lookupValue.trim() })}`),
    onSuccess: (result) => { setStudyResult(result); setNotice(null); },
    onError: (error: Error) => { setStudyResult(null); setNotice(error.message); },
  });
  const filteredJobs = useMemo(() => (summary.data?.jobs.items || []).filter((job) => job.transfer != null).filter((job) => {
    if (jobFilter === "all") return true;
    if (jobFilter === "active") return ["Pending", "Running", "Paused", "Retry"].includes(job.state);
    if (jobFilter === "failed") return job.state === "Failure";
    return job.state === "Success";
  }), [jobFilter, summary.data?.jobs.items]);
  const data = summary.data;
  const presentation = statePresentation[data?.overallState || "offline"];
  const orthancActionsDisabled = !data || data.overallState === "offline" || data.overallState === "disabled" || mutation.isPending;
  const runConfirmed = (title: string, description: string, path: string, confirmLabel?: string) => setConfirmation({ title, description, confirmLabel, run: () => mutation.mutate({ path }) });
  const historyTotal = history.data?.total ?? 0;
  const historyTotalPages = history.data?.totalPages ?? 0;
  const historyStart = historyTotal === 0 ? 0 : (historyPage - 1) * historyPageSize + 1;
  const historyEnd = Math.min(historyPage * historyPageSize, historyTotal);
  const historyDisplayPage = historyTotal === 0 ? 1 : historyPage;
  const historyDisplayTotalPages = historyTotalPages === 0 ? 1 : historyTotalPages;

  return <div className="mx-auto max-w-[1500px] space-y-5" data-testid="authoritative-orthanc-operations-page">
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div><h1 className="text-2xl font-semibold text-foreground">Authoritative Orthanc</h1><p className="text-sm text-muted-foreground">Monitor the primary Orthanc archive, DICOM routing, transfer jobs, and RISpro clinical-document integration.</p></div>
      <div className="flex flex-wrap gap-2"><Button variant="secondary" onClick={() => void refresh()} disabled={summary.isFetching}>Refresh</Button>{canOperate ? <Button variant="secondary" disabled={orthancActionsDisabled} onClick={() => mutation.mutate({ path: "/integrations/authoritative-orthanc/operations/routes/test-all" })}>Test all destinations</Button> : null}{isSuperAdmin ? <Button disabled={orthancActionsDisabled} onClick={() => runConfirmed("Synchronize managed routes?", "RISpro will create or update expected rispro_route_* aliases and remove only obsolete RISpro-managed aliases. Unrelated Orthanc modalities are preserved.", "/integrations/authoritative-orthanc/operations/routes/synchronize")}>Synchronize routes</Button> : null}</div>
    </div>

    {notice ? <p role="status" className="rounded-lg border bg-card px-3 py-2 text-sm text-foreground">{notice}</p> : null}
    {summary.isLoading ? <LoadingState message="Loading Authoritative Orthanc operations…" /> : summary.error ? <Card className="p-5"><ErrorState message={(summary.error as Error).message} onRetry={() => void summary.refetch()} /></Card> : data ? <>
      <Card className={`border p-5 ${presentation.className}`}>
        <div className="flex flex-wrap items-start justify-between gap-4"><div className="flex items-start gap-3"><span className="rounded-xl bg-background/80 p-3 text-accent"><Server size={24} /></span><div><div className="flex flex-wrap items-center gap-2"><h2 className="text-xl font-semibold">Authoritative Orthanc</h2><Badge variant={presentation.variant}>{presentation.label}</Badge></div><p className="mt-1 text-sm font-medium">{data.system?.name || "Orthanc system unavailable"}{data.system?.version ? ` · Orthanc ${data.system.version}` : ""}{data.system?.apiVersion ? ` · API ${data.system.apiVersion}` : ""}</p><p className="mt-2 max-w-4xl text-sm">{data.healthSentence}</p></div></div><div className="text-end text-xs text-muted-foreground">Last refresh<br/><span className="font-medium text-foreground">{formatDate(data.generatedAt)}</span></div></div>
        {data.reasons.length ? <ul className="mt-4 grid gap-2 md:grid-cols-2">{data.reasons.map((reason) => <li key={reason.code} className="flex gap-2 text-sm"><AlertTriangle className="mt-0.5 h-4 w-4 shrink-0"/><span>{reason.message}</span></li>)}</ul> : null}
      </Card>

      <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-7" aria-label="Orthanc operational metrics">
        <MetricCard label="Studies" value={data.statistics.data?.studies ?? "Unavailable"} icon={<Database size={18}/>} />
        <MetricCard label="Series" value={data.statistics.data?.series ?? "Unavailable"} icon={<Database size={18}/>} />
        <MetricCard label="Instances" value={data.statistics.data?.instances ?? "Unavailable"} icon={<Database size={18}/>} />
        <MetricCard label="Storage used" value={formatStorage(data.statistics.data?.diskSizeBytes ?? null, data.statistics.data?.diskSizeMb ?? null)} icon={<HardDrive size={18}/>} />
        <MetricCard label="Running jobs" value={data.jobs.summary.running} icon={<Activity size={18}/>} />
        <MetricCard label="Pending jobs" value={data.jobs.summary.pending} icon={<Activity size={18}/>} />
        <MetricCard label="Failed jobs" value={data.jobs.summary.failed} icon={<AlertTriangle size={18}/>} />
      </section>

      <Card className="space-y-4 p-5" data-testid="historical-pacs-index-card">
        <SectionHeading title="Historical PACS Index" description="Read-only synchronization from Authoritative Orthanc into RISpro's historical search index." action={historicalPacs.data ? <Badge variant={historicalPacs.data.runStatus === "running" ? "info" : historicalPacs.data.runStatus === "failed" ? "error" : historicalPacs.data.indexStatus === "ready" ? "success" : historicalPacs.data.indexStatus === "stale" ? "warning" : "neutral"}>{historicalPacs.data.runStatus === "running" ? "Syncing" : historicalPacs.data.runStatus === "failed" ? "Failed" : historicalPacs.data.indexStatus === "ready" ? "Ready" : historicalPacs.data.indexStatus === "stale" ? "Stale" : "Not initialized"}</Badge> : undefined}/>
        {historicalPacs.isLoading ? <LoadingState message="Loading Historical PACS index status…" /> : historicalPacs.error ? <ErrorState message={(historicalPacs.error as Error).message} onRetry={() => void historicalPacs.refetch()} /> : historicalPacs.data ? <>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <MetricCard label="Indexed studies" value={formatCount(historicalPacs.data.indexedStudies)} icon={<Database size={18}/>} />
            <MetricCard label="Historical Patient IDs" value={formatCount(historicalPacs.data.historicalPatientIds)} icon={<Database size={18}/>} />
            <MetricCard label="Orthanc studies" value={historicalPacs.data.orthancStudies == null ? "Unavailable" : formatCount(historicalPacs.data.orthancStudies)} icon={<Database size={18}/>} />
            <MetricCard label="Coverage" value={historicalPacs.data.orthancStudies && historicalPacs.data.orthancStudies > 0 ? `${Number(Math.min(100, (historicalPacs.data.indexedStudies / historicalPacs.data.orthancStudies) * 100).toFixed(1))}%` : "Unavailable"} icon={<Activity size={18}/>} />
          </div>
          {historicalPacs.data.runStatus === "running" ? <div className="rounded-lg border bg-muted/20 p-4" data-testid="historical-pacs-running">
            <p className="font-semibold">{historicalPacs.data.mode === "full" ? "Full synchronization in progress" : "Incremental synchronization in progress"}</p>
            {historicalPacs.data.mode === "full" ? <div className="mt-3 space-y-2">
              <div className="h-2 overflow-hidden rounded-full bg-muted" role="progressbar" aria-label="Historical PACS reconciliation progress" aria-valuemin={0} aria-valuemax={historicalPacs.data.total == null ? undefined : 100} aria-valuenow={historicalPacs.data.progressPercent ?? undefined}><div className={`h-full rounded-full bg-accent ${historicalPacs.data.progressPercent == null ? "w-1/3 animate-pulse" : ""}`} style={historicalPacs.data.progressPercent == null ? undefined : { width: `${historicalPacs.data.progressPercent}%` }}/></div>
              <p className="text-sm font-medium">{historicalPacs.data.total == null ? `${formatCount(historicalPacs.data.processed ?? 0)} studies processed` : `${formatCount(historicalPacs.data.processed ?? 0)} / ${formatCount(historicalPacs.data.total)} studies`}{historicalPacs.data.progressPercent == null ? "" : ` · ${historicalPacs.data.progressPercent.toFixed(1)}%`}</p>
            </div> : null}
            <div className="mt-3 grid gap-2 text-sm sm:grid-cols-2"><p><span className="text-muted-foreground">Started:</span> {formatDate(historicalPacs.data.startedAt)}</p><p><span className="text-muted-foreground">Last progress:</span> {formatDate(historicalPacs.data.progressAt)}</p></div>
            {historicalPacs.data.isStalled ? <div className="mt-3 rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900 dark:border-amber-800 dark:bg-amber-950/30 dark:text-amber-100" role="alert">Historical PACS synchronization appears stalled. No progress has been recorded for {Math.max(1, Math.ceil((historicalPacs.data.stalledForSeconds ?? 0) / 60))} minutes.</div> : null}
          </div> : null}
          <dl className="grid gap-x-6 gap-y-2 text-sm sm:grid-cols-2 lg:grid-cols-3"><div><dt className="text-muted-foreground">Last successful sync</dt><dd className="font-medium">{formatRelativeDate(historicalPacs.data.lastSuccessAt)}</dd></div><div><dt className="text-muted-foreground">Last full reconciliation</dt><dd className="font-medium">{formatDate(historicalPacs.data.lastFullSyncAt)}</dd></div><div><dt className="text-muted-foreground">Changes cursor</dt><dd className="font-medium">{historicalPacs.data.lastChangeSequence == null ? "—" : formatCount(historicalPacs.data.lastChangeSequence)}</dd></div></dl>
          {historicalPacs.data.lastError ? <div className="rounded-lg border border-red-300 bg-red-50 p-3 text-sm text-red-900 dark:border-red-800 dark:bg-red-950/30 dark:text-red-100" role="alert">{historicalPacs.data.lastError}</div> : <p className="text-sm text-muted-foreground">No synchronization errors</p>}
          {historicalPacs.data.indexStatus !== "ready" ? <div className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900 dark:border-amber-800 dark:bg-amber-950/30 dark:text-amber-100">Patient History can use indexed PACS results, but absence in PACS is not definitive until the historical index is current.</div> : null}
          {canOperate ? <div className="flex flex-wrap gap-2"><Button variant="secondary" disabled={historicalPacs.data.runStatus === "running" || historicalPacsMutation.isPending} onClick={() => historicalPacsMutation.mutate("sync")}>{historicalPacsMutation.isPending && historicalPacsMutation.variables === "sync" ? "Starting…" : "Sync now"}</Button><Button disabled={historicalPacs.data.runStatus === "running" || historicalPacsMutation.isPending} onClick={() => setConfirmation({ title: "Run full Historical PACS reconciliation?", description: "RISpro will read the complete Authoritative Orthanc study inventory and refresh the local historical search index. This is read-only toward Orthanc but can take several minutes.", confirmLabel: "Run full reconciliation", run: () => historicalPacsMutation.mutate("full") })}>{historicalPacsMutation.isPending && historicalPacsMutation.variables === "full" ? "Starting…" : "Run full reconciliation"}</Button>{historicalPacs.data.runStatus === "running" && historicalPacs.data.isStalled ? <Button variant="secondary" disabled={historicalPacsMutation.isPending} onClick={() => setConfirmation({ title: "Restart stalled Historical PACS reconciliation?", description: "The current synchronization appears stalled. RISpro will stop/recover the stalled synchronization, preserve the local historical index, and start a new complete read-only reconciliation from Authoritative Orthanc.", confirmLabel: "Restart full reconciliation", run: () => historicalPacsMutation.mutate("recover") })}>{historicalPacsMutation.isPending && historicalPacsMutation.variables === "recover" ? "Restarting…" : "Restart full reconciliation"}</Button> : null}</div> : null}
        </> : null}
      </Card>

      <Card className="space-y-4 p-5">
        <SectionHeading title="Routing destinations" description="Selected PACS destinations and their expected RISpro-managed Authoritative Orthanc aliases." action={canOperate ? <Button variant="secondary" size="sm" disabled={orthancActionsDisabled} onClick={() => mutation.mutate({ path: "/integrations/authoritative-orthanc/operations/routes/test-all" })}>Test all</Button> : undefined}/>
        {data.routing.autoRouteEnabled && data.routing.selected === 0 ? <div className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900 dark:border-amber-800 dark:bg-amber-950/30 dark:text-amber-100">Auto-routing is enabled but no destinations are selected. Configure destinations in Settings.</div> : null}
        {data.routing.error ? <ErrorState message={data.routing.error.message} onRetry={() => void summary.refetch()} /> : data.routing.routes.length === 0 ? <EmptyState message="No auto-routing destinations are selected." /> : <div className="overflow-x-auto"><Table><TableHeader><TableRow><TableHead>Destination</TableHead><TableHead>Orthanc alias</TableHead><TableHead>AET</TableHead><TableHead>Host:Port</TableHead><TableHead>Configuration</TableHead><TableHead>Last DICOM test</TableHead><TableHead>Auto-route</TableHead><TableHead>Actions</TableHead></TableRow></TableHeader><TableBody>{data.routing.routes.map((route) => <TableRow key={route.alias}><TableCell className="font-medium">{route.destinationName}</TableCell><TableCell><code>{route.alias}</code></TableCell><TableCell>{route.aet || "—"}</TableCell><TableCell>{route.host ? `${route.host}:${route.port ?? "—"}` : "—"}</TableCell><TableCell>{route.configurationState === "configured" ? <Badge variant="success">Configured</Badge> : route.configurationState === "missing_managed_route" ? <Badge variant="warning">Missing managed route</Badge> : route.configurationState === "invalid_pacs_configuration" ? <Badge variant="error">Invalid PACS configuration</Badge> : <Badge variant="neutral">Not checked</Badge>}{route.configurationError ? <p className="mt-1 max-w-64 text-xs text-red-700 dark:text-red-300">{route.configurationError}</p> : null}</TableCell><TableCell><RouteTestBadge state={route.dicomTest.state}/>{route.dicomTest.testedAt ? <p className="mt-1 whitespace-nowrap text-xs text-muted-foreground">{formatDate(route.dicomTest.testedAt)}</p> : null}</TableCell><TableCell><Badge variant={route.autoRouteActive ? "success" : "neutral"}>{route.autoRouteActive ? "Active" : "Inactive"}</Badge></TableCell><TableCell>{canOperate ? <Button variant="secondary" size="sm" disabled={orthancActionsDisabled || route.configurationState !== "configured"} onClick={() => mutation.mutate({ path: `/integrations/authoritative-orthanc/operations/routes/${encodeURIComponent(route.alias)}/test` })}>Test</Button> : "—"}</TableCell></TableRow>)}</TableBody></Table></div>}
      </Card>

      <Card className="space-y-4 p-5" data-testid="dicom-transfer-history-card">
        <SectionHeading title="DICOM Transfer History" description="Durable audit of DICOM received by and sent from the Authoritative Orthanc. Received entries are recorded after Orthanc marks the study stable."/>
        <div className="space-y-3">
          <div className="flex flex-wrap gap-4">
            <div className="flex flex-wrap items-center gap-2" role="group" aria-label="Direction filters">
              <span className="text-sm font-medium">Direction</span>
              {(["all", "received", "sent"] as const).map((direction) => <Button key={direction} type="button" size="sm" variant={historyDirection === direction ? "primary" : "secondary"} aria-pressed={historyDirection === direction} onClick={() => { setHistoryDirection(direction); setHistoryPage(1); }}>{direction === "all" ? "All" : direction[0].toUpperCase() + direction.slice(1)}</Button>)}
            </div>
            <div className="flex flex-wrap items-center gap-2" role="group" aria-label="Status filters">
              <span className="text-sm font-medium">Status</span>
              {(["all", "active", "successful", "failed"] as const).map((status) => <Button key={status} type="button" size="sm" variant={historyStatus === status ? "primary" : "secondary"} aria-pressed={historyStatus === status} onClick={() => { setHistoryStatus(status); setHistoryPage(1); }}>{status === "all" ? "All" : status[0].toUpperCase() + status.slice(1)}</Button>)}
            </div>
          </div>
          <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
            <label className="min-w-0"><span className="mb-1 block text-sm font-medium">Search</span><Input aria-label="Search" placeholder="Patient, ID, accession, or Study UID" value={historyDraftSearch} onChange={(event) => setHistoryDraftSearch(event.target.value)} /></label>
            <label className="min-w-0"><span className="mb-1 block text-sm font-medium">Source</span><Input aria-label="Source" placeholder="Source AET or IP" value={historyDraftSource} onChange={(event) => setHistoryDraftSource(event.target.value)} /></label>
            <label className="min-w-0"><span className="mb-1 block text-sm font-medium">Destination</span><Input aria-label="Destination" placeholder="Destination AET" value={historyDraftDestination} onChange={(event) => setHistoryDraftDestination(event.target.value)} /></label>
            <label className="min-w-0"><span className="mb-1 block text-sm font-medium">From</span><Input aria-label="From" type="datetime-local" value={historyDraftFrom} onChange={(event) => setHistoryDraftFrom(event.target.value)} /></label>
            <label className="min-w-0"><span className="mb-1 block text-sm font-medium">To</span><Input aria-label="To" type="datetime-local" value={historyDraftTo} onChange={(event) => setHistoryDraftTo(event.target.value)} /></label>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button type="button" onClick={applyHistoryFilters}>Apply filters</Button>
            <Button type="button" variant="secondary" onClick={clearHistoryFilters}>Clear filters</Button>
          </div>
        </div>
        {history.isLoading ? <LoadingState message="Loading DICOM Transfer History…" /> : history.error ? <ErrorState message={(history.error as Error).message} onRetry={() => void history.refetch()} /> : history.data ? <>
          {history.data.items.length === 0 ? <EmptyState message="No DICOM transfers match the current filters." /> : <div className="overflow-x-auto"><Table><TableHeader><TableRow><TableHead>Direction</TableHead><TableHead>Status</TableHead><TableHead>Patient</TableHead><TableHead>Accession</TableHead><TableHead>Study</TableHead><TableHead>Source</TableHead><TableHead>Destination</TableHead><TableHead>Instances</TableHead><TableHead>Time</TableHead></TableRow></TableHeader><TableBody>{history.data.items.map((item) => <TableRow key={item.id}><TableCell><Badge variant={item.direction === "RECEIVED" ? "info" : "accent"}>{item.direction === "RECEIVED" ? "Received" : "Sent"}</Badge></TableCell><TableCell>{item.status === "ACTIVE" ? <Badge variant="info">Active</Badge> : item.status === "FAILED" ? <><Badge variant="error">Failed</Badge>{item.errorMessage ? <p className="mt-1 max-w-48 text-xs text-red-700 dark:text-red-300">{item.errorMessage}</p> : null}</> : <Badge variant="success">{item.direction === "RECEIVED" ? "Received / stable" : "Successful"}</Badge>}</TableCell><TableCell className="min-w-40"><p className="font-medium">{item.patientName || "—"}</p><p className="text-xs text-muted-foreground">{item.patientId || "—"}</p></TableCell><TableCell>{item.accessionNumber || "—"}</TableCell><TableCell className="min-w-48"><p className="font-medium">{item.studyDescription || "Study"}</p><span className="block max-w-64 truncate font-mono text-xs text-muted-foreground" title={item.studyInstanceUid}>{item.studyInstanceUid}</span></TableCell><TableCell className="min-w-40"><p className="font-medium">{item.sourceAet || "—"}</p>{item.sourceIp ? <p className="text-xs text-muted-foreground">{item.sourceIp}</p> : null}</TableCell><TableCell>{item.destinationAet || "—"}</TableCell><TableCell>{item.instanceCount == null ? "—" : formatCount(item.instanceCount)}</TableCell><TableCell className="whitespace-nowrap">{formatDateTimeLy(item.occurredAt)}</TableCell></TableRow>)}</TableBody></Table></div>}
          <div className="flex flex-wrap items-center justify-between gap-3 border-t pt-4 text-sm" data-testid="dicom-transfer-history-pagination">
            <p className="text-muted-foreground">Showing {historyStart}–{historyEnd} of {historyTotal} transfers</p>
            <p className="font-medium">Page {historyDisplayPage} of {historyDisplayTotalPages}</p>
            <div className="flex items-center gap-2"><Button type="button" size="sm" variant="secondary" disabled={historyPage <= 1} onClick={() => setHistoryPage((current) => Math.max(1, current - 1))}>Previous</Button><Button type="button" size="sm" variant="secondary" disabled={historyTotalPages === 0 || historyPage >= historyTotalPages} onClick={() => setHistoryPage((current) => current + 1)}>Next</Button><label className="flex items-center gap-2"><span className="sr-only">History page size</span><select aria-label="History page size" className="input-premium h-[var(--control-height-sm)]" value={historyPageSize} onChange={(event) => { const nextPageSize = Number(event.target.value); if (isDicomTransferHistoryPageSize(nextPageSize)) { setHistoryPageSize(nextPageSize); setHistoryPage(1); } }}><option value={25}>25</option><option value={50}>50</option><option value={100}>100</option></select></label></div>
          </div>
        </> : null}
      </Card>

      <Card className="space-y-4 p-5">
        <SectionHeading title="Outbound transfer jobs" description="Live Authoritative Orthanc send jobs. Failures appear first, followed by active work and recent successful sends."/>
        <div className="flex flex-wrap gap-2" role="group" aria-label="Job filters">{(["all", "active", "failed", "successful"] as const).map((filter) => <Button key={filter} size="sm" variant={jobFilter === filter ? "primary" : "secondary"} onClick={() => setJobFilter(filter)}>{filter[0].toUpperCase() + filter.slice(1)}</Button>)}</div>
        {data.jobs.error ? <ErrorState message={data.jobs.error.message} onRetry={() => void summary.refetch()} /> : filteredJobs.length === 0 ? <EmptyState message="No transfers match this filter." /> : <div className="overflow-x-auto"><Table><TableHeader><TableRow><TableHead>State</TableHead><TableHead>Patient</TableHead><TableHead>Accession</TableHead><TableHead>Study</TableHead><TableHead>Destination</TableHead><TableHead>Transfer</TableHead><TableHead>Time</TableHead><TableHead>Action</TableHead></TableRow></TableHeader><TableBody>{filteredJobs.map((job) => { const transfer = job.transfer!; const study = transfer.study; return <TableRow key={job.id}><TableCell><Badge variant={job.state === "Success" ? "success" : job.state === "Failure" ? "error" : job.state === "Running" ? "info" : "warning"}>{job.state}</Badge>{job.error ? <p className="mt-1 text-xs text-red-700 dark:text-red-300">{job.error}</p> : null}</TableCell><TableCell>{study ? <><p className="font-medium">{study.patientName || "—"}</p><p className="text-xs text-muted-foreground">{study.patientId || "—"}</p></> : "Context unavailable"}</TableCell><TableCell>{study?.accessionNumber || "—"}</TableCell><TableCell><p className="font-medium">{study?.studyDescription || "Study details unavailable"}</p><p className="text-xs text-muted-foreground">{study?.modalitiesInStudy.join(", ")}</p></TableCell><TableCell><p className="font-medium">{transfer.destinationName || "—"}</p><p className="text-xs text-muted-foreground">{transfer.remoteAet}</p></TableCell><TableCell><p>{job.progress == null ? "—" : `${job.progress}%`}</p>{transfer.instanceCount != null ? <p className="text-xs text-muted-foreground">{job.state === "Failure" && transfer.failedInstanceCount != null ? `${transfer.failedInstanceCount} failed of ${transfer.instanceCount.toLocaleString()}` : `${transfer.instanceCount.toLocaleString()} instances`}</p> : null}</TableCell><TableCell className="whitespace-nowrap">{formatDate(job.completionTime || job.updatedAt || job.startTime || job.creationTime)}</TableCell><TableCell><div className="flex gap-2">{canOperate && job.retryPermitted ? <Button size="sm" variant="secondary" disabled={orthancActionsDisabled} onClick={() => runConfirmed("Retry failed Orthanc job?", `Retry ${job.type} job ${job.id}. Orthanc will resubmit this failed job.`, `/integrations/authoritative-orthanc/operations/jobs/${encodeURIComponent(job.id)}/retry`)}>Retry</Button> : null}<Button size="sm" variant="secondary" onClick={() => setSelectedJob(job)}>Details</Button></div></TableCell></TableRow>; })}</TableBody></Table></div>}
      </Card>

      <Card className="space-y-4 p-5">
        <SectionHeading title="Study lookup" description="Search Authoritative Orthanc using one exact clinical identifier. This tool is read-only."/>
        <form className="flex flex-col gap-3 sm:flex-row sm:items-end" onSubmit={(event) => { event.preventDefault(); if (lookupValue.trim()) lookup.mutate(); }}><label className="sm:w-64"><span className="mb-1 block text-sm font-medium">Search type</span><select className="input w-full" aria-label="Study search type" value={lookupType} onChange={(event) => { setLookupType(event.target.value as typeof lookupType); setStudyResult(null); }}><option value="accessionNumber">Accession Number</option><option value="studyInstanceUid">StudyInstanceUID</option></select></label><label className="min-w-0 flex-1"><span className="mb-1 block text-sm font-medium">{lookupType === "accessionNumber" ? "Accession Number" : "StudyInstanceUID"}</span><Input aria-label="Study lookup value" value={lookupValue} onChange={(event) => setLookupValue(event.target.value)} placeholder={lookupType === "accessionNumber" ? "Enter exact accession number" : "Enter exact StudyInstanceUID"}/></label><Button type="submit" disabled={!lookupValue.trim() || lookup.isPending || data.overallState === "offline" || data.overallState === "disabled"}><Search size={16}/> Search</Button></form>
        {lookup.isPending ? <LoadingState message="Searching Authoritative Orthanc…" /> : studyResult?.status === "not_found" ? <EmptyState message="No study matched that identifier." /> : studyResult?.status === "ambiguous" ? <div className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900 dark:border-amber-800 dark:bg-amber-950/30 dark:text-amber-100">Multiple or conflicting studies matched this identifier. Refine the identifier or verify it directly with an administrator.</div> : studyResult?.study ? <div className="grid gap-3 rounded-lg border bg-muted/20 p-4 sm:grid-cols-2 lg:grid-cols-4"><div><span className="text-xs text-muted-foreground">Patient</span><p className="font-medium">{studyResult.study.patientName || "—"}</p></div><div><span className="text-xs text-muted-foreground">Patient ID</span><p className="font-medium">{studyResult.study.patientId || "—"}</p></div><div><span className="text-xs text-muted-foreground">DOB / sex</span><p className="font-medium">{formatDicomDate(studyResult.study.patientBirthDate)} / {studyResult.study.patientSex || "—"}</p></div><div><span className="text-xs text-muted-foreground">Accession</span><p className="font-medium">{studyResult.study.accessionNumber || "—"}</p></div><div className="sm:col-span-2"><span className="text-xs text-muted-foreground">StudyInstanceUID</span><p className="break-all font-mono text-sm">{studyResult.study.studyInstanceUid || "—"}</p></div><div><span className="text-xs text-muted-foreground">Study date</span><p className="font-medium">{formatDicomDate(studyResult.study.studyDate)}</p></div><div><span className="text-xs text-muted-foreground">Modalities</span><p className="font-medium">{studyResult.study.modalitiesInStudy.join(", ") || "—"}</p></div><div className="sm:col-span-2"><span className="text-xs text-muted-foreground">Description</span><p className="font-medium">{studyResult.study.studyDescription || "—"}</p></div><div><span className="text-xs text-muted-foreground">Series</span><p className="font-medium">{studyResult.study.seriesCount}</p></div><div><span className="text-xs text-muted-foreground">Instances</span><p className="font-medium">{studyResult.study.instanceCount}</p></div></div> : null}
      </Card>

      <Card className="space-y-4 p-5">
        <SectionHeading title="Selected-PACS clinical-document export health" description="Selected-PACS export queue health and recovery controls, independent of the Authoritative Orthanc archive."/>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5"><MetricCard label="Pending" value={data.clinicalDocuments.data.pending} icon={<Activity size={18}/>}/><MetricCard label="Processing" value={data.clinicalDocuments.data.processing} icon={<Activity size={18}/>}/><MetricCard label="Retryable" value={data.clinicalDocuments.data.retryable} icon={<AlertTriangle size={18}/>}/><MetricCard label="Failed / blocked" value={data.clinicalDocuments.data.failed} icon={<AlertTriangle size={18}/>}/><MetricCard label="Completed" value={data.clinicalDocuments.data.completed} icon={<Database size={18}/>}/></div>
        {data.clinicalDocuments.error ? <ErrorState message={data.clinicalDocuments.error.message} onRetry={() => void summary.refetch()} /> : data.clinicalDocuments.data.latestFailures.length === 0 ? <p className="text-sm text-muted-foreground">No failed or blocked clinical-document exports.</p> : <div className="overflow-x-auto"><Table><TableHeader><TableRow><TableHead>Export</TableHead><TableHead>Appointment</TableHead><TableHead>Status</TableHead><TableHead>Last attempt</TableHead><TableHead>Error</TableHead><TableHead>Action</TableHead></TableRow></TableHeader><TableBody>{data.clinicalDocuments.data.latestFailures.map((item) => <TableRow key={item.id}><TableCell>#{item.id}</TableCell><TableCell>#{item.appointmentId}</TableCell><TableCell><Badge variant="error">{item.status}</Badge></TableCell><TableCell>{formatDate(item.lastAttemptAt || item.updatedAt)}</TableCell><TableCell className="max-w-xl">{item.error}</TableCell><TableCell>{canOperate ? <Button size="sm" variant="secondary" disabled={mutation.isPending} onClick={() => runConfirmed("Retry clinical-document export?", `Retry export ${item.id} for appointment ${item.appointmentId} using the existing export queue.`, `/integrations/authoritative-orthanc/document-exports/${item.id}/retry`)}>Retry</Button> : "—"}</TableCell></TableRow>)}</TableBody></Table></div>}
      </Card>

      {isSuperAdmin ? <div className="flex justify-end"><Button variant="ghost" onClick={() => navigate("/settings?section=authoritative_orthanc")}>Open Authoritative Orthanc Settings</Button></div> : null}
    </> : null}

    <Dialog open={Boolean(confirmation)} onClose={() => { if (!mutation.isPending && !historicalPacsMutation.isPending) setConfirmation(null); }}><DialogContent maxWidth="520px"><DialogHeader><DialogTitle>{confirmation?.title}</DialogTitle><DialogDescription>{confirmation?.description}</DialogDescription></DialogHeader><DialogFooter><Button variant="secondary" disabled={mutation.isPending || historicalPacsMutation.isPending} onClick={() => setConfirmation(null)}>Cancel</Button><Button disabled={mutation.isPending || historicalPacsMutation.isPending} onClick={() => confirmation?.run()}>{mutation.isPending || historicalPacsMutation.isPending ? "Working…" : confirmation?.confirmLabel || "Confirm"}</Button></DialogFooter></DialogContent></Dialog>
    <Dialog open={Boolean(selectedJob)} onClose={() => setSelectedJob(null)}><DialogContent maxWidth="560px"><DialogHeader><DialogTitle>Transfer details</DialogTitle><DialogDescription>Operational transfer context and read-only Orthanc job information.</DialogDescription></DialogHeader>{selectedJob ? <div className="grid gap-3 text-sm sm:grid-cols-2"><div><span className="text-xs text-muted-foreground">Patient</span><p>{selectedJob.transfer?.study?.patientName || "Context unavailable"}</p></div><div><span className="text-xs text-muted-foreground">Patient ID</span><p>{selectedJob.transfer?.study?.patientId || "-"}</p></div><div><span className="text-xs text-muted-foreground">Accession</span><p>{selectedJob.transfer?.study?.accessionNumber || "-"}</p></div><div><span className="text-xs text-muted-foreground">Study / modality</span><p>{selectedJob.transfer?.study?.studyDescription || "-"} {selectedJob.transfer?.study?.modalitiesInStudy.join(", ")}</p></div><div><span className="text-xs text-muted-foreground">Destination</span><p>{selectedJob.transfer?.destinationName || "-"}</p></div><div><span className="text-xs text-muted-foreground">Instances</span><p>{selectedJob.transfer?.instanceCount ?? "-"} {selectedJob.transfer?.failedInstanceCount != null ? `${selectedJob.transfer.failedInstanceCount} failed` : ""}</p></div>{selectedJob.error ? <div className="sm:col-span-2"><span className="text-xs text-muted-foreground">Error</span><p>{selectedJob.error}</p></div> : null}<div className="border-t pt-3 sm:col-span-2"><span className="text-xs font-medium text-muted-foreground">Technical</span></div><div><span className="text-xs text-muted-foreground">Orthanc job ID / type</span><p>{selectedJob.id} / {selectedJob.type}</p></div><div><span className="text-xs text-muted-foreground">Description</span><p>{selectedJob.description}</p></div><div><span className="text-xs text-muted-foreground">Local / remote AET</span><p>{selectedJob.transfer?.localAet || "-"} / {selectedJob.transfer?.remoteAet || "-"}</p></div><div><span className="text-xs text-muted-foreground">Parent resource IDs</span><p>{selectedJob.transfer?.parentResourceIds.join(", ") || "-"}</p></div><div><span className="text-xs text-muted-foreground">Creation / start</span><p>{formatDate(selectedJob.creationTime)} / {formatDate(selectedJob.startTime)}</p></div><div><span className="text-xs text-muted-foreground">Completion / update</span><p>{formatDate(selectedJob.completionTime || selectedJob.updatedAt)}</p></div></div> : null}<DialogFooter><Button variant="secondary" onClick={() => setSelectedJob(null)}>Close</Button></DialogFooter></DialogContent></Dialog>
  </div>;
}
