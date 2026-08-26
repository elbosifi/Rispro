import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useSearchParams } from "react-router-dom";
import { Bell, ExternalLink, Eye, FileText, MoreHorizontal, Printer } from "lucide-react";
import {
  fetchAppointments,
  fetchAppointmentLookups,
  fetchAppointmentSlipSettings,
  fetchPatientQrSettings,
  fetchRegistrationProtocolAssignment,
  sendPatientWebPushNotification,
} from "@/lib/api-hooks";
import type { AppointmentWithDetails } from "@/lib/mappers";
import { formatDateLy, isoDateDaysFromNow, todayIsoDateLy } from "@/lib/date-format";
import { DateInput } from "@/components/common/date-input";
import { useLanguage } from "@/providers/language-provider";
import { useAuth } from "@/providers/auth-provider";
import { chooseLocalized, statusLabel } from "@/lib/i18n";
import { normalizeAppointmentId } from "@/lib/appointment-id";
import { AppointmentManageModal, type AppointmentManageTab } from "@/components/appointments/appointment-manage-modal";
import { PatientDrawer } from "@/components/patients/patient-drawer";
import { patientCategoryRowClass } from "@/lib/patient-category-theme";
import { pushToast } from "@/lib/toast";
import { printAppointmentSlipById } from "@/lib/appointment-printing";
import { buildModalityProtocolPrintSheet, openProtocolPrintWindow, writeProtocolPrintSheet } from "@/lib/protocol-printing";
import { buildAppointmentWhatsappText, normalizeWhatsappPhone } from "@/lib/whatsapp";
import { Card, Button, Dialog, DialogContent, Input, SearchInput } from "@/components/shared";
import {
  prepareAppointmentSlipHtml,
} from "@/lib/print-utils";
import { directPrintRegistrationRows } from "@/lib/registration-list-printing";
import { buildRegistrationAppointmentQuery, parseRegistrationFiltersFromSearchParams } from "./registration-query";
import type { RegistrationSort, RegistrationsFilters } from "./registration-query";
import type { WhatsappTemplate } from "@/lib/whatsapp";

const DEFAULT_FILTERS: RegistrationsFilters = {
  dateMode: "single",
  date: todayIsoDateLy(),
  dateFrom: "",
  dateTo: "",
  modalityId: "",
  query: "",
  statuses: ["scheduled", "arrived", "waiting"],
  sort: "booking-desc",
};

const ACTIVE_FILTER_PILL_CLASS = "border-accent/25 bg-accent/10 text-accent shadow-sm ring-1 ring-accent/15";
const DRILLDOWN_FILTER_PARAM_KEYS = ["source", "dateMode", "date", "dateFrom", "dateTo", "modalityId", "status", "status[]", "q"];

function RegistrationStat({
  label,
  value,
  tone = "neutral",
}: {
  label: string;
  value: number;
  tone?: "neutral" | "rose" | "sky" | "amber" | "emerald";
}) {
  const toneClass =
    tone === "rose"
      ? "border-rose-200 bg-rose-50 text-rose-700"
      : tone === "sky"
        ? "border-sky-200 bg-sky-50 text-sky-700"
        : tone === "amber"
          ? "border-amber-200 bg-amber-50 text-amber-700"
          : tone === "emerald"
            ? "border-emerald-200 bg-emerald-50 text-emerald-700"
            : "border-border bg-muted/30 text-foreground";

  return (
    <div className={`rounded-xl border p-3 ${toneClass}`}>
      <p className="text-[10px] font-mono uppercase tracking-[0.12em] opacity-75">{label}</p>
      <p className="mt-1 text-xl font-semibold">{value}</p>
    </div>
  );
}

function publicAppointmentToken(appointment: AppointmentWithDetails): string {
  const directToken = String(appointment.publicCancelToken || "").trim();
  if (directToken) return directToken;

  const rawUrl = String(appointment.publicAppointmentUrl || "").trim();
  if (!rawUrl) return "";

  try {
    return new URL(rawUrl).searchParams.get("t")?.trim() || "";
  } catch {
    return new URLSearchParams(rawUrl.split("?")[1] || "").get("t")?.trim() || "";
  }
}

function getErrorMessage(error: unknown, fallback: string): string {
  if (error instanceof Error && error.message) return error.message;
  if (typeof error === "object" && error && "message" in error) {
    const message = (error as { message?: unknown }).message;
    if (typeof message === "string" && message.trim()) return message;
  }
  return fallback;
}

