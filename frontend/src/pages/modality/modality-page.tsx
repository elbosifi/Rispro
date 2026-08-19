import { useEffect, useId, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate, useSearchParams } from "react-router-dom";
import {
  BadgeCheck,
  Ban,
  CheckCircle2,
  CircleX,
  Clock3,
  History,
  ChevronRight,
  Disc3,
  Printer,
  RefreshCw,
  RotateCcw,
  ScanLine,
  TimerReset,
} from "lucide-react";
import { DateInput } from "@/components/common/date-input";
import { Select } from "@/components/common/select";
import { PatientCategoryBadge } from "@/components/patients/patient-category-badge";
import { MriPrimaryScreeningBadges } from "@/components/appointments/mri-primary-screening-badges";
import { RequestDocumentsPanel } from "@/components/documents/request-documents-panel";
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
  Input,
  Tabs,
  TabsList,
  TabsTrigger,
} from "@/components/shared";
import { createCdRobotDelivery, fetchAppointmentLookups, fetchCdRobotDeliveries, fetchCdRobotDestinations, fetchModalityPreviousStudies, fetchModalityProtocolAssignment, fetchModalityWorklist, fetchStatistics, recordModalityHistoricalPacsAttestation, retryCdRobotDelivery, completeAppointment, updateAppointmentStatus, type CdRobotDelivery, type ModalityPreviousStudiesResponse } from "@/lib/api-hooks";
import { printAppointmentSlipById, printIrSpecimenLabelById } from "@/lib/appointment-printing";
import { buildModalityProtocolPrintSheet, printProtocolSheet } from "@/lib/protocol-printing";
import { chooseLocalized, t } from "@/lib/i18n";
import type { Language } from "@/lib/i18n";
import { formatDateLy, formatDateTimeLy, todayIsoDateLy } from "@/lib/date-format";
import { pushToast } from "@/lib/toast";
import { historicalDicomDateToIso, shouldHideHistoricalCandidateStudy } from "@/lib/historical-pacs-presentation";
import type { AppointmentWithDetails } from "@/lib/mappers";
import type { AppointmentLookups, AppointmentStatus, HistoricalPacsStudy, ModalityProtocolAssignment } from "@/types/api";
import { useLanguage } from "@/providers/language-provider";

const ACTIVE_STATUSES = new Set<AppointmentStatus>(["waiting", "arrived", "in-progress"]);
const LIVE_BOARD_STATUSES = new Set<AppointmentStatus>(["in-progress", "arrived", "waiting", "scheduled"]);
const PROBLEM_STATUSES = new Set<AppointmentStatus>(["no-show", "cancelled", "discontinued"]);
const EMPTY_VALUE = "—";

type BoardFilter = "operational" | "ready" | "waiting" | "arrived" | "in-progress" | "not-arrived" | "completed" | "problem" | "all";
type DocumentFilter = "all" | "missing" | "uploaded";
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
type CdDialogState = { appointment: AppointmentWithDetails; mode: "choose" | "resend" | "history" };
type WaitingDurationInfo = {
  value: string;
  displayValue: string;
  source: string;
  title: string;
};
type WaitingWarningInfo = {
  level: "mild" | "strong";
  title: string;
};

type CdButtonState = "idle" | "sending" | "sent" | "failed" | "patient-active";

function cdButtonState(appointment: AppointmentWithDetails): CdButtonState {
  if (appointment.cdActiveStatus === "sending") return "sending";
  if (appointment.cdPatientActive) return "patient-active";
  if (appointment.cdLatestFailed) return "failed";
  if ((appointment.cdSuccessfulCount ?? 0) > 0) return "sent";
  return "idle";
}

function cdButtonDetails(language: Language, state: CdButtonState, successfulCount: number): { label: string; tooltip: string } {
  switch (state) {
    case "sending":
      return { label: t(language, "modality.cd.sending"), tooltip: t(language, "modality.cd.sendingTooltip") };
    case "patient-active":
      return { label: t(language, "modality.cd.unavailable"), tooltip: t(language, "modality.cd.patientActiveTooltip") };
    case "failed":
      return { label: t(language, "modality.cd.failed"), tooltip: t(language, "modality.cd.failedTooltip") };
    case "sent":
      return { label: t(language, "modality.cd.sent"), tooltip: t(language, "modality.cd.sentTooltip", { count: successfulCount }) };
    default:
      return { label: t(language, "modality.cd.send"), tooltip: t(language, "modality.cd.notSentTooltip") };
  }
}

function localizeCdError(language: Language, message: string): string {
  if (language !== "ar") return message;
  switch (message) {
    case "This patient already has a CD send in progress.":
    case "Another CD for this patient is currently being sent.": return t(language, "modality.cd.error.patientActive");
    case "Study not found in Authoritative Orthanc.": return t(language, "modality.cd.error.studyNotFound");
    case "Unable to identify one matching study safely.": return t(language, "modality.cd.error.ambiguousStudy");
    case "Study is not yet stable in Authoritative Orthanc.": return t(language, "modality.cd.error.studyNotStable");
    case "Study has no instances in Authoritative Orthanc.": return t(language, "modality.cd.error.noInstances");
    case "Selected CD robot is not available.": return t(language, "modality.cd.error.destinationUnavailable");
    case "A reason for the additional CD is required.": return t(language, "modality.cd.error.reasonRequired");
    case "Other reason must contain at least 5 meaningful characters.": return t(language, "modality.cd.error.otherReasonTooShort");
    case "Authoritative Orthanc CD send job failed.": return t(language, "modality.cd.error.sendFailed");
    case "CD send submission was interrupted and may have reached Authoritative Orthanc. Manual retry is required.": return t(language, "modality.cd.error.sendInterrupted");
    default: return message;
  }
}

function cdReasonLabel(language: Language, reason: string): string {
  switch (reason) {
    case "patient_requested_additional_copy": return t(language, "modality.cd.reason.patientRequested");
    case "previous_disc_damaged": return t(language, "modality.cd.reason.discDamaged");
    case "disc_unreadable": return t(language, "modality.cd.reason.discUnreadable");
    case "additional_copy_for_referring_physician": return t(language, "modality.cd.reason.referringPhysician");
    case "other": return t(language, "modality.cd.reason.other");
    default: return reason;
  }
}

function formatCdDeliveryTime(language: Language, value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString(language === "ar" ? "ar-LY" : "en-GB", { dateStyle: "short", timeStyle: "short", timeZone: "Africa/Tripoli" });
}

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

function matchesDocumentFilter(appointment: AppointmentWithDetails, filter: DocumentFilter): boolean {
  const documentCount = appointment.documentCount ?? 0;
  if (filter === "missing") return documentCount === 0;
  if (filter === "uploaded") return documentCount > 0;
  return true;
}

function formatClockValue(language: Language, value: string | null | undefined): string {
  if (!value) return t(language, "common.na");
  const text = String(value);
  if (/^\d{1,2}:\d{2}/.test(text)) return text.slice(0, 5);
  const date = new Date(text);
  if (Number.isNaN(date.getTime())) return text;
  return date.toLocaleTimeString(language === "ar" ? "ar-LY" : "en-GB", { hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "Africa/Tripoli" });
}

function formatArrivalColumn(language: Language, appointment: AppointmentWithDetails): string {
  if (timestampValue(appointment.arrivedAt) != null) return formatClockValue(language, appointment.arrivedAt);
  if (appointment.status === "scheduled") return chooseLocalized(language, "لم يصل", "Not arrived");
  return chooseLocalized(language, "غير مسجل", "Not recorded");
}

function notesIndicator(language: Language, appointment: AppointmentWithDetails): string {
  return appointment.notes?.trim() || appointment.specialReasonNote?.trim()
    ? chooseLocalized(language, "توجد ملاحظات", "Notes")
    : t(language, "common.na");
}

function isProtocolModality(appointment: AppointmentWithDetails | null): boolean {
  const code = appointment?.modalityCode?.toUpperCase();
  return code === "CT" || code === "MR" || code === "MRI";
}

