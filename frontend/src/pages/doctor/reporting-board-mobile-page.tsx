import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useParams } from "react-router-dom";
import { Calendar, Clipboard, FileText, Flame, RefreshCw, Search, SlidersHorizontal, User, UserCheck, Users } from "lucide-react";
import {
  assignReportingBoardMobileCaseToMe,
  fetchReportingBoardMobilePushConfig,
  fetchReportingBoardMobilePushStatus,
  fetchReportingBoardMobileView,
  fetchRosterDoctors,
  reassignReportingBoardMobileCase,
  reconcileReportingBoardAssignmentToSonicFinalizer,
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

function tabClass(tone: "teal" | "blue" | "orange" | "red" | "slate", active: boolean) {
  return `${chipClass(tone)} ${active ? "ring-2 ring-offset-2 ring-teal-600 shadow-sm" : "opacity-80"}`;
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

function clearMobileQuickTabPredicates(filters: ReportingBoardFilters): ReportingBoardFilters {
  const withoutQuickTab = { ...filters };
  delete withoutQuickTab.mobileQuickTab;
  if (filters.mobileQuickTab === "assigned" || filters.mobileQuickTab === "unassigned") {
    delete withoutQuickTab.assignedDoctorId;
    delete withoutQuickTab.assignmentStatus;
    return withoutQuickTab;
  }
  if (filters.mobileQuickTab === "urgent") {
    delete withoutQuickTab.priorityCode;
    delete withoutQuickTab.urgentOrStat;
    return withoutQuickTab;
  }
  if (filters.mobileQuickTab === "overdue") {
    delete withoutQuickTab.overdue;
    delete withoutQuickTab.reportStatus;
    return withoutQuickTab;
  }
  return withoutQuickTab;
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
  return typeof window !== "undefined" && "serviceWorker" in navigator &&
    typeof navigator.serviceWorker?.getRegistration === "function" &&
    "PushManager" in window && "Notification" in window;
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

function normalizePacsNote(note: string | null | undefined): string {
  return String(note ?? "")
    .split(/\r?\n/)
    .map((line) => line.replace(/\s+/g, " ").trim())
    .filter(Boolean)
    .join("\n");
}

function canReconcileFinalizerAssignment(row: ReportingBoardMobileCase): boolean {
  return row.caseType === "appointment" && row.reportStatus === "final" && row.reportStatusSource === "sonicdicom" && !row.manualFinalOverrideId && row.assignedDoctorId !== null && row.finalizedByDoctorId !== null && row.assignedDoctorId !== row.finalizedByDoctorId && Boolean(row.sonicDicomLatestDocumentId);
}

function finalizerDisplay(row: ReportingBoardMobileCase): { label: string; relationship: string } | null {
  const doctorName = row.finalizedByDoctorName?.trim();
  const label = doctorName
    ? (/^dr\b/i.test(doctorName) ? doctorName : `Dr ${doctorName}`)
    : row.sonicDicomFinalizedByAccount?.trim();
  if (!label) return null;
  const relationship = !row.finalizedByDoctorId
    ? "Unmapped SonicDICOM account"
    : !row.assignedDoctorId
      ? "Finalized while unassigned"
      : row.assignedDoctorId === row.finalizedByDoctorId ? "Matched" : "Different reporter";
  return { label, relationship };
}

function CaseCard({ row, onOpen }: { row: ReportingBoardMobileCase; onOpen: () => void }) {
  const [noteExpanded, setNoteExpanded] = useState(false);
  const pacsNote = normalizePacsNote(row.sonicDicomStudyNote);
  const canExpandNote = pacsNote.length > 100 || pacsNote.includes("\n");
  const finalizer = finalizerDisplay(row);
  return (
    <article className="w-full rounded-2xl border border-slate-200 bg-white p-4 text-left shadow-sm">
      <button type="button" onClick={onOpen} className="w-full text-left">
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
          {row.caseType === "comparison" && row.comparisonReason ? <p className="mt-1 line-clamp-2 text-xs text-slate-700">{row.comparisonReason}</p> : null}
          {row.caseType === "comparison" && row.comparisonPreparationNote ? <p className="mt-1 line-clamp-2 text-xs text-slate-500">{row.comparisonPreparationNote}</p> : null}
        </div>
        </div>
        <div className="mt-4 grid grid-cols-2 gap-3 border-t border-slate-100 pt-3 text-sm">
          <Info icon={<Calendar size={15} />} label="Date/Time" value={dateTime(row)} />
          <Info icon={<UserCheck size={15} />} label="Assigned" value={<span className="inline-flex items-center gap-1">{row.assignedDoctor ?? "Unassigned"}{row.assignmentOrigin === "sonic_auto" && <span aria-label="Assignment inferred from SonicDICOM finalizer" title="Assignment inferred from SonicDICOM finalizer" className="inline-flex h-5 w-5 items-center justify-center rounded-full bg-teal-50 text-teal-700 ring-1 ring-teal-200"><RefreshCw size={11} aria-hidden="true" /></span>}</span>} />
          {finalizer && <Info icon={<UserCheck size={15} />} label="Finalized by" value={`${finalizer.label} · ${finalizer.relationship}`} />}
          <Info icon={<FileText size={15} />} label="Report" value={labelStatus(row.reportStatus)} />
          <Info icon={<Clipboard size={15} />} label="Appointment" value={labelStatus(row.appointmentStatus)} />
        </div>
      </button>
      {pacsNote && (
        <div className="mt-3 border-t border-slate-100 pt-3 text-sm">
          <p className="text-xs font-bold uppercase tracking-wide text-amber-800">PACS note</p>
          <p className={`mt-1 whitespace-pre-line text-slate-600 ${noteExpanded ? "" : "line-clamp-2"}`}>{pacsNote}</p>
          {canExpandNote && <button type="button" aria-expanded={noteExpanded} onClick={() => setNoteExpanded((current) => !current)} className="mt-1 text-xs font-bold text-teal-700">{noteExpanded ? "Show less" : "Show more"}</button>}
        </div>
      )}
    </article>
  );
}

function Info({ icon, label, value }: { icon: ReactNode; label: string; value: ReactNode }) {
  return (
    <div className="min-w-0">
      <p className="flex items-center gap-1.5 text-xs font-medium text-slate-500">{icon}{label}</p>
      <div className="mt-1 truncate font-semibold text-slate-950">{value}</div>
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
  const [reconcileOpen, setReconcileOpen] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [pushMessage, setPushMessage] = useState<string | null>(null);
  const [pushEnabled, setPushEnabled] = useState(false);
  const [pushLastSuccessAt, setPushLastSuccessAt] = useState<string | null>(null);
  const [desktopLayout, setDesktopLayout] = useState(() => typeof window !== "undefined" && window.innerWidth >= 1200);
  const refreshInFlight = useRef(false);
  const loadedOffsets = useRef<number[]>([0]);
  const initialAssignedCasesApplied = useRef(false);

  const viewQuery = useQuery({
    queryKey: ["reporting-board", "mobile", token, filters],
    queryFn: () => fetchReportingBoardMobileView(token, filters),
    enabled: Boolean(token),
  });
  const doctorsQuery = useQuery({
    queryKey: ["doctor", "roster", "doctors"],
    queryFn: fetchRosterDoctors,
    enabled: Boolean(viewQuery.data?.allowedActions.reassign || filterDrawerOpen),
  });
  const pushConfigQuery = useQuery({
    queryKey: ["reporting-board", "mobile", token, "push-config"],
    queryFn: () => fetchReportingBoardMobilePushConfig(token),
    enabled: Boolean(token) && pushSupported(),
  });

  const refreshLoadedPages = useCallback(async () => {
    if (refreshInFlight.current) return;
    refreshInFlight.current = true;
    try {
      const offsets = [...new Set(loadedOffsets.current)].sort((left, right) => left - right);
      const pages = await Promise.all(offsets.map(async (offset) => ({
        offset,
        page: await fetchReportingBoardMobileView(token, { ...filters, offset }),
      })));
      const currentPage = pages.find((item) => item.offset === (filters.offset ?? 0))?.page;
      if (currentPage) queryClient.setQueryData(["reporting-board", "mobile", token, filters], currentPage);
      const deduplicated = new Map<string, ReportingBoardMobileCase>();
      pages.sort((left, right) => left.offset - right.offset).forEach(({ page }) => page.cases.forEach((row) => deduplicated.set(row.caseKey, row)));
      setLoadedCases([...deduplicated.values()]);
    } finally {
      refreshInFlight.current = false;
    }
  }, [filters, queryClient, token]);

  useEffect(() => {
    const onResize = () => setDesktopLayout(window.innerWidth >= 1200);
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

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
  }, [token]);

  useEffect(() => {
    const refreshVisible = async () => {
      if (document.visibilityState !== "visible") return;
      await refreshLoadedPages();
    };
    const onVisibilityChange = () => { if (document.visibilityState === "visible") void refreshVisible(); };
    const interval = window.setInterval(() => void refreshVisible(), Math.max(15, viewQuery.data?.refreshIntervalSeconds ?? 50) * 1000);
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => {
      window.clearInterval(interval);
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, [refreshLoadedPages, viewQuery.data?.refreshIntervalSeconds]);

  const refresh = () => refreshLoadedPages();
  const updateTemporaryFilters = (updater: (current: ReportingBoardFilters) => ReportingBoardFilters) => {
    setLoadedCases([]);
    loadedOffsets.current = [0];
    setFilters((current) => ({ ...updater(current), limit: 40, offset: 0 }));
  };
  const clearQuickTab = () => updateTemporaryFilters(clearMobileQuickTabPredicates);
  const resetTemporaryFilters = () => {
    setSearch("");
    setLoadedCases([]);
    loadedOffsets.current = [0];
    setFilters({ limit: 40, offset: 0 });
  };
  const applySearch = () => updateTemporaryFilters((current) => ({ ...current, q: search.trim() || null }));
  const invalidate = async () => {
    await refreshLoadedPages();
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
  const reconcileMutation = useMutation({
    mutationFn: () => reconcileReportingBoardAssignmentToSonicFinalizer(selectedCase!.appointmentId, {
      expectedAssignedDoctorId: selectedCase!.assignedDoctorId!,
      expectedSonicDicomLatestDocumentId: selectedCase!.sonicDicomLatestDocumentId!,
    }),
    onSuccess: async () => {
      setMessage("Reporting assignment reconciled to the SonicDICOM finalizer.");
      setReconcileOpen(false);
      setSelectedCase(null);
      await invalidate();
    },
    onError: (error) => setMessage(error instanceof Error ? error.message : "Could not reconcile the reporting assignment."),
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
    mutationFn: async () => {
      if (!pushSupported()) throw new Error("Browser notifications are not supported on this device.");
      const registration = await navigator.serviceWorker.getRegistration("/rispro-push-sw.js");
      const subscription = await registration?.pushManager.getSubscription();
      if (!subscription) throw new Error("Enable notifications on this device before sending a test.");
      return sendReportingBoardMobileTestPush(token, subscription.toJSON());
    },
    onSuccess: (result) => setPushMessage(result.sent > 0 ? "Test notification sent." : "No active subscription is available for a test notification."),
    onError: (error) => setPushMessage(error instanceof Error ? error.message : "Could not send a test notification."),
  });

  const data = viewQuery.data;
  const lastUpdated = useMemo(() => {
    if (!data) return "-";
    const minutes = Math.max(0, Math.floor((Date.now() - new Date(data.refreshedAt).getTime()) / 60_000));
    return minutes === 0 ? "just now" : `${minutes} minute${minutes === 1 ? "" : "s"} ago`;
  }, [data]);

  useEffect(() => {
    const assignedCasesDoctorId = data?.savedView.linkKind === "doctor_worklist"
      ? data.savedView.targetDoctorId
      : data?.currentDoctorId;
    if (!assignedCasesDoctorId || initialAssignedCasesApplied.current) return;
    initialAssignedCasesApplied.current = true;
    setLoadedCases([]);
    loadedOffsets.current = [0];
    setFilters((current) => ({
      ...current,
      assignedDoctorId: assignedCasesDoctorId,
      assignmentStatus: "assigned",
      mobileQuickTab: "assigned",
      priorityCode: null,
      urgentOrStat: false,
      overdue: false,
      reportStatus: null,
      offset: 0,
    }));
  }, [data?.currentDoctorId, data?.savedView.linkKind, data?.savedView.targetDoctorId]);

  if (viewQuery.isLoading) {
    return <main lang="en" dir="ltr" className="min-h-screen bg-slate-50 p-5 text-slate-950">Loading reporting view...</main>;
  }
  if (viewQuery.isError || !data) {
    return <main lang="en" dir="ltr" className="min-h-screen bg-slate-50 p-5 text-slate-950">Saved view is unavailable.</main>;
  }

  const lockedFilters: ReportingBoardFilters = "systemManaged" in data.lockedFilters ? {} : data.lockedFilters;
  const assignedCasesDoctorId = data.savedView.linkKind === "doctor_worklist"
    ? data.savedView.targetDoctorId
    : data.currentDoctorId;
  const assignedCasesLocked = Boolean(lockedFilters.assignedDoctorId && lockedFilters.assignedDoctorId !== assignedCasesDoctorId);
  const unassignedLocked = lockedFilters.assignmentStatus === "assigned" || Boolean(lockedFilters.assignedDoctorId);
  const urgentLocked = Boolean(lockedFilters.priorityCode && !["urgent", "stat"].includes(String(lockedFilters.priorityCode).toLowerCase()));
  const overdueLocked = ["final", "no_report"].includes(String(lockedFilters.reportStatus ?? "").toLowerCase());
  const activeTemporaryFilterCount = [filters.q, filters.caseCategory, filters.caseSource, filters.sortBy && filters.sortBy !== "priority_study_date", filters.modalityCode, filters.modalityId, filters.priorityCode, filters.reportStatus && filters.reportStatus !== lockedFilters.reportStatus, filters.urgentOrStat, filters.overdue, filters.finalizedByDoctorId, filters.assignmentMatch && filters.assignmentMatch !== "all"]
    .filter((value) => value !== null && value !== undefined && value !== false && value !== "").length;
  const selectedAssigned = filters.mobileQuickTab === "assigned";
  const scopeSummary = data.filterSummary.filter((item) => !(selectedAssigned && /assigned/i.test(item)));
  const scopeModalitySummary = data.effectiveModalityCodes?.join("/") || data.filterSummary.find((item) => /^(?:[A-Z]{2,4})(?:\/[A-Z]{2,4})*$/.test(item.trim())) || "selected";
  const scopeDescription = data.savedView.linkKind === "doctor_worklist" && selectedAssigned
    ? `My assigned ${scopeModalitySummary} cases awaiting final reports`
    : "Cases awaiting reports";
  const notificationsSupported = pushSupported() && window.Notification.permission !== "denied" && Boolean(pushConfigQuery.data?.enabled);
  const selectedFinalizer = selectedCase ? finalizerDisplay(selectedCase) : null;

  return (
    <main lang="en" dir="ltr" className="min-h-screen bg-slate-50 px-4 pb-6 pt-3 text-slate-950">
      <header className="mx-auto max-w-7xl">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h1 className="text-xl font-bold leading-tight">Reporting Board</h1>
            <p className="mt-0.5 text-sm font-semibold text-slate-700">Dr. {data.savedView.name}</p>
            <p className="text-xs text-slate-500">Updated {lastUpdated}</p>
          </div>
          <button type="button" aria-label="Refresh reporting board" title="Refresh" onClick={() => void refresh()} className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-slate-200 bg-white text-teal-700 shadow-sm">
            <RefreshCw size={18} className={viewQuery.isFetching ? "animate-spin" : ""} />
          </button>
        </div>
      </header>

      <section className="mx-auto mt-5 hidden max-w-7xl gap-3 overflow-x-auto pb-2 min-[1200px]:flex" data-testid="reporting-board-kpi-cards">
        <Counter icon={<Clipboard size={18} />} label="Total" value={data.counters.total} />
        <Counter icon={<UserCheck size={18} />} label="Assigned cases" value={data.counters.assignedToMe} />
        <Counter icon={<Users size={18} />} label="Unassigned" value={data.counters.unassigned} />
        <Counter icon={<Flame size={18} />} label="Urgent" value={data.counters.urgent} />
        <Counter icon={<Calendar size={18} />} label="Overdue" value={data.counters.overdue} />
      </section>

      <section className="sticky top-0 z-10 mx-auto mt-4 max-w-7xl bg-slate-50 pb-2">
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
          <button type="button" data-testid="reporting-board-filter-button" aria-label="Open mobile filters" onClick={() => setFilterDrawerOpen(true)} className="flex h-12 min-w-12 items-center justify-center gap-1 rounded-2xl border border-slate-200 bg-white px-3 text-xs font-bold shadow-sm">
            <SlidersHorizontal size={18} /> <span>Filters{activeTemporaryFilterCount > 0 ? ` ${activeTemporaryFilterCount}` : ""}</span>
          </button>
        </div>
        <div className="mt-3 flex gap-2 overflow-x-auto pb-1">
          {assignedCasesDoctorId && <button type="button" aria-pressed={selectedAssigned} disabled={assignedCasesLocked} title={assignedCasesLocked ? "This saved view is locked to another assigned doctor." : undefined} onClick={() => updateTemporaryFilters((current) => ({ ...current, mobileQuickTab: "assigned", assignedDoctorId: assignedCasesDoctorId, assignmentStatus: "assigned", priorityCode: null, urgentOrStat: false, overdue: false, reportStatus: null }))} className={tabClass("teal", selectedAssigned)}>Assigned {data.counters.assignedToMe}</button>}
          <button type="button" aria-pressed={filters.mobileQuickTab === "unassigned"} disabled={unassignedLocked} title={unassignedLocked ? "This saved view is locked to assigned cases." : undefined} onClick={() => updateTemporaryFilters((current) => ({ ...current, mobileQuickTab: "unassigned", assignmentStatus: "unassigned", assignedDoctorId: null, priorityCode: null, urgentOrStat: false, overdue: false, reportStatus: null }))} className={tabClass("slate", filters.mobileQuickTab === "unassigned")}>Unassigned {data.counters.unassigned}</button>
          <button type="button" aria-pressed={filters.mobileQuickTab === "urgent"} disabled={urgentLocked} title={urgentLocked ? "This saved view is locked to a non-urgent priority." : undefined} onClick={() => updateTemporaryFilters((current) => ({ ...current, mobileQuickTab: "urgent", urgentOrStat: true, priorityCode: null, assignmentStatus: null, assignedDoctorId: null, overdue: false, reportStatus: null }))} className={tabClass("orange", filters.mobileQuickTab === "urgent")}>Urgent {data.counters.urgent}</button>
          <button type="button" aria-pressed={filters.mobileQuickTab === "overdue"} disabled={overdueLocked} title={overdueLocked ? "This saved view is locked to a report state that cannot be overdue." : undefined} onClick={() => updateTemporaryFilters((current) => ({ ...current, mobileQuickTab: "overdue", assignedDoctorId: null, assignmentStatus: null, overdue: true, urgentOrStat: false, priorityCode: null, reportStatus: "required_not_final" }))} className={tabClass("red", filters.mobileQuickTab === "overdue")}>Overdue {data.counters.overdue}</button>
          <button type="button" aria-pressed={!filters.mobileQuickTab} onClick={clearQuickTab} className={tabClass("blue", !filters.mobileQuickTab)}>All {data.counters.total}</button>
        </div>
        <div className="mt-3 flex items-center justify-between gap-2 text-xs">
          <div className="min-w-0"><p className="font-semibold text-slate-700">{scopeDescription}</p><p className="mt-0.5 truncate text-slate-500">Scope: {scopeSummary.join(" · ") || "All cases"}</p></div>
          <button type="button" onClick={() => setFilterDrawerOpen(true)} className="shrink-0 text-xs font-bold text-teal-700">Edit</button>
        </div>
      </section>

      {data.scopeMessage && <p className="mx-auto mt-4 max-w-7xl rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">{data.scopeMessage}</p>}

      {notificationsSupported && !pushEnabled && <section className="mx-auto mt-3 flex max-w-7xl items-center justify-between gap-3 rounded-xl border border-teal-100 bg-teal-50 px-3 py-2 text-sm text-teal-900"><span>Receive alerts for newly assigned and urgent cases.</span><button type="button" disabled={pushSubscribeMutation.isPending} onClick={() => pushSubscribeMutation.mutate()} className="shrink-0 font-bold text-teal-700 disabled:opacity-60">{pushSubscribeMutation.isPending ? "Enabling..." : "Enable"}</button></section>}
      {pushMessage && <p className="mx-auto mt-2 max-w-7xl text-sm font-medium text-teal-700">{pushMessage}</p>}

      <section className="mx-auto mt-3 grid max-w-7xl gap-3">
        {!desktopLayout && <div className="grid gap-3">{loadedCases.map((row) => <CaseCard key={row.caseKey} row={row} onOpen={() => setSelectedCase(row)} />)}</div>}
        {desktopLayout && loadedCases.length > 0 && <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white" data-testid="doctor-worklist-desktop-table">
          <table className="w-full min-w-[1050px] text-left text-sm">
            <thead className="bg-slate-50 text-xs uppercase text-slate-500"><tr><th className="p-3">Patient / case</th><th className="p-3">Study</th><th className="p-3">Priority</th><th className="p-3">Assignment</th><th className="p-3">Report</th><th className="p-3">Action</th></tr></thead>
            <tbody>{loadedCases.map((row) => <tr key={row.caseKey} className="border-t"><td className="p-3 font-semibold">{row.patientName}<span className="block text-xs font-normal text-slate-500">MRN {row.mrn ?? "-"} · {row.accessionNumber}</span></td><td className="p-3">{row.modality} · {row.exam ?? "-"}<span className="block text-xs text-slate-500">{dateTime(row)} · {row.caseType === "comparison" ? "Comparison" : row.category}</span></td><td className="p-3">{row.priority ?? "Normal"}{row.overdue && <span className="block text-xs font-semibold text-red-700">Overdue</span>}</td><td className="p-3">{row.assignedDoctor ?? "Unassigned"}</td><td className="p-3 capitalize">{labelStatus(row.reportStatus)}</td><td className="p-3"><button type="button" onClick={() => setSelectedCase(row)} className="h-9 rounded-lg border px-3 text-xs font-semibold">Details</button></td></tr>)}</tbody>
          </table>
        </div>}
        {loadedCases.length === 0 && <p className="rounded-2xl border border-slate-200 bg-white p-5 text-center text-sm text-slate-500">No cases match this saved view.</p>}
        <p className="text-center text-xs text-slate-500">Loaded {loadedCases.length} of {data.totalCount} cases</p>
        {data.pagination.hasMore && <button type="button" disabled={viewQuery.isFetching} onClick={() => { const nextOffset = data.pagination.nextOffset; if (nextOffset === null) return; loadedOffsets.current = [...new Set([...loadedOffsets.current, nextOffset])]; setFilters((current) => ({ ...current, offset: nextOffset })); }} className="h-11 rounded-xl border border-slate-300 bg-white text-sm font-bold disabled:opacity-50">{viewQuery.isFetching ? "Loading..." : "Load more"}</button>}
      </section>

      {filterDrawerOpen && (
        <div className="fixed inset-0 z-50 flex items-end bg-black/40" role="presentation" onClick={(event) => { if (event.target === event.currentTarget) setFilterDrawerOpen(false); }}>
          <section className="w-full rounded-t-3xl bg-white p-5">
            <div className="mx-auto grid max-w-xl gap-3">
              <div className="flex items-center justify-between"><div><h2 className="font-bold">Filters</h2><p className="text-xs text-slate-500">Temporary filters narrow this saved-view scope only.</p></div><button type="button" onClick={() => setFilterDrawerOpen(false)} className="rounded-lg border px-3 py-1 text-sm">Close</button></div>
              <p className="text-xs font-semibold text-slate-500">Locked saved-view criteria: {data.filterSummary.join(", ") || "None"}</p>
              <label className="grid gap-1 text-sm">Assignment state<select value={filters.assignmentStatus ?? ""} onChange={(event) => updateTemporaryFilters((current) => ({ ...clearMobileQuickTabPredicates(current), assignmentStatus: (event.target.value || null) as ReportingBoardFilters["assignmentStatus"] }))} className="h-10 rounded-lg border border-slate-300 px-3"><option value="">All</option><option value="unassigned">Unassigned</option><option value="assigned">Assigned</option></select></label>
              <label className="grid gap-1 text-sm">Finalized Doctor<select value={filters.finalizedByDoctorId ?? ""} onChange={(event) => updateTemporaryFilters((current) => ({ ...clearMobileQuickTabPredicates(current), finalizedByDoctorId: event.target.value ? Number(event.target.value) : null }))} className="h-10 rounded-lg border border-slate-300 px-3"><option value="">All</option>{(doctorsQuery.data ?? []).map((doctor) => <option key={doctor.id} value={doctor.id}>{doctor.displayName}</option>)}</select></label>
              <label className="grid gap-1 text-sm">Assignment Match<select value={filters.assignmentMatch ?? "all"} onChange={(event) => updateTemporaryFilters((current) => ({ ...clearMobileQuickTabPredicates(current), assignmentMatch: event.target.value as ReportingBoardFilters["assignmentMatch"] }))} className="h-10 rounded-lg border border-slate-300 px-3"><option value="all">All</option><option value="matched">Matched</option><option value="mismatch">Mismatch</option><option value="finalized_unassigned">Finalized while unassigned</option><option value="unmapped_finalizer">Unmapped SonicDICOM account</option></select></label>
              <label className="grid gap-1 text-sm">Priority<select value={filters.priorityCode ?? ""} onChange={(event) => updateTemporaryFilters((current) => ({ ...clearMobileQuickTabPredicates(current), priorityCode: event.target.value || null }))} className="h-10 rounded-lg border border-slate-300 px-3"><option value="">All</option><option value="stat">STAT</option><option value="urgent">Urgent</option></select></label>
              <label className="grid gap-1 text-sm">Modality code<input disabled={Boolean(lockedFilters.modalityCode || lockedFilters.modalityId)} value={filters.modalityCode ?? ""} onChange={(event) => updateTemporaryFilters((current) => ({ ...clearMobileQuickTabPredicates(current), modalityCode: event.target.value || null }))} className="h-10 rounded-lg border border-slate-300 px-3 disabled:bg-slate-100" placeholder="Any modality" /></label>
              <label className="grid gap-1 text-sm">Category<input value={filters.caseCategory ?? ""} onChange={(event) => updateTemporaryFilters((current) => ({ ...clearMobileQuickTabPredicates(current), caseCategory: event.target.value || null }))} className="h-10 rounded-lg border border-slate-300 px-3" placeholder="Any category" /></label>
              <label className="grid gap-1 text-sm">Report state<select disabled={Boolean(lockedFilters.reportStatus)} value={filters.reportStatus ?? ""} onChange={(event) => updateTemporaryFilters((current) => ({ ...clearMobileQuickTabPredicates(current), reportStatus: (event.target.value || null) as ReportingBoardFilters["reportStatus"] }))} className="h-10 rounded-lg border border-slate-300 px-3 disabled:bg-slate-100"><option value="">All</option><option value="required_not_final">Required not final</option><option value="draft">Draft</option><option value="final">Final</option></select></label>
              <label className="grid gap-1 text-sm">Case source<select value={filters.caseSource ?? ""} onChange={(event) => updateTemporaryFilters((current) => ({ ...clearMobileQuickTabPredicates(current), caseSource: (event.target.value || null) as ReportingBoardFilters["caseSource"] }))} className="h-10 rounded-lg border border-slate-300 px-3"><option value="">All</option><option value="appointments">Appointments</option><option value="comparisons">Comparison requests</option></select></label>
              <label className="grid gap-1 text-sm">Sort<select value={filters.sortBy ?? ""} onChange={(event) => updateTemporaryFilters((current) => ({ ...clearMobileQuickTabPredicates(current), sortBy: (event.target.value || null) as ReportingBoardFilters["sortBy"] }))} className="h-10 rounded-lg border border-slate-300 px-3"><option value="">Priority + study date</option><option value="study_date">Study date</option><option value="longest_unassigned">Longest unassigned</option><option value="oldest_completed">Oldest completed</option></select></label>
              {notificationsSupported && pushEnabled && <div className="flex items-center justify-between gap-2 border-t border-slate-100 pt-3"><span className="text-xs text-slate-500">Notifications enabled{pushLastSuccessAt ? ` · last sent ${new Date(pushLastSuccessAt).toLocaleString()}` : ""}</span><div className="flex gap-2"><button type="button" disabled={pushTestMutation.isPending} onClick={() => pushTestMutation.mutate()} className="rounded-lg border px-3 py-1.5 text-xs font-bold disabled:opacity-60">Send test</button><button type="button" disabled={pushDisableMutation.isPending} onClick={() => pushDisableMutation.mutate()} className="rounded-lg border px-3 py-1.5 text-xs font-bold disabled:opacity-60">Disable</button></div></div>}
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
                {selectedFinalizer && <Info icon={<UserCheck size={15} />} label="Finalized by" value={`${selectedFinalizer.label} · ${selectedFinalizer.relationship}`} />}
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
                  {selectedCase.canReassign && canReconcileFinalizerAssignment(selectedCase) && (
                    <div className="grid gap-2 rounded-2xl border border-teal-200 bg-teal-50 p-3">
                      {!reconcileOpen ? (
                        <button type="button" onClick={() => setReconcileOpen(true)} className="h-10 rounded-xl border border-teal-300 bg-white text-sm font-bold text-teal-800">Reconcile assignment to finalized doctor</button>
                      ) : (
                        <>
                          <p className="text-sm text-teal-900">Current assigned doctor: <strong>{selectedCase.assignedDoctor}</strong></p>
                          <p className="text-sm text-teal-900">SonicDICOM finalized by: <strong>{selectedCase.finalizedByDoctorName}</strong></p>
                          <p className="text-sm text-teal-900">This preserves the previous assignment in the audit history and changes the current RISpro reporting assignment to the SonicDICOM finalizer.</p>
                          <div className="flex gap-2"><button type="button" onClick={() => setReconcileOpen(false)} className="h-10 flex-1 rounded-xl border border-teal-300 bg-white text-sm font-bold">Cancel</button><button type="button" disabled={reconcileMutation.isPending} onClick={() => reconcileMutation.mutate()} className="h-10 flex-1 rounded-xl bg-teal-700 text-sm font-bold text-white disabled:opacity-50">Reconcile</button></div>
                        </>
                      )}
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
