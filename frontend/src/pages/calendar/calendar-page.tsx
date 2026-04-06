import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { fetchAppointments, fetchAppointmentLookups } from "@/lib/api-hooks";
import { formatDateLy, todayIsoDateLy } from "@/lib/date-format";

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
  const today = new Date();
  const [displayDate, setDisplayDate] = useState(new Date(today.getFullYear(), today.getMonth(), 1));
  const [selectedDate, setSelectedDate] = useState(todayIsoDateLy());
  const [modalityFilter, setModalityFilter] = useState("");
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
  };

  return (
    <div className="max-w-7xl mx-auto space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <h2 className="text-2xl font-bold text-stone-900 dark:text-white">
          Appointment Calendar
        </h2>
        <div className="flex items-center gap-2">
          <Select
            value={modalityFilter}
            onChange={setModalityFilter}
            options={[
              { value: "", label: "All Modalities" },
              ...(lookups?.modalities ?? []).map((m: any) => ({
                value: m.id.toString(),
                label: m.nameEn
              }))
            ]}
          />
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Calendar Grid */}
        <div className="lg:col-span-2">
          <div className="bg-white dark:bg-stone-800 rounded-xl border border-stone-200 dark:border-stone-700 shadow-sm overflow-hidden">
            {/* Header */}
            <div className="p-4 border-b border-stone-200 dark:border-stone-700 flex items-center justify-between">
              <button onClick={prevMonth} className="p-2 rounded-lg hover:bg-stone-100 dark:hover:bg-stone-700 transition-colors">
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
                </svg>
              </button>
              <h3 className="text-lg font-semibold text-stone-900 dark:text-white">
                {displayDate.toLocaleString("default", { month: "long", year: "numeric" })}
              </h3>
              <div className="flex gap-2">
                <button
                  onClick={goToday}
                  className="px-3 py-1.5 text-sm bg-teal-50 dark:bg-teal-900/20 text-teal-700 dark:text-teal-300 rounded-lg hover:bg-teal-100 dark:hover:bg-teal-900/40 transition-colors"
                >
                  Today
                </button>
                <button onClick={nextMonth} className="p-2 rounded-lg hover:bg-stone-100 dark:hover:bg-stone-700 transition-colors">
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                  </svg>
                </button>
              </div>
            </div>

            {/* Weekday Headers */}
            <div className="grid grid-cols-7 bg-stone-50 dark:bg-stone-700/50 border-b border-stone-200 dark:border-stone-700">
              {["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((day) => (
                <div key={day} className="p-2 text-center text-xs font-medium text-stone-500 dark:text-stone-400">
                  {day}
                </div>
              ))}
            </div>

            {/* Grid */}
            <div className="grid grid-cols-7">
              {isLoading ? (
                <div className="col-span-7 p-8 text-center text-stone-500">Loading...</div>
              ) : (
                gridDays.map((day) => (
                  <button
                    key={day.date}
                    onClick={() => selectDay(day.date)}
                    className={`min-h-[80px] p-2 border-b border-e border-stone-200 dark:border-stone-700 text-right transition-colors hover:bg-stone-50 dark:hover:bg-stone-700/50 relative ${
                      !day.isCurrentMonth ? "bg-stone-50 dark:bg-stone-800/50" : ""
                    } ${day.isSelected ? "bg-teal-50 dark:bg-teal-900/20 ring-2 ring-inset ring-teal-500" : ""}`}
                  >
                    <span
                      className={`text-sm font-medium ${
                        day.isToday
                          ? "bg-teal-600 text-white w-6 h-6 rounded-full flex items-center justify-center mx-auto mb-1"
                          : day.isCurrentMonth
                          ? "text-stone-900 dark:text-white"
                          : "text-stone-400 dark:text-stone-600"
                      }`}
                    >
                      {day.dayNumber}
                    </span>
                    {day.count > 0 && (
                      <div className="space-y-0.5 mt-1">
                        {day.summary.slice(0, 2).map((s, i) => (
                          <div key={i} className="text-[10px] text-stone-500 dark:text-stone-400 truncate">
                            {s.modality} ({s.count})
                          </div>
                        ))}
                        {day.summary.length > 2 && (
                          <div className="text-[10px] text-stone-400 dark:text-stone-500">+{day.summary.length - 2} more</div>
                        )}
                      </div>
                    )}
                  </button>
                ))
              )}
            </div>
          </div>
        </div>

        {/* Sidebar: Selected Day Details */}
        <div>
          <div className="bg-white dark:bg-stone-800 rounded-xl border border-stone-200 dark:border-stone-700 shadow-sm overflow-hidden sticky top-24">
            <div className="p-4 border-b border-stone-200 dark:border-stone-700">
              <h3 className="font-semibold text-stone-900 dark:text-white">
                {selectedDate === formatDate(new Date()) ? "Today's" : formatDateDisplay(selectedDate)} Appointments
              </h3>
              <p className="text-sm text-stone-500 dark:text-stone-400 mt-1">
                {selectedAppointments.length} appointment{selectedAppointments.length !== 1 ? "s" : ""}
              </p>
            </div>
            {isLoading ? (
              <div className="p-4 text-center text-stone-500">Loading...</div>
            ) : selectedAppointments.length === 0 ? (
              <div className="p-6 text-center text-stone-500 dark:text-stone-400 text-sm">
                No appointments scheduled
              </div>
            ) : (
              <ul className="divide-y divide-stone-200 dark:divide-stone-700 max-h-[600px] overflow-y-auto">
                {selectedAppointments.map((apt: any) => (
                  <li key={apt.id} className="p-4 hover:bg-stone-50 dark:hover:bg-stone-700/50 transition-colors">
                    <div className="flex items-start justify-between gap-2">
                      <div className="text-right flex-1">
                        <p className="font-medium text-stone-900 dark:text-white text-sm">
                          {apt.arabicFullName}
                        </p>
                        <p className="text-xs text-stone-500 dark:text-stone-400 mt-1">
                          {apt.accessionNumber}
                        </p>
                      </div>
                      <StatusBadge status={apt.status} />
                    </div>
                    <div className="mt-2 flex items-center justify-between text-xs text-stone-500 dark:text-stone-400">
                      <span>{apt.modalityNameEn}</span>
                      <div className="flex items-center gap-2">
                        <span>#{apt.dailySequence}</span>
                        <button
                          onClick={() => navigate(`/print?appointmentId=${apt.id}`)}
                          className="text-teal-700 dark:text-teal-300 underline underline-offset-2"
                        >
                          Print
                        </button>
                      </div>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>
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

function Select({
  value,
  onChange,
  options
}: {
  value: string;
  onChange: (v: string) => void;
  options: { value: string; label: string }[];
}) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="w-full px-3 py-2 rounded-lg border bg-stone-50 dark:bg-stone-700 border-stone-300 dark:border-stone-600 text-stone-900 dark:text-white text-sm focus:ring-2 focus:ring-teal-500 outline-none"
    >
      {options.map((opt) => (
        <option key={opt.value} value={opt.value}>
          {opt.label}
        </option>
      ))}
    </select>
  );
}

function StatusBadge({ status }: { status: string }) {
  const styles: Record<string, string> = {
    scheduled: "bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-400",
    arrived: "bg-emerald-100 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-400",
    waiting: "bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-400",
    completed: "bg-teal-100 dark:bg-teal-900/30 text-teal-700 dark:text-teal-400",
    "no-show": "bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-400",
    cancelled: "bg-stone-100 dark:bg-stone-900/30 text-stone-700 dark:text-stone-400"
  };

  return (
    <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${styles[status] || styles.scheduled}`}>
      {status}
    </span>
  );
}
