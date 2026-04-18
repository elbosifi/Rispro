import type { SelectedPatient } from "../hooks/useCreateAppointmentForm";

interface Props {
  patient: SelectedPatient | null;
  caseCategory: "oncology" | "non_oncology";
}

function renderSex(sex?: string | null): string {
  if (!sex) return "—";
  if (sex.toUpperCase() === "M") return "Male";
  if (sex.toUpperCase() === "F") return "Female";
  return sex;
}

export function PatientSummaryCard({ patient, caseCategory }: Props) {
  if (!patient) {
    return (
      <div className="card-shell p-4">
        <p style={{ color: "var(--text-muted)" }}>No patient selected.</p>
      </div>
    );
  }

  const fullName = patient.englishFullName || patient.arabicFullName;
  const primaryIdentifier = patient.identifierValue || patient.nationalId || patient.mrn || "—";

  return (
    <div className="card-shell p-4">
      <div className="font-bold" style={{ color: "var(--text)" }}>{fullName}</div>
      <div className="text-xs mt-1" style={{ color: "var(--text-muted)" }}>Primary ID: {primaryIdentifier}</div>
      <div className="flex flex-wrap gap-3 mt-2 text-xs" style={{ color: "var(--text-muted)" }}>
        <span>Sex: {renderSex(patient.sex)}</span>
        <span>Age: {patient.ageYears ?? "—"}{patient.demographicsEstimated ? " (Estimated)" : ""}</span>
        <span>Category: {caseCategory === "oncology" ? "Oncology" : "Non-Oncology"}</span>
      </div>
    </div>
  );
}
