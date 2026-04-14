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
          remainingCapacity={row.remainingCapacity}
          dailyCapacity={row.dailyCapacity}
          reasonText={row.reasonText}
          selected={selectedDate === row.date}
          onClick={() => onSelectDate(row)}
        />
      ))}
    </div>
  );
}
