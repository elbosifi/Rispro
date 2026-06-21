import { useEffect, useState } from "react";
import { Link, useParams, useSearchParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import QRCode from "qrcode";
import { Bell, ChevronLeft, ChevronRight, Copy, Printer, QrCode, RefreshCw, Save, Settings, Users } from "lucide-react";
import {
  assignReportingBoardCase,
  bulkAssignNextReportingCases,
  bulkReassignSelectedReportingCases,
  createReportingBoardSavedView,
  fetchAppointmentLookups,
  fetchReportingBoardCases,
  fetchReportingBoardPushConfig,
  fetchReportingBoardSavedViewByToken,
  fetchReportingBoardSavedViews,
  fetchReportingBoardSettings,
  fetchReportingBoardStats,
  fetchRosterDoctors,
  sendReportingBoardSavedViewTestPush,
  subscribeReportingBoardSavedViewPush,
  updateReportingBoardSavedView,
  updateReportingBoardSettings,
} from "@/lib/api-hooks";
import type {
  DoctorMe,
  DoctorProfile,
  ReportingBoardBulkAssignResult,
  ReportingBoardCaseRow,
  ReportingBoardDoctorStatsRow,
  ReportingBoardFilters,
  ReportingBoardNotificationSettings,
  ReportingBoardReportStatus,
  ReportingBoardSavedView,
  ReportingBoardSortBy,
  ReportingBoardSortDirection,
  ReportingBoardSettings,
} from "@/types/api";

const REPORT_STATUS_OPTIONS: Array<{ value: ReportingBoardReportStatus; label: string }> = [
  { value: "required_not_final", label: "Required not final" },
  { value: "final", label: "Final" },
  { value: "draft", label: "Draft" },
  { value: "no_report", label: "No report" },
  { value: "study_not_found", label: "Study not found" },
  { value: "unavailable", label: "Unavailable" },
  { value: "all", label: "All" },
];

const SORT_OPTIONS: Array<{ value: ReportingBoardSortBy; label: string }> = [
  { value: "priority_study_date", label: "Priority + oldest study" },
  { value: "study_date", label: "Study date" },
  { value: "accession", label: "Accession number" },
  { value: "patient_name", label: "Patient name" },
  { value: "mrn", label: "MRN" },
  { value: "exam_type", label: "Exam type" },
  { value: "modality", label: "Modality" },
  { value: "assigned_doctor", label: "Assigned doctor" },
];

const EMPTY_NOTIFICATIONS: ReportingBoardNotificationSettings = {
  notifyNewMatchingCases: false,
  notifyAssignedToMe: false,
  notifyReportFinal: false,
  notifyUnassignedUrgent: false,
  notifyOlderThanCutoff: false,
};

function isManager(me: DoctorMe): boolean {
  return me.moduleCapabilities.includes("doctor_supervisor") || me.moduleCapabilities.includes("doctor_admin");
}

function patientName(row: ReportingBoardCaseRow): string {
  return row.patientEnglishName || row.patientArabicName || row.patientMrn || `Patient ${row.patientId}`;
}

function chipClass(tone: "danger" | "warning" | "success" | "neutral" | "muted"): string {
  const tones = {
    danger: "border-red-300 bg-red-50 text-red-700",
    warning: "border-amber-300 bg-amber-50 text-amber-800",
    success: "border-emerald-300 bg-emerald-50 text-emerald-700",
    neutral: "border-slate-300 bg-slate-50 text-slate-700",
    muted: "border-zinc-200 bg-zinc-50 text-zinc-500",
  };
  return `inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-semibold ${tones[tone]}`;
}

export function priorityTone(code: string | null): "danger" | "warning" | "neutral" | "muted" {
  const normalized = String(code || "").trim().toLowerCase();
  if (!normalized) return "muted";
  if (normalized === "stat") return "danger";
  if (normalized === "urgent") return "warning";
  return "neutral";
}

export function reportStatusTone(status: ReportingBoardCaseRow["reportStatus"]): "danger" | "warning" | "success" | "neutral" | "muted" {
  if (status === "final") return "success";
  if (status === "draft") return "warning";
  if (status === "unavailable") return "danger";
  if (status === "study_not_found") return "warning";
  return "muted";
}

function labelStatus(status: string): string {
  return status.replaceAll("_", " ");
}

function cutoffFromSettings(settings?: ReportingBoardSettings): string | null {
  if (!settings) return null;
  if (settings.cutoffMode === "fixed_date") return settings.defaultCutoffDate;
  const date = new Date();
  date.setDate(date.getDate() - settings.daysBack);
  return date.toISOString().slice(0, 10);
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

function compactFilters(filters: ReportingBoardFilters): ReportingBoardFilters {
  return Object.fromEntries(Object.entries(filters).filter(([, value]) => value !== "" && value !== null && value !== undefined)) as ReportingBoardFilters;
}

export function buildReportingBoardPrintUrl(input: {
  filters: ReportingBoardFilters;
  savedViewToken?: string | null;
  selectedAppointmentIds?: number[];
  autoprint?: boolean;
  selectedDoctorName?: string | null;
}): string {
  const params = new URLSearchParams();
  Object.entries(compactFilters(input.filters)).forEach(([key, value]) => params.set(key, String(value)));
  if (input.savedViewToken) params.set("savedViewToken", input.savedViewToken);
  if (input.selectedAppointmentIds?.length) params.set("appointmentIds", input.selectedAppointmentIds.join(","));
  if (input.selectedDoctorName) params.set("doctorName", input.selectedDoctorName);
  if (input.autoprint) params.set("autoprint", "1");
  return `/print/reporting-board?${params.toString()}`;
}

function defaultFilters(settings?: ReportingBoardSettings): ReportingBoardFilters {
  const cutoffDate = cutoffFromSettings(settings);
  return {
    dateFrom: cutoffDate,
    dateTo: null,
    cutoffDate,
    assignmentStatus: "all",
    reportStatus: settings?.defaultReportStatusFilter ?? "required_not_final",
    requiresReport: settings?.defaultRequiresReport ?? true,
    sortBy: "priority_study_date",
    sortDirection: "asc",
    pinUrgentToTop: true,
    limit: 50,
    offset: 0,
  };
}

function assignmentOrderText(filters: ReportingBoardFilters): string {
  const sortBy = filters.sortBy ?? "priority_study_date";
  const direction = filters.sortDirection ?? "asc";
  const descriptions: Record<ReportingBoardSortBy, Record<ReportingBoardSortDirection, string>> = {
    priority_study_date: { asc: "priority + oldest study", desc: "priority + newest study" },
    study_date: { asc: "study date oldest first", desc: "study date newest first" },
    accession: { asc: "accession number low to high", desc: "accession number high to low" },
    patient_name: { asc: "patient name A to Z", desc: "patient name Z to A" },
    mrn: { asc: "MRN low to high", desc: "MRN high to low" },
    exam_type: { asc: "exam type A to Z", desc: "exam type Z to A" },
    modality: { asc: "modality A to Z", desc: "modality Z to A" },
    assigned_doctor: { asc: "assigned doctor A to Z", desc: "assigned doctor Z to A" },
  };
  const selectedOrder = descriptions[sortBy]?.[direction] ?? descriptions.priority_study_date.asc;
  return `Assignment order: ${filters.pinUrgentToTop === false ? selectedOrder : `STAT/urgent first, then ${selectedOrder}`}.`;
}

function StatsTile({ label, value, onClick, title }: { label: string; value: number | string; onClick?: () => void; title?: string }) {
  const content = (
    <>
      <span className="text-xs font-semibold uppercase" style={{ color: "var(--text-muted)" }}>{label}</span>
      <span className="mt-1 text-xl font-semibold text-foreground">{value}</span>
    </>
  );
  const className = "min-h-20 rounded-lg border px-3 py-2 text-left";
  const style = { backgroundColor: "var(--card)", borderColor: "var(--border)" };
  if (!onClick) return <div className={className} style={style} title={title}>{content}</div>;
  return <button type="button" onClick={onClick} className={`${className} transition hover:border-teal-500`} style={style} title={title}>{content}</button>;
}

function DoctorWorkloadPanel({
  open,
  rows,
  loading,
  onToggle,
}: {
  open: boolean;
  rows: ReportingBoardDoctorStatsRow[];
  loading: boolean;
  onToggle: () => void;
}) {
  return (
    <section className="rounded-lg border" style={{ backgroundColor: "var(--card)", borderColor: "var(--border)" }}>
      <button type="button" onClick={onToggle} className="flex w-full items-center justify-between px-4 py-3 text-left font-semibold text-foreground">
        <span>Doctor workload</span>
        <span className="text-xs" style={{ color: "var(--text-muted)" }}>{open ? "Hide" : "Show"}</span>
      </button>
      {open && (
        <div className="overflow-x-auto border-t" style={{ borderColor: "var(--border)" }}>
          <table className="min-w-full divide-y text-sm" style={{ borderColor: "var(--border)" }}>
            <thead>
              <tr>
                {["Doctor", "Total", "Required not final", "STAT/Urgent", "Oldest study", "CT", "MR"].map((header) => (
                  <th key={header} className="px-3 py-2 text-left text-xs font-semibold uppercase" style={{ color: "var(--text-muted)" }}>{header}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y" style={{ borderColor: "var(--border)" }}>
              {rows.map((row) => (
                <tr key={row.doctorId ?? "unassigned"}>
                  <td className="px-3 py-2 font-semibold text-foreground">{row.doctorName}</td>
                  <td className="px-3 py-2">{row.total}</td>
                  <td className="px-3 py-2">{row.requiredNotFinal}</td>
                  <td className="px-3 py-2">{row.statOrUrgent}</td>
                  <td className="px-3 py-2">{row.oldestStudyDate ?? "-"}</td>
                  <td className="px-3 py-2">{row.ct}</td>
                  <td className="px-3 py-2">{row.mr}</td>
                </tr>
              ))}
              {loading && <tr><td className="px-3 py-3 text-sm" colSpan={7} style={{ color: "var(--text-muted)" }}>Loading workload...</td></tr>}
              {!loading && rows.length === 0 && <tr><td className="px-3 py-3 text-sm" colSpan={7} style={{ color: "var(--text-muted)" }}>No workload rows match these filters.</td></tr>}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="text-sm font-medium">
      <span className="text-foreground">{label}</span>
      <div className="mt-1">{children}</div>
    </label>
  );
}
function inputClass() {
  return "h-10 w-full rounded-lg border px-3 text-sm";
}

function PriorityChip({ row }: { row: ReportingBoardCaseRow }) {
  const label = row.reportingPriorityName || row.reportingPriorityCode || "No priority";
  return <span className={chipClass(priorityTone(row.reportingPriorityCode))}>{label}</span>;
}

function ReportStatusChip({ status }: { status: ReportingBoardCaseRow["reportStatus"] }) {
  return <span className={chipClass(reportStatusTone(status))}>{labelStatus(status)}</span>;
}

function rowPriorityClass(code: string | null): string {
  const tone = priorityTone(code);
  if (tone === "danger") return "bg-red-50";
  if (tone === "warning") return "bg-orange-50";
  return "";
}

function AssignmentEditor({
  row,
  doctors,
  onAssign,
}: {
  row: ReportingBoardCaseRow;
  doctors: DoctorProfile[];
  onAssign: (appointmentId: number, doctorId: number, reason: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [doctorId, setDoctorId] = useState(row.assignedDoctorId ? String(row.assignedDoctorId) : "");
  const [reason, setReason] = useState("");

  if (!open) {
    return (
      <button type="button" onClick={() => setOpen(true)} className="rounded-lg border px-2 py-1 text-xs font-semibold" style={{ borderColor: "var(--border)" }}>
        {row.assignedDoctorId ? "Reassign" : "Assign"}
      </button>
    );
  }

  return (
    <div className="grid min-w-64 gap-2">
      <select value={doctorId} onChange={(event) => setDoctorId(event.target.value)} className="rounded-lg border px-2 py-1 text-xs">
        <option value="">Doctor</option>
        {doctors.map((doctor) => <option key={doctor.id} value={doctor.id}>{doctor.displayName}</option>)}
      </select>
      <input value={reason} onChange={(event) => setReason(event.target.value)} placeholder="Notes for doctor" className="rounded-lg border px-2 py-1 text-xs" />
      <div className="flex gap-2">
        <button
          type="button"
          disabled={!doctorId}
          onClick={() => {
            onAssign(row.appointmentId, Number(doctorId), reason);
            setOpen(false);
            setReason("");
          }}
          className="rounded bg-teal-600 px-2 py-1 text-xs font-semibold text-white disabled:bg-teal-300"
        >
          Save
        </button>
        <button type="button" onClick={() => setOpen(false)} className="rounded border px-2 py-1 text-xs">Cancel</button>
      </div>
    </div>
  );
}

function BulkAssignModal({
  open,
  doctors,
  modalities,
  filters,
  savedView,
  onClose,
  onResult,
}: {
  open: boolean;
  doctors: DoctorProfile[];
  modalities: Array<{ id: number; code?: string; nameEn: string }>;
  filters: ReportingBoardFilters;
  savedView: ReportingBoardSavedView | null;
  onClose: () => void;
  onResult: (result: ReportingBoardBulkAssignResult) => void;
}) {
  const [doctorId, setDoctorId] = useState("");
  const [count, setCount] = useState("5");
  const [modalityId, setModalityId] = useState("");
  const [unassignedOnly, setUnassignedOnly] = useState(true);
  const [note, setNote] = useState("");
  const [error, setError] = useState("");
  const mutation = useMutation({
    mutationFn: () => {
      const scopedFilters: ReportingBoardFilters = modalityId
        ? { ...filters, modalityId: Number(modalityId), modalityCode: null }
        : filters;
      return bulkAssignNextReportingCases({
        doctorId: Number(doctorId),
        count: Number(count),
        filters: scopedFilters,
        savedViewId: null,
        token: null,
        unassignedOnly,
        reason: note.trim() || null,
      });
    },
    onSuccess: (result) => {
      onResult(result);
      onClose();
    },
    onError: (err) => setError(err instanceof Error ? err.message : "Bulk assignment failed."),
  });

  if (!open) return null;

  const invalid = !doctorId || !Number.isInteger(Number(count)) || Number(count) <= 0;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/35 p-4">
      <section className="w-full max-w-lg rounded-lg border p-5 shadow-xl" style={{ backgroundColor: "var(--card)", borderColor: "var(--border)" }}>
        <h3 className="text-lg font-semibold text-foreground">Bulk assign next cases</h3>
        <p className="mt-1 text-sm" style={{ color: "var(--text-muted)" }}>
          Backend will choose the next cases using {savedView ? `saved view "${savedView.name}"` : "current filters"}.
        </p>
        <p className="mt-2 text-sm font-medium text-foreground">{assignmentOrderText(filters)}</p>
        <div className="mt-4 grid gap-3">
          <Field label="Doctor">
            <select value={doctorId} onChange={(event) => setDoctorId(event.target.value)} className={inputClass()}>
              <option value="">Select doctor</option>
              {doctors.map((doctor) => <option key={doctor.id} value={doctor.id}>{doctor.displayName}</option>)}
            </select>
          </Field>
          <Field label="Number of cases">
            <input value={count} onChange={(event) => setCount(event.target.value)} type="number" min={1} className={inputClass()} />
          </Field>
          <Field label="Modality">
            <select value={modalityId} onChange={(event) => setModalityId(event.target.value)} className={inputClass()}>
              <option value="">Configured CT/MR</option>
              {modalities.map((modality) => <option key={modality.id} value={modality.id}>{modality.code ?? modality.nameEn}</option>)}
            </select>
          </Field>
          <label className="inline-flex items-center gap-2 text-sm">
            <input type="checkbox" checked={unassignedOnly} onChange={(event) => setUnassignedOnly(event.target.checked)} />
            Unassigned only
          </label>
          <Field label="Notes for assigned doctor">
            <textarea value={note} onChange={(event) => setNote(event.target.value)} className="min-h-20 w-full rounded-lg border px-3 py-2 text-sm" />
          </Field>
        </div>
        {error && <p className="mt-3 text-sm text-red-600">{error}</p>}
        <div className="mt-5 flex justify-end gap-2">
          <button type="button" onClick={onClose} className="rounded-lg border px-3 py-2 text-sm font-semibold" style={{ borderColor: "var(--border)" }}>Cancel</button>
          <button type="button" disabled={invalid || mutation.isPending} onClick={() => mutation.mutate()} className="rounded-lg bg-teal-600 px-3 py-2 text-sm font-semibold text-white disabled:bg-teal-300">
            Assign next cases
          </button>
        </div>
      </section>
    </div>
  );
}

export function DoctorReportingBoardPage({ me }: { me: DoctorMe }) {
  const queryClient = useQueryClient();
  const [searchParams, setSearchParams] = useSearchParams();
  const params = useParams();
  const savedViewToken = params.token ?? searchParams.get("savedViewToken");
  const [filters, setFilters] = useState<ReportingBoardFilters>({ assignmentStatus: "all", reportStatus: "required_not_final", requiresReport: true, sortBy: "priority_study_date", sortDirection: "asc", pinUrgentToTop: true, limit: 50, offset: 0 });
  const [loadedSavedView, setLoadedSavedView] = useState<ReportingBoardSavedView | null>(null);
  const [selectedIds, setSelectedIds] = useState<number[]>([]);
  const [saveName, setSaveName] = useState("");
  const [notifications, setNotifications] = useState<ReportingBoardNotificationSettings>(EMPTY_NOTIFICATIONS);
  const [bulkOpen, setBulkOpen] = useState(false);
  const [bulkResult, setBulkResult] = useState<ReportingBoardBulkAssignResult | null>(null);
  const [selectedReassignDoctorId, setSelectedReassignDoctorId] = useState("");
  const [selectedReassignReason, setSelectedReassignReason] = useState("");
  const [selectedReassignConfirmOpen, setSelectedReassignConfirmOpen] = useState(false);
  const [priorityShortcutOpen, setPriorityShortcutOpen] = useState(false);
  const [doctorStatsOpen, setDoctorStatsOpen] = useState(true);
  const [settingsDraft, setSettingsDraft] = useState<ReportingBoardSettings | null>(null);
  const [savedViewsOpen, setSavedViewsOpen] = useState(true);
  const [savedViewMessage, setSavedViewMessage] = useState<{ tone: "success" | "error"; text: string } | null>(null);
  const [savedViewQr, setSavedViewQr] = useState<string | null>(null);

  const settingsQuery = useQuery({ queryKey: ["doctor", "reporting-board", "settings"], queryFn: fetchReportingBoardSettings });
  const casesQuery = useQuery({
    queryKey: ["doctor", "reporting-board", "cases", filters],
    queryFn: () => fetchReportingBoardCases(filters),
    refetchInterval: 30000,
  });
  const statsQuery = useQuery({
    queryKey: ["doctor", "reporting-board", "stats", filters],
    queryFn: () => fetchReportingBoardStats(filters),
    refetchInterval: 30000,
  });
  const pushConfigQuery = useQuery({ queryKey: ["doctor", "reporting-board", "push-config"], queryFn: fetchReportingBoardPushConfig });
  const savedViewsQuery = useQuery({ queryKey: ["doctor", "reporting-board", "saved-views"], queryFn: fetchReportingBoardSavedViews });
  const doctorsQuery = useQuery({ queryKey: ["doctor", "roster", "doctors"], queryFn: fetchRosterDoctors });
  const lookupsQuery = useQuery({ queryKey: ["lookups"], queryFn: fetchAppointmentLookups, staleTime: 1000 * 60 * 5 });
  const tokenQuery = useQuery({
    queryKey: ["doctor", "reporting-board", "saved-view-token", savedViewToken],
    queryFn: () => fetchReportingBoardSavedViewByToken(savedViewToken || ""),
    enabled: Boolean(savedViewToken),
  });

  useEffect(() => {
    if (!settingsQuery.data) return;
    setFilters((current) => ({ ...defaultFilters(settingsQuery.data), ...current }));
    setSettingsDraft(settingsQuery.data);
  }, [settingsQuery.data]);

  useEffect(() => {
    if (!tokenQuery.data) return;
    setLoadedSavedView(tokenQuery.data);
    setFilters({ ...defaultFilters(settingsQuery.data), ...tokenQuery.data.filters });
    setNotifications({ ...EMPTY_NOTIFICATIONS, ...tokenQuery.data.notificationSettings });
  }, [settingsQuery.data, tokenQuery.data]);

  const saveViewMutation = useMutation({
    mutationFn: () => createReportingBoardSavedView({ name: saveName, filters: compactFilters(filters), notificationSettings: notifications }),
    onSuccess: async (view) => {
      setLoadedSavedView(view);
      setSaveName("");
      setSavedViewQr(null);
      setSavedViewMessage({ tone: "success", text: "Saved view created." });
      await queryClient.invalidateQueries({ queryKey: ["doctor", "reporting-board", "saved-views"] });
    },
    onError: (err) => setSavedViewMessage({ tone: "error", text: err instanceof Error ? err.message : "Could not save view." }),
  });
  const updateViewMutation = useMutation<ReportingBoardSavedView, Error, boolean>({
    mutationFn: (active: boolean) => updateReportingBoardSavedView(loadedSavedView!.id, {
      name: saveName.trim() || loadedSavedView!.name,
      filters: compactFilters(filters),
      notificationSettings: notifications,
      active,
    }),
    onSuccess: async (view) => {
      setLoadedSavedView(view.active ? view : null);
      setSavedViewQr(null);
      setSavedViewMessage({ tone: "success", text: view.active ? "Saved view updated." : "Saved view deactivated." });
      await queryClient.invalidateQueries({ queryKey: ["doctor", "reporting-board", "saved-views"] });
    },
    onError: (err) => setSavedViewMessage({ tone: "error", text: err instanceof Error ? err.message : "Could not update view." }),
  });
  const pushSubscribeMutation = useMutation({
    mutationFn: async () => {
      if (!loadedSavedView) throw new Error("Open or save a view first.");
      if (!pushConfigQuery.data?.enabled || !pushConfigQuery.data.publicKey) throw new Error("Web Push is not configured.");
      if (!pushSupported()) throw new Error("Browser push is not supported on this device.");
      const permission = await Notification.requestPermission();
      if (permission !== "granted") throw new Error("Notification permission was not granted.");
      const registration = await navigator.serviceWorker.register("/rispro-push-sw.js");
      const existing = await registration.pushManager.getSubscription();
      const subscription =
        existing ??
        (await registration.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: urlBase64ToUint8Array(pushConfigQuery.data.publicKey),
        }));
      return subscribeReportingBoardSavedViewPush(loadedSavedView.id, subscription.toJSON());
    },
    onSuccess: () => setSavedViewMessage({ tone: "success", text: "Browser push enabled for this saved view." }),
    onError: (err) => setSavedViewMessage({ tone: "error", text: err instanceof Error ? err.message : "Could not enable browser push." }),
  });
  const pushTestMutation = useMutation({
    mutationFn: () => {
      if (!loadedSavedView) throw new Error("Open or save a view first.");
      return sendReportingBoardSavedViewTestPush(loadedSavedView.id);
    },
    onSuccess: (result) => setSavedViewMessage({
      tone: result.sent > 0 ? "success" : "error",
      text: result.sent > 0 ? "Test notification sent." : "No active web push subscription found for this view.",
    }),
    onError: (err) => setSavedViewMessage({ tone: "error", text: err instanceof Error ? err.message : "Could not send test notification." }),
  });
  const updateSettingsMutation = useMutation({
    mutationFn: () => updateReportingBoardSettings(settingsDraft!),
    onSuccess: async () => queryClient.invalidateQueries({ queryKey: ["doctor", "reporting-board", "settings"] }),
  });
  const assignMutation = useMutation({
    mutationFn: (payload: { appointmentId: number; doctorId: number; reason: string }) => assignReportingBoardCase(payload.appointmentId, { doctorId: payload.doctorId, reason: payload.reason }),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["doctor", "reporting-board", "cases"] }),
        queryClient.invalidateQueries({ queryKey: ["doctor", "reporting-board", "stats"] }),
      ]);
    },
  });
  const selectedReassignMutation = useMutation({
    mutationFn: () => bulkReassignSelectedReportingCases({
      appointmentIds: selectedIds,
      doctorId: Number(selectedReassignDoctorId),
      reason: selectedReassignReason.trim() || null,
    }),
    onSuccess: async (result) => {
      setBulkResult(result);
      setSelectedIds([]);
      setSelectedReassignConfirmOpen(false);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["doctor", "reporting-board", "cases"] }),
        queryClient.invalidateQueries({ queryKey: ["doctor", "reporting-board", "stats"] }),
      ]);
    },
  });

  const cases = casesQuery.data?.cases ?? [];
  const effectiveFilters = casesQuery.data?.filters ?? filters;
  const statsSummary = statsQuery.data?.summary;
  const doctorStats = statsQuery.data?.byDoctor ?? [];
  const canEditSettings = Boolean(me.isSuperAdmin);
  const canManage = isManager(me);
  const assignmentFilterValue = filters.assignedDoctorId ? `doctor:${filters.assignedDoctorId}` : filters.assignmentStatus === "unassigned" ? "unassigned" : "all";
  const selectedAssignedDoctor = filters.assignedDoctorId
    ? (doctorsQuery.data ?? []).find((doctor) => doctor.id === filters.assignedDoctorId) ?? null
    : null;
  const printUrl = buildReportingBoardPrintUrl({
    filters: effectiveFilters,
    savedViewToken: loadedSavedView?.token ?? null,
    selectedAppointmentIds: selectedIds,
    selectedDoctorName: selectedAssignedDoctor?.displayName ?? null,
  });
  const savedViewLink = loadedSavedView ? `${window.location.origin}/doctor/reporting-board/saved/${loadedSavedView.token}` : "";
  const mobileSavedViewLink = loadedSavedView ? `${window.location.origin}/mobile/reporting-view/${loadedSavedView.token}` : "";
  const visibleAppointmentIds = cases.map((row) => row.appointmentId);
  const allVisibleSelected = visibleAppointmentIds.length > 0 && visibleAppointmentIds.every((id) => selectedIds.includes(id));
  const selectedReassignDoctor = selectedReassignDoctorId ? (doctorsQuery.data ?? []).find((doctor) => doctor.id === Number(selectedReassignDoctorId)) ?? null : null;
  const selectedReassignDisabled = !canManage || selectedIds.length === 0 || !selectedReassignDoctorId || selectedReassignMutation.isPending;

  const setFilter = <K extends keyof ReportingBoardFilters>(key: K, value: ReportingBoardFilters[K]) => {
    setFilters((current) => ({ ...current, [key]: value, offset: 0 }));
  };

  const setAssignmentShortcut = (assignmentStatus: ReportingBoardFilters["assignmentStatus"]) => {
    setFilters((current) => ({ ...current, assignmentStatus, assignedDoctorId: null, offset: 0 }));
  };

  const setModalityShortcut = (modalityCode: string) => {
    setFilters((current) => ({ ...current, modalityCode, modalityId: null, offset: 0 }));
  };

  const setPriorityShortcut = (priorityCode: string) => {
    setPriorityShortcutOpen(false);
    setFilter("priorityCode", priorityCode);
  };

  const copySavedViewLink = async () => {
    if (!savedViewLink) return;
    try {
      await navigator.clipboard?.writeText(savedViewLink);
      setSavedViewMessage({ tone: "success", text: "Saved view link copied." });
    } catch {
      setSavedViewMessage({ tone: "error", text: "Could not copy the saved view link." });
    }
  };

  const showSavedViewQr = async () => {
    if (!mobileSavedViewLink) return;
    try {
      setSavedViewQr(await QRCode.toDataURL(mobileSavedViewLink, { margin: 1, width: 220 }));
      setSavedViewMessage({ tone: "success", text: "Mobile read-only QR link generated." });
    } catch {
      setSavedViewMessage({ tone: "error", text: "Could not generate QR link." });
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.16em]" style={{ color: "var(--text-muted)" }}>Doctor Portal</p>
          <h2 className="mt-1 text-2xl font-semibold text-foreground">Reporting Assignment Board</h2>
          <p className="mt-1 text-sm" style={{ color: "var(--text-muted)" }}>
            Effective cutoff: {effectiveFilters.cutoffDate ?? effectiveFilters.dateFrom ?? "-"} - Cutoff settings are controlled by superadmin. {selectedAssignedDoctor ? `Selected doctor: ${selectedAssignedDoctor.displayName}.` : ""}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Link to={printUrl} target="_blank" className="inline-flex h-10 items-center gap-2 rounded-lg border px-3 text-sm font-semibold" style={{ borderColor: "var(--border)" }}>
            <Printer size={16} /> Print handoff
          </Link>
          <button type="button" onClick={() => casesQuery.refetch()} className="inline-flex h-10 items-center gap-2 rounded-lg border px-3 text-sm font-semibold" style={{ borderColor: "var(--border)" }}>
            <RefreshCw size={16} /> Refresh
          </button>
          {canManage && (
            <button type="button" onClick={() => setBulkOpen(true)} className="inline-flex h-10 items-center gap-2 rounded-lg bg-teal-600 px-3 text-sm font-semibold text-white">
              <Users size={16} /> Bulk assign next cases
            </button>
          )}
        </div>
      </div>

      <section className="grid gap-3 rounded-lg border p-4 md:grid-cols-3 xl:grid-cols-11" style={{ backgroundColor: "var(--card)", borderColor: "var(--border)" }}>
        <Field label="Date from"><input type="date" value={filters.dateFrom ?? ""} onChange={(event) => setFilter("dateFrom", event.target.value || null)} className={inputClass()} /></Field>
        <Field label="Date to"><input type="date" value={filters.dateTo ?? ""} onChange={(event) => setFilter("dateTo", event.target.value || null)} className={inputClass()} /></Field>
        <Field label="Modality">
          <select
            value={filters.modalityId ?? ""}
            onChange={(event) => setFilters((current) => ({ ...current, modalityId: event.target.value ? Number(event.target.value) : null, modalityCode: null, offset: 0 }))}
            className={inputClass()}
          >
            <option value="">Configured CT/MR</option>
            {(lookupsQuery.data?.modalities ?? []).map((modality) => <option key={modality.id} value={modality.id}>{modality.code ?? modality.nameEn}</option>)}
          </select>
        </Field>
        <Field label="Assigned doctor">
          <select
            value={assignmentFilterValue}
            onChange={(event) => {
              const value = event.target.value;
              if (value === "unassigned") setFilters((current) => ({ ...current, assignmentStatus: "unassigned", assignedDoctorId: null }));
              else if (value.startsWith("doctor:")) setFilters((current) => ({ ...current, assignmentStatus: "assigned", assignedDoctorId: Number(value.slice(7)) }));
              else setFilters((current) => ({ ...current, assignmentStatus: "all", assignedDoctorId: null }));
            }}
            className={inputClass()}
          >
            <option value="all">All</option>
            <option value="unassigned">Unassigned</option>
            {(doctorsQuery.data ?? []).map((doctor) => <option key={doctor.id} value={`doctor:${doctor.id}`}>{doctor.displayName}</option>)}
          </select>
        </Field>
        <Field label="Category">
          <select value={filters.caseCategory ?? ""} onChange={(event) => setFilter("caseCategory", event.target.value || null)} className={inputClass()}>
            <option value="">All</option>
            <option value="oncology">Oncology</option>
            <option value="non_oncology">Non-oncology</option>
          </select>
        </Field>
        <Field label="Report status">
          <select value={filters.reportStatus ?? "required_not_final"} onChange={(event) => setFilter("reportStatus", event.target.value as ReportingBoardReportStatus)} className={inputClass()}>
            {REPORT_STATUS_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
          </select>
        </Field>
        <Field label="Priority">
          <select value={filters.priorityCode ?? ""} onChange={(event) => setFilter("priorityCode", event.target.value || null)} className={inputClass()}>
            <option value="">All</option>
            {(lookupsQuery.data?.priorities ?? []).map((priority) => <option key={priority.id} value={priority.code}>{priority.nameEn}</option>)}
          </select>
        </Field>
        <Field label="Sort by">
          <select value={filters.sortBy ?? "priority_study_date"} onChange={(event) => setFilter("sortBy", event.target.value as ReportingBoardSortBy)} className={inputClass()}>
            {SORT_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
          </select>
        </Field>
        <Field label="Direction">
          <select value={filters.sortDirection ?? "asc"} onChange={(event) => setFilter("sortDirection", event.target.value as ReportingBoardSortDirection)} className={inputClass()}>
            <option value="asc">Asc</option>
            <option value="desc">Desc</option>
          </select>
        </Field>
        <label className="flex h-full items-end text-sm font-medium">
          <span className="inline-flex min-h-10 items-center gap-2 rounded-lg border px-3" style={{ borderColor: "var(--border)" }}>
            <input type="checkbox" checked={filters.pinUrgentToTop !== false} onChange={(event) => setFilter("pinUrgentToTop", event.target.checked)} />
            Keep STAT/urgent on top
          </span>
        </label>
        <Field label="Limit"><input type="number" min={1} max={100} value={filters.limit ?? 50} onChange={(event) => setFilter("limit", Number(event.target.value) || 50)} className={inputClass()} /></Field>
      </section>

      <section className="space-y-3">
        {statsQuery.isLoading && <p className="text-sm" style={{ color: "var(--text-muted)" }}>Loading board statistics...</p>}
        {statsQuery.isError && (
          <p className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
            {statsQuery.error instanceof Error ? statsQuery.error.message : "Could not load board statistics."}
          </p>
        )}
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-5 xl:grid-cols-10">
          <StatsTile label="Total" value={statsSummary?.total ?? "-"} />
          <StatsTile label="Unassigned" value={statsSummary?.unassigned ?? "-"} onClick={() => setAssignmentShortcut("unassigned")} />
          <StatsTile label="Assigned" value={statsSummary?.assigned ?? "-"} onClick={() => setAssignmentShortcut("assigned")} />
          <div className="relative">
            <StatsTile label="STAT/Urgent" value={statsSummary?.statOrUrgent ?? "-"} onClick={() => setPriorityShortcutOpen((current) => !current)} />
            {priorityShortcutOpen && (
              <div className="absolute left-0 top-full z-20 mt-1 flex gap-1 rounded-lg border p-2 shadow-lg" style={{ backgroundColor: "var(--card)", borderColor: "var(--border)" }}>
                <button type="button" onClick={() => setPriorityShortcut("stat")} className="rounded-lg border px-3 py-1.5 text-sm font-semibold" style={{ borderColor: "var(--border)" }}>STAT</button>
                <button type="button" onClick={() => setPriorityShortcut("urgent")} className="rounded-lg border px-3 py-1.5 text-sm font-semibold" style={{ borderColor: "var(--border)" }}>Urgent</button>
              </div>
            )}
          </div>
          <StatsTile label="Required not final" value={statsSummary?.requiredNotFinal ?? "-"} />
          <StatsTile label="Draft" value={statsSummary?.draft ?? "-"} />
          <StatsTile label="Final" value={statsSummary?.final ?? "-"} />
          <StatsTile label="Overdue" value={statsSummary?.overdue ?? "-"} title="Informational. Overdue filtering is not part of the current board filter contract." />
          <StatsTile label="CT" value={statsSummary?.ct ?? "-"} onClick={() => setModalityShortcut("CT")} />
          <StatsTile label="MR" value={statsSummary?.mr ?? "-"} onClick={() => setModalityShortcut("MR")} />
        </div>
        <DoctorWorkloadPanel
          open={doctorStatsOpen}
          rows={doctorStats}
          loading={statsQuery.isLoading}
          onToggle={() => setDoctorStatsOpen((current) => !current)}
        />
      </section>

      <div className={savedViewsOpen ? "grid gap-4 xl:grid-cols-[1fr_340px]" : "grid gap-4 xl:grid-cols-[1fr_48px]"}>
        <section className="space-y-3">
          <div className="rounded-lg border p-3" style={{ backgroundColor: "var(--card)", borderColor: "var(--border)" }}>
            <div className="flex flex-wrap items-end gap-3">
              <p className="min-w-24 text-sm font-semibold text-foreground">{selectedIds.length} selected</p>
              <Field label="Reassign to">
                <select value={selectedReassignDoctorId} onChange={(event) => setSelectedReassignDoctorId(event.target.value)} disabled={!canManage} className={inputClass()}>
                  <option value="">Select doctor</option>
                  {(doctorsQuery.data ?? []).map((doctor) => <option key={doctor.id} value={doctor.id}>{doctor.displayName}</option>)}
                </select>
              </Field>
              <Field label="Reason/note">
                <input value={selectedReassignReason} onChange={(event) => setSelectedReassignReason(event.target.value)} disabled={!canManage} className={inputClass()} />
              </Field>
              <button
                type="button"
                disabled={selectedReassignDisabled}
                onClick={() => setSelectedReassignConfirmOpen(true)}
                className="h-10 rounded-lg bg-teal-600 px-3 text-sm font-semibold text-white disabled:bg-teal-300"
              >
                Reassign selected
              </button>
              <button type="button" onClick={() => setSelectedIds([])} className="h-10 rounded-lg border px-3 text-sm font-semibold" style={{ borderColor: "var(--border)" }}>
                Clear
              </button>
            </div>
            {!canManage && <p className="mt-2 text-xs" style={{ color: "var(--text-muted)" }}>Only supervisors/admins can reassign selected cases.</p>}
            {selectedReassignMutation.error && <p className="mt-2 text-sm text-red-600">{selectedReassignMutation.error instanceof Error ? selectedReassignMutation.error.message : "Selected reassignment failed."}</p>}
          </div>
          <div className="rounded-lg border" style={{ borderColor: "var(--border)" }}>
            <div className="overflow-x-auto">
              <table className="min-w-full divide-y text-sm" style={{ borderColor: "var(--border)" }}>
                <thead style={{ backgroundColor: "var(--card)" }}>
                  <tr>
                    <th className="px-3 py-2 text-left text-xs font-semibold uppercase" style={{ color: "var(--text-muted)" }}>
                      <input
                        type="checkbox"
                        aria-label="Select all visible cases"
                        checked={allVisibleSelected}
                        onChange={(event) => {
                          const checked = event.target.checked;
                          setSelectedIds((current) => {
                            if (checked) return [...new Set([...current, ...visibleAppointmentIds])];
                            return current.filter((id) => !visibleAppointmentIds.includes(id));
                          });
                        }}
                      />
                    </th>
                    {["Priority", "Patient", "MRN", "Accession", "Date/time", "Modality", "Exam", "Category", "Assigned doctor", "Report", "Appointment", "Action"].map((header) => (
                      <th key={header} className="px-3 py-2 text-left text-xs font-semibold uppercase" style={{ color: "var(--text-muted)" }}>{header}</th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y" style={{ borderColor: "var(--border)" }}>
                  {cases.map((row) => (
                    <tr key={row.appointmentId} className={rowPriorityClass(row.reportingPriorityCode)}>
                      <td className="px-3 py-2"><input
                        type="checkbox"
                        aria-label={`Select case ${row.accessionNumber}`}
                        checked={selectedIds.includes(row.appointmentId)}
                        onChange={(event) => {
                          const checked = event.target.checked;
                          setSelectedIds((current) => checked ? [...new Set([...current, row.appointmentId])] : current.filter((id) => id !== row.appointmentId));
                        }}
                      /></td>
                      <td className="px-3 py-2"><PriorityChip row={row} /></td>
                      <td className="px-3 py-2 font-semibold text-foreground">{patientName(row)}</td>
                      <td className="px-3 py-2">{row.patientMrn ?? "-"}</td>
                      <td className="px-3 py-2">{row.accessionNumber}</td>
                      <td className="px-3 py-2">{row.bookingDate} {row.bookingTime ?? ""}</td>
                      <td className="px-3 py-2">{row.modalityCode}</td>
                      <td className="px-3 py-2">{row.examTypeName ?? "-"}</td>
                      <td className="px-3 py-2">{row.caseCategory}</td>
                      <td className="px-3 py-2">{row.assignedDoctorName ?? "Unassigned"}</td>
                      <td className="px-3 py-2"><ReportStatusChip status={row.reportStatus} /></td>
                      <td className="px-3 py-2">{row.appointmentStatus}</td>
                      <td className="px-3 py-2">
                        {canManage && row.canAssign ? (
                          <AssignmentEditor row={row} doctors={doctorsQuery.data ?? []} onAssign={(appointmentId, doctorId, reason) => assignMutation.mutate({ appointmentId, doctorId, reason })} />
                        ) : row.exclusionReason ?? "-"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {casesQuery.isLoading && <p className="p-4 text-sm" style={{ color: "var(--text-muted)" }}>Loading reporting cases...</p>}
            {!casesQuery.isLoading && cases.length === 0 && <p className="p-4 text-sm" style={{ color: "var(--text-muted)" }}>No cases match these filters.</p>}
          </div>
          {bulkResult && (
            <div className="rounded-lg border p-4 text-sm" style={{ backgroundColor: "var(--card)", borderColor: "var(--border)" }}>
              <p className="font-semibold">Bulk assignment result: {bulkResult.assignedCount}/{bulkResult.requestedCount} assigned, {bulkResult.skippedCount} skipped.</p>
              <p className="mt-1">Assigned appointment IDs: {bulkResult.assignedAppointmentIds.join(", ") || "-"}</p>
              {bulkResult.skipped.length > 0 && <p className="mt-1">Skipped: {bulkResult.skipped.map((item) => `${item.appointmentId} ${item.reason}`).join("; ")}</p>}
            </div>
          )}
        </section>

        <aside className="space-y-4">
          {!savedViewsOpen ? (
            <button
              type="button"
              onClick={() => setSavedViewsOpen(true)}
              className="flex w-full items-center justify-center gap-2 rounded-lg border p-3 text-sm font-semibold xl:min-h-44 xl:flex-col"
              style={{ backgroundColor: "var(--card)", borderColor: "var(--border)" }}
              aria-label="Open saved views"
            >
              <ChevronLeft size={16} />
              <span className="xl:[writing-mode:vertical-rl]">Saved views</span>
            </button>
          ) : (
            <>
              <section className="rounded-lg border p-4" style={{ backgroundColor: "var(--card)", borderColor: "var(--border)" }}>
                <div className="flex items-center justify-between gap-2">
                  <div>
                    <h3 className="font-semibold text-foreground">Saved views</h3>
                    <p className="mt-1 text-xs" style={{ color: "var(--text-muted)" }}>In-app and browser push notifications are saved with each view.</p>
                  </div>
                  <button type="button" onClick={() => setSavedViewsOpen(false)} className="rounded-lg border p-2" style={{ borderColor: "var(--border)" }} aria-label="Collapse saved views">
                    <ChevronRight size={16} />
                  </button>
                </div>
                <div className="mt-3 space-y-2">
                  {(savedViewsQuery.data ?? []).map((view) => (
                    <button key={view.id} type="button" onClick={() => {
                      setLoadedSavedView(view);
                      setFilters({ ...defaultFilters(settingsQuery.data), ...view.filters });
                      setNotifications({ ...EMPTY_NOTIFICATIONS, ...view.notificationSettings });
                      setSearchParams({ savedViewToken: view.token });
                      setSavedViewQr(null);
                      setSavedViewMessage({ tone: "success", text: `Loaded saved view: ${view.name}.` });
                    }} className="block w-full rounded-lg border px-3 py-2 text-left text-sm" style={{ borderColor: loadedSavedView?.id === view.id ? "var(--accent)" : "var(--border)" }}>
                      {view.name}
                    </button>
                  ))}
                </div>
                <div className="mt-4 grid gap-2">
                  <input value={saveName} onChange={(event) => setSaveName(event.target.value)} placeholder={loadedSavedView?.name ?? "Saved view name"} className={inputClass()} />
                  {Object.keys(EMPTY_NOTIFICATIONS).map((key) => (
                    <label key={key} className="inline-flex items-center gap-2 text-xs">
                      <input
                        type="checkbox"
                        checked={Boolean(notifications[key as keyof ReportingBoardNotificationSettings])}
                        onChange={(event) => setNotifications((current) => ({ ...current, [key]: event.target.checked }))}
                      />
                      {key.replace(/^notify/, "Notify ").replaceAll(/([A-Z])/g, " $1").toLowerCase()}
                    </label>
                  ))}
                  {savedViewMessage && (
                    <p className={savedViewMessage.tone === "success" ? "rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs text-emerald-700" : "rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700"}>
                      {savedViewMessage.text}
                    </p>
                  )}
                  <button type="button" disabled={!saveName.trim() || saveViewMutation.isPending} onClick={() => saveViewMutation.mutate()} className="inline-flex h-9 items-center justify-center gap-2 rounded-lg bg-teal-600 px-3 text-sm font-semibold text-white disabled:bg-teal-300">
                    <Save size={14} /> {saveViewMutation.isPending ? "Saving..." : "Save new view"}
                  </button>
                  {loadedSavedView && (
                    <>
                      <button type="button" disabled={updateViewMutation.isPending} onClick={() => updateViewMutation.mutate(true)} className="h-9 rounded-lg border px-3 text-sm font-semibold" style={{ borderColor: "var(--border)" }}>Update current view</button>
                      <button type="button" disabled={updateViewMutation.isPending} onClick={() => updateViewMutation.mutate(false)} className="h-9 rounded-lg border px-3 text-sm font-semibold text-red-700" style={{ borderColor: "var(--border)" }}>Deactivate view</button>
                      <button type="button" onClick={() => void copySavedViewLink()} className="inline-flex h-9 items-center justify-center gap-2 rounded-lg border px-3 text-sm font-semibold" style={{ borderColor: "var(--border)" }}>
                        <Copy size={14} /> Copy authenticated link
                      </button>
                      <button type="button" onClick={() => void showSavedViewQr()} className="inline-flex h-9 items-center justify-center gap-2 rounded-lg border px-3 text-sm font-semibold" style={{ borderColor: "var(--border)" }}>
                        <QrCode size={14} /> Show mobile QR
                      </button>
                      <button
                        type="button"
                        disabled={!pushConfigQuery.data?.enabled || pushSubscribeMutation.isPending}
                        onClick={() => pushSubscribeMutation.mutate()}
                        className="inline-flex h-9 items-center justify-center gap-2 rounded-lg border px-3 text-sm font-semibold disabled:opacity-50"
                        style={{ borderColor: "var(--border)" }}
                      >
                        <Bell size={14} /> {pushSubscribeMutation.isPending ? "Enabling..." : "Enable web push"}
                      </button>
                      <button
                        type="button"
                        disabled={!pushConfigQuery.data?.enabled || pushTestMutation.isPending}
                        onClick={() => pushTestMutation.mutate()}
                        className="inline-flex h-9 items-center justify-center gap-2 rounded-lg border px-3 text-sm font-semibold disabled:opacity-50"
                        style={{ borderColor: "var(--border)" }}
                      >
                        <Bell size={14} /> {pushTestMutation.isPending ? "Sending..." : "Send test notification"}
                      </button>
                      {!pushConfigQuery.data?.enabled && <p className="text-xs" style={{ color: "var(--text-muted)" }}>Web Push is not configured on this server.</p>}
                      {savedViewQr && (
                        <div className="rounded-lg border p-3 text-center" style={{ borderColor: "var(--border)" }}>
                          <img src={savedViewQr} alt="Saved view QR link" className="mx-auto h-auto max-w-full rounded" />
                          <p className="mt-2 text-xs font-semibold text-foreground">Mobile read-only saved view</p>
                          <p className="mt-1 break-all text-xs" style={{ color: "var(--text-muted)" }}>{mobileSavedViewLink}</p>
                        </div>
                      )}
                    </>
                  )}
                </div>
              </section>

              <section className="rounded-lg border p-4" style={{ backgroundColor: "var(--card)", borderColor: "var(--border)" }}>
                <h3 className="inline-flex items-center gap-2 font-semibold text-foreground"><Settings size={16} /> Board settings</h3>
                {settingsDraft && (
                  <div className="mt-3 grid gap-2 text-sm">
                    <Field label="Cutoff mode">
                      <select disabled={!canEditSettings} value={settingsDraft.cutoffMode} onChange={(event) => setSettingsDraft({ ...settingsDraft, cutoffMode: event.target.value as ReportingBoardSettings["cutoffMode"] })} className={inputClass()}>
                        <option value="days_back">Days back</option>
                        <option value="fixed_date">Fixed date</option>
                      </select>
                    </Field>
                    <Field label="Default cutoff date"><input disabled={!canEditSettings} type="date" value={settingsDraft.defaultCutoffDate ?? ""} onChange={(event) => setSettingsDraft({ ...settingsDraft, defaultCutoffDate: event.target.value || null })} className={inputClass()} /></Field>
                    <Field label="Days back"><input disabled={!canEditSettings} type="number" value={settingsDraft.daysBack} onChange={(event) => setSettingsDraft({ ...settingsDraft, daysBack: Number(event.target.value) || 0 })} className={inputClass()} /></Field>
                    <Field label="Enabled modality codes"><input disabled={!canEditSettings} value={settingsDraft.enabledModalityCodes.join(",")} onChange={(event) => setSettingsDraft({ ...settingsDraft, enabledModalityCodes: event.target.value.split(",").map((item) => item.trim().toUpperCase()).filter(Boolean) })} className={inputClass()} /></Field>
                    <Field label="Default report status">
                      <select disabled={!canEditSettings} value={settingsDraft.defaultReportStatusFilter} onChange={(event) => setSettingsDraft({ ...settingsDraft, defaultReportStatusFilter: event.target.value as ReportingBoardReportStatus })} className={inputClass()}>
                        {REPORT_STATUS_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
                      </select>
                    </Field>
                    {!canEditSettings && <p style={{ color: "var(--text-muted)" }}>Read-only. Only superadmin can update cutoff settings.</p>}
                    {canEditSettings && <button type="button" onClick={() => updateSettingsMutation.mutate()} className="h-9 rounded-lg bg-teal-600 px-3 text-sm font-semibold text-white">Save settings</button>}
                  </div>
                )}
              </section>
            </>
          )}
        </aside>
      </div>

      <BulkAssignModal
        open={bulkOpen}
        doctors={doctorsQuery.data ?? []}
        modalities={lookupsQuery.data?.modalities ?? []}
        filters={compactFilters(filters)}
        savedView={loadedSavedView}
        onClose={() => setBulkOpen(false)}
        onResult={async (result) => {
          setBulkResult(result);
          await Promise.all([
            queryClient.invalidateQueries({ queryKey: ["doctor", "reporting-board", "cases"] }),
            queryClient.invalidateQueries({ queryKey: ["doctor", "reporting-board", "stats"] }),
          ]);
        }}
      />
      {selectedReassignConfirmOpen && selectedReassignDoctor && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/35 p-4">
          <section className="w-full max-w-md rounded-lg border p-5 shadow-xl" style={{ backgroundColor: "var(--card)", borderColor: "var(--border)" }}>
            <h3 className="text-lg font-semibold text-foreground">Confirm selected reassignment</h3>
            <p className="mt-2 text-sm" style={{ color: "var(--text-muted)" }}>
              Reassign {selectedIds.length} selected cases to {selectedReassignDoctor.displayName}. Already-assigned cases will be reassigned.
            </p>
            <div className="mt-5 flex justify-end gap-2">
              <button type="button" onClick={() => setSelectedReassignConfirmOpen(false)} className="rounded-lg border px-3 py-2 text-sm font-semibold" style={{ borderColor: "var(--border)" }}>Cancel</button>
              <button type="button" disabled={selectedReassignMutation.isPending} onClick={() => selectedReassignMutation.mutate()} className="rounded-lg bg-teal-600 px-3 py-2 text-sm font-semibold text-white disabled:bg-teal-300">
                Confirm reassignment
              </button>
            </div>
          </section>
        </div>
      )}
    </div>
  );
}
