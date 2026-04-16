import type { AvailabilityRowStatus } from "../hooks/useAppointmentAvailability";

interface Props {
  date: string;
  dayLabel: string;
  status: AvailabilityRowStatus;
  bucketMode: "partitioned" | "total_only";
  remainingCapacity: number | null;
  dailyCapacity: number | null;
  oncologyReserved: number | null;
  oncologyFilled: number;
  oncologyRemaining: number | null;
  nonOncologyReserved: number | null;
  nonOncologyFilled: number;
  nonOncologyRemaining: number | null;
  specialQuotaRemaining: number | null;
  reasonText: string;
  requiresSupervisorOverride: boolean;
  selected: boolean;
  onClick: () => void;
}

export function AvailabilityDateRow({
  date,
  dayLabel,
  status,
  bucketMode,
  remainingCapacity,
  dailyCapacity,
  oncologyReserved,
  oncologyFilled,
  oncologyRemaining,
  nonOncologyReserved,
  nonOncologyFilled,
  nonOncologyRemaining,
  specialQuotaRemaining,
  reasonText,
  requiresSupervisorOverride,
  selected,
  onClick,
}: Props) {
  const isClickable =
    status === "available" ||
    status === "restricted" ||
    (status === "full" && requiresSupervisorOverride);
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
        <div style={{ marginTop: 8, fontSize: 12, color: "var(--text-muted, #64748b)", display: "grid", gap: 2 }}>
          <div>
            Total: {remainingCapacity ?? 0} / {dailyCapacity ?? 0} remaining
          </div>
          {bucketMode === "partitioned" ? (
            <>
              <div>
                Oncology: {oncologyFilled} filled, {oncologyRemaining ?? 0} remaining
                {oncologyReserved != null ? ` (reserved ${oncologyReserved})` : ""}
              </div>
              <div>
                Non-oncology: {nonOncologyFilled} filled, {nonOncologyRemaining ?? 0} remaining
                {nonOncologyReserved != null ? ` (reserved ${nonOncologyReserved})` : ""}
              </div>
            </>
          ) : (
            <>
              <div>Mode: Total-capacity only</div>
              <div>Booked by category: Oncology {oncologyFilled}, Non-oncology {nonOncologyFilled}</div>
            </>
          )}
          {specialQuotaRemaining != null && (
            <div>Special quota remaining: {specialQuotaRemaining}</div>
          )}
        </div>
      )}

      {!!reasonText && (
        <div style={{ marginTop: 6, fontSize: 11, color: "var(--text-muted, #64748b)" }}>{reasonText}</div>
      )}
    </button>
  );
}
