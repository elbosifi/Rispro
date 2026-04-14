import type { AvailabilityRowStatus } from "../hooks/useAppointmentAvailability";

interface Props {
  date: string;
  dayLabel: string;
  status: AvailabilityRowStatus;
  remainingCapacity: number | null;
  dailyCapacity: number | null;
  reasonText: string;
  selected: boolean;
  onClick: () => void;
}

export function AvailabilityDateRow({
  date,
  dayLabel,
  status,
  remainingCapacity,
  dailyCapacity,
  reasonText,
  selected,
  onClick,
}: Props) {
  const isClickable = status === "available" || status === "restricted";
  const isBlockedLike = status === "blocked";

  const statusColor =
    status === "available"
      ? "#15803d"
      : status === "restricted"
      ? "#b45309"
      : status === "full"
      ? "#92400e"
      : "#dc2626";

  return (
    <button
      type="button"
      onClick={() => {
        if (isClickable) onClick();
      }}
      disabled={!isClickable}
      style={{
        width: "100%",
        textAlign: "left",
        padding: 10,
        borderRadius: 8,
        border: selected ? "2px solid #2563eb" : "1px solid var(--border-color, #e2e8f0)",
        background: selected ? "#eff6ff" : "var(--bg-surface, #fff)",
        cursor: isClickable ? "pointer" : "not-allowed",
        opacity: isClickable ? 1 : 0.9,
      }}
      aria-label={`${date} ${status}`}
    >
      <div style={{ display: "flex", justifyContent: "space-between", gap: 8, alignItems: "center" }}>
        <div>
          <div style={{ fontWeight: 600 }}>{dayLabel}</div>
          <div style={{ fontSize: 12, color: "var(--text-muted, #64748b)" }}>{date}</div>
        </div>
        <div style={{ fontSize: 12, fontWeight: 700, color: statusColor, textTransform: "capitalize" }}>
          {status === "blocked" ? "Blocked" : status}
        </div>
      </div>

      {isBlockedLike ? (
        <div style={{ marginTop: 8, fontSize: 12, color: "#dc2626" }}>Blocked</div>
      ) : (
        <div style={{ marginTop: 8, fontSize: 12, color: "var(--text-muted, #64748b)" }}>
          {remainingCapacity ?? 0} / {dailyCapacity ?? 0} slots
        </div>
      )}

      {!!reasonText && (
        <div style={{ marginTop: 6, fontSize: 11, color: "var(--text-muted, #64748b)" }}>{reasonText}</div>
      )}
    </button>
  );
}
