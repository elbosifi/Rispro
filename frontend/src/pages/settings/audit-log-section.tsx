import { useEffect, useMemo, useRef, useState, type RefObject } from "react";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight, Copy, Download, RefreshCw, Search, X } from "lucide-react";
import { ApiError } from "@/lib/api-client";
import { exportAuditCSV, fetchAuditEntries, type AuditQueryParams } from "@/lib/api-hooks";
import { formatDateTimeLy } from "@/lib/date-format";
import type { AuditCategory, AuditEntry, AuditOutcome, AuditPagination } from "@/types/api";
import { useLanguage } from "@/providers/language-provider";
import { Button } from "@/components/shared/Button";

type AuditTab = AuditCategory | "all";
type AuditState = AuditQueryParams & { tab: AuditTab; page: number; pageSize: 25 | 50 | 100 };

const DEFAULT_STATE: AuditState = { tab: "important", page: 1, pageSize: 25 };
const TABS: Array<{ key: AuditTab; label: string }> = [
  { key: "important", label: "Important" },
  { key: "security", label: "Security" },
  { key: "automated", label: "Automated" },
  { key: "other", label: "Other" },
  { key: "all", label: "All" }
];
const OUTCOMES: Array<{ key: AuditOutcome; label: string }> = [
  { key: "successful", label: "Successful" },
  { key: "failed", label: "Failed" },
  { key: "rejected", label: "Rejected" },
  { key: "cancelled", label: "Cancelled" },
  { key: "pending", label: "Pending" },
  { key: "informational", label: "Informational" },
  { key: "unknown", label: "Unknown" }
];

function validPage(value: string | null): number {
  return value && /^\d+$/.test(value) && Number(value) > 0 ? Number(value) : 1;
}

function validPageSize(value: string | null): 25 | 50 | 100 {
  return value === "50" ? 50 : value === "100" ? 100 : 25;
}

function parseAuditUrl(): AuditState {
  if (typeof window === "undefined") return DEFAULT_STATE;
  const params = new URLSearchParams(window.location.search);
  const tab = params.get("auditTab");
  const validTab = TABS.some((item) => item.key === tab) ? tab as AuditTab : DEFAULT_STATE.tab;
  return {
    page: validPage(params.get("auditPage")),
    pageSize: validPageSize(params.get("auditPageSize")),
    tab: validTab,
    changedByUserId: params.get("auditActor") || undefined,
    entityType: params.get("auditEntity") || undefined,
    actionType: params.get("auditAction") || undefined,
    dateFrom: params.get("auditDateFrom") || undefined,
    dateTo: params.get("auditDateTo") || undefined,
    search: params.get("auditSearch") || undefined,
    outcome: params.get("auditOutcome") || undefined
  };
}

function writeAuditUrl(state: AuditState, mode: "push" | "replace" = "push") {
  if (typeof window === "undefined") return;
  const url = new URL(window.location.href);
  const values: Record<string, string | number | undefined> = {
    auditPage: state.page === 1 ? undefined : state.page,
    auditPageSize: state.pageSize === 25 ? undefined : state.pageSize,
    auditTab: state.tab === "important" ? undefined : state.tab,
    auditActor: state.changedByUserId,
    auditEntity: state.entityType,
    auditAction: state.actionType,
    auditDateFrom: state.dateFrom,
    auditDateTo: state.dateTo,
    auditSearch: state.search,
    auditOutcome: state.outcome
  };
  for (const [key, value] of Object.entries(values)) {
    if (value === undefined || value === "") url.searchParams.delete(key);
    else url.searchParams.set(key, String(value));
  }
  window.history[`${mode}State`]({}, "", `${url.pathname}${url.search}${url.hash}`);
}

function entryText(entry: AuditEntry, field: "title" | "summary" | "actorLabel" | "targetLabel"): string {
  if (entry[field]) return entry[field];
  if (field === "title") return `Performed ${entry.actionType || "unknown action"} on ${entry.entityType || "entity"}`;
  if (field === "actorLabel") return entry.changedByName || entry.changedByUsername || (entry.changedByUserId ? `User #${entry.changedByUserId}` : "System");
  if (field === "targetLabel") return `${entry.entityType || "Entity"}${entry.entityId ? ` #${entry.entityId}` : ""}`;
  return entry.actionType || "Audit activity recorded.";
}

