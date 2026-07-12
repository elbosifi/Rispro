import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Button } from "@/components/shared/Button";
import { fetchSystemDiagnosticEvent, fetchSystemDiagnosticEvents, fetchSystemDiagnosticsSummary } from "@/lib/api-hooks";
import { formatDateTimeLy } from "@/lib/date-format";

function value(value: unknown): string { return value === null || value === undefined || value === "" ? "—" : String(value); }

export default function SystemDiagnosticsSection({ onReAuthRequired }: { onReAuthRequired: (key: string[]) => void }) {
  const [tab, setTab] = useState<"overview" | "events">("overview");
  const [severity, setSeverity] = useState("");
  const [status, setStatus] = useState("");
  const [requestId, setRequestId] = useState("");
  const [source, setSource] = useState("");
  const [component, setComponent] = useState("");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState<string | null>(null);
  const summary = useQuery({ queryKey: ["system-diagnostics", "summary"], queryFn: fetchSystemDiagnosticsSummary });
  const events = useQuery({ queryKey: ["system-diagnostics", "events", severity, status, requestId, source, component, dateFrom, dateTo, page], queryFn: () => fetchSystemDiagnosticEvents({ severity, status, requestId, source, component, dateFrom, dateTo, page, pageSize: 25 }), enabled: tab === "events" });
  const detail = useQuery({ queryKey: ["system-diagnostics", "event", selected], queryFn: () => fetchSystemDiagnosticEvent(selected!), enabled: Boolean(selected) });
  const error = summary.error || events.error || detail.error;
  if (error) {
    const message = error instanceof Error ? error.message : "Failed to load system diagnostics";
    if (message.includes("re-authentication") || message.includes("403")) { onReAuthRequired(["system-diagnostics"]); return <p className="description-center">Recent supervisor re-authentication is required.</p>; }
    return <div className="space-y-2"><h4 className="font-semibold text-red-700">Failed to load system diagnostics</h4><Button variant="secondary" onClick={() => { void summary.refetch(); void events.refetch(); }}>Retry</Button></div>;
  }
  const application = (summary.data?.application || {}) as Record<string, unknown>;
  const database = (summary.data?.database || {}) as Record<string, unknown>;
  const recent = (summary.data?.recentDiagnostics || {}) as Record<string, unknown>;
  const ohif = (summary.data?.ohifViewer || {}) as Record<string, unknown>;
  return <div className="space-y-4">
    <div className="flex gap-2 border-b border-border pb-2"><Button variant={tab === "overview" ? "primary" : "secondary"} onClick={() => setTab("overview")}>Overview</Button><Button variant={tab === "events" ? "primary" : "secondary"} onClick={() => setTab("events")}>Events</Button><Button variant="secondary" className="ml-auto" onClick={() => { void summary.refetch(); void events.refetch(); }}>Refresh</Button></div>
    {tab === "overview" ? summary.isLoading ? <p className="description-center">Loading system diagnostics…</p> : <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
      <Card title="Application" rows={{ Environment: application.environment, Version: application.version, Uptime: `${value(application.uptimeSeconds)} seconds`, "Server time": application.serverTime }} />
      <Card title="Database" rows={{ Status: database.status, Reachable: database.reachable, Latency: database.latencyMs ? `${database.latencyMs} ms` : "—" }} />
      <Card title="Recent diagnostics" rows={{ "Errors (24h)": recent.errors_24h, "Critical (24h)": recent.critical_24h, Unresolved: recent.unresolved, "Latest error": recent.latest_error_time }} />
      <Card title="OHIF Viewer" rows={{ "Environment gate": ohif.environmentEnabled, Enabled: ohif.enabled, Strategy: ohif.access_strategy, "Selected PACS": ohif.selected_pacs_node_id, "Last QIDO": ohif.qido_last_status, "Last WADO metadata": ohif.wado_metadata_last_status, "Active retrievals": ohif.active_retrieval_jobs, "Retrieval failures (24h)": ohif.retrieval_failures_24h }} />
    </div> : <div className="space-y-3">
      <div className="flex flex-wrap gap-2"><select aria-label="Severity" value={severity} onChange={(e) => { setSeverity(e.target.value); setPage(1); }} className="input-premium"><option value="">All severities</option><option value="error">Error</option><option value="warning">Warning</option><option value="critical">Critical</option></select><select aria-label="Status" value={status} onChange={(e) => { setStatus(e.target.value); setPage(1); }} className="input-premium"><option value="">All statuses</option><option value="unresolved">Unresolved</option><option value="resolved">Resolved</option></select><input aria-label="Source" value={source} onChange={(e) => { setSource(e.target.value); setPage(1); }} placeholder="Source" className="input-premium" /><input aria-label="Component" value={component} onChange={(e) => { setComponent(e.target.value); setPage(1); }} placeholder="Component" className="input-premium" /><input aria-label="From date" type="date" value={dateFrom} onChange={(e) => { setDateFrom(e.target.value); setPage(1); }} className="input-premium" /><input aria-label="To date" type="date" value={dateTo} onChange={(e) => { setDateTo(e.target.value); setPage(1); }} className="input-premium" /><input aria-label="Request ID" value={requestId} onChange={(e) => { setRequestId(e.target.value); setPage(1); }} placeholder="Request ID" className="input-premium" /></div>
      {events.isLoading ? <p className="description-center">Loading diagnostic events…</p> : events.data?.events.length ? <div className="space-y-2">{events.data.events.map((event) => <button type="button" key={String(event.event_id)} onClick={() => setSelected(String(event.event_id))} className="block w-full rounded border border-border p-3 text-left hover:bg-muted/40"><div className="flex justify-between gap-2"><span className="font-semibold">{value(event.severity).toUpperCase()} · {value(event.source)}/{value(event.component)}</span><span className="text-xs description-center">{formatDateTimeLy(String(event.occurred_at))}</span></div><p className="mt-1 text-sm">{value(event.message)}</p><p className="mt-1 text-xs description-center">{value(event.http_method)} {value(event.route)} · {value(event.request_id)}</p></button>)}</div> : <p className="description-center">No diagnostic events match these filters.</p>}
      <div className="flex items-center justify-between"><Button variant="secondary" disabled={page <= 1} onClick={() => setPage(page - 1)}>Previous</Button><span className="text-xs description-center">Page {page} · {events.data?.total || 0} events</span><Button variant="secondary" disabled={!events.data || page * events.data.pageSize >= events.data.total} onClick={() => setPage(page + 1)}>Next</Button></div>
      {detail.data?.event ? <div className="rounded border border-border p-3 text-sm"><h4 className="font-semibold">Event details</h4><dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1"><dt>Event ID</dt><dd>{value(detail.data.event.event_id)}</dd><dt>Request ID</dt><dd>{value(detail.data.event.request_id)}</dd><dt>Technical details</dt><dd className="whitespace-pre-wrap break-all">{value(detail.data.event.technical_details)}</dd><dt>Safe metadata</dt><dd className="break-all">{value(detail.data.event.metadata && JSON.stringify(detail.data.event.metadata))}</dd><dt>Resolution note</dt><dd>{value(detail.data.event.resolution_note)}</dd></dl></div> : null}
    </div>}
  </div>;
}
function Card({ title, rows }: { title: string; rows: Record<string, unknown> }) { return <div className="rounded-xl border border-border bg-muted/20 p-4"><h4 className="font-semibold">{title}</h4><dl className="mt-2 space-y-1 text-sm">{Object.entries(rows).map(([label, row]) => <div className="flex justify-between gap-2" key={label}><dt className="description-center">{label}</dt><dd className="text-right">{value(row)}</dd></div>)}</dl></div>; }
