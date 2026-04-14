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
      <div style={{ border: "1px solid var(--border-color, #e2e8f0)", borderRadius: 8, padding: 12, color: "var(--text-muted, #64748b)" }}>
        No patient selected.
      </div>
    );
  }

  const fullName = patient.englishFullName || patient.arabicFullName;
  const primaryIdentifier = patient.nationalId || patient.mrn || "—";

  return (
    <div style={{ border: "1px solid var(--border-color, #e2e8f0)", borderRadius: 8, padding: 12, background: "var(--bg-surface, #fff)" }}>
      <div style={{ fontWeight: 700 }}>{fullName}</div>
      <div style={{ fontSize: 12, color: "var(--text-muted, #64748b)", marginTop: 4 }}>Primary ID: {primaryIdentifier}</div>
      <div style={{ display: "flex", gap: 12, marginTop: 8, fontSize: 12 }}>
        <span>Sex: {renderSex(patient.sex)}</span>
        <span>Age: {patient.ageYears ?? "—"}</span>
        <span>Category: {caseCategory === "oncology" ? "Oncology" : "Non-Oncology"}</span>
      </div>
    </div>
  );
}
