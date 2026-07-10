import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useParams } from "react-router-dom";
import { Bell, Calendar, Clipboard, FileText, Flame, RefreshCw, Search, SlidersHorizontal, User, UserCheck, Users } from "lucide-react";
import {
  assignReportingBoardMobileCaseToMe,
  fetchReportingBoardMobilePushConfig,
  fetchReportingBoardMobilePushStatus,
  fetchReportingBoardMobileView,
  fetchRosterDoctors,
  reassignReportingBoardMobileCase,
  sendReportingBoardMobileTestPush,
  subscribeReportingBoardMobilePush,
  unsubscribeReportingBoardMobilePush,
  unassignReportingBoardMobileCase,
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

function mobileCaseIdentity(row: ReportingBoardMobileCase) {
  return row.caseType === "comparison" && row.comparisonRequestId
    ? { caseType: "comparison" as const, comparisonRequestId: row.comparisonRequestId }
    : { caseType: "appointment" as const, appointmentId: row.appointmentId };
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
            {row.caseType === "comparison" && <span className={chipClass("teal")}>Comparison request</span>}
            <span className={chipClass("blue")}>{row.modality}</span>
            {row.exam && <span className={chipClass("purple")}>{row.exam}</span>}
            <span className={chipClass("teal")}>{row.category}</span>
            {row.overdue && <span className={chipClass("red")}>Overdue</span>}
            {row.completedUnassignedAgeMinutes !== null && <span className={chipClass("orange")}>Unassigned {row.completedUnassignedAgeMinutes}m</span>}
            {row.currentAssignmentAgeMinutes !== null && <span className={chipClass("blue")}>Assigned {row.currentAssignmentAgeMinutes}m</span>}
          </div>
          {row.caseType === "comparison" && (
            <p className="mt-2 text-xs font-semibold text-slate-500">
              Prior {row.linkedPreviousAccessionNumber ?? "-"} {row.linkedPreviousStudyDate ? `· ${row.linkedPreviousStudyDate}` : ""}
            </p>
          )}
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
  const [filters, setFilters] = useState<ReportingBoardFilters>({ limit: 40, offset: 0 });
  const [loadedCases, setLoadedCases] = useState<ReportingBoardMobileCase[]>([]);
  const [filterDrawerOpen, setFilterDrawerOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [selectedCase, setSelectedCase] = useState<ReportingBoardMobileCase | null>(null);
  const [reassignDoctorId, setReassignDoctorId] = useState("");
  const [reason, setReason] = useState("");
  const [unassignOpen, setUnassignOpen] = useState(false);
  const [unassignReason, setUnassignReason] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [pushMessage, setPushMessage] = useState<string | null>(null);
  const [pushEnabled, setPushEnabled] = useState(false);
  const [pushLastSuccessAt, setPushLastSuccessAt] = useState<string | null>(null);
  const refreshInFlight = useRef(false);

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

  useEffect(() => {
    if (!viewQuery.data) return;
    setLoadedCases((current) => {
      const merged = new Map(current.map((row) => [row.caseKey, row]));
      viewQuery.data.cases.forEach((row) => merged.set(row.caseKey, row));
      return filters.offset === 0 ? viewQuery.data.cases : [...merged.values()];
    });
  }, [filters.offset, viewQuery.data]);

  useEffect(() => {
    const updateSubscription = async () => {
      if (!pushSupported()) return;
      const registration = await navigator.serviceWorker.getRegistration("/rispro-push-sw.js");
      const subscription = await registration?.pushManager.getSubscription();
      if (!subscription) return;
      const status = await fetchReportingBoardMobilePushStatus(token, subscription.toJSON());
      setPushEnabled(status.enabled);
      setPushLastSuccessAt(status.lastSuccessAt);
    };
    void updateSubscription();
  }, []);

  useEffect(() => {
    const refreshVisible = async () => {
      if (document.visibilityState !== "visible" || refreshInFlight.current) return;
      refreshInFlight.current = true;
      try {
        await viewQuery.refetch({ cancelRefetch: false });
      } finally {
        refreshInFlight.current = false;
      }
    };
    const onVisibilityChange = () => { if (document.visibilityState === "visible") void refreshVisible(); };
    const interval = window.setInterval(() => void refreshVisible(), 50_000);
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => {
      window.clearInterval(interval);
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, [viewQuery.refetch]);

  const refresh = () => viewQuery.refetch({ cancelRefetch: false });
  const updateTemporaryFilters = (updater: (current: ReportingBoardFilters) => ReportingBoardFilters) => {
    setLoadedCases([]);
    setFilters((current) => ({ ...updater(current), limit: 40, offset: 0 }));
  };
  const resetTemporaryFilters = () => {
    setSearch("");
    setLoadedCases([]);
    setFilters({ limit: 40, offset: 0 });
  };
  const applySearch = () => updateTemporaryFilters((current) => ({ ...current, q: search.trim() || null }));
  const invalidate = async () => {
    await queryClient.invalidateQueries({ queryKey: ["reporting-board", "mobile", token] });
  };
  const assignMutation = useMutation({
    mutationFn: (row: ReportingBoardMobileCase) => assignReportingBoardMobileCaseToMe(token, mobileCaseIdentity(row)),
    onSuccess: async () => {
      setMessage("Case assigned to you.");
      await invalidate();
    },
    onError: (error) => setMessage(error instanceof Error ? error.message : "Assignment failed."),
  });
  const reassignMutation = useMutation({
    mutationFn: () => reassignReportingBoardMobileCase(token, mobileCaseIdentity(selectedCase!), Number(reassignDoctorId), reason),
    onSuccess: async () => {
      setMessage("Case reassigned.");
      setSelectedCase(null);
      await invalidate();
    },
    onError: (error) => setMessage(error instanceof Error ? error.message : "Reassignment failed."),
  });
  const unassignMutation = useMutation({
    mutationFn: () => unassignReportingBoardMobileCase(token, mobileCaseIdentity(selectedCase!), unassignReason.trim()),
    onSuccess: async () => {
      setMessage("Case returned to waiting pool.");
      setSelectedCase(null);
      setUnassignOpen(false);
      setUnassignReason("");
      await invalidate();
    },
    onError: (error) => setMessage(error instanceof Error ? error.message : "Return to waiting pool failed."),
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
      const result = await subscribeReportingBoardMobilePush(token, subscription.toJSON());
      setPushEnabled(true);
      setPushLastSuccessAt(null);
      return result;
    },
    onSuccess: () => setPushMessage("Notifications enabled for this saved view."),
    onError: (error) => setPushMessage(error instanceof Error ? error.message : "Could not enable notifications."),
  });
  const pushDisableMutation = useMutation({
    mutationFn: async () => {
      if (!pushSupported()) throw new Error("Browser notifications are not supported on this device.");
      const registration = await navigator.serviceWorker.getRegistration("/rispro-push-sw.js");
      const subscription = await registration?.pushManager.getSubscription();
      if (!subscription) return { disabled: false };
      await unsubscribeReportingBoardMobilePush(token, subscription.toJSON());
      await subscription.unsubscribe();
      setPushEnabled(false);
      setPushLastSuccessAt(null);
      return { disabled: true };
    },
    onSuccess: () => setPushMessage("Notifications disabled for this device."),
    onError: (error) => setPushMessage(error instanceof Error ? error.message : "Could not disable notifications."),
  });
  const pushTestMutation = useMutation({
    mutationFn: () => sendReportingBoardMobileTestPush(token),
    onSuccess: (result) => setPushMessage(result.sent > 0 ? "Test notification sent." : "No active subscription is available for a test notification."),
    onError: (error) => setPushMessage(error instanceof Error ? error.message : "Could not send a test notification."),
  });

  const data = viewQuery.data;
  const lastUpdated = useMemo(() => {
    if (!data) return "-";
    const minutes = Math.max(0, Math.floor((Date.now() - new Date(data.refreshedAt).getTime()) / 60_000));
    return minutes === 0 ? "just now" : `${minutes} minute${minutes === 1 ? "" : "s"} ago`;
  }, [data]);

  if (viewQuery.isLoading) {
    return <main lang="en" dir="ltr" className="min-h-screen bg-slate-50 p-5 text-slate-950">Loading reporting view...</main>;
  }
  if (viewQuery.isError || !data) {
    return <main lang="en" dir="ltr" className="min-h-screen bg-slate-50 p-5 text-slate-950">Saved view is unavailable.</main>;
  }

  return (
    <main lang="en" dir="ltr" className="min-h-screen bg-slate-50 px-4 pb-6 pt-5 text-slate-950">
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
          <button type="button" aria-label="Open mobile filters" onClick={() => setFilterDrawerOpen(true)} className="flex h-12 w-12 items-center justify-center rounded-2xl border border-slate-200 bg-white shadow-sm">
            <SlidersHorizontal size={18} />
          </button>
        </div>
        <div className="mt-3 flex gap-2 overflow-x-auto pb-1">
          {data.currentDoctorId && <button type="button" aria-pressed={filters.assignedDoctorId === data.currentDoctorId} onClick={() => updateTemporaryFilters((current) => ({ ...current, assignedDoctorId: data.currentDoctorId, assignmentStatus: null, priorityCode: null, urgentOrStat: false, overdue: false, reportStatus: null }))} className={chipClass("teal")}>My cases {data.counters.assignedToMe}</button>}
          <button type="button" aria-pressed={filters.assignmentStatus === "unassigned"} onClick={() => updateTemporaryFilters((current) => ({ ...current, assignmentStatus: "unassigned", assignedDoctorId: null, priorityCode: null, urgentOrStat: false, overdue: false, reportStatus: null }))} className={chipClass("slate")}>Unassigned {data.counters.unassigned}</button>
          <button type="button" aria-pressed={filters.urgentOrStat === true} onClick={() => updateTemporaryFilters((current) => ({ ...current, urgentOrStat: true, priorityCode: null, assignmentStatus: null, assignedDoctorId: null, overdue: false, reportStatus: null }))} className={chipClass("orange")}>Urgent {data.counters.urgent}</button>
          <button type="button" aria-pressed={filters.overdue === true} onClick={() => updateTemporaryFilters((current) => ({ ...current, overdue: true, urgentOrStat: false, priorityCode: null, reportStatus: "required_not_final" }))} className={chipClass("red")}>Overdue {data.counters.overdue}</button>
          <button type="button" aria-pressed={!filters.assignedDoctorId && !filters.assignmentStatus && !filters.priorityCode && !filters.reportStatus && !filters.overdue && !filters.urgentOrStat} onClick={resetTemporaryFilters} className={chipClass("blue")}>All {data.counters.total}</button>
        </div>
        <div className="mt-3 flex flex-wrap gap-2 text-xs">
          <span className="font-semibold text-slate-500">Saved scope:</span>
          {data.filterSummary.map((item) => <span key={item} className={chipClass("slate")}>{item}</span>)}
          {(filters.q || filters.assignmentStatus || filters.priorityCode || filters.caseCategory || filters.caseSource || filters.sortBy) && <span className={chipClass("teal")}>Temporary filters active</span>}
        </div>
      </section>

      <section className="mx-auto mt-4 grid max-w-xl gap-3 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
        <div>
          {data.allowedActions.readOnly && <p className="font-bold text-slate-950">Read-only saved view.</p>}
          <p className="text-sm text-slate-500">
            {data.allowedActions.readOnly ? data.allowedActions.readOnlyReason : "Assignment actions are available for your account."}
          </p>
        </div>
        <p className="text-xs text-slate-500">Events: new matching cases, assigned to me, report final, urgent unassigned, and older than cutoff.</p>
        {pushLastSuccessAt && <p className="text-xs text-slate-500">Last successful notification: {new Date(pushLastSuccessAt).toLocaleString()}</p>}
        {!pushEnabled ? <button type="button" disabled={pushSubscribeMutation.isPending} onClick={() => pushSubscribeMutation.mutate()} className="inline-flex h-11 items-center justify-center gap-2 rounded-xl bg-teal-600 px-4 text-sm font-bold text-white disabled:opacity-60"><Bell size={16} /> {pushSubscribeMutation.isPending ? "Enabling..." : "Enable notifications"}</button> : <><button type="button" disabled={pushDisableMutation.isPending} onClick={() => pushDisableMutation.mutate()} className="h-11 rounded-xl border border-slate-300 text-sm font-bold disabled:opacity-60">Disable notifications</button><button type="button" disabled={pushTestMutation.isPending} onClick={() => pushTestMutation.mutate()} className="h-11 rounded-xl border border-slate-300 text-sm font-bold disabled:opacity-60">Send test notification</button></>}
        {pushMessage && <p className="text-sm font-medium text-teal-700">{pushMessage}</p>}
      </section>

      <section className="mx-auto mt-5 grid max-w-xl gap-3">
        {loadedCases.map((row) => <CaseCard key={row.caseKey} row={row} onOpen={() => setSelectedCase(row)} />)}
        {loadedCases.length === 0 && <p className="rounded-2xl border border-slate-200 bg-white p-5 text-center text-sm text-slate-500">No cases match this saved view.</p>}
        <p className="text-center text-xs text-slate-500">Loaded {loadedCases.length} of {data.totalCount} cases</p>
        {data.pagination.hasMore && <button type="button" disabled={viewQuery.isFetching} onClick={() => setFilters((current) => ({ ...current, offset: data.pagination.nextOffset ?? current.offset }))} className="h-11 rounded-xl border border-slate-300 bg-white text-sm font-bold disabled:opacity-50">{viewQuery.isFetching ? "Loading..." : "Load more"}</button>}
      </section>

      {filterDrawerOpen && (
        <div className="fixed inset-0 z-50 flex items-end bg-black/40" role="presentation" onClick={(event) => { if (event.target === event.currentTarget) setFilterDrawerOpen(false); }}>
          <section className="w-full rounded-t-3xl bg-white p-5">
            <div className="mx-auto grid max-w-xl gap-3">
              <div className="flex items-center justify-between"><div><h2 className="font-bold">Filters</h2><p className="text-xs text-slate-500">Temporary filters narrow this saved-view scope only.</p></div><button type="button" onClick={() => setFilterDrawerOpen(false)} className="rounded-lg border px-3 py-1 text-sm">Close</button></div>
              <p className="text-xs font-semibold text-slate-500">Locked saved-view criteria: {data.filterSummary.join(", ") || "None"}</p>
              <label className="grid gap-1 text-sm">Assignment state<select value={filters.assignmentStatus ?? ""} onChange={(event) => updateTemporaryFilters((current) => ({ ...current, assignmentStatus: (event.target.value || null) as ReportingBoardFilters["assignmentStatus"] }))} className="h-10 rounded-lg border border-slate-300 px-3"><option value="">All</option><option value="unassigned">Unassigned</option><option value="assigned">Assigned</option></select></label>
              <label className="grid gap-1 text-sm">Priority<select value={filters.priorityCode ?? ""} onChange={(event) => updateTemporaryFilters((current) => ({ ...current, priorityCode: event.target.value || null }))} className="h-10 rounded-lg border border-slate-300 px-3"><option value="">All</option><option value="stat">STAT</option><option value="urgent">Urgent</option></select></label>
              <label className="grid gap-1 text-sm">Modality code<input disabled={Boolean(data.lockedFilters.modalityCode || data.lockedFilters.modalityId)} value={filters.modalityCode ?? ""} onChange={(event) => updateTemporaryFilters((current) => ({ ...current, modalityCode: event.target.value || null }))} className="h-10 rounded-lg border border-slate-300 px-3 disabled:bg-slate-100" placeholder="Any modality" /></label>
              <label className="grid gap-1 text-sm">Category<input value={filters.caseCategory ?? ""} onChange={(event) => updateTemporaryFilters((current) => ({ ...current, caseCategory: event.target.value || null }))} className="h-10 rounded-lg border border-slate-300 px-3" placeholder="Any category" /></label>
              <label className="grid gap-1 text-sm">Report state<select disabled={Boolean(data.lockedFilters.reportStatus)} value={filters.reportStatus ?? ""} onChange={(event) => updateTemporaryFilters((current) => ({ ...current, reportStatus: (event.target.value || null) as ReportingBoardFilters["reportStatus"] }))} className="h-10 rounded-lg border border-slate-300 px-3 disabled:bg-slate-100"><option value="">All</option><option value="required_not_final">Required not final</option><option value="draft">Draft</option><option value="final">Final</option></select></label>
              <label className="grid gap-1 text-sm">Case source<select value={filters.caseSource ?? ""} onChange={(event) => updateTemporaryFilters((current) => ({ ...current, caseSource: (event.target.value || null) as ReportingBoardFilters["caseSource"] }))} className="h-10 rounded-lg border border-slate-300 px-3"><option value="">All</option><option value="appointments">Appointments</option><option value="comparisons">Comparison requests</option></select></label>
              <label className="grid gap-1 text-sm">Sort<select value={filters.sortBy ?? ""} onChange={(event) => updateTemporaryFilters((current) => ({ ...current, sortBy: (event.target.value || null) as ReportingBoardFilters["sortBy"] }))} className="h-10 rounded-lg border border-slate-300 px-3"><option value="">Priority + study date</option><option value="study_date">Study date</option><option value="longest_unassigned">Longest unassigned</option><option value="oldest_completed">Oldest completed</option></select></label>
              <button type="button" onClick={resetTemporaryFilters} className="h-10 rounded-lg border border-teal-600 text-sm font-bold text-teal-700">Reset temporary filters</button>
            </div>
          </section>
        </div>
      )}

      {selectedCase && (
        <div className="fixed inset-0 z-50 flex items-end bg-black/40" role="presentation" onClick={(event) => { if (event.target === event.currentTarget) setSelectedCase(null); }}>
          <section className="max-h-[86vh] w-full overflow-auto rounded-t-3xl bg-white p-5">
            <div className="mx-auto max-w-xl">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <h2 className="text-xl font-bold">{selectedCase.patientName}</h2>
                  <p className="mt-1 text-sm text-slate-500">MRN {selectedCase.mrn ?? "-"} · {selectedCase.accessionNumber}</p>
                  {selectedCase.caseType === "comparison" && <p className="mt-1 text-xs font-bold uppercase tracking-wide text-teal-700">Comparison request</p>}
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
                <Info icon={<Calendar size={15} />} label="Completed" value={selectedCase.completedAt ?? "-"} />
                <Info icon={<UserCheck size={15} />} label="Assignment age" value={selectedCase.currentAssignmentAgeMinutes !== null ? `${selectedCase.currentAssignmentAgeMinutes} minutes` : selectedCase.completedUnassignedAgeMinutes !== null ? `Unassigned ${selectedCase.completedUnassignedAgeMinutes} minutes` : "-"} />
                {selectedCase.caseType === "comparison" && <Info icon={<Clipboard size={15} />} label="Prior" value={`${selectedCase.linkedPreviousAccessionNumber ?? "-"} ${selectedCase.linkedPreviousStudyDate ?? ""}`.trim()} />}
              </div>
              <div className="mt-4 grid grid-cols-2 gap-2">
                {data.allowedActions.copyAccession && <button type="button" onClick={() => { void navigator.clipboard?.writeText(selectedCase.accessionNumber); setMessage("Accession copied."); }} className="h-10 rounded-xl border border-slate-300 text-sm font-bold">Copy accession</button>}
                {data.allowedActions.copyMrn && selectedCase.mrn && <button type="button" onClick={() => { void navigator.clipboard?.writeText(selectedCase.mrn!); setMessage("MRN copied."); }} className="h-10 rounded-xl border border-slate-300 text-sm font-bold">Copy MRN</button>}
              </div>
              {message && <p className="mt-4 rounded-xl bg-teal-50 px-3 py-2 text-sm text-teal-700">{message}</p>}
              {data.allowedActions.readOnly && <p className="mt-4 rounded-xl bg-slate-100 px-3 py-2 text-sm text-slate-600">Open RISpro in this browser to manage assignments.</p>}
              {!data.allowedActions.readOnly && (
                <div className="mt-5 grid gap-2">
                  {selectedCase.canAssignToMe && <button type="button" disabled={assignMutation.isPending} onClick={() => assignMutation.mutate(selectedCase)} className="h-11 rounded-xl bg-teal-600 text-sm font-bold text-white disabled:opacity-50">Assign to me</button>}
                  {selectedCase.canUnassign && (
                    <div className="grid gap-2 rounded-2xl border border-amber-200 bg-amber-50 p-3">
                      {!unassignOpen ? (
                        <button type="button" onClick={() => setUnassignOpen(true)} className="h-10 rounded-xl border border-amber-300 bg-white text-sm font-bold text-amber-800">Return to waiting pool</button>
                      ) : (
                        <>
                          <p className="text-sm font-semibold text-amber-900">This removes the assigned doctor and returns the case to the unassigned pool.</p>
                          <input value={unassignReason} onChange={(event) => setUnassignReason(event.target.value)} placeholder="Reason for returning to waiting pool" className="h-10 rounded-xl border border-amber-200 px-3 text-sm" />
                          <button
                            type="button"
                            disabled={!unassignReason.trim() || unassignMutation.isPending}
                            onClick={() => unassignMutation.mutate()}
                            className="h-10 rounded-xl bg-amber-700 text-sm font-bold text-white disabled:opacity-50"
                          >
                            Confirm return to waiting pool
                          </button>
                        </>
                      )}
                    </div>
                  )}
                  {selectedCase.canReassign && (
                    <div className="grid gap-2 rounded-2xl border border-slate-200 p-3">
                      <select value={reassignDoctorId} onChange={(event) => setReassignDoctorId(event.target.value)} className="h-10 rounded-xl border border-slate-200 px-3 text-sm">
                        <option value="">Select doctor</option>
                        {(doctorsQuery.data ?? []).map((doctor) => <option key={doctor.id} value={doctor.id}>{doctor.displayName}</option>)}
                      </select>
                      <input value={reason} onChange={(event) => setReason(event.target.value)} placeholder="Reason" className="h-10 rounded-xl border border-slate-200 px-3 text-sm" />
                      <button type="button" disabled={!reassignDoctorId || !reason.trim() || reassignMutation.isPending} onClick={() => { if (window.confirm("Reassign this case?")) reassignMutation.mutate(); }} className="h-10 rounded-xl border border-slate-200 text-sm font-bold disabled:opacity-50">Reassign</button>
                    </div>
                  )}
                  {selectedCase.actionDisabledReason && <p className="text-sm text-slate-500">{selectedCase.actionDisabledReason}</p>}
                </div>
              )}
            </div>
          </section>
        </div>
      )}
    </main>
  );
}
