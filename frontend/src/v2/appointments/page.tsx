/**
 * Appointments V2 — Appointments page.
 *
 * A new React page that consumes only V2 endpoints.
 * Shows availability calendar with explicit status (D005).
 * Does not use or import any legacy scheduling code.
 */

import { useState } from "react";
import { useV2Lookups, useV2ExamTypes, useV2Availability } from "./api";
import type { CaseCategory, DecisionStatus, AvailabilityDayDto } from "./types";
import { StatusBadge } from "./components/status-badge";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function describeReason(code: string): string {
  const map: Record<string, string> = {
    modality_not_found: "Modality not found",
    exam_type_not_found: "Exam type not found",
    exam_type_modality_mismatch: "Exam type not valid for modality",
    malformed_rule_configuration: "Rule configuration error",
    modality_blocked_rule_match: "Date blocked for this modality",
    modality_blocked_overridable: "Date blocked — needs supervisor approval",
    exam_type_not_allowed_for_rule: "Exam type not allowed on this date",
    standard_capacity_exhausted: "Daily capacity reached",
    special_quota_exhausted: "Special quota reached",
    no_published_policy: "No scheduling policy published",
  };
  return map[code] ?? code;
}

function formatDate(dateStr: string): string {
  const d = new Date(`${dateStr}T00:00:00Z`);
  return d.toLocaleDateString("en-LY", { weekday: "short", month: "short", day: "numeric" });
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export function AppointmentsV2Page() {
  const lookups = useV2Lookups();
  const [modalityId, setModalityId] = useState<number | null>(null);
  const [examTypeId, setExamTypeId] = useState<number | null>(null);
  const [caseCategory, setCaseCategory] = useState<CaseCategory>("non_oncology");
  const [days, setDays] = useState(14);

  const examTypes = useV2ExamTypes(modalityId);
  const availability = useV2Availability(
    modalityId != null
      ? {
          modalityId,
          days,
          offset: 0,
          examTypeId,
          caseCategory,
          useSpecialQuota: false,
          specialReasonCode: null,
          includeOverrideCandidates: false,
        }
      : undefined as unknown as Parameters<typeof useV2Availability>[0]
  );

  const disabled = modalityId == null;

  return (
    <div style={{ padding: 24, maxWidth: 900, margin: "0 auto" }}>
      <h1 style={{ fontSize: 20, fontWeight: 700, marginBottom: 24 }}>
        Appointments V2
      </h1>

      {/* Filters */}
      <div
        style={{
          display: "flex",
          gap: 16,
          flexWrap: "wrap",
          marginBottom: 24,
          padding: 16,
          borderRadius: 8,
          backgroundColor: "var(--bg-surface, #f8fafc)",
          border: "1px solid var(--border-color, #e2e8f0)",
        }}
      >
        {/* Modality */}
        <div style={{ flex: "1 1 200px" }}>
          <label
            style={{
              display: "block",
              fontSize: 11,
              fontWeight: 600,
              textTransform: "uppercase",
              letterSpacing: "0.05em",
              marginBottom: 4,
              color: "var(--text-muted, #64748b)",
            }}
          >
            Modality
          </label>
          <select
            value={modalityId ?? ""}
            onChange={(e) => {
              setModalityId(e.target.value ? Number(e.target.value) : null);
              setExamTypeId(null);
            }}
            style={{
              width: "100%",
              padding: "6px 10px",
              borderRadius: 6,
              border: "1px solid var(--border-color, #e2e8f0)",
              fontSize: 14,
            }}
          >
            <option value="">Select modality…</option>
            {lookups.data?.modalities.map((m: { id: number; name: string }) => (
              <option key={m.id} value={m.id}>
                {m.name}
              </option>
            ))}
          </select>
        </div>

        {/* Exam Type */}
        <div style={{ flex: "1 1 200px" }}>
          <label
            style={{
              display: "block",
              fontSize: 11,
              fontWeight: 600,
              textTransform: "uppercase",
              letterSpacing: "0.05em",
              marginBottom: 4,
              color: "var(--text-muted, #64748b)",
            }}
          >
            Exam Type (optional)
          </label>
          <select
            value={examTypeId ?? ""}
            onChange={(e) => setExamTypeId(e.target.value ? Number(e.target.value) : null)}
            disabled={!modalityId}
            style={{
              width: "100%",
              padding: "6px 10px",
              borderRadius: 6,
              border: "1px solid var(--border-color, #e2e8f0)",
              fontSize: 14,
              opacity: !modalityId ? 0.5 : 1,
            }}
          >
            <option value="">All exam types</option>
            {examTypes.data?.map((et: { id: number; name: string }) => (
              <option key={et.id} value={et.id}>
                {et.name}
              </option>
            ))}
          </select>
        </div>

        {/* Case Category */}
        <div style={{ flex: "0 1 180px" }}>
          <label
            style={{
              display: "block",
              fontSize: 11,
              fontWeight: 600,
              textTransform: "uppercase",
              letterSpacing: "0.05em",
              marginBottom: 4,
              color: "var(--text-muted, #64748b)",
            }}
          >
            Case Category
          </label>
          <select
            value={caseCategory}
            onChange={(e) => setCaseCategory(e.target.value as CaseCategory)}
            style={{
              width: "100%",
              padding: "6px 10px",
              borderRadius: 6,
              border: "1px solid var(--border-color, #e2e8f0)",
              fontSize: 14,
            }}
          >
            <option value="non_oncology">Non-Oncology</option>
            <option value="oncology">Oncology</option>
          </select>
        </div>

        {/* Days */}
        <div style={{ flex: "0 1 120px" }}>
          <label
            style={{
              display: "block",
              fontSize: 11,
              fontWeight: 600,
              textTransform: "uppercase",
              letterSpacing: "0.05em",
              marginBottom: 4,
              color: "var(--text-muted, #64748b)",
            }}
          >
            Days
          </label>
          <select
            value={days}
            onChange={(e) => setDays(Number(e.target.value))}
            style={{
              width: "100%",
              padding: "6px 10px",
              borderRadius: 6,
              border: "1px solid var(--border-color, #e2e8f0)",
              fontSize: 14,
            }}
          >
            <option value={7}>7 days</option>
            <option value={14}>14 days</option>
            <option value={30}>30 days</option>
          </select>
        </div>
      </div>

      {/* Availability Table */}
      {disabled ? (
        <p style={{ color: "var(--text-muted, #64748b)", fontStyle: "italic" }}>
          Select a modality to view availability.
        </p>
      ) : availability.isLoading ? (
        <p style={{ color: "var(--text-muted, #64748b)" }}>Loading availability…</p>
      ) : availability.isError ? (
        <p style={{ color: "var(--color-error, #ef4444)" }}>
          Error loading availability: {(availability.error as Error).message}
        </p>
      ) : availability.data?.items.length === 0 ? (
        <p style={{ color: "var(--text-muted, #64748b)", fontStyle: "italic" }}>
          No availability data found for the selected criteria.
        </p>
      ) : (
        <AvailabilityTable items={availability.data?.items ?? []} />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Availability Table Component
// ---------------------------------------------------------------------------

interface AvailabilityTableProps {
  items: AvailabilityDayDto[];
}

function AvailabilityTable({ items }: AvailabilityTableProps) {
  return (
    <div style={{ overflowX: "auto" }}>
      <table
        style={{
          width: "100%",
          borderCollapse: "collapse",
          fontSize: 14,
        }}
      >
        <thead>
          <tr
            style={{
              borderBottom: "2px solid var(--border-color, #e2e8f0)",
            }}
          >
            <th style={{ textAlign: "left", padding: "8px 12px", fontWeight: 600, fontSize: 12 }}>
              Date
            </th>
            <th style={{ textAlign: "center", padding: "8px 12px", fontWeight: 600, fontSize: 12 }}>
              Capacity
            </th>
            <th style={{ textAlign: "center", padding: "8px 12px", fontWeight: 600, fontSize: 12 }}>
              Booked
            </th>
            <th style={{ textAlign: "center", padding: "8px 12px", fontWeight: 600, fontSize: 12 }}>
              Remaining
            </th>
            <th style={{ textAlign: "left", padding: "8px 12px", fontWeight: 600, fontSize: 12 }}>
              Status
            </th>
          </tr>
        </thead>
        <tbody>
          {items.map((day) => (
            <tr
              key={day.date}
              style={{
                borderBottom: "1px solid var(--border-color, #e2e8f0)",
              }}
            >
              <td style={{ padding: "10px 12px", whiteSpace: "nowrap" }}>
                <div style={{ fontWeight: 500 }}>{formatDate(day.date)}</div>
                <div style={{ fontSize: 11, color: "var(--text-muted, #64748b)" }}>{day.date}</div>
              </td>
              <td style={{ textAlign: "center", padding: "10px 12px" }}>{day.dailyCapacity}</td>
              <td style={{ textAlign: "center", padding: "10px 12px" }}>{day.bookedCount}</td>
              <td style={{ textAlign: "center", padding: "10px 12px" }}>
                <span
                  style={{
                    fontWeight: day.remainingCapacity <= 0 ? 700 : 400,
                    color:
                      day.remainingCapacity <= 0
                        ? "var(--color-error, #ef4444)"
                        : "var(--text-primary, #1e293b)",
                  }}
                >
                  {day.remainingCapacity}
                </span>
              </td>
              <td style={{ padding: "10px 12px" }}>
                <StatusBadge
                  status={day.decision.displayStatus as DecisionStatus}
                  reasons={day.decision.reasons.map((r: { code: string; severity: "error" | "warning"; message: string }) => ({
                    ...r,
                    message: describeReason(r.code),
                  }))}
                  remainingCapacity={day.decision.remainingStandardCapacity}
                />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
