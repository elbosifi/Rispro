import { useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  BadgeCheck,
  Ban,
  CheckCircle2,
  Clock3,
  MoreHorizontal,
  Printer,
  RefreshCw,
  RotateCcw,
  ScanLine,
  TimerReset,
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
import { fetchAppointmentLookups, fetchModalityProtocolAssignment, fetchModalityWorklist, fetchStatistics, completeAppointment, updateAppointmentStatus } from "@/lib/api-hooks";
import { printAppointmentSlipById } from "@/lib/appointment-printing";
import { chooseLocalized, t } from "@/lib/i18n";
import type { Language } from "@/lib/i18n";
import { formatDateLy, todayIsoDateLy } from "@/lib/date-format";
import type { AppointmentWithDetails } from "@/lib/mappers";
import type { AppointmentLookups, AppointmentStatus, ModalityProtocolAssignment } from "@/types/api";
import { useLanguage } from "@/providers/language-provider";

const ACTIVE_STATUSES = new Set<AppointmentStatus>(["waiting", "arrived", "in-progress"]);
const LIVE_BOARD_STATUSES = new Set<AppointmentStatus>(["in-progress", "arrived", "waiting", "scheduled"]);
const PROBLEM_STATUSES = new Set<AppointmentStatus>(["no-show", "cancelled", "discontinued"]);
const EMPTY_VALUE = "—";

type BoardFilter = "operational" | "ready" | "waiting" | "arrived" | "in-progress" | "not-arrived" | "completed" | "problem" | "all";
type BoardStatusAction = {
  appointment: AppointmentWithDetails;
  status: "arrived" | "waiting" | "discontinued";
  reasonRequired: boolean;
};
type MoreMenuState = {
  appointmentId: number;
  top: number;
  left: number;
};
type WaitingDurationInfo = {
  value: string;
  source: string;
  title: string;
};
type WaitingWarningInfo = {
  level: "mild" | "strong";
  title: string;
};
type RowFlag = {
  label: string;
  title: string;
  variant: "warning" | "info" | "neutral";
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
    case "waiting":
      return appointment.status === "waiting";
    case "arrived":
      return appointment.status === "arrived";
    case "in-progress":
      return appointment.status === "in-progress";
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

function relatedAppointmentBadgeText(
  language: Language,
  appointment: NonNullable<AppointmentWithDetails["relatedAppointments"]>[number]
): string {
  return chooseLocalized(language, appointment.modalityNameAr, appointment.modalityNameEn) || appointment.accessionNumber;
}

function isProtocolModality(appointment: AppointmentWithDetails | null): boolean {
  const code = appointment?.modalityCode?.toUpperCase();
  return code === "CT" || code === "MRI";
}

function protocolVersionLabel(name: string, version: string): string {
  return `${name} v${version}`;
}

function effectiveValue(override: string | null | undefined, fallback: string | number | null | undefined): string | null {
  const cleanOverride = override?.trim();
  if (cleanOverride) return cleanOverride;
  if (fallback == null) return null;
  const value = String(fallback).trim();
  return value || null;
}

function defaultText(value: string | number | null | undefined): string | null {
  if (value == null) return null;
  const text = String(value).trim();
  return text || null;
}

function formatDurationMinutes(language: Language, elapsedMinutes: number): string {
  const hours = Math.floor(elapsedMinutes / 60);
  const minutes = elapsedMinutes % 60;
  if (hours > 0) {
    return language === "ar" ? `${hours}س ${minutes}د` : `${hours}h ${minutes}m`;
  }
  return language === "ar" ? `${minutes}د` : `${minutes}m`;
}

function waitingSourceLabel(language: Language, source: "live" | "pacs_start" | "pacs_first_seen" | "manual" | "manual_fallback"): string {
  switch (source) {
    case "live":
      return chooseLocalized(language, "انتظار مباشر", "Live waiting");
    case "pacs_start":
      return chooseLocalized(language, "بداية الدراسة من PACS", "PACS study start");
    case "pacs_first_seen":
      return chooseLocalized(language, "أول ظهور في PACS / تقريبي", "PACS first seen / approximate");
    case "manual":
      return chooseLocalized(language, "إكمال يدوي", "Manual complete");
    case "manual_fallback":
      return chooseLocalized(language, "إكمال يدوي احتياطي", "Manual complete fallback");
  }
}

function waitingDurationInfo(language: Language, appointment: AppointmentWithDetails, now: Date): WaitingDurationInfo | null {
  const arrivedAt = timestampValue(appointment.arrivedAt);
  if (arrivedAt == null) return null;

  let endpoint: number | null = null;
  let source: string | null = null;

  if (ACTIVE_STATUSES.has(appointment.status)) {
    endpoint = now.getTime();
    source = waitingSourceLabel(language, "live");
  } else if (appointment.status === "completed") {
    if (appointment.pacsAutoCompletionEnabled) {
      const pacsStartedAt = timestampValue(appointment.pacsStudyStartedAt);
      const pacsFirstSeenAt = timestampValue(appointment.pacsFirstSeenAt);
      const completedAt = timestampValue(appointment.completedAt);
      if (pacsStartedAt != null) {
        endpoint = pacsStartedAt;
        source = waitingSourceLabel(language, "pacs_start");
      } else if (pacsFirstSeenAt != null) {
        endpoint = pacsFirstSeenAt;
        source = waitingSourceLabel(language, "pacs_first_seen");
      } else if (completedAt != null) {
        endpoint = completedAt;
        source = waitingSourceLabel(language, "manual_fallback");
      }
    } else {
      endpoint = timestampValue(appointment.completedAt);
      source = endpoint == null ? null : waitingSourceLabel(language, "manual");
    }
  }

  if (endpoint == null || source == null || endpoint < arrivedAt) return null;
  const elapsedMinutes = Math.floor((endpoint - arrivedAt) / 60_000);
  const value = formatDurationMinutes(language, elapsedMinutes);
  return {
    value,
    source,
    title: `${value} - ${source}`,
  };
}

function waitingWarningInfo(language: Language, appointment: AppointmentWithDetails, now: Date): WaitingWarningInfo | null {
  if (!ACTIVE_STATUSES.has(appointment.status)) return null;
  const arrivedAt = timestampValue(appointment.arrivedAt);
  if (arrivedAt == null) return null;

  const elapsedMinutes = Math.floor((now.getTime() - arrivedAt) / 60_000);
  if (elapsedMinutes > 60) {
    return {
      level: "strong",
      title: chooseLocalized(language, "الانتظار أكثر من 60 دقيقة", "Waiting more than 60 minutes"),
    };
  }
  if (elapsedMinutes > 30) {
    return {
      level: "mild",
      title: chooseLocalized(language, "الانتظار أكثر من 30 دقيقة", "Waiting more than 30 minutes"),
    };
  }
  return null;
}

function timingFlags(language: Language, appointment: AppointmentWithDetails): RowFlag[] {
  if (appointment.status !== "completed" || !appointment.pacsAutoCompletionEnabled) return [];
  if (timestampValue(appointment.pacsStudyStartedAt) != null) return [];
  if (timestampValue(appointment.pacsFirstSeenAt) != null) {
    return [{
      label: chooseLocalized(language, "تقريبي", "Approx"),
      title: chooseLocalized(language, "أول ظهور في PACS تقريبي", "PACS first seen is approximate"),
      variant: "info",
    }];
  }
  if (timestampValue(appointment.completedAt) != null) {
    return [{
      label: chooseLocalized(language, "إكمال يدوي احتياطي", "Manual fallback"),
      title: chooseLocalized(
        language,
        "تم استخدام الإكمال اليدوي لأن توقيت بداية الدراسة من PACS غير متاح",
        "Manual complete fallback used because PACS study-start timing was unavailable"
      ),
      variant: "warning",
    }];
  }
  return [{
    label: chooseLocalized(language, "توقيت مفقود", "Timing missing"),
    title: chooseLocalized(language, "توقيت PACS مفقود", "PACS timing missing"),
    variant: "warning",
  }];
}

function priorityDisplay(language: Language, appointment: Pick<AppointmentWithDetails, "priorityNameAr" | "priorityNameEn">): string {
  return chooseLocalized(language, appointment.priorityNameAr, appointment.priorityNameEn) || chooseLocalized(language, "روتيني", "Routine");
}

function primaryIdentifierText(language: Language, appointment: AppointmentWithDetails): string {
  const value = appointment.patientPrimaryIdentifierValue?.trim();
  if (!value) return chooseLocalized(language, "لا يوجد معرف أساسي", "No primary ID");
  const label = chooseLocalized(
    language,
    appointment.patientPrimaryIdentifierLabelAr,
    appointment.patientPrimaryIdentifierLabelEn
  ) || appointment.patientPrimaryIdentifierType || chooseLocalized(language, "المعرف الأساسي", "Primary ID");
  return `${label}: ${value}`;
}

function hasPrimaryIdentifier(appointment: AppointmentWithDetails): boolean {
  return Boolean(appointment.patientPrimaryIdentifierValue?.trim());
}

function boardFilterLabel(language: Language, filter: BoardFilter): string {
  switch (filter) {
    case "operational":
      return chooseLocalized(language, "تشغيلي", "Operational");
    case "ready":
      return chooseLocalized(language, "جاهز", "Arrived/Ready");
    case "waiting":
      return t(language, "status.waiting");
    case "arrived":
      return t(language, "status.arrived");
    case "in-progress":
      return t(language, "status.in-progress");
    case "not-arrived":
      return chooseLocalized(language, "لم يصل", "Not arrived");
    case "completed":
      return t(language, "status.completed");
    case "problem":
      return chooseLocalized(language, "مشكلة", "Problem");
    case "all":
      return chooseLocalized(language, "الكل", "All");
    default:
      return "";
  }
}

function statusActionLabel(language: Language, action: BoardStatusAction): string {
  switch (action.status) {
    case "discontinued":
      return chooseLocalized(language, "تأكيد إيقاف الحالة", "Confirm discontinuation");
    case "arrived":
      return chooseLocalized(language, "تأكيد إعادة فتح الموعد", "Confirm reopen");
    case "waiting":
      return chooseLocalized(language, "تأكيد الرجوع للانتظار", "Confirm return to waiting");
    default:
      return chooseLocalized(language, "تأكيد", "Confirm");
  }
}

function relatedAppointmentTitle(
  language: Language,
  appointment: NonNullable<AppointmentWithDetails["relatedAppointments"]>[number]
): string {
  const modality = chooseLocalized(language, appointment.modalityNameAr, appointment.modalityNameEn);
  const exam = chooseLocalized(language, appointment.examNameAr, appointment.examNameEn);
  return [
    modality,
    exam,
    appointment.accessionNumber,
    normalizeStatusLabel(language, appointment.appointmentStatus),
  ].filter(Boolean).join(" - ");
}

function rowStatusClass(status: AppointmentStatus, selected: boolean): string {
  const selectedClass = selected ? "ring-1 ring-accent/40" : "";
  switch (status) {
    case "in-progress":
      return `border-s-4 border-s-indigo-500 bg-indigo-50/90 hover:bg-indigo-50 ${selectedClass}`.trim();
    case "arrived":
    case "waiting":
      return `border-s-4 border-s-sky-400 bg-sky-50/80 hover:bg-sky-50 ${selectedClass}`.trim();
    case "scheduled":
      return `border-s-4 border-s-slate-300 bg-slate-50/70 text-slate-700 hover:bg-slate-100 ${selectedClass}`.trim();
    case "completed":
      return `border-s-4 border-s-emerald-300 bg-emerald-50/45 text-slate-600 hover:bg-emerald-50/70 ${selectedClass}`.trim();
    case "no-show":
      return `border-s-4 border-s-amber-400 bg-amber-50/70 text-slate-700 hover:bg-amber-50 ${selectedClass}`.trim();
    case "cancelled":
    case "discontinued":
    case "voided":
      return `border-s-4 border-s-rose-300 bg-rose-50/45 text-slate-600 hover:bg-rose-50/70 ${selectedClass}`.trim();
    default:
      return `border-s-4 border-s-transparent bg-white hover:bg-slate-50 ${selectedClass}`.trim();
  }
}

function waitingWarningClass(level: WaitingWarningInfo["level"] | null): string {
  switch (level) {
    case "strong":
      return "border-s-orange-500 bg-orange-50/90 hover:bg-orange-50 ring-1 ring-orange-200/70";
    case "mild":
      return "border-s-amber-400 bg-amber-50/80 hover:bg-amber-50";
    default:
      return "";
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
  const [openMoreMenu, setOpenMoreMenu] = useState<MoreMenuState | null>(null);
  const [elapsedNow, setElapsedNow] = useState(() => new Date());

  const { data: lookups } = useQuery<AppointmentLookups>({
    queryKey: ["lookups"],
    queryFn: fetchAppointmentLookups,
    staleTime: 1000 * 60 * 5,
  });

  const {
    data: appointments = [],
    isLoading,
    isFetching,
    dataUpdatedAt,
  } = useQuery({
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
  const selectedProtocolQuery = useQuery({
    queryKey: ["modality", "protocol-assignment", selectedAppointmentId],
    queryFn: () => fetchModalityProtocolAssignment(selectedAppointmentId as number),
    enabled: selectedAppointmentId != null && isProtocolModality(selectedAppointment),
  });

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

  useEffect(() => {
    const timer = window.setInterval(() => setElapsedNow(new Date()), 30_000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    if (!openMoreMenu) return;

    const closeMenu = () => setOpenMoreMenu(null);
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") closeMenu();
    };

    document.addEventListener("click", closeMenu);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("click", closeMenu);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [openMoreMenu]);

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
    mutationFn: ({ appointmentId, status, reason }: { appointmentId: number; status: "arrived" | "waiting" | "discontinued"; reason?: string | null }) =>
      updateAppointmentStatus(appointmentId, status, reason),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["modality-worklist"] });
      await queryClient.invalidateQueries({ queryKey: ["modality-statistics"] });
      await queryClient.invalidateQueries({ queryKey: ["queue"] });
      await queryClient.invalidateQueries({ queryKey: ["calendar"] });
      await queryClient.invalidateQueries({ queryKey: ["registrations"] });
      setStatusAction(null);
      setStatusReason("");
      setOpenMoreMenu(null);
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
  const initialWorklistLoading = isLoading && appointments.length === 0;

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

  const handleClearStatusFilter = () => {
    setBoardFilter("operational");
  };

  const handleResetView = () => {
    setBoardFilter("operational");
    setDate(todayIsoDateLy());
    setScope("day");
    setSelectedAppointmentId(null);
    setConfirmTargetId(null);
    setConfirmVerified(false);
    setOpenMoreMenu(null);
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
    status: "arrived" | "waiting" | "discontinued",
    reasonRequired = false
  ) => {
    if (reasonRequired) {
      setStatusAction({ appointment, status, reasonRequired });
      setStatusReason("");
      return;
    }
    statusMutation.mutate({ appointmentId: appointment.id, status, reason: null });
  };

  const handleOpenMoreMenu = (event: React.MouseEvent<HTMLButtonElement>, appointment: AppointmentWithDetails) => {
    event.stopPropagation();
    const rect = event.currentTarget.getBoundingClientRect();
    const menuWidth = 176;
    const viewportPadding = 8;
    const preferredLeft = isArabic ? rect.left : rect.right - menuWidth;
    const maxLeft = window.innerWidth - menuWidth - viewportPadding;
    setOpenMoreMenu((current) => current?.appointmentId === appointment.id
      ? null
      : {
          appointmentId: appointment.id,
          top: rect.bottom + 6,
          left: Math.max(viewportPadding, Math.min(preferredLeft, maxLeft)),
        });
  };

  const modalities = lookups?.modalities ?? [];
  const today = todayIsoDateLy();
  const headerTitle = t(language, "modality.title");
  const currentModality = modalities.find((modality) => String(modality.id) === modalityId);
  const currentModalityLabel = currentModality
    ? chooseLocalized(language, currentModality.nameAr, currentModality.nameEn) || currentModality.code || `Modality ${currentModality.id}`
    : "";
  const activeFilterParts = [
    currentModalityLabel,
    scope === "all" ? t(language, "modality.scopeAll") : date !== today ? date : "",
    boardFilter !== "operational" ? boardFilterLabel(language, boardFilter) : "",
  ].filter(Boolean);
  const hasActiveFilters = boardFilter !== "operational" || scope !== "day" || date !== today;
  const lastRefreshedText = dataUpdatedAt > 0
    ? new Date(dataUpdatedAt).toLocaleTimeString(language === "ar" ? "ar-LY" : "en-GB", { hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false })
    : EMPTY_VALUE;
  const headerCounterChips = [
    { filter: "waiting" as const, label: t(language, "status.waiting"), value: waitingStatisticsCount, className: "border-amber-200 bg-amber-50 text-amber-800 hover:bg-amber-100" },
    { filter: "arrived" as const, label: t(language, "status.arrived"), value: arrivedStatisticsCount, className: "border-sky-200 bg-sky-50 text-sky-800 hover:bg-sky-100" },
    { filter: "in-progress" as const, label: t(language, "status.in-progress"), value: inProgressStatisticsCount, className: "border-indigo-200 bg-indigo-50 text-indigo-800 hover:bg-indigo-100" },
    { filter: "completed" as const, label: t(language, "status.completed"), value: completedCount, className: "border-emerald-200 bg-emerald-50 text-emerald-800 hover:bg-emerald-100" },
  ];
  const selectedName = selectedAppointment ? chooseLocalized(language, selectedAppointment.arabicFullName, selectedAppointment.englishFullName) : "";
  const selectedModality = selectedAppointment ? chooseLocalized(language, selectedAppointment.modalityNameAr, selectedAppointment.modalityNameEn) : "";
  const selectedExam = selectedAppointment ? chooseLocalized(language, selectedAppointment.examNameAr, selectedAppointment.examNameEn) || t(language, "common.na") : "";
  const selectedPriority = selectedAppointment ? priorityDisplay(language, selectedAppointment) : "";
  const moreMenuAppointment = openMoreMenu
    ? boardAppointments.find((appointment) => appointment.id === openMoreMenu.appointmentId) ?? null
    : null;

  return (
    <div data-testid="modality-page-root" className="min-h-screen bg-[radial-gradient(circle_at_top_left,rgba(37,99,235,0.10),transparent_26%),radial-gradient(circle_at_top_right,rgba(14,165,233,0.08),transparent_20%),linear-gradient(180deg,rgba(248,250,252,1),rgba(241,245,249,1))]" dir={isArabic ? "rtl" : "ltr"}>
      <div className="mx-auto flex min-h-screen w-full max-w-[1680px] flex-col gap-3 p-3 sm:p-4 lg:p-5">
        <header data-testid="modality-board-header" className="rounded-2xl border border-slate-200/80 bg-white/90 px-4 py-3 shadow-[0_12px_30px_rgba(15,23,42,0.06)] backdrop-blur-md">
          <div className={`flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between ${isArabic ? "xl:flex-row-reverse" : ""}`}>
            <div className={`flex items-center gap-3 ${isArabic ? "flex-row-reverse" : ""}`}>
              <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-[linear-gradient(135deg,var(--accent),var(--accent-secondary))] text-white shadow-sm">
                <span className="text-xs font-bold tracking-[0.18em]">NCCB</span>
              </div>

              <div>
                <p className="text-xs uppercase tracking-[0.18em] text-muted-foreground">{chooseLocalized(language, "لوحة العمل", "Worklist board")}</p>
                <h1 className="font-display text-xl font-semibold tracking-tight text-foreground">{headerTitle}</h1>
                <p className="mt-1 text-xs font-medium text-muted-foreground">
                  {[currentModalityLabel || chooseLocalized(language, "لم يتم اختيار جهاز", "No modality selected"), scope === "all" ? t(language, "modality.scopeAll") : date].join(" • ")}
                </p>
              </div>
            </div>

            <div className={`flex flex-wrap items-center justify-end gap-2 ${isArabic ? "flex-row-reverse" : ""}`}>
              <div className={`flex flex-wrap items-center gap-1.5 ${isArabic ? "flex-row-reverse" : ""}`}>
                {headerCounterChips.map((chip) => (
                  <button
                    key={chip.filter}
                    type="button"
                    aria-label={`${chip.label} ${chip.value}`}
                    aria-pressed={boardFilter === chip.filter}
                    onClick={() => setBoardFilter(chip.filter)}
                    className={`inline-flex h-8 items-center gap-1.5 rounded-full border px-2.5 text-xs font-semibold transition ${chip.className} ${
                      boardFilter === chip.filter ? "ring-2 ring-accent/35" : ""
                    }`}
                  >
                    <span>{chip.label}</span>
                    <span className="font-mono text-sm">{chip.value}</span>
                  </button>
                ))}
              </div>

              <div className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2">
                <div className="flex items-center gap-2 text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
                  <Clock3 size={14} />
                  <span>{chooseLocalized(language, "الوقت الحالي", "Current time")}</span>
                </div>
                <p className="mt-0.5 text-base font-semibold text-foreground">{new Date().toLocaleTimeString(language === "ar" ? "ar-LY" : "en-GB", { hour: "2-digit", minute: "2-digit", hour12: false })}</p>
                <p className="mt-0.5 text-[10px] font-medium text-muted-foreground">
                  {chooseLocalized(language, "آخر تحديث", "Last refreshed")} {lastRefreshedText}
                </p>
              </div>

              <Button variant="primary" size="sm" onClick={handleRefresh} disabled={isFetching} className="rounded-xl px-3 shadow-sm">
                <RefreshCw size={16} className={isFetching ? "animate-spin" : ""} />
                <span>{isFetching ? chooseLocalized(language, "جار التحديث", "Refreshing") : t(language, "modality.refresh")}</span>
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

            <section
              data-testid="modality-board-section"
              dir={isArabic ? "rtl" : "ltr"}
              className="rounded-xl border border-slate-200/80 bg-white/94"
            >
              <div className="flex flex-wrap items-center justify-between gap-2 px-3 py-2 text-start">
                <div className="text-start">
                  <p className="text-[10px] uppercase tracking-[0.16em] text-muted-foreground">{chooseLocalized(language, "لوحة الأجهزة", "Modality board")}</p>
                </div>
                <div className="flex flex-wrap items-center gap-1.5">
                  {([
                    ["operational", chooseLocalized(language, "نشط", "Operational")],
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
                </div>
              </div>

              {hasActiveFilters ? (
                <div
                  data-testid="modality-active-filters"
                  className={`flex flex-wrap items-center justify-between gap-2 border-t border-slate-200 bg-amber-50/70 px-3 py-2 text-xs ${isArabic ? "flex-row-reverse" : ""}`}
                >
                  <div className={`flex flex-wrap items-center gap-2 font-medium text-amber-900 ${isArabic ? "flex-row-reverse" : ""}`}>
                    <span className="uppercase tracking-[0.12em] text-amber-700">{chooseLocalized(language, "الفلاتر النشطة", "Active filters")}:</span>
                    <span>{activeFilterParts.join(" • ")}</span>
                  </div>
                  <div className={`flex flex-wrap items-center gap-1.5 ${isArabic ? "flex-row-reverse" : ""}`}>
                    {boardFilter !== "operational" ? (
                      <Button type="button" variant="secondary" size="sm" onClick={handleClearStatusFilter} className="h-7 px-2 text-[11px]">
                        {chooseLocalized(language, "مسح الحالة", "Clear status")}
                      </Button>
                    ) : null}
                    <Button type="button" variant="secondary" size="sm" onClick={handleResetView} className="h-7 px-2 text-[11px]">
                      {chooseLocalized(language, "إعادة العرض", "Reset view")}
                    </Button>
                  </div>
                </div>
              ) : null}

              <div className="border-t border-slate-200">
                {initialWorklistLoading ? (
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
                  <div data-testid="modality-board-table-wrap" dir={isArabic ? "rtl" : "ltr"} className="overflow-x-auto">
                    <table data-testid="modality-board" dir={isArabic ? "rtl" : "ltr"} className="min-w-[1400px] table-fixed text-start text-[11px]">
                      <thead className="sticky top-0 z-10 bg-slate-100 text-[10px] uppercase tracking-[0.12em] text-muted-foreground shadow-sm">
                        <tr>
                          <th className="w-[84px] px-2 py-2 font-semibold">{chooseLocalized(language, "رقم الوصول", "Arrival #")}</th>
                          <th className="w-[132px] px-2 py-2 font-semibold">{chooseLocalized(language, "الحالة", "Status")}</th>
                          <th className="w-[112px] px-2 py-2 font-semibold">{chooseLocalized(language, "وقت الوصول", "Arrival time")}</th>
                          <th className="w-[100px] px-2 py-2 font-semibold">{chooseLocalized(language, "مدة الانتظار", "Waiting duration")}</th>
                          <th className="w-[220px] px-2 py-2 font-semibold">{chooseLocalized(language, "المريض", "Patient")}</th>
                          <th className="w-[170px] px-2 py-2 font-semibold">{chooseLocalized(language, "المعرف الأساسي", "Primary ID")}</th>
                          <th className="w-[115px] px-2 py-2 font-semibold">{chooseLocalized(language, "العمر / الجنس", "Age / sex")}</th>
                          <th className="w-[190px] px-2 py-2 font-semibold">{chooseLocalized(language, "الفحص", "Exam")}</th>
                          <th className="w-[190px] px-2 py-2 font-semibold">Protocol</th>
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
                      const relatedAppointments = (appointment.relatedAppointments ?? []).filter((related) => related.appointmentId !== appointment.id);
                      const waitingInfo = waitingDurationInfo(language, appointment, elapsedNow);
                      const waitingWarning = waitingWarningInfo(language, appointment, elapsedNow);
                      const rowFlags = timingFlags(language, appointment);
                      const missingPrimaryIdentifier = !hasPrimaryIdentifier(appointment);
                      const englishName = appointment.englishFullName?.trim();
                      const showEnglishName = Boolean(englishName && englishName !== appointment.arabicFullName?.trim());
                      return (
                            <tr
                              key={appointment.id}
                              ref={selected ? selectedRef : undefined}
                              data-testid={`modality-board-row-${appointment.id}`}
                              data-waiting-warning={waitingWarning?.level}
                              title={waitingWarning?.title}
                              tabIndex={0}
                              onClick={() => {
                                setOpenMoreMenu(null);
                                setSelectedAppointmentId(appointment.id);
                              }}
                              onKeyDown={(event) => {
                                if (event.key === "Enter" || event.key === " ") {
                                  event.preventDefault();
                                  setSelectedAppointmentId(appointment.id);
                                }
                              }}
                              className={`cursor-pointer align-top transition-colors ${rowStatusClass(appointment.status, selected)} ${waitingWarningClass(waitingWarning?.level ?? null)}`}
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
                                  {rowFlags.map((flag) => (
                                    <Badge key={flag.label} variant={flag.variant} size="sm" title={flag.title} className="text-[10px]">
                                      {flag.label}
                                    </Badge>
                                  ))}
                                </div>
                              </td>
                              <td className="px-2 py-1 font-mono text-[11px] text-slate-700">
                                <p>{formatArrivalColumn(language, appointment)}</p>
                              </td>
                              <td className="px-2 py-1 text-slate-700">
                                {waitingInfo ? (
                                  <div title={waitingInfo.title} className="leading-tight">
                                    <p className="font-mono text-xs font-semibold text-slate-900">{waitingInfo.value}</p>
                                    <p className="mt-0.5 text-[10px] font-medium text-muted-foreground">{waitingInfo.source}</p>
                                  </div>
                                ) : (
                                  <span className="font-mono text-[11px] text-muted-foreground">{EMPTY_VALUE}</span>
                                )}
                              </td>
                              <td className="px-2 py-1">
                                <p className="text-sm font-bold leading-snug text-foreground">{appointment.arabicFullName}</p>
                                {showEnglishName ? (
                                  <p className="text-xs font-medium leading-snug text-slate-600">{englishName}</p>
                                ) : null}
                                <p className="text-[10px] text-muted-foreground">{formatDateLy(appointment.appointmentDate)}</p>
                                {appointment.hasMultipleAppointments && relatedAppointments.length > 0 ? (
                                  <div className="mt-1 flex flex-wrap gap-1">
                                    {relatedAppointments.slice(0, 3).map((related) => (
                                      <Badge
                                        key={related.appointmentId}
                                        variant="info"
                                        size="sm"
                                        title={relatedAppointmentTitle(language, related)}
                                        aria-label={relatedAppointmentTitle(language, related)}
                                        className="text-[10px]"
                                      >
                                        {relatedAppointmentBadgeText(language, related)}
                                      </Badge>
                                    ))}
                                  </div>
                                ) : null}
                              </td>
                              <td className="px-2 py-1 text-xs font-medium text-slate-800">
                                {missingPrimaryIdentifier ? (
                                  <Badge
                                    variant="warning"
                                    size="sm"
                                    title={chooseLocalized(language, "المعرف الأساسي مفقود", "Primary identifier is missing")}
                                    className="text-[10px]"
                                  >
                                    {chooseLocalized(language, "لا يوجد معرف أساسي", "No primary ID")}
                                  </Badge>
                                ) : (
                                  primaryIdentifierText(language, appointment)
                                )}
                              </td>
                              <td className="px-2 py-1 text-xs font-medium text-slate-700">{formatAgeSex(language, appointment).replace(t(language, "common.na"), EMPTY_VALUE)}</td>
                              <td className="px-2 py-1 text-xs font-semibold leading-snug text-slate-800">{chooseLocalized(language, appointment.examNameAr, appointment.examNameEn) || EMPTY_VALUE}</td>
                              <td className="px-2 py-1 text-[11px] text-slate-700">
                                {appointment.protocolAssignmentSummary ? (
                                  <div className="space-y-0.5">
                                    <Badge variant="info" size="sm">
                                      Protocol: {protocolVersionLabel(appointment.protocolAssignmentSummary.protocolName, appointment.protocolAssignmentSummary.versionNumber)}
                                    </Badge>
                                    {appointment.protocolAssignmentSummary.scannerName ? (
                                      <p className="text-[10px] text-muted-foreground">Scanner: {appointment.protocolAssignmentSummary.scannerName}</p>
                                    ) : null}
                                    {appointment.protocolAssignmentSummary.protocolNotes || appointment.protocolAssignmentSummary.contrastNotes ? (
                                      <p className="text-[10px] text-muted-foreground">Notes available</p>
                                    ) : null}
                                  </div>
                                ) : isProtocolModality(appointment) ? (
                                  <span className="text-[10px] text-muted-foreground">No protocol assigned</span>
                                ) : (
                                  <span className="text-xs text-muted-foreground">{EMPTY_VALUE}</span>
                                )}
                              </td>
                              <td className="px-2 py-1 text-[11px] font-semibold text-slate-700">{priorityDisplay(language, appointment)}</td>
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
                                <div className="relative flex items-center gap-1 whitespace-nowrap">
                                  <Button
                                    type="button"
                                    variant="secondary"
                                    size="sm"
                                    aria-label={t(language, "common.print")}
                                    title={t(language, "common.print")}
                                    className="h-8 border border-slate-300 bg-white px-2 text-[11px] text-slate-800"
                                    onClick={(event) => {
                                      event.stopPropagation();
                                      handlePrint(appointment.id);
                                    }}
                                  >
                                    <Printer size={14} />
                                    <span>{t(language, "common.print")}</span>
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
                                  {canAct || appointment.status === "completed" ? (
                                    <Button
                                      type="button"
                                      variant="secondary"
                                      size="sm"
                                      aria-label={chooseLocalized(language, "إجراءات إضافية", "More actions")}
                                      title={chooseLocalized(language, "إجراءات إضافية", "More actions")}
                                      className="h-8 border border-slate-300 bg-white px-2 text-[11px] text-slate-800"
                                      disabled={statusMutation.isPending}
                                      onClick={(event) => handleOpenMoreMenu(event, appointment)}
                                    >
                                      <MoreHorizontal size={14} />
                                      <span>{chooseLocalized(language, "المزيد", "More")}</span>
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
            </section>
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
                        <span>{chooseLocalized(language, "إيقاف الحالة", "Discontinue")}</span>
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
                  label={chooseLocalized(language, "الحالات النشطة", "Active cases")}
                  value={liveCount}
                />
                <SnapshotLine
                  label={chooseLocalized(language, "الحالات السابقة / الاستثناءات", "Previous / exceptions")}
                  value={historyCount}
                />
              </div>
            </Card>
          </aside>
        </main>
      </div>

      {openMoreMenu && moreMenuAppointment ? (
        <div
          role="menu"
          dir={isArabic ? "rtl" : "ltr"}
          className={`fixed z-[80] min-w-44 rounded-xl border border-slate-200 bg-white p-1 shadow-2xl ${isArabic ? "text-end" : "text-start"}`}
          style={{ top: openMoreMenu.top, left: openMoreMenu.left }}
          onClick={(event) => event.stopPropagation()}
        >
          {isActiveStatus(moreMenuAppointment.status) ? (
            <>
              <button
                type="button"
                role="menuitem"
                className={`flex w-full items-center gap-2 rounded-lg px-3 py-2 text-xs text-amber-900 hover:bg-amber-50 ${isArabic ? "flex-row-reverse text-end" : "text-start"}`}
                disabled={statusMutation.isPending}
                onClick={() => {
                  setStatusAction({ appointment: moreMenuAppointment, status: "discontinued", reasonRequired: true });
                  setStatusReason("");
                  setOpenMoreMenu(null);
                }}
              >
                <Ban size={14} />
                <span>{chooseLocalized(language, "إيقاف الحالة", "Stop")}</span>
              </button>
            </>
          ) : null}
          {moreMenuAppointment.status === "arrived" ? (
            <button
              type="button"
              role="menuitem"
              className={`flex w-full items-center gap-2 rounded-lg px-3 py-2 text-xs hover:bg-slate-50 ${isArabic ? "flex-row-reverse text-end" : "text-start"}`}
              disabled={statusMutation.isPending}
              onClick={() => {
                setOpenMoreMenu(null);
                handleRequestStatusChange(moreMenuAppointment, "waiting");
              }}
            >
              <TimerReset size={14} />
              <span>{chooseLocalized(language, "انتظار", "Wait")}</span>
            </button>
          ) : null}
          {moreMenuAppointment.status === "completed" ? (
            <button
              type="button"
              role="menuitem"
              className={`flex w-full items-center gap-2 rounded-lg px-3 py-2 text-xs hover:bg-slate-50 ${isArabic ? "flex-row-reverse text-end" : "text-start"}`}
              disabled={statusMutation.isPending}
              onClick={() => {
                setOpenMoreMenu(null);
                handleRequestStatusChange(moreMenuAppointment, "arrived", true);
              }}
            >
              <RotateCcw size={14} />
              <span>{chooseLocalized(language, "إعادة فتح", "Reopen")}</span>
            </button>
          ) : null}
        </div>
      ) : null}

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

              {isProtocolModality(selectedAppointment) ? (
                <ProtocolAssignmentPanel
                  assignment={selectedProtocolQuery.data ?? null}
                  isLoading={selectedProtocolQuery.isLoading || selectedProtocolQuery.isFetching}
                />
              ) : null}

              <DialogFooter>
                <Button
                  type="button"
                  variant="secondary"
                  onClick={() => setSelectedAppointmentId(null)}
                >
                  <span>{chooseLocalized(language, "إغلاق", "Close")}</span>
                </Button>
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
                  className="border border-amber-300 bg-amber-50 text-amber-900 hover:bg-amber-100"
                >
                  <Ban size={16} />
                  <span>{chooseLocalized(language, "إيقاف الحالة", "Discontinue")}</span>
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
                  {statusActionLabel(language, statusAction)}
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
                  {chooseLocalized(language, "إغلاق", "Close")}
                </Button>
                <Button
                  type="button"
                  variant="primary"
                  disabled={(statusAction.reasonRequired && !statusReason.trim()) || statusMutation.isPending}
                  onClick={handleConfirmStatusAction}
                >
                  {statusMutation.isPending ? <RefreshCw size={18} className="animate-spin" /> : null}
                  <span>{statusActionLabel(language, statusAction)}</span>
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
                    <DetailField label={t(language, "modality.fieldPriority")} value={priorityDisplay(language, completionTarget)} />
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

function ValueWithPreset({
  value,
  preset,
}: {
  value: string | null;
  preset?: string | null;
}) {
  return (
    <div>
      <p>{value ?? EMPTY_VALUE}</p>
      {preset && preset !== value ? <p className="text-[10px] text-muted-foreground">Preset: {preset}</p> : null}
    </div>
  );
}

function ProtocolAssignmentPanel({
  assignment,
  isLoading,
}: {
  assignment: ModalityProtocolAssignment | null;
  isLoading: boolean;
}) {
  if (isLoading) {
    return (
      <section className="mt-4 rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-muted-foreground">
        Loading assigned protocol...
      </section>
    );
  }

  if (!assignment) {
    return (
      <section className="mt-4 rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-muted-foreground">
        No protocol assigned
      </section>
    );
  }

  const scanner = [assignment.scannerName, assignment.scannerVendor].filter(Boolean).join(" - ");

  return (
    <section className="mt-4 rounded-2xl border border-slate-200 bg-slate-50 p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-[10px] uppercase tracking-[0.16em] text-muted-foreground">Read-only protocol</p>
          <h3 className="mt-1 text-base font-semibold text-foreground">
            {assignment.modality === "CT" ? "Assigned CT Protocol" : "Assigned MRI Protocol"}
          </h3>
          <p className="mt-1 text-sm text-slate-700">{protocolVersionLabel(assignment.protocolName, assignment.versionNumber)}</p>
        </div>
        <Badge variant="info" size="sm">{assignment.status}</Badge>
      </div>

      <div className="mt-3 grid gap-2 sm:grid-cols-2">
        <DetailField label="Scanner" value={scanner || null} />
        <DetailField label="Assigned by" value={assignment.assignedBy} />
        <DetailField label="Contrast notes" value={assignment.contrastNotes} />
        <DetailField label="Protocol notes" value={assignment.protocolNotes} />
      </div>

      <p className="mt-3 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs leading-5 text-amber-900">
        This protocol was assigned by the doctor. Changes to scanner execution should be documented separately.
      </p>

      {assignment.modality === "CT" ? (
        <div className="mt-4 overflow-x-auto">
          <table className="min-w-[760px] table-fixed text-left text-xs">
            <thead className="text-[10px] uppercase tracking-[0.12em] text-muted-foreground">
              <tr>
                <th className="w-16 px-2 py-2">Order</th>
                <th className="w-36 px-2 py-2">Phase</th>
                <th className="w-32 px-2 py-2">Timing</th>
                <th className="w-40 px-2 py-2">Coverage</th>
                <th className="w-40 px-2 py-2">Reconstruction</th>
                <th className="w-20 px-2 py-2">Required</th>
                <th className="w-44 px-2 py-2">Instructions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200">
              {assignment.ctPhases.map((phase) => {
                const phaseName = effectiveValue(phase.customPhaseName, phase.phasePresetName);
                const timing = effectiveValue(phase.timingOverride, phase.delaySeconds != null ? `${phase.timingType ?? "Delay"} ${phase.delaySeconds}s` : phase.timingType);
                const coverage = effectiveValue(phase.coverageOverride, phase.coverage);
                const reconstruction = effectiveValue(phase.reconstructionOverride, phase.reconstructionNotes);
                const instructions = effectiveValue(phase.instructionsOverride, phase.instructions);
                return (
                  <tr key={`${phase.orderIndex}-${phaseName ?? "phase"}`}>
                    <td className="px-2 py-2 font-mono">{phase.orderIndex}</td>
                    <td className="px-2 py-2"><ValueWithPreset value={phaseName} preset={defaultText(phase.phasePresetName)} /></td>
                    <td className="px-2 py-2"><ValueWithPreset value={timing} preset={defaultText(phase.timingType)} /></td>
                    <td className="px-2 py-2"><ValueWithPreset value={coverage} preset={defaultText(phase.coverage)} /></td>
                    <td className="px-2 py-2"><ValueWithPreset value={reconstruction} preset={defaultText(phase.reconstructionNotes)} /></td>
                    <td className="px-2 py-2">{phase.isRequired ? "Yes" : "No"}</td>
                    <td className="px-2 py-2"><ValueWithPreset value={instructions} preset={defaultText(phase.instructions)} /></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="mt-4 overflow-x-auto">
          <table className="min-w-[760px] table-fixed text-left text-xs">
            <thead className="text-[10px] uppercase tracking-[0.12em] text-muted-foreground">
              <tr>
                <th className="w-16 px-2 py-2">Order</th>
                <th className="w-40 px-2 py-2">Sequence</th>
                <th className="w-28 px-2 py-2">Plane</th>
                <th className="w-40 px-2 py-2">Coverage</th>
                <th className="w-40 px-2 py-2">b-values / timing</th>
                <th className="w-20 px-2 py-2">Required</th>
                <th className="w-44 px-2 py-2">Notes</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200">
              {assignment.mriSequences.map((sequence) => {
                const sequenceName = effectiveValue(sequence.vendorSequenceName, sequence.sequencePresetName ?? sequence.genericFamily ?? sequence.weighting);
                const plane = effectiveValue(sequence.planeOverride, sequence.defaultPlane);
                const coverage = effectiveValue(sequence.coverageOverride, sequence.defaultCoverage);
                const timing = [
                  effectiveValue(sequence.bValuesOverride, sequence.defaultBValues),
                  effectiveValue(sequence.timingOverride, sequence.defaultDynamicTiming),
                ].filter(Boolean).join(" / ") || null;
                const timingPreset = [defaultText(sequence.defaultBValues), defaultText(sequence.defaultDynamicTiming)].filter(Boolean).join(" / ") || null;
                const notes = effectiveValue(sequence.notesOverride, sequence.notes);
                return (
                  <tr key={`${sequence.orderIndex}-${sequenceName ?? "sequence"}`}>
                    <td className="px-2 py-2 font-mono">{sequence.orderIndex}</td>
                    <td className="px-2 py-2"><ValueWithPreset value={sequenceName} preset={defaultText(sequence.sequencePresetName)} /></td>
                    <td className="px-2 py-2"><ValueWithPreset value={plane} preset={defaultText(sequence.defaultPlane)} /></td>
                    <td className="px-2 py-2"><ValueWithPreset value={coverage} preset={defaultText(sequence.defaultCoverage)} /></td>
                    <td className="px-2 py-2"><ValueWithPreset value={timing} preset={timingPreset} /></td>
                    <td className="px-2 py-2">{sequence.isRequired ? "Yes" : "No"}</td>
                    <td className="px-2 py-2"><ValueWithPreset value={notes} preset={defaultText(sequence.notes)} /></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
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
