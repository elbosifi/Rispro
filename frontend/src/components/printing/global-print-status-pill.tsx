import { useEffect, useState } from "react";
import { Check, Clock3, Loader2, TriangleAlert } from "lucide-react";
import { PRINT_STATUS_SUCCESS_DISMISS_MS, useGlobalPrintStatus } from "@/services/printing/global-print-status";

const labels = {
  preparing: { full: "Preparing print…", compact: "Preparing…" },
  submitting: { full: "Sending to printer…", compact: "Sending…" },
  submitted: { full: "Sent to printer", compact: "Sent" },
  failed: { full: "Print failed", compact: "Failed" },
  status_unknown: { full: "Print still processing — do not retry", compact: "Still processing" },
} as const;

function SubmittingPrinterIcon() {
  return (
    <svg data-testid="submitting-printer-icon" viewBox="0 0 24 24" className="h-5 w-5 shrink-0" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
      <rect x="7" y="3" width="10" height="7" rx="1" className="print-status-printer-paper" />
      <g className="print-status-printer-body">
        <path d="M6 9H18A3 3 0 0 1 21 12V17H3V12A3 3 0 0 1 6 9Z" />
        <path d="M6 17H18V21H6Z" />
      </g>
      <circle cx="18" cy="12" r="0.8" fill="currentColor" stroke="none" className="print-status-printer-light" />
    </svg>
  );
}

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
  const Icon = status.state === "preparing" ? Loader2 : status.state === "submitted" ? Check : status.state === "failed" ? TriangleAlert : Clock3;
  const tone = status.state === "submitted" ? "border-emerald-400/50 bg-emerald-50 text-emerald-900 dark:bg-emerald-950/30 dark:text-emerald-100" : status.state === "failed" ? "border-red-400/50 bg-red-50 text-red-900 dark:bg-red-950/30 dark:text-red-100" : status.state === "status_unknown" ? "border-amber-400/50 bg-amber-50 text-amber-900 dark:bg-amber-950/30 dark:text-amber-100" : "border-border bg-muted text-foreground";
  const animation = status.state === "preparing" ? "animate-spin motion-reduce:animate-none" : status.state === "submitted" ? "animate-in zoom-in-50 duration-200 motion-reduce:animate-none" : "";

  return (
    <div role="status" aria-live="polite" title={status.state === "submitting" ? label.full : undefined} className={`relative inline-flex max-w-[13rem] items-center gap-1.5 rounded-full border px-2 py-1 text-xs font-semibold shadow-sm transition-opacity duration-500 motion-reduce:transition-none ${status.state === "submitting" ? "group" : ""} ${tone} ${isDismissing ? "opacity-0" : "opacity-100"}`}>
      {status.state === "submitting" ? <SubmittingPrinterIcon /> : <Icon className={`h-3.5 w-3.5 shrink-0 ${animation}`} aria-hidden="true" />}
      {status.state === "submitting" ? <span className="pointer-events-none absolute end-0 top-full z-50 mt-2 w-max max-w-[13rem] rounded-md border border-border bg-popover px-2 py-1 text-xs font-semibold text-popover-foreground opacity-0 shadow-md transition-opacity group-hover:opacity-100 motion-reduce:transition-none">{label.full}</span> : <>
        <span className="truncate sm:hidden">{label.compact}</span>
        <span className="hidden truncate sm:inline">{label.full}</span>
      </>}
      <span className="sr-only">{label.full}</span>
      <style>{`
        @keyframes rispro-print-paper-feed {
          0%, 15% { opacity: 0.35; transform: translateY(-3px); }
          48%, 78% { opacity: 1; transform: translateY(0); }
          100% { opacity: 0.35; transform: translateY(-3px); }
        }
        @keyframes rispro-print-body-bounce {
          0%, 35%, 100% { transform: translateY(0); }
          52% { transform: translateY(0.7px); }
        }
        @keyframes rispro-print-status-light {
          0%, 35%, 100% { opacity: 0.35; }
          52%, 72% { opacity: 1; }
        }
        .print-status-printer-paper { animation: rispro-print-paper-feed 1.2s ease-in-out infinite; transform-origin: center; }
        .print-status-printer-body { animation: rispro-print-body-bounce 1.2s ease-in-out infinite; }
        .print-status-printer-light { animation: rispro-print-status-light 1.2s ease-in-out infinite; }
        @media (prefers-reduced-motion: reduce) {
          .print-status-printer-paper, .print-status-printer-body, .print-status-printer-light { animation: none; opacity: 1; transform: none; }
        }
      `}</style>
    </div>
  );
}
