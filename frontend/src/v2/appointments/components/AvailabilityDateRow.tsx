import type { AvailabilityRowStatus } from "../hooks/useAppointmentAvailability";
import { t } from "@/lib/i18n";
import { useLanguage } from "@/providers/language-provider";

interface Props {
  date: string;
  dayLabel: string;
  status: AvailabilityRowStatus;
  bucketMode: "partitioned" | "total_only";
  remainingCapacity: number | null;
  dailyCapacity: number | null;
  oncologyReserved: number | null;
  oncologyFilled: number;
  oncologyRemaining: number | null;
  nonOncologyReserved: number | null;
  nonOncologyFilled: number;
  nonOncologyRemaining: number | null;
  specialQuotaRemaining: number | null;
  specialQuotaConfigured?: number | null;
  specialQuotaPath?: boolean;
  examMixQuotaSummaries?: Array<{
    ruleId: number;
    title: string | null;
    dailyLimit: number;
    consumed: number;
    remaining: number;
    isBlocking: boolean;
    isPrimaryBlocking: boolean;
  }>;
  primaryExamMixBlocking?: {
    ruleId: number;
    title: string | null;
    consumed: number;
    dailyLimit: number;
    remaining: number;
  } | null;
  matchedExamRuleSummary?: {
    ruleId: string;
    title: string;
    effectLabel: string;
    effectMode: string;
    isBlocking: boolean;
  } | null;
  reasonText: string;
  requiresSupervisorOverride: boolean;
  requestableOverride?: boolean;
  allowNonAvailableSelection?: boolean;
  selected: boolean;
  onClick: () => void;
}

type SlotSegment = {
  key: string;
  color: string;
  category: "oncology" | "non_oncology" | "uncategorized";
  isFilled: boolean;
};

function clampNonNegative(value: number | null | undefined): number {
  const parsed = Number(value ?? 0);
  if (!Number.isFinite(parsed) || parsed <= 0) return 0;
  return Math.floor(parsed);
}

function buildSlotSegments(params: {
  bucketMode: "partitioned" | "total_only";
  dailyCapacity: number | null;
  remainingCapacity: number | null;
  oncologyReserved: number | null;
  oncologyFilled: number;
  oncologyRemaining: number | null;
  nonOncologyReserved: number | null;
  nonOncologyFilled: number;
  nonOncologyRemaining: number | null;
}): SlotSegment[] {
  const dailyCapacity = clampNonNegative(params.dailyCapacity);
  const oncologyTotalRaw = params.bucketMode === "partitioned"
    ? (params.oncologyReserved ?? (params.oncologyFilled + (params.oncologyRemaining ?? 0)))
    : 0;
  const nonOncologyTotalRaw = params.bucketMode === "partitioned"
    ? (params.nonOncologyReserved ?? (params.nonOncologyFilled + (params.nonOncologyRemaining ?? 0)))
    : 0;

  const categoryTotal = clampNonNegative(oncologyTotalRaw) + clampNonNegative(nonOncologyTotalRaw);
  const fallbackCapacityFromCounts =
    clampNonNegative(params.oncologyFilled) +
    clampNonNegative(params.nonOncologyFilled) +
    clampNonNegative(params.remainingCapacity);
  const capacity = Math.max(dailyCapacity, categoryTotal, fallbackCapacityFromCounts, 1);

  let oncologyTotal = Math.min(clampNonNegative(oncologyTotalRaw), capacity);
  let nonOncologyTotal = Math.min(clampNonNegative(nonOncologyTotalRaw), Math.max(capacity - oncologyTotal, 0));
  let uncategorizedTotal = Math.max(capacity - oncologyTotal - nonOncologyTotal, 0);

  if (params.bucketMode === "total_only") {
    oncologyTotal = 0;
    nonOncologyTotal = 0;
    uncategorizedTotal = capacity;
  }

  const oncologyFilled = Math.min(clampNonNegative(params.oncologyFilled), oncologyTotal);
  const nonOncologyFilled = Math.min(clampNonNegative(params.nonOncologyFilled), nonOncologyTotal);
  const uncategorizedFilled = Math.min(
    Math.max(
      clampNonNegative(params.remainingCapacity) > 0
        ? capacity - clampNonNegative(params.remainingCapacity) - oncologyFilled - nonOncologyFilled
        : 0,
      0
    ),
    uncategorizedTotal
  );

  const segments: SlotSegment[] = [];

  for (let idx = 0; idx < oncologyTotal; idx += 1) {
    const isFilled = idx < oncologyFilled;
    segments.push({
      key: `oncology-${idx}`,
      color: isFilled ? "var(--green)" : "rgba(34, 197, 94, 0.5)",
      category: "oncology",
      isFilled
    });
  }

  for (let idx = 0; idx < nonOncologyTotal; idx += 1) {
    const isFilled = idx < nonOncologyFilled;
    segments.push({
      key: `non-oncology-${idx}`,
      color: isFilled ? "var(--blue)" : "rgba(59, 130, 246, 0.5)",
      category: "non_oncology",
      isFilled
    });
  }

  for (let idx = 0; idx < uncategorizedTotal; idx += 1) {
    const isFilled = idx < uncategorizedFilled;
    segments.push({
      key: `uncategorized-${idx}`,
      color: isFilled ? "var(--amber)" : "rgba(245, 158, 11, 0.5)",
      category: "uncategorized",
      isFilled
    });
  }

  return segments;
}

