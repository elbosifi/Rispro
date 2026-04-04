import PatientForm from "@/components/patients/patient-form";

export default function PatientsPage() {
  return (
    <div className="max-w-7xl mx-auto">
      <h2 className="text-2xl font-bold text-stone-900 dark:text-white mb-6">
        Register Patient
      </h2>
      <PatientForm mode="create" />
    </div>
  );
}
