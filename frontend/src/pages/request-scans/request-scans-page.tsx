import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";

type Job = {
  id: number;
  filename: string;
  status: "pending" | "processing" | "processed" | "duplicate" | "failed";
  barcode_value: string | null;
  appointment_id: number | null;
  document_id: number | null;
  error_message: string | null;
  attempt_count: number;
  created_at: string;
  processing_stage?: string | null;
  processing_started_at?: string | null;
  heartbeat_at?: string | null;
  lease_expires_at?: string | null;
  progress_current?: number | null;
  progress_total?: number | null;
  patient_name?: string | null;
  modality_name?: string | null;
  exam_name?: string | null;
};
type Appointment = { id: number; accession_number: string; patient_name: string | null };
type RequestScanStatus = {
  enabled: boolean;
  lastRunAt: string | null;
  lastError: string | null;
  running: boolean;
  pending: number;
  processing: number;
  processedToday: number;
  duplicatesToday: number;
  failed: number;
};
type RequestScanTab = "active" | "processed" | "duplicate" | "failed" | "all";
type WorkerTrigger = { status: "accepted" | "already_running" | "disabled" };

export function requestScanStatusPollInterval(status?: RequestScanStatus): number {
  return status && (status.running || status.processing > 0 || status.pending > 0) ? 2_500 : 15_000;
}

export function requestScanJobsPollInterval(tab: RequestScanTab, status?: RequestScanStatus): number | false {
  const workExists = Boolean(status && (status.running || status.processing > 0 || status.pending > 0));
  if (tab === "active") return workExists ? 2_500 : 15_000;
  return workExists ? 15_000 : false;
}

function isPdf(job: Job): boolean {
  return job.filename.toLowerCase().endsWith(".pdf");
}

async function responseMessage(response: Response, fallback: string): Promise<string> {
  const body = await response.json().catch(() => null) as { error?: { message?: unknown } | string; message?: unknown } | null;
  if (body && typeof body.error === "object" && body.error !== null && typeof body.error.message === "string") return body.error.message;
  if (body && typeof body.error === "string") return body.error;
  if (body && typeof body.message === "string") return body.message;
  return fallback;
}

async function request<T>(url: string, options?: RequestInit): Promise<T> {
  const response = await fetch(`/api/request-scans${url}`, {
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    ...options,
  });
  if (!response.ok) throw new Error(await responseMessage(response, "Request Scan action failed"));
  return response.json() as Promise<T>;
}

function JobStatus({ status }: Pick<Job, "status">) {
  if (status === "pending") {
    return <div><span className="inline-flex rounded-full bg-blue-100 px-2 py-1 text-xs font-medium text-blue-800">Queued</span><p className="mt-1 text-xs text-muted-foreground">Waiting for worker</p></div>;
  }
  if (status === "processing") {
    return <span className="inline-flex items-center gap-2 rounded-full bg-teal-100 px-2 py-1 text-xs font-medium text-teal-800"><span className="h-3 w-3 animate-spin rounded-full border-2 border-teal-700 border-t-transparent" aria-hidden="true" />Processing</span>;
  }
  if (status === "processed") return <span className="inline-flex rounded-full bg-green-100 px-2 py-1 text-xs font-medium text-green-800">Processed</span>;
  if (status === "duplicate") return <span className="inline-flex rounded-full bg-amber-100 px-2 py-1 text-xs font-medium text-amber-800">Duplicate</span>;
  return <span className="inline-flex rounded-full bg-red-100 px-2 py-1 text-xs font-medium text-red-800">Failed</span>;
}
const stageLabels: Record<string, string> = { queued: "Waiting for worker", downloading: "Downloading", checking_filename: "Checking filename", rendering_300_dpi: "Rendering at 300 DPI", scanning_original_300_dpi: "Scanning original pages at 300 DPI", scanning_enhanced_300_dpi: "Scanning enhanced pages at 300 DPI", rendering_600_dpi: "Rendering at 600 DPI", scanning_original_600_dpi: "Scanning original pages at 600 DPI", scanning_enhanced_600_dpi: "Scanning enhanced pages at 600 DPI", verifying_identifier: "Verifying appointment", resolving_appointment: "Resolving appointment", checking_duplicate: "Checking duplicate", attaching_document: "Attaching document", moving_file: "Moving file" };
function ProcessingDetails({ job }: { job: Job }) { if (job.status !== "processing" || (!job.processing_stage && job.progress_current == null && !job.processing_started_at && !job.lease_expires_at)) return null; const expires = job.lease_expires_at ? new Date(job.lease_expires_at).getTime() : 0; const delayed = expires && expires < Date.now(); const elapsed = job.processing_started_at ? Math.max(0, Math.floor((Date.now() - new Date(job.processing_started_at).getTime()) / 1000)) : null; return <div className="mt-1 text-xs text-muted-foreground">{job.processing_stage && <p>{stageLabels[job.processing_stage] ?? "Processing"}</p>}{job.progress_current != null && job.progress_total != null && <p>{job.progress_current} of {job.progress_total} pages examined</p>}{elapsed != null && <p>Elapsed {elapsed} seconds</p>}{delayed && <p className="text-amber-700">Worker lease expired — recovery pending.</p>}</div>; }

