import { useState } from "react";
import { Button, Card, Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/shared";
import type { SchedulingDecisionDto, SchedulingOverrideRequestType, SchedulingOverrideType } from "../types";
import { formatOverrideType, formatRequestType } from "../utils/scheduling-override-requests";

interface Props {
  open: boolean;
  requestType: SchedulingOverrideRequestType;
  overrideType: SchedulingOverrideType | null;
  patientLabel: string;
  modalityLabel: string;
  examTypeLabel: string;
  requestedDate: string;
  requestedTime?: string | null;
  decision?: SchedulingDecisionDto | null;
  loading?: boolean;
  error?: string | null;
  onClose: () => void;
  onSubmit: (requesterReason: string) => Promise<void> | void;
}

export function SchedulingOverrideRequestModal({
  open,
  requestType,
  overrideType,
  patientLabel,
  modalityLabel,
  examTypeLabel,
  requestedDate,
  requestedTime,
  decision,
  loading = false,
  error,
  onClose,
  onSubmit,
}: Props) {
  const [reason, setReason] = useState("");
  const [localError, setLocalError] = useState<string | null>(null);
  const reasons = decision?.reasons ?? [];

  async function submit() {
    if (!reason.trim()) {
      setLocalError("Requester reason is required.");
      return;
    }
    setLocalError(null);
    await onSubmit(reason.trim());
  }

  return (
    <Dialog open={open} onClose={onClose}>
      <DialogContent maxWidth="640px">
        <DialogHeader>
          <div>
            <DialogTitle>Request override approval</DialogTitle>
            <DialogDescription>
              The appointment is not booked until a supervisor or superadmin approves this request.
            </DialogDescription>
          </div>
        </DialogHeader>

        <div className="space-y-4">
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            <Summary label="Patient" value={patientLabel} />
            <Summary label="Modality" value={modalityLabel} />
            <Summary label="Exam type" value={examTypeLabel} />
            <Summary label="Requested date/time" value={`${requestedDate}${requestedTime ? ` ${requestedTime}` : ""}`} />
            <Summary label="Request type" value={formatRequestType(requestType)} />
            <Summary label="Override type" value={formatOverrideType(overrideType)} />
          </div>

          <Card className="p-3">
            <p className="mb-2 text-xs font-semibold uppercase tracking-[0.12em] text-muted-foreground">
              Scheduling decision
            </p>
            {reasons.length ? (
              <ul className="space-y-1 text-sm text-foreground">
                {reasons.map((reasonItem, index) => (
                  <li key={`${reasonItem.code}-${index}`}>
                    <span className="font-mono text-[11px] text-muted-foreground">{reasonItem.code}</span>
                    {reasonItem.message ? ` — ${reasonItem.message}` : ""}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-muted-foreground">No detailed decision reason was provided by the current view.</p>
            )}
          </Card>

          <div>
            <label htmlFor="override-request-reason" className="mb-1 block text-sm font-semibold text-foreground">
              Requester reason
            </label>
            <textarea
              id="override-request-reason"
              rows={3}
              value={reason}
              onChange={(event) => setReason(event.target.value)}
              className="input-premium w-full resize-none"
              placeholder="Explain why this appointment needs override approval"
            />
          </div>

          {(localError || error) && (
            <div className="rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
              {localError || error}
            </div>
          )}
        </div>

        <DialogFooter>
          <Button type="button" variant="secondary" onClick={onClose} disabled={loading}>
            Cancel
          </Button>
          <Button type="button" onClick={submit} disabled={loading || !overrideType}>
            {loading ? "Submitting..." : "Submit request"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function Summary({ label, value }: { label: string; value: string | null | undefined }) {
  return (
    <div className="rounded-xl border border-border bg-muted/30 p-2.5">
      <p className="mb-0.5 font-mono text-[9px] uppercase tracking-[0.1em] text-muted-foreground">{label}</p>
      <p className="text-sm font-medium text-foreground">{value || "—"}</p>
    </div>
  );
}
