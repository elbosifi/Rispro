import { Badge, BadgeCheck } from "lucide-react";
import { t } from "@/lib/i18n";
import { useLanguage } from "@/providers/language-provider";

interface PatientIdentityBadgeProps {
  verified?: boolean | null;
  showUnverified?: boolean;
  size?: number;
}

export function PatientIdentityBadge({
  verified,
  showUnverified = true,
  size = 18,
}: PatientIdentityBadgeProps) {
  const { language } = useLanguage();

  if (verified) {
    const label = t(language, "patients.identity.verified");

    return (
      <BadgeCheck
        size={size}
        className="inline-block shrink-0 text-[#1D9BF0]"
        aria-label={label}
        role="img"
      >
        <title>{label}</title>
      </BadgeCheck>
    );
  }

  if (!showUnverified) return null;

  const label = t(language, "patients.identity.notVerified");

  return (
    <Badge
      size={size}
      className="inline-block shrink-0 text-muted-foreground/60"
      aria-label={label}
      role="img"
    >
      <title>{label}</title>
    </Badge>
  );
}
