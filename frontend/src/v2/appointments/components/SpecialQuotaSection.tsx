import { chooseLocalized, t } from "@/lib/i18n";
import { useLanguage } from "@/providers/language-provider";
import type { SpecialReasonCodeDto } from "../types";
import type { CapacityResolutionMode } from "../types";
import { Input } from "@/components/shared";

interface Props {
  capacityResolutionMode: CapacityResolutionMode;
  onChangeCapacityResolutionMode: (mode: CapacityResolutionMode) => void;
  specialQuotaAvailable: boolean;
  specialQuotaRemaining?: number | null;
  specialQuotaConfigured?: number | null;
  showCapacityActions: boolean;
  canUseSpecialQuota: boolean;
  canUseCategoryOverride: boolean;
  canUseTotalCapacityOverride: boolean;
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
  specialQuotaRemaining = null,
  specialQuotaConfigured = null,
  showCapacityActions,
  canUseSpecialQuota,
  canUseCategoryOverride,
  canUseTotalCapacityOverride,
  specialReasonCode,
  onChangeSpecialReasonCode,
  specialReasonConfirmed,
  onChangeSpecialReasonConfirmed,
  specialReasonNote,
  onChangeSpecialReasonNote,
  options,
}: Props) {
  const { language } = useLanguage();
  const specialQuotaEnabled = capacityResolutionMode === "special_quota_extra";
  const categoryOverrideEnabled = capacityResolutionMode === "category_override";

  if (!showCapacityActions) return null;

  return (
    <div className="card-shell p-3 sm:p-4">
      <label className="block text-sm font-semibold mb-2 text-foreground">
        {t(language, "appointments.create.capacityAction")}
      </label>
      <select
        aria-label={t(language, "appointments.create.capacityAction")}
        value={capacityResolutionMode}
        onChange={(e) => onChangeCapacityResolutionMode(e.target.value as CapacityResolutionMode)}
        className="input-premium"
      >
        <option value="standard">{t(language, "appointments.create.standardBooking")}</option>
        {canUseCategoryOverride && (
          <option value="category_override">{t(language, "appointments.create.categoryOverride")}</option>
        )}
        {canUseTotalCapacityOverride && (
          <option value="total_capacity_override">
            {language === "ar" ? "تجاوز السعة الإجمالية (مدير أعلى فقط)" : "Total capacity override (super admin only)"}
          </option>
        )}
        {canUseSpecialQuota && (
          <option value="special_quota_extra" disabled={!specialQuotaAvailable}>
            {t(language, "appointments.create.specialQuotaExtra")}
          </option>
        )}
      </select>
      {canUseSpecialQuota && !specialQuotaAvailable && (
        <div className="mt-2 text-xs sm:text-sm" style={{ color: "var(--text-muted)" }}>
          {t(language, "appointments.create.specialQuotaUnavailable")}
        </div>
      )}
      {categoryOverrideEnabled && (
        <div className="mt-2 text-xs sm:text-sm" style={{ color: "var(--text-muted)" }}>
          {t(language, "appointments.create.categoryReserveNote")}
        </div>
      )}
      {canUseSpecialQuota && (
        <div className="mt-2 text-xs sm:text-sm" style={{ color: "var(--text-muted)" }}>
          {t(language, "appointments.create.specialReasonAudit")}
        </div>
      )}
      {canUseSpecialQuota && specialQuotaAvailable && specialQuotaRemaining != null && (
        <div className="mt-2 text-xs sm:text-sm font-medium" style={{ color: "var(--text-muted)" }}>
          {language === "ar" ? "الحصة الخاصة" : "Special quota"}: {specialQuotaRemaining}{specialQuotaConfigured != null ? ` of ${specialQuotaConfigured}` : ""} {language === "ar" ? "متبقية" : "remaining"}
        </div>
      )}

      {specialQuotaEnabled && (
        <div className="space-y-3 mt-4">
          <select
            aria-label={t(language, "appointments.create.specialReason")}
            value={specialReasonCode}
            onChange={(e) => onChangeSpecialReasonCode(e.target.value)}
            className="input-premium"
          >
            <option value="">{t(language, "appointments.create.specialReasonPlaceholder")}</option>
            {options.filter((o) => o.isActive !== false).map((o) => (
              <option key={o.code} value={o.code}>{chooseLocalized(language, o.labelAr, o.labelEn) || o.code}</option>
            ))}
          </select>
          <label className="flex items-center gap-2 cursor-pointer user-select-none">
            <input
              type="checkbox"
              checked={specialReasonConfirmed}
              onChange={(e) => onChangeSpecialReasonConfirmed(e.target.checked)}
              className="w-4 h-4 cursor-pointer accent-[var(--accent)]"
            />
            <span className="text-sm text-muted-foreground">
              {t(language, "appointments.create.specialReasonConfirm")}
            </span>
          </label>
          <Input
            value={specialReasonNote}
            onChange={(e) => onChangeSpecialReasonNote(e.target.value)}
            placeholder={t(language, "appointments.create.optionalNote")}
          />
        </div>
      )}
    </div>
  );
}
