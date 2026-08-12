import { useMemo, useState } from "react";
import type { ReactNode } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { RefreshCw, RotateCcw, Settings, Wrench } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { ApiError, api } from "@/lib/api-client";
import { useAuth } from "@/providers/auth-provider";
import { SupervisorReAuthModal } from "@/components/auth/supervisor-reauth-modal";
import { useLanguage } from "@/providers/language-provider";

type MonitorTab = "orthanc" | "sante";
type MonitorStatus = "all" | "failed" | "pending" | "synced" | "waiting_for_protocol" | "waiting_for_queue";

type CountRow = { status: string; count: number };
type ModalityOption = { id: number; code?: string | null; nameEn?: string | null; nameAr?: string | null; name_en?: string | null; name_ar?: string | null };

type WorklistEntry = {
  bookingId: number;
  accessionNumber: string;
  patientId: string;
  patientName: string;
  modality: string;
  modalityName: string;
  procedure: string;
  bookingDate: string;
  bookingTime: string | null;
  queueStatus: string;
  orthanc: {
    status: string;
    outboxStatus: string | null;
    outboxId: number | null;
    operation: string | null;
    lastAttemptAt: string | null;
    lastError: string | null;
    history: unknown;
    preview: unknown;
    previewError: string | null;
  };
  sante: {
    status: string;
    outboxStatus: string | null;
    outboxId: number | null;
    lastAttemptAt: string | null;
    lastError: string | null;
    history: unknown;
    preview: string | null;
    previewError: string | null;
  };
};

type EntriesResponse = {
  ok: boolean;
  settings: {
    orthanc: {
      enabled: boolean;
      shadowMode: boolean;
      sendOnlyWhenPatientEntersQueue: boolean;
      worklistTarget: string;
      compatibility: Record<string, unknown>;
    };
    sante: {
      enabled: boolean;
      mode: string;
      deliveryMethod: string;
      sendOnlyWhenPatientEntersQueue: boolean;
      expectAck: boolean;
      compatibility: Record<string, unknown>;
    };
  };
  entries: WorklistEntry[];
};

type OrthancSummaryResponse = {
  ok: boolean;
  summary: {
    syncStatus: CountRow[];
    outboxStatus: CountRow[];
    orthancProbe?: { ok: boolean; baseUrl: string; orthancVersion: string | null; worklistsRouteReachable: boolean; error: string | null } | null;
  };
};

type SanteSummaryResponse = {
  ok: boolean;
  summary: {
    outboxStatus: CountRow[];
    settings: { enabled: boolean; mode: string; deliveryMethod: string; sendOnlyWhenPatientEntersQueue: boolean; mllp: { expectAck: boolean } };
  };
};

function isoDateDaysFromNow(offsetDays: number): string {
  const date = new Date();
  date.setDate(date.getDate() + offsetDays);
  return date.toISOString().slice(0, 10);
}

function countLabel(items: CountRow[] | undefined): string {
  if (!items?.length) return "none";
  return items.map((item) => `${item.status}: ${item.count}`).join(" / ");
}

function formatJson(value: unknown): string {
  if (value == null) return "";
  if (typeof value === "string") return value;
  return JSON.stringify(value, null, 2);
}

function isSupervisorReauthError(error: unknown): boolean {
  if (!error) return false;
  const status = error instanceof ApiError ? error.status : undefined;
  const messageText = error instanceof Error ? error.message : String(error);
  const normalized = messageText.toLowerCase();
  return status === 403 && (normalized.includes("reauth") || normalized.includes("re-auth"));
}

