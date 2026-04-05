import { useNavigate, useParams } from "react-router-dom";
import PatientForm from "@/components/patients/patient-form";
import { useLanguage } from "@/providers/language-provider";

export default function EditPatientPage() {
  const navigate = useNavigate();
  const { t } = useLanguage();
  const { id } = useParams<{ id: string }>();
  const patientId = id ? parseInt(id, 10) : undefined;

  if (!patientId || isNaN(patientId)) {
    return <div className="p-8 text-center text-red-500">{t("patients.invalidId")}</div>;
  }

  return (
    <div className="max-w-7xl mx-auto space-y-6">
      <div className="flex items-center gap-4">
        <button
          onClick={() => navigate("/patients")}
          className="px-4 py-2 bg-stone-100 dark:bg-stone-700 hover:bg-stone-200 dark:hover:bg-stone-600 text-stone-700 dark:text-stone-300 font-medium rounded-lg transition-colors text-sm"
        >
          {t("common.back")} - {t("patients.backToPatients")}
        </button>
        <h2 className="text-2xl font-bold text-stone-900 dark:text-white">{t("patients.editTitle")}</h2>
      </div>
      <PatientForm mode="edit" patientId={patientId} onCancel={() => navigate("/patients")} />
    </div>
  );
}
