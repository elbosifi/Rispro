import { useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  BadgeCheck,
  Ban,
  CheckCircle2,
  Clock3,
  Printer,
  RefreshCw,
  RotateCcw,
  ScanLine,
  TimerReset,
  XCircle,
} from "lucide-react";
import { DateInput } from "@/components/common/date-input";
import { Select } from "@/components/common/select";
import { PatientCategoryBadge } from "@/components/patients/patient-category-badge";
import {
  Badge,
  Button,
  Card,
  Checkbox,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/shared";
import { fetchAppointmentLookups, fetchModalityWorklist, fetchStatistics, completeAppointment, updateAppointmentStatus } from "@/lib/api-hooks";
import { printAppointmentSlipById } from "@/lib/appointment-printing";
import { chooseLocalized, t } from "@/lib/i18n";
import type { Language } from "@/lib/i18n";
import { formatDateLy, todayIsoDateLy } from "@/lib/date-format";
import type { AppointmentWithDetails } from "@/lib/mappers";
import type { AppointmentLookups, AppointmentStatus } from "@/types/api";
import { useLanguage } from "@/providers/language-provider";

const ACTIVE_STATUSES = new Set<AppointmentStatus>(["waiting", "arrived", "in-progress"]);
const LIVE_BOARD_STATUSES = new Set<AppointmentStatus>(["in-progress", "arrived", "waiting", "scheduled"]);
const PROBLEM_STATUSES = new Set<AppointmentStatus>(["no-show", "cancelled", "discontinued"]);
const EMPTY_VALUE = "—";

type BoardFilter = "operational" | "ready" | "not-arrived" | "completed" | "problem" | "all";
type BoardStatusAction = {
  appointment: AppointmentWithDetails;
  status: "arrived" | "waiting" | "cancelled" | "discontinued";
  reasonRequired: boolean;
};

function isActiveStatus(status: AppointmentStatus): boolean {
  return ACTIVE_STATUSES.has(status);
}

function statusVariant(status: AppointmentStatus): "success" | "warning" | "info" | "error" | "neutral" | "accent" {
  switch (status) {
    case "waiting":
      return "warning";
    case "arrived":
      return "info";
    case "in-progress":
      return "accent";
    case "completed":
      return "success";
    case "discontinued":
    case "cancelled":
    case "voided":
      return "error";
    case "no-show":
      return "warning";
    default:
      return "neutral";
  }
}

function normalizeStatusLabel(language: Language, status: AppointmentStatus): string {
  return t(language, `status.${status}`);
}

function sexLabel(language: Language, sex: string | null | undefined): string {
  const value = String(sex ?? "").trim().toLowerCase();
  if (!value) return t(language, "common.na");
  if (value.startsWith("m")) return language === "ar" ? "ذكر" : "Male";
  if (value.startsWith("f")) return language === "ar" ? "أنثى" : "Female";
  return sex ?? t(language, "common.na");
}

function formatAgeSex(language: Language, appointment: AppointmentWithDetails): string {
  const ageText =
    appointment.ageYears > 0
      ? language === "ar"
        ? `${appointment.ageYears} سنة`
        : `${appointment.ageYears} years`
      : "";
  const sexText = sexLabel(language, appointment.sex);
  if (!ageText && sexText === t(language, "common.na")) return t(language, "common.na");
  if (!ageText) return sexText;
  if (sexText === t(language, "common.na")) return ageText;
  return `${ageText} • ${sexText}`;
}

function getSequenceNumber(appointment: AppointmentWithDetails): number {
  const slot = Number(appointment.modalitySlotNumber ?? appointment.dailySequence ?? Number.MAX_SAFE_INTEGER);
  return Number.isFinite(slot) ? slot : Number.MAX_SAFE_INTEGER;
}

function getBoardGroup(status: AppointmentStatus): number {
  if (status === "in-progress") return 0;
  if (status === "arrived" || status === "waiting") return 1;
  if (status === "scheduled") return 2;
  if (status === "completed") return 3;
  return 4;
}

function timestampValue(value: string | null | undefined): number | null {
  if (!value) return null;
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? timestamp : null;
}

function bookingTimeValue(value: string | null | undefined): number | null {
  const match = String(value ?? "").match(/^(\d{1,2}):(\d{2})/);
  if (!match) return null;
  return Number(match[1]) * 60 + Number(match[2]);
}

function compareNullableAsc(a: number | null, b: number | null): number {
  return (a ?? Number.MAX_SAFE_INTEGER) - (b ?? Number.MAX_SAFE_INTEGER);
}

function compareNullableDesc(a: number | null, b: number | null): number {
  return (b ?? Number.MIN_SAFE_INTEGER) - (a ?? Number.MIN_SAFE_INTEGER);
}

function compareBoardAppointments(a: AppointmentWithDetails, b: AppointmentWithDetails): number {
  const groupOrder = getBoardGroup(a.status) - getBoardGroup(b.status);
  if (groupOrder !== 0) return groupOrder;

  if (a.status === "arrived" || a.status === "waiting") {
    const arrivalOrder = compareNullableAsc(timestampValue(a.arrivedAt), timestampValue(b.arrivedAt));
    if (arrivalOrder !== 0) return arrivalOrder;
  }

  if (a.status === "scheduled") {
    const bookingOrder = compareNullableAsc(bookingTimeValue(a.bookingTime), bookingTimeValue(b.bookingTime));
    if (bookingOrder !== 0) return bookingOrder;
  }

  if (a.status === "completed") {
    const completedOrder = compareNullableDesc(timestampValue(a.completedAt), timestampValue(b.completedAt));
    if (completedOrder !== 0) return completedOrder;
  }

  return getSequenceNumber(a) - getSequenceNumber(b) || a.id - b.id || a.accessionNumber.localeCompare(b.accessionNumber);
}

function compareArrivalOrder(a: AppointmentWithDetails, b: AppointmentWithDetails): number {
  const arrivalOrder = compareNullableAsc(timestampValue(a.arrivedAt), timestampValue(b.arrivedAt));
  if (arrivalOrder !== 0) return arrivalOrder;
  return getSequenceNumber(a) - getSequenceNumber(b) || a.id - b.id;
}

function matchesBoardFilter(appointment: AppointmentWithDetails, filter: BoardFilter): boolean {
  switch (filter) {
    case "operational":
      return LIVE_BOARD_STATUSES.has(appointment.status);
    case "ready":
      return appointment.status === "arrived" || appointment.status === "waiting";
    case "not-arrived":
      return appointment.status === "scheduled";
    case "completed":
      return appointment.status === "completed";
    case "problem":
      return PROBLEM_STATUSES.has(appointment.status);
    case "all":
      return true;
  }
}

function formatClockValue(language: Language, value: string | null | undefined): string {
  if (!value) return t(language, "common.na");
  const text = String(value);
  if (/^\d{1,2}:\d{2}/.test(text)) return text.slice(0, 5);
  const date = new Date(text);
  if (Number.isNaN(date.getTime())) return text;
  return date.toLocaleTimeString(language === "ar" ? "ar-LY" : "en-GB", { hour: "2-digit", minute: "2-digit", hour12: false });
}

function formatArrivalColumn(language: Language, appointment: AppointmentWithDetails): string {
  if (appointment.arrivedAt) return formatClockValue(language, appointment.arrivedAt);
  if (appointment.status === "scheduled" && appointment.bookingTime) {
    return `${chooseLocalized(language, "محجوز", "Booked")} ${formatClockValue(language, appointment.bookingTime)}`;
  }
  return EMPTY_VALUE;
}

function notesIndicator(language: Language, appointment: AppointmentWithDetails): string {
  return appointment.notes?.trim() || appointment.specialReasonNote?.trim()
    ? chooseLocalized(language, "توجد ملاحظات", "Notes")
    : t(language, "common.na");
}

function rowStatusClass(status: AppointmentStatus, selected: boolean): string {
  const selectedClass = selected ? "ring-1 ring-accent/40" : "";
  switch (status) {
    case "in-progress":
      return `border-l-4 border-l-indigo-500 bg-indigo-50/90 hover:bg-indigo-50 ${selectedClass}`.trim();
    case "arrived":
    case "waiting":
      return `border-l-4 border-l-sky-400 bg-sky-50/80 hover:bg-sky-50 ${selectedClass}`.trim();
    case "scheduled":
      return `border-l-4 border-l-slate-300 bg-slate-50/70 text-slate-700 hover:bg-slate-100 ${selectedClass}`.trim();
    case "completed":
      return `border-l-4 border-l-emerald-300 bg-emerald-50/45 text-slate-600 hover:bg-emerald-50/70 ${selectedClass}`.trim();
    case "no-show":
      return `border-l-4 border-l-amber-400 bg-amber-50/70 text-slate-700 hover:bg-amber-50 ${selectedClass}`.trim();
    case "cancelled":
    case "discontinued":
    case "voided":
      return `border-l-4 border-l-rose-300 bg-rose-50/45 text-slate-600 hover:bg-rose-50/70 ${selectedClass}`.trim();
    default:
      return `border-l-4 border-l-transparent bg-white hover:bg-slate-50 ${selectedClass}`.trim();
  }
}

export default function ModalityPage() {
  const { language: rawLanguage, isArabic } = useLanguage();
  const language = rawLanguage as Language;
  const queryClient = useQueryClient();
  const selectedRef = useRef<HTMLTableRowElement | null>(null);

  const [modalityId, setModalityId] = useState("");
  const [date, setDate] = useState(todayIsoDateLy());
  const [scope, setScope] = useState<"day" | "all">("day");
  const [boardFilter, setBoardFilter] = useState<BoardFilter>("operational");
  const [selectedAppointmentId, setSelectedAppointmentId] = useState<number | null>(null);
  const [confirmTargetId, setConfirmTargetId] = useState<number | null>(null);
  const [confirmVerified, setConfirmVerified] = useState(false);
  const [statusAction, setStatusAction] = useState<BoardStatusAction | null>(null);
  const [statusReason, setStatusReason] = useState("");

  const { data: lookups } = useQuery<AppointmentLookups>({
    queryKey: ["lookups"],
    queryFn: fetchAppointmentLookups,
    staleTime: 1000 * 60 * 5,
  });

  const { data: appointments = [], isLoading, isFetching } = useQuery({
    queryKey: ["modality-worklist", modalityId, date, scope],
    queryFn: () => fetchModalityWorklist(modalityId, date, scope),
    enabled: !!modalityId,
    staleTime: 1000 * 10,
    refetchInterval: 15_000,
  });

  const { data: statistics } = useQuery({
    queryKey: ["modality-statistics", modalityId, date, scope],
    queryFn: () => fetchStatistics(scope === "all" ? "" : date, modalityId),
    enabled: !!modalityId,
    staleTime: 1000 * 10,
    refetchInterval: 15_000,
  });

  const selectedAppointment = useMemo(
    () => appointments.find((appointment) => appointment.id === selectedAppointmentId) ?? null,
    [appointments, selectedAppointmentId]
  );

  useEffect(() => {
    if (selectedAppointmentId == null) return;
    if (!appointments.some((appointment) => appointment.id === selectedAppointmentId)) {
      setSelectedAppointmentId(null);
      setConfirmTargetId(null);
      setConfirmVerified(false);
    }
  }, [appointments, selectedAppointmentId]);

  useEffect(() => {
    if (confirmTargetId == null) return;
    if (!appointments.some((appointment) => appointment.id === confirmTargetId)) {
      setConfirmTargetId(null);
      setConfirmVerified(false);
    }
  }, [appointments, confirmTargetId]);

  const completeMutation = useMutation({
    mutationFn: completeAppointment,
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["modality-worklist"] });
      await queryClient.invalidateQueries({ queryKey: ["modality-statistics"] });
      await queryClient.invalidateQueries({ queryKey: ["queue"] });
      await queryClient.invalidateQueries({ queryKey: ["calendar"] });
      await queryClient.invalidateQueries({ queryKey: ["registrations"] });
      setConfirmTargetId(null);
      setConfirmVerified(false);
    },
  });

  const statusMutation = useMutation({
    mutationFn: ({ appointmentId, status, reason }: { appointmentId: number; status: "arrived" | "waiting" | "cancelled" | "discontinued"; reason?: string | null }) =>
      updateAppointmentStatus(appointmentId, status, reason),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["modality-worklist"] });
      await queryClient.invalidateQueries({ queryKey: ["modality-statistics"] });
      await queryClient.invalidateQueries({ queryKey: ["queue"] });
      await queryClient.invalidateQueries({ queryKey: ["calendar"] });
      await queryClient.invalidateQueries({ queryKey: ["registrations"] });
      setStatusAction(null);
      setStatusReason("");
    },
  });

  const boardAppointments = useMemo(
    () => appointments.slice().sort(compareBoardAppointments),
    [appointments]
  );
  const visibleBoardAppointments = useMemo(
    () => boardAppointments.filter((appointment) => matchesBoardFilter(appointment, boardFilter)),
    [boardAppointments, boardFilter]
  );
  const arrivalNumberById = useMemo(() => {
    const entries = boardAppointments
      .filter((appointment) => appointment.status === "arrived" || appointment.status === "waiting")
      .slice()
      .sort(compareArrivalOrder);
    return new Map(entries.map((appointment, index) => [appointment.id, index + 1]));
  }, [boardAppointments]);

  const statusCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const row of statistics?.statusBreakdown ?? []) {
      counts.set(row.status, row.count);
    }
    return counts;
  }, [statistics]);

  const waitingStatisticsCount = statusCounts.get("waiting") ?? 0;
  const arrivedStatisticsCount = statusCounts.get("arrived") ?? 0;
  const inProgressStatisticsCount = statusCounts.get("in-progress") ?? 0;
  const completedCount = statusCounts.get("completed") ?? 0;
  const liveCount = boardAppointments.filter((appointment) => LIVE_BOARD_STATUSES.has(appointment.status)).length;
  const historyCount = boardAppointments.length - liveCount;

  const selectedEdited =
    Boolean(selectedAppointment?.createdAt && selectedAppointment?.updatedAt) &&
    selectedAppointment?.createdAt !== selectedAppointment?.updatedAt;

  const canComplete = Boolean(selectedAppointment && ACTIVE_STATUSES.has(selectedAppointment.status));
  const canCloseAsProblem = Boolean(selectedAppointment && ACTIVE_STATUSES.has(selectedAppointment.status));
  const completionTarget = confirmTargetId == null ? null : appointments.find((appointment) => appointment.id === confirmTargetId) ?? null;

  const handleRefresh = () => {
    void queryClient.invalidateQueries({ queryKey: ["modality-worklist"] });
    void queryClient.invalidateQueries({ queryKey: ["modality-statistics"] });
  };

  const handlePrint = (appointmentId: number) => {
    void printAppointmentSlipById(appointmentId, language);
  };

  const handleRequestCompletion = (appointment: AppointmentWithDetails) => {
    setConfirmTargetId(appointment.id);
    setConfirmVerified(false);
  };

  const handleConfirmCompletion = () => {
    if (!completionTarget || !confirmVerified || completeMutation.isPending) return;
    completeMutation.mutate(completionTarget.id);
  };

  const handleConfirmStatusAction = () => {
    if (!statusAction || statusMutation.isPending) return;
    const reason = statusReason.trim();
    if (statusAction.reasonRequired && !reason) return;
    statusMutation.mutate({
      appointmentId: statusAction.appointment.id,
      status: statusAction.status,
      reason: reason || null,
    });
  };

  const handleRequestStatusChange = (
    appointment: AppointmentWithDetails,
    status: "arrived" | "waiting" | "cancelled" | "discontinued",
    reasonRequired = false
  ) => {
    if (reasonRequired) {
      setStatusAction({ appointment, status, reasonRequired });
      setStatusReason("");
      return;
    }
    statusMutation.mutate({ appointmentId: appointment.id, status, reason: null });
  };

  const modalities = lookups?.modalities ?? [];
  const headerTitle = t(language, "modality.title");
  const selectedName = selectedAppointment ? chooseLocalized(language, selectedAppointment.arabicFullName, selectedAppointment.englishFullName) : "";
  const selectedModality = selectedAppointment ? chooseLocalized(language, selectedAppointment.modalityNameAr, selectedAppointment.modalityNameEn) : "";
  const selectedExam = selectedAppointment ? chooseLocalized(language, selectedAppointment.examNameAr, selectedAppointment.examNameEn) || t(language, "common.na") : "";
  const selectedPriority = selectedAppointment ? chooseLocalized(language, selectedAppointment.priorityNameAr, selectedAppointment.priorityNameEn) || t(language, "common.na") : "";

  return (
    <div className="min-h-screen bg-[radial-gradient(circle_at_top_left,rgba(37,99,235,0.10),transparent_26%),radial-gradient(circle_at_top_right,rgba(14,165,233,0.08),transparent_20%),linear-gradient(180deg,rgba(248,250,252,1),rgba(241,245,249,1))]" dir={isArabic ? "rtl" : "ltr"}>
      <div className="mx-auto flex min-h-screen w-full max-w-[1680px] flex-col gap-3 p-3 sm:p-4 lg:p-5">
        <header className="rounded-2xl border border-slate-200/80 bg-white/90 px-4 py-3 shadow-[0_12px_30px_rgba(15,23,42,0.06)] backdrop-blur-md">
          <div className={`flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between ${isArabic ? "xl:flex-row-reverse" : ""}`}>
            <div className={`flex items-center gap-3 ${isArabic ? "flex-row-reverse" : ""}`}>
              <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-[linear-gradient(135deg,var(--accent),var(--accent-secondary))] text-white shadow-sm">
                <span className="text-xs font-bold tracking-[0.18em]">NCCB</span>
              </div>

              <div>
                <p className="text-xs uppercase tracking-[0.18em] text-muted-foreground">{chooseLocalized(language, "قائمة عمل الماسح", "Scanner Worklist")}</p>
                <h1 className="font-display text-xl font-semibold tracking-tight text-foreground">{headerTitle}</h1>
              </div>
            </div>

            <div className={`flex flex-wrap items-center gap-2 ${isArabic ? "flex-row-reverse" : ""}`}>
              <div className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2">
                <div className="flex items-center gap-2 text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
                  <Clock3 size={14} />
                  <span>{chooseLocalized(language, "الوقت الحالي", "Current time")}</span>
                </div>
                <p className="mt-0.5 text-base font-semibold text-foreground">{new Date().toLocaleTimeString(language === "ar" ? "ar-LY" : "en-GB", { hour: "2-digit", minute: "2-digit", hour12: false })}</p>
              </div>

              <Button variant="ghost" size="sm" onClick={handleRefresh} className="rounded-xl px-3">
                <RefreshCw size={16} />
                <span>{t(language, "modality.refresh")}</span>
              </Button>
            </div>
          </div>
        </header>

        <main className="flex flex-1 flex-col gap-3">
          <section className="flex min-h-0 flex-col gap-3">
            <Card className="rounded-2xl border border-slate-200/80 bg-white/92 p-3 shadow-[0_10px_24px_rgba(15,23,42,0.05)]">
              <div className={`grid items-end gap-3 md:grid-cols-[minmax(220px,1fr)_180px_220px] ${isArabic ? "md:[direction:rtl]" : ""}`}>
                <Select
                  label={t(language, "modality.selectModality")}
                  value={modalityId}
                  onChange={(value) => {
                    setModalityId(value);
                    setSelectedAppointmentId(null);
                    setConfirmTargetId(null);
                    setConfirmVerified(false);
                  }}
                  options={[
                    { value: "", label: t(language, "modality.selectModality") },
                    ...modalities
                      .filter((modality) => modality.isActive)
                      .map((modality) => ({
                        value: String(modality.id),
                        label: chooseLocalized(language, modality.nameAr, modality.nameEn) || modality.code || `Modality ${modality.id}`,
                      })),
                  ]}
                  required
                />

                <DateInput
                  label={t(language, "modality.date")}
                  value={date}
                  onChange={setDate}
                  disabled={scope === "all"}
                />

                <div>
                  <p className="mb-1.5 text-xs font-mono-data uppercase tracking-[0.08em] text-muted-foreground">
                    {t(language, "modality.scope")}
                  </p>
                  <div className="grid grid-cols-2 gap-2">
                    <Button
                      type="button"
                      variant={scope === "day" ? "primary" : "secondary"}
                      size="sm"
                      onClick={() => setScope("day")}
                      className="justify-center"
                    >
                      {t(language, "modality.scopeToday")}
                    </Button>
                    <Button
                      type="button"
                      variant={scope === "all" ? "primary" : "secondary"}
                      size="sm"
                      onClick={() => setScope("all")}
                      className="justify-center"
                    >
                      {t(language, "modality.scopeAll")}
                    </Button>
                  </div>
                </div>
              </div>
            </Card>

            <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
              <MetricCard
                label={t(language, "status.waiting")}
                value={waitingStatisticsCount}
                tone="amber"
                icon={<Clock3 size={20} />}
              />
              <MetricCard
                label={t(language, "status.arrived")}
                value={arrivedStatisticsCount}
                tone="sky"
                icon={<BadgeCheck size={20} />}
              />
              <MetricCard
                label={t(language, "status.in-progress")}
                value={inProgressStatisticsCount}
                tone="indigo"
                icon={<TimerReset size={20} />}
              />
              <MetricCard
                label={t(language, "status.completed")}
                value={completedCount}
                tone="emerald"
                icon={<CheckCircle2 size={20} />}
              />
            </div>

            <Card className="overflow-hidden rounded-2xl border border-slate-200/80 bg-white/94 shadow-[0_12px_30px_rgba(15,23,42,0.06)]">
              <div className="flex flex-wrap items-center justify-between gap-2 px-3 py-2">
                <div>
                  <p className="text-[10px] uppercase tracking-[0.16em] text-muted-foreground">{chooseLocalized(language, "لوحة الموداليتي", "Modality board")}</p>
                  <h2 className="text-sm font-semibold text-foreground">
                    {chooseLocalized(language, "الحالات الحية أولاً، السجل في الأسفل", "Live cases first, history below")}
                  </h2>
                </div>
                <div className="flex flex-wrap items-center gap-1.5">
                  {([
                    ["operational", chooseLocalized(language, "تشغيلي", "Operational")],
                    ["ready", chooseLocalized(language, "جاهز", "Arrived/Ready")],
                    ["not-arrived", chooseLocalized(language, "لم يصل", "Not arrived")],
                    ["completed", chooseLocalized(language, "مكتمل", "Completed")],
                    ["problem", chooseLocalized(language, "مشكلة", "Problem")],
                    ["all", chooseLocalized(language, "الكل", "All")],
                  ] as const).map(([filter, label]) => (
                    <Button
                      key={filter}
                      type="button"
                      variant={boardFilter === filter ? "primary" : "secondary"}
                      size="sm"
                      onClick={() => setBoardFilter(filter)}
                      className="h-7 px-2 text-[11px]"
                    >
                      {label}
                    </Button>
                  ))}
                  <Badge variant="selected" size="sm">
                    {chooseLocalized(language, "حي", "Live")} {liveCount}
                  </Badge>
                  <Badge variant="neutral" size="sm">
                    {chooseLocalized(language, "سجل", "History")} {historyCount}
                  </Badge>
                </div>
              </div>

              <div className="border-t border-slate-200">
                {isLoading ? (
                  <div className="m-4 rounded-2xl border border-dashed border-slate-300 bg-slate-50 px-4 py-8 text-center text-muted-foreground">
                    {t(language, "modality.loading")}
                  </div>
                ) : !modalityId ? (
                  <div className="m-4 rounded-2xl border border-dashed border-slate-300 bg-slate-50 px-4 py-8 text-center text-muted-foreground">
                    {t(language, "modality.selectPrompt")}
                  </div>
                ) : boardAppointments.length === 0 ? (
                  <div className="m-4 rounded-2xl border border-dashed border-slate-300 bg-slate-50 px-4 py-8 text-center text-muted-foreground">
                    {t(language, "modality.empty")}
                  </div>
                ) : visibleBoardAppointments.length === 0 ? (
                  <div className="m-4 rounded-2xl border border-dashed border-slate-300 bg-slate-50 px-4 py-8 text-center text-muted-foreground">
                    {chooseLocalized(language, "لا توجد حالات لهذا الفلتر.", "No cases match this filter.")}
                  </div>
                ) : (
                  <div className="max-h-[calc(100vh-290px)] overflow-auto">
                    <table data-testid="modality-board" className="min-w-[1120px] table-fixed text-left text-[11px]">
                      <thead className="sticky top-0 z-10 bg-slate-100 text-[10px] uppercase tracking-[0.12em] text-muted-foreground shadow-sm">
                        <tr>
                          <th className="w-[84px] px-2 py-2 font-semibold">{chooseLocalized(language, "رقم الوصول", "Arrival #")}</th>
                          <th className="w-[132px] px-2 py-2 font-semibold">{chooseLocalized(language, "الحالة", "Status")}</th>
                          <th className="w-[112px] px-2 py-2 font-semibold">{chooseLocalized(language, "وقت الوصول", "Arrival time")}</th>
                          <th className="w-[190px] px-2 py-2 font-semibold">{chooseLocalized(language, "المريض", "Patient")}</th>
                          <th className="w-[150px] px-2 py-2 font-semibold">{chooseLocalized(language, "MRN / الرقم الوطني", "MRN / national ID")}</th>
                          <th className="w-[100px] px-2 py-2 font-semibold">{chooseLocalized(language, "العمر / الجنس", "Age / sex")}</th>
                          <th className="w-[170px] px-2 py-2 font-semibold">{chooseLocalized(language, "الفحص", "Exam")}</th>
                          <th className="w-[110px] px-2 py-2 font-semibold">{chooseLocalized(language, "الأولوية", "Priority")}</th>
                          <th className="w-[130px] px-2 py-2 font-semibold">{chooseLocalized(language, "الوصول", "Accession")}</th>
                          <th className="w-[80px] px-2 py-2 font-semibold">{chooseLocalized(language, "ملاحظات", "Notes")}</th>
                          <th className="w-[160px] px-2 py-2 font-semibold">{chooseLocalized(language, "الإجراءات", "Actions")}</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-200">
                        {visibleBoardAppointments.map((appointment) => {
                      const selected = appointment.id === selectedAppointmentId;
                      const edited = Boolean(appointment.createdAt && appointment.updatedAt && appointment.createdAt !== appointment.updatedAt);
                      const canAct = isActiveStatus(appointment.status);
                      const canCompleteRow = canAct && appointment.status !== "scheduled";
                      const canMarkArrived = appointment.status === "scheduled" || appointment.status === "waiting";
                      const arrivalNumber = arrivalNumberById.get(appointment.id);
                      return (
                            <tr
                              key={appointment.id}
                              ref={selected ? selectedRef : undefined}
                              data-testid={`modality-board-row-${appointment.id}`}
                              tabIndex={0}
                              onClick={() => setSelectedAppointmentId(appointment.id)}
                              onKeyDown={(event) => {
                                if (event.key === "Enter" || event.key === " ") {
                                  event.preventDefault();
                                  setSelectedAppointmentId(appointment.id);
                                }
                              }}
                              className={`cursor-pointer align-top transition-colors ${rowStatusClass(appointment.status, selected)}`}
                            >
                              <td className="px-2 py-1 font-mono text-xs font-semibold text-foreground">
                                {arrivalNumber ? `#${arrivalNumber}` : "—"}
                              </td>
                              <td className="px-2 py-1">
                                <div className="flex flex-wrap items-center gap-1">
                                  <Badge variant={statusVariant(appointment.status)} size="sm">
                                    {normalizeStatusLabel(language, appointment.status)}
                                  </Badge>
                                  <PatientCategoryBadge category={appointment.caseCategory} showWhenUnset={false} size="sm" />
                                </div>
                              </td>
                              <td className="px-2 py-1 font-mono text-[11px] text-slate-700">{formatArrivalColumn(language, appointment)}</td>
                              <td className="px-2 py-1">
                                <p className="font-semibold text-foreground">{chooseLocalized(language, appointment.arabicFullName, appointment.englishFullName)}</p>
                                <p className="text-[10px] text-muted-foreground">{formatDateLy(appointment.appointmentDate)}</p>
                              </td>
                              <td className="px-2 py-1 text-[11px] text-slate-700">
                                <p>{appointment.mrn || EMPTY_VALUE}</p>
                                <p className="text-muted-foreground">{appointment.nationalId || EMPTY_VALUE}</p>
                              </td>
                              <td className="px-2 py-1 text-[11px] text-slate-700">{formatAgeSex(language, appointment).replace(t(language, "common.na"), EMPTY_VALUE)}</td>
                              <td className="px-2 py-1 text-[11px] text-slate-700">{chooseLocalized(language, appointment.examNameAr, appointment.examNameEn) || EMPTY_VALUE}</td>
                              <td className="px-2 py-1 text-[11px] text-slate-700">{chooseLocalized(language, appointment.priorityNameAr, appointment.priorityNameEn) || EMPTY_VALUE}</td>
                              <td className="px-2 py-1">
                                <code data-testid="modality-board-accession" className="font-mono text-[11px] text-foreground">
                                  {appointment.accessionNumber}
                                </code>
                              </td>
                              <td className="px-2 py-1">
                                {appointment.notes?.trim() || appointment.specialReasonNote?.trim() ? (
                                  <Badge variant="info" size="sm" title={appointment.notes ?? appointment.specialReasonNote ?? undefined}>
                                    {notesIndicator(language, appointment)}
                                  </Badge>
                                ) : edited ? (
                                  <Badge variant="warning" size="sm">
                                    {t(language, "appointmentEditor.edited")}
                                  </Badge>
                                ) : (
                                  <span className="text-xs text-muted-foreground">{EMPTY_VALUE}</span>
                                )}
                              </td>
                              <td className="px-2 py-1">
                                <div className="flex items-center gap-1">
                                  <Button
                                    type="button"
                                    variant="secondary"
                                    size="icon"
                                    aria-label={t(language, "common.print")}
                                    title={t(language, "common.print")}
                                    className="h-8 w-8 border border-slate-300 bg-white text-slate-700"
                                    onClick={(event) => {
                                      event.stopPropagation();
                                      handlePrint(appointment.id);
                                    }}
                                  >
                                    <Printer size={14} />
                                  </Button>
                                  {canMarkArrived ? (
                                    <Button
                                      type="button"
                                      variant={appointment.status === "scheduled" ? "primary" : "secondary"}
                                      size="sm"
                                      className="h-8 px-2 text-[11px]"
                                      aria-label={chooseLocalized(language, "تسجيل الوصول", "Mark arrived")}
                                      title={chooseLocalized(language, "تسجيل الوصول", "Mark arrived")}
                                      disabled={statusMutation.isPending}
                                      onClick={(event) => {
                                        event.stopPropagation();
                                        handleRequestStatusChange(appointment, "arrived");
                                      }}
                                    >
                                      <BadgeCheck size={14} />
                                      <span>{chooseLocalized(language, "وصول", "Arrived")}</span>
                                    </Button>
                                  ) : null}
                                  {canCompleteRow ? (
                                    <Button
                                      type="button"
                                      variant="primary"
                                      size="sm"
                                      className="h-8 px-2 text-[11px]"
                                      disabled={completeMutation.isPending}
                                      onClick={(event) => {
                                        event.stopPropagation();
                                        handleRequestCompletion(appointment);
                                      }}
                                    >
                                      {completeMutation.isPending ? <RefreshCw size={14} className="animate-spin" /> : <CheckCircle2 size={14} />}
                                      <span>{chooseLocalized(language, "إكمال", "Complete")}</span>
                                    </Button>
                                  ) : null}
                                  <Button
                                    type="button"
                                    variant="secondary"
                                    size="icon"
                                    aria-label={chooseLocalized(language, "إيقاف", "Discontinue")}
                                    title={chooseLocalized(language, "إيقاف", "Discontinue")}
                                    className="h-8 w-8 border border-amber-300 bg-amber-50 text-amber-800"
                                    disabled={!canAct || statusMutation.isPending}
                                    onClick={(event) => {
                                      event.stopPropagation();
                                      setStatusAction({ appointment, status: "discontinued", reasonRequired: true });
                                      setStatusReason("");
                                    }}
                                  >
                                    <Ban size={14} />
                                  </Button>
                                  <Button
                                    type="button"
                                    variant="secondary"
                                    size="icon"
                                    aria-label={chooseLocalized(language, "إلغاء", "Cancel")}
                                    title={chooseLocalized(language, "إلغاء", "Cancel")}
                                    className="h-8 w-8 border border-rose-300 bg-rose-50 text-rose-800"
                                    disabled={!canAct || statusMutation.isPending}
                                    onClick={(event) => {
                                      event.stopPropagation();
                                      setStatusAction({ appointment, status: "cancelled", reasonRequired: true });
                                      setStatusReason("");
                                    }}
                                  >
                                    <XCircle size={14} />
                                  </Button>
                                  {appointment.status === "arrived" ? (
                                    <Button
                                      type="button"
                                      variant="secondary"
                                      size="icon"
                                      aria-label={chooseLocalized(language, "إرجاع للانتظار", "Back to waiting")}
                                      title={chooseLocalized(language, "إرجاع للانتظار", "Back to waiting")}
                                      className="h-8 w-8 border border-slate-300 bg-white text-slate-700"
                                      disabled={statusMutation.isPending}
                                      onClick={(event) => {
                                        event.stopPropagation();
                                        handleRequestStatusChange(appointment, "waiting");
                                      }}
                                    >
                                      <TimerReset size={14} />
                                    </Button>
                                  ) : null}
                                  {appointment.status === "completed" ? (
                                    <Button
                                      type="button"
                                      variant="secondary"
                                      size="icon"
                                      aria-label={chooseLocalized(language, "إعادة فتح", "Reopen as arrived")}
                                      title={chooseLocalized(language, "إعادة فتح", "Reopen as arrived")}
                                      className="h-8 w-8 border border-slate-300 bg-white text-slate-700"
                                      disabled={statusMutation.isPending}
                                      onClick={(event) => {
                                        event.stopPropagation();
                                        handleRequestStatusChange(appointment, "arrived", true);
                                      }}
                                    >
                                      <RotateCcw size={14} />
                                    </Button>
                                  ) : null}
                                </div>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            </Card>
          </section>

          <aside className="hidden" hidden aria-hidden="true">
            <Card
              data-testid={undefined}
              className="sticky top-4 rounded-[1.25rem] border border-slate-200/80 bg-white/94 p-4 shadow-[0_16px_40px_rgba(15,23,42,0.08)]"
            >
              {selectedAppointment ? (
                <>
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="text-xs uppercase tracking-[0.18em] text-muted-foreground">{chooseLocalized(language, "الموعد المختار", "Selected appointment")}</p>
                      <h2 className="mt-1 text-lg font-semibold tracking-tight text-foreground">
                        {selectedName}
                      </h2>
                      <div className="mt-2 flex flex-wrap items-center gap-2">
                        <PatientCategoryBadge category={selectedAppointment.caseCategory} showWhenUnset={false} size="sm" />
                        {selectedEdited ? (
                          <Badge variant="warning" size="sm">
                            {t(language, "appointmentEditor.edited")}
                          </Badge>
                        ) : null}
                        <Badge variant={statusVariant(selectedAppointment.status)} size="sm">
                          {normalizeStatusLabel(language, selectedAppointment.status)}
                        </Badge>
                      </div>
                    </div>

                    <Button variant="secondary" size="sm" onClick={() => handlePrint(selectedAppointment.id)}>
                      <Printer size={16} />
                      <span>{t(language, "common.print")}</span>
                    </Button>
                  </div>

                  <div className="mt-4 grid gap-2">
                    <DetailField label={t(language, "settings.fieldMRN")} value={selectedAppointment.mrn ?? null} />
                    <DetailField label={t(language, "settings.fieldNationalId")} value={selectedAppointment.nationalId ?? null} />
                    <DetailField label={t(language, "settings.fieldAge")} value={formatAgeSex(language, selectedAppointment)} />
                    <DetailField label={t(language, "modality.fieldAccession")} value={selectedAppointment.accessionNumber} />
                    <DetailField label={t(language, "modality.fieldModality")} value={selectedModality} />
                    <DetailField label={t(language, "modality.fieldExam")} value={selectedExam} />
                    <DetailField label={t(language, "modality.fieldPriority")} value={selectedPriority} />
                    <DetailField label={t(language, "modality.fieldNotes")} value={selectedAppointment.notes?.trim() || selectedAppointment.specialReasonNote?.trim() || null} />
                  </div>

                  <div className="mt-4 grid gap-2">
                    <Button
                      type="button"
                      variant="primary"
                      size="sm"
                      disabled={!canComplete || completeMutation.isPending}
                      onClick={() => handleRequestCompletion(selectedAppointment)}
                      className="justify-center"
                    >
                      {completeMutation.isPending ? (
                        <RefreshCw size={16} className="animate-spin" />
                      ) : (
                        <CheckCircle2 size={16} />
                      )}
                      <span>{chooseLocalized(language, "إكمال", "Complete")}</span>
                    </Button>
                    <div className="grid grid-cols-2 gap-2">
                      <Button
                        type="button"
                        variant="secondary"
                        size="sm"
                        disabled={!canCloseAsProblem || statusMutation.isPending}
                        onClick={() => {
                          setStatusAction({ appointment: selectedAppointment, status: "discontinued", reasonRequired: true });
                          setStatusReason("");
                        }}
                      >
                        <Ban size={16} />
                        <span>{chooseLocalized(language, "إيقاف", "Discontinue")}</span>
                      </Button>
                      <Button
                        type="button"
                        variant="secondary"
                        size="sm"
                        disabled={!canCloseAsProblem || statusMutation.isPending}
                        onClick={() => {
                          setStatusAction({ appointment: selectedAppointment, status: "cancelled", reasonRequired: true });
                          setStatusReason("");
                        }}
                      >
                        <XCircle size={16} />
                        <span>{chooseLocalized(language, "إلغاء", "Cancel")}</span>
                      </Button>
                    </div>
                  </div>
                </>
              ) : (
                <div className="flex min-h-[220px] items-center justify-center rounded-[1rem] border border-dashed border-slate-300 bg-slate-50 px-6 py-8 text-center">
                  <div className="max-w-xs space-y-3">
                    <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-[linear-gradient(135deg,rgba(37,99,235,0.12),rgba(14,165,233,0.14))] text-[var(--accent)]">
                      <ScanLine size={22} />
                    </div>
                    <h2 className="text-lg font-semibold text-foreground">{t(language, "modality.selectPrompt")}</h2>
                    <p className="text-sm leading-6 text-muted-foreground">
                      {chooseLocalized(language, "اختر صفاً لمراجعة التفاصيل الكاملة.", "Select a row to review full details.")}
                    </p>
                  </div>
                </div>
              )}
            </Card>

            <Card className="rounded-[1.25rem] border border-slate-200/80 bg-white/94 p-4 shadow-[0_16px_40px_rgba(15,23,42,0.08)]">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="text-xs uppercase tracking-[0.18em] text-muted-foreground">{chooseLocalized(language, "ملخص العمل الحالي", "Current worklist snapshot")}</p>
                  <h3 className="mt-1 text-base font-semibold text-foreground">
                    {chooseLocalized(language, "ملخص العمل الحالي", "Current worklist snapshot")}
                  </h3>
                </div>
                <RefreshCw className={`h-5 w-5 text-[var(--accent)] ${isFetching ? "animate-spin" : ""}`} />
              </div>

              <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-1">
                <SnapshotLine
                  label={chooseLocalized(language, "الحالات الحية", "Live cases")}
                  value={liveCount}
                />
                <SnapshotLine
                  label={chooseLocalized(language, "السجل / الاستثناءات", "History / exceptions")}
                  value={historyCount}
                />
              </div>
            </Card>
          </aside>
        </main>
      </div>

      <Dialog open={Boolean(selectedAppointment)} onClose={() => setSelectedAppointmentId(null)}>
        <DialogContent maxWidth="760px">
          {selectedAppointment ? (
            <div data-testid="selected-appointment-drawer">
              <DialogHeader>
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-xs uppercase tracking-[0.18em] text-muted-foreground">{chooseLocalized(language, "الموعد المختار", "Selected appointment")}</p>
                    <DialogTitle>{selectedName}</DialogTitle>
                    <div className="mt-2 flex flex-wrap items-center gap-2">
                      <PatientCategoryBadge category={selectedAppointment.caseCategory} showWhenUnset={false} size="sm" />
                      {selectedEdited ? (
                        <Badge variant="warning" size="sm">
                          {t(language, "appointmentEditor.edited")}
                        </Badge>
                      ) : null}
                      <Badge variant={statusVariant(selectedAppointment.status)} size="sm">
                        {normalizeStatusLabel(language, selectedAppointment.status)}
                      </Badge>
                    </div>
                  </div>
                  <Button variant="secondary" size="icon" aria-label={t(language, "common.print")} title={t(language, "common.print")} onClick={() => handlePrint(selectedAppointment.id)}>
                    <Printer size={16} />
                  </Button>
                </div>
              </DialogHeader>

              <div className="mt-4 grid gap-2 sm:grid-cols-2">
                <DetailField label={t(language, "settings.fieldMRN")} value={selectedAppointment.mrn ?? null} />
                <DetailField label={t(language, "settings.fieldNationalId")} value={selectedAppointment.nationalId ?? null} />
                <DetailField label={t(language, "settings.fieldAge")} value={formatAgeSex(language, selectedAppointment)} />
                <DetailField label={t(language, "modality.fieldAccession")} value={selectedAppointment.accessionNumber} />
                <DetailField label={t(language, "modality.fieldModality")} value={selectedModality} />
                <DetailField label={t(language, "modality.fieldExam")} value={selectedExam} />
                <DetailField label={t(language, "modality.fieldPriority")} value={selectedPriority} />
                <DetailField label={t(language, "modality.fieldNotes")} value={selectedAppointment.notes?.trim() || selectedAppointment.specialReasonNote?.trim() || null} />
              </div>

              <DialogFooter>
                {selectedAppointment.status === "scheduled" || selectedAppointment.status === "waiting" ? (
                  <Button
                    type="button"
                    variant="secondary"
                    disabled={statusMutation.isPending}
                    onClick={() => handleRequestStatusChange(selectedAppointment, "arrived")}
                  >
                    <BadgeCheck size={16} />
                    <span>{chooseLocalized(language, "تسجيل الوصول", "Mark arrived")}</span>
                  </Button>
                ) : null}
                {selectedAppointment.status === "arrived" ? (
                  <Button
                    type="button"
                    variant="secondary"
                    disabled={statusMutation.isPending}
                    onClick={() => handleRequestStatusChange(selectedAppointment, "waiting")}
                  >
                    <TimerReset size={16} />
                    <span>{chooseLocalized(language, "إرجاع للانتظار", "Back to waiting")}</span>
                  </Button>
                ) : null}
                {selectedAppointment.status === "completed" ? (
                  <Button
                    type="button"
                    variant="secondary"
                    disabled={statusMutation.isPending}
                    onClick={() => handleRequestStatusChange(selectedAppointment, "arrived", true)}
                  >
                    <RotateCcw size={16} />
                    <span>{chooseLocalized(language, "إعادة فتح", "Reopen as arrived")}</span>
                  </Button>
                ) : null}
                <Button
                  type="button"
                  variant="primary"
                  disabled={!canComplete || completeMutation.isPending}
                  onClick={() => handleRequestCompletion(selectedAppointment)}
                >
                  {completeMutation.isPending ? <RefreshCw size={16} className="animate-spin" /> : <CheckCircle2 size={16} />}
                  <span>{chooseLocalized(language, "إكمال", "Complete")}</span>
                </Button>
                <Button
                  type="button"
                  variant="secondary"
                  disabled={!canCloseAsProblem || statusMutation.isPending}
                  onClick={() => {
                    setStatusAction({ appointment: selectedAppointment, status: "discontinued", reasonRequired: true });
                    setStatusReason("");
                  }}
                >
                  <Ban size={16} />
                  <span>{chooseLocalized(language, "إيقاف", "Discontinue")}</span>
                </Button>
                <Button
                  type="button"
                  variant="secondary"
                  disabled={!canCloseAsProblem || statusMutation.isPending}
                  onClick={() => {
                    setStatusAction({ appointment: selectedAppointment, status: "cancelled", reasonRequired: true });
                    setStatusReason("");
                  }}
                >
                  <XCircle size={16} />
                  <span>{chooseLocalized(language, "إلغاء", "Cancel")}</span>
                </Button>
              </DialogFooter>
            </div>
          ) : null}
        </DialogContent>
      </Dialog>

      <Dialog
        open={Boolean(statusAction)}
        onClose={() => {
          setStatusAction(null);
          setStatusReason("");
        }}
      >
        <DialogContent maxWidth="560px">
          {statusAction ? (
            <>
              <DialogHeader>
                <DialogTitle>
                  {statusAction.status === "discontinued"
                    ? chooseLocalized(language, "تأكيد إيقاف الفحص", "Confirm discontinuation")
                    : statusAction.status === "arrived"
                      ? chooseLocalized(language, "إعادة فتح الموعد", "Reopen as arrived")
                      : statusAction.status === "waiting"
                        ? chooseLocalized(language, "إرجاع للانتظار", "Back to waiting")
                    : chooseLocalized(language, "تأكيد إلغاء الموعد", "Confirm cancellation")}
                </DialogTitle>
                <DialogDescription>
                  {chooseLocalized(language, statusAction.appointment.arabicFullName, statusAction.appointment.englishFullName)} • {statusAction.appointment.accessionNumber}
                </DialogDescription>
              </DialogHeader>
              <div className="mt-4 space-y-2">
                <label className="text-sm font-medium">{chooseLocalized(language, "السبب", "Reason")}</label>
                <textarea
                  value={statusReason}
                  onChange={(event) => setStatusReason(event.target.value)}
                  rows={3}
                  className="input-premium w-full resize-none"
                  placeholder={chooseLocalized(language, "اكتب السبب قبل التأكيد", "Enter a reason before confirming")}
                />
              </div>
              <DialogFooter>
                <Button
                  type="button"
                  variant="secondary"
                  onClick={() => {
                    setStatusAction(null);
                    setStatusReason("");
                  }}
                >
                  {t(language, "common.cancel")}
                </Button>
                <Button
                  type="button"
                  variant="primary"
                  disabled={(statusAction.reasonRequired && !statusReason.trim()) || statusMutation.isPending}
                  onClick={handleConfirmStatusAction}
                >
                  {statusMutation.isPending ? <RefreshCw size={18} className="animate-spin" /> : null}
                  <span>{chooseLocalized(language, "تأكيد", "Confirm")}</span>
                </Button>
              </DialogFooter>
            </>
          ) : null}
        </DialogContent>
      </Dialog>

      <Dialog
        open={confirmTargetId != null}
        onClose={() => {
          setConfirmTargetId(null);
          setConfirmVerified(false);
        }}
      >
        <DialogContent maxWidth="760px">
          {completionTarget ? (
            <>
              <DialogHeader>
                <div className="space-y-1">
                  <DialogTitle>{chooseLocalized(language, "تأكيد الإكمال", "Confirm completion")}</DialogTitle>
                  <DialogDescription>{chooseLocalized(language, "يرجى مراجعة معلومات المريض والفحص قبل تعليم أنه مكتمل.", "Review the patient and exam details before marking this case complete.")}</DialogDescription>
                </div>
              </DialogHeader>

              <div className="mt-4 space-y-4">
                <div className="rounded-[1.25rem] border border-slate-200 bg-slate-50 p-4">
                  <div className="flex flex-wrap items-center gap-2">
                    <h4 className="text-lg font-semibold text-foreground">
                      {chooseLocalized(language, completionTarget.arabicFullName, completionTarget.englishFullName)}
                    </h4>
                    <PatientCategoryBadge category={completionTarget.caseCategory} showWhenUnset={false} size="sm" />
                    {completionTarget.createdAt && completionTarget.updatedAt && completionTarget.createdAt !== completionTarget.updatedAt ? (
                      <Badge variant="warning" size="sm">
                        {t(language, "appointmentEditor.edited")}
                      </Badge>
                    ) : null}
                  </div>
                  <div className="mt-4 grid gap-3 sm:grid-cols-2">
                    <DetailField label={t(language, "modality.fieldAccession")} value={completionTarget.accessionNumber} />
                    <DetailField label={t(language, "modality.fieldModality")} value={chooseLocalized(language, completionTarget.modalityNameAr, completionTarget.modalityNameEn)} />
                    <DetailField label={t(language, "modality.fieldExam")} value={chooseLocalized(language, completionTarget.examNameAr, completionTarget.examNameEn) || t(language, "common.na")} />
                    <DetailField label={t(language, "modality.fieldPriority")} value={chooseLocalized(language, completionTarget.priorityNameAr, completionTarget.priorityNameEn) || t(language, "common.na")} />
                    <DetailField label={t(language, "modality.fieldPatient")} value={chooseLocalized(language, completionTarget.arabicFullName, completionTarget.englishFullName)} />
                    <DetailField label={t(language, "settings.fieldMRN")} value={completionTarget.mrn ?? null} />
                    <DetailField label={t(language, "settings.fieldNationalId")} value={completionTarget.nationalId ?? null} />
                    <DetailField label={t(language, "settings.fieldAge")} value={formatAgeSex(language, completionTarget)} />
                  </div>
                </div>

                <label className="flex cursor-pointer items-start gap-3 rounded-[1rem] border border-slate-200 bg-white px-4 py-3">
                  <Checkbox
                    checked={confirmVerified}
                    onChange={(event) => setConfirmVerified(event.target.checked)}
                  />
                  <span className="text-sm leading-6 text-foreground">
                    {chooseLocalized(language, "تم التحقق من هوية المريض وتفاصيل الفحص", "Patient identity and exam details have been verified.")}
                  </span>
                </label>
              </div>

              <DialogFooter>
                <Button
                  type="button"
                  variant="secondary"
                  onClick={() => {
                    setConfirmTargetId(null);
                    setConfirmVerified(false);
                  }}
                >
                  {t(language, "common.cancel")}
                </Button>
                <Button
                  type="button"
                  variant="primary"
                  disabled={!confirmVerified || completeMutation.isPending}
                  onClick={handleConfirmCompletion}
                >
                  {completeMutation.isPending ? (
                    <RefreshCw size={18} className="animate-spin" />
                  ) : (
                    <CheckCircle2 size={18} />
                  )}
                  <span>{chooseLocalized(language, "تأكيد الإكمال", "Confirm completion")}</span>
                </Button>
              </DialogFooter>
            </>
          ) : null}
        </DialogContent>
      </Dialog>
    </div>
  );
}

function MetricCard({
  label,
  value,
  tone,
  icon,
}: {
  label: string;
  value: number;
  tone: "amber" | "sky" | "indigo" | "emerald";
  icon: React.ReactNode;
}) {
  const toneClasses: Record<"amber" | "sky" | "indigo" | "emerald", string> = {
    amber: "border-amber-200 bg-amber-50 text-amber-700",
    sky: "border-sky-200 bg-sky-50 text-sky-700",
    indigo: "border-indigo-200 bg-indigo-50 text-indigo-700",
    emerald: "border-emerald-200 bg-emerald-50 text-emerald-700",
  };

  return (
    <div className={`rounded-xl border px-3 py-2 shadow-sm ${toneClasses[tone]}`}>
      <div className="flex items-center justify-between gap-3">
        <p className="text-[10px] uppercase tracking-[0.14em] opacity-80">{label}</p>
        {icon}
      </div>
      <p className="mt-1 text-xl font-semibold tracking-tight">{value}</p>
    </div>
  );
}

function DetailField({
  label,
  value,
}: {
  label: string;
  value: string | number | null | undefined;
}) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-white px-3 py-2.5">
      <p className="text-[10px] uppercase tracking-[0.16em] text-muted-foreground">{label}</p>
      <p className="mt-1 font-medium leading-6 text-foreground">{value ?? "—"}</p>
    </div>
  );
}

function SnapshotLine({
  label,
  value,
}: {
  label: string;
  value: number;
}) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3">
      <p className="text-xs uppercase tracking-[0.18em] text-muted-foreground">{label}</p>
      <p className="mt-2 text-2xl font-semibold text-foreground">{value}</p>
    </div>
  );
}
