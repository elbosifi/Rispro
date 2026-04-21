import { useState } from "react";
import { t } from "@/lib/i18n";
import { useLanguage } from "@/providers/language-provider";

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
      style={{ position: "fixed", inset: 0, display: "flex", alignItems: "center", justifyContent: "center", background: "rgba(0,0,0,0.45)", zIndex: 60 }}
      onClick={(e) => {
        if (e.target === e.currentTarget && !loading) onClose();
      }}
    >
      <div style={{ width: "100%", maxWidth: 420, background: "#fff", borderRadius: 10, padding: 16, border: "1px solid #e2e8f0" }}>
        <h3 style={{ margin: 0, fontSize: 16 }}>{t(language, "appointments.create.supervisorOverrideRequired")}</h3>
        <p style={{ marginTop: 6, fontSize: 13, color: "#64748b" }}>{t(language, "appointments.create.supervisorApprovalNeeded")}</p>

        <div style={{ display: "grid", gap: 10 }}>
          <input value={supervisorUsername} onChange={(e) => setSupervisorUsername(e.target.value)} placeholder={t(language, "appointments.create.supervisorUsername")} />
          <input type="password" value={supervisorPassword} onChange={(e) => setSupervisorPassword(e.target.value)} placeholder={t(language, "appointments.create.password")} />
          <input value={overrideReason} onChange={(e) => setOverrideReason(e.target.value)} placeholder={t(language, "appointments.create.overrideReason")} />
        </div>

        {(localError || authError) && (
          <div style={{ marginTop: 10, color: "#dc2626", fontSize: 12 }}>{localError || authError}</div>
        )}

        <div style={{ marginTop: 14, display: "flex", justifyContent: "flex-end", gap: 8 }}>
          <button type="button" onClick={onClose} disabled={loading}>{t(language, "appointments.create.cancel")}</button>
          <button type="button" onClick={handleConfirm} disabled={loading}>{loading ? t(language, "appointments.create.validating") : t(language, "appointments.create.approveBook")}</button>
        </div>
      </div>
    </div>
  );
}
