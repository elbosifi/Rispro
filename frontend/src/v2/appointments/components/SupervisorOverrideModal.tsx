import { useState } from "react";
import { t } from "@/lib/i18n";
import { useLanguage } from "@/providers/language-provider";
import { Button, Dialog, DialogContent, Input } from "@/components/shared";
import { SupervisorReAuthModal } from "@/components/auth/supervisor-reauth-modal";
import type { SchedulingOverrideType } from "../types";
import { formatOverrideType } from "../utils/scheduling-override-requests";

export type SupervisorOverrideMode = "current_user" | "delegated_supervisor";

export type SupervisorOverrideConfirmation =
  | { authorizationMode: "current_user_reauth"; overrideReason: string }
  | { authorizationMode: "supervisor_credentials"; supervisorUsername: string; supervisorPassword: string; overrideReason: string };

interface Props {
  open: boolean;
  onClose: () => void;
  onConfirm: (payload: SupervisorOverrideConfirmation) => Promise<void>;
  loading: boolean;
  authError?: string | null;
  overrideTypes?: SchedulingOverrideType[];
  mode?: SupervisorOverrideMode;
}

export function SupervisorOverrideModal({ open, onClose, onConfirm, loading, authError, overrideTypes = [], mode = "delegated_supervisor" }: Props) {
  const { language } = useLanguage();
  const [supervisorUsername, setSupervisorUsername] = useState("");
  const [supervisorPassword, setSupervisorPassword] = useState("");
  const [overrideReason, setOverrideReason] = useState("");
  const [localError, setLocalError] = useState<string | null>(null);
  const [showReauth, setShowReauth] = useState(false);

  if (!open) return null;

  function handleClose() {
    if (loading) return;
    setShowReauth(false);
    setLocalError(null);
    onClose();
  }

  async function handleConfirm() {
    if (!overrideReason.trim() || (mode === "delegated_supervisor" && (!supervisorUsername.trim() || !supervisorPassword.trim()))) {
      setLocalError(t(language, "appointments.create.allFieldsRequired"));
      return;
    }
    setLocalError(null);
    if (mode === "current_user") {
      setShowReauth(true);
      return;
    }
    await onConfirm({
      authorizationMode: "supervisor_credentials",
      supervisorUsername: supervisorUsername.trim(),
      supervisorPassword,
      overrideReason: overrideReason.trim(),
    });
  }

  async function handleReauthSuccess() {
    setShowReauth(false);
    await onConfirm({
      authorizationMode: "current_user_reauth",
      overrideReason: overrideReason.trim(),
    });
  }

  if (showReauth) {
    return (
      <SupervisorReAuthModal
        onClose={() => {
          if (!loading) setShowReauth(false);
        }}
        onSuccess={() => void handleReauthSuccess()}
      />
    );
  }

  return (
    <Dialog open={open} onClose={handleClose}>
      <DialogContent maxWidth="448px" aria-labelledby="supervisor-override-title" aria-describedby="supervisor-override-description">
        <h3 id="supervisor-override-title" className="text-lg font-semibold text-foreground">{t(language, "appointments.create.supervisorOverrideRequired")}</h3>
        <p id="supervisor-override-description" className="mt-1.5 text-sm text-muted-foreground">{t(language, "appointments.create.supervisorApprovalNeeded")}</p>
        {overrideTypes.length ? (
          <ul className="mt-3 list-disc space-y-1 ps-5 text-sm text-foreground">
            {overrideTypes.map((overrideType) => <li key={overrideType}>{formatOverrideType(overrideType)}</li>)}
          </ul>
        ) : null}

        <div className="grid gap-3 mt-4">
          {mode === "delegated_supervisor" ? (
            <>
              <Input aria-label={t(language, "appointments.create.supervisorUsername")} value={supervisorUsername} onChange={(e) => setSupervisorUsername(e.target.value)} placeholder={t(language, "appointments.create.supervisorUsername")} />
              <Input aria-label={t(language, "appointments.create.password")} type="password" value={supervisorPassword} onChange={(e) => setSupervisorPassword(e.target.value)} placeholder={t(language, "appointments.create.password")} />
            </>
          ) : null}
          <Input aria-label={t(language, "appointments.create.overrideReason")} value={overrideReason} onChange={(e) => setOverrideReason(e.target.value)} placeholder={t(language, "appointments.create.overrideReason")} />
        </div>

        {(localError || authError) && (
          <div className="mt-3 text-sm text-red-600">{localError || authError}</div>
        )}

        <div className="mt-4 flex flex-col sm:flex-row justify-end gap-3">
          <Button type="button" variant="secondary" onClick={handleClose} disabled={loading}>
            {t(language, "appointments.create.cancel")}
          </Button>
          <Button type="button" onClick={handleConfirm} disabled={loading}>
            {loading ? t(language, "appointments.create.validating") : mode === "current_user" ? t(language, "common.continue") : t(language, "appointments.create.approveBook")}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
