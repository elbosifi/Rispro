import { t } from "@/lib/i18n";
import { useLanguage } from "@/providers/language-provider";
import type { ModalityDto } from "../types";

interface Props {
  options: ModalityDto[];
  value: number | null;
  onChange: (value: number | null) => void;
  disabled?: boolean;
}

export function ModalitySelect({ options, value, onChange, disabled }: Props) {
  const { language } = useLanguage();
  return (
    <div>
      <label className="block text-xs uppercase tracking-[0.08em] mb-2 font-mono-data" style={{ color: "var(--text-muted)" }}>
        {t(language, "appointments.create.modality")}
      </label>
      <select
        aria-label={t(language, "appointments.create.modality")}
        value={value ?? ""}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value ? Number(e.target.value) : null)}
        className="input-premium"
      >
        <option value="">{t(language, "appointments.create.selectModality")}</option>
        {options.filter((m) => m.isActive).map((m) => (
          <option key={m.id} value={m.id}>{m.name}</option>
        ))}
      </select>
    </div>
  );
}
