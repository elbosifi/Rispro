import type { AvailabilityRowViewModel } from "../hooks/useAppointmentAvailability";
import { AvailabilityDateRow } from "./AvailabilityDateRow";
import { t } from "@/lib/i18n";
import { useLanguage } from "@/providers/language-provider";

interface Props {
  rows: AvailabilityRowViewModel[];
  selectedDate: string;
  onSelectDate: (row: AvailabilityRowViewModel) => void;
  loading: boolean;
  emptyMessage: string;
  showFullDays: boolean;
  onToggleShowFullDays: () => void;
  showWeekendDays: boolean;
  onToggleShowWeekendDays: () => void;
  startDate: string;
  onChangeStartDate: (isoDate: string) => void;
  onPreviousPage: () => void;
  onNextPage: () => void;
  canGoPrevious: boolean;
}

export function AvailabilityPanel({
  rows,
  selectedDate,
  onSelectDate,
  loading,
  emptyMessage,
  showFullDays,
  onToggleShowFullDays,
  showWeekendDays,
  onToggleShowWeekendDays,
  startDate,
  onChangeStartDate,
  onPreviousPage,
  onNextPage,
  canGoPrevious,
}: Props) {
  const { language } = useLanguage();
  const baseRows = showWeekendDays ? rows : rows.filter((row) => !row.hideAlways);
  const visibleRows = baseRows.filter(
    (row) => row.status === "available" || row.status === "restricted" || showFullDays || (showWeekendDays && row.hideAlways)
  );

  if (loading) {
    return <div className="text-center text-sm" style={{ color: "var(--text-muted)" }}>{t(language, "appointments.create.loadingAvailability")}</div>;
  }

  if (rows.length === 0) {
    if (!emptyMessage) return null;
    return <div className="text-center text-sm" style={{ color: "var(--text-muted)" }}>{emptyMessage}</div>;
  }

  return (
    <div className="space-y-3 sm:space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center sm:justify-between">
        <div className="flex gap-2 items-center">
          <button type="button" onClick={onPreviousPage} disabled={!canGoPrevious} className="btn-ghost text-xs h-8 px-2">
            {t(language, "appointments.create.previousSlots")}
          </button>
          <button type="button" onClick={onNextPage} className="btn-ghost text-xs h-8 px-2">
            {t(language, "appointments.create.nextSlots")}
          </button>
        </div>
        <div className="flex flex-col sm:flex-row sm:flex-wrap gap-2 sm:items-center">
          <label className="flex items-center gap-2 text-xs sm:text-sm font-medium" style={{ color: "var(--text-muted)" }}>
            {t(language, "appointments.create.startDate")}
          </label>
          <input
            aria-label={t(language, "appointments.create.startDate")}
            type="date"
            value={startDate}
            onChange={(event) => onChangeStartDate(event.target.value)}
            className="input-premium text-xs py-2 h-8 w-full sm:w-40"
          />
          <button type="button" onClick={onToggleShowFullDays} className="btn-ghost text-xs h-8 px-2">
            {showFullDays ? t(language, "appointments.create.hideFullDays") : t(language, "appointments.create.showFullDays")}
          </button>
          <button type="button" onClick={onToggleShowWeekendDays} className="btn-ghost text-xs h-8 px-2">
            {showWeekendDays ? t(language, "appointments.create.hideWeekendDays") : t(language, "appointments.create.showWeekendDays")}
          </button>
        </div>
      </div>
      {visibleRows.length === 0 ? (
        <div className="text-sm text-center" style={{ color: "var(--text-muted)" }}>
          {t(language, "appointments.create.noNonFullDays")}
        </div>
      ) : visibleRows.map((row) => (
        <AvailabilityDateRow
          key={row.date}
          date={row.date}
          dayLabel={row.dayLabel}
          status={row.status}
          bucketMode={row.bucketMode}
          remainingCapacity={row.remainingCapacity}
          dailyCapacity={row.dailyCapacity}
          oncologyReserved={row.oncologyReserved}
          oncologyFilled={row.oncologyFilled}
          oncologyRemaining={row.oncologyRemaining}
          nonOncologyReserved={row.nonOncologyReserved}
          nonOncologyFilled={row.nonOncologyFilled}
          nonOncologyRemaining={row.nonOncologyRemaining}
          specialQuotaRemaining={row.specialQuotaRemaining}
          examMixQuotaSummaries={row.examMixQuotaSummaries}
          primaryExamMixBlocking={row.primaryExamMixBlocking}
          matchedExamRuleSummary={row.matchedExamRuleSummary}
          reasonText={row.reasonText}
          requiresSupervisorOverride={row.requiresSupervisorOverride}
          selected={selectedDate === row.date}
          onClick={() => onSelectDate(row)}
        />
      ))}
    </div>
  );
}
