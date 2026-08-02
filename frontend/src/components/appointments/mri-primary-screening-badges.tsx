import { TriangleAlert } from "lucide-react";
import { Badge } from "@/components/shared";

export type MriPrimaryScreeningResult =
  | "no_known_implant_reported"
  | "implant_reported_review_required";

interface MriPrimaryScreeningBadgesProps {
  result: MriPrimaryScreeningResult | null;
  expected?: boolean;
}

export function MriPrimaryScreeningBadges({ result, expected = true }: MriPrimaryScreeningBadgesProps) {
  if (!result) {
    return expected ? (
      <Badge variant="warning" className="inline-flex items-center gap-1.5">
        <TriangleAlert size={14} aria-hidden="true" />
        MRI primary screening not recorded
      </Badge>
    ) : null;
  }

  if (result === "no_known_implant_reported") {
    return <Badge variant="success">MRI primary screening complete — no implant reported</Badge>;
  }

  return (
    <span className="flex flex-wrap items-center gap-2">
      <Badge variant="success">MRI primary screening complete</Badge>
      <Badge variant="warning" className="inline-flex items-center gap-1.5">
        <TriangleAlert size={14} aria-hidden="true" />
        Implant reported — MRI staff review required
      </Badge>
    </span>
  );
}