export function AvailabilityDateRow({
  date,
  dayLabel,
  status,
  bucketMode,
  remainingCapacity,
  dailyCapacity,
  oncologyReserved,
  oncologyFilled,
  oncologyRemaining,
  nonOncologyReserved,
  nonOncologyFilled,
  nonOncologyRemaining,
  specialQuotaRemaining,
  specialQuotaConfigured = null,
  specialQuotaPath = false,
  examMixQuotaSummaries,
  primaryExamMixBlocking,
  matchedExamRuleSummary,
  reasonText,
  requiresSupervisorOverride,
  requestableOverride = false,
  allowNonAvailableSelection = true,
  selected,
  onClick,
}: Props) {
  const { language } = useLanguage();
  const isClickable =
    status === "available" ||
    specialQuotaPath ||
    (status === "restricted" && allowNonAvailableSelection) ||
    requestableOverride ||
    (status === "full" && allowNonAvailableSelection && (requiresSupervisorOverride || (specialQuotaRemaining ?? 0) > 0));
  const isBlockedLike = status === "blocked" && !requestableOverride;

  const statusColor =
    status === "available"
      ? "var(--green)"
      : status === "restricted"
      ? "var(--amber)"
      : status === "full" || requestableOverride
      ? "var(--amber)"
      : "var(--accent)";
  const slotSegments = buildSlotSegments({
    bucketMode,
    dailyCapacity,
    remainingCapacity,
    oncologyReserved,
    oncologyFilled,
    oncologyRemaining,
    nonOncologyReserved,
    nonOncologyFilled,
    nonOncologyRemaining
  });

  return (
    <button
      type="button"
      onClick={() => {
        if (isClickable) onClick();
      }}
      disabled={!isClickable}
       style={{
         width: "100%",
         textAlign: "left",
         padding: 10,
         borderRadius: 8,
         border: selected ? "2px solid var(--blue)" : "1px solid var(--border)",
         background: selected ? "rgba(59, 130, 246, 0.1)" : "var(--background)",
         cursor: isClickable ? "pointer" : "not-allowed",
         opacity: isClickable ? 1 : 0.9,
      }}
      aria-label={`${date} ${status}`}
    >
      <div style={{ display: "flex", justifyContent: "space-between", gap: 8, alignItems: "center" }}>
        <div>
          <div style={{ fontWeight: 600 }}>{dayLabel}</div>
          <div style={{ fontSize: 12, color: "var(--text-muted)" }}>{date}</div>
        </div>
        <div style={{ fontSize: 12, fontWeight: 700, color: statusColor, textTransform: "capitalize" }}>
          {specialQuotaPath
            ? (language === "ar" ? "الحصة الخاصة متاحة" : "Special quota available")
            : status === "blocked" && requestableOverride
            ? t(language, "appointments.create.needsApproval")
            : status === "blocked"
            ? t(language, "appointments.create.notAvailable")
            : status === "available"
            ? t(language, "appointments.create.available")
            : status === "restricted"
            ? t(language, "appointments.create.needsApproval")
            : status === "full"
            ? (language === "ar" ? "مكتمل" : "Full")
            : status}
        </div>
      </div>
      <div style={{ marginTop: 8, marginBottom: 4 }}>
        <div
          style={{
            display: "grid",
            gridTemplateColumns: `repeat(${slotSegments.length}, minmax(0, 1fr))`,
            gap: 2,
            width: "100%",
            minHeight: 8
          }}
          aria-label="slot-capacity-progress"
        >
          {slotSegments.map((segment) => (
            <span
              key={segment.key}
              title={`${segment.category === "oncology" ? t(language, "appointments.create.oncology") : segment.category === "non_oncology" ? t(language, "appointments.create.nonOncology") : (language === "ar" ? "غير مصنّف" : "Uncategorized")} ${segment.isFilled ? (language === "ar" ? "ممتلئ" : "filled") : (language === "ar" ? "متبقٍ" : "remaining")} ${language === "ar" ? "خانة" : "slot"}`}
              style={{
                height: 8,
                borderRadius: 2,
                backgroundColor: segment.color
              }}
            />
          ))}
        </div>
      </div>

       {isBlockedLike ? (
         <div style={{ marginTop: 8, fontSize: 12, color: "var(--accent)" }}>{language === "ar" ? "محجوب" : "Blocked"}</div>
       ) : (
         <div style={{ marginTop: 8, fontSize: 12, color: "var(--text-muted)", display: "grid", gap: 2 }}>
          <div>
            {language === "ar" ? "الإجمالي" : "Total"}: {remainingCapacity ?? 0} / {dailyCapacity ?? 0} {language === "ar" ? "متبقٍ" : "remaining"}
          </div>
          {bucketMode === "partitioned" ? (
            <>
              <div>
                {t(language, "appointments.create.oncology")}: {oncologyFilled} {language === "ar" ? "ممتلئ" : "filled"}, {oncologyRemaining ?? 0} {language === "ar" ? "متبقٍ" : "remaining"}
                {oncologyReserved != null ? ` (${language === "ar" ? "محجوز" : "reserved"} ${oncologyReserved})` : ""}
              </div>
              <div>
                {t(language, "appointments.create.nonOncology")}: {nonOncologyFilled} {language === "ar" ? "ممتلئ" : "filled"}, {nonOncologyRemaining ?? 0} {language === "ar" ? "متبقٍ" : "remaining"}
                {nonOncologyReserved != null ? ` (${language === "ar" ? "محجوز" : "reserved"} ${nonOncologyReserved})` : ""}
              </div>
            </>
          ) : (
            <>
              <div>{language === "ar" ? "الوضع" : "Mode"}: {language === "ar" ? "الإجمالي فقط" : "Total-capacity only"}</div>
              <div>{language === "ar" ? "محجوز حسب الفئة" : "Booked by category"}: {t(language, "appointments.create.oncology")} {oncologyFilled}, {t(language, "appointments.create.nonOncology")} {nonOncologyFilled}</div>
            </>
          )}
          {specialQuotaRemaining != null && (
            <div>
              {language === "ar" ? "الحصة الخاصة" : "Special quota"}: {specialQuotaRemaining}{specialQuotaConfigured != null ? ` of ${specialQuotaConfigured}` : ""} {language === "ar" ? "متبقية" : "remaining"}
            </div>
          )}
           {primaryExamMixBlocking && (
             <div style={{ color: "var(--accent)", fontWeight: 600 }}>
               {language === "ar" ? "حظر المزيج الأساسي" : "Primary mix block"}: {primaryExamMixBlocking.title ?? `Group #${primaryExamMixBlocking.ruleId}`} ({primaryExamMixBlocking.consumed}/{primaryExamMixBlocking.dailyLimit})
             </div>
           )}
           {(examMixQuotaSummaries ?? []).length > 0 && (
             <div>
               {language === "ar" ? "مجموعات مزيج الفحوصات" : "Exam mix groups"}:{" "}
               {(examMixQuotaSummaries ?? [])
                 .map((group) => `${group.title ?? `#${group.ruleId}`} ${group.consumed}/${group.dailyLimit}${group.isPrimaryBlocking ? (language === "ar" ? " (أساسي)" : " (primary)") : ""}`)
                 .join(" • ")}
             </div>
           )}
           {matchedExamRuleSummary && (
             <div style={{ color: matchedExamRuleSummary.isBlocking ? "var(--accent)" : "var(--amber)", fontWeight: 600 }}>
               {language === "ar" ? "قاعدة الفحص" : "Exam rule"}: {matchedExamRuleSummary.title} ({matchedExamRuleSummary.effectLabel})
             </div>
           )}
        </div>
      )}

       {!!reasonText && (
         <div style={{ marginTop: 6, fontSize: 11, color: "var(--text-muted)" }}>{reasonText}</div>
       )}
    </button>
  );
}
