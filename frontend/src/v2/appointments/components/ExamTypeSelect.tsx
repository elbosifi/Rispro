import type { ExamTypeDto } from "../types";

interface Props {
  options: ExamTypeDto[];
  value: number | null;
  onChange: (value: number | null) => void;
  disabled?: boolean;
}

export function ExamTypeSelect({ options, value, onChange, disabled }: Props) {
  return (
    <div>
      <label style={{ display: "block", fontSize: 12, fontWeight: 600, marginBottom: 6 }}>Exam Type</label>
      <select
        value={value ?? ""}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value ? Number(e.target.value) : null)}
        style={{ width: "100%", padding: "8px 10px", border: "1px solid var(--border-color, #e2e8f0)", borderRadius: 6 }}
      >
        <option value="">Select exam type...</option>
        {options.map((et) => (
          <option key={et.id} value={et.id}>{et.name}</option>
        ))}
      </select>
    </div>
  );
}
