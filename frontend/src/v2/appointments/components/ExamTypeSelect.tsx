import { t } from "@/lib/i18n";
import { useLanguage } from "@/providers/language-provider";
import type { ExamTypeDto } from "../types";

interface Props {
  options: ExamTypeDto[];
  value: number | null;
  onChange: (value: number | null) => void;
  disabled?: boolean;
}

export function ExamTypeSelect({ options, value, onChange, disabled }: Props) {
  const { language } = useLanguage();
  return (
    <div>
      <label className="block text-xs uppercase tracking-[0.08em] mb-2 font-mono-data" style={{ color: "var(--text-muted)" }}>
        {t(language, "appointments.create.examType")}
      </label>
      <select
        aria-label={t(language, "appointments.create.examType")}
        value={value ?? ""}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value ? Number(e.target.value) : null)}
        className="input-premium"
      >
        <option value="">{t(language, "appointments.create.selectExamType")}</option>
        {options.map((et) => (
          <option key={et.id} value={et.id}>{et.name}</option>
        ))}
      </select>
    </div>
  );
}
