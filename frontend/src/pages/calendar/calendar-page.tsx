import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { ChevronLeft, ChevronRight, ListFilter, Search } from "lucide-react";
import { fetchAppointments, fetchAppointmentLookups } from "@/lib/api-hooks";
import type { AppointmentWithDetails } from "@/lib/mappers";
import { formatDateLy, todayIsoDateLy } from "@/lib/date-format";
import { PatientDrawer } from "@/components/patients/patient-drawer";
import { PatientCategoryBadge } from "@/components/patients/patient-category-badge";
import { patientCategoryRowClass } from "@/lib/patient-category-theme";
import { useLanguage } from "@/providers/language-provider";
import { chooseLocalized, statusLabel, t } from "@/lib/i18n";
import { printAppointmentSlipById } from "@/lib/appointment-printing";
import { printDayListFromRoute } from "@/lib/day-list-printing";
import { Button, Card, Badge, Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, SectionLabel } from "@/components/shared";
import { filterVisibleAppointments } from "@/lib/print-utils";

interface CalendarDay {
  date: string;
  dayNumber: number;
  isCurrentMonth: boolean;
  isToday: boolean;
  count: number;
  oncology: number;
  nonOncology: number;
  summary: { modality: string; count: number }[];
  isSelected: boolean;
}

interface ModalitySummary {
  key: string;
  modalityId: number | null;
  label: string;
  total: number;
  oncology: number;
  nonOncology: number;
  appointments: AppointmentWithDetails[];
}

