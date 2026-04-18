import type { ModalityDto } from "../types";

interface Props {
  options: ModalityDto[];
  value: number | null;
  onChange: (value: number | null) => void;
  disabled?: boolean;
}

export function ModalitySelect({ options, value, onChange, disabled }: Props) {
  return (
    <div>
      <label className="block text-xs uppercase tracking-[0.08em] mb-2 font-mono-data" style={{ color: "var(--text-muted)" }}>
        Modality
      </label>
      <select
        aria-label="Modality"
        value={value ?? ""}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value ? Number(e.target.value) : null)}
        className="input-premium"
      >
        <option value="">Select modality...</option>
        {options.filter((m) => m.isActive).map((m) => (
          <option key={m.id} value={m.id}>{m.name}</option>
        ))}
      </select>
    </div>
  );
}
