import { Badge } from "@/components/shared";
import { t } from "@/lib/i18n";
import { useLanguage } from "@/providers/language-provider";

type PatientCategory = "oncology" | "non_oncology" | null | undefined;

interface PatientCategoryBadgeProps {
  category: PatientCategory;
  showWhenUnset?: boolean;
  size?: "default" | "sm";
}

export function PatientCategoryBadge({
  category,
  showWhenUnset = false,
  size = "sm",
}: PatientCategoryBadgeProps) {
  const { language } = useLanguage();

  if (category === "oncology") {
    return (
      <Badge variant="error" size={size} style={{ fontWeight: 700 }}>
        {t(language, "appointments.create.oncology")}
      </Badge>
    );
  }

  if (category === "non_oncology") {
    return (
      <Badge variant="info" size={size}>
        {t(language, "appointments.create.nonOncology")}
      </Badge>
    );
  }

  if (!showWhenUnset) {
    return null;
  }

  return (
    <Badge variant="neutral" size={size}>
      {language === "ar" ? "غير محدد" : "Not set"}
    </Badge>
  );
}
