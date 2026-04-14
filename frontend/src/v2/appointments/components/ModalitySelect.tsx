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
      <label style={{ display: "block", fontSize: 12, fontWeight: 600, marginBottom: 6 }}>Modality</label>
      <select
        value={value ?? ""}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value ? Number(e.target.value) : null)}
        style={{ width: "100%", padding: "8px 10px", border: "1px solid var(--border-color, #e2e8f0)", borderRadius: 6 }}
      >
        <option value="">Select modality...</option>
        {options.filter((m) => m.isActive).map((m) => (
          <option key={m.id} value={m.id}>{m.name}</option>
        ))}
      </select>
    </div>
  );
}
