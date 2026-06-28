import { useEffect, useMemo, useState } from "react";
import { Link, useParams, useSearchParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import QRCode from "qrcode";
import { AlertTriangle, Bell, CheckCircle2, ChevronLeft, ChevronRight, Clock3, Copy, FilePenLine, Minus, MoreVertical, Printer, QrCode, RefreshCw, Save, Search, Settings, SlidersHorizontal, Users, X } from "lucide-react";
import {
  assignReportingBoardCase,
  bulkAssignNextReportingCases,
  bulkReassignSelectedReportingCases,
  bulkUnassignSelectedReportingCases,
  createReportingBoardSavedView,
  fetchAppointmentLookups,
  fetchReportingBoardCases,
  fetchReportingBoardPushConfig,
  fetchReportingBoardSavedViewByToken,
  fetchReportingBoardSavedViews,
  fetchReportingBoardSettings,
  fetchReportingBoardStats,
  fetchRosterDoctors,
  markReportingBoardCaseDiscontinued,
  sendReportingBoardSavedViewTestPush,
  subscribeReportingBoardSavedViewPush,
  unassignReportingBoardCase,
  updateReportingBoardSavedView,
  updateReportingBoardSettings,
} from "@/lib/api-hooks";
import type {
  DoctorMe,
  DoctorProfile,
  ReportingBoardBulkAssignResult,
  ReportingBoardBulkUnassignResult,
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
  { value: "longest_unassigned", label: "Longest unassigned" },
  { value: "longest_assigned_not_final", label: "Longest assigned" },
  { value: "oldest_completed", label: "Oldest completed" },
];

const UNASSIGN_VALUE = "__UNASSIGN__";

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

export function isWindowsWorkstation(): boolean {
  if (typeof navigator === "undefined") return false;
  const nav = navigator as Navigator & { userAgentData?: { platform?: string } };
  const platform = `${nav.userAgentData?.platform ?? ""} ${navigator.platform ?? ""} ${navigator.userAgent ?? ""}`;
  return /\bWin/i.test(platform);
}

export function buildRadiantPacsTagUrl(tag: string, value: string): string {
  return `radiant:///?n=pstv&v=${encodeURIComponent(tag)}&v=${encodeURIComponent(`"${value}"`)}`;
}

function buildSonicDicomRedirectPath(appointmentId: number, scope: "study" | "patient"): string {
  return `/api/doctor/reporting-board/cases/${appointmentId}/open-sonicdicom?scope=${scope}`;
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
    limit: 100,
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
    longest_unassigned: { asc: "longest unassigned first", desc: "newest unassigned first" },
    longest_assigned_not_final: { asc: "longest assigned first", desc: "newest assigned first" },
    oldest_completed: { asc: "oldest completed first", desc: "newest completed first" },
  };
  const selectedOrder = descriptions[sortBy]?.[direction] ?? descriptions.priority_study_date.asc;
  return `Assignment order: ${filters.pinUrgentToTop === false ? selectedOrder : `STAT/urgent first, then ${selectedOrder}`}.`;
}

function hasValue(value: number | string): boolean {
  return typeof value === "number" && value > 0;
}

function formatDuration(minutes: number | null | undefined): string {
  if (minutes === null || minutes === undefined) return "-";
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 48) return `${hours}h`;
  return `${Math.floor(hours / 24)}d`;
}

function formatTimestamp(value: string | null | undefined): string {
  if (!value) return "-";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString();
}

