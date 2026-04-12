/**
 * Appointments V2 — Cancel confirmation dialog.
 *
 * Simple confirmation modal for cancelling a booking.
 * Follows the established inline modal pattern from the codebase.
 */

import { useEffect, useRef } from "react";
import { AlertTriangle } from "lucide-react";

interface CancelConfirmDialogProps {
  booking: {
    id: number;
    patientName: string;
    date: string;
  };
  onConfirm: () => void;
  onCancel: () => void;
}

export function CancelConfirmDialog({ booking, onConfirm, onCancel }: CancelConfirmDialogProps) {
  const confirmRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    confirmRef.current?.focus();
  }, []);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") onCancel();
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [onCancel]);

  return (
    <div
      style={{ position: "fixed", inset: 0, zIndex: 50, display: "flex", alignItems: "center", justifyContent: "center" }}
      onClick={(e) => {
        if (e.target === e.currentTarget) onCancel();
      }}
    >
      {/* Backdrop */}
      <div style={{ position: "absolute", inset: 0, backgroundColor: "rgba(0,0,0,0.5)" }} />

      {/* Dialog */}
      <div
        style={{
          position: "relative",
          zIndex: 1,
          width: "100%",
          maxWidth: 400,
          margin: "0 16px",
          padding: 24,
          borderRadius: 12,
          backgroundColor: "var(--bg-surface, #fff)",
          border: "1px solid var(--border-color, #e2e8f0)",
          boxShadow: "0 20px 60px rgba(0,0,0,0.15)",
        }}
      >
        {/* Header */}
        <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 16 }}>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              width: 40,
              height: 40,
              borderRadius: "50%",
              backgroundColor: "var(--bg-error, #fef2f2)",
              color: "var(--color-error, #ef4444)",
            }}
          >
            <AlertTriangle size={20} />
          </div>
          <div>
            <h3 style={{ fontSize: 16, fontWeight: 700, margin: 0 }}>Cancel Booking</h3>
            <p style={{ fontSize: 13, color: "var(--text-muted, #64748b)", margin: 0 }}>
              This action cannot be undone
            </p>
          </div>
        </div>

        {/* Details */}
        <div
          style={{
            padding: 12,
            marginBottom: 16,
            borderRadius: 6,
            backgroundColor: "var(--bg-surface, #f8fafc)",
            border: "1px solid var(--border-color, #e2e8f0)",
            fontSize: 13,
          }}
        >
          <div style={{ fontWeight: 600, marginBottom: 4 }}>{booking.patientName}</div>
          <div style={{ color: "var(--text-muted, #64748b)" }}>{booking.date}</div>
        </div>

        {/* Actions */}
        <div style={{ display: "flex", gap: 12, justifyContent: "flex-end" }}>
          <button
            type="button"
            onClick={onCancel}
            style={{
              padding: "8px 20px",
              borderRadius: 6,
              border: "1px solid var(--border-color, #e2e8f0)",
              backgroundColor: "var(--bg-surface, #fff)",
              fontSize: 14,
              fontWeight: 500,
              cursor: "pointer",
            }}
          >
            Keep Booking
          </button>
          <button
            ref={confirmRef}
            type="button"
            onClick={onConfirm}
            style={{
              padding: "8px 20px",
              borderRadius: 6,
              border: "none",
              backgroundColor: "var(--color-error, #ef4444)",
              color: "#fff",
              fontSize: 14,
              fontWeight: 600,
              cursor: "pointer",
            }}
          >
            Cancel Booking
          </button>
        </div>
      </div>
    </div>
  );
}
