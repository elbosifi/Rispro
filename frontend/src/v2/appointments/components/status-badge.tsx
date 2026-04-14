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
  remainingStandardCapacity: number | null;
  remainingSpecialQuota: number | null;
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

function clampToZero(val: number | null | undefined): number {
  const n = val ?? 0;
  return n < 0 ? 0 : n;
}

export function StatusBadge({ status, reasons, remainingStandardCapacity, remainingSpecialQuota }: StatusBadgeProps) {
  const config = STATUS_CONFIG[status];
  const standard = clampToZero(remainingStandardCapacity);
  const special = clampToZero(remainingSpecialQuota);
  const hasSpecial = special > 0;
  const isBlocked = status === "blocked";
  const isRestricted = status === "restricted";

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
      {!isBlocked && !isRestricted && (
        <span style={{ fontSize: 11, color: "var(--text-muted)" }}>
          {hasSpecial
            ? `Standard: ${standard} · Special quota: ${special}`
            : `Standard: ${standard}`}
        </span>
      )}
      {isBlocked && (
        <span style={{ fontSize: 11, color: "var(--text-muted)" }}>
          Not bookable
        </span>
      )}
      {isRestricted && (
        <span style={{ fontSize: 11, color: "var(--text-muted)" }}>
          Needs supervisor approval
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
