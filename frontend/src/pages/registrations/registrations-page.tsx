import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  cancelAppointment,
  fetchAppointments,
  fetchAppointmentLookups,
  fetchAppointmentSlipSettings,
  fetchPatientQrSettings,
  sendPatientWebPushNotification,
} from "@/lib/api-hooks";
import type { AppointmentWithDetails } from "@/lib/mappers";
import { formatDateLy, isoDateDaysFromNow, todayIsoDateLy } from "@/lib/date-format";
import { DateInput } from "@/components/common/date-input";
import { useLanguage } from "@/providers/language-provider";
import { chooseLocalized, statusLabel } from "@/lib/i18n";
import { AppointmentEditor } from "@/components/appointments/appointment-editor";
import { RequestDocumentsPanel } from "@/components/documents/request-documents-panel";
import { PatientCategoryBadge } from "@/components/patients/patient-category-badge";
import { pushToast } from "@/lib/toast";
import { printAppointmentSlipById } from "@/lib/appointment-printing";
import { Card, Button, SearchInput } from "@/components/shared";
import {
  prepareAppointmentSlipHtml,
  printAppointmentList,
} from "@/lib/print-utils";
import { buildRegistrationAppointmentQuery } from "./registration-query";
import type { RegistrationsFilters } from "./registration-query";

const DEFAULT_FILTERS: RegistrationsFilters = {
  dateMode: "single",
  date: todayIsoDateLy(),
  dateFrom: "",
  dateTo: "",
  modalityId: "",
  query: "",
  statuses: ["scheduled", "arrived", "waiting"],
};

const ACTIVE_FILTER_PILL_CLASS = "border-accent/25 bg-accent/10 text-accent shadow-sm ring-1 ring-accent/15";

