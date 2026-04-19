import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { cancelAppointment, fetchAppointments, fetchAppointmentLookups } from "@/lib/api-hooks";
import type { AppointmentWithDetails } from "@/lib/mappers";
import { formatDateLy, todayIsoDateLy } from "@/lib/date-format";
import { AppointmentEditor } from "@/components/appointments/appointment-editor";
import { useLanguage } from "@/providers/language-provider";
import { t } from "@/lib/i18n";
import { pushToast } from "@/lib/toast";
import { Button, Card, Badge, SectionLabel } from "@/components/shared";

interface CalendarDay {
  date: string;
  dayNumber: number;
  isCurrentMonth: boolean;
  isToday: boolean;
  count: number;
  summary: { modality: string; count: number }[];
  isSelected: boolean;
}

export default function CalendarPage() {
  const { language } = useLanguage();
  const today = new Date();
  const [displayDate, setDisplayDate] = useState(new Date(today.getFullYear(), today.getMonth(), 1));
  const [selectedDate, setSelectedDate] = useState(todayIsoDateLy());
  const [modalityFilter, setModalityFilter] = useState("");
  const [selectedAppointment, setSelectedAppointment] = useState<AppointmentWithDetails | null>(null);
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const cancelMutation = useMutation({
    mutationFn: (appointmentId: number) => cancelAppointment(appointmentId, "Cancelled from calendar"),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["calendar"] });
      queryClient.invalidateQueries({ queryKey: ["registrations"] });
      queryClient.invalidateQueries({ queryKey: ["queue"] });
      pushToast({
        type: "success",
        title: "Appointment cancelled",
        message: "Appointment status changed to cancelled."
      });
      setSelectedAppointment(null);
    },
    onError: (err: any) => {
      pushToast({
        type: "error",
        title: "Cancel failed",
        message: err?.message || "Could not cancel appointment."
      });
    }
  });

  // Load appointments for the displayed month range
  const startDate = formatDate(new Date(displayDate.getFullYear(), displayDate.getMonth(), 1));
  const endDate = formatDate(new Date(displayDate.getFullYear(), displayDate.getMonth() + 1, 0));

  const { data: appointments = [], isLoading } = useQuery({
    queryKey: ["calendar", startDate, endDate, modalityFilter],
    queryFn: () => fetchAppointments({ dateFrom: startDate, dateTo: endDate, ...(modalityFilter && { modalityId: modalityFilter }) }),
    staleTime: 1000 * 60,
    placeholderData: (previousData) => previousData
  });

  // Load lookups for modality filter
  const { data: lookups } = useQuery({
    queryKey: ["lookups"],
    queryFn: fetchAppointmentLookups,
    staleTime: 1000 * 60 * 5
  });

  // Group appointments by date
  const groupedByDate = useMemo(() => appointments.reduce((acc, apt) => {
    const date = String(apt.appointmentDate || "").slice(0, 10);
    if (!date) return acc;
    if (!acc[date]) acc[date] = [];
    acc[date].push(apt);
    return acc;
  }, {} as Record<string, any[]>), [appointments]);

  // Build grid
  const gridDays = useMemo(
    () => buildCalendarGrid(displayDate, selectedDate, groupedByDate),
    [displayDate, selectedDate, groupedByDate]
  );

  // Selected day appointments
  const selectedAppointments = useMemo(() => groupedByDate[selectedDate] || [], [groupedByDate, selectedDate]);

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
    setSelectedAppointment(null);
  };

  return (
    <div className="max-w-7xl mx-auto space-y-8">
      {/* Header */}
      <div className="space-y-4">
        <div className="flex items-center gap-4">
          <SectionLabel>CALENDAR</SectionLabel>
        </div>
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <h1 className="text-3xl font-display" style={{ color: "var(--foreground)" }}>
            Appointment <span className="gradient-text">Calendar</span>
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

        {/* Sidebar: Selected Day Details */}
        <div>
          <Card className="overflow-hidden sticky top-6">
            <div className="p-4 border-b border-border">
              <h3 className="font-semibold text-lg">
                {selectedDate === formatDate(new Date()) ? t(language, "calendar.todayAppointments") : t(language, "calendar.dayAppointments", { date: formatDateDisplay(selectedDate) })}
              </h3>
              <p className="text-sm text-muted-foreground mt-1">
                {selectedAppointments.length} {selectedAppointments.length === 1 ? t(language, "calendar.appointmentCount", { count: 1 }) : t(language, "calendar.appointmentCountPlural", { count: selectedAppointments.length })}
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
            {selectedAppointment && (
              <div className="p-4 border-b border-border bg-accent/5">
                <div className="flex items-center justify-between gap-3 mb-4">
                  <div className="flex items-center gap-2 flex-wrap">
                    <h4 className="font-semibold text-lg">
                      {selectedAppointment.accessionNumber}
                    </h4>
                    {selectedAppointment.updatedAt && selectedAppointment.createdAt && selectedAppointment.updatedAt !== selectedAppointment.createdAt && (
                      <Badge variant="warning" size="sm">
                        {t(language, "appointmentEditor.edited")}
                      </Badge>
                    )}
                  </div>
                  <button
                    onClick={() => navigate(`/print?appointmentId=${selectedAppointment.id}`)}
                    className="text-accent underline underline-offset-2 text-sm"
                  >
                    {t(language, "calendar.print")}
                  </button>
                </div>
                <div className="space-y-3">
                  <Field label={t(language, "calendar.fieldPatient")} value={selectedAppointment.arabicFullName} />
                  <Field label={t(language, "calendar.fieldModality")} value={selectedAppointment.modalityNameEn} />
                  <Field label={t(language, "calendar.fieldExam")} value={selectedAppointment.examNameEn || "—"} />
                  <Field label={t(language, "calendar.fieldPriority")} value={selectedAppointment.priorityNameEn || t(language, "appointmentEditor.normal")} />
                  <Field label={t(language, "calendar.fieldNotes")} value={selectedAppointment.notes || "—"} />
                </div>
                <div className="mt-4">
                  {["scheduled", "arrived", "waiting"].includes(selectedAppointment.status) && (
                    <div className="mb-3 flex justify-end">
                      <Button
                        size="sm"
                        variant="ghost"
                        style={{ color: "#ef4444" }}
                        onClick={() => {
                          if (!window.confirm("Cancel this appointment?")) return;
                          cancelMutation.mutate(selectedAppointment.id);
                        }}
                      >
                        Cancel appointment
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
              </div>
            )}
            {isLoading ? (
              <div className="p-8 text-center text-muted-foreground">{t(language, "calendar.loading")}</div>
            ) : selectedAppointments.length === 0 ? (
              <div className="p-12 text-center text-muted-foreground">
                {t(language, "calendar.noAppointments")}
              </div>
            ) : (
              <ul className="divide-y divide-border max-h-[600px] overflow-y-auto">
                {selectedAppointments.map((apt) => (
                  <li
                    key={apt.id}
                    onClick={() => setSelectedAppointment(apt)}
                    className={`p-4 hover:bg-muted/50 transition-colors cursor-pointer ${
                      selectedAppointment?.id === apt.id ? "bg-accent/10" : ""
                    }`}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex-1">
                        <p className="font-medium">{apt.arabicFullName}</p>
                        <p className="text-xs text-muted-foreground mt-1 font-mono">
                          {apt.accessionNumber}
                        </p>
                      </div>
                      <StatusBadge status={apt.status} />
                    </div>
                    <div className="mt-2 flex items-center justify-between text-xs text-muted-foreground">
                      <span>{apt.modalityNameEn}</span>
                      <div className="flex items-center gap-2">
                        <span>#{apt.dailySequence}</span>
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            navigate(`/print?appointmentId=${apt.id}`);
                          }}
                          className="text-accent underline underline-offset-2"
                        >
                          {t(language, "calendar.print")}
                        </button>
                      </div>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>
      </div>
    </div>
  );
}

function buildCalendarGrid(
  displayDate: Date,
  selectedDate: string,
  groupedByDate: Record<string, any[]>
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
      const mod = apt.modalityNameEn || "Other";
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

function StatusBadge({ status }: { status: string }) {
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
      {status}
    </Badge>
  );
}

function Field({ label, value }: { label: string; value: any }) {
  return (
    <div className="rounded-xl border border-border bg-muted/30 p-3">
      <p className="text-muted-foreground text-xs uppercase tracking-[0.15em] font-mono mb-1">{label}</p>
      <p className="font-medium leading-snug break-words">{value ?? "—"}</p>
    </div>
  );
}