function protocolVersionLabel(name: string | null, version: string | null, freeText?: string | null): string {
  const label = name?.trim() || (freeText?.trim() ? "Free-text protocol" : "Protocol assigned");
  return version?.trim() ? `${label} v${version}` : label;
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

function hasMeaningfulValue(value: string | number | null | undefined): boolean {
  if (value == null) return false;
  if (typeof value === "number") return true;
  const text = value.trim();
  return Boolean(text) && !/^[-\u2010-\u2015\u2212]+$/.test(text);
}

function formatDurationMinutes(language: Language, elapsedMinutes: number): string {
  const hours = Math.floor(elapsedMinutes / 60);
  const minutes = elapsedMinutes % 60;
  if (hours > 0) {
    return language === "ar" ? `${hours}س ${minutes}د` : `${hours}h ${minutes}m`;
  }
  return language === "ar" ? `${minutes}د` : `${minutes}m`;
}

function waitingSourceLabel(language: Language, source: "live" | "pacs_start" | "pacs_first_seen" | "auto_completion_fallback" | "manual" | "manual_fallback"): string {
  switch (source) {
    case "live":
      return chooseLocalized(language, "انتظار مباشر", "Live waiting");
    case "pacs_start":
      return chooseLocalized(language, "بداية الدراسة من PACS", "PACS study start");
    case "pacs_first_seen":
      return chooseLocalized(language, "أول ظهور في PACS / تقريبي", "PACS first seen / approximate");
    case "auto_completion_fallback":
      return chooseLocalized(language, "تقدير من وقت الإكمال", "Estimated from completion");
    case "manual":
      return chooseLocalized(language, "إكمال يدوي", "Manual complete");
    case "manual_fallback":
      return chooseLocalized(language, "تقدير من وقت الإكمال", "Estimated from completion");
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
      const autoCompletedAt = timestampValue(appointment.autoCompletedAt);
      const completedAt = timestampValue(appointment.completedAt);
      if (pacsStartedAt != null) {
        endpoint = pacsStartedAt;
        source = waitingSourceLabel(language, "pacs_start");
      } else if (pacsFirstSeenAt != null) {
        endpoint = pacsFirstSeenAt;
        source = waitingSourceLabel(language, "pacs_first_seen");
      } else if (autoCompletedAt != null) {
        endpoint = autoCompletedAt;
        source = waitingSourceLabel(language, "auto_completion_fallback");
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
    displayValue: appointment.status === "completed"
      ? chooseLocalized(language, `انتظر ${value}`, `Waited ${value}`)
      : chooseLocalized(language, `انتظار ${value}`, `Waiting ${value}`),
    source,
    title: `${value} - ${source}`,
  };
}

function missingWaitingDurationInfo(language: Language, appointment: AppointmentWithDetails): { label: string; reason: string } {
  if (timestampValue(appointment.arrivedAt) == null) {
    return {
      label: chooseLocalized(language, "غير مسجل", "Not recorded"),
      reason: chooseLocalized(language, "وقت الوصول غير مسجل", "Arrival time not recorded"),
    };
  }
  if (appointment.status === "completed" && appointment.pacsAutoCompletionEnabled) {
    return {
      label: chooseLocalized(language, "غير مسجل", "Not recorded"),
      reason: chooseLocalized(language, "توقيت الإكمال عبر PACS غير متاح", "PACS completion timing unavailable"),
    };
  }
  return {
    label: chooseLocalized(language, "غير مسجل", "Not recorded"),
    reason: chooseLocalized(language, "وقت الإكمال غير مسجل", "Completion time not recorded"),
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
      return `border-s-4 border-s-slate-200 bg-white text-slate-700 hover:bg-slate-50 ${selectedClass}`.trim();
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
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const selectedRef = useRef<HTMLTableRowElement | null>(null);

  const [modalityId, setModalityId] = useState(() => searchParams.get("modalityId") || "");
  const [date, setDate] = useState(todayIsoDateLy());
  const [scope, setScope] = useState<"day" | "all">("day");
  const [boardFilter, setBoardFilter] = useState<BoardFilter>("operational");
  const [documentFilter, setDocumentFilter] = useState<DocumentFilter>("all");
  const [documentAppointmentId, setDocumentAppointmentId] = useState<number | null>(null);
  const [selectedAppointmentId, setSelectedAppointmentId] = useState<number | null>(null);
  const [selectedAppointmentTab, setSelectedAppointmentTab] = useState<"appointment" | "previousStudies">("appointment");
  const [confirmTargetId, setConfirmTargetId] = useState<number | null>(null);
  const [confirmVerified, setConfirmVerified] = useState(false);
  const [statusAction, setStatusAction] = useState<BoardStatusAction | null>(null);
  const [statusReason, setStatusReason] = useState("");
  const [openMoreMenu, setOpenMoreMenu] = useState<MoreMenuState | null>(null);
  const [cdDialog, setCdDialog] = useState<CdDialogState | null>(null);
  const [cdDestinationKey, setCdDestinationKey] = useState("");
  const [cdReasonCode, setCdReasonCode] = useState("");
  const [cdReasonText, setCdReasonText] = useState("");
  const [specimenLabelAppointment, setSpecimenLabelAppointment] = useState<AppointmentWithDetails | null>(null);
  const [specimenLabelText, setSpecimenLabelText] = useState("");
  const [specimenLabelPrinting, setSpecimenLabelPrinting] = useState(false);
  const [cdError, setCdError] = useState<string | null>(null);
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
    refetchInterval: 15_000,
  });
  const cdDestinationsQuery = useQuery({ queryKey: ["modality", "cd-robots"], queryFn: fetchCdRobotDestinations, staleTime: 60_000 });
  const cdHistoryQuery = useQuery({ queryKey: ["modality", "cd-deliveries", cdDialog?.appointment.id], queryFn: () => fetchCdRobotDeliveries(cdDialog!.appointment.id), enabled: cdDialog != null });
  const previousStudiesQuery = useQuery({ queryKey: ["modality", "previous-studies", selectedAppointmentId], queryFn: () => fetchModalityPreviousStudies(selectedAppointmentId as number), enabled: selectedAppointmentId != null && selectedAppointmentTab === "previousStudies" });
  const attestationMutation = useMutation({ mutationFn: ({ studyInstanceUid, status }: { studyInstanceUid: string; status: "confirmed" | "denied" }) => recordModalityHistoricalPacsAttestation(selectedAppointmentId as number, studyInstanceUid, status), onSuccess: () => void queryClient.invalidateQueries({ queryKey: ["modality", "previous-studies", selectedAppointmentId] }), onError: () => pushToast({ type: "error", title: t(language, "modality.previousStudies.saveFailed") }) });

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
  const cdCreateMutation = useMutation({
    mutationFn: ({ bookingId, destinationKey, resendReasonCode, resendReasonText }: { bookingId:number; destinationKey:string; resendReasonCode?:string; resendReasonText?:string }) => createCdRobotDelivery(bookingId, { destinationKey, resendReasonCode, resendReasonText }),
    onSuccess: async () => { await queryClient.invalidateQueries({ queryKey: ["modality-worklist"] }); await queryClient.invalidateQueries({ queryKey: ["modality", "cd-deliveries"] }); setCdDialog(null); setCdReasonCode(""); setCdReasonText(""); setCdError(null); },
    onError: (error: Error) => setCdError(localizeCdError(language, error.message)),
  });
  const cdRetryMutation = useMutation({ mutationFn: retryCdRobotDelivery, onSuccess: async () => { await queryClient.invalidateQueries({ queryKey: ["modality-worklist"] }); await queryClient.invalidateQueries({ queryKey: ["modality", "cd-deliveries"] }); }, onError: (error: Error) => setCdError(localizeCdError(language, error.message)) });

  const boardAppointments = useMemo(
    () => appointments.slice().sort(compareBoardAppointments),
    [appointments]
  );
  const visibleBoardAppointments = useMemo(
    () => boardAppointments.filter((appointment) => matchesBoardFilter(appointment, boardFilter) && matchesDocumentFilter(appointment, documentFilter)),
    [boardAppointments, boardFilter, documentFilter]
  );
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
  const documentAppointment = documentAppointmentId == null ? null : appointments.find((appointment) => appointment.id === documentAppointmentId) ?? null;

  const handleRefresh = () => {
    void queryClient.invalidateQueries({ queryKey: ["modality-worklist"] });
    void queryClient.invalidateQueries({ queryKey: ["modality-statistics"] });
  };
  const handleModalityChange = (value: string) => {
    setModalityId(value);
    const next = new URLSearchParams(searchParams);
    if (value) next.set("modalityId", value); else next.delete("modalityId");
    setSearchParams(next, { replace: true });
    setSelectedAppointmentId(null);
    setConfirmTargetId(null);
    setConfirmVerified(false);
  };

  const handleResetView = () => {
    setBoardFilter("operational");
    setDocumentFilter("all");
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
  const openSelectedAppointment = (appointmentId: number, tab: "appointment" | "previousStudies" = "appointment") => {
    setSelectedAppointmentTab(tab);
    setSelectedAppointmentId(appointmentId);
  };
  const openSpecimenLabel = (appointment: AppointmentWithDetails) => {
    setSpecimenLabelText("");
    setSpecimenLabelAppointment(appointment);
    setOpenMoreMenu(null);
  };
  const closeSpecimenLabel = () => {
    if (specimenLabelPrinting) return;
    setSpecimenLabelAppointment(null);
    setSpecimenLabelText("");
  };
  const submitSpecimenLabel = async () => {
    if (!specimenLabelAppointment || specimenLabelPrinting) return;
    const normalizedText = specimenLabelText.replace(/\s+/g, " ").trim();
    if (!normalizedText) return;
    setSpecimenLabelPrinting(true);
    try {
      const result = await printIrSpecimenLabelById(specimenLabelAppointment.id, normalizedText, language);
      if (result.success) {
        setSpecimenLabelAppointment(null);
        setSpecimenLabelText("");
      }
    } finally {
      setSpecimenLabelPrinting(false);
    }
  };
  const openCd = (appointment: AppointmentWithDetails) => {
    const destinations = cdDestinationsQuery.data?.destinations ?? [];
    if (!destinations.length) return;
    if (appointment.cdActiveStatus === "sending") return;
    if (appointment.cdPatientActive) { setCdError(t(language, "modality.cd.error.patientActive")); return; }
    if (appointment.cdLatestFailed) {
      setCdDialog({ appointment, mode: "history" });
      setOpenMoreMenu(null);
      return;
    }
    if (!appointment.cdSuccessfulCount && !appointment.cdLatestFailed && destinations.length === 1) {
      cdCreateMutation.mutate({ bookingId: appointment.id, destinationKey: destinations[0]!.key });
      setOpenMoreMenu(null);
      return;
    }
    setCdDestinationKey(destinations[0]!.key);
    setCdReasonCode(""); setCdReasonText("");
    setCdDialog({ appointment, mode: appointment.cdSuccessfulCount ? "resend" : "choose" });
    setOpenMoreMenu(null);
  };
  const submitCd = () => {
    if (!cdDialog || !cdDestinationKey) return;
    const additional = (cdDialog.appointment.cdSuccessfulCount ?? 0) > 0;
    if (additional && !cdReasonCode) return;
    if (cdReasonCode === "other" && cdReasonText.replace(/\s+/g, " ").trim().length < 5) return;
    cdCreateMutation.mutate({ bookingId: cdDialog.appointment.id, destinationKey: cdDestinationKey, resendReasonCode: additional ? cdReasonCode : undefined, resendReasonText: additional ? cdReasonText : undefined });
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
  const headerTitle = t(language, "modality.title");
  const currentModality = modalities.find((modality) => String(modality.id) === modalityId);
  const isIrModality = currentModality?.code?.trim().toUpperCase() === "IR" || currentModality?.nameEn?.trim().toLowerCase() === "interventional radiology";
  const currentModalityLabel = currentModality
    ? chooseLocalized(language, currentModality.nameAr, currentModality.nameEn) || currentModality.code || `Modality ${currentModality.id}`
    : "";
  const hasResettableView = boardFilter !== "operational" || documentFilter !== "all" || date !== todayIsoDateLy() || scope !== "day";
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
              <Button type="button" variant="secondary" size="sm" disabled={!currentModality?.isActive} onClick={() => currentModality && navigate(`/modality/document-ingestion?modalityId=${currentModality.id}`)} className="rounded-xl px-3">
                <ScanLine size={16} />
                <span>{chooseLocalized(language, "مسح المستندات", "Scan Documents")}</span>
              </Button>
            </div>
          </div>
          <div className={`mt-3 flex flex-wrap items-end gap-3 border-t border-slate-100 pt-3 ${isArabic ? "flex-row-reverse" : ""}`}>
            <div className="min-w-[220px] flex-1">
              <Select
                label={t(language, "modality.selectModality")}
                value={modalityId}
                onChange={handleModalityChange}
                options={[
                  { value: "", label: t(language, "modality.selectModality") },
                  ...modalities.filter((modality) => modality.isActive).map((modality) => ({
                    value: String(modality.id),
                    label: chooseLocalized(language, modality.nameAr, modality.nameEn) || modality.code || `Modality ${modality.id}`,
                  })),
                ]}
                required
              />
            </div>
            <div className="w-full min-w-[180px] sm:w-[180px]">
              <DateInput label={t(language, "modality.date")} value={date} onChange={setDate} disabled={scope === "all"} />
            </div>
            <div className="min-w-[220px]">
              <p className="mb-1.5 text-xs font-mono-data uppercase tracking-[0.08em] text-muted-foreground">{t(language, "modality.scope")}</p>
              <div className="grid grid-cols-2 gap-2">
                <Button type="button" variant={scope === "day" ? "primary" : "secondary"} size="sm" onClick={() => setScope("day")} className="justify-center">{t(language, "modality.scopeToday")}</Button>
                <Button type="button" variant={scope === "all" ? "primary" : "secondary"} size="sm" onClick={() => setScope("all")} className="justify-center">{t(language, "modality.scopeAll")}</Button>
              </div>
            </div>
          </div>
        </header>

        <main className="flex flex-1 flex-col gap-3">
          <section className="flex min-h-0 flex-col gap-3">
            <section
              data-testid="modality-board-section"
              dir={isArabic ? "rtl" : "ltr"}
              className="rounded-xl border border-slate-200/80 bg-white/94"
            >
              <div className="flex flex-wrap items-center gap-1.5 px-3 py-2 text-start">
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
                      aria-pressed={boardFilter === filter}
                      className="h-7 px-2 text-[11px] focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2"
                    >
                      {label}
                    </Button>
                  ))}
                </div>
                <div className="h-6 w-px bg-slate-200" aria-hidden="true" />
                <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label={t(language, "modality.documents.filterLabel")}>
                <span className="me-1 text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">{t(language, "modality.documents.filterLabel")}:</span>
                {(["all", "missing", "uploaded"] as const).map((filter) => (
                  <Button
                    key={filter}
                    type="button"
                    variant={documentFilter === filter ? "primary" : "secondary"}
                    size="sm"
                    className="h-7 px-2 text-[11px] focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2"
                    aria-pressed={documentFilter === filter}
                    aria-label={`${t(language, filter === "all" ? "modality.documents.filterAll" : filter === "missing" ? "modality.documents.filterMissing" : "modality.documents.filterUploaded")} ${t(language, "modality.documents.filterLabel")}`}
                    onClick={() => setDocumentFilter(filter)}
                  >
                    {t(language, filter === "all" ? "modality.documents.filterAll" : filter === "missing" ? "modality.documents.filterMissing" : "modality.documents.filterUploaded")}
                  </Button>
                ))}
                </div>
                {hasResettableView ? (
                  <Button type="button" variant="secondary" size="sm" onClick={handleResetView} className="h-7 px-2 text-[11px]">
                    {chooseLocalized(language, "إعادة العرض", "Reset view")}
                  </Button>
                ) : null}
              </div>

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
                    <table data-testid="modality-board" dir={isArabic ? "rtl" : "ltr"} className="min-w-[1380px] table-fixed text-start text-[11px]">
                      <thead className="sticky top-0 z-10 bg-slate-100 text-[10px] uppercase tracking-[0.12em] text-muted-foreground shadow-sm">
                        <tr>
                          <th scope="col" className="w-[100px] px-2 py-2 font-semibold">{chooseLocalized(language, "الحالة", "Status")}</th>
                          <th scope="col" className="w-[100px] px-2 py-2 font-semibold">{chooseLocalized(language, "وقت الوصول", "Arrival time")}</th>
                          <th scope="col" className="w-[142px] px-2 py-2 font-semibold">{chooseLocalized(language, "مدة الانتظار", "Waiting duration")}</th>
                          <th scope="col" className="w-[260px] px-2 py-2 font-semibold">{chooseLocalized(language, "المريض", "Patient")}</th>
                          <th scope="col" className="w-[150px] px-2 py-2 font-semibold">{chooseLocalized(language, "المعرف الأساسي", "Primary ID")}</th>
                          <th scope="col" className="w-[100px] px-2 py-2 font-semibold">{chooseLocalized(language, "العمر / الجنس", "Age / sex")}</th>
                          <th scope="col" className="w-[240px] px-2 py-2 font-semibold">{chooseLocalized(language, "الفحص", "Exam")}</th>
                          <th scope="col" className="w-[150px] px-2 py-2 font-semibold">Protocol</th>
                          <th scope="col" className="w-[90px] px-2 py-2 font-semibold">{chooseLocalized(language, "الأولوية", "Priority")}</th>
                          <th scope="col" className="w-[118px] px-2 py-2 font-semibold">{chooseLocalized(language, "الوصول", "Accession")}</th>
                          <th scope="col" className="w-[112px] px-2 py-2 font-semibold">{t(language, "modality.documents.column")}</th>
                          <th scope="col" className="w-[92px] px-2 py-2 font-semibold">{chooseLocalized(language, "ملاحظات", "Notes")}</th>
                          <th scope="col" className="w-[250px] px-2 py-2 font-semibold">{chooseLocalized(language, "الإجراءات", "Actions")}</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-200">
                        {visibleBoardAppointments.map((appointment) => {
                      const selected = appointment.id === selectedAppointmentId;
                      const edited = Boolean(appointment.createdAt && appointment.updatedAt && appointment.createdAt !== appointment.updatedAt);
                      const canAct = isActiveStatus(appointment.status);
                      const canCompleteRow = canAct && appointment.status !== "scheduled";
                      const canMarkArrived = appointment.status === "scheduled" || appointment.status === "waiting";
                      const cdState = cdButtonState(appointment);
                      const cdSuccessfulCount = appointment.cdSuccessfulCount ?? 0;
                      const cdDetails = cdButtonDetails(language, cdState, cdSuccessfulCount);
                      const relatedAppointments = (appointment.relatedAppointments ?? []).filter((related) => related.appointmentId !== appointment.id);
                      const waitingInfo = waitingDurationInfo(language, appointment, elapsedNow);
                      const waitingWarning = waitingWarningInfo(language, appointment, elapsedNow);
                      const missingWaitingInfo = waitingInfo ? null : missingWaitingDurationInfo(language, appointment);
                      const missingPrimaryIdentifier = !hasPrimaryIdentifier(appointment);
                      const documentCount = appointment.documentCount ?? 0;
                      const documentStatusLabel = documentCount === 0 ? t(language, "modality.documents.none") : documentCount === 1 ? t(language, "modality.documents.one") : t(language, "modality.documents.many", { count: documentCount });
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
                                openSelectedAppointment(appointment.id);
                              }}
                              onKeyDown={(event) => {
                                if (event.key === "Enter" || event.key === " ") {
                                  event.preventDefault();
                                  openSelectedAppointment(appointment.id);
                                }
                              }}
                              className={`h-16 cursor-pointer align-middle transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent ${rowStatusClass(appointment.status, selected)} ${waitingWarningClass(waitingWarning?.level ?? null)}`}
                            >
                              <td className="px-2 py-1.5">
                                <div data-testid="modality-board-status" className="flex items-center">
                                  <Badge variant={statusVariant(appointment.status)} size="sm" className="max-w-full whitespace-nowrap">
                                    {normalizeStatusLabel(language, appointment.status)}
                                  </Badge>
                                </div>
                              </td>
                              <td className="px-2 py-1.5 font-mono text-[11px] text-slate-700" dir="ltr">
                                <p className="whitespace-nowrap">{formatArrivalColumn(language, appointment)}</p>
                              </td>
                              <td data-testid="modality-board-waiting-duration" className="px-2 py-1.5 text-slate-700">
                                {waitingInfo ? (
                                  <div title={waitingInfo.title} className="leading-tight">
                                    <p dir={isArabic ? "rtl" : "ltr"} className="whitespace-nowrap font-mono text-sm font-bold tabular-nums text-slate-950">{waitingInfo.displayValue}</p>
                                    <p className="mt-0.5 text-[10px] font-medium text-muted-foreground">{waitingInfo.source}</p>
                                  </div>
                                ) : (
                                  <div className="leading-tight">
                                    <p className="text-xs font-semibold text-slate-700">{missingWaitingInfo?.label}</p>
                                    <p className="mt-0.5 text-[10px] text-muted-foreground">{missingWaitingInfo?.reason}</p>
                                  </div>
                                )}
                              </td>
                              <td className="px-2 py-1.5">
                                <p lang="ar" dir="rtl" className="truncate text-sm font-bold leading-5 text-foreground">{appointment.arabicFullName}</p>
                                {showEnglishName ? <p lang="en" dir="ltr" className="truncate text-xs leading-4 text-slate-600">{englishName}</p> : null}
                                {appointment.caseCategory || appointment.modalitySafetyWorkflowType === "mri_primary_implant_screening" ? (
                                  <div className="mt-0.5 inline-flex max-w-full items-center gap-1.5">
                                    {appointment.caseCategory ? (
                                      <div
                                    data-testid="modality-board-case-category"
                                    role="group"
                                    aria-label={chooseLocalized(
                                      language,
                                      `فئة الحالة: ${t(language, appointment.caseCategory === "oncology" ? "appointments.create.oncology" : "appointments.create.nonOncology")}`,
                                      `Case category: ${t(language, appointment.caseCategory === "oncology" ? "appointments.create.oncology" : "appointments.create.nonOncology")}`
                                    )}
                                    className={`inline-flex min-w-0 items-center gap-1 whitespace-nowrap text-[11px] font-medium leading-4 ${appointment.caseCategory === "oncology" ? "text-rose-700" : "text-blue-700"}`}
                                  >
                                    <span aria-hidden="true" className={`h-2 w-2 shrink-0 rounded-full ${appointment.caseCategory === "oncology" ? "bg-rose-600" : "bg-blue-700"}`} />
                                    <span className="truncate">{t(language, appointment.caseCategory === "oncology" ? "appointments.create.oncology" : "appointments.create.nonOncology")}</span>
                                  </div>
                                    ) : null}
                                    {appointment.modalitySafetyWorkflowType === "mri_primary_implant_screening" ? (
                                      <MriPrimaryScreeningBadges result={appointment.mriPrimaryScreening?.result ?? null} compact />
                                    ) : null}
                                  </div>
                                ) : null}
                                {appointment.hasMultipleAppointments && relatedAppointments.length > 0 ? <p dir={isArabic ? "rtl" : "ltr"} className="truncate text-[10px] leading-4 text-slate-500">{chooseLocalized(language, `${relatedAppointments.length} مواعيد مرتبطة`, `${relatedAppointments.length} related`)}</p> : null}
                              </td>
                              <td className="px-2 py-1.5 text-xs font-medium text-slate-800">
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
                                  <span dir="ltr">{primaryIdentifierText(language, appointment)}</span>
                                )}
                              </td>
                              <td className="px-2 py-1.5 text-xs font-medium text-slate-700">{formatAgeSex(language, appointment).replace(t(language, "common.na"), chooseLocalized(language, "غير مسجل", "Not recorded"))}</td>
                              <td className="px-2 py-1.5 text-xs font-semibold text-slate-800">
                                <span lang={isArabic ? "ar" : "en"} dir={isArabic ? "rtl" : "ltr"} className="block truncate leading-5">{chooseLocalized(language, appointment.examNameAr, appointment.examNameEn) || chooseLocalized(language, "غير مسجل", "Not recorded")}</span>
                              </td>
                              <td className="px-2 py-1.5 text-[11px] text-slate-700">
                                {appointment.protocolAssignmentSummary ? (
                                  <span className="inline-flex max-w-full items-center gap-1 truncate font-semibold text-emerald-700" title={protocolVersionLabel(appointment.protocolAssignmentSummary.protocolName, appointment.protocolAssignmentSummary.versionNumber)}>
                                    <BadgeCheck size={12} className="shrink-0" aria-hidden="true" />
                                    <span className="truncate">{protocolVersionLabel(appointment.protocolAssignmentSummary.protocolName, appointment.protocolAssignmentSummary.versionNumber, appointment.protocolAssignmentSummary.freeTextProtocol)}</span>
                                  </span>
                                ) : isProtocolModality(appointment) ? (
                                  <span className="text-[10px] text-muted-foreground">No protocol assigned</span>
                                ) : (
                                  <span className="text-xs text-muted-foreground">{chooseLocalized(language, "غير مسجل", "Not recorded")}</span>
                                )}
                              </td>
                              <td className="px-2 py-1.5 text-[11px] font-semibold text-slate-700">{priorityDisplay(language, appointment)}</td>
                              <td className="px-2 py-1.5">
                                <code data-testid="modality-board-accession" dir="ltr" className="font-mono text-[11px] text-foreground">
                                  {appointment.accessionNumber}
                                </code>
                              </td>
                              <td className="px-2 py-1.5">
                                <button
                                  type="button"
                                  data-testid="modality-document-status"
                                  className={`state-chip inline-flex max-w-full items-center gap-1 whitespace-nowrap text-[10px] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 ${documentCount > 0 ? "state-chip--success" : "state-chip--neutral"}`}
                                  aria-label={t(language, "modality.documents.openWithStatus", { status: documentStatusLabel, accession: appointment.accessionNumber })}
                                  onClick={(event) => {
                                    event.stopPropagation();
                                    setDocumentAppointmentId(appointment.id);
                                  }}
                                >
                                  {documentCount > 0 ? <CheckCircle2 size={12} aria-hidden="true" /> : <span aria-hidden="true">—</span>}
                                  <span>{documentStatusLabel}</span>
                                </button>
                              </td>
                              <td className="px-2 py-1.5">
                                {appointment.notes?.trim() || appointment.specialReasonNote?.trim() ? (
                                  <Badge variant="info" size="sm" title={appointment.notes ?? appointment.specialReasonNote ?? undefined}>
                                    {notesIndicator(language, appointment)}
                                  </Badge>
                                ) : edited ? (
                                  <span className="text-[10px] font-medium text-slate-500">
                                    {t(language, "appointmentEditor.edited")}
                                  </span>
                                ) : (
                                  <span className="text-xs text-muted-foreground">{chooseLocalized(language, "غير مسجل", "Not recorded")}</span>
                                )}
                              </td>
                              <td className="px-2 py-1.5">
                                <div className="relative flex items-center gap-1 whitespace-nowrap">
                                  <Button type="button" variant="secondary" size="sm" aria-label={chooseLocalized(language, "الدراسات السابقة", "History")} title={chooseLocalized(language, "الدراسات السابقة", "Previous studies")} className="h-10 min-w-[40px] shrink-0 border px-2" onClick={(event) => { event.stopPropagation(); openSelectedAppointment(appointment.id, "previousStudies"); }}>
                                    <History size={15} />
                                    <span>{t(language, "modality.previousStudies.history")}</span>
                                  </Button>
                                  {appointment.status === "completed" ? (
                                    <Button
                                      type="button"
                                      variant="secondary"
                                      size="sm"
                                      aria-label={cdDetails.label}
                                      title={cdDetails.tooltip}
                                      className={`h-10 min-w-[40px] shrink-0 border px-2 transition-colors duration-300 focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 ${cdState === "sending" ? "border-sky-300 bg-sky-50 text-sky-800" : cdState === "sent" ? "border-emerald-300 bg-emerald-50 text-emerald-800" : cdState === "failed" ? "border-red-300 bg-red-50 text-red-800" : "border-slate-300 bg-white text-slate-800"}`}
                                      style={cdState === "sending" ? { backgroundColor: "#f0f9ff", borderColor: "#7dd3fc", color: "#0369a1" } : cdState === "sent" ? { backgroundColor: "#ecfdf5", borderColor: "#86efac", color: "#047857" } : cdState === "failed" ? { backgroundColor: "#fef2f2", borderColor: "#fca5a5", color: "#b91c1c" } : undefined}
                                      disabled={cdState === "sending" || cdState === "patient-active" || cdCreateMutation.isPending || !cdDestinationsQuery.data?.destinations.length}
                                      onClick={(event) => {
                                        event.stopPropagation();
                                        openCd(appointment);
                                      }}
                                    >
                                      <span className="relative inline-flex" aria-hidden="true">
                                        <Disc3 size={14} className={cdState === "sending" ? "animate-spin motion-reduce:animate-none" : undefined} />
                                        {cdState === "sent" ? <CheckCircle2 size={9} className="absolute -bottom-1 -right-1 rounded-full bg-emerald-50" /> : null}
                                        {cdState === "failed" ? <CircleX size={9} className="absolute -bottom-1 -right-1 rounded-full bg-red-50" /> : null}
                                      </span>
                                      <span>{cdState === "sending" ? t(language, "modality.cd.sending") : cdState === "sent" ? `${t(language, "modality.cd.sent")}${cdSuccessfulCount > 1 ? ` ×${cdSuccessfulCount}` : ""}` : cdState === "failed" ? t(language, "modality.cd.failed") : t(language, "modality.cd")}</span>
                                    </Button>
                                  ) : null}
                                  {canMarkArrived ? (
                                    <Button
                                      type="button"
    variant="secondary"
    size="sm"
    style={{
      background: "var(--state-warning-bg)",
      borderColor: "var(--state-warning-border)",
      color: "var(--state-warning-text)",
    }}
    className="h-10 min-w-[40px] shrink-0 border px-2 font-semibold hover:brightness-95 active:brightness-90 focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2"
                                      aria-label={chooseLocalized(language, "تسجيل الوصول", "Mark arrived")}
                                      title={chooseLocalized(language, "تسجيل الوصول", "Mark arrived")}
                                      disabled={statusMutation.isPending}
                                      onClick={(event) => {
                                        event.stopPropagation();
                                        handleRequestStatusChange(appointment, "arrived");
                                      }}
                                    >
                                      <BadgeCheck size={14} />
                                      <span>{chooseLocalized(language, "تسجيل الوصول", "Mark arrived")}</span>
                                    </Button>
                                  ) : null}
                                  {canCompleteRow ? (
                                    <Button
                                      type="button"
    variant="secondary"
    size="sm"
                                      aria-label={chooseLocalized(language, "إكمال", "Complete")}
                                      title={chooseLocalized(language, "إكمال", "Complete")}
    style={{
      background: "var(--state-success-text)",
      borderColor: "var(--state-success-text)",
      color: "#fff",
    }}
    className="h-10 min-w-[40px] shrink-0 border px-2 font-semibold hover:brightness-95 active:brightness-90 focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2"
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
                                      size="sm"
                                      aria-label={chooseLocalized(language, "إجراءات إضافية", "More actions")}
                                      title={chooseLocalized(language, "إجراءات إضافية", "More actions")}
                                      className="h-10 w-10 shrink-0 border border-slate-300 bg-white px-2 text-slate-800 focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2"
                                      disabled={statusMutation.isPending}
                                      onClick={(event) => handleOpenMoreMenu(event, appointment)}
                                    >
                                      <span
                                        aria-hidden="true"
                                        className="block -translate-y-px text-xl font-semibold leading-none text-slate-800"
                                      >
                                        …
                                      </span>
                                    </Button>
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
          <button type="button" role="menuitem" className={`flex w-full items-center gap-2 rounded-lg px-3 py-2 text-xs hover:bg-slate-50 ${isArabic ? "flex-row-reverse text-end" : "text-start"}`} onClick={() => { handlePrint(moreMenuAppointment.id); setOpenMoreMenu(null); }}>
            <Printer size={14} />
            <span>{t(language, "common.print")}</span>
          </button>
          {isIrModality ? (
            <button type="button" role="menuitem" className={`flex w-full items-center gap-2 rounded-lg px-3 py-2 text-xs hover:bg-slate-50 ${isArabic ? "flex-row-reverse text-end" : "text-start"}`} onClick={() => openSpecimenLabel(moreMenuAppointment)}>
              <Printer size={14} />
              <span>{t(language, "modality.specimenLabel.print")}</span>
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

      {cdError ? <div role="alert" className="fixed bottom-4 right-4 z-50 rounded border border-red-200 bg-red-50 p-3 text-sm text-red-700">{cdError}</div> : null}
      <Dialog open={Boolean(specimenLabelAppointment)} onClose={closeSpecimenLabel}>
        <DialogContent maxWidth="min(92vw, 420px)">
          <DialogHeader>
            <DialogTitle>{t(language, "modality.specimenLabel.print")}</DialogTitle>
            <DialogDescription>{t(language, "modality.specimenLabel.description")}</DialogDescription>
          </DialogHeader>
          {specimenLabelAppointment ? (
            <div className="space-y-4 text-sm">
              <div className="grid gap-2 rounded-lg border border-slate-200 bg-slate-50 p-3">
                <div><span className="text-xs text-muted-foreground">{t(language, "modality.fieldPatient")}</span><p dir="auto" className="font-medium">{chooseLocalized(language, specimenLabelAppointment.arabicFullName, specimenLabelAppointment.englishFullName)}</p></div>
                <div><span className="text-xs text-muted-foreground">{t(language, "modality.fieldAccession")}</span><p className="font-medium">{specimenLabelAppointment.accessionNumber}</p></div>
              </div>
              <div>
                <label htmlFor="ir-specimen-label-text" className="mb-1 block text-sm font-medium">{t(language, "modality.specimenLabel.specimenSite")}</label>
                <Input id="ir-specimen-label-text" autoFocus maxLength={80} value={specimenLabelText} onChange={(event) => setSpecimenLabelText(event.target.value)} />
              </div>
            </div>
          ) : null}
          <DialogFooter className="mt-5">
            <Button type="button" variant="secondary" disabled={specimenLabelPrinting} onClick={closeSpecimenLabel}>{t(language, "common.cancel")}</Button>
            <Button type="button" disabled={specimenLabelPrinting || !specimenLabelText.replace(/\s+/g, " ").trim()} onClick={() => void submitSpecimenLabel()}>{specimenLabelPrinting ? t(language, "modality.specimenLabel.printing") : t(language, "common.print")}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <Dialog open={Boolean(documentAppointment)} onClose={() => setDocumentAppointmentId(null)}>
        <DialogContent maxWidth="min(94vw, 760px)" className="!p-5">
          {documentAppointment ? (
            <div dir={isArabic ? "rtl" : "ltr"}>
              <DialogHeader>
                <DialogTitle>{t(language, "modality.documents.dialogTitle", { accession: documentAppointment.accessionNumber })}</DialogTitle>
              </DialogHeader>
              <RequestDocumentsPanel
                appointmentId={documentAppointment.id}
                patientId={documentAppointment.patientId}
                appointmentRefType="v2_booking"
                previewMode="modal"
                enableLocalScan
                newDocumentType="clinical_document"
                title={t(language, "modality.documents.column")}
                onDocumentsChanged={() => void queryClient.invalidateQueries({ queryKey: ["modality-worklist"] })}
              />
            </div>
          ) : null}
        </DialogContent>
      </Dialog>
      <Dialog open={Boolean(cdDialog)} onClose={() => setCdDialog(null)}>
        <DialogContent maxWidth="min(94vw, 600px)" className="!p-5">
          <div dir={isArabic ? "rtl" : "ltr"}>
            <DialogHeader closeLabel={t(language, "modality.cd.close")}>
              <DialogTitle>{cdDialog?.mode === "history" ? t(language, "modality.cd.deliveryHistory") : cdDialog?.mode === "resend" ? t(language, "modality.cd.sendAdditional") : t(language, "modality.cd.sendToRobot")}</DialogTitle>
              <DialogDescription>{cdDialog?.mode === "history" ? t(language, "modality.cd.historyDescription") : cdDialog?.mode === "resend" ? t(language, "modality.cd.alreadySent", { count: cdDialog.appointment.cdSuccessfulCount ?? 0 }) : t(language, "modality.cd.chooseDescription")}</DialogDescription>
            </DialogHeader>
            <div className="space-y-4 text-sm">
              {cdDialog?.mode !== "history" ? <div><label htmlFor="cd-destination" className="mb-1 block text-xs font-semibold text-foreground">{t(language, "modality.cd.destination")}</label><select id="cd-destination" className="input-premium w-full" value={cdDestinationKey} onChange={(event) => setCdDestinationKey(event.target.value)}>{(cdDestinationsQuery.data?.destinations ?? []).map((destination) => <option key={destination.key} value={destination.key}>{destination.name}</option>)}</select></div> : null}
              {cdDialog?.mode === "resend" ? <><div><label htmlFor="cd-reason" className="mb-1 block text-xs font-semibold text-foreground">{t(language, "modality.cd.reason")}</label><select id="cd-reason" className="input-premium w-full" value={cdReasonCode} onChange={(event) => setCdReasonCode(event.target.value)}><option value="">{t(language, "modality.cd.selectReason")}</option><option value="patient_requested_additional_copy">{t(language, "modality.cd.reason.patientRequested")}</option><option value="previous_disc_damaged">{t(language, "modality.cd.reason.discDamaged")}</option><option value="disc_unreadable">{t(language, "modality.cd.reason.discUnreadable")}</option><option value="additional_copy_for_referring_physician">{t(language, "modality.cd.reason.referringPhysician")}</option><option value="other">{t(language, "modality.cd.reason.other")}</option></select></div>{cdReasonCode === "other" ? <div><label htmlFor="cd-other-reason" className="mb-1 block text-xs font-semibold text-foreground">{t(language, "modality.cd.otherReason")}</label><Input id="cd-other-reason" className="w-full" value={cdReasonText} onChange={(event) => setCdReasonText(event.target.value)} /></div> : null}</> : null}
              <section aria-label={t(language, "modality.cd.deliveryHistory")} className="space-y-2"><p className="text-xs font-semibold text-foreground">{t(language, "modality.cd.deliveryHistory")}</p><div className="max-h-44 space-y-2 overflow-auto rounded-lg border border-border bg-muted/20 p-2">{(cdHistoryQuery.data?.deliveries ?? []).map((delivery: CdRobotDelivery) => <div key={delivery.id} className={`rounded-md border p-2.5 ${delivery.status === "success" ? "border-emerald-200 bg-emerald-50/60" : delivery.status === "failed" ? "border-red-200 bg-red-50/60" : "border-sky-200 bg-sky-50/60"}`}><div className="flex items-center gap-1.5 font-semibold"><span aria-hidden="true">{delivery.status === "success" ? "✓" : delivery.status === "failed" ? "✕" : "•"}</span><span>{delivery.status === "success" ? t(language, "modality.cd.sentSuccessfully") : delivery.status === "failed" ? t(language, "modality.cd.failed") : t(language, "modality.cd.sending")}</span></div><p className="mt-1 text-xs font-medium text-foreground">{delivery.destination_key}</p><p className="mt-0.5 text-xs text-muted-foreground">{formatCdDeliveryTime(language, delivery.requested_at)} · {delivery.requested_by}</p>{delivery.resend_reason_code ? <p className="mt-1 text-xs text-muted-foreground">{t(language, "modality.cd.reason")}: {cdReasonLabel(language, delivery.resend_reason_code)}</p> : null}{delivery.resend_reason_text ? <p className="mt-1 text-xs text-muted-foreground">{delivery.resend_reason_text}</p> : null}{delivery.last_error ? <p role="alert" className="mt-2 text-xs text-red-700">{localizeCdError(language, delivery.last_error)}</p> : null}{delivery.status === "failed" ? <Button type="button" variant="secondary" size="sm" className="mt-2 h-8 px-2 text-xs" disabled={cdRetryMutation.isPending} onClick={() => cdRetryMutation.mutate(delivery.id)}>{t(language, "modality.cd.retry")}</Button> : null}</div>)}</div></section>
            </div>
            <DialogFooter className="mt-5"><Button type="button" variant="secondary" onClick={() => setCdDialog(null)}>{cdDialog?.mode === "history" ? t(language, "modality.cd.close") : t(language, "common.cancel")}</Button>{cdDialog?.mode !== "history" ? <Button type="button" disabled={cdCreateMutation.isPending || !cdDestinationKey || (cdDialog?.mode === "resend" && (!cdReasonCode || (cdReasonCode === "other" && cdReasonText.replace(/\s+/g, " ").trim().length < 5)))} onClick={submitCd}>{cdDialog?.mode === "resend" ? t(language, "modality.cd.sendAdditional") : t(language, "modality.cd.sendButton")}</Button> : null}</DialogFooter>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={Boolean(selectedAppointment)} onClose={() => { setSelectedAppointmentId(null); setSelectedAppointmentTab("appointment"); }}>
        <DialogContent
          maxWidth="min(98vw, 1560px)"
          scrollable={false}
          className="!p-0 h-[94dvh] !max-h-[94dvh] w-full overflow-hidden rounded-2xl"
        >
          {selectedAppointment ? (
            <div data-testid="selected-appointment-drawer" className="flex h-full min-h-0 flex-col">
              <DialogHeader className="!mb-0 shrink-0 border-b border-slate-200 bg-white px-4 py-3 sm:px-6">
                <div data-testid="clinical-patient-banner" className="flex min-w-0 flex-wrap items-start gap-x-4 gap-y-2">
                  <div className="min-w-0 flex-1">
                    <p className="text-xs uppercase tracking-[0.18em] text-muted-foreground">{chooseLocalized(language, "الموعد المختار", "Selected appointment")}</p>
                    <DialogTitle>{selectedName}</DialogTitle>
                    <div className="mt-2 flex flex-wrap items-center gap-2">
                      <PatientCategoryBadge category={selectedAppointment.caseCategory} showWhenUnset size="sm" />
                      <Badge variant="warning" size="sm">{selectedPriority}</Badge>
                      {selectedEdited ? (
                        <Badge variant="warning" size="sm">
                          {t(language, "appointmentEditor.edited")}
                        </Badge>
                      ) : null}
                      <Badge variant={statusVariant(selectedAppointment.status)} size="sm">
                        {normalizeStatusLabel(language, selectedAppointment.status)}
                      </Badge>
                    </div>
                    <div className="mt-3 flex w-full flex-wrap items-start gap-x-5 gap-y-2 border-t border-slate-100 pt-2">
                      <ClinicalBannerField
                        label={chooseLocalized(language, "معرف المريض", "MRN / primary ID")}
                        value={selectedAppointment.mrn}
                      />
                      <ClinicalBannerField
                        label={chooseLocalized(language, "المعرف الأساسي", "Primary identifier")}
                        value={selectedAppointment.patientPrimaryIdentifierValue
                          ? primaryIdentifierText(language, selectedAppointment)
                          : selectedAppointment.nationalId
                            ? selectedAppointment.nationalId
                            : null}
                      />
                      <ClinicalBannerField label={t(language, "settings.fieldAge")} value={formatAgeSex(language, selectedAppointment)} />
                      <ClinicalBannerField label={t(language, "modality.fieldExam")} value={selectedExam} />
                      <ClinicalBannerField label={t(language, "modality.fieldModality")} value={selectedModality} />
                      <ClinicalBannerField label={t(language, "modality.fieldAccession")} value={selectedAppointment.accessionNumber} />
                    </div>
                  </div>
                  <div className="flex gap-2"><Button variant="secondary" size="icon" aria-label={t(language, "common.print")} title={t(language, "common.print")} onClick={() => handlePrint(selectedAppointment.id)}><Printer size={16} /></Button>{isIrModality ? <Button variant="secondary" size="sm" onClick={() => openSpecimenLabel(selectedAppointment)}>{t(language, "modality.specimenLabel.print")}</Button> : null}</div>
                </div>
              </DialogHeader>
              <Tabs value={selectedAppointmentTab} onValueChange={(value) => setSelectedAppointmentTab(value as "appointment" | "previousStudies")}>
                <TabsList className="mx-4 mt-3 sm:mx-6">
                  <TabsTrigger value="appointment">{chooseLocalized(language, "الموعد", "Appointment")}</TabsTrigger>
                  <TabsTrigger value="previousStudies">{t(language, "modality.previousStudies.previous")}</TabsTrigger>
                </TabsList>
                {selectedAppointmentTab === "appointment" ? <>
              <main data-testid="clinical-workspace-region" className="min-h-0 flex-1 overflow-hidden bg-slate-50/70 px-3 py-3 sm:px-5 sm:py-4">
                <div data-testid="clinical-workspace" className={`grid h-full min-h-0 gap-3 ${selectedAppointment.protocolAssignmentSummary || selectedProtocolQuery.data || selectedProtocolQuery.isLoading || selectedProtocolQuery.isFetching || selectedProtocolQuery.isError ? "grid-rows-[minmax(0,2fr)_minmax(0,3fr)] lg:grid-cols-[minmax(0,7fr)_minmax(280px,3fr)] lg:grid-rows-1" : "grid-rows-[auto_minmax(0,1fr)] lg:grid-cols-1 lg:grid-rows-1"}`}>
                  <section data-testid="clinical-protocol" aria-label={chooseLocalized(language, "البروتوكول المعيّن", "Assigned protocol")} className="order-1 min-h-0 min-w-0 overflow-y-auto overscroll-contain lg:order-2">
                    <ProtocolAssignmentPanel
                      key={selectedAppointment.id}
                      appointment={selectedAppointment}
                      assignment={selectedProtocolQuery.data ?? null}
                      isLoading={selectedProtocolQuery.isLoading || selectedProtocolQuery.isFetching}
                      isError={selectedProtocolQuery.isError}
                      summaryExists={selectedAppointment.protocolAssignmentSummary != null}
                      onRetry={() => void selectedProtocolQuery.refetch()}
                    />
                  </section>

                  <section data-testid="clinical-request-documents" aria-label={chooseLocalized(language, "وثائق الطلب", "Request documents")} className="order-2 flex h-full min-h-0 min-w-0 flex-col lg:order-1">
                    <RequestDocumentsPanel
                      appointmentId={selectedAppointment.id}
                      patientId={selectedAppointment.patientId}
                      appointmentRefType="v2_booking"
                      previewMode="inline"
                      layout="workspace"
                      readOnly
                      title={chooseLocalized(language, "وثائق طلب الفحص", "Examination request documents")}
                    />
                  </section>
                </div>
              </main>
                </> : null}
                {selectedAppointmentTab === "previousStudies" ? <div className="min-h-0 flex-1 overflow-auto bg-slate-50/70 px-3 py-3 sm:px-5 sm:py-4">
                  <PreviousStudiesPanel language={language} data={previousStudiesQuery.data} isLoading={previousStudiesQuery.isLoading} isError={previousStudiesQuery.isError} onRetry={() => void previousStudiesQuery.refetch()} onAttest={(studyInstanceUid, status) => attestationMutation.mutate({ studyInstanceUid, status })} isSaving={attestationMutation.isPending} />
                </div> : null}
              </Tabs>

              <DialogFooter data-testid="clinical-operational-footer" className="!m-0 shrink-0 flex-wrap border-t border-slate-200 bg-white px-3 py-3 !justify-start sm:px-5 sm:!justify-end">
                <Button
                  type="button"
                  variant="secondary"
                  onClick={() => { setSelectedAppointmentId(null); setSelectedAppointmentTab("appointment"); }}
                >
                  <span>{chooseLocalized(language, "إغلاق", "Close")}</span>
                </Button>
                <div className="flex flex-wrap gap-2">
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
                </div>
                <div className="border-s border-slate-200 ps-2">
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
                </div>
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

function PreviousStudiesPanel({ language, data, isLoading, isError, onRetry, onAttest, isSaving }: { language: Language; data: ModalityPreviousStudiesResponse | undefined; isLoading: boolean; isError: boolean; onRetry: () => void; onAttest: (studyInstanceUid: string, status: "confirmed" | "denied") => void; isSaving: boolean }) {
  const [pendingAttestation, setPendingAttestation] = useState<{ studyInstanceUid: string; nextStatus: "confirmed" | "denied" } | null>(null);
  if (isLoading) return <div className="p-4 text-sm text-muted-foreground">{t(language, "modality.previousStudies.loading")}</div>;
  if (isError) return <div className="space-y-3 p-4"><p role="alert" className="text-sm text-red-700">{t(language, "modality.previousStudies.failed")}</p><Button variant="secondary" size="sm" onClick={onRetry}>{t(language, "modality.previousStudies.retry")}</Button></div>;
  if (!data) return null;
  const visibleCandidates = data.historicalCandidates.map((candidate) => ({ ...candidate, studies: candidate.studies.filter((study) => !shouldHideHistoricalCandidateStudy(study)) })).filter((candidate) => candidate.studies.length > 0);
  const requestAttestation = (studyInstanceUid: string, currentStatus: "confirmed" | "denied" | null, nextStatus: "confirmed" | "denied") => {
    if (currentStatus === null && nextStatus === "confirmed") return onAttest(studyInstanceUid, nextStatus);
    setPendingAttestation({ studyInstanceUid, nextStatus });
  };
  return <div className="grid gap-4 lg:grid-cols-2">
    <section className="rounded-lg border border-slate-200 bg-white p-3"><h3 className="font-semibold">{t(language, "modality.previousStudies.risproHistory")}</h3>{data.history.items.length ? <div className="mt-3 space-y-2">{data.history.items.map((item) => <div key={`${item.appointmentId}-${item.studyInstanceUid}`} className="rounded border border-slate-200 p-2 text-sm"><div className="flex flex-wrap items-center gap-2"><p className="font-medium">{item.date ? formatDateLy(item.date) : t(language, "modality.previousStudies.unknownDate")} · {item.description || t(language, "modality.previousStudies.study")}</p><Badge variant={item.source === "rispro_pacs" ? "info" : "secondary"} size="sm">{t(language, item.source === "rispro_pacs" ? "modality.previousStudies.inPacs" : item.source === "rispro_only" ? "modality.previousStudies.notInPacs" : "modality.previousStudies.pacsOnly")}</Badge></div><p className="text-muted-foreground">{item.modalities.join(", ") || t(language, "modality.previousStudies.modalityUnavailable")}{item.accessionNumber ? ` · ${t(language, "modality.previousStudies.accession")} ${item.accessionNumber}` : ""}{item.appointmentStatus ? ` · ${item.appointmentStatus}` : ""}</p>{item.identityDiscrepancy === "patient_id_mismatch" ? <p className="mt-1 text-xs text-amber-800">{t(language, "modality.previousStudies.identityWarning")}</p> : null}</div>)}</div> : <p className="mt-3 text-sm text-muted-foreground">{t(language, "modality.previousStudies.none")}</p>}</section>
    <section className="rounded-lg border border-amber-200 bg-amber-50/40 p-3"><h3 className="font-semibold">{t(language, "modality.previousStudies.matches")}</h3>{data.historicalCandidatesError ? <div className="mt-3 space-y-2"><p role="alert" className="text-sm text-red-700">{t(language, "modality.previousStudies.failed")}</p><Button variant="secondary" size="sm" onClick={onRetry}>{t(language, "modality.previousStudies.retry")}</Button></div> : <>{data.historicalPacsIndexStatus === "stale" ? <p className="mt-3 text-sm text-amber-800">{t(language, "modality.previousStudies.stale")}</p> : null}{data.historicalPacsIndexStatus === "unavailable" ? <p className="mt-3 text-sm text-muted-foreground">{t(language, "modality.previousStudies.unavailable")}</p> : null}{data.historicalPacsIndexStatus === "uninitialized" ? <p className="mt-3 text-sm text-muted-foreground">{t(language, "modality.previousStudies.uninitialized")}</p> : null}{visibleCandidates.length ? <div className="mt-3 space-y-3">{visibleCandidates.map((candidate) => <div key={candidate.historicalPatientId} className="rounded border border-amber-200 bg-white/80 p-2 text-sm"><Badge variant={candidate.classification === "exact" ? "info" : "warning"} size="sm">{t(language, candidate.classification === "exact" ? "modality.previousStudies.exactMatch" : candidate.classification === "strong_demographic" ? "modality.previousStudies.strongDemographicMatch" : candidate.classification === "ambiguous" ? "modality.previousStudies.ambiguousCandidate" : "modality.previousStudies.possibleMatch")}</Badge><p className="mt-1 font-semibold">{candidate.patientName || EMPTY_VALUE}</p><div className="mt-1 grid gap-x-3 gap-y-1 text-xs text-muted-foreground sm:grid-cols-3"><p>{t(language, "modality.previousStudies.oldPatientId")}: {candidate.historicalPatientId || EMPTY_VALUE}</p><p>{t(language, "modality.previousStudies.dob")}: {candidate.patientBirthDate || EMPTY_VALUE}</p><p>{t(language, "modality.previousStudies.sex")}: {candidate.patientSex || EMPTY_VALUE}</p></div><details className="mt-1"><summary className="cursor-pointer font-semibold">{t(language, "modality.previousStudies.why")}</summary><p>{candidate.reasons.join(", ").replaceAll("_", " ")}</p></details><div className="mt-2 space-y-2">{candidate.studies.map((study) => <HistoricalPacsStudyAttestation key={study.orthancStudyId} language={language} study={study} onRequestAttestation={requestAttestation} pendingAttestation={pendingAttestation} onCancelPending={() => setPendingAttestation(null)} onConfirmPending={() => { if (pendingAttestation) { onAttest(pendingAttestation.studyInstanceUid, pendingAttestation.nextStatus); setPendingAttestation(null); } }} isSaving={isSaving} />)}</div></div>)}</div> : data.historicalPacsIndexStatus === "ready" ? <p className="mt-3 text-sm text-muted-foreground">{t(language, "modality.previousStudies.noMatches")}</p> : null}</>}</section>
  </div>;
}

function HistoricalPacsStudyAttestation({ language, study, onRequestAttestation, pendingAttestation, onCancelPending, onConfirmPending, isSaving }: { language: Language; study: HistoricalPacsStudy; onRequestAttestation: (studyInstanceUid: string, currentStatus: "confirmed" | "denied" | null, nextStatus: "confirmed" | "denied") => void; pendingAttestation: { studyInstanceUid: string; nextStatus: "confirmed" | "denied" } | null; onCancelPending: () => void; onConfirmPending: () => void; isSaving: boolean }) {
  const uid = study.studyInstanceUid?.trim();
  const date = historicalDicomDateToIso(study.studyDate);
  const currentStatus = study.attestation?.status ?? null;
  const isPending = pendingAttestation?.studyInstanceUid === uid;
  return <div className="rounded border border-amber-200 p-2"><p className="font-medium">{date ? formatDateLy(date) : t(language, "modality.previousStudies.unknownDate")} · {study.studyDescription || t(language, "modality.previousStudies.study")}</p><p className="text-xs text-muted-foreground">{study.modalitiesInStudy.join(", ") || t(language, "modality.previousStudies.modalityUnavailable")}{study.accessionNumber ? ` · ${t(language, "modality.previousStudies.accession")} ${study.accessionNumber}` : ""}</p>{uid ? <p className="mt-1 break-all text-[11px] text-muted-foreground">{t(language, "modality.previousStudies.studyUid")}: {uid}</p> : null}<p className="mt-1 text-xs text-muted-foreground">{study.seriesCount} {t(language, "modality.previousStudies.series")} · {study.instanceCount} {t(language, study.instanceCount === 1 ? "modality.previousStudies.image" : "modality.previousStudies.images")}</p><p className="mt-2 text-xs font-semibold text-foreground">{study.attestation ? <>{t(language, study.attestation.status === "confirmed" ? "modality.previousStudies.confirmed" : "modality.previousStudies.denied")}<br />{t(language, "modality.previousStudies.recordedBy")} {study.attestation.recordedByName || t(language, "modality.previousStudies.staff")} · {formatDateTimeLy(study.attestation.recordedAt)}</> : t(language, "modality.previousStudies.unreviewed")}</p>{uid ? isPending ? <div className="mt-2 space-y-2"><p className="text-xs text-amber-900">{t(language, "modality.previousStudies.confirmationRequired")}</p><div className="flex flex-wrap gap-2"><Button size="sm" variant="secondary" disabled={isSaving} onClick={onCancelPending}>{t(language, "modality.previousStudies.cancel")}</Button><Button size="sm" disabled={isSaving} onClick={onConfirmPending}>{t(language, "modality.previousStudies.confirmChange")}</Button></div></div> : <div className="mt-2 flex flex-wrap gap-2">{currentStatus !== "confirmed" ? <Button size="sm" variant="secondary" disabled={isSaving} onClick={() => onRequestAttestation(uid, currentStatus, "confirmed")}>{t(language, "modality.previousStudies.confirm")}</Button> : null}{currentStatus !== "denied" ? <Button size="sm" variant="secondary" disabled={isSaving} onClick={() => onRequestAttestation(uid, currentStatus, "denied")}>{t(language, "modality.previousStudies.deny")}</Button> : null}</div> : null}</div>;
}

function ClinicalBannerField({
  label,
  value,
}: {
  label: string;
  value: string | number | null | undefined;
}) {
  return (
    <div className="min-w-[9rem] max-w-full">
      <p className="text-[9px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">{label}</p>
      <p className="mt-0.5 truncate text-xs font-semibold text-foreground" title={value == null ? undefined : String(value)}>{value ?? EMPTY_VALUE}</p>
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

function modalitySpecialInstructions(language: Language, appointment: AppointmentWithDetails): string | null {
  return [
    [
      chooseLocalized(language, appointment.specialReasonLabelAr, appointment.specialReasonLabelEn),
      appointment.specialReasonNote?.trim(),
    ].filter(Boolean).join(": "),
    chooseLocalized(language, appointment.modalityGeneralInstructionAr, appointment.modalityGeneralInstructionEn),
    chooseLocalized(language, appointment.examSpecificInstructionAr, appointment.examSpecificInstructionEn),
  ].filter(Boolean).join("\n") || null;
}

function ProtocolAssignmentPanel({
  appointment,
  assignment,
  isLoading,
  isError,
  summaryExists,
  onRetry,
}: {
  appointment: AppointmentWithDetails;
  assignment: ModalityProtocolAssignment | null;
  isLoading: boolean;
  isError: boolean;
  summaryExists: boolean;
  onRetry: () => void;
}) {
  const { language: protocolLanguage } = useLanguage();
  const patientInstructionsId = useId();
  const [patientInstructionsOpen, setPatientInstructionsOpen] = useState(false);
  const specialInstructions = modalitySpecialInstructions(protocolLanguage, appointment);
  const appointmentNotes = appointment.notes?.trim() || null;
  const patientInstructionItems = [assignment?.protocolNotes, specialInstructions]
    .filter((value): value is string => hasMeaningfulValue(value));
  const scanner = assignment
    ? [assignment.scannerName?.trim(), assignment.scannerVendor?.trim()].filter(Boolean).join(" - ")
    : "";

  if (isLoading) {
    return (
      <section data-testid="modality-protocol-section" dir="ltr" className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-left text-sm text-muted-foreground">
        {t(protocolLanguage, "modality.loadingAssignedProtocol")}
      </section>
    );
  }

  if (!assignment) {
    if (isError || summaryExists) {
      return <section data-testid="modality-protocol-section" dir="ltr" className="rounded-2xl border border-slate-200 bg-slate-50 p-4 text-left text-sm text-muted-foreground"><p className="font-semibold text-foreground">{summaryExists ? t(protocolLanguage, "modality.assignedProtocolUnavailable") : t(protocolLanguage, "modality.assignedProtocolLoadFailed")}</p><Button type="button" variant="secondary" size="sm" className="mt-3" onClick={onRetry}>{t(protocolLanguage, "common.tryAgain")}</Button></section>;
    }
    return (
      <section data-testid="modality-protocol-section" dir="ltr" className="rounded-2xl border border-slate-200 bg-slate-50 p-4 text-left text-sm text-muted-foreground">
        <p className="font-semibold text-foreground">{t(protocolLanguage, "modality.noProtocolAssigned")}</p>
        {appointmentNotes ? <div data-testid="clinical-appointment-notes" className="mt-3"><DetailField label={t(protocolLanguage, "modality.appointmentNotes")} value={appointmentNotes} /></div> : null}
        {patientInstructionItems.length > 0 ? (
          <PatientInstructionsDisclosure
            id={patientInstructionsId}
            language={protocolLanguage}
            items={patientInstructionItems}
            open={patientInstructionsOpen}
            onToggle={() => setPatientInstructionsOpen((current) => !current)}
          />
        ) : null}
      </section>
    );
  }

  const printSheet = buildModalityProtocolPrintSheet(appointment, assignment);
  const protocolTitle = protocolVersionLabel(assignment.protocolName, assignment.versionNumber, assignment.freeTextProtocol);
  const hasFreeTextProtocol = hasMeaningfulValue(assignment.freeTextProtocol);
  const hasContrastNotes = hasMeaningfulValue(assignment.contrastNotes);
  const hasAppointmentNotes = hasMeaningfulValue(appointmentNotes);
  const hasStructuredRows = assignment.modality === "CT" ? assignment.ctPhases.length > 0 : assignment.mriSequences.length > 0;

  return (
    <section data-testid="modality-protocol-section" dir="ltr" className="rounded-2xl border border-slate-200 bg-slate-50 p-4 text-left">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="text-lg font-semibold text-foreground">{t(protocolLanguage, "modality.assignedProtocol")}</h3>
          <div className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
            <Badge variant="neutral" size="sm">{t(protocolLanguage, "modality.readOnly")}</Badge>
            {hasMeaningfulValue(assignment.assignedBy) ? <span>{t(protocolLanguage, "modality.assignedBy")} {assignment.assignedBy}</span> : null}
          </div>
        </div>
        <Button type="button" variant="secondary" size="sm" aria-label={t(protocolLanguage, "modality.printProtocol")} onClick={() => printProtocolSheet(printSheet)}>
            <Printer size={16} />
            <span>{t(protocolLanguage, "common.print")}</span>
        </Button>
      </div>

      <div data-testid="clinical-protocol-content" dir="ltr" className="mt-4 rounded-2xl border border-slate-200 bg-white px-4 py-3">
        <p className="text-[10px] uppercase tracking-[0.16em] text-muted-foreground">{t(protocolLanguage, "modality.protocol")}</p>
        {hasFreeTextProtocol ? (
          <p className="mt-2 whitespace-pre-wrap text-lg font-semibold leading-7 text-slate-950">{assignment.freeTextProtocol}</p>
        ) : (
          <p className="mt-2 text-lg font-semibold leading-7 text-slate-950">{protocolTitle}</p>
        )}
        {hasFreeTextProtocol ? <p className="mt-1 text-xs text-muted-foreground">{protocolTitle}</p> : null}
      </div>

      {hasContrastNotes ? <div className="mt-3"><DetailField label={t(protocolLanguage, "modality.contrastPreparation")} value={assignment.contrastNotes} /></div> : null}

      {scanner ? (
        <section dir="ltr" className="mt-3" aria-label={t(protocolLanguage, "modality.scannerExecution")}>
          <h4 className="mb-2 text-[10px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">{t(protocolLanguage, "modality.scannerExecution")}</h4>
          <DetailField label={t(protocolLanguage, "modality.scanner")} value={scanner} />
        </section>
      ) : null}

      {hasAppointmentNotes ? <div data-testid="clinical-appointment-notes" className="mt-3"><DetailField label={t(protocolLanguage, "modality.appointmentNotes")} value={appointmentNotes} /></div> : null}

      {patientInstructionItems.length > 0 ? (
        <PatientInstructionsDisclosure
          id={patientInstructionsId}
          language={protocolLanguage}
          items={patientInstructionItems}
          open={patientInstructionsOpen}
          onToggle={() => setPatientInstructionsOpen((current) => !current)}
        />
      ) : null}

      {hasStructuredRows && assignment.modality === "CT" ? (
        <div className="mt-4 overflow-x-auto">
          <table data-testid="clinical-acquisition-table" dir="ltr" className="min-w-full table-fixed text-left text-xs">
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
      ) : hasStructuredRows ? (
        <div className="mt-4 overflow-x-auto">
          <table data-testid="clinical-acquisition-table" dir="ltr" className="min-w-full table-fixed text-left text-xs">
            <thead className="text-[10px] uppercase tracking-[0.12em] text-muted-foreground">
              <tr>
                <th className="w-16 px-2 py-2">Order</th>
                <th className="w-32 px-2 py-2">Scanner</th>
                <th className="w-40 px-2 py-2">Sequence</th>
                <th className="w-36 px-2 py-2">Vendor name</th>
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
                    <td className="px-2 py-2">{sequence.scannerName ?? scanner ?? EMPTY_VALUE}</td>
                    <td className="px-2 py-2"><ValueWithPreset value={sequenceName} preset={defaultText(sequence.sequencePresetName)} /></td>
                    <td className="px-2 py-2">{sequence.vendorSequenceName ?? EMPTY_VALUE}</td>
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
      ) : null}
    </section>
  );
}

function PatientInstructionsDisclosure({
  id,
  language,
  items,
  open,
  onToggle,
}: {
  id: string;
  language: Language;
  items: string[];
  open: boolean;
  onToggle: () => void;
}) {
  return (
    <section data-testid="clinical-patient-instructions" dir="ltr" className="mt-4 overflow-hidden rounded-2xl border border-slate-200 bg-white">
      <button
        type="button"
        aria-expanded={open}
        aria-controls={id}
        onClick={onToggle}
        className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left text-sm font-semibold text-slate-900 transition hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent"
      >
        <span className="min-w-0">
          <span className="block">{t(language, "modality.patientInstructions")}</span>
          <span className="mt-0.5 block text-xs font-normal text-muted-foreground">{t(language, items.length === 1 ? "modality.patientInstructionsNote" : "modality.patientInstructionsNotes", { count: items.length })}</span>
        </span>
        <ChevronRight size={18} aria-hidden="true" className={`shrink-0 transition-transform ${open ? "rotate-90" : ""}`} />
      </button>
      {open ? (
        <div id={id} className="border-t border-slate-200 px-4 py-3">
          {items.map((item, index) => (
            <p key={`${id}-${index}`} dir="auto" className="whitespace-pre-wrap text-sm font-medium leading-6 text-slate-900">
              {item}
            </p>
          ))}
        </div>
      ) : null}
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