function label(value: string): string {
  return value.replaceAll("_", " ").replace(/\b\w/g, (character) => character.toUpperCase());
}

function valueForDisplay(value: unknown): string {
  if (value === null || value === undefined || value === "") return "—";
  if (typeof value === "boolean") return value ? "Yes" : "No";
  if (typeof value === "object") return "Structured value";
  return String(value);
}

function objectValues(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function outcomeLabel(outcome: AuditOutcome): string {
  return label(outcome);
}

function categoryClass(category: AuditCategory): string {
  if (category === "important") return "border-amber-300 bg-amber-50 text-amber-800 dark:border-amber-700 dark:bg-amber-900/20 dark:text-amber-200";
  if (category === "security") return "border-blue-300 bg-blue-50 text-blue-800 dark:border-blue-700 dark:bg-blue-900/20 dark:text-blue-200";
  if (category === "automated") return "border-violet-300 bg-violet-50 text-violet-800 dark:border-violet-700 dark:bg-violet-900/20 dark:text-violet-200";
  return "border-border bg-muted/40 text-muted-foreground";
}

function outcomeClass(outcome: AuditOutcome): string {
  if (outcome === "failed" || outcome === "rejected") return "border-red-300 bg-red-50 text-red-800 dark:border-red-700 dark:bg-red-900/20 dark:text-red-200";
  if (outcome === "successful") return "border-emerald-300 bg-emerald-50 text-emerald-800 dark:border-emerald-700 dark:bg-emerald-900/20 dark:text-emerald-200";
  return "border-border bg-muted/40 text-muted-foreground";
}

export default function AuditLogSection({ onReAuthRequired }: { onReAuthRequired: (key: string[]) => void }) {
  const { t } = useLanguage();
  const [state, setState] = useState<AuditState>(parseAuditUrl);
  const [searchDraft, setSearchDraft] = useState(state.search || "");
  const [selectedEntry, setSelectedEntry] = useState<AuditEntry | null>(null);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const drawerCloseRef = useRef<HTMLButtonElement | null>(null);
  const listRef = useRef<HTMLDivElement | null>(null);

  const queryState = useMemo<AuditQueryParams>(() => ({
    page: state.page,
    pageSize: state.pageSize,
    dateFrom: state.dateFrom,
    dateTo: state.dateTo,
    changedByUserId: state.changedByUserId,
    entityType: state.entityType,
    actionType: state.actionType,
    category: state.tab === "all" ? undefined : state.tab,
    search: state.search,
    outcome: state.outcome
  }), [state]);
  const auditQuery = useQuery({
    queryKey: ["audit", queryState],
    queryFn: () => fetchAuditEntries(queryState),
    placeholderData: keepPreviousData
  });
  const pagination = auditQuery.data?.pagination;
  const totalPages = pagination?.totalPages || 0;
  const visiblePage = pagination?.page || 1;

  function updateState(patch: Partial<AuditState>, mode: "push" | "replace" = "push") {
    setState((current) => {
      const next = { ...current, ...patch };
      writeAuditUrl(next, mode);
      return next;
    });
  }

  useEffect(() => {
    const onPopState = () => {
      const next = parseAuditUrl();
      setState(next);
      setSearchDraft(next.search || "");
    };
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      if ((state.search || "") !== searchDraft) {
        updateState({ search: searchDraft.trim() || undefined, page: 1 });
      }
    }, 300);
    return () => window.clearTimeout(timer);
  }, [searchDraft]);

  useEffect(() => {
    if (selectedEntry) drawerCloseRef.current?.focus();
  }, [selectedEntry]);

  useEffect(() => {
    if (!auditQuery.isFetching && auditQuery.data) listRef.current?.scrollTo({ top: 0, behavior: "smooth" });
  }, [auditQuery.data?.pagination.page]);

  useEffect(() => {
    if (auditQuery.error instanceof ApiError && (auditQuery.error.status === 403 || auditQuery.error.message.includes("re-authentication"))) {
      onReAuthRequired(["audit", String(state.page), String(state.pageSize)]);
    }
  }, [auditQuery.error]);

  function clearFilters() {
    const tab = state.tab === "all" ? "all" : "important";
    setSearchDraft("");
    updateState({ ...DEFAULT_STATE, tab });
  }

  function openEntry(entry: AuditEntry, trigger: HTMLButtonElement) {
    triggerRef.current = trigger;
    setSelectedEntry(entry);
  }

  function closeDetails() {
    setSelectedEntry(null);
    window.setTimeout(() => triggerRef.current?.focus(), 0);
  }

  const activeFilters = Boolean(state.search || state.dateFrom || state.dateTo || state.changedByUserId || state.entityType || state.actionType || state.outcome);
  const error = auditQuery.error;
  const reauthError = error instanceof ApiError && (error.status === 403 || error.message.includes("re-authentication"));
  const summary = auditQuery.data?.summary;
  const entries = auditQuery.data?.entries || [];
  const emptyMessage = activeFilters ? "No audit events match the selected filters." : state.tab === "important" ? "No important activity was found for this period." : state.tab === "automated" ? "No automated activity was found for this period." : "No audit events have been recorded.";

  return (
    <div className="relative space-y-4">
      <div className="flex flex-col gap-3 rounded-xl border border-border bg-muted/20 p-3 lg:flex-row lg:items-end">
        <label className="min-w-0 flex-1 text-xs font-semibold text-muted-foreground">Search
          <span className="relative mt-1 block"><Search size={16} className="pointer-events-none absolute start-3 top-1/2 -translate-y-1/2 text-muted-foreground" /><input className="input-premium h-10 w-full ps-9" value={searchDraft} onChange={(event) => setSearchDraft(event.target.value)} placeholder="Actor, activity, target, status…" /></span>
        </label>
        <label className="text-xs font-semibold text-muted-foreground">From<input type="date" className="input-premium mt-1 h-10" value={state.dateFrom || ""} onChange={(event) => updateState({ dateFrom: event.target.value || undefined, page: 1 })} /></label>
        <label className="text-xs font-semibold text-muted-foreground">To<input type="date" className="input-premium mt-1 h-10" value={state.dateTo || ""} onChange={(event) => updateState({ dateTo: event.target.value || undefined, page: 1 })} /></label>
        <label className="text-xs font-semibold text-muted-foreground">Actor<select className="input-premium mt-1 h-10 max-w-48" value={state.changedByUserId || ""} onChange={(event) => updateState({ changedByUserId: event.target.value || undefined, page: 1 })}><option value="">All actors</option>{(auditQuery.data?.meta.users || []).map((user) => <option key={String(user.id)} value={String(user.id)}>{user.full_name || user.fullName || user.username || `User #${user.id}`} {user.username ? `(${user.username})` : ""}</option>)}</select></label>
        <label className="text-xs font-semibold text-muted-foreground">Entity<select className="input-premium mt-1 h-10 max-w-44" value={state.entityType || ""} onChange={(event) => updateState({ entityType: event.target.value || undefined, page: 1 })}><option value="">All entities</option>{(auditQuery.data?.meta.entityTypes || []).map((item) => <option key={item} value={item}>{label(item)}</option>)}</select></label>
        <label className="text-xs font-semibold text-muted-foreground">Action<select className="input-premium mt-1 h-10 max-w-44" value={state.actionType || ""} onChange={(event) => updateState({ actionType: event.target.value || undefined, page: 1 })}><option value="">All actions</option>{(auditQuery.data?.meta.actionTypes || []).map((item) => <option key={item} value={item}>{label(item)}</option>)}</select></label>
        <label className="text-xs font-semibold text-muted-foreground">Outcome<select className="input-premium mt-1 h-10 max-w-40" value={state.outcome || ""} onChange={(event) => updateState({ outcome: event.target.value || undefined, page: 1 })}><option value="">All outcomes</option>{OUTCOMES.map((item) => <option key={item.key} value={item.key}>{item.label}</option>)}</select></label>
        <div className="flex gap-2"><Button variant="secondary" size="icon" aria-label="Refresh audit log" title="Refresh" onClick={() => void auditQuery.refetch()}><RefreshCw size={16} /></Button><Button variant="secondary" onClick={() => void exportAuditCSV(queryState)}><Download size={16} className="me-2" />Export CSV</Button></div>
      </div>

      <div className="flex flex-wrap items-center gap-2" role="tablist" aria-label="Audit categories">
        {TABS.map((tab) => {
          const count = tab.key === "all" ? summary?.total : summary?.[tab.key];
          return <button key={tab.key} type="button" role="tab" aria-selected={state.tab === tab.key} onClick={() => updateState({ tab: tab.key, category: undefined, page: 1 })} className={`rounded-full border px-3 py-1.5 text-xs font-semibold transition-colors ${state.tab === tab.key ? "border-accent bg-accent/10 text-accent ring-1 ring-accent/20" : "border-border text-muted-foreground hover:bg-muted/50"}`}>{tab.label}{count === undefined ? "" : ` (${count})`}</button>;
        })}
      </div>

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-5" aria-label="Audit summary">
        {([ ["Total events", summary?.total], ["Important", summary?.important], ["Security", summary?.security], ["Automated", summary?.automated], ["Failed or rejected", summary?.failed] ] as Array<[string, number | undefined]>).map(([name, value]) => <div key={name} className="rounded-lg border border-border bg-muted/20 px-3 py-2"><p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">{name}</p><p className="mt-1 text-xl font-semibold text-foreground">{value ?? "—"}</p></div>)}
      </div>

      {error && !reauthError ? <div className="flex items-center justify-between gap-3 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800 dark:border-red-800 dark:bg-red-950/30 dark:text-red-200"><div><h4 className="font-semibold">Failed to load audit log</h4><p>{error instanceof Error ? error.message : "The audit log could not be loaded."}</p></div><Button variant="secondary" onClick={() => void auditQuery.refetch()}>Retry</Button></div> : null}
      {reauthError ? <div className="rounded-lg border border-amber-200 bg-amber-50 p-4 dark:border-amber-800 dark:bg-amber-950/30"><p className="text-sm font-medium text-amber-800 dark:text-amber-200">{t("settings.reauthRequired")}</p><p className="mt-1 text-xs text-amber-700 dark:text-amber-300">{t("settings.reauthHelp")}</p><Button className="mt-3" size="sm" onClick={() => onReAuthRequired(["audit", String(state.page), String(state.pageSize)])}>{t("common.reAuthenticate")}</Button></div> : null}
      {auditQuery.isFetching && !auditQuery.isLoading ? <p className="text-xs text-muted-foreground" aria-live="polite">Loading audit page…</p> : null}

      <div ref={listRef} className="overflow-auto rounded-xl border border-border" aria-busy={auditQuery.isFetching}>
        {auditQuery.isLoading ? <p className="p-8 text-center text-sm text-muted-foreground">Loading audit log…</p> : entries.length === 0 ? <div className="p-8 text-center text-sm text-muted-foreground"><p>{emptyMessage}</p>{activeFilters ? <Button variant="secondary" size="sm" className="mt-3" onClick={clearFilters}>Clear filters</Button> : null}</div> : <>
          <div className="hidden min-w-[760px] grid-cols-[130px_1.1fr_2fr_1.2fr_120px_120px] gap-3 border-b border-border bg-muted/30 px-3 py-2 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground md:grid"><span>Time</span><span>Actor</span><span>Activity</span><span>Target</span><span>Category</span><span>Outcome</span></div>
          <div className="divide-y divide-border">{entries.map((entry) => <AuditRow key={entry.id} entry={entry} onOpen={openEntry} />)}</div>
        </>}
      </div>

      {activeFilters ? <div className="flex justify-end"><Button variant="ghost" size="sm" onClick={clearFilters}>Clear filters</Button></div> : null}
      <Pagination state={state} pagination={pagination} totalPages={totalPages} visiblePage={visiblePage} busy={auditQuery.isFetching} onPageChange={(page) => updateState({ page })} onPageSizeChange={(pageSize) => updateState({ pageSize: pageSize as 25 | 50 | 100, page: 1 })} />

      {selectedEntry ? <AuditDetails entry={selectedEntry} closeRef={drawerCloseRef} onClose={closeDetails} /> : null}
    </div>
  );
}

function AuditRow({ entry, onOpen }: { entry: AuditEntry; onOpen: (entry: AuditEntry, trigger: HTMLButtonElement) => void }) {
  const category = entry.category || "other";
  const outcome = entry.outcome || "unknown";
  return <button type="button" className="block w-full text-start transition-colors hover:bg-muted/30 focus:outline-none focus:ring-2 focus:ring-inset focus:ring-accent/40" onClick={(event) => onOpen(entry, event.currentTarget)}>
    <div className="hidden min-w-[760px] grid-cols-[130px_1.1fr_2fr_1.2fr_120px_120px] items-center gap-3 px-3 py-3 text-sm md:grid"><span className="text-xs text-muted-foreground">{formatDateTimeLy(entry.createdAt)}</span><span className="truncate font-medium">{entryText(entry, "actorLabel")}</span><span className="min-w-0"><strong className="block truncate">{entryText(entry, "title")}</strong><span className="block truncate text-xs text-muted-foreground">{entryText(entry, "summary")}</span></span><span className="truncate text-sm">{entryText(entry, "targetLabel")}</span><span><span className={`inline-flex rounded-full border px-2 py-1 text-[10px] font-semibold ${categoryClass(category)}`}>{label(category)}</span></span><span>{outcome !== "unknown" ? <span className={`inline-flex rounded-full border px-2 py-1 text-[10px] font-semibold ${outcomeClass(outcome)}`}>{outcomeLabel(outcome)}</span> : <span className="text-xs text-muted-foreground">Unknown</span>}</span></div>
    <div className="space-y-2 p-3 md:hidden"><div className="flex items-start justify-between gap-3"><strong className="text-sm">{entryText(entry, "title")}</strong><span className={`shrink-0 rounded-full border px-2 py-1 text-[10px] font-semibold ${categoryClass(category)}`}>{label(category)}</span></div><p className="text-xs text-muted-foreground">{entryText(entry, "actorLabel")} · {formatDateTimeLy(entry.createdAt)}</p><p className="text-sm">{entryText(entry, "targetLabel")}</p>{outcome !== "unknown" ? <span className={`inline-flex rounded-full border px-2 py-1 text-[10px] font-semibold ${outcomeClass(outcome)}`}>{outcomeLabel(outcome)}</span> : null}</div>
  </button>;
}

function Pagination({ state, pagination, totalPages, visiblePage, busy, onPageChange, onPageSizeChange }: { state: AuditState; pagination?: AuditPagination; totalPages: number; visiblePage: number; busy: boolean; onPageChange: (page: number) => void; onPageSizeChange: (pageSize: number) => void }) {
  const pages = useMemo(() => {
    if (totalPages <= 7) return Array.from({ length: totalPages }, (_, index) => index + 1);
    const values = new Set([1, totalPages, Math.max(1, visiblePage - 1), visiblePage, Math.min(totalPages, visiblePage + 1)]);
    return Array.from(values).sort((a, b) => a - b);
  }, [totalPages, visiblePage]);
  if (!pagination) return null;
  return <div className="flex flex-col gap-3 border-t border-border pt-3 text-sm sm:flex-row sm:items-center sm:justify-between"><p className="text-xs text-muted-foreground">Showing {pagination.rangeStart}–{pagination.rangeEnd} of {pagination.totalItems} events</p><div className="flex items-center gap-2"><div className="hidden items-center gap-1 md:flex"><Button variant="ghost" size="icon" aria-label="First page" disabled={busy || !pagination.hasPreviousPage} onClick={() => onPageChange(1)}><ChevronsLeft size={16} /></Button><Button variant="ghost" size="icon" aria-label="Previous page" disabled={busy || !pagination.hasPreviousPage} onClick={() => onPageChange(Math.max(1, visiblePage - 1))}><ChevronLeft size={16} /></Button>{pages.map((page, index) => <span key={page}>{index > 0 && page - pages[index - 1] > 1 ? <span className="px-1 text-muted-foreground">…</span> : null}<button type="button" disabled={busy} aria-label={`Page ${page}`} aria-current={page === visiblePage ? "page" : undefined} onClick={() => onPageChange(page)} className={`h-8 min-w-8 rounded px-2 text-xs disabled:opacity-50 ${page === visiblePage ? "bg-accent text-white" : "hover:bg-muted"}`}>{page}</button></span>)}<Button variant="ghost" size="icon" aria-label="Next page" disabled={busy || !pagination.hasNextPage} onClick={() => onPageChange(Math.min(totalPages, visiblePage + 1))}><ChevronRight size={16} /></Button><Button variant="ghost" size="icon" aria-label="Last page" disabled={busy || !pagination.hasNextPage} onClick={() => onPageChange(totalPages)}><ChevronsRight size={16} /></Button></div><div className="flex w-full items-center justify-between gap-2 md:hidden"><Button variant="secondary" size="sm" disabled={busy || !pagination.hasPreviousPage} onClick={() => onPageChange(Math.max(1, visiblePage - 1))}>Previous</Button><span className="text-xs text-muted-foreground">Page {visiblePage} of {totalPages || 1}</span><Button variant="secondary" size="sm" disabled={busy || !pagination.hasNextPage} onClick={() => onPageChange(Math.min(totalPages, visiblePage + 1))}>Next</Button></div><label className="flex items-center gap-2 text-xs text-muted-foreground">Rows<select className="input-premium h-8" value={state.pageSize} disabled={busy} onChange={(event) => onPageSizeChange(Number(event.target.value))}><option value="25">25</option><option value="50">50</option><option value="100">100</option></select></label></div></div>;
}

function AuditDetails({ entry, closeRef, onClose }: { entry: AuditEntry; closeRef: RefObject<HTMLButtonElement | null>; onClose: () => void }) {
  const oldValues = objectValues(entry.oldValues);
  const newValues = objectValues(entry.newValues);
  const keys = Array.from(new Set([...Object.keys(oldValues), ...Object.keys(newValues)]));
  const copy = (value: string) => { if (navigator.clipboard) void navigator.clipboard.writeText(value); };
  return <div className="fixed inset-0 z-50 flex justify-end bg-black/30" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}><aside className="h-full w-full max-w-xl overflow-y-auto border-s border-border bg-background p-5 shadow-2xl" role="dialog" aria-modal="true" aria-labelledby="audit-detail-title"><div className="flex items-start justify-between gap-3"><div><h2 id="audit-detail-title" className="text-lg font-semibold">{entryText(entry, "title")}</h2><p className="mt-1 text-sm text-muted-foreground">{entryText(entry, "summary")}</p></div><button ref={closeRef} type="button" className="btn-ghost" aria-label="Close audit details" onClick={onClose}><X size={18} /></button></div><dl className="mt-5 grid grid-cols-[auto_1fr] gap-x-4 gap-y-3 text-sm"><dt className="text-muted-foreground">Time</dt><dd>{formatDateTimeLy(entry.createdAt)}</dd><dt className="text-muted-foreground">Actor</dt><dd>{entryText(entry, "actorLabel")}</dd><dt className="text-muted-foreground">Username</dt><dd>{entry.changedByUsername || "—"}</dd><dt className="text-muted-foreground">Category</dt><dd><span className={`inline-flex rounded-full border px-2 py-1 text-xs font-semibold ${categoryClass(entry.category || "other")}`}>{label(entry.category || "other")}</span></dd><dt className="text-muted-foreground">Outcome</dt><dd>{outcomeLabel(entry.outcome || "unknown")}</dd><dt className="text-muted-foreground">Target</dt><dd>{entryText(entry, "targetLabel")}</dd><dt className="text-muted-foreground">Entity</dt><dd>{entry.entityType} {entry.entityId ? `#${entry.entityId}` : ""}</dd><dt className="text-muted-foreground">Action</dt><dd className="font-mono text-xs">{entry.actionType}</dd><dt className="text-muted-foreground">Audit event ID</dt><dd className="flex items-center gap-2">{entry.id}<button type="button" className="btn-ghost h-7 w-7 p-0" aria-label="Copy audit event ID" onClick={() => copy(String(entry.id))}><Copy size={14} /></button></dd></dl><section className="mt-6"><h3 className="font-semibold">Changes</h3>{keys.length === 0 ? <p className="mt-2 text-sm text-muted-foreground">No field-level changes were recorded.</p> : <div className="mt-2 divide-y divide-border rounded-lg border border-border">{keys.map((key) => <div key={key} className="grid gap-2 p-3 text-sm sm:grid-cols-[1fr_1fr]"><div><p className="text-xs font-semibold text-muted-foreground">{label(key)} · Before</p><p className="mt-1 break-words">{valueForDisplay(oldValues[key])}</p></div><div><p className="text-xs font-semibold text-muted-foreground">{label(key)} · After</p><p className="mt-1 break-words">{valueForDisplay(newValues[key])}</p></div></div>)}</div>}</section><details className="mt-6 rounded-lg border border-border p-3"><summary className="cursor-pointer text-sm font-semibold">Technical data</summary><pre className="mt-3 max-h-72 overflow-auto whitespace-pre-wrap break-words text-xs text-muted-foreground">{JSON.stringify({ oldValues: entry.oldValues, newValues: entry.newValues }, null, 2)}</pre></details></aside></div>;
}
