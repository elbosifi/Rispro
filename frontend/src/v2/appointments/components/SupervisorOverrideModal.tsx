import { useState } from "react";
import { t } from "@/lib/i18n";
import { useLanguage } from "@/providers/language-provider";
import { Button, Input } from "@/components/shared";

interface Props {
  open: boolean;
  onClose: () => void;
  onConfirm: (payload: { supervisorUsername: string; supervisorPassword: string; overrideReason: string }) => Promise<void>;
  loading: boolean;
  authError?: string | null;
}

export function SupervisorOverrideModal({ open, onClose, onConfirm, loading, authError }: Props) {
  const { language } = useLanguage();
  const [supervisorUsername, setSupervisorUsername] = useState("");
  const [supervisorPassword, setSupervisorPassword] = useState("");
  const [overrideReason, setOverrideReason] = useState("");
  const [localError, setLocalError] = useState<string | null>(null);

  if (!open) return null;

  async function handleConfirm() {
    if (!supervisorUsername.trim() || !supervisorPassword.trim() || !overrideReason.trim()) {
      setLocalError(t(language, "appointments.create.allFieldsRequired"));
      return;
    }
    setLocalError(null);
    await onConfirm({
      supervisorUsername: supervisorUsername.trim(),
      supervisorPassword,
      overrideReason: overrideReason.trim(),
    });
  }

  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center bg-black/45 p-4"
      onClick={(e) => {
        if (e.target === e.currentTarget && !loading) onClose();
      }}
    >
      <div className="w-full max-w-md rounded-xl border border-border bg-card p-4 sm:p-5 shadow-lg">
        <h3 className="text-lg font-semibold text-foreground">{t(language, "appointments.create.supervisorOverrideRequired")}</h3>
        <p className="mt-1.5 text-sm text-muted-foreground">{t(language, "appointments.create.supervisorApprovalNeeded")}</p>

        <div className="grid gap-3 mt-4">
          <Input value={supervisorUsername} onChange={(e) => setSupervisorUsername(e.target.value)} placeholder={t(language, "appointments.create.supervisorUsername")} />
          <Input type="password" value={supervisorPassword} onChange={(e) => setSupervisorPassword(e.target.value)} placeholder={t(language, "appointments.create.password")} />
          <Input value={overrideReason} onChange={(e) => setOverrideReason(e.target.value)} placeholder={t(language, "appointments.create.overrideReason")} />
        </div>

        {(localError || authError) && (
          <div className="mt-3 text-sm text-red-600">{localError || authError}</div>
        )}

        <div className="mt-4 flex flex-col sm:flex-row justify-end gap-3">
          <Button type="button" variant="secondary" onClick={onClose} disabled={loading}>
            {t(language, "appointments.create.cancel")}
          </Button>
          <Button type="button" onClick={handleConfirm} disabled={loading}>
            {loading ? t(language, "appointments.create.validating") : t(language, "appointments.create.approveBook")}
          </Button>
        </div>
      </div>
    </div>
  );
}
