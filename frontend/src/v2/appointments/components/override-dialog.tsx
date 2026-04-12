/**
 * Appointments V2 — Override dialog component.
 *
 * Supervisor authentication for override-required bookings.
 * Follows the established inline modal pattern from legacy codebase.
 */

import { useState, useEffect, useRef } from "react";
import { AlertTriangle } from "lucide-react";

interface OverrideDialogProps {
  onSubmit: (username: string, password: string, reason: string) => void;
  onCancel: () => void;
  error?: string | null;
}

export function OverrideDialog({ onSubmit, onCancel, error }: OverrideDialogProps) {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [reason, setReason] = useState("");
  const passwordRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    passwordRef.current?.focus();
  }, []);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") onCancel();
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [onCancel]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!username.trim() || !password.trim() || !reason.trim()) return;
    onSubmit(username.trim(), password, reason.trim());
  };

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
          maxWidth: 440,
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
              backgroundColor: "var(--bg-warning, #fef3c7)",
              color: "var(--color-warning, #f59e0b)",
            }}
          >
            <AlertTriangle size={20} />
          </div>
          <div>
            <h3 style={{ fontSize: 16, fontWeight: 700, margin: 0 }}>Supervisor Override Required</h3>
            <p style={{ fontSize: 13, color: "var(--text-muted, #64748b)", margin: 0 }}>
              This booking requires supervisor approval
            </p>
          </div>
        </div>

        {/* Error */}
        {error && (
          <div
            style={{
              padding: "8px 12px",
              marginBottom: 16,
              borderRadius: 6,
              backgroundColor: "var(--bg-error, #fef2f2)",
              border: "1px solid var(--border-error, #fecaca)",
              fontSize: 13,
              color: "var(--color-error, #ef4444)",
            }}
          >
            {error}
          </div>
        )}

        {/* Form */}
        <form onSubmit={handleSubmit}>
          <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
            <div>
              <label
                style={{
                  display: "block",
                  fontSize: 13,
                  fontWeight: 600,
                  marginBottom: 4,
                  color: "var(--text-primary, #1e293b)",
                }}
              >
                Supervisor Username
              </label>
              <input
                type="text"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                autoComplete="username"
                style={{
                  width: "100%",
                  padding: "8px 10px",
                  borderRadius: 6,
                  border: "1px solid var(--border-color, #e2e8f0)",
                  fontSize: 14,
                }}
              />
            </div>

            <div>
              <label
                style={{
                  display: "block",
                  fontSize: 13,
                  fontWeight: 600,
                  marginBottom: 4,
                  color: "var(--text-primary, #1e293b)",
                }}
              >
                Password
              </label>
              <input
                ref={passwordRef}
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete="current-password"
                style={{
                  width: "100%",
                  padding: "8px 10px",
                  borderRadius: 6,
                  border: "1px solid var(--border-color, #e2e8f0)",
                  fontSize: 14,
                }}
              />
            </div>

            <div>
              <label
                style={{
                  display: "block",
                  fontSize: 13,
                  fontWeight: 600,
                  marginBottom: 4,
                  color: "var(--text-primary, #1e293b)",
                }}
              >
                Override Reason
              </label>
              <input
                type="text"
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                placeholder="Why is this override needed?"
                style={{
                  width: "100%",
                  padding: "8px 10px",
                  borderRadius: 6,
                  border: "1px solid var(--border-color, #e2e8f0)",
                  fontSize: 14,
                }}
              />
            </div>
          </div>

          {/* Actions */}
          <div style={{ display: "flex", gap: 12, justifyContent: "flex-end", marginTop: 24 }}>
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
              Cancel
            </button>
            <button
              type="submit"
              disabled={!username.trim() || !password.trim() || !reason.trim()}
              style={{
                padding: "8px 20px",
                borderRadius: 6,
                border: "none",
                backgroundColor: "var(--color-warning, #f59e0b)",
                color: "#fff",
                fontSize: 14,
                fontWeight: 600,
                cursor: !username.trim() || !password.trim() || !reason.trim() ? "not-allowed" : "pointer",
                opacity: !username.trim() || !password.trim() || !reason.trim() ? 0.6 : 1,
              }}
            >
              Approve & Book
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
