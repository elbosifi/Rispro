import { t } from "@/lib/i18n";
import { useLanguage } from "@/providers/language-provider";
import type { ExamTypeDto } from "../types";
import { formatEntityLabel, type EntityDisplayMode } from "../utils/entity-display";

interface Props {
  options: ExamTypeDto[];
  value: number | null;
  onChange: (value: number | null) => void;
  displayMode: EntityDisplayMode;
  disabled?: boolean;
}

export function ExamTypeSelect({ options, value, onChange, displayMode, disabled }: Props) {
  const { language } = useLanguage();
  return (
    <div>
      <label className="block text-sm font-semibold mb-2 text-foreground">
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
          <option key={et.id} value={et.id}>
            {formatEntityLabel({ mode: displayMode, nameAr: et.nameAr, nameEn: et.nameEn, fallback: et.name })}
          </option>
        ))}
      </select>
    </div>
  );
}
