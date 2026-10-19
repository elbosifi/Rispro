import { useEffect, useId, useRef, useState } from "react";
import { displayDateToIso, isoToDisplayDateLy } from "@/lib/date-format";
import { useLanguage } from "@/providers/language-provider";
import { t } from "@/lib/i18n";
import { Calendar } from "lucide-react";

interface DateInputProps {
  label: string;
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
  required?: boolean;
  name?: string;
  inputRef?: React.RefObject<HTMLInputElement | null>;
  onKeyDown?: React.KeyboardEventHandler<HTMLInputElement>;
  compact?: boolean;
}

function autoFormatDisplayDateDraft(rawValue: string): string {
  const digits = String(rawValue || "").replace(/\D/g, "").slice(0, 8);
  if (digits.length <= 2) return digits;
  if (digits.length <= 4) return `${digits.slice(0, 2)}/${digits.slice(2)}`;
  return `${digits.slice(0, 2)}/${digits.slice(2, 4)}/${digits.slice(4)}`;
}

export function DateInput({
  label,
  value,
  onChange,
  disabled = false,
  required = false,
  name,
  inputRef,
  onKeyDown,
  compact = false,
}: DateInputProps) {
  const { language } = useLanguage();
  const hiddenInputRef = useRef<HTMLInputElement>(null);
  const [draft, setDraft] = useState(isoToDisplayDateLy(value));
  const inputId = useId();

  useEffect(() => {
    setDraft(isoToDisplayDateLy(value));
  }, [value]);

  const commitDraft = () => {
    const parsed = displayDateToIso(draft);
    if (parsed === null) {
      setDraft(isoToDisplayDateLy(value));
      return;
    }
    onChange(parsed);
    setDraft(isoToDisplayDateLy(parsed));
  };

  const openPicker = () => {
    const input = hiddenInputRef.current;
    if (!input || disabled) return;
    if (typeof input.showPicker === "function") {
      input.showPicker();
      return;
    }
    input.click();
  };

  return (
    <div>
        <label htmlFor={inputId} className={compact ? "sr-only" : "block text-sm font-semibold mb-1.5"} style={{ color: "var(--foreground)" }}>
        {label}
      </label>
      <div className="relative">
        <input
          ref={inputRef}
          id={inputId}
          type="text"
          name={name}
          dir="ltr"
          value={draft}
          placeholder={t(language, "dateInput.placeholder")}
          disabled={disabled}
          required={required}
          onChange={(event) => setDraft(autoFormatDisplayDateDraft(event.target.value))}
          onKeyDown={onKeyDown}
          onBlur={commitDraft}
          className={`${compact ? "!min-h-10 h-10 pr-10 text-sm" : "pr-12"} input-premium input-ltr w-full disabled:opacity-50`}
        />
        <button
          type="button"
          onClick={openPicker}
          disabled={disabled}
          className={`${compact ? "px-2.5" : "px-3"} absolute inset-y-0 right-0 flex items-center justify-center transition-colors duration-150 disabled:opacity-50`}
          style={{ color: "var(--text-muted)" }}
          aria-label={t(language, "toast.pickDate", { label })}
        >
          <Calendar size={18} strokeWidth={1.5} />
        </button>
        <input
          ref={hiddenInputRef}
          type="date"
          tabIndex={-1}
          aria-hidden="true"
          value={value}
          onChange={(event) => onChange(event.target.value)}
          className="absolute w-0 h-0 opacity-0 pointer-events-none"
        />
      </div>
    </div>
  );
}
