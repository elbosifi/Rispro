/**
 * Appointments V2 — Availability status badge.
 *
 * Renders explicit status: Available / Needs Approval / Not Available.
 * D005: No frontend inference from missing fields.
 */

import type { DecisionStatus, DecisionReason } from "../types";

interface StatusBadgeProps {
  status: DecisionStatus;
  reasons: DecisionReason[];
  remainingCapacity: number | null;
}

const STATUS_CONFIG: Record<DecisionStatus, { label: string; color: string; bg: string }> = {
  available: {
    label: "Available",
    color: "var(--color-success)",
    bg: "rgba(34, 197, 94, 0.1)",
  },
  restricted: {
    label: "Needs Approval",
    color: "var(--color-warning)",
    bg: "rgba(234, 179, 8, 0.1)",
  },
  blocked: {
    label: "Not Available",
    color: "var(--color-error)",
    bg: "rgba(239, 68, 68, 0.1)",
  },
};

export function StatusBadge({ status, reasons, remainingCapacity }: StatusBadgeProps) {
  const config = STATUS_CONFIG[status];

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
      <span
        style={{
          display: "inline-block",
          padding: "2px 8px",
          borderRadius: 4,
          fontSize: 12,
          fontWeight: 600,
          color: config.color,
          backgroundColor: config.bg,
          width: "fit-content",
        }}
      >
        {config.label}
      </span>
      {remainingCapacity != null && (
        <span style={{ fontSize: 11, color: "var(--text-muted)" }}>
          {remainingCapacity} slot{remainingCapacity !== 1 ? "s" : ""} remaining
        </span>
      )}
      {reasons.length > 0 && (
        <ul style={{ margin: 0, padding: "0 0 0 12px", fontSize: 10, color: "var(--text-muted)" }}>
          {reasons.map((r, i) => (
            <li key={i}>{r.message}</li>
          ))}
        </ul>
      )}
    </div>
  );
}