export default function RegistrationsPage() {
  const { language, t } = useLanguage();
  const isRtl = language === "ar";
  const queryClient = useQueryClient();
  const [filters, setFilters] = useState<RegistrationsFilters>(DEFAULT_FILTERS);
  const [selectedAppointment, setSelectedAppointment] =
    useState<AppointmentWithDetails | null>(null);
  const [slipPreviewAppointment, setSlipPreviewAppointment] =
    useState<AppointmentWithDetails | null>(null);
  const [slipPreviewHtml, setSlipPreviewHtml] = useState<string | null>(null);
  const [slipPreviewLoading, setSlipPreviewLoading] = useState(false);
  const [manageTab, setManageTab] = useState<"details" | "documents" | "cancel">("details");
  const [notificationAppointment, setNotificationAppointment] =
    useState<AppointmentWithDetails | null>(null);
  const [notificationMode, setNotificationMode] = useState<"template" | "custom">("template");
  const [notificationTemplate, setNotificationTemplate] = useState("appointment_reminder_24h");
  const [notificationTitle, setNotificationTitle] = useState("");
  const [notificationMessage, setNotificationMessage] = useState("");
  const [whatsappAppointment, setWhatsappAppointment] =
    useState<AppointmentWithDetails | null>(null);
  const [whatsappMode, setWhatsappMode] = useState<"template" | "custom">("template");
  const [whatsappTemplate, setWhatsappTemplate] = useState("qr_link");
  const [whatsappMessage, setWhatsappMessage] = useState("");

  const { data: lookups } = useQuery({
    queryKey: ["lookups"],
    queryFn: fetchAppointmentLookups,
    staleTime: 1000 * 60 * 5,
  });

  const { data: appointments = [], isLoading } = useQuery({
    queryKey: ["registrations", filters],
    queryFn: () => fetchAppointments(buildRegistrationAppointmentQuery(filters)),
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

  const cancelMutation = useMutation({
    mutationFn: (id: number) => cancelAppointment(id, "Cancelled from registrations"),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["registrations"] });
      queryClient.invalidateQueries({ queryKey: ["queue"] });
      queryClient.invalidateQueries({ queryKey: ["calendar"] });
      pushToast({
        type: "success",
        title: t("registrations.cancelledTitle"),
        message: t("registrations.cancelledMessage"),
      });
      setSelectedAppointment(null);
    },
    onError: (err: any) => {
      pushToast({
        type: "error",
        title: t("registrations.cancelFailedTitle"),
        message: err?.message || t("registrations.cancelFailedMessage"),
      });
    },
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
    onError: (err: any) => {
      pushToast({
        type: "error",
        title: t("registrations.webPushSendFailedTitle"),
        message: err?.message || t("registrations.webPushSendFailedMessage"),
      });
    },
  });

  const modalities = lookups?.modalities ?? [];
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

  const handleDateModeChange = (dateMode: RegistrationsFilters["dateMode"]) => {
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
  };

  const handleTodayShortcut = () => {
    setFilters({
      ...DEFAULT_FILTERS,
      dateMode: "single",
      date: todayValue,
      dateFrom: "",
      dateTo: "",
      modalityId: filters.modalityId,
      query: filters.query,
      statuses: filters.statuses,
    });
    void queryClient.invalidateQueries({ queryKey: ["registrations"] });
  };

  const handleTomorrowShortcut = () => {
    const value = isoDateDaysFromNow(1);
    setFilters({
      ...DEFAULT_FILTERS,
      dateMode: "single",
      date: value,
      dateFrom: "",
      dateTo: "",
      modalityId: filters.modalityId,
      query: filters.query,
      statuses: filters.statuses,
    });
    void queryClient.invalidateQueries({ queryKey: ["registrations"] });
  };

  const handlePrintVisibleList = () => {
    printAppointmentList(appointments, listWindowLabel);
  };

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

  const openSlipPreview = (appointment: AppointmentWithDetails) => {
    setSlipPreviewAppointment(appointment);
  };

  const manageAppointment = (appointment: AppointmentWithDetails) => {
    setSelectedAppointment(appointment);
    setManageTab("details");
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

  const normalizeWhatsappPhone = (phone: string | null | undefined): string => {
    let digits = String(phone || "").replace(/\D/g, "");
    if (digits.startsWith("00")) digits = digits.slice(2);
    if (digits.startsWith("0")) digits = `218${digits.slice(1)}`;
    return digits;
  };

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

  const whatsappTemplateText = (template: string, appointment: AppointmentWithDetails): string => {
    const link = String(appointment.publicAppointmentUrl || "").trim();
    const date = formatDateLy(appointment.appointmentDate);
    const templates: Record<string, string> = {
      qr_link: t("registrations.whatsappMessageQrLink"),
      appointment_reminder: t("registrations.whatsappMessageReminder"),
      appointment_rescheduled: t("registrations.whatsappMessageRescheduled"),
      appointment_changed: t("registrations.whatsappMessageChanged"),
      appointment_cancelled: t("registrations.whatsappMessageCancelled"),
    };
    return String(templates[template] || templates.qr_link)
      .replace(/\{link\}/g, link)
      .replace(/\{date\}/g, date);
  };

  const currentWhatsappMessage = whatsappAppointment
    ? whatsappMode === "template"
      ? whatsappTemplateText(whatsappTemplate, whatsappAppointment)
      : whatsappMessage.trim()
    : "";

  const sendWhatsappMessage = () => {
    if (!whatsappAppointment) return;
    const phone = normalizeWhatsappPhone(whatsappAppointment.phone1);
    if (!phone || !currentWhatsappMessage) return;
    window.open(`https://wa.me/${phone}?text=${encodeURIComponent(currentWhatsappMessage)}`, "_blank", "noopener,noreferrer");
    setWhatsappAppointment(null);
  };

  const closeManageDrawer = () => {
    setSelectedAppointment(null);
    setManageTab("details");
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

    if (!slipPreviewAppointment) {
      setSlipPreviewHtml(null);
      setSlipPreviewLoading(false);
      return;
    }

    if (!settingsReady) {
      setSlipPreviewLoading(true);
      return;
    }

    setSlipPreviewLoading(true);
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

  useEffect(() => {
    if (!selectedAppointment) return;
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        closeManageDrawer();
      }
    };
    document.addEventListener("keydown", handleEscape);
    return () => document.removeEventListener("keydown", handleEscape);
  }, [selectedAppointment]);

  function Field({ label, value }: { label: string; value: any }) {
    return (
      <div className="rounded-lg border border-border bg-muted/30 p-2">
        <p className="mb-0.5 font-mono text-[9px] uppercase tracking-[0.1em] text-muted-foreground">
          {label}
        </p>
        <p className="text-[13px] font-medium leading-snug">{value ?? "—"}</p>
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
                  {modalities.map((modality: any) => (
                    <option key={modality.id} value={String(modality.id)}>
                      {modality.nameEn ?? modality.name ?? modality.code ?? `#${modality.id}`}
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
              {["scheduled", "arrived", "waiting", "completed", "no-show", "cancelled"].map(
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
        <div className="flex flex-col gap-1.5 border-b border-border p-3.5 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h3 className="text-lg font-semibold">{t("registrations.title")}</h3>
            <p className="text-xs sm:text-sm text-muted-foreground">
              {appointments.length} {language === "ar" ? "موعد" : "appointments"} {listWindowLabel}
            </p>
          </div>
          <Button type="button" variant="secondary" size="sm" className="h-8 px-3 text-xs" onClick={handlePrintVisibleList}>
            {t("registrations.print")}
          </Button>
        </div>

        <div className="overflow-x-auto">
          <div className="min-w-[1140px]">
            <div className="grid grid-cols-[1.92fr_0.92fr_1.2fr_0.8fr_0.88fr_0.72fr_1.5fr] gap-1.5 border-b border-border bg-muted/40 px-3 py-1.5 text-[8px] font-semibold uppercase tracking-[0.1em] text-muted-foreground">
              <div>{t("registrations.patient")}</div>
              <div>{t("registrations.print")}</div>
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

                  return (
                    <div
                      key={apt.id}
                      role="button"
                      tabIndex={0}
                      onClick={() => openSlipPreview(apt)}
                      title={notesText ? `Notes: ${notesText}` : undefined}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" || e.key === " ") {
                          e.preventDefault();
                          openSlipPreview(apt);
                        }
                      }}
                      className={`grid grid-cols-[1.92fr_0.92fr_1.2fr_0.8fr_0.88fr_0.72fr_1.5fr] gap-1.5 px-3 py-1.5 transition-colors outline-none cursor-pointer ${
                        index % 2 === 0 ? "bg-background" : "bg-muted/25"
                      } ${isSelected ? "ring-1 ring-accent/30 bg-accent/5" : "hover:bg-muted/40"}`}
                      >
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-1.5">
                          <p className="truncate text-[12px] font-semibold leading-tight text-foreground">
                            {patientName}
                          </p>
                          <PatientCategoryBadge category={apt.caseCategory} showWhenUnset={false} size="sm" />
                          {apt.patientWebPushSubscribed ? (
                            <span className="inline-flex items-center rounded-full border border-emerald-200 bg-emerald-50 px-1.5 py-0.5 text-[8px] font-semibold text-emerald-700">
                              {t("registrations.webPushBadge")}
                            </span>
                          ) : null}
                        </div>
                        <p className="mt-0.5 truncate text-[9px] leading-none text-muted-foreground">
                          {[
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
                        <p className="truncate font-mono text-[10px] font-semibold leading-tight tracking-tight text-foreground">
                          {apt.accessionNumber}
                        </p>
                        <p className="text-[8px] leading-none text-muted-foreground">Seq {apt.dailySequence || "—"}</p>
                      </div>

                      <div className="min-w-0">
                        <p className="truncate text-[11px] font-medium leading-tight text-foreground">{modalityName}</p>
                        <p className="truncate text-[9px] leading-snug text-muted-foreground">
                          {[examName || null, priorityName || null].filter(Boolean).join(" • ") || "—"}
                        </p>
                      </div>

                      <div className="text-[11px] leading-tight text-foreground">{formatDateLy(apt.appointmentDate)}</div>

                      <div>
                        <span className="inline-flex rounded-full bg-blue-100 px-2 py-0.5 text-[9px] font-medium text-blue-700">
                          {statusLabel(language, apt.status)}
                        </span>
                      </div>

                      <div className="min-w-0 text-[9px] leading-snug text-muted-foreground">
                        <p className="truncate">{apt.isWalkIn ? t("registrations.yes") : t("registrations.no")}</p>
                      </div>

                      <div className="flex justify-end gap-1">
                        {apt.phone1 ? (
                          <Button
                            type="button"
                            size="sm"
                            variant="secondary"
                            onClick={(e) => {
                              e.stopPropagation();
                              openWhatsappDialog(apt);
                            }}
                            className="h-7 px-2 text-[9px]"
                          >
                            {t("registrations.whatsapp")}
                          </Button>
                        ) : null}
                        {apt.patientWebPushSubscribed ? (
                          <Button
                            type="button"
                            size="sm"
                            variant="secondary"
                            onClick={(e) => {
                              e.stopPropagation();
                              openPatientNotificationDialog(apt);
                            }}
                            className="h-7 px-2 text-[9px]"
                          >
                            {t("registrations.webPushSend")}
                          </Button>
                        ) : null}
                        <Button
                          type="button"
                          size="sm"
                          variant="secondary"
                          onClick={(e) => {
                            e.stopPropagation();
                            void printAppointmentSlipById(apt.id, language);
                          }}
                          className="h-7 px-2 text-[9px]"
                        >
                          {t("registrations.print")}
                        </Button>
                        <Button
                          type="button"
                          size="sm"
                          variant="ghost"
                          className="h-7 px-2 text-[9px]"
                          onClick={(e) => {
                            e.stopPropagation();
                            void handleViewAppointmentLink(apt);
                          }}
                        >
                          {t("registrations.viewAppointmentLink")}
                        </Button>
                        <Button
                          type="button"
                          size="sm"
                          variant="ghost"
                          className="h-7 px-2 text-[9px]"
                          onClick={(e) => {
                            e.stopPropagation();
                            manageAppointment(apt);
                          }}
                        >
                          {t("registrations.manage")}
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

      {selectedAppointment ? (
        <div
          className="fixed inset-0 z-50 bg-black/45"
          onClick={closeManageDrawer}
          role="presentation"
          data-testid="registrations-manage-backdrop"
        >
          <div
            className={`absolute top-0 h-full w-full overflow-y-auto bg-background shadow-2xl sm:w-[600px] ${
              isRtl ? "left-0" : "right-0"
            }`}
            onClick={(e) => e.stopPropagation()}
            role="dialog"
            aria-modal="true"
            aria-label={t("registrations.manage")}
          >
            <div className="border-b border-border p-3 sm:p-4">
              <div className="flex items-start justify-between gap-2">
                <div>
                  <div className="flex flex-wrap items-center gap-2">
                    <h3 className="text-sm font-semibold sm:text-base">
                      {chooseLocalized(
                        language,
                        selectedAppointment.arabicFullName,
                        selectedAppointment.englishFullName,
                      )}
                    </h3>
                    <PatientCategoryBadge
                      category={selectedAppointment.caseCategory}
                      showWhenUnset={false}
                      size="sm"
                    />
                  </div>
                  <p className="text-[11px] sm:text-xs text-muted-foreground">
                    {selectedAppointment.accessionNumber} •{" "}
                    {chooseLocalized(language, selectedAppointment.modalityNameAr, selectedAppointment.modalityNameEn)}
                  </p>
                </div>
                <div className="flex flex-wrap gap-1">
                  <Button
                    type="button"
                    variant="secondary"
                    size="sm"
                    className="h-8 px-2.5 text-[10px]"
                    onClick={() => void printAppointmentSlipById(selectedAppointment.id, language)}
                  >
                    {t("registrations.print")}
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="h-8 px-2.5 text-[10px]"
                    onClick={closeManageDrawer}
                  >
                    {t("toast.close")}
                  </Button>
                </div>
              </div>
              <div className="mt-3 grid grid-cols-1 gap-2 text-sm sm:grid-cols-2">
                <Field
                  label={t("registrations.patient")}
                  value={chooseLocalized(
                    language,
                    selectedAppointment.arabicFullName,
                    selectedAppointment.englishFullName,
                  )}
                />
                <Field
                  label={t("registrations.accession")}
                  value={selectedAppointment.accessionNumber}
                />
                <Field
                  label={t("registrations.modality")}
                  value={[
                    chooseLocalized(language, selectedAppointment.modalityNameAr, selectedAppointment.modalityNameEn),
                    chooseLocalized(language, selectedAppointment.examNameAr, selectedAppointment.examNameEn),
                  ]
                    .filter(Boolean)
                    .join(" • ") || "—"}
                />
                <Field
                  label={t("registrations.date")}
                  value={formatDateLy(selectedAppointment.appointmentDate)}
                />
              </div>
              <div className="mt-2">
                <span className="inline-flex rounded-full bg-blue-100 px-2 py-0.5 text-[10px] font-medium text-blue-700">
                  {statusLabel(language, selectedAppointment.status)}
                </span>
              </div>
            </div>

            <div className="border-b border-border px-3 py-2 sm:px-4">
              <div className="flex flex-wrap gap-1.5">
                <Button
                  type="button"
                  size="sm"
                  variant={manageTab === "details" ? "secondary" : "ghost"}
                  className="h-8 px-2.5 text-[10px]"
                  onClick={() => setManageTab("details")}
                >
                  {t("registrations.detailsEdit")}
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant={manageTab === "documents" ? "secondary" : "ghost"}
                  className="h-8 px-2.5 text-[10px]"
                  onClick={() => setManageTab("documents")}
                >
                  {t("registrations.requestDocuments")}
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant={manageTab === "cancel" ? "secondary" : "ghost"}
                  className="h-8 px-2.5 text-[10px]"
                  onClick={() => setManageTab("cancel")}
                >
                  {t("registrations.cancelAppointment")}
                </Button>
              </div>
            </div>

            <div className="p-3 sm:p-4">
              {manageTab === "details" ? (
                <AppointmentEditor
                  appointment={selectedAppointment}
                  lookups={lookups}
                  onUpdated={(updated) => setSelectedAppointment(updated)}
                  onDeleted={closeManageDrawer}
                />
              ) : null}

              {manageTab === "documents" ? (
                <RequestDocumentsPanel
                  appointmentId={selectedAppointment.id}
                  patientId={selectedAppointment.patientId}
                  appointmentRefType="v2_booking"
                  title={t("registrations.requestDocuments")}
                />
              ) : null}

              {manageTab === "cancel" ? (
                ["scheduled", "arrived", "waiting"].includes(selectedAppointment.status) ? (
                  <div className="rounded-2xl border border-border bg-muted/20 p-3">
                    <div className="mb-2 text-xs text-muted-foreground">
                      {t("registrations.cancelAppointment")}
                    </div>
                    <div className={isRtl ? "flex justify-start" : "flex justify-end"}>
                      <Button
                        size="sm"
                        variant="ghost"
                        style={{ color: "#ef4444" }}
                        onClick={() => {
                          if (!window.confirm(t("common.confirmCancelAppointment"))) return;
                          cancelMutation.mutate(selectedAppointment.id);
                        }}
                      >
                        {t("registrations.cancelAppointment")}
                      </Button>
                    </div>
                  </div>
                ) : (
                  <div className="rounded-2xl border border-border bg-muted/20 p-3 text-xs text-muted-foreground">
                    {t("registrations.cancelNotAllowed")}
                  </div>
                )
              ) : null}
            </div>
          </div>
        </div>
      ) : null}

      {whatsappAppointment ? (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 px-3 py-4"
          onClick={() => setWhatsappAppointment(null)}
          role="presentation"
          data-testid="registrations-whatsapp-backdrop"
        >
          <form
            className="w-full max-w-[560px] rounded-2xl border border-border bg-background p-4 shadow-2xl"
            onClick={(e) => e.stopPropagation()}
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
                  onChange={(e) => setWhatsappTemplate(e.target.value)}
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
        </div>
      ) : null}

      {notificationAppointment ? (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 px-3 py-4"
          onClick={() => setNotificationAppointment(null)}
          role="presentation"
          data-testid="patient-web-push-message-backdrop"
        >
          <form
            className="w-full max-w-[520px] rounded-2xl border border-border bg-background p-4 shadow-2xl"
            onClick={(e) => e.stopPropagation()}
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
                  <input
                    value={notificationTitle}
                    onChange={(e) => setNotificationTitle(e.target.value)}
                    maxLength={80}
                    className="input-premium w-full min-h-10"
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
        </div>
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
