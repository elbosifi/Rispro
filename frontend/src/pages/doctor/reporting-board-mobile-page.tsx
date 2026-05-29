import { useMemo, useState, type ReactNode } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useParams } from "react-router-dom";
import { Bell, Calendar, Clipboard, FileText, Flame, RefreshCw, Search, SlidersHorizontal, User, UserCheck, Users } from "lucide-react";
import {
  assignReportingBoardMobileCaseToMe,
  fetchReportingBoardMobilePushConfig,
  fetchReportingBoardMobileView,
  fetchRosterDoctors,
  reassignReportingBoardMobileCase,
  subscribeReportingBoardMobilePush,
} from "@/lib/api-hooks";
import type { ReportingBoardFilters, ReportingBoardMobileCase } from "@/types/api";

function labelStatus(value: string | null | undefined): string {
  return String(value || "-").replaceAll("_", " ");
}

function chipClass(tone: "teal" | "blue" | "purple" | "orange" | "red" | "slate") {
  const tones = {
    teal: "bg-teal-50 text-teal-700 ring-teal-100",
    blue: "bg-blue-50 text-blue-700 ring-blue-100",
    purple: "bg-violet-50 text-violet-700 ring-violet-100",
    orange: "bg-orange-50 text-orange-700 ring-orange-100",
    red: "bg-red-50 text-red-700 ring-red-100",
    slate: "bg-slate-100 text-slate-600 ring-slate-200",
  };
  return `inline-flex items-center rounded-full px-2.5 py-1 text-xs font-semibold ring-1 ${tones[tone]}`;
}

function priorityTone(code: string | null): "red" | "orange" | "slate" {
  const normalized = String(code || "").toLowerCase();
  if (normalized === "stat" || normalized === "urgent") return normalized === "stat" ? "red" : "orange";
  return "slate";
}

function dateTime(row: ReportingBoardMobileCase): string {
  return row.time ? `${row.date} ${row.time}` : row.date;
}

function urlBase64ToUint8Array(value: string): ArrayBuffer {
  const padding = "=".repeat((4 - (value.length % 4)) % 4);
  const base64 = `${value}${padding}`.replace(/-/g, "+").replace(/_/g, "/");
  const raw = window.atob(base64);
  const output = new Uint8Array(raw.length);
  for (let index = 0; index < raw.length; index += 1) output[index] = raw.charCodeAt(index);
  return output.buffer;
}

function pushSupported(): boolean {
  return typeof window !== "undefined" && "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;
}

function Counter({ icon, label, value }: { icon: ReactNode; label: string; value: number | null }) {
  return (
    <div className="min-w-[104px] rounded-2xl border border-slate-200 bg-white p-3 text-center shadow-sm">
      <div className="mx-auto flex h-9 w-9 items-center justify-center rounded-full bg-teal-50 text-teal-700">{icon}</div>
      <p className="mt-2 text-xs font-medium text-slate-500">{label}</p>
      <p className="mt-1 text-2xl font-bold text-slate-950">{value ?? "-"}</p>
    </div>
  );
}

function CaseCard({ row, onOpen }: { row: ReportingBoardMobileCase; onOpen: () => void }) {
  return (
    <button type="button" onClick={onOpen} className="w-full rounded-2xl border border-slate-200 bg-white p-4 text-left shadow-sm">
      <div className="flex items-start gap-3">
        <div className="mt-1 flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-teal-600 text-white">
          <User size={22} />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-2">
            <h2 className="text-lg font-bold leading-tight text-slate-950">{row.patientName}</h2>
            <span className={chipClass(priorityTone(row.priorityCode))}>{row.priority || "Normal"}</span>
          </div>
          <p className="mt-1 text-sm text-slate-500">MRN {row.mrn ?? "-"} · Accession {row.accessionNumber}</p>
          <div className="mt-3 flex flex-wrap gap-2">
            <span className={chipClass("blue")}>{row.modality}</span>
            {row.exam && <span className={chipClass("purple")}>{row.exam}</span>}
            <span className={chipClass("teal")}>{row.category}</span>
          </div>
        </div>
      </div>
      <div className="mt-4 grid grid-cols-2 gap-3 border-t border-slate-100 pt-3 text-sm">
        <Info icon={<Calendar size={15} />} label="Date/Time" value={dateTime(row)} />
        <Info icon={<UserCheck size={15} />} label="Assigned" value={row.assignedDoctor ?? "Unassigned"} />
        <Info icon={<FileText size={15} />} label="Report" value={labelStatus(row.reportStatus)} />
        <Info icon={<Clipboard size={15} />} label="Appointment" value={labelStatus(row.appointmentStatus)} />
      </div>
    </button>
  );
}

