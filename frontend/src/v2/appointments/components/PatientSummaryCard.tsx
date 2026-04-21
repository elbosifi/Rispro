import { t } from "@/lib/i18n";
import { useLanguage } from "@/providers/language-provider";
import type { SelectedPatient } from "../hooks/useCreateAppointmentForm";

interface Props {
  patient: SelectedPatient | null;
  caseCategory: "oncology" | "non_oncology";
}

function renderSex(sex?: string | null, language: "ar" | "en" = "en"): string {
  if (!sex) return "—";
  if (sex.toUpperCase() === "M") return language === "ar" ? "ذكر" : "Male";
  if (sex.toUpperCase() === "F") return language === "ar" ? "أنثى" : "Female";
  return sex;
}

export function PatientSummaryCard({ patient, caseCategory }: Props) {
  const { language } = useLanguage();
  if (!patient) {
    return (
      <div className="card-shell p-3 sm:p-4">
        <p style={{ color: "var(--text-muted)" }}>{t(language, "appointments.create.noPatientSelected")}</p>
      </div>
    );
  }

  const fullName = patient.englishFullName || patient.arabicFullName;
  const primaryIdentifier = patient.identifierValue || patient.nationalId || patient.mrn || "—";

  return (
    <div className="card-shell p-3 sm:p-4">
      <div className="font-bold text-foreground">{fullName}</div>
      <div className="text-xs sm:text-sm mt-1 text-muted-foreground">{t(language, "appointments.create.primaryId")}: {primaryIdentifier}</div>
      <div className="flex flex-wrap gap-2 sm:gap-3 mt-2 text-xs sm:text-sm text-muted-foreground">
        <span>{t(language, "appointments.create.sex")}: {renderSex(patient.sex, language)}</span>
        <span>{t(language, "appointments.create.age")}: {patient.ageYears ?? "—"}{patient.demographicsEstimated ? (language === "ar" ? " (مقدّر)" : " (Estimated)") : ""}</span>
        <span>{t(language, "appointments.create.categoryLabel")}: {caseCategory === "oncology" ? t(language, "appointments.create.oncology") : t(language, "appointments.create.nonOncology")}</span>
      </div>
    </div>
  );
}
