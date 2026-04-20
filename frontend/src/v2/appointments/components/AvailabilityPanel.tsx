import type { AvailabilityRowViewModel } from "../hooks/useAppointmentAvailability";
import { AvailabilityDateRow } from "./AvailabilityDateRow";

interface Props {
  rows: AvailabilityRowViewModel[];
  selectedDate: string;
  onSelectDate: (row: AvailabilityRowViewModel) => void;
  loading: boolean;
  emptyMessage: string;
  showFullDays: boolean;
  onToggleShowFullDays: () => void;
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
  startDate,
  onChangeStartDate,
  onPreviousPage,
  onNextPage,
  canGoPrevious,
}: Props) {
  const visibleRows = showFullDays ? rows : rows.filter((row) => row.status !== "full");

  if (loading) {
    return <div className="text-center text-sm" style={{ color: "var(--text-muted)" }}>Loading evaluated availability...</div>;
  }

  if (rows.length === 0) {
    return <div className="text-center text-sm" style={{ color: "var(--text-muted)" }}>{emptyMessage}</div>;
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-4 items-center justify-between">
        <div className="flex gap-2 items-center">
          <button type="button" onClick={onPreviousPage} disabled={!canGoPrevious} className="btn-ghost text-xs h-8 px-2">
            Previous slots
          </button>
          <button type="button" onClick={onNextPage} className="btn-ghost text-xs h-8 px-2">
            Next slots
          </button>
        </div>
        <div className="flex flex-wrap gap-2 items-center">
          <label className="flex items-center gap-2 text-xs font-mono-data" style={{ color: "var(--text-muted)" }}>
            Start date
          </label>
          <input
            aria-label="Availability Start Date"
            type="date"
            value={startDate}
            onChange={(event) => onChangeStartDate(event.target.value)}
            className="input-premium text-xs py-2 h-8 w-40"
          />
          <button type="button" onClick={onToggleShowFullDays} className="btn-ghost text-xs h-8 px-2">
            {showFullDays ? "Hide full days" : "Show full days"}
          </button>
        </div>
      </div>
      {visibleRows.length === 0 ? (
        <div className="text-sm text-center" style={{ color: "var(--text-muted)" }}>
          No non-full days in this window. Click "Show full days" to view all dates.
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
