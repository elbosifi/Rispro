import "@/components/shared/compact-controls.css";
import { Button } from "@/components/shared";
import { useLocation, useNavigate, useParams } from "react-router-dom";
import PatientForm from "@/components/patients/patient-form";
import { useLanguage } from "@/providers/language-provider";
import { safeInternalReturnTo } from "@/lib/navigation/patient-navigation";

export default function EditPatientPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const { t } = useLanguage();
  const { id } = useParams<{ id: string }>();
  const patientId = id ? parseInt(id, 10) : undefined;
  const returnTo = safeInternalReturnTo(new URLSearchParams(location.search).get("returnTo"));

  if (!patientId || isNaN(patientId)) {
    return <div className="p-8 text-center text-red-500">{t("patients.invalidId")}</div>;
  }

  return (
    <div className="max-w-7xl mx-auto space-y-5">
      <div className="compact-controls flex flex-wrap items-center gap-4">
        <Button variant="secondary" size="sm"
          onClick={() => navigate(returnTo)}
          className="text-sm"
        >
          {t("patients.backToPatients")}
        </Button>
        <h2 className="text-2xl font-semibold text-foreground">{t("patients.editTitle")}</h2>
      </div>
      <PatientForm mode="edit" patientId={patientId} onCancel={() => navigate(returnTo)} onSuccess={() => navigate(returnTo)} />
    </div>
  );
}
