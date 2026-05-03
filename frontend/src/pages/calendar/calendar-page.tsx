import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { fetchAppointments, fetchAppointmentLookups } from "@/lib/api-hooks";
import type { AppointmentWithDetails } from "@/lib/mappers";
import { formatDateLy, todayIsoDateLy } from "@/lib/date-format";
import { PatientCategoryBadge } from "@/components/patients/patient-category-badge";
import { useLanguage } from "@/providers/language-provider";
import { chooseLocalized, statusLabel, t } from "@/lib/i18n";
import { printAppointmentSlipById } from "@/lib/appointment-printing";
import { Button, Card, Badge, Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, SectionLabel } from "@/components/shared";
import { filterVisibleAppointments } from "@/lib/print-utils";

interface CalendarDay {
  date: string;
  dayNumber: number;
  isCurrentMonth: boolean;
  isToday: boolean;
  count: number;
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
  const [modalityFilter, setModalityFilter] = useState("");
  const [selectedModalitySummaryKey, setSelectedModalitySummaryKey] = useState<string | null>(null);
  const [isModalityModalOpen, setIsModalityModalOpen] = useState(false);
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

  // Load lookups for modality filter
  const { data: lookups } = useQuery({
    queryKey: ["lookups"],
    queryFn: fetchAppointmentLookups,
    staleTime: 1000 * 60 * 5
  });

  // Group appointments by date
  const groupedByDate = useMemo(() => visibleAppointments.reduce((acc, apt) => {
    const date = String(apt.appointmentDate || "").slice(0, 10);
    if (!date) return acc;
    if (!acc[date]) acc[date] = [];
    acc[date].push(apt);
    return acc;
  }, {} as Record<string, any[]>), [visibleAppointments]);

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

  const prevMonth = () => {
    setDisplayDate((d) => new Date(d.getFullYear(), d.getMonth() - 1, 1));
  };

  const nextMonth = () => {
    setDisplayDate((d) => new Date(d.getFullYear(), d.getMonth() + 1, 1));
  };

  const goToday = () => {
    const now = new Date();
    setDisplayDate(new Date(now.getFullYear(), now.getMonth(), 1));
    setSelectedDate(formatDate(now));
  };

  const selectDay = (date: string) => {
    setSelectedDate(date);
    setSelectedModalitySummaryKey(null);
    setIsModalityModalOpen(false);
  };

  const openModalitySummary = (summary: ModalitySummary) => {
    setSelectedModalitySummaryKey(summary.key);
    setIsModalityModalOpen(true);
  };

  const openRegistrationsForSummary = (summary: ModalitySummary) => {
    const params = new URLSearchParams();
    params.set("date", selectedDate);
    if (summary.modalityId != null) {
      params.set("modalityId", String(summary.modalityId));
    }
    navigate(`/registrations?${params.toString()}`);
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
          <div className="flex items-center gap-3">
            <select
              value={modalityFilter}
              onChange={(e) => setModalityFilter(e.target.value)}
              className="input-premium h-12 w-auto min-w-[200px]"
            >
              <option value="">{t(language, "calendar.allModalities")}</option>
              {(lookups?.modalities ?? []).map((m: any) => (
                <option key={m.id} value={m.id.toString()}>
                  {m.nameEn}
                </option>
              ))}
            </select>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Calendar Grid */}
        <Card className="lg:col-span-2 overflow-hidden p-0">
          {/* Header */}
          <div className="p-4 border-b border-border flex items-center justify-between">
            <button onClick={prevMonth} className="p-2 rounded-lg hover:bg-muted transition-colors">
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
              </svg>
            </button>
            <h3 className="text-xl font-semibold">
              {displayDate.toLocaleString("default", { month: "long", year: "numeric" })}
            </h3>
            <div className="flex gap-2">
              <Button
                variant="secondary"
                size="sm"
                onClick={goToday}
              >
                {t(language, "calendar.today")}
              </Button>
              <button onClick={nextMonth} className="p-2 rounded-lg hover:bg-muted transition-colors">
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                </svg>
              </button>
            </div>
          </div>

          {/* Weekday Headers */}
          <div className="grid grid-cols-7 bg-muted/50 border-b border-border">
            {[t(language, "calendar.sun"), t(language, "calendar.mon"), t(language, "calendar.tue"), t(language, "calendar.wed"), t(language, "calendar.thu"), t(language, "calendar.fri"), t(language, "calendar.sat")].map((day) => (
              <div key={day} className="p-3 text-center text-sm font-medium text-muted-foreground">
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
                  className={`min-h-[100px] p-3 border-b border-e border-border text-right transition-all duration-200 hover:bg-muted/50 relative ${
                    !day.isCurrentMonth ? "bg-muted/30" : ""
                  } ${day.isSelected ? "bg-accent/10 ring-2 ring-inset ring-accent" : ""}`}
                >
                  <span
                    className={`text-sm font-medium ${
                      day.isToday
                        ? "bg-accent text-white w-7 h-7 rounded-full flex items-center justify-center ml-auto mb-2"
                        : day.isCurrentMonth
                          ? ""
                          : "text-muted-foreground opacity-50"
                    }`}
                  >
                    {day.dayNumber}
                  </span>
                  {day.count > 0 && (
                    <div className="space-y-1 mt-1">
                      {day.summary.slice(0, 2).map((s, i) => (
                        <div key={i} className="text-xs text-muted-foreground truncate text-right">
                          {s.modality} ({s.count})
                        </div>
                      ))}
                      {day.summary.length > 2 && (
                        <div className="text-xs text-muted-foreground text-right">{t(language, "calendar.more", { count: day.summary.length - 2 })}</div>
                      )}
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
                  onClick={() => navigate(`/print?date=${selectedDate}`)}
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

              <div className="mt-4 space-y-2 max-h-[55vh] overflow-y-auto">
                {selectedModalitySummary.appointments.map((appointment) => (
                  <div key={appointment.id} className="rounded-xl border border-border p-3">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <p className="font-medium">{chooseLocalized(language, appointment.arabicFullName, appointment.englishFullName)}</p>
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
                          onClick={() => openRegistrationsForSummary(selectedModalitySummary)}
                        >
                          {t(language, "calendar.openRegistrations")}
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
    </div>
  );
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

function buildCalendarGrid(
  displayDate: Date,
  selectedDate: string,
  groupedByDate: Record<string, any[]>,
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

function SummaryStat({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-xl border border-border bg-muted/30 p-2.5">
      <p className="text-[10px] uppercase tracking-[0.12em] font-mono text-muted-foreground mb-0.5">{label}</p>
      <p className="text-sm font-medium leading-snug break-words">{value}</p>
    </div>
  );
}
