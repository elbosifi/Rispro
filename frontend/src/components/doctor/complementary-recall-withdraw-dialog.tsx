import { Button, Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/shared";

type ComplementaryRecallStatus = "pending_scheduling" | "scheduled";

export function ComplementaryRecallWithdrawDialog({ open, status, submitting, error, onClose, onConfirm }: {
  open: boolean;
  status: ComplementaryRecallStatus;
  submitting: boolean;
  error?: string | null;
  onClose: () => void;
  onConfirm: () => void;
}) {
  const statusLabel = status === "scheduled" ? "Scheduled" : "Awaiting scheduling";
  return (
    <Dialog open={open} onClose={() => !submitting && onClose()}>
      <DialogContent maxWidth="520px">
        <DialogHeader>
          <DialogTitle>Withdraw additional imaging request</DialogTitle>
          <DialogDescription>The request will be removed from the active scheduling queue but remain in history.</DialogDescription>
        </DialogHeader>
        <p className="text-sm text-slate-600">Current status: {statusLabel}</p>
        {error ? <p role="alert" className="mt-3 text-sm text-red-700">{error}</p> : null}
        <DialogFooter>
          <Button variant="secondary" onClick={onClose} disabled={submitting}>Cancel</Button>
          <Button variant="destructive" onClick={onConfirm} disabled={submitting}>{submitting ? "Withdrawing..." : "Withdraw request"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
