import type { AvailabilityRowViewModel } from "../hooks/useAppointmentAvailability";
import { AvailabilityDateRow } from "./AvailabilityDateRow";

interface Props {
  rows: AvailabilityRowViewModel[];
  selectedDate: string;
  onSelectDate: (row: AvailabilityRowViewModel) => void;
  loading: boolean;
  emptyMessage: string;
}

export function AvailabilityPanel({ rows, selectedDate, onSelectDate, loading, emptyMessage }: Props) {
  if (loading) {
    return <div style={{ color: "var(--text-muted, #64748b)" }}>Loading evaluated availability...</div>;
  }

  if (rows.length === 0) {
    return <div style={{ color: "var(--text-muted, #64748b)" }}>{emptyMessage}</div>;
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      {rows.map((row) => (
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
          reasonText={row.reasonText}
          requiresSupervisorOverride={row.requiresSupervisorOverride}
          selected={selectedDate === row.date}
          onClick={() => onSelectDate(row)}
        />
      ))}
    </div>
  );
}
