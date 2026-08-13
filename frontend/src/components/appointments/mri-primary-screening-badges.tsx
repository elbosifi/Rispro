import { TriangleAlert } from "lucide-react";
import { Badge } from "@/components/shared";
import { t } from "@/lib/i18n";
import { useLanguage } from "@/providers/language-provider";

export type MriPrimaryScreeningResult =
  | "no_known_implant_reported"
  | "implant_reported_review_required";

interface MriPrimaryScreeningBadgesProps {
  result: MriPrimaryScreeningResult | null;
  expected?: boolean;
  compact?: boolean;
}

export function MriPrimaryScreeningBadges({ result, expected = true, compact = false }: MriPrimaryScreeningBadgesProps) {
  const { language } = useLanguage();

  if (compact) {
    if (!result) {
      return expected ? (
        <span aria-label="Primary MRI screening not recorded — complete screening before MRI examination." title="Primary MRI screening not recorded — complete screening before MRI examination." className="inline-flex h-7 min-w-7 items-center justify-center rounded border-2 border-amber-500 px-0.5 text-[10px] font-bold leading-none text-amber-700">MR?</span>
      ) : null;
    }

    if (result === "no_known_implant_reported") {
      return <span aria-label="Primary MRI screening complete — no known implant/device reported." title="Primary MRI screening complete — no known implant/device reported." className="inline-flex h-7 w-7 items-center justify-center rounded-sm border-2 border-emerald-600 text-[10px] font-bold leading-none text-emerald-700">MR</span>;
    }

    return (
      <span aria-label="MR safety review required — implant/device reported during primary screening. Verify device MR status before scanning." title="MR safety review required — implant/device reported during primary screening. Verify device MR status before scanning." className="relative inline-flex h-7 w-7 items-center justify-center text-amber-600">
        <TriangleAlert size={28} strokeWidth={2.25} aria-hidden="true" />
        <span className="absolute top-[11px] text-[8px] font-bold leading-none">MR</span>
      </span>
    );
  }

  if (!result) {
    return expected ? (
      <Badge variant="warning" className="inline-flex max-w-full items-center gap-1.5 whitespace-normal text-start leading-snug">
        <TriangleAlert size={14} className="shrink-0" aria-hidden="true" />
        {t(language, "appointments.create.safety.badgeMissing")}
      </Badge>
    ) : null;
  }

  if (result === "no_known_implant_reported") {
    return (
      <Badge variant="success" className="inline-flex max-w-full whitespace-normal text-start leading-snug">
        {t(language, "appointments.create.safety.badgeNoImplant")}
      </Badge>
    );
  }

  return (
    <span className="flex max-w-full flex-wrap items-center gap-2">
      <Badge variant="success" className="inline-flex max-w-full whitespace-normal text-start leading-snug">
        {t(language, "appointments.create.safety.badgeComplete")}
      </Badge>
      <Badge variant="warning" className="inline-flex max-w-full items-center gap-1.5 whitespace-normal text-start leading-snug">
        <TriangleAlert size={14} className="shrink-0" aria-hidden="true" />
        {t(language, "appointments.create.safety.badgeReviewRequired")}
      </Badge>
    </span>
  );
}