function Info({ icon, label, value }: { icon: ReactNode; label: string; value: string }) {
  return (
    <div className="min-w-0">
      <p className="flex items-center gap-1.5 text-xs font-medium text-slate-500">{icon}{label}</p>
      <p className="mt-1 truncate font-semibold text-slate-950">{value}</p>
    </div>
  );
}

export function ReportingBoardMobilePage() {
  const { token = "" } = useParams();
  const queryClient = useQueryClient();
  const [filters, setFilters] = useState<ReportingBoardFilters>({ limit: 100 });
  const [search, setSearch] = useState("");
  const [selectedCase, setSelectedCase] = useState<ReportingBoardMobileCase | null>(null);
  const [reassignDoctorId, setReassignDoctorId] = useState("");
  const [reason, setReason] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [pushMessage, setPushMessage] = useState<string | null>(null);

  const viewQuery = useQuery({
    queryKey: ["reporting-board", "mobile", token, filters],
    queryFn: () => fetchReportingBoardMobileView(token, filters),
    enabled: Boolean(token),
  });
  const doctorsQuery = useQuery({
    queryKey: ["doctor", "roster", "doctors"],
    queryFn: fetchRosterDoctors,
    enabled: Boolean(viewQuery.data?.allowedActions.reassign),
  });

  const refresh = () => viewQuery.refetch();
  const applySearch = () => setFilters((current) => ({ ...current, q: search.trim() || null }));
  const invalidate = async () => {
    await queryClient.invalidateQueries({ queryKey: ["reporting-board", "mobile", token] });
  };
  const assignMutation = useMutation({
    mutationFn: (appointmentId: number) => assignReportingBoardMobileCaseToMe(token, appointmentId),
    onSuccess: async () => {
      setMessage("Case assigned to you.");
      await invalidate();
    },
    onError: (error) => setMessage(error instanceof Error ? error.message : "Assignment failed."),
  });
  const reassignMutation = useMutation({
    mutationFn: () => reassignReportingBoardMobileCase(token, selectedCase!.appointmentId, Number(reassignDoctorId), reason),
    onSuccess: async () => {
      setMessage("Case reassigned.");
      setSelectedCase(null);
      await invalidate();
    },
    onError: (error) => setMessage(error instanceof Error ? error.message : "Reassignment failed."),
  });
  const pushSubscribeMutation = useMutation({
    mutationFn: async () => {
      if (!pushSupported()) throw new Error("Browser notifications are not supported on this device.");
      const config = await fetchReportingBoardMobilePushConfig(token);
      if (!config.enabled || !config.publicKey) throw new Error("Web Push is not configured.");
      const permission = window.Notification.permission === "granted"
        ? "granted"
        : await window.Notification.requestPermission();
      if (permission !== "granted") throw new Error("Notification permission was not granted.");
      const registration = await navigator.serviceWorker.register("/rispro-push-sw.js");
      const subscription = await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(config.publicKey),
      });
      return subscribeReportingBoardMobilePush(token, subscription.toJSON());
    },
    onSuccess: () => setPushMessage("Notifications enabled for this saved view."),
    onError: (error) => setPushMessage(error instanceof Error ? error.message : "Could not enable notifications."),
  });

  const data = viewQuery.data;
  const lastUpdated = useMemo(() => data ? new Date(data.refreshedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : "-", [data]);

  if (viewQuery.isLoading) {
    return <main className="min-h-screen bg-slate-50 p-5 text-slate-950">Loading reporting view...</main>;
  }
  if (viewQuery.isError || !data) {
    return <main className="min-h-screen bg-slate-50 p-5 text-slate-950">Saved view is unavailable.</main>;
  }

  return (
    <main className="min-h-screen bg-slate-50 px-4 pb-28 pt-5 text-slate-950">
      <header className="mx-auto max-w-xl">
        <div className="flex items-center gap-3">
          <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-teal-600 text-sm font-bold text-white">RIS<br />pro</div>
          <div>
            <h1 className="text-xl font-bold leading-tight">{data.savedView.name} - Reporting Board</h1>
            <p className="mt-1 text-sm text-slate-500">Saved view · {data.filterSummary.join(" · ") || "Current scope"}</p>
          </div>
        </div>
        <div className="mt-5 flex items-center justify-between">
          <p className="text-sm text-slate-500">Last updated {lastUpdated}</p>
          <button type="button" onClick={() => void refresh()} className="inline-flex items-center gap-2 text-sm font-bold text-teal-700">
            <RefreshCw size={18} className={viewQuery.isFetching ? "animate-spin" : ""} /> Refresh
          </button>
        </div>
      </header>

      <section className="mx-auto mt-5 flex max-w-xl gap-3 overflow-x-auto pb-2">
        <Counter icon={<Clipboard size={18} />} label="Total" value={data.counters.total} />
        <Counter icon={<UserCheck size={18} />} label="Assigned to me" value={data.counters.assignedToMe} />
        <Counter icon={<Users size={18} />} label="Unassigned" value={data.counters.unassigned} />
        <Counter icon={<Flame size={18} />} label="Urgent" value={data.counters.urgent} />
        <Counter icon={<Calendar size={18} />} label="Overdue" value={data.counters.overdue} />
      </section>

      <section className="mx-auto mt-5 max-w-xl">
        <div className="flex gap-2">
          <label className="flex h-12 flex-1 items-center gap-2 rounded-2xl border border-slate-200 bg-white px-4 shadow-sm">
            <Search size={18} className="text-slate-500" />
            <input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              onKeyDown={(event) => { if (event.key === "Enter") applySearch(); }}
              placeholder="Search patient, MRN, accession, exam..."
              className="w-full bg-transparent text-sm outline-none"
            />
          </label>
          <button type="button" aria-label="Apply mobile filters" onClick={applySearch} className="flex h-12 w-12 items-center justify-center rounded-2xl border border-slate-200 bg-white shadow-sm">
            <SlidersHorizontal size={18} />
          </button>
        </div>
        <div className="mt-3 flex gap-2 overflow-x-auto pb-1">
          <button type="button" onClick={() => setFilters({ limit: 100 })} className={chipClass("teal")}>All cases {data.counters.total}</button>
          <button type="button" onClick={() => setFilters((current) => ({ ...current, priorityCode: "urgent" }))} className={chipClass("orange")}>Urgent {data.counters.urgent}</button>
          <button type="button" onClick={() => setFilters((current) => ({ ...current, assignmentStatus: "unassigned" }))} className={chipClass("slate")}>Unassigned {data.counters.unassigned}</button>
        </div>
      </section>

      <section className="mx-auto mt-5 grid max-w-xl gap-3">
        {data.cases.map((row) => <CaseCard key={row.appointmentId} row={row} onOpen={() => setSelectedCase(row)} />)}
        {data.cases.length === 0 && <p className="rounded-2xl border border-slate-200 bg-white p-5 text-center text-sm text-slate-500">No cases match this saved view.</p>}
      </section>

      <footer className="fixed inset-x-0 bottom-0 border-t border-teal-100 bg-white/95 p-4 backdrop-blur">
        <div className="mx-auto grid max-w-xl gap-3">
          <div>
            <p className="font-bold text-slate-950">Read-only via QR.</p>
            <p className="text-sm text-slate-500">{data.allowedActions.readOnly ? "Sign in to RISpro to reassign cases." : "Authenticated actions are available for your account."}</p>
          </div>
          <button
            type="button"
            disabled={pushSubscribeMutation.isPending}
            onClick={() => pushSubscribeMutation.mutate()}
            className="inline-flex h-11 items-center justify-center gap-2 rounded-xl bg-teal-600 px-4 text-sm font-bold text-white disabled:opacity-60"
          >
            <Bell size={16} /> {pushSubscribeMutation.isPending ? "Enabling..." : "Enable notifications"}
          </button>
          {pushMessage && <p className="text-sm font-medium text-teal-700">{pushMessage}</p>}
        </div>
      </footer>

      {selectedCase && (
        <div className="fixed inset-0 z-50 flex items-end bg-black/40" role="presentation" onClick={(event) => { if (event.target === event.currentTarget) setSelectedCase(null); }}>
          <section className="max-h-[86vh] w-full overflow-auto rounded-t-3xl bg-white p-5">
            <div className="mx-auto max-w-xl">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <h2 className="text-xl font-bold">{selectedCase.patientName}</h2>
                  <p className="mt-1 text-sm text-slate-500">MRN {selectedCase.mrn ?? "-"} · {selectedCase.accessionNumber}</p>
                </div>
                <button type="button" onClick={() => setSelectedCase(null)} className="rounded-full bg-slate-100 px-3 py-1 text-sm font-semibold">Close</button>
              </div>
              <div className="mt-4 grid grid-cols-2 gap-3 text-sm">
                <Info icon={<Calendar size={15} />} label="Date/Time" value={dateTime(selectedCase)} />
                <Info icon={<Clipboard size={15} />} label="Modality" value={selectedCase.modality} />
                <Info icon={<FileText size={15} />} label="Exam" value={selectedCase.exam ?? "-"} />
                <Info icon={<UserCheck size={15} />} label="Assigned" value={selectedCase.assignedDoctor ?? "Unassigned"} />
                <Info icon={<Flame size={15} />} label="Priority" value={selectedCase.priority ?? "Normal"} />
                <Info icon={<FileText size={15} />} label="Report" value={labelStatus(selectedCase.reportStatus)} />
                <Info icon={<Clipboard size={15} />} label="Appointment" value={labelStatus(selectedCase.appointmentStatus)} />
                <Info icon={<Clipboard size={15} />} label="Category" value={selectedCase.category} />
              </div>
              {message && <p className="mt-4 rounded-xl bg-teal-50 px-3 py-2 text-sm text-teal-700">{message}</p>}
              {!data.allowedActions.readOnly && (
                <div className="mt-5 grid gap-2">
                  <button type="button" disabled={assignMutation.isPending} onClick={() => assignMutation.mutate(selectedCase.appointmentId)} className="h-11 rounded-xl bg-teal-600 text-sm font-bold text-white disabled:opacity-50">Assign to me</button>
                  {data.allowedActions.reassign && (
                    <div className="grid gap-2 rounded-2xl border border-slate-200 p-3">
                      <select value={reassignDoctorId} onChange={(event) => setReassignDoctorId(event.target.value)} className="h-10 rounded-xl border border-slate-200 px-3 text-sm">
                        <option value="">Select doctor</option>
                        {(doctorsQuery.data ?? []).map((doctor) => <option key={doctor.id} value={doctor.id}>{doctor.displayName}</option>)}
                      </select>
                      <input value={reason} onChange={(event) => setReason(event.target.value)} placeholder="Reason" className="h-10 rounded-xl border border-slate-200 px-3 text-sm" />
                      <button type="button" disabled={!reassignDoctorId || reassignMutation.isPending} onClick={() => reassignMutation.mutate()} className="h-10 rounded-xl border border-slate-200 text-sm font-bold disabled:opacity-50">Reassign</button>
                    </div>
                  )}
                </div>
              )}
            </div>
          </section>
        </div>
      )}
    </main>
  );
}
