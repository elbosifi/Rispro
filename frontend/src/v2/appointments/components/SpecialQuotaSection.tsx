import type { SpecialReasonCodeDto } from "../types";

interface Props {
  enabled: boolean;
  onToggle: (enabled: boolean) => void;
  specialReasonCode: string;
  onChangeSpecialReasonCode: (value: string) => void;
  specialReasonNote: string;
  onChangeSpecialReasonNote: (value: string) => void;
  options: SpecialReasonCodeDto[];
}

export function SpecialQuotaSection({
  enabled,
  onToggle,
  specialReasonCode,
  onChangeSpecialReasonCode,
  specialReasonNote,
  onChangeSpecialReasonNote,
  options,
}: Props) {
  return (
    <div style={{ border: "1px solid var(--border-color, #e2e8f0)", borderRadius: 8, padding: 12 }}>
      <label style={{ display: "inline-flex", alignItems: "center", gap: 8, fontSize: 13, fontWeight: 600 }}>
        <input type="checkbox" checked={enabled} onChange={(e) => onToggle(e.target.checked)} />
        Use special quota
      </label>
      <div style={{ marginTop: 6, fontSize: 12, color: "var(--text-muted, #64748b)" }}>
        Special reason is justification/audit metadata only; it is not an independent policy bypass.
      </div>

      {enabled && (
        <div style={{ display: "grid", gridTemplateColumns: "1fr", gap: 8, marginTop: 10 }}>
          <select
            value={specialReasonCode}
            onChange={(e) => onChangeSpecialReasonCode(e.target.value)}
            style={{ padding: "8px 10px", border: "1px solid var(--border-color, #e2e8f0)", borderRadius: 6 }}
          >
            <option value="">Select special reason (required)...</option>
            {options.filter((o) => o.isActive !== false).map((o) => (
              <option key={o.code} value={o.code}>{o.labelEn || o.code}</option>
            ))}
          </select>
          <input
            value={specialReasonNote}
            onChange={(e) => onChangeSpecialReasonNote(e.target.value)}
            placeholder="Optional note"
            style={{ padding: "8px 10px", border: "1px solid var(--border-color, #e2e8f0)", borderRadius: 6 }}
          />
        </div>
      )}
    </div>
  );
}
