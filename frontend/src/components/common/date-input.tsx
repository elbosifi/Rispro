import { useEffect, useId, useRef, useState } from "react";
import { displayDateToIso, isoToDisplayDateLy } from "@/lib/date-format";

interface DateInputProps {
  label: string;
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
}

export function DateInput({ label, value, onChange, disabled = false }: DateInputProps) {
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
      <label htmlFor={inputId} className="block text-sm font-medium text-stone-700 dark:text-stone-300 mb-1">
        {label}
      </label>
      <div className="relative">
        <input
          id={inputId}
          type="text"
          dir="ltr"
          value={draft}
          placeholder="dd/mm/yyyy"
          disabled={disabled}
          onChange={(event) => setDraft(event.target.value)}
          onBlur={commitDraft}
          className="input-premium input-ltr w-full pr-12 disabled:opacity-50"
        />
        <button
          type="button"
          onClick={openPicker}
          disabled={disabled}
          className="absolute inset-y-0 right-0 px-3 text-stone-500 hover:text-stone-700 dark:text-stone-400 dark:hover:text-stone-200 disabled:opacity-50"
          aria-label={`Pick ${label}`}
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7V3m8 4V3m-9 8h10m-13 9h16a2 2 0 002-2V7a2 2 0 00-2-2H4a2 2 0 00-2 2v11a2 2 0 002 2z" />
          </svg>
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
