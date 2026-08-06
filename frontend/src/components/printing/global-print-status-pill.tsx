import { useEffect, useState } from "react";
import { Check, Clock3, Loader2, Printer, TriangleAlert } from "lucide-react";
import { PRINT_STATUS_SUCCESS_DISMISS_MS, useGlobalPrintStatus } from "@/services/printing/global-print-status";

const labels = {
  preparing: { full: "Preparing print…", compact: "Preparing…" },
  submitting: { full: "Sending to printer…", compact: "Sending…" },
  submitted: { full: "Sent to printer", compact: "Sent" },
  failed: { full: "Print failed", compact: "Failed" },
  status_unknown: { full: "Print still processing — do not retry", compact: "Still processing" },
} as const;

export function GlobalPrintStatusPill() {
  const status = useGlobalPrintStatus();
  const [isDismissing, setIsDismissing] = useState(false);

  useEffect(() => {
    setIsDismissing(false);
    if (status.state !== "submitted") return;
    const timer = window.setTimeout(() => setIsDismissing(true), PRINT_STATUS_SUCCESS_DISMISS_MS - 500);
    return () => window.clearTimeout(timer);
  }, [status.state]);

  if (status.state === "idle") return null;
  const label = labels[status.state];
  const Icon = status.state === "preparing" ? Loader2 : status.state === "submitting" ? Printer : status.state === "submitted" ? Check : status.state === "failed" ? TriangleAlert : Clock3;
  const tone = status.state === "submitted" ? "border-emerald-400/50 bg-emerald-50 text-emerald-900 dark:bg-emerald-950/30 dark:text-emerald-100" : status.state === "failed" ? "border-red-400/50 bg-red-50 text-red-900 dark:bg-red-950/30 dark:text-red-100" : status.state === "status_unknown" ? "border-amber-400/50 bg-amber-50 text-amber-900 dark:bg-amber-950/30 dark:text-amber-100" : "border-border bg-muted text-foreground";
  const animation = status.state === "preparing" ? "animate-spin motion-reduce:animate-none" : status.state === "submitting" ? "animate-pulse motion-reduce:animate-none" : status.state === "submitted" ? "animate-in zoom-in-50 duration-200 motion-reduce:animate-none" : "";

  return (
    <div role="status" aria-live="polite" className={`inline-flex max-w-[13rem] items-center gap-1.5 rounded-full border px-2 py-1 text-xs font-semibold shadow-sm transition-opacity duration-500 motion-reduce:transition-none ${tone} ${isDismissing ? "opacity-0" : "opacity-100"}`}>
      <Icon className={`h-3.5 w-3.5 shrink-0 ${animation}`} aria-hidden="true" />
      <span className="truncate sm:hidden">{label.compact}</span>
      <span className="hidden truncate sm:inline">{label.full}</span>
      <span className="sr-only">{label.full}</span>
    </div>
  );
}
