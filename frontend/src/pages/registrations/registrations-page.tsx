import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  cancelAppointment,
  fetchAppointments,
  fetchAppointmentLookups,
} from "@/lib/api-hooks";
import type { AppointmentWithDetails } from "@/lib/mappers";
import { formatDateLy, isoDateDaysFromNow, todayIsoDateLy } from "@/lib/date-format";
import { DateInput } from "@/components/common/date-input";
import { useLanguage } from "@/providers/language-provider";
import { chooseLocalized, statusLabel } from "@/lib/i18n";
import { AppointmentEditor } from "@/components/appointments/appointment-editor";
import { RequestDocumentsPanel } from "@/components/documents/request-documents-panel";
import { pushToast } from "@/lib/toast";
import { Card, Button, SearchInput } from "@/components/shared";
import {
  blobToDataUrl,
  createAppointmentSlipPdfBlob,
  downloadAppointmentSlipPdf,
  printAppointmentList,
  printAppointmentSlip,
} from "@/lib/print-utils";

interface RegistrationsFilters {
  date: string;
  dateFrom: string;
  dateTo: string;
  modalityId: string;
  query: string;
  statuses: string[];
}

const DEFAULT_FILTERS: RegistrationsFilters = {
  date: todayIsoDateLy(),
  dateFrom: todayIsoDateLy(),
  dateTo: todayIsoDateLy(),
  modalityId: "",
  query: "",
  statuses: ["scheduled", "arrived", "waiting"],
};

const ACTIVE_FILTER_PILL_CLASS = "border-accent/25 bg-accent/10 text-accent shadow-sm ring-1 ring-accent/15";

