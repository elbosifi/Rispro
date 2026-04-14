import { PatientSearch } from "./patient-search";
import type { SelectedPatient } from "../hooks/useCreateAppointmentForm";

interface Props {
  value: SelectedPatient | null;
  onSelectPatient: (patient: SelectedPatient) => void;
  onClearPatient: () => void;
}

export function PatientSearchSection({ value, onSelectPatient, onClearPatient }: Props) {
  return (
    <div>
      <label style={{ display: "block", fontSize: 12, fontWeight: 600, marginBottom: 6 }}>Patient</label>
      <PatientSearch
        onSelect={(patient) => {
          onSelectPatient({
            id: patient.id,
            arabicFullName: patient.arabicFullName,
            englishFullName: patient.englishFullName,
            nationalId: patient.nationalId,
            mrn: patient.mrn,
            sex: patient.sex,
            ageYears: patient.ageYears,
          });
        }}
        selectedPatient={value}
        onClear={onClearPatient}
      />
    </div>
  );
}