export default function CalendarPage() {
  const { language } = useLanguage();
  const today = new Date();
  const [displayDate, setDisplayDate] = useState(new Date(today.getFullYear(), today.getMonth(), 1));
  const [selectedDate, setSelectedDate] = useState(todayIsoDateLy());
  const [userSelectedDate, setUserSelectedDate] = useState(false);
  const [modalityFilter, setModalityFilter] = useState("");
  const [categoryFilter, setCategoryFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedModalitySummaryKey, setSelectedModalitySummaryKey] = useState<string | null>(null);
  const [isModalityModalOpen, setIsModalityModalOpen] = useState(false);
  const [selectedPatientId, setSelectedPatientId] = useState<number | null>(null);
  const navigate = useNavigate();

  // Load appointments for the displayed month range
  const startDate = formatDate(new Date(displayDate.getFullYear(), displayDate.getMonth(), 1));
  const endDate = formatDate(new Date(displayDate.getFullYear(), displayDate.getMonth() + 1, 0));

  const { data: appointments = [], isLoading } = useQuery({
    queryKey: ["calendar", startDate, endDate, modalityFilter],
    queryFn: () => fetchAppointments({ dateFrom: startDate, dateTo: endDate, ...(modalityFilter && { modalityId: modalityFilter }) }),
    staleTime: 1000 * 60,
    placeholderData: (previousData) => previousData
  });
  const visibleAppointments = useMemo(() => filterVisibleAppointments(appointments), [appointments]);
  const filteredAppointments = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();
    return visibleAppointments.filter((appointment) => {
      if (categoryFilter && appointment.caseCategory !== categoryFilter) return false;
      if (statusFilter && appointment.status !== statusFilter) return false;
      if (!query) return true;

      return [
        appointment.accessionNumber,
        appointment.arabicFullName,
        appointment.englishFullName,
        appointment.mrn,
        appointment.nationalId,
        appointment.modalityNameAr,
        appointment.modalityNameEn,
        appointment.examNameAr,
        appointment.examNameEn,
      ]
        .filter(Boolean)
        .some((value) => String(value).toLowerCase().includes(query));
    });
  }, [categoryFilter, searchQuery, statusFilter, visibleAppointments]);

  // Load lookups for modality filter
  const { data: lookups } = useQuery({
    queryKey: ["lookups"],
    queryFn: fetchAppointmentLookups,
    staleTime: 1000 * 60 * 5
  });

  // Group appointments by date
  const groupedByDate = useMemo(() => filteredAppointments.reduce((acc, apt) => {
    const date = String(apt.appointmentDate || "").slice(0, 10);
    if (!date) return acc;
    if (!acc[date]) acc[date] = [];
    acc[date].push(apt);
    return acc;
  }, {} as Record<string, AppointmentWithDetails[]>), [filteredAppointments]);

  const monthStats = useMemo(() => buildMonthStats(filteredAppointments, language), [filteredAppointments, language]);

  useEffect(() => {
    if (userSelectedDate || isLoading || groupedByDate[selectedDate] || filteredAppointments.length === 0) return;

    const firstAppointmentDate = filteredAppointments
      .map((appointment) => String(appointment.appointmentDate || "").slice(0, 10))
      .filter(Boolean)
      .sort()[0];

    if (firstAppointmentDate) {
      setSelectedDate(firstAppointmentDate);
      setSelectedModalitySummaryKey(null);
      setIsModalityModalOpen(false);
    }
  }, [filteredAppointments, groupedByDate, isLoading, selectedDate, userSelectedDate]);

  // Build grid
  const gridDays = useMemo(
    () => buildCalendarGrid(displayDate, selectedDate, groupedByDate, language),
    [displayDate, selectedDate, groupedByDate, language]
  );

  // Selected day appointments
  const selectedAppointments = useMemo(() => groupedByDate[selectedDate] || [], [groupedByDate, selectedDate]);
  const selectedDateSummaries = useMemo(() => buildSelectedDaySummaries(selectedAppointments, language), [selectedAppointments, language]);
  const selectedModalitySummary = useMemo(
    () => selectedDateSummaries.find((summary) => summary.key === selectedModalitySummaryKey) || null,
    [selectedDateSummaries, selectedModalitySummaryKey]
  );
  const selectedModalityStatusCounts = useMemo(
    () => selectedModalitySummary ? buildStatusCounts(selectedModalitySummary.appointments) : [],
    [selectedModalitySummary]
  );

  const prevMonth = () => {
    setDisplayDate((d) => {
      const nextDate = new Date(d.getFullYear(), d.getMonth() - 1, 1);
      setSelectedDate(formatDate(nextDate));
      return nextDate;
    });
    setUserSelectedDate(false);
  };

  const nextMonth = () => {
    setDisplayDate((d) => {
      const nextDate = new Date(d.getFullYear(), d.getMonth() + 1, 1);
      setSelectedDate(formatDate(nextDate));
      return nextDate;
    });
    setUserSelectedDate(false);
  };

  const goToday = () => {
    const now = new Date();
    setDisplayDate(new Date(now.getFullYear(), now.getMonth(), 1));
    setSelectedDate(formatDate(now));
    setUserSelectedDate(true);
  };

  const selectDay = (date: string) => {
    setSelectedDate(date);
    setUserSelectedDate(true);
    setSelectedModalitySummaryKey(null);
    setIsModalityModalOpen(false);
  };

  const openModalitySummary = (summary: ModalitySummary) => {
    setSelectedModalitySummaryKey(summary.key);
    setIsModalityModalOpen(true);
  };

  const openRegistrationForAppointment = (appointment: AppointmentWithDetails) => {
    navigate(`/registrations?appointmentId=${appointment.id}&patientId=${appointment.patientId}`);
  };

  const openRegistrationsForSelectedDay = () => {
    navigate(`/registrations?date=${selectedDate}`);
  };

  const printSelectedDayList = () => {
    printDayListFromRoute({
      date: selectedDate,
      modalityId: modalityFilter,
      status: statusFilter,
      caseCategory: categoryFilter,
      q: searchQuery.trim(),
      sort: "time-asc",
      columns: ["sequence", "patient", "accession", "time", "modality", "exam", "category", "priority", "status"],
    });
  };

  return (
    <div className="max-w-7xl mx-auto space-y-6">
      {/* Header */}
      <div className="space-y-3 sm:space-y-4 lg:hidden">
        <div className="flex items-center gap-4">
          <SectionLabel>{t(language, "calendar.sectionLabel")}</SectionLabel>
        </div>
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <h1 className="text-2xl sm:text-3xl font-display" style={{ color: "var(--foreground)" }}>
            <span className="gradient-text">{t(language, "calendar.title")}</span>
          </h1>
        </div>
      </div>

      <Card className="p-3 sm:p-4">
        <div className="flex flex-col gap-3 xl:flex-row xl:items-end xl:justify-between">
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-4 xl:flex-1">
            <label className="space-y-1">
              <span className="flex items-center gap-1.5 text-[10px] font-mono uppercase tracking-[0.12em] text-muted-foreground">
                <Search size={12} />
                {t(language, "calendar.search")}
              </span>
              <input
                value={searchQuery}
                onChange={(event) => setSearchQuery(event.target.value)}
                className="input-premium h-11 w-full"
                placeholder={t(language, "calendar.searchPlaceholder")}
                aria-label={t(language, "calendar.search")}
              />
            </label>
            <label className="space-y-1">
              <span className="flex items-center gap-1.5 text-[10px] font-mono uppercase tracking-[0.12em] text-muted-foreground">
                <ListFilter size={12} />
                {t(language, "calendar.modalityFilter")}
              </span>
              <select
                value={modalityFilter}
                onChange={(event) => setModalityFilter(event.target.value)}
                className="input-premium h-11 w-full"
                aria-label={t(language, "calendar.modalityFilter")}
              >
                <option value="">{t(language, "calendar.allModalities")}</option>
                {(lookups?.modalities ?? []).map((m: any) => (
                  <option key={m.id} value={m.id.toString()}>
                    {chooseLocalized(language, m.nameAr, m.nameEn)}
                  </option>
                ))}
              </select>
            </label>
            <label className="space-y-1">
              <span className="text-[10px] font-mono uppercase tracking-[0.12em] text-muted-foreground">
                {t(language, "calendar.categoryFilter")}
              </span>
              <select
                value={categoryFilter}
                onChange={(event) => setCategoryFilter(event.target.value)}
                className="input-premium h-11 w-full"
                aria-label={t(language, "calendar.categoryFilter")}
              >
                <option value="">{t(language, "calendar.allCategories")}</option>
                <option value="oncology">{t(language, "calendar.oncologyLabel")}</option>
                <option value="non_oncology">{t(language, "calendar.nonOncologyLabel")}</option>
              </select>
            </label>
            <label className="space-y-1">
              <span className="text-[10px] font-mono uppercase tracking-[0.12em] text-muted-foreground">
                {t(language, "calendar.statusFilter")}
              </span>
              <select
                value={statusFilter}
                onChange={(event) => setStatusFilter(event.target.value)}
                className="input-premium h-11 w-full"
                aria-label={t(language, "calendar.statusFilter")}
              >
                <option value="">{t(language, "calendar.allStatuses")}</option>
                {["scheduled", "arrived", "waiting", "completed", "cancelled", "voided", "discontinued"].map((status) => (
                  <option key={status} value={status}>
                    {statusLabel(language, status)}
                  </option>
                ))}
              </select>
            </label>
          </div>

          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-10 self-start xl:self-end"
            onClick={() => {
              setSearchQuery("");
              setCategoryFilter("");
              setStatusFilter("");
              setModalityFilter("");
            }}
          >
            {t(language, "calendar.clearFilters")}
          </Button>
        </div>
      </Card>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Calendar Grid */}
        <Card className="lg:col-span-2 overflow-hidden p-0">
          {/* Header */}
          <div className="border-b border-border p-3 sm:p-4">
            <div className="flex items-center justify-between gap-2">
              <button onClick={prevMonth} className="inline-flex h-10 w-10 items-center justify-center rounded-lg hover:bg-muted transition-colors" aria-label={t(language, "calendar.previousMonth")}>
                <ChevronLeft size={20} />
              </button>
              <div className="min-w-0 text-center">
                <h3 className="truncate text-base font-semibold sm:text-xl">
                  {displayDate.toLocaleString(language === "ar" ? "ar-LY" : "en", { month: "long", year: "numeric" })}
                </h3>
                <p className="mt-1 text-xs text-muted-foreground">{t(language, "calendar.monthTotal", { count: monthStats.total })}</p>
              </div>
              <div className="flex gap-1.5">
                <Button variant="secondary" size="sm" onClick={goToday} className="h-10 px-3">
                  {t(language, "calendar.today")}
                </Button>
                <button onClick={nextMonth} className="inline-flex h-10 w-10 items-center justify-center rounded-lg hover:bg-muted transition-colors" aria-label={t(language, "calendar.nextMonth")}>
                  <ChevronRight size={20} />
                </button>
              </div>
            </div>

            <div className="mt-3 grid grid-cols-2 gap-2 text-xs sm:grid-cols-4">
              <SummaryStat label={t(language, "calendar.totalLabel")} value={monthStats.total} />
              <SummaryStat label={t(language, "calendar.oncologyLabel")} value={monthStats.oncology} />
              <SummaryStat label={t(language, "calendar.nonOncologyLabel")} value={monthStats.nonOncology} />
              <SummaryStat label={t(language, "calendar.busiestDay")} value={monthStats.busiestCount} detail={monthStats.busiestLabel} />
            </div>
          </div>

          {/* Weekday Headers */}
          <div className="grid grid-cols-7 bg-muted/50 border-b border-border">
            {[t(language, "calendar.sun"), t(language, "calendar.mon"), t(language, "calendar.tue"), t(language, "calendar.wed"), t(language, "calendar.thu"), t(language, "calendar.fri"), t(language, "calendar.sat")].map((day) => (
              <div key={day} className="p-2 text-center text-[11px] font-medium text-muted-foreground sm:p-3 sm:text-sm">
                {day}
              </div>
            ))}
          </div>

          {/* Grid */}
          <div className="grid grid-cols-7">
            {isLoading ? (
              <div className="col-span-7 p-12 text-center text-muted-foreground">{t(language, "calendar.loading")}</div>
            ) : (
              gridDays.map((day) => (
                <button
                  key={day.date}
                  onClick={() => selectDay(day.date)}
                  className={`relative min-h-[76px] border-b border-e border-border p-1.5 text-right transition-all duration-200 hover:bg-muted/50 sm:min-h-[112px] sm:p-3 ${
                    !day.isCurrentMonth ? "bg-muted/30" : ""
                  } ${day.isSelected ? "bg-accent/10 ring-2 ring-inset ring-accent" : ""}`}
                >
                  <span
                    className={`text-xs font-medium sm:text-sm ${
                      day.isToday
                        ? "bg-accent text-white w-6 h-6 rounded-full flex items-center justify-center ml-auto mb-1 sm:h-7 sm:w-7 sm:mb-2"
                        : day.isCurrentMonth
                          ? ""
                          : "text-muted-foreground opacity-50"
                    }`}
                  >
                    {day.dayNumber}
                  </span>
                  {day.count > 0 && (
                    <div className="mt-1 space-y-1">
                      <div className="flex flex-wrap justify-end gap-1">
                        <span className="rounded-full bg-accent/10 px-1.5 py-0.5 text-[10px] font-semibold text-accent sm:text-[11px]">
                          {day.count}
                        </span>
                        {day.oncology > 0 && (
                          <span className="rounded-full bg-rose-100 px-1.5 py-0.5 text-[10px] font-semibold text-rose-700 sm:text-[11px]">
                            {day.oncology}
                          </span>
                        )}
                        {day.nonOncology > 0 && (
                          <span className="rounded-full bg-sky-100 px-1.5 py-0.5 text-[10px] font-semibold text-sky-700 sm:text-[11px]">
                            {day.nonOncology}
                          </span>
                        )}
                      </div>
                      <div className="hidden space-y-1 sm:block">
                      {day.summary.slice(0, 2).map((s, i) => (
                        <div key={i} className="text-xs text-muted-foreground truncate text-right">
                          {s.modality} ({s.count})
                        </div>
                      ))}
                      {day.summary.length > 2 && (
                        <div className="text-xs text-muted-foreground text-right">{t(language, "calendar.more", { count: day.summary.length - 2 })}</div>
                      )}
                      </div>
                    </div>
                  )}
                </button>
              ))
            )}
          </div>
        </Card>

        {/* Sidebar: Selected Day Registration Summary */}
        <div>
          <Card className="overflow-hidden sticky top-6">
            <div className="p-4 border-b border-border" data-testid="selected-day-summary">
              <h3 className="font-semibold text-lg">
                {selectedDate === formatDate(new Date()) ? t(language, "calendar.todayRegistrations") : t(language, "calendar.dayRegistrations", { date: formatDateDisplay(selectedDate) })}
              </h3>
              <p className="text-sm text-muted-foreground mt-1">
                {selectedAppointments.length} {selectedAppointments.length === 1 ? t(language, "calendar.registrationCount", { count: 1 }) : t(language, "calendar.registrationCountPlural", { count: selectedAppointments.length })}
              </p>
              <div className="mt-4 flex flex-wrap gap-2">
                <Button
                  size="sm"
                  onClick={printSelectedDayList}
                  disabled={selectedAppointments.length === 0}
                >
                  {t(language, "calendar.printDayList")}
                </Button>
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={() => navigate(`/print?date=${selectedDate}`)}
                >
                  {t(language, "calendar.openPrintTab")}
                </Button>
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={openRegistrationsForSelectedDay}
                  disabled={selectedAppointments.length === 0}
                >
                  {t(language, "calendar.openDayRegistrations")}
                </Button>
              </div>
            </div>
            {isLoading ? (
              <div className="p-8 text-center text-muted-foreground">{t(language, "calendar.loading")}</div>
            ) : selectedDateSummaries.length === 0 ? (
              <div className="p-12 text-center text-muted-foreground">
                {t(language, "calendar.noRegistrations")}
              </div>
            ) : (
              <div className="p-4 space-y-3 max-h-[600px] overflow-y-auto" data-testid="selected-day-summary-list">
                {selectedDateSummaries.map((summary) => (
                  <button
                    key={summary.key}
                    type="button"
                    onClick={() => openModalitySummary(summary)}
                    data-testid={`modality-summary-${summary.key}`}
                    aria-label={`${summary.label} ${t(language, "calendar.totalRegistrations", { count: summary.total })}`}
                    className="w-full rounded-xl border border-border bg-muted/20 p-4 text-left transition-colors hover:bg-muted/50"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <p className="font-semibold">{summary.label}</p>
                        <p className="mt-1 text-xs text-muted-foreground">
                          {t(language, "calendar.totalRegistrations", { count: summary.total })}
                        </p>
                      </div>
                      <Badge variant="info" size="sm">
                        {summary.total}
                      </Badge>
                    </div>
                    <div className="mt-3 grid grid-cols-2 gap-2 text-xs sm:grid-cols-3">
                      <SummaryStat label={t(language, "calendar.totalLabel")} value={summary.total} />
                      <SummaryStat label={t(language, "calendar.oncologyLabel")} value={summary.oncology} />
                      <SummaryStat label={t(language, "calendar.nonOncologyLabel")} value={summary.nonOncology} />
                    </div>
                  </button>
                ))}
              </div>
            )}
          </Card>
        </div>
      </div>

      <Dialog open={isModalityModalOpen && !!selectedModalitySummary} onClose={() => setIsModalityModalOpen(false)}>
        <DialogContent maxWidth="860px">
          {selectedModalitySummary && (
            <>
              <DialogHeader>
                <div>
                  <DialogTitle>{selectedModalitySummary.label}</DialogTitle>
                  <DialogDescription>
                    {t(language, "calendar.dayRegistrations", { date: formatDateDisplay(selectedDate) })} • {t(language, "calendar.totalRegistrations", { count: selectedModalitySummary.total })}
                  </DialogDescription>
                </div>
              </DialogHeader>

              <div className="mt-4 grid grid-cols-2 gap-2 text-xs sm:grid-cols-3">
                <SummaryStat label={t(language, "calendar.totalLabel")} value={selectedModalitySummary.total} />
                <SummaryStat label={t(language, "calendar.oncologyLabel")} value={selectedModalitySummary.oncology} />
                <SummaryStat label={t(language, "calendar.nonOncologyLabel")} value={selectedModalitySummary.nonOncology} />
              </div>
              {selectedModalityStatusCounts.length > 0 ? (
                <div className="mt-3 flex flex-wrap gap-1.5">
                  {selectedModalityStatusCounts.map(({ status, count }) => (
                    <Badge key={status} variant="neutral" size="sm">
                      {statusLabel(language, status)}: {count}
                    </Badge>
                  ))}
                </div>
              ) : null}

              <div className="mt-4 space-y-2 max-h-[55vh] overflow-y-auto">
                {selectedModalitySummary.appointments.map((appointment, index) => (
                  <div
                    key={appointment.id}
                    className={`rounded-xl border border-border p-3 ${patientCategoryRowClass(appointment.caseCategory, index)}`}
                    data-category={appointment.caseCategory || "unknown"}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <button
                            type="button"
                            className="font-medium underline-offset-2 hover:text-accent hover:underline focus:outline-none focus:ring-2 focus:ring-accent/30"
                            onClick={() => setSelectedPatientId(appointment.patientId)}
                          >
                            {chooseLocalized(language, appointment.arabicFullName, appointment.englishFullName)}
                          </button>
                          <PatientCategoryBadge category={appointment.caseCategory} showWhenUnset={false} size="sm" />
                          <StatusBadge language={language} status={appointment.status} />
                        </div>
                        <p className="mt-1 text-xs text-muted-foreground font-mono">{appointment.accessionNumber}</p>
                        <p className="mt-1 text-xs text-muted-foreground">
                          {[
                            chooseLocalized(language, appointment.modalityNameAr, appointment.modalityNameEn),
                            chooseLocalized(language, appointment.examNameAr, appointment.examNameEn),
                            appointment.bookingTime || formatDateDisplay(appointment.appointmentDate),
                          ].filter(Boolean).join(" • ")}
                        </p>
                      </div>
                      <div className="flex shrink-0 items-center gap-2">
                        <Button
                          type="button"
                          size="sm"
                          variant="secondary"
                          onClick={() => void printAppointmentSlipById(appointment.id, language)}
                        >
                          {t(language, "calendar.print")}
                        </Button>
                        <Button
                          type="button"
                          size="sm"
                          onClick={() => openRegistrationForAppointment(appointment)}
                        >
                          {t(language, "calendar.manageRegistration")}
                        </Button>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </>
          )}
        </DialogContent>
      </Dialog>
      {selectedPatientId ? (
        <PatientDrawer patientId={selectedPatientId} onClose={() => setSelectedPatientId(null)} />
      ) : null}
    </div>
  );
}

function buildStatusCounts(appointments: AppointmentWithDetails[]) {
  const counts = new Map<string, number>();
  appointments.forEach((appointment) => {
    counts.set(appointment.status, (counts.get(appointment.status) || 0) + 1);
  });
  return Array.from(counts, ([status, count]) => ({ status, count })).sort((a, b) => b.count - a.count);
}

function buildSelectedDaySummaries(
  appointments: AppointmentWithDetails[],
  language: "ar" | "en"
): ModalitySummary[] {
  const buckets = new Map<string, ModalitySummary>();
  appointments.forEach((appointment) => {
    const modalityId = Number.isFinite(appointment.modalityId) ? appointment.modalityId : null;
    const label = chooseLocalized(language, appointment.modalityNameAr, appointment.modalityNameEn) || t(language, "calendar.other");
    const key = modalityId != null ? `modality:${modalityId}` : `label:${label}`;
    if (!buckets.has(key)) {
      buckets.set(key, {
        key,
        modalityId,
        label,
        total: 0,
        oncology: 0,
        nonOncology: 0,
        appointments: [],
      });
    }
    const bucket = buckets.get(key)!;
    bucket.total += 1;
    if (appointment.caseCategory === "oncology") bucket.oncology += 1;
    if (appointment.caseCategory === "non_oncology") bucket.nonOncology += 1;
    bucket.appointments.push(appointment);
  });

  return Array.from(buckets.values()).sort((a, b) => {
    if (b.total !== a.total) return b.total - a.total;
    return a.label.localeCompare(b.label);
  });
}

function buildMonthStats(appointments: AppointmentWithDetails[], language: "ar" | "en") {
  const countsByDate = new Map<string, number>();
  let oncology = 0;
  let nonOncology = 0;

  appointments.forEach((appointment) => {
    const date = String(appointment.appointmentDate || "").slice(0, 10);
    if (date) countsByDate.set(date, (countsByDate.get(date) || 0) + 1);
    if (appointment.caseCategory === "oncology") oncology += 1;
    if (appointment.caseCategory === "non_oncology") nonOncology += 1;
  });

  let busiestDate = "";
  let busiestCount = 0;
  countsByDate.forEach((count, date) => {
    if (count > busiestCount) {
      busiestDate = date;
      busiestCount = count;
    }
  });

  return {
    total: appointments.length,
    oncology,
    nonOncology,
    busiestCount,
    busiestLabel: busiestDate ? formatDateLy(busiestDate) : t(language, "calendar.none"),
  };
}

function buildCalendarGrid(
  displayDate: Date,
  selectedDate: string,
  groupedByDate: Record<string, AppointmentWithDetails[]>,
  language: "ar" | "en"
): CalendarDay[] {
  const todayStr = formatDate(new Date());
  const firstDayOfMonth = new Date(displayDate.getFullYear(), displayDate.getMonth(), 1);
  const startOffset = firstDayOfMonth.getDay(); // 0 = Sunday

  const gridStart = new Date(firstDayOfMonth.getFullYear(), firstDayOfMonth.getMonth(), firstDayOfMonth.getDate());
  gridStart.setDate(gridStart.getDate() - startOffset);

  const days: CalendarDay[] = [];
  for (let i = 0; i < 42; i++) {
    const date = new Date(gridStart.getFullYear(), gridStart.getMonth(), gridStart.getDate() + i);
    const dateStr = formatDate(date);
    const dayAppointments = groupedByDate[dateStr] || [];

    const summary = dayAppointments.reduce((acc, apt) => {
      const mod = chooseLocalized(language, apt.modalityNameAr, apt.modalityNameEn) || t(language, "calendar.other");
      acc[mod] = (acc[mod] || 0) + 1;
      return acc;
    }, {} as Record<string, number>);

    days.push({
      date: dateStr,
      dayNumber: date.getDate(),
      isCurrentMonth: date.getMonth() === displayDate.getMonth(),
      isToday: dateStr === todayStr,
      count: dayAppointments.length,
      oncology: dayAppointments.filter((appointment) => appointment.caseCategory === "oncology").length,
      nonOncology: dayAppointments.filter((appointment) => appointment.caseCategory === "non_oncology").length,
      summary: Object.entries(summary)
        .map(([modality, count]) => ({ modality, count: count as number }))
        .sort((a, b) => b.count - a.count),
      isSelected: dateStr === selectedDate
    });
  }
  return days;
}

function formatDate(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function formatDateDisplay(dateStr: string): string {
  return formatDateLy(dateStr);
}

function StatusBadge({ language, status }: { language: "ar" | "en"; status: string }) {
  const variantMap: Record<string, "success" | "info" | "warning" | "neutral" | "accent"> = {
    scheduled: "info",
    arrived: "success",
    waiting: "warning",
    completed: "success",
    "no-show": "accent",
    cancelled: "neutral"
  };

  return (
    <Badge variant={variantMap[status] || "neutral"} size="sm">
      {statusLabel(language, status)}
    </Badge>
  );
}

function SummaryStat({ label, value, detail }: { label: string; value: number; detail?: string }) {
  return (
    <div className="rounded-xl border border-border bg-muted/30 p-2.5">
      <p className="text-[10px] uppercase tracking-[0.12em] font-mono text-muted-foreground mb-0.5">{label}</p>
      <p className="text-sm font-medium leading-snug break-words">{value}</p>
      {detail ? <p className="mt-0.5 truncate text-[10px] text-muted-foreground">{detail}</p> : null}
    </div>
  );
}