export default function RegistrationsPage() {
  const { language, t } = useLanguage();
  const { user } = useAuth();
  const canReviewVoided = user?.role === "supervisor" || user?.role === "super_admin";
  const [searchParams, setSearchParams] = useSearchParams();
  const queryClient = useQueryClient();
  const appointmentIdParam = searchParams.get("appointmentId");
  const patientIdParam = searchParams.get("patientId");
  const tabParam = searchParams.get("tab");
  const isStatisticsDrilldown = searchParams.get("source") === "statistics";
  const hasUrlAppointmentFilters = DRILLDOWN_FILTER_PARAM_KEYS.some((key) => key !== "source" && searchParams.has(key));
  const appointmentManageTabs: AppointmentManageTab[] = ["details", "documents", "report", "reschedule", "status", "cancel"];
  const initialManageTab = appointmentManageTabs.includes(tabParam as AppointmentManageTab) ? (tabParam as AppointmentManageTab) : "documents";
  const [selectedAppointment, setSelectedAppointment] =
    useState<AppointmentWithDetails | null>(null);
  const [reportCheckOnOpen, setReportCheckOnOpen] = useState(false);
  const deepLinkedAppointmentId = normalizeAppointmentId(appointmentIdParam);
  const manageAppointmentId = selectedAppointment?.id ?? deepLinkedAppointmentId;
  const [selectedPatientId, setSelectedPatientId] = useState<number | null>(null);
  const [slipPreviewAppointment, setSlipPreviewAppointment] =
    useState<AppointmentWithDetails | null>(null);
  const [slipPreviewHtml, setSlipPreviewHtml] = useState<string | null>(null);
  const [slipPreviewLoading, setSlipPreviewLoading] = useState(false);
  const [notificationAppointment, setNotificationAppointment] =
    useState<AppointmentWithDetails | null>(null);
  const [notificationMode, setNotificationMode] = useState<"template" | "custom">("template");
  const [notificationTemplate, setNotificationTemplate] = useState("appointment_reminder_24h");
  const [notificationTitle, setNotificationTitle] = useState("");
  const [notificationMessage, setNotificationMessage] = useState("");
  const [whatsappAppointment, setWhatsappAppointment] =
    useState<AppointmentWithDetails | null>(null);
  const [whatsappMode, setWhatsappMode] = useState<"template" | "custom">("template");
  const [whatsappTemplate, setWhatsappTemplate] = useState<WhatsappTemplate>("qr_link");
  const [whatsappMessage, setWhatsappMessage] = useState("");
  const patientScopedDefaultFilters: RegistrationsFilters = patientIdParam
    ? {
        ...DEFAULT_FILTERS,
        dateMode: "all",
        date: "",
        dateFrom: "",
        dateTo: "",
      }
    : DEFAULT_FILTERS;
  const [storedFilters, setFilters] = useState<RegistrationsFilters>(() => {
    const parsedFilters = parseRegistrationFiltersFromSearchParams(searchParams, patientScopedDefaultFilters);
    if (canReviewVoided) return parsedFilters;

    const statuses = parsedFilters.statuses.filter((status) => status !== "voided");
    return { ...parsedFilters, statuses: statuses.length > 0 ? statuses : DEFAULT_FILTERS.statuses };
  });
  const filters = patientIdParam
    ? { ...storedFilters, dateMode: "all" as const, date: "", dateFrom: "", dateTo: "" }
    : storedFilters;

  const { data: lookups } = useQuery({
    queryKey: ["lookups"],
    queryFn: fetchAppointmentLookups,
    staleTime: 1000 * 60 * 5,
  });

  const { data: appointments = [], isLoading } = useQuery({
    queryKey: ["registrations", filters, patientIdParam],
    queryFn: () => fetchAppointments(buildRegistrationAppointmentQuery({ ...filters, patientId: patientIdParam || undefined })),
    staleTime: 1000 * 30,
  });
  const {
    data: slipSettings,
    error: slipSettingsError,
    isLoading: slipSettingsLoading,
  } = useQuery({
    queryKey: ["appointment-slip-settings"],
    queryFn: fetchAppointmentSlipSettings,
    staleTime: 1000 * 60,
  });
  const {
    data: patientQrSettings,
    error: patientQrSettingsError,
    isLoading: patientQrSettingsLoading,
  } = useQuery({
    queryKey: ["patient-qr-settings"],
    queryFn: fetchPatientQrSettings,
    staleTime: 1000 * 60,
  });
  const sendNotificationMutation = useMutation({
    mutationFn: async () => {
      if (!notificationAppointment) throw new Error("No appointment selected.");
      return sendPatientWebPushNotification(notificationAppointment.id, {
        templateEventType: notificationMode === "template" ? notificationTemplate : undefined,
        title: notificationMode === "custom" ? notificationTitle : undefined,
        message: notificationMode === "custom" ? notificationMessage : undefined,
      });
    },
    onSuccess: () => {
      pushToast({
        type: "success",
        title: t("registrations.webPushSendSuccessTitle"),
        message: t("registrations.webPushSendSuccessMessage"),
      });
      setNotificationAppointment(null);
      setNotificationTitle("");
      setNotificationMessage("");
    },
    onError: (err: unknown) => {
      pushToast({
        type: "error",
        title: t("registrations.webPushSendFailedTitle"),
        message: getErrorMessage(err, t("registrations.webPushSendFailedMessage")),
      });
    },
  });

  const modalities = lookups?.modalities ?? [];
  const selectedFilterModality = filters.modalityId
    ? modalities.find((modality) => String(modality.id) === filters.modalityId)
    : null;
  const selectedFilterModalityLabel = selectedFilterModality
    ? chooseLocalized(
        language,
        selectedFilterModality.nameAr ?? selectedFilterModality.nameEn ?? selectedFilterModality.code ?? `#${selectedFilterModality.id}`,
        selectedFilterModality.nameEn ?? selectedFilterModality.nameAr ?? selectedFilterModality.code ?? `#${selectedFilterModality.id}`,
      )
    : "";
  const listWindowLabel =
    filters.dateMode === "all"
      ? t("registrations.allDates")
      : filters.dateMode === "single"
        ? formatDateLy(filters.date)
        : `${filters.dateFrom ? formatDateLy(filters.dateFrom) : "—"} - ${filters.dateTo ? formatDateLy(filters.dateTo) : "—"}`;
  const todayValue = todayIsoDateLy();
  const tomorrowValue = isoDateDaysFromNow(1);
  const isTodayShortcutActive = filters.dateMode === "single" && filters.date === todayValue;
  const isTomorrowShortcutActive = filters.dateMode === "single" && filters.date === tomorrowValue;
  const visibleSummary = appointments.reduce(
    (summary, appointment) => {
      if (appointment.caseCategory === "oncology") summary.oncology += 1;
      if (appointment.caseCategory === "non_oncology") summary.nonOncology += 1;
      if (appointment.status === "arrived" || appointment.status === "waiting") summary.inDepartment += 1;
      if (appointment.patientWebPushSubscribed) summary.notifiable += 1;
      return summary;
    },
    { oncology: 0, nonOncology: 0, inDepartment: 0, notifiable: 0 }
  );
  const notificationTemplates = [
    { value: "appointment_reminder_24h", label: t("registrations.webPushTemplateReminder") },
    { value: "appointment_rescheduled", label: t("registrations.webPushTemplateRescheduled") },
    { value: "appointment_changed", label: t("registrations.webPushTemplateChanged") },
    { value: "appointment_cancelled", label: t("registrations.webPushTemplateCancelled") },
    { value: "report_ready", label: t("registrations.webPushTemplateReportReady") },
    { value: "test", label: t("registrations.webPushTemplateTest") },
  ];
  const whatsappTemplates = [
    { value: "qr_link", label: t("registrations.whatsappTemplateQrLink") },
    { value: "appointment_reminder", label: t("registrations.whatsappTemplateReminder") },
    { value: "appointment_rescheduled", label: t("registrations.whatsappTemplateRescheduled") },
    { value: "appointment_changed", label: t("registrations.whatsappTemplateChanged") },
    { value: "appointment_cancelled", label: t("registrations.whatsappTemplateCancelled") },
  ];

  const handleFilterChange = <K extends keyof RegistrationsFilters>(
    key: K,
    value: RegistrationsFilters[K],
  ) => {
    setFilters((current) => ({ ...current, [key]: value }));
  };

  const clearPatientScope = () => {
    if (!patientIdParam) return;

    setFilters(filters);
    const nextSearchParams = new URLSearchParams(searchParams);
    nextSearchParams.delete("patientId");
    setSearchParams(nextSearchParams, { replace: true });
  };

  const clearDeepLinkState = () => {
    const nextSearchParams = new URLSearchParams(searchParams);
    let changed = false;

    if (nextSearchParams.has("patientId")) {
      nextSearchParams.delete("patientId");
      changed = true;
    }

    if (nextSearchParams.has("appointmentId")) {
      nextSearchParams.delete("appointmentId");
      changed = true;
    }

    if (nextSearchParams.has("tab")) {
      nextSearchParams.delete("tab");
      changed = true;
    }

    if (changed) {
      setSearchParams(nextSearchParams, { replace: true });
    }
  };

  const handleDateModeChange = (dateMode: RegistrationsFilters["dateMode"]) => {
    clearPatientScope();
    setFilters((current) => {
      if (dateMode === "all") {
        return {
          ...current,
          dateMode,
          date: "",
          dateFrom: "",
          dateTo: "",
        };
      }

      if (dateMode === "single") {
        return {
          ...current,
          dateMode,
          date: current.date || current.dateFrom || current.dateTo || todayValue,
          dateFrom: "",
          dateTo: "",
        };
      }

      const baseDate = current.date || current.dateFrom || current.dateTo || todayValue;
      return {
        ...current,
        dateMode,
        date: "",
        dateFrom: current.dateFrom || baseDate,
        dateTo: current.dateTo || baseDate,
      };
    });
  };

  const handleSingleDateChange = (value: string) => {
    setFilters((current) => ({
      ...current,
      dateMode: "single",
      date: value,
      dateFrom: "",
      dateTo: "",
    }));
  };

  const handleRangeDateChange = (key: "dateFrom" | "dateTo", value: string) => {
    setFilters((current) => ({
      ...current,
      dateMode: "range",
      [key]: value,
      date: "",
    }));
  };

  const handleStatusToggle = (status: string) => {
    setFilters((current) => {
      const nextStatuses = current.statuses.includes(status)
        ? current.statuses.filter((entry) => entry !== status)
        : [...current.statuses, status];

      return {
        ...current,
        statuses: nextStatuses.length > 0 ? nextStatuses : current.statuses,
      };
    });
  };

  const handleResetFilters = () => {
    setFilters(DEFAULT_FILTERS);
    setSelectedAppointment(null);
    clearDeepLinkState();
  };

  const handleClearDrilldownFilters = () => {
    setFilters(patientIdParam ? patientScopedDefaultFilters : DEFAULT_FILTERS);
    const nextSearchParams = new URLSearchParams(searchParams);
    for (const key of DRILLDOWN_FILTER_PARAM_KEYS) {
      nextSearchParams.delete(key);
    }
    setSearchParams(nextSearchParams, { replace: true });
  };

  const handleTodayShortcut = () => {
    clearPatientScope();
    setFilters({
      ...DEFAULT_FILTERS,
      dateMode: "single",
      date: todayValue,
      dateFrom: "",
      dateTo: "",
      modalityId: filters.modalityId,
      query: filters.query,
      statuses: filters.statuses,
      sort: filters.sort,
    });
    void queryClient.invalidateQueries({ queryKey: ["registrations"] });
  };

  const handleTomorrowShortcut = () => {
    const value = isoDateDaysFromNow(1);
    clearPatientScope();
    setFilters({
      ...DEFAULT_FILTERS,
      dateMode: "single",
      date: value,
      dateFrom: "",
      dateTo: "",
      modalityId: filters.modalityId,
      query: filters.query,
      statuses: filters.statuses,
      sort: filters.sort,
    });
    void queryClient.invalidateQueries({ queryKey: ["registrations"] });
  };

  const handlePrintVisibleList = () => {
    void directPrintRegistrationRows(appointments, listWindowLabel);
  };

  const patientScopeName = selectedAppointment
    ? chooseLocalized(language, selectedAppointment.arabicFullName, selectedAppointment.englishFullName)
    : "";
  const drilldownChips = [
    filters.dateMode === "single" && filters.date
      ? `${t("registrations.date")}: ${formatDateLy(filters.date)}`
      : filters.dateMode === "range" && filters.dateFrom && filters.dateTo
        ? `${t("registrations.dateRange")}: ${formatDateLy(filters.dateFrom)} - ${formatDateLy(filters.dateTo)}`
        : filters.dateMode === "all"
          ? t("registrations.allDates")
          : null,
    selectedFilterModalityLabel ? `${t("registrations.modality")}: ${selectedFilterModalityLabel}` : null,
    ...filters.statuses.map((status) => `${t("registrations.status")} ${statusLabel(language, status)}`),
    filters.query ? `${t("registrations.search")}: ${filters.query}` : null,
  ].filter((chip): chip is string => Boolean(chip));
  const showStatisticsDrilldownBanner = isStatisticsDrilldown && hasUrlAppointmentFilters && drilldownChips.length > 0;
  const backToStatisticsParams = new URLSearchParams();
  if (filters.dateMode === "range") {
    if (filters.dateFrom) backToStatisticsParams.set("dateFrom", filters.dateFrom);
    if (filters.dateTo) backToStatisticsParams.set("dateTo", filters.dateTo);
  } else if (filters.dateMode === "single" && filters.date) {
    backToStatisticsParams.set("dateFrom", filters.date);
    backToStatisticsParams.set("dateTo", filters.date);
  }
  if (filters.modalityId) backToStatisticsParams.set("modalityId", filters.modalityId);
  const backToStatisticsHref = `/statistics${backToStatisticsParams.toString() ? `?${backToStatisticsParams.toString()}` : ""}`;
  const handleViewAppointmentLink = async (appointment: AppointmentWithDetails) => {
    const url = String(appointment.publicAppointmentUrl || "").trim();
    if (!url) {
      pushToast({
        type: "error",
        title: t("registrations.appointmentLinkTitle"),
        message: t("registrations.appointmentLinkUnavailable"),
      });
      return;
    }
    try {
      if (typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(url);
      }
    } catch {
      // Clipboard may be unavailable in some browser contexts; still show URL.
    }
    pushToast({
      type: "success",
      title: t("registrations.appointmentLinkTitle"),
      message: url,
    });
  };

  const openPatientDrawer = (appointment: AppointmentWithDetails) => {
    setSelectedPatientId(appointment.patientId);
  };

  const openSlipPreview = (appointment: AppointmentWithDetails) => {
    setSlipPreviewHtml(null);
    setSlipPreviewLoading(true);
    setSlipPreviewAppointment(appointment);
  };

  const setManageTabAndUrl = (tab: AppointmentManageTab) => {
    if (!selectedAppointment && !appointmentIdParam) return;
    const nextSearchParams = new URLSearchParams(searchParams);
    if (selectedAppointment) nextSearchParams.set("appointmentId", String(selectedAppointment.id));
    if (tab === "documents") {
      nextSearchParams.delete("tab");
    } else {
      nextSearchParams.set("tab", tab);
    }
    setSearchParams(nextSearchParams, { replace: true });
  };

  const manageAppointment = (appointment: AppointmentWithDetails) => {
    setSelectedAppointment(appointment);
    setReportCheckOnOpen(false);
    const nextSearchParams = new URLSearchParams(searchParams);
    nextSearchParams.set("appointmentId", String(appointment.id));
    nextSearchParams.delete("tab");
    setSearchParams(nextSearchParams, { replace: true });
  };

  const openAppointmentById = (appointmentId: number) => {
    if (!Number.isSafeInteger(appointmentId) || appointmentId <= 0) return;
    setSelectedAppointment(null);
    setReportCheckOnOpen(false);
    const nextSearchParams = new URLSearchParams(searchParams);
    nextSearchParams.set("appointmentId", String(appointmentId));
    nextSearchParams.set("tab", "details");
    setSearchParams(nextSearchParams, { replace: true });
  };

  const openReportPanel = (appointment: AppointmentWithDetails, checkNow = false) => {
    setSelectedAppointment(appointment);
    setReportCheckOnOpen(checkNow);
    const nextSearchParams = new URLSearchParams(searchParams);
    nextSearchParams.set("appointmentId", String(appointment.id));
    nextSearchParams.set("tab", "report");
    setSearchParams(nextSearchParams, { replace: true });
  };

  const openPatientNotificationDialog = (appointment: AppointmentWithDetails) => {
    setNotificationAppointment(appointment);
    setNotificationMode("template");
    setNotificationTemplate("appointment_reminder_24h");
    setNotificationTitle("");
    setNotificationMessage("");
  };

  const canSendCustomNotification =
    notificationMode === "template" || (notificationTitle.trim().length > 0 && notificationMessage.trim().length > 0);

  const openWhatsappDialog = (appointment: AppointmentWithDetails) => {
    if (!appointment.phone1) {
      pushToast({
        type: "error",
        title: t("registrations.whatsappUnavailableTitle"),
        message: t("registrations.whatsappNoPhone"),
      });
      return;
    }
    if (!appointment.publicAppointmentUrl) {
      pushToast({
        type: "error",
        title: t("registrations.whatsappUnavailableTitle"),
        message: t("registrations.appointmentLinkUnavailable"),
      });
      return;
    }
    setWhatsappAppointment(appointment);
    setWhatsappMode("template");
    setWhatsappTemplate("qr_link");
    setWhatsappMessage("");
  };

  const currentWhatsappMessage = whatsappAppointment
    ? whatsappMode === "template"
      ? buildAppointmentWhatsappText(
          whatsappTemplate,
          {
            bookingDate: whatsappAppointment.appointmentDate,
            publicAppointmentUrl: whatsappAppointment.publicAppointmentUrl,
          },
          language,
          patientQrSettings
        )
      : whatsappMessage.trim()
    : "";

  const sendWhatsappMessage = () => {
    if (!whatsappAppointment) return;
    const phone = normalizeWhatsappPhone(whatsappAppointment.phone1);
    if (!phone || !currentWhatsappMessage) return;
    window.open(`https://wa.me/${phone}?text=${encodeURIComponent(currentWhatsappMessage)}`, "_blank", "noopener,noreferrer");
    setWhatsappAppointment(null);
  };

  const closeManageModal = () => {
    setSelectedAppointment(null);
    setReportCheckOnOpen(false);
    if (appointmentIdParam) {
      const nextSearchParams = new URLSearchParams(searchParams);
      nextSearchParams.delete("appointmentId");
      nextSearchParams.delete("tab");
      setSearchParams(nextSearchParams, { replace: true });
    }
  };

  useEffect(() => {
    let cancelled = false;
    const settingsReady =
      (!slipSettingsLoading || Boolean(slipSettingsError)) &&
      (!patientQrSettingsLoading || Boolean(patientQrSettingsError));
    const renderOptions =
      slipSettings && patientQrSettings
        ? { slipSettings, patientQrSettings }
        : undefined;

    if (!slipPreviewAppointment || !settingsReady) return;
    void prepareAppointmentSlipHtml(slipPreviewAppointment, renderOptions)
      .then((html) => {
        if (cancelled || !html) return;
        setSlipPreviewHtml(html);
      })
      .finally(() => {
        if (!cancelled) setSlipPreviewLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [
    patientQrSettings,
    patientQrSettingsError,
    patientQrSettingsLoading,
    slipPreviewAppointment,
    slipSettings,
    slipSettingsError,
    slipSettingsLoading,
  ]);

  const closeSlipPreview = () => {
    setSlipPreviewAppointment(null);
    setSlipPreviewHtml(null);
    setSlipPreviewLoading(false);
  };

  const handlePreviewPrint = () => {
    if (!slipPreviewAppointment) return;
    void printAppointmentSlipById(slipPreviewAppointment.id, language);
  };

  function protocolVersionText(appointment: AppointmentWithDetails): string | null {
    const summary = appointment.protocolAssignmentSummary;
    if (!summary) return null;
    return [summary.protocolName || (summary.freeTextProtocol ? "Free-text protocol" : "Protocol assigned"), summary.versionNumber ? `v${summary.versionNumber}` : null]
      .filter(Boolean)
      .join(" ");
  }

  function handleProtocolPrint(appointment: AppointmentWithDetails) {
    const printWindow = openProtocolPrintWindow();
    if (!printWindow) {
      pushToast({ type: "error", title: "Unable to open the protocol print window." });
      return;
    }
    printWindow.document.open();
    printWindow.document.write("<title>Protocol sheet</title><p style=\"font:14px Arial;padding:20px\">Loading assigned protocol…</p>");
    printWindow.document.close();
    void fetchRegistrationProtocolAssignment(appointment.id).then((assignment) => {
      if (!assignment) throw new Error("assignment_unavailable");
      writeProtocolPrintSheet(printWindow, buildModalityProtocolPrintSheet(appointment, assignment));
    }).catch(() => {
      try { printWindow.close(); } catch { /* best effort */ }
      pushToast({ type: "error", title: "Unable to load the assigned protocol for printing." });
    });
  }

  function usesProtocolWorkflow(appointment: AppointmentWithDetails): boolean {
    const modality = (appointment.modalityCode || appointment.modalityNameEn || "").toUpperCase();
    return modality === "CT" || modality === "MRI";
  }

  function ProtocolStatus({ appointment }: { appointment: AppointmentWithDetails }) {
    const requestDocumentMissing =
      appointment.requireRequestDocumentForProtocolQueue === true &&
      appointment.protocolQueueAppliesToAppointment === true &&
      appointment.hasQualifyingRequestDocument === false;

    if (requestDocumentMissing) {
      return (
        <div className="mt-1.5 text-[10.5px] leading-snug">
          <button
            type="button"
            className="inline-flex rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 font-semibold text-amber-900 transition hover:bg-amber-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-500/60"
            onClick={(event) => {
              event.stopPropagation();
              manageAppointment(appointment);
            }}
          >
            {t("registrations.missingRequest")}
          </button>
        </div>
      );
    }

    if (!usesProtocolWorkflow(appointment)) return null;
    const summary = appointment.protocolAssignmentSummary;
    if (!summary) {
      return (
        <div className="mt-1.5 text-[10.5px] leading-snug text-muted-foreground">
          <span className="inline-flex rounded-full border border-slate-200 bg-white/70 px-2 py-0.5 font-semibold text-slate-600">
            Protocol: Not protocolled
          </span>
        </div>
      );
    }

    return (
      <div className="mt-1.5 space-y-0.5 text-[10.5px] leading-snug text-muted-foreground">
        <div className="flex items-center gap-2"><span className="inline-flex rounded-full border border-emerald-200 bg-emerald-50 px-2 py-0.5 font-semibold text-emerald-700">Protocol assigned</span><Button type="button" variant="ghost" size="sm" className="h-6 px-1.5 text-[10px]" aria-label="Print protocol" title="Print protocol" onClick={(event) => { event.stopPropagation(); handleProtocolPrint(appointment); }}>Print protocol</Button></div>
        <p className="truncate text-foreground">Protocol: {protocolVersionText(appointment)}</p>
        {summary.scannerName ? <p className="truncate">Scanner: {summary.scannerName}</p> : null}
      </div>
    );
  }

  return (
    <div className="w-full max-w-[1600px] mx-auto px-3 sm:px-6 space-y-3 sm:space-y-4">
      <div className="space-y-3 sm:space-y-4 lg:hidden">
        <div className="flex items-center gap-4">
          <span className="inline-flex items-center gap-3 rounded-full border border-accent/30 bg-accent/5 px-5 py-2">
            <span className="h-2 w-2 rounded-full bg-accent" />
            <span className="font-mono text-xs uppercase tracking-[0.15em] text-accent">
              {t("registrations.sectionLabel")}
            </span>
          </span>
        </div>
        <h1
          className="text-2xl sm:text-3xl font-display"
          style={{ color: "var(--foreground)" }}
        >
          <span className="gradient-text">{t("registrations.pageTitle")}</span>
        </h1>
      </div>

      {showStatisticsDrilldownBanner ? (
        <Card className="border-accent/20 bg-accent/5 p-3 sm:p-3.5">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
            <div className="min-w-0 space-y-2">
              <div>
                <p className="text-sm font-semibold text-foreground">
                  {t("registrations.statisticsDrilldownTitle")}
                </p>
                <p className="text-xs text-muted-foreground">
                  {t("registrations.statisticsDrilldownHint")}
                </p>
              </div>
              <div className="flex flex-wrap gap-1.5">
                {drilldownChips.map((chip) => (
                  <span
                    key={chip}
                    className="rounded-full border border-accent/20 bg-background px-2.5 py-1 text-[11px] font-medium text-foreground"
                  >
                    {chip}
                  </span>
                ))}
              </div>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button type="button" variant="ghost" size="sm" className="h-9 px-3 text-xs" onClick={handleClearDrilldownFilters}>
                {t("registrations.clearDrilldownFilters")}
              </Button>
              <Link to={backToStatisticsHref} className="btn-secondary inline-flex h-9 items-center px-3 text-xs">
                {t("registrations.backToStatistics")}
              </Link>
            </div>
          </div>
        </Card>
      ) : null}

      <Card className="p-3 sm:p-3.5">
        <div className="flex flex-col gap-3 xl:flex-row xl:items-end xl:justify-between">
          <div className="space-y-1">
            <h3 className="text-base font-semibold">{t("registrations.filters")}</h3>
            <p className="text-xs sm:text-sm text-muted-foreground max-w-3xl">
              {t("registrations.filtersDescription")}
            </p>
          </div>
          <div className="flex flex-wrap gap-1.5">
            <Button
              type="button"
              variant="secondary"
              size="sm"
              onClick={handleTodayShortcut}
              aria-pressed={isTodayShortcutActive}
              className={isTodayShortcutActive ? ACTIVE_FILTER_PILL_CLASS : undefined}
            >
              {language === "ar" ? "اليوم" : "Today"}
            </Button>
            <Button
              type="button"
              variant="secondary"
              size="sm"
              onClick={handleTomorrowShortcut}
              aria-pressed={isTomorrowShortcutActive}
              className={isTomorrowShortcutActive ? ACTIVE_FILTER_PILL_CLASS : undefined}
            >
              {language === "ar" ? "غداً" : "Tomorrow"}
            </Button>
            <Button type="button" variant="secondary" size="sm" className="h-9 px-3 text-xs" onClick={handlePrintVisibleList}>
              {t("registrations.print")}
            </Button>
            <Button type="button" variant="ghost" size="sm" className="h-9 px-3 text-xs" onClick={handleResetFilters}>
              {t("registrations.reset")}
            </Button>
          </div>
        </div>

        <div className="mt-3 grid grid-cols-1 xl:grid-cols-[1.15fr_1.05fr_0.8fr] gap-3">
          <div className="rounded-2xl border border-border bg-muted/20 p-3.5">
            <p className="text-xs font-mono uppercase tracking-[0.15em] text-muted-foreground">
              {t("registrations.dateFilters")}
            </p>
            <p className="mt-1 text-xs sm:text-sm text-muted-foreground">{t("registrations.dateFiltersHint")}</p>
            <div className="mt-3 flex flex-wrap gap-1.5">
              <Button
                type="button"
                variant="secondary"
                size="sm"
                onClick={() => handleDateModeChange("all")}
                aria-pressed={filters.dateMode === "all"}
                className={filters.dateMode === "all" ? ACTIVE_FILTER_PILL_CLASS : undefined}
              >
                {t("registrations.allDates")}
              </Button>
              <Button
                type="button"
                variant="secondary"
                size="sm"
                onClick={() => handleDateModeChange("single")}
                aria-pressed={filters.dateMode === "single"}
                className={filters.dateMode === "single" ? ACTIVE_FILTER_PILL_CLASS : undefined}
              >
                {t("registrations.singleDate")}
              </Button>
              <Button
                type="button"
                variant="secondary"
                size="sm"
                onClick={() => handleDateModeChange("range")}
                aria-pressed={filters.dateMode === "range"}
                className={filters.dateMode === "range" ? ACTIVE_FILTER_PILL_CLASS : undefined}
              >
                {t("registrations.dateRange")}
              </Button>
            </div>

            <div className="mt-3">
              {filters.dateMode === "all" ? (
                <div className="rounded-2xl border border-dashed border-border bg-background px-4 py-3 text-sm text-muted-foreground">
                  {t("registrations.allDatesHint")}
                </div>
              ) : filters.dateMode === "single" ? (
                <div className="max-w-sm">
                  <DateInput
                    label={t("registrations.date")}
                    value={filters.date}
                    onChange={handleSingleDateChange}
                  />
                </div>
              ) : (
                <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                  <DateInput
                    label={t("registrations.dateFrom")}
                    value={filters.dateFrom}
                    onChange={(value) => handleRangeDateChange("dateFrom", value)}
                  />
                  <DateInput
                    label={t("registrations.dateTo")}
                    value={filters.dateTo}
                    onChange={(value) => handleRangeDateChange("dateTo", value)}
                  />
                </div>
              )}
            </div>
          </div>

          <div className="rounded-2xl border border-border bg-muted/20 p-3.5">
            <p className="text-xs font-mono uppercase tracking-[0.15em] text-muted-foreground">
              {t("registrations.searchFilters")}
            </p>
            <p className="mt-1 text-xs sm:text-sm text-muted-foreground">{t("registrations.searchFiltersHint")}</p>
            {patientIdParam && patientScopeName ? (
              <div className="mt-3 rounded-2xl border border-accent/20 bg-accent/5 px-3 py-2 text-xs sm:text-sm text-foreground/80">
                {t("registrations.patientScopeHint", { patient: patientScopeName })}
              </div>
            ) : null}
            <div className="mt-3 grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="block text-[10px] font-mono-data uppercase tracking-[0.08em] mb-1 text-muted-foreground">
                  {t("registrations.modality")}
                </label>
                <select
                  value={filters.modalityId}
                  onChange={(e) => handleFilterChange("modalityId", e.target.value)}
                  className="input-premium input-ltr w-full min-h-10"
                >
                  <option value="">{t("registrations.all")}</option>
                  {modalities.map((modality) => (
                    <option key={modality.id} value={String(modality.id)}>
                      {modality.nameEn ?? modality.nameAr ?? modality.code ?? `#${modality.id}`}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-[10px] font-mono-data uppercase tracking-[0.08em] mb-1 text-muted-foreground">
                  {t("registrations.search")}
                </label>
                <SearchInput
                  placeholder={t("registrations.searchPlaceholder")}
                  value={filters.query}
                  onChange={(e) => handleFilterChange("query", e.target.value)}
                  showClearButton
                  onClear={() => handleFilterChange("query", "")}
                  className="w-full min-h-10"
                />
              </div>
            </div>
          </div>

          <div className="rounded-2xl border border-border bg-background p-3.5">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-xs sm:text-sm font-medium text-muted-foreground">
                {t("registrations.status")}
              </span>
              <span className="text-[10px] sm:text-xs text-muted-foreground">
                {t("registrations.statusHint")}
              </span>
            </div>
            <div className="mt-2.5 flex flex-wrap gap-1.5">
              {["scheduled", "arrived", "waiting", "completed", "no-show", "cancelled", "discontinued", ...(canReviewVoided ? ["voided"] : [])].map(
                (status) => (
                  <button
                    key={status}
                    type="button"
                    onClick={() => handleStatusToggle(status)}
                    aria-pressed={filters.statuses.includes(status)}
                    className={`min-h-9 px-3 py-1.5 rounded-full text-[11px] font-medium transition-colors ${
                      filters.statuses.includes(status)
                        ? ACTIVE_FILTER_PILL_CLASS
                        : "bg-muted text-muted-foreground hover:bg-muted/80"
                    }`}
                  >
                    {statusLabel(language, status)}
                  </button>
                ),
              )}
            </div>
          </div>
        </div>
      </Card>

      <Card className="overflow-hidden">
        <div className="flex flex-col gap-2 border-b border-border p-3.5 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <h3 className="text-lg font-semibold">{t("registrations.title")}</h3>
            <p className="text-xs sm:text-sm text-muted-foreground">
              {appointments.length} {language === "ar" ? "موعد" : "appointments"} {listWindowLabel}
            </p>
            <div
              className="mt-2 flex flex-wrap items-center gap-2 text-[10px] font-medium text-muted-foreground"
              aria-label={t("registrations.categoryLegend")}
            >
              <span className="inline-flex items-center gap-1.5 rounded-full border border-rose-200 bg-rose-50 px-2 py-1 text-rose-700">
                <span className="h-2.5 w-2.5 rounded-sm border border-rose-300 bg-rose-100" aria-hidden="true" />
                {t("appointments.create.oncology")}
              </span>
              <span className="inline-flex items-center gap-1.5 rounded-full border border-sky-200 bg-sky-50 px-2 py-1 text-sky-700">
                <span className="h-2.5 w-2.5 rounded-sm border border-sky-300 bg-sky-100" aria-hidden="true" />
                {t("appointments.create.nonOncology")}
              </span>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <label htmlFor="registration-sort" className="text-xs text-muted-foreground">
              {t("registrations.sort")}
            </label>
            <select
              id="registration-sort"
              value={filters.sort}
              onChange={(event) => handleFilterChange("sort", event.target.value as RegistrationSort)}
              className="input-premium h-8 w-auto min-w-48 px-2 py-1 text-xs"
            >
              <option value="booking-desc">{t("registrations.sortBookingNewest")}</option>
              <option value="booking-asc">{t("registrations.sortBookingOldest")}</option>
              <option value="patient-asc">{t("registrations.sortPatientName")}</option>
              <option value="time-asc">{t("registrations.sortAppointmentTime")}</option>
            </select>
            <Button type="button" variant="secondary" size="sm" className="h-8 px-3 text-xs" onClick={handlePrintVisibleList}>
              {t("registrations.print")}
            </Button>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-2 border-b border-border p-3 lg:grid-cols-4">
          <RegistrationStat label={t("appointments.create.oncology")} value={visibleSummary.oncology} tone="rose" />
          <RegistrationStat label={t("appointments.create.nonOncology")} value={visibleSummary.nonOncology} tone="sky" />
          <RegistrationStat label={t("registrations.inDepartment")} value={visibleSummary.inDepartment} tone="amber" />
          <RegistrationStat label={t("registrations.notifiable")} value={visibleSummary.notifiable} tone="emerald" />
        </div>

        <div className="overflow-x-auto">
          <div className="space-y-3 p-3 lg:hidden">
            {isLoading ? (
              <div className="p-8 text-center text-muted-foreground">
                {t("common.loading")}
              </div>
            ) : appointments.length === 0 ? (
              <div className="p-8 text-center text-muted-foreground">
                {t("queue.empty")}
              </div>
            ) : (
              appointments.map((apt: AppointmentWithDetails, index: number) => {
                const patientName = chooseLocalized(language, apt.arabicFullName, apt.englishFullName);
                const modalityName = chooseLocalized(language, apt.modalityNameAr, apt.modalityNameEn);
                const examName = chooseLocalized(language, apt.examNameAr, apt.examNameEn);
                const categoryLabel =
                  apt.caseCategory === "oncology"
                    ? t("appointments.create.oncology")
                    : apt.caseCategory === "non_oncology"
                      ? t("appointments.create.nonOncology")
                      : t("registrations.categoryUnknown");

                return (
                  <div
                    key={apt.id}
                    role="button"
                    tabIndex={0}
                    className={`rounded-xl border border-border p-3 ${patientCategoryRowClass(apt.caseCategory, index, selectedAppointment?.id === apt.id)}`}
                    onClick={() => manageAppointment(apt)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault();
                        manageAppointment(apt);
                      }
                    }}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <button
                          type="button"
                          className="block max-w-full truncate text-start font-semibold text-foreground underline-offset-2 hover:text-accent hover:underline focus:outline-none focus:ring-2 focus:ring-accent/30"
                          onClick={(event) => {
                            event.stopPropagation();
                            openPatientDrawer(apt);
                          }}
                        >
                          {patientName}
                        </button>
                        <p className="mt-1 font-mono text-xs text-muted-foreground">{apt.accessionNumber}</p>
                      </div>
                      <span className="inline-flex rounded-full bg-blue-100 px-2 py-0.5 text-[10px] font-semibold text-blue-700">
                        {statusLabel(language, apt.status)}
                      </span>
                    </div>
                    <p className="mt-2 text-xs text-muted-foreground">
                      {[categoryLabel, modalityName, examName, formatDateLy(apt.appointmentDate)].filter(Boolean).join(" • ")}
                    </p>
                    <ProtocolStatus appointment={apt} />
                    <div className="mt-3 grid grid-cols-6 gap-1" onClick={(event) => event.stopPropagation()}>
                      <Button type="button" size="sm" variant="secondary" className="h-9 px-0" onClick={() => void printAppointmentSlipById(apt.id, language)}>
                        <Printer size={15} />
                      </Button>
                      <Button type="button" size="sm" variant="secondary" aria-label={t("registrations.previewSlip")} title={t("registrations.previewSlip")} className="h-9 px-0" onClick={() => openSlipPreview(apt)}>
                        <Eye size={15} />
                      </Button>
                      <Button type="button" size="sm" variant="ghost" className="h-9 px-0" onClick={() => void handleViewAppointmentLink(apt)}>
                        <ExternalLink size={15} />
                      </Button>
                      <Button
                        type="button"
                        size="sm"
                        variant="secondary"
                        aria-label={t("registrations.report")}
                        title={publicAppointmentToken(apt) ? t("registrations.report") : t("registrations.reportUnavailable")}
                        className="h-9 px-0"
                        disabled={!publicAppointmentToken(apt)}
                        onClick={() => openReportPanel(apt, true)}
                      >
                        <FileText size={15} />
                      </Button>
                      <Button type="button" size="sm" variant="secondary" className="h-9 px-0" disabled={!apt.phone1} onClick={() => openWhatsappDialog(apt)}>
                        WA
                      </Button>
                      <Button type="button" size="sm" variant="secondary" className="h-9 px-0" disabled={!apt.patientWebPushSubscribed} onClick={() => openPatientNotificationDialog(apt)}>
                        <Bell size={15} />
                      </Button>
                    </div>
                  </div>
                );
              })
            )}
          </div>

          <div className="hidden min-w-[1140px] lg:block">
            <div className="grid grid-cols-[minmax(270px,1.7fr)_minmax(120px,0.72fr)_minmax(210px,1.05fr)_minmax(116px,0.6fr)_minmax(112px,0.55fr)_minmax(88px,0.38fr)_minmax(228px,0.72fr)] gap-2 border-b border-border bg-muted/40 px-3 py-2.5 text-[10px] font-semibold uppercase tracking-[0.04em] text-muted-foreground">
              <div>{t("registrations.patient")}</div>
              <div>{t("registrations.accession")}</div>
              <div>{t("registrations.modality")}</div>
              <div>{t("registrations.date")}</div>
              <div>{t("registrations.statusCol")}</div>
              <div>{t("registrations.walkIn")}</div>
              <div className="text-right">{language === "ar" ? "الإجراءات" : "Actions"}</div>
            </div>

            {isLoading ? (
              <div className="p-8 text-center text-muted-foreground">
                {t("common.loading")}
              </div>
            ) : appointments.length === 0 ? (
              <div className="p-8 text-center text-muted-foreground">
                {t("queue.empty")}
              </div>
            ) : (
              <div className="divide-y divide-border">
                {appointments.map((apt: AppointmentWithDetails, index: number) => {
                  const isSelected = selectedAppointment?.id === apt.id;
                  const patientName = chooseLocalized(language, apt.arabicFullName, apt.englishFullName);
                  const modalityName = chooseLocalized(language, apt.modalityNameAr, apt.modalityNameEn);
                  const examName = chooseLocalized(language, apt.examNameAr, apt.examNameEn);
                  const priorityName = chooseLocalized(language, apt.priorityNameAr, apt.priorityNameEn);
                  const notesText = String(apt.notes || "").trim();
                  const categoryLabel =
                    apt.caseCategory === "oncology"
                      ? t("appointments.create.oncology")
                      : apt.caseCategory === "non_oncology"
                        ? t("appointments.create.nonOncology")
                        : t("registrations.categoryUnknown");
                  const categoryRowClass = patientCategoryRowClass(apt.caseCategory, index, isSelected);
                  const statusToneClass =
                    apt.status === "arrived"
                      ? "bg-emerald-100 text-emerald-700"
                      : apt.status === "waiting"
                        ? "bg-amber-100 text-amber-700"
                        : apt.status === "completed"
                          ? "bg-slate-100 text-slate-700"
                          : apt.status === "cancelled" || apt.status === "voided" || apt.status === "discontinued"
                            ? "bg-rose-100 text-rose-700"
                            : "bg-blue-100 text-blue-700";
                  const rowTitle = [
                    `${t("registrations.patientCategory")}: ${categoryLabel}`,
                    notesText ? `${t("registrations.notes")}: ${notesText}` : null,
                  ]
                    .filter(Boolean)
                    .join(" | ");

                  return (
                    <div
                      key={apt.id}
                      role="button"
                      tabIndex={0}
                      onClick={() => manageAppointment(apt)}
                      title={rowTitle}
                      aria-label={`${patientName} ${apt.accessionNumber} ${categoryLabel} ${statusLabel(language, apt.status)}`}
                      data-category={apt.caseCategory || "unknown"}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" || e.key === " ") {
                          e.preventDefault();
                          manageAppointment(apt);
                        }
                      }}
                      className={`grid grid-cols-[minmax(270px,1.7fr)_minmax(120px,0.72fr)_minmax(210px,1.05fr)_minmax(116px,0.6fr)_minmax(112px,0.55fr)_minmax(88px,0.38fr)_minmax(190px,0.62fr)] items-center gap-2 px-3 py-2.5 transition-colors outline-none cursor-pointer ${categoryRowClass}`}
                      >
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-1.5">
                          <button
                            type="button"
                            className="block max-w-full truncate text-start text-[13px] font-semibold leading-tight text-foreground underline-offset-2 hover:text-accent hover:underline focus:outline-none focus:ring-2 focus:ring-accent/30"
                            onClick={(event) => {
                              event.stopPropagation();
                              openPatientDrawer(apt);
                            }}
                          >
                            {patientName}
                          </button>
                          {apt.patientWebPushSubscribed ? (
                            <span className="inline-flex items-center rounded-full border border-emerald-200 bg-emerald-50 px-1.5 py-0.5 text-[10px] font-semibold text-emerald-700">
                              {t("registrations.webPushBadge")}
                            </span>
                          ) : null}
                        </div>
                        <p className="mt-1 truncate text-[10.5px] leading-snug text-muted-foreground">
                          {[
                            categoryLabel,
                            apt.mrn || apt.nationalId || "—",
                            apt.phone1 || null,
                            [apt.sex || null, Number.isFinite(apt.ageYears) ? String(apt.ageYears) : null]
                              .filter(Boolean)
                              .join(" / ") || null,
                          ]
                            .filter(Boolean)
                            .join(" • ")}
                        </p>
                      </div>

                      <div className="min-w-0">
                        <p className="truncate font-mono text-[12px] font-semibold leading-tight tracking-tight text-foreground">
                          {apt.accessionNumber}
                        </p>
                        <p className="mt-1 text-[10px] leading-none text-muted-foreground">Seq {apt.dailySequence || "—"}</p>
                      </div>

                      <div className="min-w-0">
                        <p className="truncate text-[13px] font-medium leading-tight text-foreground">{modalityName}</p>
                        <p className="mt-0.5 truncate text-[10.5px] leading-snug text-muted-foreground">
                          {[examName || null, priorityName || null].filter(Boolean).join(" • ") || "—"}
                        </p>
                        <ProtocolStatus appointment={apt} />
                      </div>

                      <div className="text-[12px] font-medium leading-tight text-foreground">{formatDateLy(apt.appointmentDate)}</div>

                      <div>
                        <span className={`inline-flex rounded-full px-2 py-0.5 text-[10px] font-semibold ${statusToneClass}`}>
                          {statusLabel(language, apt.status)}
                        </span>
                      </div>

                      <div className="min-w-0 text-[10px] leading-snug text-muted-foreground">
                        <span
                          className={`inline-flex rounded-full border px-2 py-0.5 font-semibold ${
                            apt.isWalkIn
                              ? "border-amber-200 bg-amber-50 text-amber-700"
                              : "border-slate-200 bg-white/70 text-slate-600"
                          }`}
                        >
                          {apt.isWalkIn ? t("registrations.yes") : t("registrations.no")}
                        </span>
                      </div>

                      <div className="grid grid-cols-7 justify-end gap-1" aria-label={language === "ar" ? "إجراءات الموعد" : "Appointment actions"}>
                        <Button
                          type="button"
                          size="sm"
                          variant="secondary"
                          aria-label={t("registrations.print")}
                          title={t("registrations.print")}
                          onClick={(e) => {
                            e.stopPropagation();
                            void printAppointmentSlipById(apt.id, language);
                          }}
                          className="!h-8 !min-h-8 !w-8 !p-0"
                        >
                          <Printer size={15} strokeWidth={1.8} aria-hidden="true" />
                        </Button>
                        <Button
                          type="button"
                          size="sm"
                          variant="secondary"
                          aria-label={t("registrations.previewSlip")}
                          title={t("registrations.previewSlip")}
                          onClick={(e) => {
                            e.stopPropagation();
                            openSlipPreview(apt);
                          }}
                          className="!h-8 !min-h-8 !w-8 !p-0"
                        >
                          <Eye size={15} strokeWidth={1.8} aria-hidden="true" />
                        </Button>
                        <Button
                          type="button"
                          size="sm"
                          variant="ghost"
                          aria-label={t("registrations.link")}
                          title={t("registrations.viewAppointmentLink")}
                          className="!h-8 !min-h-8 !w-8 !p-0"
                          onClick={(e) => {
                            e.stopPropagation();
                            void handleViewAppointmentLink(apt);
                          }}
                        >
                          <ExternalLink size={15} strokeWidth={1.8} aria-hidden="true" />
                        </Button>
                        <Button
                          type="button"
                          size="sm"
                          variant="secondary"
                          aria-label={t("registrations.report")}
                          title={publicAppointmentToken(apt) ? t("registrations.report") : t("registrations.reportUnavailable")}
                          disabled={!publicAppointmentToken(apt)}
                          onClick={(e) => {
                            e.stopPropagation();
                            openReportPanel(apt, true);
                          }}
                          className={`!h-8 !min-h-8 !w-8 !p-0 ${publicAppointmentToken(apt) ? "" : "opacity-35"}`}
                        >
                          <FileText size={15} strokeWidth={1.8} aria-hidden="true" />
                        </Button>
                        <Button
                          type="button"
                          size="sm"
                          variant="secondary"
                          aria-label={t("registrations.whatsapp")}
                          title={apt.phone1 ? t("registrations.whatsapp") : t("registrations.whatsappNoPhone")}
                          disabled={!apt.phone1}
                          onClick={(e) => {
                            e.stopPropagation();
                            openWhatsappDialog(apt);
                          }}
                          className={`!h-8 !min-h-8 !w-8 !p-0 ${apt.phone1 ? "text-emerald-700" : "opacity-35"}`}
                        >
                          <span className={`inline-flex h-5 w-5 items-center justify-center rounded-full text-[8px] font-black ${
                            apt.phone1 ? "bg-emerald-500 text-white" : "bg-muted text-muted-foreground"
                          }`}>
                            WA
                          </span>
                        </Button>
                        <Button
                          type="button"
                          size="sm"
                          variant="secondary"
                          aria-label={t("registrations.webPushSend")}
                          title={
                            apt.patientWebPushSubscribed
                              ? t("registrations.webPushSend")
                              : t("registrations.webPushUnavailable")
                          }
                          disabled={!apt.patientWebPushSubscribed}
                          onClick={(e) => {
                            e.stopPropagation();
                            openPatientNotificationDialog(apt);
                          }}
                          className={`!h-8 !min-h-8 !w-8 !p-0 ${apt.patientWebPushSubscribed ? "" : "opacity-35"}`}
                        >
                          <Bell size={15} strokeWidth={1.8} aria-hidden="true" />
                        </Button>
                        <Button
                          type="button"
                          size="sm"
                          variant="secondary"
                          aria-label={t("registrations.manage")}
                          title={t("registrations.manage")}
                          className="!h-8 !min-h-8 !w-8 !p-0"
                          onClick={(e) => {
                            e.stopPropagation();
                            manageAppointment(apt);
                          }}
                        >
                          <MoreHorizontal size={16} strokeWidth={1.8} aria-hidden="true" />
                        </Button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      </Card>

      <AppointmentManageModal
        appointmentId={manageAppointmentId}
        open={manageAppointmentId !== null}
        initialAppointment={selectedAppointment}
        initialTab={initialManageTab}
        checkReportOnOpen={reportCheckOnOpen}
        onClose={closeManageModal}
        onTabChange={setManageTabAndUrl}
        onOpenAppointment={openAppointmentById}
        onAppointmentUpdated={setSelectedAppointment}
        onAppointmentDeleted={closeManageModal}
      />

      {selectedPatientId ? (
        <PatientDrawer patientId={selectedPatientId} onClose={() => setSelectedPatientId(null)} />
      ) : null}

      {whatsappAppointment ? (
        <Dialog open onClose={() => setWhatsappAppointment(null)}>
          <DialogContent
            aria-label={t("registrations.whatsappDialogTitle")}
            maxWidth="560px"
            className="!mx-3 !rounded-2xl !p-4 !shadow-2xl"
          data-testid="registrations-whatsapp-backdrop"
          >
          <form
            onSubmit={(e) => {
              e.preventDefault();
              sendWhatsappMessage();
            }}
          >
            <div className="flex items-start justify-between gap-3">
              <div>
                <h3 className="text-base font-semibold">{t("registrations.whatsappDialogTitle")}</h3>
                <p className="mt-1 text-xs text-muted-foreground">
                  {chooseLocalized(
                    language,
                    whatsappAppointment.arabicFullName,
                    whatsappAppointment.englishFullName,
                  )}{" "}
                  • {whatsappAppointment.phone1}
                </p>
              </div>
              <span className="inline-flex rounded-full border border-emerald-200 bg-emerald-50 px-2 py-1 text-[10px] font-semibold text-emerald-700">
                WhatsApp
              </span>
            </div>

            <div className="mt-3 flex rounded-xl border border-border bg-muted/20 p-1">
              <button
                type="button"
                className={`min-h-9 flex-1 rounded-lg px-3 text-xs font-medium transition-colors ${
                  whatsappMode === "template" ? "bg-background shadow-sm" : "text-muted-foreground"
                }`}
                onClick={() => setWhatsappMode("template")}
              >
                {t("registrations.webPushUseTemplate")}
              </button>
              <button
                type="button"
                className={`min-h-9 flex-1 rounded-lg px-3 text-xs font-medium transition-colors ${
                  whatsappMode === "custom" ? "bg-background shadow-sm" : "text-muted-foreground"
                }`}
                onClick={() => setWhatsappMode("custom")}
              >
                {t("registrations.webPushCustom")}
              </button>
            </div>

            {whatsappMode === "template" ? (
              <div className="mt-3">
                <label className="mb-1 block text-[10px] font-mono-data uppercase tracking-[0.08em] text-muted-foreground">
                  {t("registrations.webPushTemplate")}
                </label>
                <select
                  value={whatsappTemplate}
                  onChange={(e) => setWhatsappTemplate(e.target.value as typeof whatsappTemplate)}
                  className="input-premium w-full min-h-10"
                >
                  {whatsappTemplates.map((entry) => (
                    <option key={entry.value} value={entry.value}>
                      {entry.label}
                    </option>
                  ))}
                </select>
              </div>
            ) : (
              <div className="mt-3">
                <label className="mb-1 block text-[10px] font-mono-data uppercase tracking-[0.08em] text-muted-foreground">
                  {t("registrations.whatsappCustomMessage")}
                </label>
                <textarea
                  value={whatsappMessage}
                  onChange={(e) => setWhatsappMessage(e.target.value)}
                  rows={5}
                  className="input-premium w-full resize-none"
                  placeholder={t("registrations.whatsappCustomPlaceholder")}
                />
              </div>
            )}

            <div className="mt-3 rounded-xl border border-border bg-muted/20 p-3">
              <p className="mb-1 text-[10px] font-mono-data uppercase tracking-[0.08em] text-muted-foreground">
                {t("registrations.whatsappPreview")}
              </p>
              <p className="whitespace-pre-wrap text-sm leading-relaxed">{currentWhatsappMessage || "—"}</p>
            </div>

            <div className="mt-4 flex flex-wrap justify-end gap-2">
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => setWhatsappAppointment(null)}
              >
                {t("toast.close")}
              </Button>
              <Button type="submit" size="sm" disabled={!currentWhatsappMessage}>
                {t("registrations.whatsappOpen")}
              </Button>
            </div>
          </form>
          </DialogContent>
        </Dialog>
      ) : null}

      {notificationAppointment ? (
        <Dialog open onClose={() => setNotificationAppointment(null)}>
          <DialogContent
            aria-label={t("registrations.webPushDialogTitle")}
            maxWidth="520px"
            className="!mx-3 !rounded-2xl !p-4 !shadow-2xl"
          data-testid="patient-web-push-message-backdrop"
          >
          <form
            onSubmit={(e) => {
              e.preventDefault();
              if (!canSendCustomNotification || sendNotificationMutation.isPending) return;
              sendNotificationMutation.mutate();
            }}
          >
            <div className="flex items-start justify-between gap-3">
              <div>
                <h3 className="text-base font-semibold">{t("registrations.webPushDialogTitle")}</h3>
                <p className="mt-1 text-xs text-muted-foreground">
                  {chooseLocalized(
                    language,
                    notificationAppointment.arabicFullName,
                    notificationAppointment.englishFullName,
                  )}
                </p>
              </div>
              <span className="inline-flex rounded-full border border-emerald-200 bg-emerald-50 px-2 py-1 text-[10px] font-semibold text-emerald-700">
                {t("registrations.webPushBadge")}
              </span>
            </div>

            <p className="mt-3 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-[11px] leading-relaxed text-amber-900">
              {t("registrations.webPushPrivacyHint")}
            </p>

            <div className="mt-3 flex rounded-xl border border-border bg-muted/20 p-1">
              <button
                type="button"
                className={`min-h-9 flex-1 rounded-lg px-3 text-xs font-medium transition-colors ${
                  notificationMode === "template" ? "bg-background shadow-sm" : "text-muted-foreground"
                }`}
                onClick={() => setNotificationMode("template")}
              >
                {t("registrations.webPushUseTemplate")}
              </button>
              <button
                type="button"
                className={`min-h-9 flex-1 rounded-lg px-3 text-xs font-medium transition-colors ${
                  notificationMode === "custom" ? "bg-background shadow-sm" : "text-muted-foreground"
                }`}
                onClick={() => setNotificationMode("custom")}
              >
                {t("registrations.webPushCustom")}
              </button>
            </div>

            {notificationMode === "template" ? (
              <div className="mt-3">
                <label className="mb-1 block text-[10px] font-mono-data uppercase tracking-[0.08em] text-muted-foreground">
                  {t("registrations.webPushTemplate")}
                </label>
                <select
                  value={notificationTemplate}
                  onChange={(e) => setNotificationTemplate(e.target.value)}
                  className="input-premium w-full min-h-10"
                >
                  {notificationTemplates.map((entry) => (
                    <option key={entry.value} value={entry.value}>
                      {entry.label}
                    </option>
                  ))}
                </select>
              </div>
            ) : (
              <div className="mt-3 space-y-3">
                <div>
                  <label className="mb-1 block text-[10px] font-mono-data uppercase tracking-[0.08em] text-muted-foreground">
                    {t("registrations.webPushTitle")}
                  </label>
                  <Input
                    value={notificationTitle}
                    onChange={(e) => setNotificationTitle(e.target.value)}
                    maxLength={80}
                    className="w-full min-h-10"
                    placeholder={t("registrations.webPushTitlePlaceholder")}
                  />
                </div>
                <div>
                  <label className="mb-1 block text-[10px] font-mono-data uppercase tracking-[0.08em] text-muted-foreground">
                    {t("registrations.webPushMessage")}
                  </label>
                  <textarea
                    value={notificationMessage}
                    onChange={(e) => setNotificationMessage(e.target.value)}
                    maxLength={180}
                    rows={4}
                    className="input-premium w-full resize-none"
                    placeholder={t("registrations.webPushMessagePlaceholder")}
                  />
                </div>
              </div>
            )}

            <div className="mt-4 flex flex-wrap justify-end gap-2">
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => setNotificationAppointment(null)}
              >
                {t("toast.close")}
              </Button>
              <Button
                type="submit"
                size="sm"
                disabled={!canSendCustomNotification || sendNotificationMutation.isPending}
              >
                {sendNotificationMutation.isPending ? t("common.loading") : t("registrations.webPushSend")}
              </Button>
            </div>
          </form>
          </DialogContent>
        </Dialog>
      ) : null}

      {slipPreviewAppointment ? (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 px-2 py-2 sm:px-4 sm:py-4"
          onClick={closeSlipPreview}
          role="presentation"
          data-testid="slip-preview-backdrop"
        >
          <div
            className="flex w-full max-w-[980px] flex-col overflow-hidden rounded-3xl border border-border bg-background shadow-2xl max-h-[calc(100vh-1rem)]"
            onClick={(e) => e.stopPropagation()}
            role="dialog"
            aria-modal="true"
            aria-label={t("print.previewTitle")}
          >
            <div className="flex flex-col gap-2 border-b border-border p-3 sm:flex-row sm:items-start sm:justify-between sm:p-4">
              <div>
                <h3 className="text-base font-semibold leading-tight sm:text-lg">
                  {t("print.previewTitle")}
                </h3>
                <p className="text-xs sm:text-sm text-muted-foreground">
                  {t("print.previewSubtitle")}
                </p>
                <p className="mt-1 text-xs sm:text-sm text-muted-foreground">
                  {chooseLocalized(
                    language,
                    slipPreviewAppointment.arabicFullName,
                    slipPreviewAppointment.englishFullName,
                  )}{" "}
                  • {slipPreviewAppointment.accessionNumber}
                </p>
              </div>
              <div className="flex flex-wrap gap-2 sm:justify-end">
                <Button type="button" size="sm" variant="secondary" onClick={closeSlipPreview}>
                  {t("toast.close")}
                </Button>
                <Button type="button" size="sm" onClick={handlePreviewPrint}>
                  {t("print.confirmPrint")}
                </Button>
              </div>
            </div>

            <div className="min-h-0 bg-muted/10">
              {slipPreviewLoading ? (
                <div className="flex h-[56vh] items-center justify-center p-4 text-muted-foreground">
                  {t("print.loading")}
                </div>
              ) : slipPreviewHtml ? (
                <iframe
                  key={slipPreviewHtml}
                  title="Appointment slip preview"
                  srcDoc={slipPreviewHtml}
                  className="h-[56vh] w-full bg-white sm:h-[62vh]"
                  loading="eager"
                />
              ) : (
                <div className="flex h-[56vh] items-center justify-center p-4 text-muted-foreground">
                  {t("print.loading")}
                </div>
              )}
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
