import type { SpecialReasonCodeDto } from "../types";
import type { CapacityResolutionMode } from "../types";

interface Props {
  capacityResolutionMode: CapacityResolutionMode;
  onChangeCapacityResolutionMode: (mode: CapacityResolutionMode) => void;
  specialQuotaAvailable: boolean;
  supervisorMode?: boolean;
  specialReasonCode: string;
  onChangeSpecialReasonCode: (value: string) => void;
  specialReasonConfirmed: boolean;
  onChangeSpecialReasonConfirmed: (value: boolean) => void;
  specialReasonNote: string;
  onChangeSpecialReasonNote: (value: string) => void;
  options: SpecialReasonCodeDto[];
}

export function SpecialQuotaSection({
  capacityResolutionMode,
  onChangeCapacityResolutionMode,
  specialQuotaAvailable,
  supervisorMode = true,
  specialReasonCode,
  onChangeSpecialReasonCode,
  specialReasonConfirmed,
  onChangeSpecialReasonConfirmed,
  specialReasonNote,
  onChangeSpecialReasonNote,
  options,
}: Props) {
  const specialQuotaEnabled = capacityResolutionMode === "special_quota_extra";
  const categoryOverrideEnabled = capacityResolutionMode === "category_override";

  if (!supervisorMode) return null;

  return (
    <div style={{ border: "1px solid var(--border-color, #e2e8f0)", borderRadius: 8, padding: 12 }}>
      <label style={{ display: "block", fontSize: 13, fontWeight: 600, marginBottom: 8 }}>
        Capacity Resolution Action (Supervisor)
      </label>
      <select
        aria-label="Capacity Resolution Action"
        value={capacityResolutionMode}
        onChange={(e) => onChangeCapacityResolutionMode(e.target.value as CapacityResolutionMode)}
        style={{ width: "100%", padding: "8px 10px", border: "1px solid var(--border-color, #e2e8f0)", borderRadius: 6 }}
      >
        <option value="standard">Standard booking (normal capacity rules)</option>
        <option value="category_override">Override category reserve (stay within daily total)</option>
        <option value="special_quota_extra" disabled={!specialQuotaAvailable}>
          Use special quota extra slot
        </option>
      </select>
      {!specialQuotaAvailable && (
        <div style={{ marginTop: 6, fontSize: 12, color: "var(--text-muted, #64748b)" }}>
          Special quota extra slot unavailable for selected exam type.
        </div>
      )}
      {categoryOverrideEnabled && (
        <div style={{ marginTop: 6, fontSize: 12, color: "var(--text-muted, #64748b)" }}>
          Category reserve bypass only. Modality daily total remains a hard ceiling.
        </div>
      )}
      <div style={{ marginTop: 6, fontSize: 12, color: "var(--text-muted, #64748b)" }}>
        Special reason is justification/audit metadata only; it is not an independent policy bypass.
      </div>

      {specialQuotaEnabled && (
        <div style={{ display: "grid", gridTemplateColumns: "1fr", gap: 8, marginTop: 10 }}>
          <select
            aria-label="Special Reason"
            value={specialReasonCode}
            onChange={(e) => onChangeSpecialReasonCode(e.target.value)}
            style={{ padding: "8px 10px", border: "1px solid var(--border-color, #e2e8f0)", borderRadius: 6 }}
          >
            <option value="">Select special reason (required)...</option>
            {options.filter((o) => o.isActive !== false).map((o) => (
              <option key={o.code} value={o.code}>{o.labelEn || o.code}</option>
            ))}
          </select>
          <label style={{ display: "inline-flex", alignItems: "center", gap: 8, fontSize: 12, color: "var(--text-muted, #64748b)" }}>
            <input
              type="checkbox"
              checked={specialReasonConfirmed}
              onChange={(e) => onChangeSpecialReasonConfirmed(e.target.checked)}
            />
            I confirm the selected special reason is correct
          </label>
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
