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
}

export function MriPrimaryScreeningBadges({ result, expected = true }: MriPrimaryScreeningBadgesProps) {
  const { language } = useLanguage();

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
