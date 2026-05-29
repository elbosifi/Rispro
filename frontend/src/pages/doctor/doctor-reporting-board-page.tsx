import { useEffect, useMemo, useState } from "react";
import { Link, useParams, useSearchParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Copy, Printer, RefreshCw, Save, Settings, Users } from "lucide-react";
import {
  assignReportingBoardCase,
  bulkAssignNextReportingCases,
  createReportingBoardSavedView,
  fetchAppointmentLookups,
  fetchReportingBoardCases,
  fetchReportingBoardSavedViewByToken,
  fetchReportingBoardSavedViews,
  fetchReportingBoardSettings,
  fetchRosterDoctors,
  updateReportingBoardSavedView,
  updateReportingBoardSettings,
} from "@/lib/api-hooks";
import type {
  DoctorMe,
  DoctorProfile,
  ReportingBoardBulkAssignResult,
  ReportingBoardCaseRow,
  ReportingBoardFilters,
  ReportingBoardNotificationSettings,
  ReportingBoardReportStatus,
  ReportingBoardSavedView,
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

function compactFilters(filters: ReportingBoardFilters): ReportingBoardFilters {
  return Object.fromEntries(Object.entries(filters).filter(([, value]) => value !== "" && value !== null && value !== undefined)) as ReportingBoardFilters;
}

export function buildReportingBoardPrintUrl(input: {
  filters: ReportingBoardFilters;
  savedViewToken?: string | null;
  selectedAppointmentIds?: number[];
  autoprint?: boolean;
}): string {
  const params = new URLSearchParams();
  Object.entries(compactFilters(input.filters)).forEach(([key, value]) => params.set(key, String(value)));
  if (input.savedViewToken) params.set("savedViewToken", input.savedViewToken);
  if (input.selectedAppointmentIds?.length) params.set("appointmentIds", input.selectedAppointmentIds.join(","));
  if (input.autoprint) params.set("autoprint", "1");
  return `/print/reporting-board?${params.toString()}`;
}

function defaultFilters(settings?: ReportingBoardSettings): ReportingBoardFilters {
  return {
    assignmentStatus: "all",
    reportStatus: settings?.defaultReportStatusFilter ?? "required_not_final",
    requiresReport: settings?.defaultRequiresReport ?? true,
    limit: 50,
    offset: 0,
  };
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
  const needsReason = Boolean(row.assignedDoctorId);

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
      <input value={reason} onChange={(event) => setReason(event.target.value)} placeholder={needsReason ? "Reassignment reason" : "Assignment reason"} className="rounded-lg border px-2 py-1 text-xs" />
      <div className="flex gap-2">
        <button
          type="button"
          disabled={!doctorId || (needsReason && !reason.trim())}
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
  filters,
  savedView,
  onClose,
  onResult,
}: {
  open: boolean;
  doctors: DoctorProfile[];
  filters: ReportingBoardFilters;
  savedView: ReportingBoardSavedView | null;
  onClose: () => void;
  onResult: (result: ReportingBoardBulkAssignResult) => void;
}) {
  const [doctorId, setDoctorId] = useState("");
  const [count, setCount] = useState("5");
  const [unassignedOnly, setUnassignedOnly] = useState(true);
  const [reason, setReason] = useState("");
  const [error, setError] = useState("");
  const mutation = useMutation({
    mutationFn: () => bulkAssignNextReportingCases({
      doctorId: Number(doctorId),
      count: Number(count),
      filters: savedView ? null : filters,
      savedViewId: savedView?.id ?? null,
      token: savedView?.token ?? null,
      unassignedOnly,
      reason,
    }),
    onSuccess: (result) => {
      onResult(result);
      onClose();
    },
    onError: (err) => setError(err instanceof Error ? err.message : "Bulk assignment failed."),
  });

  if (!open) return null;

  const invalid = !doctorId || !Number.isInteger(Number(count)) || Number(count) <= 0 || !reason.trim();
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/35 p-4">
      <section className="w-full max-w-lg rounded-lg border p-5 shadow-xl" style={{ backgroundColor: "var(--card)", borderColor: "var(--border)" }}>
        <h3 className="text-lg font-semibold text-foreground">Bulk assign next cases</h3>
        <p className="mt-1 text-sm" style={{ color: "var(--text-muted)" }}>
          Backend will choose the next cases using {savedView ? `saved view "${savedView.name}"` : "current filters"}.
        </p>
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
          <label className="inline-flex items-center gap-2 text-sm">
            <input type="checkbox" checked={unassignedOnly} onChange={(event) => setUnassignedOnly(event.target.checked)} />
            Unassigned only
          </label>
          <Field label="Reason">
            <textarea value={reason} onChange={(event) => setReason(event.target.value)} className="min-h-20 w-full rounded-lg border px-3 py-2 text-sm" />
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
  const [filters, setFilters] = useState<ReportingBoardFilters>({ assignmentStatus: "all", reportStatus: "required_not_final", requiresReport: true, limit: 50, offset: 0 });
  const [loadedSavedView, setLoadedSavedView] = useState<ReportingBoardSavedView | null>(null);
  const [selectedIds, setSelectedIds] = useState<number[]>([]);
  const [saveName, setSaveName] = useState("");
  const [notifications, setNotifications] = useState<ReportingBoardNotificationSettings>(EMPTY_NOTIFICATIONS);
  const [bulkOpen, setBulkOpen] = useState(false);
  const [bulkResult, setBulkResult] = useState<ReportingBoardBulkAssignResult | null>(null);
  const [settingsDraft, setSettingsDraft] = useState<ReportingBoardSettings | null>(null);

  const settingsQuery = useQuery({ queryKey: ["doctor", "reporting-board", "settings"], queryFn: fetchReportingBoardSettings });
  const casesQuery = useQuery({
    queryKey: ["doctor", "reporting-board", "cases", filters],
    queryFn: () => fetchReportingBoardCases(filters),
  });
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
      await queryClient.invalidateQueries({ queryKey: ["doctor", "reporting-board", "saved-views"] });
    },
  });
  const updateViewMutation = useMutation({
    mutationFn: (active = true) => updateReportingBoardSavedView(loadedSavedView!.id, {
      name: saveName.trim() || loadedSavedView!.name,
      filters: compactFilters(filters),
      notificationSettings: notifications,
      active,
    }),
    onSuccess: async (view) => {
      setLoadedSavedView(view.active ? view : null);
      await queryClient.invalidateQueries({ queryKey: ["doctor", "reporting-board", "saved-views"] });
    },
  });
  const updateSettingsMutation = useMutation({
    mutationFn: () => updateReportingBoardSettings(settingsDraft!),
    onSuccess: async () => queryClient.invalidateQueries({ queryKey: ["doctor", "reporting-board", "settings"] }),
  });
  const assignMutation = useMutation({
    mutationFn: (payload: { appointmentId: number; doctorId: number; reason: string }) => assignReportingBoardCase(payload.appointmentId, { doctorId: payload.doctorId, reason: payload.reason }),
    onSuccess: async () => queryClient.invalidateQueries({ queryKey: ["doctor", "reporting-board", "cases"] }),
  });

  const cases = casesQuery.data?.cases ?? [];
  const effectiveFilters = casesQuery.data?.filters ?? filters;
  const canEditSettings = Boolean(me.isSuperAdmin);
  const canManage = isManager(me);
  const assignmentFilterValue = filters.assignedDoctorId ? `doctor:${filters.assignedDoctorId}` : filters.assignmentStatus === "unassigned" ? "unassigned" : "all";
  const printUrl = buildReportingBoardPrintUrl({ filters: effectiveFilters, savedViewToken: loadedSavedView?.token ?? null, selectedAppointmentIds: selectedIds });

  const setFilter = <K extends keyof ReportingBoardFilters>(key: K, value: ReportingBoardFilters[K]) => {
    setFilters((current) => ({ ...current, [key]: value, offset: 0 }));
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.16em]" style={{ color: "var(--text-muted)" }}>Doctor Portal</p>
          <h2 className="mt-1 text-2xl font-semibold text-foreground">Reporting Assignment Board</h2>
          <p className="mt-1 text-sm" style={{ color: "var(--text-muted)" }}>
            Effective cutoff: {effectiveFilters.cutoffDate ?? effectiveFilters.dateFrom ?? "-"} · Cutoff settings are controlled by superadmin.
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

      <section className="grid gap-3 rounded-lg border p-4 md:grid-cols-3 xl:grid-cols-8" style={{ backgroundColor: "var(--card)", borderColor: "var(--border)" }}>
        <Field label="Date from"><input type="date" value={filters.dateFrom ?? ""} onChange={(event) => setFilter("dateFrom", event.target.value || null)} className={inputClass()} /></Field>
        <Field label="Date to"><input type="date" value={filters.dateTo ?? ""} onChange={(event) => setFilter("dateTo", event.target.value || null)} className={inputClass()} /></Field>
        <Field label="Modality">
          <select value={filters.modalityId ?? ""} onChange={(event) => setFilter("modalityId", event.target.value ? Number(event.target.value) : null)} className={inputClass()}>
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
        <Field label="Limit"><input type="number" min={1} max={100} value={filters.limit ?? 50} onChange={(event) => setFilter("limit", Number(event.target.value) || 50)} className={inputClass()} /></Field>
      </section>

      <div className="grid gap-4 xl:grid-cols-[1fr_340px]">
        <section className="space-y-3">
          <div className="rounded-lg border" style={{ borderColor: "var(--border)" }}>
            <div className="overflow-x-auto">
              <table className="min-w-full divide-y text-sm" style={{ borderColor: "var(--border)" }}>
                <thead style={{ backgroundColor: "var(--card)" }}>
                  <tr>
                    {["", "Priority", "Patient", "MRN", "Accession", "Date/time", "Modality", "Exam", "Category", "Assigned doctor", "Report", "Appointment", "Action"].map((header) => (
                      <th key={header} className="px-3 py-2 text-left text-xs font-semibold uppercase" style={{ color: "var(--text-muted)" }}>{header}</th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y" style={{ borderColor: "var(--border)" }}>
                  {cases.map((row) => (
                    <tr key={row.appointmentId}>
                      <td className="px-3 py-2"><input type="checkbox" checked={selectedIds.includes(row.appointmentId)} onChange={(event) => setSelectedIds((current) => event.target.checked ? [...current, row.appointmentId] : current.filter((id) => id !== row.appointmentId))} /></td>
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
          <section className="rounded-lg border p-4" style={{ backgroundColor: "var(--card)", borderColor: "var(--border)" }}>
            <h3 className="font-semibold text-foreground">Saved views</h3>
            <p className="mt-1 text-xs" style={{ color: "var(--text-muted)" }}>In-app notifications are stored with each view.</p>
            <div className="mt-3 space-y-2">
              {(savedViewsQuery.data ?? []).map((view) => (
                <button key={view.id} type="button" onClick={() => {
                  setLoadedSavedView(view);
                  setFilters({ ...defaultFilters(settingsQuery.data), ...view.filters });
                  setNotifications({ ...EMPTY_NOTIFICATIONS, ...view.notificationSettings });
                  setSearchParams({ savedViewToken: view.token });
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
              <button type="button" disabled={!saveName.trim()} onClick={() => saveViewMutation.mutate()} className="inline-flex h-9 items-center justify-center gap-2 rounded-lg bg-teal-600 px-3 text-sm font-semibold text-white disabled:bg-teal-300">
                <Save size={14} /> Save new view
              </button>
              {loadedSavedView && (
                <>
                  <button type="button" onClick={() => updateViewMutation.mutate(true)} className="h-9 rounded-lg border px-3 text-sm font-semibold" style={{ borderColor: "var(--border)" }}>Update current view</button>
                  <button type="button" onClick={() => updateViewMutation.mutate(false)} className="h-9 rounded-lg border px-3 text-sm font-semibold text-red-700" style={{ borderColor: "var(--border)" }}>Deactivate view</button>
                  <button type="button" onClick={() => navigator.clipboard?.writeText(`${window.location.origin}/doctor/reporting-board?savedViewToken=${loadedSavedView.token}`)} className="inline-flex h-9 items-center justify-center gap-2 rounded-lg border px-3 text-sm font-semibold" style={{ borderColor: "var(--border)" }}>
                    <Copy size={14} /> Copy authenticated link
                  </button>
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
        </aside>
      </div>

      <BulkAssignModal
        open={bulkOpen}
        doctors={doctorsQuery.data ?? []}
        filters={compactFilters(filters)}
        savedView={loadedSavedView}
        onClose={() => setBulkOpen(false)}
        onResult={async (result) => {
          setBulkResult(result);
          await queryClient.invalidateQueries({ queryKey: ["doctor", "reporting-board", "cases"] });
        }}
      />
    </div>
  );
}
