import { useState } from "react";
import { Button, Card, Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/shared";
import { t } from "@/lib/i18n";
import { useLanguage } from "@/providers/language-provider";
import type { SchedulingDecisionDto, SchedulingOverrideRequestType, SchedulingOverrideType } from "../types";
import { formatOverrideType, formatRequestType } from "../utils/scheduling-override-requests";

interface Props {
  open: boolean;
  requestType: SchedulingOverrideRequestType;
  overrideTypes?: SchedulingOverrideType[];
  overrideType?: SchedulingOverrideType | null;
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
  overrideTypes: overrideTypesProp,
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
  const { language } = useLanguage();
  const [reason, setReason] = useState("");
  const [localError, setLocalError] = useState<string | null>(null);
  const reasons = decision?.reasons ?? [];
  const overrideTypes = overrideTypesProp?.length ? overrideTypesProp : overrideType ? [overrideType] : [];

  async function submit() {
    if (!reason.trim()) {
      setLocalError(t(language, "overrideRequests.requesterReasonRequired"));
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
            <DialogTitle>{t(language, "overrideRequests.requestApproval")}</DialogTitle>
            <DialogDescription>
              {t(language, "overrideRequests.notBookedUntilApproval")}
            </DialogDescription>
          </div>
        </DialogHeader>

        <div className="space-y-4">
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            <Summary label={t(language, "overrideRequests.patient")} value={patientLabel} />
            <Summary label={t(language, "overrideRequests.modality")} value={modalityLabel} />
            <Summary label={t(language, "overrideRequests.examType")} value={examTypeLabel} />
            <Summary label={t(language, "overrideRequests.requestedDateTime")} value={`${requestedDate}${requestedTime ? ` ${requestedTime}` : ""}`} />
            <Summary label={t(language, "overrideRequests.requestType")} value={formatRequestType(requestType)} />
            <Summary label={t(language, "overrideRequests.overrideType")} value={overrideTypes.map(formatOverrideType).join(", ")} />
          </div>

          <Card className="p-3">
            <p className="mb-2 text-xs font-semibold uppercase tracking-[0.12em] text-muted-foreground">
              {t(language, "overrideRequests.schedulingDecision")}
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
              <p className="text-sm text-muted-foreground">{t(language, "overrideRequests.noDecisionReason")}</p>
            )}
          </Card>

          <div>
            <label htmlFor="override-request-reason" className="mb-1 block text-sm font-semibold text-foreground">
              {t(language, "overrideRequests.requesterReason")}
            </label>
            <textarea
              id="override-request-reason"
              rows={3}
              value={reason}
              onChange={(event) => setReason(event.target.value)}
              className="input-premium w-full resize-none"
              placeholder={t(language, "overrideRequests.requesterReasonPlaceholder")}
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
            {t(language, "common.cancel")}
          </Button>
          <Button type="button" onClick={submit} disabled={loading || overrideTypes.length === 0}>
            {loading ? t(language, "overrideRequests.submitting") : t(language, "overrideRequests.submitRequest")}
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
