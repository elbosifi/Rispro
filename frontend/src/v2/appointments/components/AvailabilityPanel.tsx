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
    return <div style={{ color: "var(--text-muted, #64748b)" }}>Loading evaluated availability...</div>;
  }

  if (rows.length === 0) {
    return <div style={{ color: "var(--text-muted, #64748b)" }}>{emptyMessage}</div>;
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center", justifyContent: "space-between" }}>
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <button type="button" onClick={onPreviousPage} disabled={!canGoPrevious}>
            Previous slots
          </button>
          <button type="button" onClick={onNextPage}>
            Next slots
          </button>
        </div>
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <label style={{ fontSize: 12, fontWeight: 600 }}>
            Start date
          </label>
          <input
            aria-label="Availability Start Date"
            type="date"
            value={startDate}
            onChange={(event) => onChangeStartDate(event.target.value)}
            style={{ padding: "6px 8px", border: "1px solid var(--border-color, #e2e8f0)", borderRadius: 6 }}
          />
          <button type="button" onClick={onToggleShowFullDays}>
            {showFullDays ? "Hide full days" : "Show full days"}
          </button>
        </div>
      </div>
      {visibleRows.length === 0 ? (
        <div style={{ color: "var(--text-muted, #64748b)", fontSize: 12 }}>
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
