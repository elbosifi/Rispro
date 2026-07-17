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
      <label className="block text-sm font-semibold mb-2 text-foreground">{t(language, "appointments.create.patient")}</label>
      <PatientSearch
        caseCategory={caseCategory}
        transliterateMissingEnglish
        onSelect={(patient) => {
          onSelectPatient({
            id: patient.id,
            arabicFullName: patient.arabicFullName,
            englishFullName: patient.englishFullName,
            category: patient.category,
            identifierType: patient.identifierType,
            identifierValue: patient.maskedPrimaryIdentifier ?? patient.identifierValue,
            nationalId: patient.nationalId,
            mrn: patient.mrn,
            sex: patient.sex,
            ageYears: patient.ageYears,
            demographicsEstimated: patient.demographicsEstimated,
            phone1: patient.phone1 ?? patient.phone ?? null,
            estimatedDateOfBirth: patient.estimatedDateOfBirth,
            identityRisk: patient.identityRisk,
            similarPatientCount: patient.similarPatientCount,
            availableVerificationMethods: patient.availableVerificationMethods,
            patientIdentityVerificationProof: patient.patientIdentityVerificationProof,
            patientIdentityVerificationMethod: patient.patientIdentityVerificationMethod,
            patientIdentitySelectionSource: patient.patientIdentitySelectionSource ?? "search",
          });
        }}
        selectedPatient={value}
        onClear={onClearPatient}
      />
    </div>
  );
}