export default function WorklistMonitorPage() {
  const { t } = useLanguage();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const isSuperAdmin = user?.role === "super_admin";
  const [tab, setTab] = useState<MonitorTab>("orthanc");
  const [dateFrom, setDateFrom] = useState(() => isoDateDaysFromNow(0));
  const [dateTo, setDateTo] = useState(() => isoDateDaysFromNow(0));
  const [modalityId, setModalityId] = useState("");
  const [status, setStatus] = useState<MonitorStatus>("all");
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<WorklistEntry | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [showReauth, setShowReauth] = useState(false);

  const params = useMemo(() => {
    const next = new URLSearchParams({ dateFrom, dateTo, status, limit: "200" });
    if (modalityId) next.set("modalityId", modalityId);
    if (search.trim()) next.set("q", search.trim());
    return next.toString();
  }, [dateFrom, dateTo, modalityId, search, status]);

  const entriesQuery = useQuery({
    queryKey: ["dicom", "worklist-monitor", params],
    queryFn: () => api<EntriesResponse>(`/dicom/worklist-monitor/entries?${params}`),
  });
  const orthancSummary = useQuery({
    queryKey: ["dicom", "orthanc-sync", "summary"],
    queryFn: () => api<OrthancSummaryResponse>("/dicom/orthanc-sync/summary"),
  });
  const santeSummary = useQuery({
    queryKey: ["dicom", "sante-hl7", "summary"],
    queryFn: () => api<SanteSummaryResponse>("/dicom/sante-hl7/summary"),
  });
  const modalityOptions = useQuery({
    queryKey: ["v2-lookups", "modalities"],
    queryFn: async () => {
      const result = await api<{ items: ModalityOption[] }>("/v2/lookups/modalities");
      return result.items || [];
    },
    staleTime: 5 * 60 * 1000,
  });

  const invalidateMonitor = async () => {
    await queryClient.invalidateQueries({ queryKey: ["dicom"] });
  };

  const orthancRetry = useMutation({
    mutationFn: (bookingId: number) => api(`/dicom/orthanc-sync/retry/${bookingId}`, { method: "POST" }),
    onSuccess: async () => {
      setMessage("Orthanc retry queued.");
      await invalidateMonitor();
    },
  });

  const santeRetry = useMutation({
    mutationFn: (outboxId: number) => api(`/dicom/sante-hl7/retry/${outboxId}`, { method: "POST" }),
    onSuccess: async () => {
      setMessage("Sante retry queued.");
      await invalidateMonitor();
    },
  });

  const reconcile = useMutation({
    mutationFn: (apply: boolean) => api(tab === "orthanc" ? "/dicom/orthanc-sync/reconcile" : "/dicom/sante-hl7/reconcile", {
      method: "POST",
      body: JSON.stringify({ dateFrom, dateTo, apply, limit: 5000 }),
    }),
    onSuccess: async (_result, apply) => {
      setMessage(apply ? "Reconcile applied." : "Dry-run reconcile completed.");
      await invalidateMonitor();
    },
  });

  const reset = useMutation({
    mutationFn: () => api(tab === "orthanc" ? "/dicom/orthanc-sync/reset-window" : "/dicom/sante-hl7/force-resync", {
      method: "POST",
      body: JSON.stringify({ dateFrom, dateTo, limit: 5000 }),
    }),
    onSuccess: async () => {
      setMessage(tab === "orthanc" ? "Orthanc window reset queued." : "Sante force resync queued.");
      await invalidateMonitor();
    },
  });

  const entries = entriesQuery.data?.entries || [];
  const authError = [entriesQuery.error, orthancSummary.error, santeSummary.error].find(isSupervisorReauthError) as Error | undefined;
  const selectedPreview = selected
    ? tab === "orthanc"
      ? selected.orthanc.preview
      : selected.sante.preview
    : null;
  const selectedPreviewError = selected
    ? tab === "orthanc"
      ? selected.orthanc.previewError
      : selected.sante.previewError
    : null;
  const selectedHistory = selected
    ? tab === "orthanc"
      ? selected.orthanc.history
      : selected.sante.history
    : null;

  return (
    <div className="space-y-5">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-stone-900 dark:text-white">MWL Monitor</h1>
          <p className="text-sm text-stone-500 dark:text-stone-400">Operational view for Orthanc DICOM MWL and Sante HL7 worklist delivery.</p>
        </div>
        <button type="button" className="btn-secondary inline-flex items-center gap-2 text-sm" onClick={() => navigate("/settings")}>
          <Settings size={16} /> Settings
        </button>
      </div>

      {message && <div className="rounded border border-blue-200 bg-blue-50 px-3 py-2 text-sm text-blue-800">{message}</div>}
      {authError ? (
        <div className="rounded border border-amber-200 bg-amber-50 px-3 py-3 text-sm text-amber-900">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="font-semibold">Supervisor re-authentication required</p>
              <p className="text-xs text-amber-700">Re-enter your supervisor password to load MWL status and controls.</p>
            </div>
            <button type="button" className="btn-secondary text-xs" onClick={() => setShowReauth(true)}>Re-authenticate</button>
          </div>
        </div>
      ) : (entriesQuery.error || orthancSummary.error || santeSummary.error) && (
        <div className="rounded border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
          {(entriesQuery.error as Error | undefined)?.message || (orthancSummary.error as Error | undefined)?.message || (santeSummary.error as Error | undefined)?.message}
        </div>
      )}
      {showReauth && (
        <SupervisorReAuthModal
          onClose={() => setShowReauth(false)}
          onSuccess={() => {
            setShowReauth(false);
            void invalidateMonitor();
          }}
        />
      )}

      <div className="grid grid-cols-1 gap-3 xl:grid-cols-4">
        <StatusCard title="Orthanc mode" lines={[
          entriesQuery.data?.settings.orthanc.enabled ? "Enabled" : "Disabled",
          entriesQuery.data?.settings.orthanc.sendOnlyWhenPatientEntersQueue ? "Waits for queue" : "Inserts when scheduled",
          entriesQuery.data?.settings.orthanc.shadowMode ? "Shadow mode" : "Primary mode",
        ]} />
        <StatusCard title="Orthanc health" lines={[
          orthancSummary.data?.summary.orthancProbe?.ok ? "Probe reachable" : "Probe not reachable",
          orthancSummary.data?.summary.orthancProbe?.worklistsRouteReachable ? "Worklists route reachable" : "Worklists route unavailable",
          orthancSummary.data?.summary.orthancProbe?.orthancVersion || "Version unknown",
        ]} />
        <StatusCard title="Orthanc status" lines={[countLabel(orthancSummary.data?.summary.syncStatus), countLabel(orthancSummary.data?.summary.outboxStatus)]} />
        <StatusCard title="Sante status" lines={[
          entriesQuery.data?.settings.sante.enabled ? "Enabled" : "Disabled",
          `${entriesQuery.data?.settings.sante.deliveryMethod || "delivery"} / ${entriesQuery.data?.settings.sante.expectAck ? "ACK" : "no ACK"}`,
          countLabel(santeSummary.data?.summary.outboxStatus),
        ]} />
      </div>

      <div className="flex flex-wrap gap-2 border-b border-stone-200 dark:border-stone-700">
        <TabButton active={tab === "orthanc"} onClick={() => setTab("orthanc")}>Orthanc DICOM MWL</TabButton>
        <TabButton active={tab === "sante"} onClick={() => setTab("sante")}>Sante HL7 Worklist</TabButton>
      </div>

      <div className="grid grid-cols-1 gap-3 md:grid-cols-5">
        <Field label="Date from" value={dateFrom} onChange={setDateFrom} type="date" />
        <Field label="Date to" value={dateTo} onChange={setDateTo} type="date" />
        <label className="space-y-1 text-sm">
          <span className="text-stone-600 dark:text-stone-300">Modality</span>
          <select value={modalityId} onChange={(event) => setModalityId(event.target.value)} className="w-full rounded border border-stone-300 bg-white px-2 py-2 dark:border-stone-600 dark:bg-stone-900">
            <option value="">All modalities</option>
            {(modalityOptions.data || []).map((modality) => (
              <option key={modality.id} value={String(modality.id)}>
                {modality.code ? `${modality.code} - ` : ""}{modality.nameEn || modality.name_en || modality.nameAr || modality.name_ar || `Modality #${modality.id}`}
              </option>
            ))}
          </select>
        </label>
        <label className="space-y-1 text-sm">
          <span className="text-stone-600 dark:text-stone-300">Status</span>
          <select value={status} onChange={(event) => setStatus(event.target.value as MonitorStatus)} className="w-full rounded border border-stone-300 bg-white px-2 py-2 dark:border-stone-600 dark:bg-stone-900">
            <option value="all">All</option>
            <option value="failed">Failed</option>
            <option value="pending">Pending</option>
            <option value="synced">Synced</option>
            <option value="waiting_for_protocol">{t("worklistMonitor.waitingForProtocol")}</option>
            <option value="waiting_for_queue">Waiting for queue</option>
          </select>
        </label>
        <Field label="Search" value={search} onChange={setSearch} placeholder="Accession, ID, name" />
      </div>

      <div className="flex flex-wrap gap-2">
        <button type="button" className="btn-secondary inline-flex items-center gap-2 text-sm" onClick={() => void entriesQuery.refetch()}>
          <RefreshCw size={16} /> Refresh
        </button>
        <button type="button" className="btn-secondary inline-flex items-center gap-2 text-sm" disabled={reconcile.isPending} onClick={() => reconcile.mutate(false)}>
          <Wrench size={16} /> Reconcile dry-run
        </button>
        {isSuperAdmin && (
          <>
            <button type="button" className="btn-primary inline-flex items-center gap-2 text-sm" disabled={reconcile.isPending} onClick={() => {
              if (window.confirm("Apply reconcile for this date range?")) reconcile.mutate(true);
            }}>
              <Wrench size={16} /> Apply reconcile
            </button>
            <button type="button" className="btn-secondary inline-flex items-center gap-2 text-sm" disabled={reset.isPending} onClick={() => {
              if (window.confirm("Reset/requeue this date range?")) reset.mutate();
            }}>
              <RotateCcw size={16} /> Reset / requeue
            </button>
          </>
        )}
      </div>

      <div className="overflow-x-auto rounded border border-stone-200 dark:border-stone-700">
        <table className="w-full text-sm">
          <thead className="bg-stone-50 text-stone-600 dark:bg-stone-800 dark:text-stone-300">
            <tr>
              <th className="px-3 py-2 text-left">Booking</th>
              <th className="px-3 py-2 text-left">Patient</th>
              <th className="px-3 py-2 text-left">Modality</th>
              <th className="px-3 py-2 text-left">Procedure</th>
              <th className="px-3 py-2 text-left">Date/time</th>
              <th className="px-3 py-2 text-left">Queue</th>
              <th className="px-3 py-2 text-left">Orthanc</th>
              <th className="px-3 py-2 text-left">Sante</th>
              <th className="px-3 py-2 text-left">Action</th>
            </tr>
          </thead>
          <tbody>
            {entries.map((entry) => (
              <tr key={entry.bookingId} className="border-t border-stone-200 dark:border-stone-700">
                <td className="px-3 py-2"><button className="font-semibold text-blue-700" onClick={() => setSelected(entry)}>{entry.accessionNumber}</button><div className="text-xs text-stone-500">#{entry.bookingId}</div></td>
                <td className="px-3 py-2">{entry.patientName}<div className="text-xs text-stone-500">{entry.patientId}</div></td>
                <td className="px-3 py-2">{entry.modality}<div className="text-xs text-stone-500">{entry.modalityName}</div></td>
                <td className="px-3 py-2">{entry.procedure || "-"}</td>
                <td className="px-3 py-2">{entry.bookingDate}<div className="text-xs text-stone-500">{entry.bookingTime || "-"}</div></td>
                <td className="px-3 py-2">{entry.queueStatus}</td>
                <td className="px-3 py-2">{entry.orthanc.status === "waiting_for_protocol" ? t("worklistMonitor.waitingForProtocol") : entry.orthanc.status}<div className="text-xs text-stone-500">{entry.orthanc.lastAttemptAt || ""}</div>{entry.orthanc.lastError && <div className="max-w-xs truncate text-xs text-red-600">{entry.orthanc.lastError}</div>}</td>
                <td className="px-3 py-2">{entry.sante.status === "waiting_for_protocol" ? t("worklistMonitor.waitingForProtocol") : entry.sante.status}<div className="text-xs text-stone-500">{entry.sante.lastAttemptAt || ""}</div>{entry.sante.lastError && <div className="max-w-xs truncate text-xs text-red-600">{entry.sante.lastError}</div>}</td>
                <td className="px-3 py-2">
                  {tab === "orthanc" ? (
                    <button className="btn-secondary text-xs" disabled={orthancRetry.isPending} onClick={() => orthancRetry.mutate(entry.bookingId)}>Retry Orthanc</button>
                  ) : entry.sante.outboxId ? (
                    <button className="btn-secondary text-xs" disabled={santeRetry.isPending} onClick={() => santeRetry.mutate(entry.sante.outboxId as number)}>Retry Sante</button>
                  ) : (
                    <span className="text-xs text-stone-500">No outbox</span>
                  )}
                </td>
              </tr>
            ))}
            {!entries.length && (
              <tr><td colSpan={9} className="px-3 py-8 text-center text-stone-500">No worklist entries match these filters.</td></tr>
            )}
          </tbody>
        </table>
      </div>

      {selected && (
        <div className="fixed inset-y-0 right-0 z-40 w-full max-w-2xl overflow-y-auto border-l border-stone-200 bg-white p-5 shadow-xl dark:border-stone-700 dark:bg-stone-950">
          <div className="mb-4 flex items-start justify-between gap-3">
            <div>
              <h2 className="text-lg font-semibold">{selected.accessionNumber}</h2>
              <p className="text-sm text-stone-500">{selected.patientName} / {selected.modality} / {selected.procedure || "-"}</p>
            </div>
            <button className="btn-secondary text-sm" onClick={() => setSelected(null)}>Close</button>
          </div>
          <div className="grid grid-cols-2 gap-3 text-sm">
            <Info label="Orthanc status" value={selected.orthanc.status === "waiting_for_protocol" ? t("worklistMonitor.waitingForProtocol") : selected.orthanc.status} />
            <Info label="Sante status" value={selected.sante.status === "waiting_for_protocol" ? t("worklistMonitor.waitingForProtocol") : selected.sante.status} />
            <Info label="Orthanc source settings" value={formatJson(entriesQuery.data?.settings.orthanc.compatibility)} />
            <Info label="Sante source settings" value={formatJson(entriesQuery.data?.settings.sante.compatibility)} />
            <Info label="Recent retry history" value={formatJson(selectedHistory)} />
          </div>
          <div className="mt-4 space-y-2">
            <h3 className="font-semibold">{tab === "orthanc" ? "Orthanc DICOM JSON Preview" : "Sante HL7 Preview"}</h3>
            {selectedPreviewError ? (
              <div className="rounded border border-red-200 bg-red-50 p-3 text-sm text-red-800">{selectedPreviewError}</div>
            ) : (
              <pre className="max-h-[60vh] overflow-auto rounded border border-stone-200 bg-stone-50 p-3 text-xs text-stone-800 dark:border-stone-700 dark:bg-stone-900 dark:text-stone-100">{formatJson(selectedPreview)}</pre>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function StatusCard({ title, lines }: { title: string; lines: string[] }) {
  return (
    <div className="rounded border border-stone-200 bg-white p-3 text-sm dark:border-stone-700 dark:bg-stone-900">
      <h3 className="mb-2 font-semibold text-stone-900 dark:text-white">{title}</h3>
      {lines.map((line, index) => <p key={`${title}-${index}`} className="text-stone-600 dark:text-stone-300">{line || "-"}</p>)}
    </div>
  );
}

function TabButton({ active, children, onClick }: { active: boolean; children: ReactNode; onClick: () => void }) {
  return <button type="button" className={`px-3 py-2 text-sm font-medium ${active ? "border-b-2 border-blue-600 text-blue-700" : "text-stone-500"}`} onClick={onClick}>{children}</button>;
}

function Field({ label, value, onChange, type = "text", placeholder }: { label: string; value: string; onChange: (value: string) => void; type?: string; placeholder?: string }) {
  return (
    <label className="space-y-1 text-sm">
      <span className="text-stone-600 dark:text-stone-300">{label}</span>
      <input type={type} value={value} placeholder={placeholder} onChange={(event) => onChange(event.target.value)} className="w-full rounded border border-stone-300 bg-white px-2 py-2 dark:border-stone-600 dark:bg-stone-900" />
    </label>
  );
}

function Info({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded border border-stone-200 bg-stone-50 p-2 dark:border-stone-700 dark:bg-stone-900">
      <div className="text-xs font-semibold text-stone-500">{label}</div>
      <pre className="whitespace-pre-wrap break-words text-xs text-stone-800 dark:text-stone-100">{value || "-"}</pre>
    </div>
  );
}