function StatsTile({
  label,
  value,
  onClick,
  title,
  emphasis = "neutral",
  size = "primary",
}: {
  label: string;
  value: number | string;
  onClick?: () => void;
  title?: string;
  emphasis?: "neutral" | "danger" | "warning" | "success" | "muted";
  size?: "primary" | "secondary";
}) {
  const emphasisClass = {
    neutral: "",
    danger: "border-red-300 bg-red-50 text-red-700",
    warning: "border-amber-300 bg-amber-50 text-amber-800",
    success: "border-emerald-200 bg-emerald-50 text-emerald-700",
    muted: "bg-zinc-50 text-zinc-500",
  }[emphasis];
  const content = (
    <>
      <span className="text-xs font-semibold uppercase" style={{ color: emphasis === "neutral" ? "var(--text-muted)" : undefined }}>{label}</span>
      <span className={size === "primary" ? "mt-1 text-2xl font-semibold" : "mt-1 text-lg font-semibold"}>{value}</span>
    </>
  );
  const className = `${size === "primary" ? "min-h-20" : "min-h-16"} rounded-lg border px-3 py-2 text-left ${emphasisClass}`;
  const style = { backgroundColor: "var(--card)", borderColor: "var(--border)" };
  const mergedStyle = emphasis === "neutral" ? style : undefined;
  if (!onClick) return <div className={className} style={mergedStyle} title={title}>{content}</div>;
  return <button type="button" onClick={onClick} className={`${className} transition hover:border-teal-500 hover:shadow-sm focus:outline-none focus:ring-2 focus:ring-teal-500`} style={mergedStyle} title={title}>{content}</button>;
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
  const unassigned = rows.find((row) => row.doctorId === null)?.total ?? 0;
  const highestAssigned = useMemo(
    () => rows.filter((row) => row.doctorId !== null).sort((left, right) => right.total - left.total)[0] ?? null,
    [rows]
  );
  return (
    <section className="rounded-lg border" style={{ backgroundColor: "var(--card)", borderColor: "var(--border)" }}>
      <button type="button" onClick={onToggle} className="flex w-full items-center justify-between px-4 py-3 text-left font-semibold text-foreground">
        <span>
          Doctor workload: Unassigned {unassigned} | Highest assigned: {highestAssigned ? `${highestAssigned.doctorName} ${highestAssigned.total}` : "-"}
        </span>
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

function abnormalPriorityLabel(row: ReportingBoardCaseRow): string | null {
  const normalized = String(row.reportingPriorityCode || "").trim().toLowerCase();
  if (normalized !== "stat" && normalized !== "urgent") return null;
  return row.reportingPriorityName || normalized.toUpperCase();
}

function requiredReportNotFinal(row: ReportingBoardCaseRow): boolean {
  return row.requiresReport && row.reportStatus !== "final";
}

function overdue(row: ReportingBoardCaseRow): boolean {
  return requiredReportNotFinal(row) && row.bookingDate < new Date().toISOString().slice(0, 10);
}

function rowState(row: ReportingBoardCaseRow): "critical" | "orange" | "amber" | "normal" {
  const priority = String(row.reportingPriorityCode || "").trim().toLowerCase();
  if (priority === "stat" || priority === "urgent" || overdue(row)) return "critical";
  if (row.reportStatus === "study_not_found" || row.reportStatus === "unavailable") return "orange";
  if (requiredReportNotFinal(row)) return "amber";
  return "normal";
}

function reportingRowClass(row: ReportingBoardCaseRow, selected: boolean): string {
  if (selected) return "border-l-4 border-teal-600 bg-teal-50 ring-2 ring-inset ring-teal-600 transition hover:bg-teal-100";
  const state = rowState(row);
  if (state === "critical") return "border-l-4 border-red-400 bg-red-50 transition hover:bg-red-100/70";
  if (state === "orange") return "border-l-4 border-orange-400 bg-orange-50 transition hover:bg-orange-100/70";
  if (state === "amber") return "border-l-4 border-amber-400 bg-amber-50 transition hover:bg-amber-100/70";
  return "border-l-4 border-transparent transition hover:bg-slate-50";
}

function reportStatusView(status: ReportingBoardCaseRow["reportStatus"]) {
  const views = {
    final: { label: "Final report", text: "", icon: CheckCircle2, className: "border-emerald-200 bg-white text-emerald-700" },
    draft: { label: "Draft report", text: "Draft", icon: FilePenLine, className: "border-amber-300 bg-white text-amber-800" },
    no_report: { label: "No report required", text: "-", icon: Minus, className: "border-slate-200 bg-white text-slate-500" },
    study_not_found: { label: "Study not found in PACS", text: "Missing", icon: AlertTriangle, className: "border-orange-300 bg-white text-orange-700" },
    unavailable: { label: "Report status unavailable", text: "PACS", icon: AlertTriangle, className: "border-orange-300 bg-white text-orange-700" },
  };
  return views[status];
}

function rowStatusLabel(row: ReportingBoardCaseRow): string {
  const labels = [
    abnormalPriorityLabel(row),
    overdue(row) ? "Overdue" : null,
    reportStatusView(row.reportStatus).label,
    row.appointmentStatus !== "completed" ? `Appointment ${labelStatus(row.appointmentStatus)}` : null,
  ].filter(Boolean);
  return labels.join(", ");
}

function rowDetailsTitle(row: ReportingBoardCaseRow): string {
  return [
    `Patient: ${patientName(row)}`,
    `MRN: ${row.patientMrn ?? "-"}`,
    `Accession: ${row.accessionNumber}`,
    `Study: ${row.modalityCode}${row.examTypeName ? ` - ${row.examTypeName}` : ""}`,
    `Category: ${labelStatus(row.caseCategory)}`,
    `Assigned doctor: ${row.assignedDoctorName ?? "Unassigned"}`,
    `Report: ${reportStatusView(row.reportStatus).label}`,
    `Appointment: ${labelStatus(row.appointmentStatus)}`,
    `Completed at: ${formatTimestamp(row.completedAt)}`,
    `Current assigned at: ${formatTimestamp(row.currentAssignedAt)}`,
    `First assigned at: ${formatTimestamp(row.firstAssignedAt)}`,
    `Report final at: ${formatTimestamp(row.reportFinalAt)}`,
    `Report status checked at: ${formatTimestamp(row.reportStatusCheckedAt)}`,
  ].join("\n");
}

function PriorityBadge({ row }: { row: ReportingBoardCaseRow }) {
  const label = abnormalPriorityLabel(row);
  if (!label) return null;
  return (
    <span className="inline-flex items-center rounded-full border border-red-300 bg-white/80 px-1.5 py-0.5 text-[11px] font-semibold uppercase text-red-700" title={`Priority ${label}`}>
      {label}
    </span>
  );
}

function categoryLabel(category: string): string {
  if (category === "oncology") return "Onc";
  if (category === "non_oncology") return "Non-onc";
  return labelStatus(category);
}

function IdsCell({ row }: { row: ReportingBoardCaseRow }) {
  return (
    <div className="leading-tight" title={`MRN ${row.patientMrn ?? "-"}; Accession ${row.accessionNumber}`}>
      <div className="font-medium text-foreground">{row.patientMrn ?? "-"}</div>
      <div className="mt-0.5 text-xs" style={{ color: "var(--text-muted)" }}>{row.accessionNumber}</div>
    </div>
  );
}

function StudyCell({ row, showCategoryMarker }: { row: ReportingBoardCaseRow; showCategoryMarker: boolean }) {
  const studyLabel = `${row.modalityCode}${row.examTypeName ? ` · ${row.examTypeName}` : ""}`;
  return (
    <div className="leading-tight" title={`Modality ${row.modalityName || row.modalityCode}; Exam ${row.examTypeName ?? "-"}; Category ${labelStatus(row.caseCategory)}`}>
      <div className="font-medium text-foreground">{studyLabel}</div>
      {showCategoryMarker && (
        <span className="mt-1 inline-flex rounded-full border border-slate-200 bg-white/80 px-1.5 py-0.5 text-[11px] font-semibold uppercase text-slate-600">
          {categoryLabel(row.caseCategory)}
        </span>
      )}
    </div>
  );
}

function CompactStatusCell({ row }: { row: ReportingBoardCaseRow }) {
  const view = reportStatusView(row.reportStatus);
  const Icon = view.icon;
  const appointmentLabel = row.appointmentStatus !== "completed" ? labelStatus(row.appointmentStatus) : null;
  return (
    <div className="flex max-w-40 flex-wrap items-center gap-1" title={rowStatusLabel(row)}>
      <span aria-label={view.label} title={view.label} className={`inline-flex h-7 min-w-7 items-center justify-center gap-1 rounded-full border px-1.5 text-xs font-semibold ${view.className}`}>
        <Icon size={14} aria-hidden="true" />
        {view.text ? <span>{view.text}</span> : <span className="sr-only">{view.label}</span>}
      </span>
      {appointmentLabel && (
        <span className="inline-flex items-center gap-1 rounded-full border border-slate-200 bg-white/80 px-1.5 py-0.5 text-[11px] font-semibold text-slate-600" title={`Appointment ${appointmentLabel}`}>
          <Clock3 size={12} aria-hidden="true" />
          {appointmentLabel}
        </span>
      )}
    </div>
  );
}

function agingTatLabel(row: ReportingBoardCaseRow): string {
  if (row.dueAt && requiredReportNotFinal(row) && new Date(row.dueAt).getTime() < Date.now()) {
    const overdueMinutes = Math.floor((Date.now() - new Date(row.dueAt).getTime()) / 60000);
    return `Overdue ${formatDuration(overdueMinutes)}`;
  }
  if (row.assignedToFinalMinutes !== null) return `A→F ${formatDuration(row.assignedToFinalMinutes)}`;
  if (row.currentAssignmentAgeMinutes !== null) return `Assigned ${formatDuration(row.currentAssignmentAgeMinutes)}`;
  if (row.completedUnassignedAgeMinutes !== null) return `Unassigned ${formatDuration(row.completedUnassignedAgeMinutes)}`;
  if (row.completedToAssignedMinutes !== null) return `C→A ${formatDuration(row.completedToAssignedMinutes)}`;
  return "-";
}

function agingTatTitle(row: ReportingBoardCaseRow): string {
  return [
    `Completed: ${formatTimestamp(row.completedAt)}`,
    `Current assigned: ${formatTimestamp(row.currentAssignedAt)}`,
    `First assigned: ${formatTimestamp(row.firstAssignedAt)}`,
    `Final report: ${formatTimestamp(row.reportFinalAt)}`,
    `Status checked: ${formatTimestamp(row.reportStatusCheckedAt)}`,
    `C to A: ${formatDuration(row.completedToAssignedMinutes)}`,
    `A to F: ${formatDuration(row.assignedToFinalMinutes)}`,
    `C to F: ${formatDuration(row.completedToFinalMinutes)}`,
  ].join("\n");
}

function AgingTatCell({ row }: { row: ReportingBoardCaseRow }) {
  const label = agingTatLabel(row);
  const muted = label === "-";
  return (
    <span className={`whitespace-nowrap text-xs font-semibold ${muted ? "text-slate-400" : "text-slate-700"}`} title={agingTatTitle(row)}>
      {label}
    </span>
  );
}

function AssignmentEditor({
  row,
  doctors,
  onAssign,
  onUnassign,
}: {
  row: ReportingBoardCaseRow;
  doctors: DoctorProfile[];
  onAssign: (appointmentId: number, doctorId: number, reason: string) => void;
  onUnassign: (appointmentId: number, reason: string) => Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const [doctorId, setDoctorId] = useState(row.assignedDoctorId ? String(row.assignedDoctorId) : "");
  const [reason, setReason] = useState("");
  const returningToPool = doctorId === UNASSIGN_VALUE;
  const trimmedReason = reason.trim();

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
        {row.assignedDoctorId && <option value={UNASSIGN_VALUE}>Return to waiting pool</option>}
        {row.assignedDoctorId && <option disabled>────────</option>}
        {doctors.map((doctor) => <option key={doctor.id} value={doctor.id}>{doctor.displayName}</option>)}
      </select>
      {returningToPool && (
        <p className="rounded-lg border border-amber-200 bg-amber-50 px-2 py-1 text-xs text-amber-800">
          This removes the assigned doctor and returns the case to the unassigned pool.
        </p>
      )}
      <input
        value={reason}
        onChange={(event) => setReason(event.target.value)}
        placeholder={returningToPool ? "Reason for returning to waiting pool" : "Notes for doctor"}
        className="rounded-lg border px-2 py-1 text-xs"
      />
      <div className="flex gap-2">
        <button
          type="button"
          disabled={!doctorId || (returningToPool && !trimmedReason)}
          onClick={async () => {
            if (returningToPool) await onUnassign(row.appointmentId, trimmedReason);
            else onAssign(row.appointmentId, Number(doctorId), reason);
            setOpen(false);
            setReason("");
          }}
          className="rounded bg-teal-600 px-2 py-1 text-xs font-semibold text-white disabled:bg-teal-300"
        >
          {returningToPool ? "Confirm return to waiting pool" : "Save"}
        </button>
        <button type="button" onClick={() => setOpen(false)} className="rounded border px-2 py-1 text-xs">Cancel</button>
      </div>
    </div>
  );
}

function RowActionMenu({
  row,
  doctors,
  canManage,
  onAssign,
  onUnassign,
  onDiscontinue,
}: {
  row: ReportingBoardCaseRow;
  doctors: DoctorProfile[];
  canManage: boolean;
  onAssign: (appointmentId: number, doctorId: number, reason: string) => void;
  onUnassign: (appointmentId: number, reason: string) => Promise<void>;
  onDiscontinue: (row: ReportingBoardCaseRow) => void;
}) {
  const [open, setOpen] = useState(false);
  const [copyMessage, setCopyMessage] = useState("");
  const actionUnavailable = row.exclusionReason ? labelStatus(row.exclusionReason) : "No assignment action";
  const accessionNumber = String(row.accessionNumber || "").trim();
  const patientMrn = String(row.patientMrn || "").trim();
  const showRadiantActions = isWindowsWorkstation();
  const copyAccession = async () => {
    if (!accessionNumber) return;
    try {
      await navigator.clipboard?.writeText(accessionNumber);
      setCopyMessage("Accession copied.");
    } catch {
      setCopyMessage("Could not copy accession.");
    }
  };

  return (
    <div className="relative flex justify-end">
      <button
        type="button"
        onClick={() => setOpen((current) => !current)}
        className="inline-flex h-8 w-8 items-center justify-center rounded-lg border text-foreground"
        style={{ borderColor: "var(--border)" }}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={`Open actions for ${row.accessionNumber}`}
        title="Actions"
      >
        <MoreVertical size={16} aria-hidden="true" />
      </button>
      {open && (
        <div
          role="menu"
          className="absolute right-0 top-9 z-40 min-w-64 rounded-lg border p-2 text-left shadow-lg"
          style={{ backgroundColor: "var(--card)", borderColor: "var(--border)" }}
        >
          {accessionNumber ? (
            <a
              role="menuitem"
              href={buildSonicDicomRedirectPath(row.appointmentId, "study")}
              target="_blank"
              rel="noopener noreferrer"
              className="block rounded-md px-2 py-1.5 text-xs font-semibold text-foreground hover:bg-slate-50"
            >
              Open this study in SonicDICOM
            </a>
          ) : (
            <button type="button" role="menuitem" disabled title="Accession number missing" className="block w-full rounded-md px-2 py-1.5 text-left text-xs font-semibold text-foreground opacity-50">
              Open this study in SonicDICOM
            </button>
          )}
          {patientMrn ? (
            <a
              role="menuitem"
              href={buildSonicDicomRedirectPath(row.appointmentId, "patient")}
              target="_blank"
              rel="noopener noreferrer"
              className="mt-1 block rounded-md px-2 py-1.5 text-xs font-semibold text-foreground hover:bg-slate-50"
            >
              Open patient list in SonicDICOM
            </a>
          ) : (
            <button type="button" role="menuitem" disabled title="Patient ID/MRN missing" className="mt-1 block w-full rounded-md px-2 py-1.5 text-left text-xs font-semibold text-foreground opacity-50">
              Open patient list in SonicDICOM
            </button>
          )}
          {showRadiantActions && accessionNumber && (
            <a role="menuitem" href={buildRadiantPacsTagUrl("00080050", accessionNumber)} className="mt-1 block rounded-md px-2 py-1.5 text-xs font-semibold text-foreground hover:bg-slate-50">
              Open this study in RadiAnt
            </a>
          )}
          {showRadiantActions && !accessionNumber && (
            <button type="button" role="menuitem" disabled title="Accession number missing" className="mt-1 block w-full rounded-md px-2 py-1.5 text-left text-xs font-semibold text-foreground opacity-50">
              Open this study in RadiAnt
            </button>
          )}
          {showRadiantActions && patientMrn && (
            <a role="menuitem" href={buildRadiantPacsTagUrl("00100020", patientMrn)} className="mt-1 block rounded-md px-2 py-1.5 text-xs font-semibold text-foreground hover:bg-slate-50">
              Open patient studies in RadiAnt
            </a>
          )}
          {showRadiantActions && !patientMrn && (
            <button type="button" role="menuitem" disabled title="Patient ID/MRN missing" className="mt-1 block w-full rounded-md px-2 py-1.5 text-left text-xs font-semibold text-foreground opacity-50">
              Open patient studies in RadiAnt
            </button>
          )}
          <button
            type="button"
            role="menuitem"
            disabled={!accessionNumber}
            onClick={copyAccession}
            className="mt-1 block w-full rounded-md px-2 py-1.5 text-left text-xs font-semibold text-foreground hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
          >
            Copy accession number
          </button>
          {copyMessage && <p className="px-2 pt-1 text-[11px]" style={{ color: "var(--text-muted)" }}>{copyMessage}</p>}
          <Link
            role="menuitem"
            to={`/registrations?appointmentId=${row.appointmentId}&patientId=${row.patientId}`}
            className="mt-2 block rounded-md border-t px-2 py-1.5 pt-2 text-xs font-semibold text-foreground hover:bg-slate-50"
            style={{ borderColor: "var(--border)" }}
          >
            View appointment
          </Link>
          {canManage && (
            <button
              type="button"
              role="menuitem"
              onClick={() => {
                setOpen(false);
                onDiscontinue(row);
              }}
              className="mt-1 block w-full rounded-md px-2 py-1.5 text-left text-xs font-semibold text-red-600 hover:bg-red-50"
            >
              Mark study as discontinued
            </button>
          )}
          <div className="mt-2 border-t pt-2" style={{ borderColor: "var(--border)" }}>
            {canManage && row.canAssign ? (
              <AssignmentEditor
                row={row}
                doctors={doctors}
                onAssign={onAssign}
                onUnassign={onUnassign}
              />
            ) : (
              <p className="px-2 py-1.5 text-xs" style={{ color: "var(--text-muted)" }}>{actionUnavailable}</p>
            )}
          </div>
        </div>
      )}
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
        <h3 className="text-lg font-semibold text-foreground">Auto-assign next cases</h3>
        <p className="mt-1 text-sm" style={{ color: "var(--text-muted)" }}>
          The system will choose the next eligible cases using the current filters and assignment order{savedView ? ` from saved view "${savedView.name}"` : ""}.
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

function BoardSettingsModal({
  open,
  settingsDraft,
  canEditSettings,
  saving,
  onClose,
  onChange,
  onSave,
}: {
  open: boolean;
  settingsDraft: ReportingBoardSettings | null;
  canEditSettings: boolean;
  saving: boolean;
  onClose: () => void;
  onChange: (settings: ReportingBoardSettings) => void;
  onSave: () => void;
}) {
  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/35 p-4">
      <section className="w-full max-w-lg rounded-lg border p-5 shadow-xl" style={{ backgroundColor: "var(--card)", borderColor: "var(--border)" }}>
        <div className="flex items-start justify-between gap-3">
          <div>
            <h3 className="inline-flex items-center gap-2 text-lg font-semibold text-foreground"><Settings size={18} /> Board settings</h3>
            <p className="mt-1 text-sm" style={{ color: "var(--text-muted)" }}>Default cutoff and reporting filters for this board.</p>
          </div>
          <button type="button" onClick={onClose} className="rounded-lg border p-2" style={{ borderColor: "var(--border)" }} aria-label="Close board settings">
            <X size={16} />
          </button>
        </div>
        {settingsDraft && (
          <div className="mt-4 grid gap-3 text-sm">
            <Field label="Cutoff mode">
              <select disabled={!canEditSettings} value={settingsDraft.cutoffMode} onChange={(event) => onChange({ ...settingsDraft, cutoffMode: event.target.value as ReportingBoardSettings["cutoffMode"] })} className={inputClass()}>
                <option value="days_back">Days back</option>
                <option value="fixed_date">Fixed date</option>
              </select>
            </Field>
            <Field label="Default cutoff date"><input disabled={!canEditSettings} type="date" value={settingsDraft.defaultCutoffDate ?? ""} onChange={(event) => onChange({ ...settingsDraft, defaultCutoffDate: event.target.value || null })} className={inputClass()} /></Field>
            <Field label="Days back"><input disabled={!canEditSettings} type="number" value={settingsDraft.daysBack} onChange={(event) => onChange({ ...settingsDraft, daysBack: Number(event.target.value) || 0 })} className={inputClass()} /></Field>
            <Field label="Enabled modality codes"><input disabled={!canEditSettings} value={settingsDraft.enabledModalityCodes.join(",")} onChange={(event) => onChange({ ...settingsDraft, enabledModalityCodes: event.target.value.split(",").map((item) => item.trim().toUpperCase()).filter(Boolean) })} className={inputClass()} /></Field>
            <Field label="Default report status">
              <select disabled={!canEditSettings} value={settingsDraft.defaultReportStatusFilter} onChange={(event) => onChange({ ...settingsDraft, defaultReportStatusFilter: event.target.value as ReportingBoardReportStatus })} className={inputClass()}>
                {REPORT_STATUS_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
              </select>
            </Field>
            {!canEditSettings && <p style={{ color: "var(--text-muted)" }}>Read-only. Only superadmin can update cutoff settings.</p>}
            <div className="mt-2 flex justify-end gap-2">
              <button type="button" onClick={onClose} className="h-9 rounded-lg border px-3 text-sm font-semibold" style={{ borderColor: "var(--border)" }}>Close</button>
              {canEditSettings && <button type="button" disabled={saving} onClick={onSave} className="h-9 rounded-lg bg-teal-600 px-3 text-sm font-semibold text-white disabled:bg-teal-300">Save settings</button>}
            </div>
          </div>
        )}
      </section>
    </div>
  );
}

export function DoctorReportingBoardPage({ me }: { me: DoctorMe }) {
  const queryClient = useQueryClient();
  const [searchParams, setSearchParams] = useSearchParams();
  const params = useParams();
  const savedViewToken = params.token ?? searchParams.get("savedViewToken");
  const [filters, setFilters] = useState<ReportingBoardFilters>({ assignmentStatus: "all", reportStatus: "required_not_final", requiresReport: true, sortBy: "priority_study_date", sortDirection: "asc", pinUrgentToTop: true, limit: 100, offset: 0 });
  const [loadedSavedView, setLoadedSavedView] = useState<ReportingBoardSavedView | null>(null);
  const [selectedIds, setSelectedIds] = useState<number[]>([]);
  const [saveName, setSaveName] = useState("");
  const [notifications, setNotifications] = useState<ReportingBoardNotificationSettings>(EMPTY_NOTIFICATIONS);
  const [bulkOpen, setBulkOpen] = useState(false);
  const [bulkResult, setBulkResult] = useState<ReportingBoardBulkAssignResult | ReportingBoardBulkUnassignResult | null>(null);
  const [selectedReassignDoctorId, setSelectedReassignDoctorId] = useState("");
  const [selectedReassignReason, setSelectedReassignReason] = useState("");
  const [selectedReassignConfirmOpen, setSelectedReassignConfirmOpen] = useState(false);
  const [selectedUnassignReason, setSelectedUnassignReason] = useState("");
  const [selectedUnassignConfirmOpen, setSelectedUnassignConfirmOpen] = useState(false);
  const [priorityShortcutOpen, setPriorityShortcutOpen] = useState(false);
  const [doctorStatsOpen, setDoctorStatsOpen] = useState(false);
  const [settingsDraft, setSettingsDraft] = useState<ReportingBoardSettings | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [advancedFiltersOpen, setAdvancedFiltersOpen] = useState(false);
  const [searchText, setSearchText] = useState("");
  const [savedViewsOpen, setSavedViewsOpen] = useState(true);
  const [savedViewMessage, setSavedViewMessage] = useState<{ tone: "success" | "error"; text: string } | null>(null);
  const [boardActionMessage, setBoardActionMessage] = useState<{ tone: "success" | "error"; text: string; detail?: string | null } | null>(null);
  const [savedViewQr, setSavedViewQr] = useState<string | null>(null);
  const [boardRefreshing, setBoardRefreshing] = useState(false);
  const [discontinueTarget, setDiscontinueTarget] = useState<ReportingBoardCaseRow | null>(null);
  const [discontinueReason, setDiscontinueReason] = useState("");

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

  useEffect(() => {
    setSearchText(filters.q ?? "");
  }, [filters.q]);

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
  const unassignMutation = useMutation({
    mutationFn: (payload: { appointmentId: number; reason: string }) => unassignReportingBoardCase(payload.appointmentId, { reason: payload.reason }),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["doctor", "reporting-board", "cases"] }),
        queryClient.invalidateQueries({ queryKey: ["doctor", "reporting-board", "stats"] }),
      ]);
    },
  });
  const discontinueMutation = useMutation({
    mutationFn: () => markReportingBoardCaseDiscontinued(discontinueTarget!.appointmentId, { reason: discontinueReason.trim() }),
    onSuccess: async (result) => {
      const discontinuedId = discontinueTarget?.appointmentId ?? null;
      setDiscontinueTarget(null);
      setDiscontinueReason("");
      if (discontinuedId !== null) setSelectedIds((current) => current.filter((id) => id !== discontinuedId));
      setBoardActionMessage({
        tone: "success",
        text: "Study marked as discontinued and removed from reporting pool.",
        detail: result.autoCompletionDisabledMessage ?? null,
      });
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["doctor", "reporting-board", "cases"] }),
        queryClient.invalidateQueries({ queryKey: ["doctor", "reporting-board", "stats"] }),
      ]);
    },
    onError: (err) => setBoardActionMessage({ tone: "error", text: err instanceof Error ? err.message : "Could not mark study as discontinued." }),
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
  const selectedUnassignMutation = useMutation({
    mutationFn: () => bulkUnassignSelectedReportingCases({
      appointmentIds: selectedIds,
      reason: selectedUnassignReason.trim(),
    }),
    onSuccess: async (result) => {
      setBulkResult(result);
      if (result.unassignedCount > 0) setSelectedIds([]);
      setSelectedUnassignReason("");
      setSelectedUnassignConfirmOpen(false);
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
  const selectedUnassignDisabled = !canManage || selectedIds.length === 0 || selectedUnassignMutation.isPending;
  const advancedFilterCount = [
    Boolean(filters.caseCategory),
    Boolean(filters.priorityCode),
    (filters.sortDirection ?? "asc") !== "asc",
    filters.pinUrgentToTop === false,
    (filters.limit ?? 100) !== 100,
  ].filter(Boolean).length;
  const visibleCategoryCount = new Set(cases.map((row) => row.caseCategory).filter(Boolean)).size;
  const showCategoryMarker = visibleCategoryCount > 1;
  const activeAssignedDoctorId = filters.assignedDoctorId ?? effectiveFilters.assignedDoctorId ?? null;
  const showAssignedDoctorColumn = !activeAssignedDoctorId;

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

  const applySearch = () => {
    setFilter("q", searchText.trim() || null);
  };

  const clearSearch = () => {
    setSearchText("");
    setFilter("q", null);
  };

  const refreshBoard = async () => {
    setBoardRefreshing(true);
    try {
      await Promise.all([
        casesQuery.refetch(),
        statsQuery.refetch(),
      ]);
    } finally {
      setBoardRefreshing(false);
    }
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
            <Printer size={16} /> {selectedIds.length > 0 ? `Print handoff (${selectedIds.length} selected)` : "Print handoff"}
          </Link>
          <button type="button" onClick={refreshBoard} disabled={boardRefreshing} className="inline-flex h-10 items-center gap-2 rounded-lg border px-3 text-sm font-semibold disabled:cursor-not-allowed disabled:opacity-60" style={{ borderColor: "var(--border)" }}>
            <RefreshCw size={16} className={boardRefreshing ? "animate-spin" : undefined} /> {boardRefreshing ? "Refreshing..." : "Refresh"}
          </button>
          <button type="button" onClick={() => setSettingsOpen(true)} className="inline-flex h-10 items-center gap-2 rounded-lg border px-3 text-sm font-semibold" style={{ borderColor: "var(--border)" }}>
            <Settings size={16} /> Board settings
          </button>
          {canManage && (
            <button type="button" onClick={() => setBulkOpen(true)} className="inline-flex h-10 items-center gap-2 rounded-lg bg-teal-600 px-3 text-sm font-semibold text-white">
              <Users size={16} /> Auto-assign next cases
            </button>
          )}
        </div>
      </div>
      {boardActionMessage && (
        <div
          className={`rounded-lg border px-3 py-2 text-sm ${boardActionMessage.tone === "error" ? "text-red-700" : "text-emerald-700"}`}
          style={{ borderColor: "var(--border)", backgroundColor: "var(--card)" }}
        >
          <p className="font-semibold">{boardActionMessage.text}</p>
          {boardActionMessage.detail && <p className="mt-1 text-xs">{boardActionMessage.detail}</p>}
        </div>
      )}

      <section className="space-y-3 rounded-lg border p-4" style={{ backgroundColor: "var(--card)", borderColor: "var(--border)" }}>
        <div className="grid gap-3 md:grid-cols-3 xl:grid-cols-7">
          <Field label="Search">
            <div className="relative">
              <Search size={16} className="absolute left-3 top-3" style={{ color: "var(--text-muted)" }} />
              <input
                value={searchText}
                onChange={(event) => setSearchText(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") applySearch();
                }}
                placeholder="Search MRN / accession / patient / exam"
                className={`${inputClass()} pl-9 pr-9`}
              />
              {filters.q && (
                <button type="button" onClick={clearSearch} className="absolute right-2 top-2 rounded p-1" aria-label="Clear search">
                  <X size={16} />
                </button>
              )}
            </div>
          </Field>
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
                if (value === "unassigned") setFilters((current) => ({ ...current, assignmentStatus: "unassigned", assignedDoctorId: null, offset: 0 }));
                else if (value.startsWith("doctor:")) setFilters((current) => ({ ...current, assignmentStatus: "assigned", assignedDoctorId: Number(value.slice(7)), offset: 0 }));
                else setFilters((current) => ({ ...current, assignmentStatus: "all", assignedDoctorId: null, offset: 0 }));
              }}
              className={inputClass()}
            >
              <option value="all">All</option>
              <option value="unassigned">Unassigned</option>
              {(doctorsQuery.data ?? []).map((doctor) => <option key={doctor.id} value={`doctor:${doctor.id}`}>{doctor.displayName}</option>)}
            </select>
          </Field>
          <Field label="Report status">
            <select value={filters.reportStatus ?? "required_not_final"} onChange={(event) => setFilter("reportStatus", event.target.value as ReportingBoardReportStatus)} className={inputClass()}>
              {REPORT_STATUS_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
            </select>
          </Field>
          <Field label="Sort by">
            <select value={filters.sortBy ?? "priority_study_date"} onChange={(event) => setFilter("sortBy", event.target.value as ReportingBoardSortBy)} className={inputClass()}>
              {SORT_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
            </select>
          </Field>
        </div>
        <button type="button" onClick={() => setAdvancedFiltersOpen((current) => !current)} className="inline-flex h-9 items-center gap-2 rounded-lg border px-3 text-sm font-semibold" style={{ borderColor: "var(--border)" }}>
          <SlidersHorizontal size={16} /> Advanced filters {advancedFilterCount > 0 && <span className="rounded-full bg-teal-600 px-2 py-0.5 text-xs text-white">{advancedFilterCount}</span>}
        </button>
        {advancedFiltersOpen && (
          <div className="grid gap-3 border-t pt-3 md:grid-cols-3 xl:grid-cols-5" style={{ borderColor: "var(--border)" }}>
            <Field label="Category">
              <select value={filters.caseCategory ?? ""} onChange={(event) => setFilter("caseCategory", event.target.value || null)} className={inputClass()}>
                <option value="">All</option>
                <option value="oncology">Oncology</option>
                <option value="non_oncology">Non-oncology</option>
              </select>
            </Field>
            <Field label="Priority">
              <select value={filters.priorityCode ?? ""} onChange={(event) => setFilter("priorityCode", event.target.value || null)} className={inputClass()}>
                <option value="">All</option>
                {(lookupsQuery.data?.priorities ?? []).map((priority) => <option key={priority.id} value={priority.code}>{priority.nameEn}</option>)}
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
            <Field label="Limit">
              <input type="number" min={1} max={300} value={filters.limit ?? 100} onChange={(event) => setFilter("limit", Number(event.target.value) || 100)} className={inputClass()} />
              <span className="text-xs" style={{ color: "var(--text-muted)" }}>Shows up to 300 cases. Use filters for larger lists.</span>
            </Field>
          </div>
        )}
      </section>

      <section className="space-y-3">
        {statsQuery.isLoading && <p className="text-sm" style={{ color: "var(--text-muted)" }}>Loading board statistics...</p>}
        {statsQuery.isError && (
          <p className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
            {statsQuery.error instanceof Error ? statsQuery.error.message : "Could not load board statistics."}
          </p>
        )}
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-6 xl:grid-cols-12">
          <StatsTile label="Total" value={statsSummary?.total ?? "-"} />
          <StatsTile label="Unassigned" value={statsSummary?.unassigned ?? "-"} onClick={() => setAssignmentShortcut("unassigned")} />
          <StatsTile label="Assigned" value={statsSummary?.assigned ?? "-"} onClick={() => setAssignmentShortcut("assigned")} />
          <div className="relative">
            <StatsTile label="STAT/Urgent" value={statsSummary?.statOrUrgent ?? "-"} emphasis={hasValue(statsSummary?.statOrUrgent ?? "-") ? "danger" : "neutral"} onClick={() => setPriorityShortcutOpen((current) => !current)} />
            {priorityShortcutOpen && (
              <div className="absolute left-0 top-full z-20 mt-1 flex gap-1 rounded-lg border p-2 shadow-lg" style={{ backgroundColor: "var(--card)", borderColor: "var(--border)" }}>
                <button type="button" onClick={() => setPriorityShortcut("stat")} className="rounded-lg border px-3 py-1.5 text-sm font-semibold" style={{ borderColor: "var(--border)" }}>STAT</button>
                <button type="button" onClick={() => setPriorityShortcut("urgent")} className="rounded-lg border px-3 py-1.5 text-sm font-semibold" style={{ borderColor: "var(--border)" }}>Urgent</button>
              </div>
            )}
          </div>
          <StatsTile label="Required not final" value={statsSummary?.requiredNotFinal ?? "-"} />
          <StatsTile label="Overdue" value={statsSummary?.overdue ?? "-"} emphasis={hasValue(statsSummary?.overdue ?? "-") ? "danger" : "neutral"} title="Informational. Overdue filtering is not part of the current board filter contract." />
          <StatsTile label="Median C→A" value={formatDuration(statsSummary?.medianCompletedToAssignedMinutes)} size="secondary" />
          <StatsTile label="Longest assigned" value={formatDuration(statsSummary?.longestActiveAssignmentAgeMinutes)} size="secondary" />
          <StatsTile label="Completed unassigned" value={statsSummary?.completedUnassigned ?? "-"} emphasis={hasValue(statsSummary?.completedUnassigned ?? "-") ? "warning" : "neutral"} size="secondary" />
          {statsSummary?.medianAssignedToFinalMinutes !== null && statsSummary?.medianAssignedToFinalMinutes !== undefined && (
            <StatsTile label="Median A→F" value={formatDuration(statsSummary.medianAssignedToFinalMinutes)} size="secondary" />
          )}
          {statsSummary?.p90AssignedToFinalMinutes !== null && statsSummary?.p90AssignedToFinalMinutes !== undefined && (
            <StatsTile label="P90 A→F" value={formatDuration(statsSummary.p90AssignedToFinalMinutes)} size="secondary" />
          )}
          <StatsTile label="Draft" value={statsSummary?.draft ?? "-"} emphasis={hasValue(statsSummary?.draft ?? "-") ? "warning" : "neutral"} size="secondary" />
          <StatsTile label="Final" value={statsSummary?.final ?? "-"} emphasis={hasValue(statsSummary?.final ?? "-") ? "success" : "muted"} size="secondary" />
          <StatsTile label="CT" value={statsSummary?.ct ?? "-"} onClick={() => setModalityShortcut("CT")} size="secondary" />
          <StatsTile label="MR" value={statsSummary?.mr ?? "-"} onClick={() => setModalityShortcut("MR")} size="secondary" />
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
          {selectedIds.length === 0 && <p className="text-sm" style={{ color: "var(--text-muted)" }}>Select cases to reassign.</p>}
          {selectedIds.length > 0 && (
          <div className="sticky top-0 z-30 rounded-lg border p-3 shadow-sm" style={{ backgroundColor: "var(--card)", borderColor: "var(--border)" }}>
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
              <button
                type="button"
                disabled={selectedUnassignDisabled}
                onClick={() => setSelectedUnassignConfirmOpen(true)}
                className="h-10 rounded-lg border px-3 text-sm font-semibold text-red-700 disabled:opacity-50"
                style={{ borderColor: "var(--border)" }}
              >
                Return selected to waiting pool
              </button>
              <button type="button" onClick={() => setSelectedIds([])} className="h-10 rounded-lg border px-3 text-sm font-semibold" style={{ borderColor: "var(--border)" }}>
                Clear
              </button>
            </div>
            {!canManage && <p className="mt-2 text-xs" style={{ color: "var(--text-muted)" }}>Only supervisors/admins can reassign selected cases.</p>}
            {selectedReassignMutation.error && <p className="mt-2 text-sm text-red-600">{selectedReassignMutation.error instanceof Error ? selectedReassignMutation.error.message : "Selected reassignment failed."}</p>}
            {selectedUnassignMutation.error && <p className="mt-2 text-sm text-red-600">{selectedUnassignMutation.error instanceof Error ? selectedUnassignMutation.error.message : "Selected return failed."}</p>}
          </div>
          )}
          <div className="rounded-lg border" style={{ borderColor: "var(--border)" }}>
            <div className="max-h-[70vh] overflow-auto">
              <table className="min-w-full divide-y text-sm" style={{ borderColor: "var(--border)" }}>
                <thead className="sticky top-0 z-20 shadow-sm" style={{ backgroundColor: "var(--card)" }}>
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
                    <th className="px-3 py-2 text-left text-xs font-semibold uppercase" style={{ color: "var(--text-muted)" }}>Patient</th>
                    <th className="px-3 py-2 text-left text-xs font-semibold uppercase" style={{ color: "var(--text-muted)" }}>IDs</th>
                    <th className="px-3 py-2 text-left text-xs font-semibold uppercase" style={{ color: "var(--text-muted)" }}>Date/time</th>
                    <th className="px-3 py-2 text-left text-xs font-semibold uppercase" style={{ color: "var(--text-muted)" }}>Study</th>
                    {showAssignedDoctorColumn && <th className="px-3 py-2 text-left text-xs font-semibold uppercase" style={{ color: "var(--text-muted)" }}>Assigned doctor</th>}
                    <th className="px-3 py-2 text-left text-xs font-semibold uppercase" style={{ color: "var(--text-muted)" }}>Aging/TAT</th>
                    <th className="px-3 py-2 text-left text-xs font-semibold uppercase" style={{ color: "var(--text-muted)" }}>Status</th>
                    <th className="w-10 px-2 py-2 text-right text-xs font-semibold uppercase" style={{ color: "var(--text-muted)" }}>Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y" style={{ borderColor: "var(--border)" }}>
                  {cases.map((row) => {
                    const selected = selectedIds.includes(row.appointmentId);
                    return (
                      <tr key={row.appointmentId} className={reportingRowClass(row, selected)} aria-label={`Case ${row.accessionNumber}: ${patientName(row)}. ${rowStatusLabel(row)}`} title={rowDetailsTitle(row)}>
                        <td className="px-3 py-2"><input
                          type="checkbox"
                          aria-label={`Select case ${row.accessionNumber}`}
                          checked={selected}
                          onChange={(event) => {
                            const checked = event.target.checked;
                            setSelectedIds((current) => checked ? [...new Set([...current, row.appointmentId])] : current.filter((id) => id !== row.appointmentId));
                          }}
                        /></td>
                        <td className="px-3 py-2">
                          <div className="flex min-w-44 flex-col gap-1">
                            <span className="font-semibold text-foreground">{patientName(row)}</span>
                            <PriorityBadge row={row} />
                          </div>
                        </td>
                        <td className="px-3 py-2"><IdsCell row={row} /></td>
                        <td className="px-3 py-2">{row.bookingDate} {row.bookingTime ?? ""}</td>
                        <td className="px-3 py-2"><StudyCell row={row} showCategoryMarker={showCategoryMarker} /></td>
                        {showAssignedDoctorColumn && <td className="px-3 py-2">{row.assignedDoctorName ?? "Unassigned"}</td>}
                        <td className="px-3 py-2"><AgingTatCell row={row} /></td>
                        <td className="px-3 py-2"><CompactStatusCell row={row} /></td>
                        <td className="px-2 py-2 text-right">
                          <RowActionMenu
                            row={row}
                            doctors={doctorsQuery.data ?? []}
                            canManage={canManage}
                            onAssign={(appointmentId, doctorId, reason) => assignMutation.mutate({ appointmentId, doctorId, reason })}
                            onUnassign={async (appointmentId, reason) => {
                              await unassignMutation.mutateAsync({ appointmentId, reason });
                            }}
                            onDiscontinue={(target) => {
                              setBoardActionMessage(null);
                              setDiscontinueReason("");
                              setDiscontinueTarget(target);
                            }}
                          />
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            {casesQuery.isLoading && <p className="p-4 text-sm" style={{ color: "var(--text-muted)" }}>Loading reporting cases...</p>}
            {casesQuery.isError && (
              <p className="m-4 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
                {casesQuery.error instanceof Error ? casesQuery.error.message : "Could not load reporting cases."}
              </p>
            )}
            {!casesQuery.isLoading && !casesQuery.isError && cases.length === 0 && <p className="p-4 text-sm" style={{ color: "var(--text-muted)" }}>No cases match these filters.</p>}
          </div>
          {bulkResult && (
            <div className="rounded-lg border p-4 text-sm" style={{ backgroundColor: "var(--card)", borderColor: "var(--border)" }}>
              {"unassignedCount" in bulkResult ? (
                <>
                  <p className="font-semibold">Bulk return result: {bulkResult.unassignedCount}/{bulkResult.requestedCount} returned, {bulkResult.skippedCount} skipped.</p>
                  <p className="mt-1">Returned appointment IDs: {bulkResult.unassignedAppointmentIds.join(", ") || "-"}</p>
                </>
              ) : (
                <>
                  <p className="font-semibold">Bulk assignment result: {bulkResult.assignedCount}/{bulkResult.requestedCount} assigned, {bulkResult.skippedCount} skipped.</p>
                  <p className="mt-1">Assigned appointment IDs: {bulkResult.assignedAppointmentIds.join(", ") || "-"}</p>
                </>
              )}
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
      <BoardSettingsModal
        open={settingsOpen}
        settingsDraft={settingsDraft}
        canEditSettings={canEditSettings}
        saving={updateSettingsMutation.isPending}
        onClose={() => setSettingsOpen(false)}
        onChange={setSettingsDraft}
        onSave={() => updateSettingsMutation.mutate()}
      />
      {discontinueTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/35 p-4">
          <section className="w-full max-w-md rounded-lg border p-5 shadow-xl" style={{ backgroundColor: "var(--card)", borderColor: "var(--border)" }}>
            <h3 className="text-lg font-semibold text-foreground">Mark study as discontinued?</h3>
            <p className="mt-2 text-sm" style={{ color: "var(--text-muted)" }}>
              This will change the appointment status from completed to discontinued and remove it from the reporting pool. Use this only when the study was completed by mistake or should not be reported.
            </p>
            <label className="mt-4 block text-sm font-semibold text-foreground">
              Reason
              <textarea
                value={discontinueReason}
                onChange={(event) => setDiscontinueReason(event.target.value)}
                placeholder="Reason for discontinuing this study"
                className={`${inputClass()} mt-1 min-h-24`}
              />
            </label>
            <div className="mt-5 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => {
                  setDiscontinueTarget(null);
                  setDiscontinueReason("");
                }}
                className="rounded-lg border px-3 py-2 text-sm font-semibold"
                style={{ borderColor: "var(--border)" }}
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={discontinueMutation.isPending || !discontinueReason.trim()}
                onClick={() => discontinueMutation.mutate()}
                className="rounded-lg bg-red-600 px-3 py-2 text-sm font-semibold text-white disabled:bg-red-300"
              >
                Mark discontinued
              </button>
            </div>
          </section>
        </div>
      )}
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
      {selectedUnassignConfirmOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/35 p-4">
          <section className="w-full max-w-md rounded-lg border p-5 shadow-xl" style={{ backgroundColor: "var(--card)", borderColor: "var(--border)" }}>
            <h3 className="text-lg font-semibold text-foreground">Return selected to waiting pool</h3>
            <p className="mt-2 text-sm" style={{ color: "var(--text-muted)" }}>
              This removes assigned doctors and returns selected cases to the unassigned waiting pool. Final reports will remain protected.
            </p>
            <label className="mt-4 block text-sm font-semibold text-foreground">
              Reason
              <input
                value={selectedUnassignReason}
                onChange={(event) => setSelectedUnassignReason(event.target.value)}
                placeholder="Reason for returning selected cases"
                className={`${inputClass()} mt-1`}
              />
            </label>
            <div className="mt-5 flex justify-end gap-2">
              <button type="button" onClick={() => setSelectedUnassignConfirmOpen(false)} className="rounded-lg border px-3 py-2 text-sm font-semibold" style={{ borderColor: "var(--border)" }}>Cancel</button>
              <button
                type="button"
                disabled={selectedUnassignMutation.isPending || !selectedUnassignReason.trim()}
                onClick={() => selectedUnassignMutation.mutate()}
                className="rounded-lg bg-red-600 px-3 py-2 text-sm font-semibold text-white disabled:bg-red-300"
              >
                Confirm return selected to waiting pool
              </button>
            </div>
          </section>
        </div>
      )}
    </div>
  );
}
