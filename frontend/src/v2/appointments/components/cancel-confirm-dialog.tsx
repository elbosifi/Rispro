/**
 * Appointments V2 — Cancel confirmation dialog.
 *
 * Simple confirmation modal for cancelling a booking.
 * Follows the established inline modal pattern from the codebase.
 */

import { useRef } from "react";
import { AlertTriangle } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/shared/Dialog";
import { Button } from "@/components/shared/Button";
import { t } from "@/lib/i18n";
import { useLanguage } from "@/providers/language-provider";

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
  const { language } = useLanguage();
  const confirmRef = useRef<HTMLButtonElement>(null);

  return (
    <Dialog open={true} onClose={onCancel}>
      <DialogContent maxWidth="400px">
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
                backgroundColor: "rgba(255, 71, 87, 0.1)",
                color: "var(--accent)",
              }}
            >
              <AlertTriangle size={20} />
            </div>
            <div>
              <DialogTitle>{t(language, "appointments.v2.cancelBookingTitle")}</DialogTitle>
              <DialogDescription>{t(language, "appointments.v2.cannotUndo")}</DialogDescription>
            </div>
          </div>
        </DialogHeader>

        {/* Details */}
        <div
          style={{
            padding: 12,
            marginBottom: 16,
            borderRadius: "var(--radius-md)",
            backgroundColor: "var(--muted)",
            border: "1px solid var(--border)",
            fontSize: 13,
          }}
        >
          <div style={{ fontWeight: 600, marginBottom: 4 }}>{booking.patientName}</div>
          <div style={{ color: "var(--text-muted)" }}>{booking.date}</div>
        </div>

        <DialogFooter>
          <Button variant="secondary" onClick={onCancel}>
            {t(language, "appointments.v2.keepBooking")}
          </Button>
          <Button
            ref={confirmRef}
            onClick={onConfirm}
            style={{ backgroundColor: "var(--accent)", color: "#fff" }}
          >
            {t(language, "appointments.v2.cancelBooking")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
