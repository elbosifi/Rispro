import { t } from "@/lib/i18n";
import { useLanguage } from "@/providers/language-provider";
import { PatientSearch } from "./patient-search";
import type { SelectedPatient } from "../hooks/useCreateAppointmentForm";

interface Props {
  value: SelectedPatient | null;
  onSelectPatient: (patient: SelectedPatient) => void;
  onClearPatient: () => void;
  caseCategory: "oncology" | "non_oncology";
}

export function PatientSearchSection({ value, onSelectPatient, onClearPatient, caseCategory }: Props) {
  const { language } = useLanguage();
  return (
    <div>
      <label style={{ display: "block", fontSize: 12, fontWeight: 600, marginBottom: 6 }}>{t(language, "appointments.create.patient")}</label>
      <PatientSearch
        caseCategory={caseCategory}
        onSelect={(patient) => {
          onSelectPatient({
            id: patient.id,
            arabicFullName: patient.arabicFullName,
            englishFullName: patient.englishFullName,
            identifierType: patient.identifierType,
            identifierValue: patient.identifierValue,
            nationalId: patient.nationalId,
            mrn: patient.mrn,
            sex: patient.sex,
            ageYears: patient.ageYears,
            demographicsEstimated: patient.demographicsEstimated,
          });
        }}
        selectedPatient={value}
        onClear={onClearPatient}
      />
    </div>
  );
}