export default function RequestScansPage() {
  const [tab, setTab] = useState<RequestScanTab>("active");
  const [preview, setPreview] = useState<Job | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [assign, setAssign] = useState<Job | null>(null);
  const [query, setQuery] = useState("");
  const [appointmentId, setAppointmentId] = useState("");
  const [notice, setNotice] = useState<string | null>(null);
  const [highlightedJobId, setHighlightedJobId] = useState<number | null>(null);
  const objectUrl = useRef<string | null>(null);
  const previewRequest = useRef(0);
  const navigate = useNavigate();
  const client = useQueryClient();

  const revokePreview = () => {
    if (objectUrl.current) URL.revokeObjectURL(objectUrl.current);
    objectUrl.current = null;
    setPreviewUrl(null);
  };

  useEffect(() => () => {
    previewRequest.current += 1;
    if (objectUrl.current) URL.revokeObjectURL(objectUrl.current);
  }, []);

  const status = useQuery({
    queryKey: ["request-scans-status"],
    queryFn: () => request<RequestScanStatus>("/status"),
    refetchInterval: (query) => requestScanStatusPollInterval(query.state.data),
    refetchIntervalInBackground: false,
  });
  const statusData = status.data;
  const jobs = useQuery({
    queryKey: ["request-scans", tab],
    queryFn: () => request<{ jobs: Job[] }>(`?status=${tab}`),
    refetchInterval: () => requestScanJobsPollInterval(tab, statusData),
    refetchIntervalInBackground: false,
    refetchOnWindowFocus: true,
  });
  const appointments = useQuery({
    queryKey: ["request-scan-appointments", query],
    queryFn: () => request<{ appointments: Appointment[] }>(`/eligible-appointments?q=${encodeURIComponent(query)}`),
    enabled: Boolean(assign),
  });

  const refreshRequestScans = () => {
    void client.invalidateQueries({ queryKey: ["request-scans"] });
    void client.invalidateQueries({ queryKey: ["request-scans-status"] });
  };
  const action = useMutation({
    mutationFn: ({ url, body }: { url: string; body?: unknown }) => request(url, { method: "POST", body: body ? JSON.stringify(body) : undefined }),
    onSuccess: refreshRequestScans,
  });
  const retry = useMutation({
    mutationFn: (jobId: number) => request<{ job: Job; trigger: WorkerTrigger }>(`/${jobId}/retry`, { method: "POST" }),
    onSuccess: ({ job }) => {
      setTab("active");
      setHighlightedJobId(job.id);
      setNotice("Retry queued. The worker will process this file.");
      void client.invalidateQueries({ queryKey: ["request-scans", "active"] });
      void client.invalidateQueries({ queryKey: ["request-scans", "failed"] });
      void client.invalidateQueries({ queryKey: ["request-scans-status"] });
    },
  });
  const runNow = useMutation({
    mutationFn: () => request<{ ok: true; trigger: WorkerTrigger }>("/run-now", { method: "POST" }),
    onSuccess: ({ trigger }) => {
      setNotice(trigger.status === "accepted"
        ? "Request Scan worker start requested."
        : trigger.status === "already_running"
          ? "Request Scan worker is already processing."
          : "Request Scan worker is disabled.");
      void client.invalidateQueries({ queryKey: ["request-scans", "active"] });
      void client.invalidateQueries({ queryKey: ["request-scans-status"] });
    },
  });

  const cards = status.isLoading
    ? [["Worker", "Loading..."], ["Processing", "—"], ["Queued", "—"], ["Processed today", "—"], ["Failed", "—"], ["Last worker run", "Loading..."]]
    : status.isError || !statusData
      ? [["Worker", "Unavailable"], ["Processing", "—"], ["Queued", "—"], ["Processed today", "—"], ["Failed", "—"], ["Last worker run", "Unavailable"]]
      : [["Worker", !statusData.enabled ? "Disabled" : statusData.running ? "Processing" : "Idle"], ["Processing", String(statusData.processing)], ["Queued", String(statusData.pending)], ["Processed today", String(statusData.processedToday)], ["Failed", String(statusData.failed)], ["Last worker run", statusData.lastRunAt ? new Date(statusData.lastRunAt).toLocaleString() : "Not run"]];
  const tabs: Array<{ value: RequestScanTab; label: string }> = [
    { value: "active", label: `Active${statusData ? ` (${statusData.pending + statusData.processing})` : ""}` },
    { value: "processed", label: "Processed" },
    { value: "duplicate", label: "Duplicates" },
    { value: "failed", label: `Failed${statusData ? ` (${statusData.failed})` : ""}` },
    { value: "all", label: "All" },
  ];

  const closePreview = () => {
    previewRequest.current += 1;
    revokePreview();
    setPreviewLoading(false);
    setPreviewError(null);
    setPreview(null);
  };

  const openPreview = async (job: Job) => {
    previewRequest.current += 1;
    const requestId = previewRequest.current;
    revokePreview();
    setPreview(job);
    setPreviewLoading(true);
    setPreviewError(null);
    try {
      const response = await fetch(`/api/request-scans/${job.id}/file`, { credentials: "include" });
      if (!response.ok) throw new Error(await responseMessage(response, "Preview could not be loaded."));
      const url = URL.createObjectURL(await response.blob());
      if (requestId !== previewRequest.current) {
        URL.revokeObjectURL(url);
        return;
      }
      objectUrl.current = url;
      setPreviewUrl(url);
    } catch (error) {
      if (requestId === previewRequest.current) setPreviewError(error instanceof Error ? error.message : "Preview could not be loaded.");
    } finally {
      if (requestId === previewRequest.current) setPreviewLoading(false);
    }
  };

  const workerRunning = Boolean(statusData?.enabled && statusData.running);
  const visibleJobs = jobs.data?.jobs ?? [];
  const emptyMessage = tab === "active"
    ? "No active request scans. New scans and retries will appear here automatically."
    : "No request scans found for this view.";

  return <main className="space-y-4 p-4">
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div><h1 className="text-2xl font-semibold">Request Scans</h1><p className="text-sm text-muted-foreground">Automated appointment-request scan monitoring and exception recovery.</p></div>
      <button className="btn-primary" onClick={() => runNow.mutate()} disabled={runNow.isPending || workerRunning}>
        {runNow.isPending ? "Starting..." : workerRunning ? "Processing" : "Scan folder now"}
      </button>
    </div>
    {notice && <p role="status" className="rounded-md border border-teal-200 bg-teal-50 px-3 py-2 text-sm text-teal-800">{notice}</p>}
    {runNow.isError && <p className="text-sm text-red-700">{runNow.error.message}</p>}
    {retry.isError && <p className="text-sm text-red-700">{retry.error.message}</p>}
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-6">{cards.map(([label, value]) => <section key={label} className="rounded-lg border p-3"><p className="text-xs text-muted-foreground">{label}</p><p className="mt-1 text-lg font-semibold">{value}</p></section>)}</div>
    {status.isError && <p className="text-sm text-red-700">Request Scan status could not be loaded: {status.error.message}</p>}
    {!status.isLoading && !status.isError && statusData?.lastError && <p className="text-sm text-amber-700">Latest worker error: {statusData.lastError}</p>}
    <div className="flex flex-wrap gap-2 border-b">{tabs.map(({ value, label }) => <button key={value} className={`px-3 py-2 text-sm font-medium ${tab === value ? "border-b-2 border-teal-600" : ""}`} onClick={() => setTab(value)}>{label}</button>)}</div>
    {jobs.isLoading
      ? <p>Loading request scans...</p>
      : jobs.isError
        ? <p className="text-red-700">{jobs.error.message}</p>
        : visibleJobs.length === 0
          ? <div className="rounded-lg border border-dashed p-6 text-sm text-muted-foreground">{emptyMessage}</div>
          : <div className="overflow-x-auto rounded-lg border">
            <table className="w-full text-left text-sm">
              <thead><tr className="border-b"><th className="p-2">Time</th><th>Filename</th><th>Barcode/accession</th><th>Patient</th><th>Modality/examination</th><th>Status</th><th>Attempts</th><th>Error</th><th className="p-2">Actions</th></tr></thead>
              <tbody>{visibleJobs.map((job) => {
                const queuing = retry.isPending && retry.variables === job.id;
                return <tr key={job.id} className={`border-b ${highlightedJobId === job.id ? "bg-teal-50" : ""}`}>
                  <td className="p-2">{new Date(job.created_at).toLocaleString()}</td>
                  <td>{job.filename}</td>
                  <td>{job.barcode_value ?? "-"}</td>
                  <td>{job.patient_name ?? "-"}</td>
                  <td>{[job.modality_name, job.exam_name].filter(Boolean).join(" · ") || "-"}</td>
                  <td><JobStatus status={job.status} /><ProcessingDetails job={job} /></td>
                  <td>{job.attempt_count}</td>
                  <td className="max-w-52 text-red-700">{job.error_message ?? "-"}</td>
                  <td className="flex flex-wrap gap-1 p-2">
                    <button className="btn-secondary text-xs" onClick={() => void openPreview(job)}>Preview</button>
                    {job.appointment_id && <button className="btn-secondary text-xs" onClick={() => navigate(`/registrations?appointmentId=${job.appointment_id}`)}>Open appointment</button>}
                    {job.document_id && <a className="btn-secondary text-xs" href={`/api/documents/${job.document_id}/view`} target="_blank" rel="noreferrer">Open document</a>}
                    {job.status === "failed" && <>
                      <button className="btn-secondary text-xs" disabled={queuing} onClick={() => retry.mutate(job.id)}>{queuing ? "Queuing..." : "Retry"}</button>
                      <button className="btn-secondary text-xs" onClick={() => action.mutate({ url: `/${job.id}/return-to-incoming` })}>Return</button>
                      <button className="btn-secondary text-xs" onClick={() => { setAssign(job); setAppointmentId(""); }}>Manually assign</button>
                    </>}
                  </td>
                </tr>;
              })}</tbody>
            </table>
          </div>}
    {preview && <div className="fixed inset-0 z-50 bg-black/40 p-6" onClick={closePreview}><section className="mx-auto h-full max-w-5xl rounded-lg bg-background p-4" onClick={(event) => event.stopPropagation()}><div className="mb-3 flex justify-between"><h2 className="font-semibold">{preview.filename}</h2><button className="btn-secondary" onClick={closePreview}>Close</button></div>{previewLoading ? <p>Loading preview...</p> : previewError ? <p className="text-red-700">Preview could not be loaded: {previewError}</p> : previewUrl && (isPdf(preview) ? <iframe className="h-[85%] w-full" src={previewUrl} title="Request scan preview" /> : <img className="max-h-[85%] max-w-full object-contain" src={previewUrl} alt={preview.filename} />)}</section></div>}
    {assign && <div className="fixed inset-0 z-50 bg-black/40 p-6" onClick={() => setAssign(null)}><section className="mx-auto max-w-xl rounded-lg bg-background p-4" onClick={(event) => event.stopPropagation()}><h2 className="text-lg font-semibold">Manually assign request scan</h2><p className="mt-1 text-sm text-muted-foreground">{assign.filename}</p><input className="input-premium mt-3 w-full" placeholder="Search accession or patient" value={query} onChange={(event) => setQuery(event.target.value)} /><select className="input-premium mt-3 w-full" value={appointmentId} onChange={(event) => setAppointmentId(event.target.value)}><option value="">Select an eligible V2 appointment</option>{appointments.data?.appointments.map((appointment) => <option key={appointment.id} value={appointment.id}>{appointment.accession_number} · {appointment.patient_name ?? "Patient"}</option>)}</select><div className="mt-4 flex gap-2"><button className="btn-primary" disabled={!appointmentId || action.isPending} onClick={() => action.mutate({ url: `/${assign.id}/manual-assign`, body: { appointmentId: Number(appointmentId) } }, { onSuccess: () => setAssign(null) })}>Attach and process</button><button className="btn-secondary" onClick={() => setAssign(null)}>Cancel</button></div></section></div>}
  </main>;
}