export default function RegistrationsPage() {
  const { language, t } = useLanguage();
  const queryClient = useQueryClient();
  const [filters, setFilters] = useState<RegistrationsFilters>(DEFAULT_FILTERS);
  const [selectedAppointment, setSelectedAppointment] =
    useState<AppointmentWithDetails | null>(null);
  const [slipPreviewAppointment, setSlipPreviewAppointment] =
    useState<AppointmentWithDetails | null>(null);
  const [slipPreviewPdfUrl, setSlipPreviewPdfUrl] = useState<string | null>(null);
  const [slipPreviewLoading, setSlipPreviewLoading] = useState(false);
  const [pdfDownloading, setPdfDownloading] = useState(false);
  const previewFrameRef = useRef<HTMLIFrameElement | null>(null);

  const { data: lookups } = useQuery({
    queryKey: ["lookups"],
    queryFn: fetchAppointmentLookups,
    staleTime: 1000 * 60 * 5,
  });

  const { data: appointments = [], isLoading } = useQuery({
    queryKey: ["registrations", filters],
    queryFn: () =>
      fetchAppointments({
        dateFrom: filters.dateFrom,
        dateTo: filters.dateTo,
        modalityId: filters.modalityId,
        q: filters.query,
        status: filters.statuses,
      }),
    staleTime: 1000 * 30,
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

  const modalities = lookups?.modalities ?? [];
  const listWindowLabel = filters.date
    ? formatDateLy(filters.date)
    : `${filters.dateFrom ? formatDateLy(filters.dateFrom) : "—"} - ${filters.dateTo ? formatDateLy(filters.dateTo) : "—"}`;
  const todayValue = todayIsoDateLy();
  const tomorrowValue = isoDateDaysFromNow(1);
  const isTodayShortcutActive =
    filters.date === todayValue && filters.dateFrom === todayValue && filters.dateTo === todayValue;
  const isTomorrowShortcutActive =
    filters.date === tomorrowValue &&
    filters.dateFrom === tomorrowValue &&
    filters.dateTo === tomorrowValue;

  const handleFilterChange = <K extends keyof RegistrationsFilters>(
    key: K,
    value: RegistrationsFilters[K],
  ) => {
    setFilters((current) => ({ ...current, [key]: value }));
  };

  const handleDateChange = (key: "date" | "dateFrom" | "dateTo", value: string) => {
    setFilters((current) => {
      if (key === "date") {
        return {
          ...current,
          date: value,
          dateFrom: "",
          dateTo: "",
        };
      }

      return {
        ...current,
        [key]: value,
        date: "",
      };
    });
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
    const today = todayIsoDateLy();
    setFilters({
      ...DEFAULT_FILTERS,
      date: today,
      dateFrom: today,
      dateTo: today,
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
      date: value,
      dateFrom: value,
      dateTo: value,
      modalityId: filters.modalityId,
      query: filters.query,
      statuses: filters.statuses,
    });
    void queryClient.invalidateQueries({ queryKey: ["registrations"] });
  };

  const handlePrintVisibleList = () => {
    printAppointmentList(appointments, listWindowLabel);
  };

  const openSlipPreview = (appointment: AppointmentWithDetails) => {
    setSlipPreviewAppointment(appointment);
  };

  const manageAppointment = (appointment: AppointmentWithDetails) => {
    setSelectedAppointment(appointment);
  };

  useEffect(() => {
    let cancelled = false;

    if (!slipPreviewAppointment) {
      setSlipPreviewPdfUrl(null);
      setSlipPreviewLoading(false);
      return;
    }

    setSlipPreviewLoading(true);
    void createAppointmentSlipPdfBlob(slipPreviewAppointment, "blank")
      .then((blob) => {
        if (cancelled) return;
        return blobToDataUrl(blob);
      })
      .then((dataUrl) => {
        if (cancelled || !dataUrl) return;
        setSlipPreviewPdfUrl(dataUrl);
      })
      .finally(() => {
        if (!cancelled) setSlipPreviewLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [slipPreviewAppointment]);

  const closeSlipPreview = () => {
    setSlipPreviewAppointment(null);
    setSlipPreviewPdfUrl(null);
    setSlipPreviewLoading(false);
  };

  const handlePreviewPrint = () => {
    const frameWindow = previewFrameRef.current?.contentWindow;
    if (frameWindow) {
      frameWindow.focus();
      frameWindow.print();
      return;
    }
    if (!slipPreviewAppointment) return;
    printAppointmentSlip(slipPreviewAppointment);
  };

  const handlePreviewPdf = async () => {
    if (!slipPreviewAppointment) return;
    setPdfDownloading(true);
    try {
      await downloadAppointmentSlipPdf(slipPreviewAppointment);
    } finally {
      setPdfDownloading(false);
    }
  };

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
            <div className="mt-3 grid grid-cols-1 gap-3">
              <DateInput
                label={t("registrations.date")}
                value={filters.date}
                onChange={(value) => handleDateChange("date", value)}
              />
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <DateInput
                  label={t("registrations.dateFrom")}
                  value={filters.dateFrom}
                  onChange={(value) => handleDateChange("dateFrom", value)}
                />
                <DateInput
                  label={t("registrations.dateTo")}
                  value={filters.dateTo}
                  onChange={(value) => handleDateChange("dateTo", value)}
                />
              </div>
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
                    {status}
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
            <div className="grid grid-cols-[1.92fr_0.92fr_1.2fr_0.8fr_0.88fr_0.72fr_0.98fr] gap-1.5 border-b border-border bg-muted/40 px-3 py-1.5 text-[8px] font-semibold uppercase tracking-[0.1em] text-muted-foreground">
              <div>{t("registrations.patient")}</div>
              <div>{t("registrations.print")}</div>
              <div>{t("registrations.modality")}</div>
              <div>{t("registrations.date")}</div>
              <div>{t("registrations.statusCol")}</div>
              <div>{t("registrations.walkIn")}</div>
              <div className="text-right">Actions</div>
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
                      className={`grid grid-cols-[1.92fr_0.92fr_1.2fr_0.8fr_0.88fr_0.72fr_0.98fr] gap-1.5 px-3 py-1.5 transition-colors outline-none cursor-pointer ${
                        index % 2 === 0 ? "bg-background" : "bg-muted/25"
                      } ${isSelected ? "ring-1 ring-accent/30 bg-accent/5" : "hover:bg-muted/40"}`}
                      >
                      <div className="min-w-0">
                        <div className="flex items-start gap-1">
                          <div className="min-w-0">
                            <p className="truncate text-[12px] font-semibold leading-tight text-foreground">
                              {patientName}
                            </p>
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
                        </div>
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
                        <Button
                          type="button"
                          size="sm"
                          variant="secondary"
                          onClick={(e) => {
                            e.stopPropagation();
                            openSlipPreview(apt);
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
                            manageAppointment(apt);
                          }}
                        >
                          Manage
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
        <Card className="p-3 sm:p-3.5 space-y-2.5">
          <div className="flex flex-col gap-1.5 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <h3 className="text-sm font-semibold">
                {chooseLocalized(language, selectedAppointment.arabicFullName, selectedAppointment.englishFullName)}
              </h3>
              <p className="text-[11px] sm:text-xs text-muted-foreground">
                {selectedAppointment.accessionNumber} • {chooseLocalized(language, selectedAppointment.modalityNameAr, selectedAppointment.modalityNameEn)}
              </p>
            </div>
            <div className="flex flex-wrap gap-1">
              <Button type="button" variant="secondary" size="sm" className="h-8 px-2.5 text-[10px]" onClick={() => openSlipPreview(selectedAppointment)}>
                {t("registrations.print")}
              </Button>
              <Button type="button" variant="ghost" size="sm" className="h-8 px-2.5 text-[10px]" onClick={() => setSelectedAppointment(null)}>
                {t("toast.close")}
              </Button>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-2 text-sm">
            <Field
              label={t("registrations.patient")}
              value={chooseLocalized(
                language,
                selectedAppointment.arabicFullName,
                selectedAppointment.englishFullName,
              )}
            />
            <Field
              label={t("registrations.modality")}
              value={chooseLocalized(
                language,
                selectedAppointment.modalityNameAr,
                selectedAppointment.modalityNameEn,
              )}
            />
            <Field
              label={t("registrations.date")}
              value={formatDateLy(selectedAppointment.appointmentDate)}
            />
            <Field
              label={t("registrations.statusCol")}
              value={statusLabel(language, selectedAppointment.status)}
            />
            <Field
              label={t("registrations.walkIn")}
              value={selectedAppointment.isWalkIn ? t("registrations.yes") : t("registrations.no")}
            />
          </div>

          <div className="grid grid-cols-1 xl:grid-cols-2 gap-2.5">
            <details className="rounded-2xl border border-border bg-muted/20 p-3" open>
              <summary className="cursor-pointer text-sm font-semibold text-foreground">
                {t("registrations.cancelAppointment")}
              </summary>
              <div className="mt-2.5">
                {["scheduled", "arrived", "waiting"].includes(selectedAppointment.status) && (
                  <div className="mb-2 flex justify-end">
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
                )}
                <AppointmentEditor
                  appointment={selectedAppointment}
                  lookups={lookups}
                  onUpdated={(updated) => setSelectedAppointment(updated)}
                  onDeleted={() => setSelectedAppointment(null)}
                />
              </div>
            </details>

            <details className="rounded-2xl border border-border bg-muted/20 p-3">
              <summary className="cursor-pointer text-sm font-semibold text-foreground">
                {t("registrations.requestDocuments")}
              </summary>
              <div className="mt-2.5">
                <RequestDocumentsPanel
                  appointmentId={selectedAppointment.id}
                  patientId={selectedAppointment.patientId}
                  appointmentRefType="v2_booking"
                  title={t("registrations.requestDocuments")}
                />
              </div>
            </details>
          </div>
        </Card>
      ) : null}

      {slipPreviewAppointment ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 px-2 py-2 sm:px-4 sm:py-4">
          <div className="flex w-full max-w-[1360px] flex-col overflow-hidden rounded-3xl border border-border bg-background shadow-2xl max-h-[calc(100vh-1rem)]">
            <div className="flex flex-col gap-2 border-b border-border p-3 sm:flex-row sm:items-start sm:justify-between sm:p-4">
              <div>
                <h3 className="text-base font-semibold leading-tight sm:text-lg">
                  {t("print.previewTitle")}
                </h3>
                <p className="text-xs sm:text-sm text-muted-foreground">
                  {t("print.previewSubtitle")}
                </p>
              </div>
              <div className="flex flex-wrap gap-2 sm:justify-end">
                <Button type="button" size="sm" variant="secondary" onClick={closeSlipPreview}>
                  {t("toast.close")}
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant="secondary"
                  onClick={() => void handlePreviewPdf()}
                  disabled={pdfDownloading}
                >
                  {pdfDownloading ? t("common.loading") : t("print.downloadPdf")}
                </Button>
                <Button type="button" size="sm" onClick={handlePreviewPrint}>
                  {t("print.confirmPrint")}
                </Button>
              </div>
            </div>

            <div className="grid min-h-0 grid-cols-1 xl:grid-cols-[minmax(0,1.38fr)_280px] gap-0">
              <div className="min-h-[48vh] bg-muted/10 xl:min-h-[60vh]">
                {slipPreviewLoading ? (
                  <div className="flex h-full items-center justify-center p-4 text-muted-foreground">
                    {t("print.loading")}
                  </div>
                ) : slipPreviewPdfUrl ? (
                  <iframe
                    ref={previewFrameRef}
                    key={slipPreviewPdfUrl}
                    title="Appointment slip preview"
                    src={slipPreviewPdfUrl}
                    className="h-[48vh] w-full bg-white xl:h-[60vh]"
                    loading="eager"
                  />
                ) : (
                  <div className="flex h-full items-center justify-center p-4 text-muted-foreground">
                    {t("print.loading")}
                  </div>
                )}
              </div>

              <div className="border-t border-border p-3 space-y-2 text-sm sm:p-4 xl:border-t-0 xl:border-l xl:max-h-[58vh] xl:overflow-y-auto">
                <div className="space-y-0.5">
                  <p className="text-xs font-mono uppercase tracking-[0.15em] text-muted-foreground">
                    {t("registrations.patient")}
                  </p>
                  <p className="text-sm sm:text-[15px] font-semibold leading-tight">
                    {chooseLocalized(
                      language,
                      slipPreviewAppointment.arabicFullName,
                      slipPreviewAppointment.englishFullName,
                    )}
                  </p>
                </div>

                <div className="grid grid-cols-2 gap-1.5">
                  <Field label={t("registrations.modality")} value={chooseLocalized(language, slipPreviewAppointment.modalityNameAr, slipPreviewAppointment.modalityNameEn)} />
                  <Field label={t("registrations.date")} value={formatDateLy(slipPreviewAppointment.appointmentDate)} />
                  <Field label={t("registrations.statusCol")} value={statusLabel(language, slipPreviewAppointment.status)} />
                  <Field label={t("registrations.print")} value={slipPreviewAppointment.accessionNumber} />
                </div>
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
