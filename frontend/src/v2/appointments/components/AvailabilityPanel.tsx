import { isAvailabilityRowVisible } from "../hooks/availability-row-mapper";
import type { AvailabilityRowViewModel } from "../hooks/useAppointmentAvailability";
import { inferSupportedOverrideTypeFromExamRuleMetadata } from "../utils/scheduling-override-requests";
import { AvailabilityDateRow } from "./AvailabilityDateRow";
import { t } from "@/lib/i18n";
import { useLanguage } from "@/providers/language-provider";
import { Button, Input } from "@/components/shared";

interface Props {
  rows: AvailabilityRowViewModel[];
  selectedDate: string;
  onSelectDate: (row: AvailabilityRowViewModel) => void;
  loading: boolean;
  emptyMessage: string;
  showFullDays: boolean;
  onToggleShowFullDays: () => void;
  showPolicyHiddenDays: boolean;
  onToggleShowPolicyHiddenDays: () => void;
  startDate: string;
  onChangeStartDate: (isoDate: string) => void;
  onPreviousPage: () => void;
  onNextPage: () => void;
  canGoPrevious: boolean;
  allowOverrideRequests?: boolean;
}

export function AvailabilityPanel({
  rows,
  selectedDate,
  onSelectDate,
  loading,
  emptyMessage,
  showFullDays,
  onToggleShowFullDays,
  showPolicyHiddenDays,
  onToggleShowPolicyHiddenDays,
  startDate,
  onChangeStartDate,
  onPreviousPage,
  onNextPage,
  canGoPrevious,
  allowOverrideRequests = true,
}: Props) {
  const { language } = useLanguage();
  const visibleRows = rows.filter((row) => {
    const rowOverrideType = inferSupportedOverrideTypeFromExamRuleMetadata({
      reasonCodes: row.reasonCodes,
      requiresSupervisorOverride: row.requiresSupervisorOverride,
      effectModes: row.matchedExamRuleSummary ? [row.matchedExamRuleSummary.effectMode] : [],
    });
    return isAvailabilityRowVisible(row, {
      showFullDays,
      showPolicyHiddenDays,
      selected: row.date === selectedDate,
      requestableOverride: allowOverrideRequests && Boolean(rowOverrideType),
    });
  });

  if (loading) {
    return <div className="rounded-lg border border-dashed border-border bg-muted/30 px-4 py-8 text-center text-sm" style={{ color: "var(--text-muted)" }}>{t(language, "appointments.create.loadingAvailability")}</div>;
  }

  if (rows.length === 0) {
    if (!emptyMessage) return null;
    return <div className="rounded-lg border border-dashed border-border bg-muted/30 px-4 py-8 text-center text-sm" style={{ color: "var(--text-muted)" }}>{emptyMessage}</div>;
  }

  return (
    <div className="space-y-3 sm:space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border bg-muted/40 p-2">
        <div className="flex gap-2 items-center">
          <Button type="button" variant="ghost" size="sm" onClick={onPreviousPage} disabled={!canGoPrevious} className="text-xs h-8 px-2">
            {t(language, "appointments.create.previousSlots")}
          </Button>
          <Button type="button" variant="ghost" size="sm" onClick={onNextPage} className="text-xs h-8 px-2">
            {t(language, "appointments.create.nextSlots")}
          </Button>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <label className="flex items-center gap-2 text-xs sm:text-sm font-medium" style={{ color: "var(--text-muted)" }}>
            {t(language, "appointments.create.startDate")}
          </label>
          <Input
            aria-label={t(language, "appointments.create.startDate")}
            type="date"
            value={startDate}
            onChange={(event) => onChangeStartDate(event.target.value)}
            className="text-xs"
            style={{ width: "10rem", minHeight: "var(--control-height-sm)", padding: "0.35rem 0.5rem", borderRadius: "var(--radius-sm)" }}
          />
          <Button type="button" variant="ghost" size="sm" onClick={onToggleShowFullDays} className="text-xs h-8 px-2">
            {showFullDays ? t(language, "appointments.create.hideFullDays") : t(language, "appointments.create.showFullDays")}
          </Button>
          <Button type="button" variant="ghost" size="sm" onClick={onToggleShowPolicyHiddenDays} className="text-xs h-8 px-2">
            {showPolicyHiddenDays ? t(language, "appointments.create.hideWeekendDays") : t(language, "appointments.create.showWeekendDays")}
          </Button>
        </div>
      </div>
      {visibleRows.length === 0 ? (
        <div className="text-sm text-center" style={{ color: "var(--text-muted)" }}>
          {t(language, "appointments.create.noNonFullDays")}
        </div>
      ) : visibleRows.map((row) => {
        const requestableOverride = allowOverrideRequests && Boolean(
          inferSupportedOverrideTypeFromExamRuleMetadata({
            reasonCodes: row.reasonCodes,
            requiresSupervisorOverride: row.requiresSupervisorOverride,
            effectModes: row.matchedExamRuleSummary ? [row.matchedExamRuleSummary.effectMode] : [],
          })
        );
        return (
          <AvailabilityDateRow
            key={row.date}
            date={row.date}
            dayLabel={row.dayLabel}
            status={row.status}
            bucketMode={row.bucketMode}
            remainingCapacity={row.remainingCapacity}
            dailyCapacity={row.dailyCapacity}
            oncologyReserved={row.oncologyReserved}
            oncologyFilled={row.oncologyFilled}
            oncologyRemaining={row.oncologyRemaining}
            nonOncologyReserved={row.nonOncologyReserved}
            nonOncologyFilled={row.nonOncologyFilled}
            nonOncologyRemaining={row.nonOncologyRemaining}
            specialQuotaRemaining={row.specialQuotaRemaining}
            specialQuotaConfigured={row.specialQuotaConfigured}
            specialQuotaPath={Boolean(row.hasSpecialQuotaPath)}
            examMixQuotaSummaries={row.examMixQuotaSummaries}
            primaryExamMixBlocking={row.primaryExamMixBlocking}
            matchedExamRuleSummary={row.matchedExamRuleSummary}
            reasonText={row.reasonText}
            requiresSupervisorOverride={row.requiresSupervisorOverride}
            requestableOverride={requestableOverride}
            allowNonAvailableSelection={allowOverrideRequests || row.hasSpecialQuotaPath}
            selected={selectedDate === row.date}
            onClick={() => onSelectDate(row)}
          />
        );
      })}
    </div>
  );
}
