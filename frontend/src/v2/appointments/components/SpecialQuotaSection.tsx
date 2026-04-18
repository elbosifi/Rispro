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
    <div className="card-shell p-4">
      <label className="block text-xs uppercase tracking-[0.08em] mb-3 font-mono-data" style={{ color: "var(--text-muted)" }}>
        Capacity Resolution Action (Supervisor)
      </label>
      <select
        aria-label="Capacity Resolution Action"
        value={capacityResolutionMode}
        onChange={(e) => onChangeCapacityResolutionMode(e.target.value as CapacityResolutionMode)}
        className="input-premium"
      >
        <option value="standard">Standard booking (normal capacity rules)</option>
        <option value="category_override">Override category reserve (stay within daily total)</option>
        <option value="special_quota_extra" disabled={!specialQuotaAvailable}>
          Use special quota extra slot
        </option>
      </select>
      {!specialQuotaAvailable && (
        <div className="mt-2 text-xs font-mono-data" style={{ color: "var(--text-muted)" }}>
          Special quota extra slot unavailable for selected exam type.
        </div>
      )}
      {categoryOverrideEnabled && (
        <div className="mt-2 text-xs font-mono-data" style={{ color: "var(--text-muted)" }}>
          Category reserve bypass only. Modality daily total remains a hard ceiling.
        </div>
      )}
      <div className="mt-2 text-xs font-mono-data" style={{ color: "var(--text-muted)" }}>
        Special reason is justification/audit metadata only; it is not an independent policy bypass.
      </div>

      {specialQuotaEnabled && (
        <div className="space-y-3 mt-4">
          <select
            aria-label="Special Reason"
            value={specialReasonCode}
            onChange={(e) => onChangeSpecialReasonCode(e.target.value)}
            className="input-premium"
          >
            <option value="">Select special reason (required)...</option>
            {options.filter((o) => o.isActive !== false).map((o) => (
              <option key={o.code} value={o.code}>{o.labelEn || o.code}</option>
            ))}
          </select>
          <label className="flex items-center gap-2 cursor-pointer user-select-none">
            <input
              type="checkbox"
              checked={specialReasonConfirmed}
              onChange={(e) => onChangeSpecialReasonConfirmed(e.target.checked)}
              className="w-4 h-4 cursor-pointer accent-[var(--accent)]"
            />
            <span className="text-sm" style={{ color: "var(--text-muted)" }}>
              I confirm the selected special reason is correct
            </span>
          </label>
          <input
            value={specialReasonNote}
            onChange={(e) => onChangeSpecialReasonNote(e.target.value)}
            placeholder="Optional note"
            className="input-premium"
          />
        </div>
      )}
    </div>
  );
}
