/**
 * Appointments V2 — Override dialog component.
 *
 * Supervisor authentication for override-required bookings.
 * Follows the established inline modal pattern from legacy codebase.
 */

import { useState, useEffect, useRef } from "react";
import { AlertTriangle } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/shared/Dialog";
import { Button } from "@/components/shared/Button";
import { Input } from "@/components/shared/Input";

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
    <Dialog open={true} onClose={onCancel}>
      <DialogContent maxWidth="440px">
        <DialogHeader showClose={false}>
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <div
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                width: 40,
                height: 40,
                borderRadius: "50%",
                backgroundColor: "rgba(245, 158, 11, 0.1)",
                color: "var(--amber)",
              }}
            >
              <AlertTriangle size={20} />
            </div>
            <div>
              <DialogTitle>Supervisor Override Required</DialogTitle>
              <DialogDescription>
                This booking requires supervisor approval
              </DialogDescription>
            </div>
          </div>
        </DialogHeader>

        {/* Error */}
        {error && (
          <div
            style={{
              padding: "8px 12px",
              marginBottom: 16,
              borderRadius: "var(--radius-md)",
              backgroundColor: "rgba(255, 71, 87, 0.1)",
              border: "1px solid rgba(255, 71, 87, 0.3)",
              fontSize: 13,
              color: "var(--accent)",
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
                  color: "var(--text)",
                }}
              >
                Supervisor Username
              </label>
              <Input
                type="text"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                autoComplete="username"
              />
            </div>

            <div>
              <label
                style={{
                  display: "block",
                  fontSize: 13,
                  fontWeight: 600,
                  marginBottom: 4,
                  color: "var(--text)",
                }}
              >
                Password
              </label>
              <Input
                ref={passwordRef}
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete="current-password"
              />
            </div>

            <div>
              <label
                style={{
                  display: "block",
                  fontSize: 13,
                  fontWeight: 600,
                  marginBottom: 4,
                  color: "var(--text)",
                }}
              >
                Override Reason
              </label>
              <Input
                type="text"
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                placeholder="Why is this override needed?"
              />
            </div>
          </div>

          <DialogFooter>
            <Button variant="secondary" onClick={onCancel}>
              Cancel
            </Button>
            <Button
              type="submit"
              disabled={!username.trim() || !password.trim() || !reason.trim()}
              style={{ backgroundColor: "var(--amber)", color: "#fff" }}
            >
              Approve & Book
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
