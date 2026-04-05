import PatientForm from "@/components/patients/patient-form";
import { useLanguage } from "@/providers/language-provider";

export default function PatientsPage() {
  const { t } = useLanguage();
  return (
    <div className="max-w-7xl mx-auto">
      <h2 className="text-2xl font-bold text-stone-900 dark:text-white mb-6">
        {t("patients.registerTitle")}
      </h2>
      <PatientForm mode="create" />
    </div>
  );
}
