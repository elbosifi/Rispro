import { useState, useEffect, type FormEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createPatient, searchPatients } from "@/lib/api-hooks";
import type { Patient } from "@/types/api";

interface RegistrationForm {
  arabicFullName: string;
  englishFullName: string;
  nationalId: string;
  nationalIdConfirmation: string;
  sex: string;
  estimatedDateOfBirth: string;
  ageYears: string;
  phone1: string;
  phone2: string;
  address: string;
}

const DEFAULT_FORM: RegistrationForm = {
  arabicFullName: "",
  englishFullName: "",
  nationalId: "",
  nationalIdConfirmation: "",
  sex: "",
  estimatedDateOfBirth: "",
  ageYears: "",
  phone1: "",
  phone2: "",
  address: ""
};

export default function PatientsPage() {
  const [form, setForm] = useState<RegistrationForm>(DEFAULT_FORM);
  const [duplicates, setDuplicates] = useState<Patient[]>([]);
  const [savedPatient, setSavedPatient] = useState<Patient | null>(null);
  const queryClient = useQueryClient();

  // Duplicate checking (search as user types name)
  const { data: potentialDuplicates } = useQuery({
    queryKey: ["duplicates", form.arabicFullName],
    queryFn: () => searchPatients(form.arabicFullName.slice(0, 10)),
    enabled: form.arabicFullName.length > 2,
    staleTime: 1000 * 30
  });

  useEffect(() => {
    if (potentialDuplicates && potentialDuplicates.length > 0) {
      setDuplicates(potentialDuplicates);
    } else {
      setDuplicates([]);
    }
  }, [potentialDuplicates]);

  const createMutation = useMutation({
    mutationFn: createPatient,
    onSuccess: (patient) => {
      setSavedPatient(patient);
      setForm(DEFAULT_FORM);
      queryClient.invalidateQueries({ queryKey: ["duplicates"] });
    }
  });

  // -- Derivations --
  // Derive DOB from National ID (Libyan format: 11 digits, digits 2-5 are year)
  const handleNationalIdChange = (id: string) => {
    const cleanId = id.replace(/\D/g, "");
    setForm((f) => {
      let updates: Partial<RegistrationForm> = { nationalId: cleanId };
      
      if (cleanId.length === 11) {
        const firstDigit = cleanId[0];
        updates.sex = firstDigit === "1" ? "M" : firstDigit === "2" ? "F" : f.sex;
        
        const yearStr = cleanId.slice(1, 5);
        const year = parseInt(yearStr, 10);
        if (year >= 1900 && year <= new Date().getFullYear()) {
          updates.estimatedDateOfBirth = `${year}-01-01`;
          updates.ageYears = (new Date().getFullYear() - year).toString();
        }
      }
      return { ...f, ...updates };
    });
  };

  // Derive Age from DOB
  const handleDobChange = (dob: string) => {
    setForm((f) => {
      let updates: Partial<RegistrationForm> = { estimatedDateOfBirth: dob };
      if (/^\d{4}-\d{2}-\d{2}$/.test(dob)) {
        const birthYear = parseInt(dob.slice(0, 4), 10);
        const currentYear = new Date().getFullYear();
        if (birthYear <= currentYear) {
          updates.ageYears = (currentYear - birthYear).toString();
        }
      }
      return { ...f, ...updates };
    });
  };

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();
    createMutation.mutate({
      arabicFullName: form.arabicFullName,
      englishFullName: form.englishFullName || undefined,
      nationalId: form.nationalId || undefined,
      nationalIdConfirmation: form.nationalIdConfirmation || undefined,
      sex: form.sex || undefined,
      estimatedDateOfBirth: form.estimatedDateOfBirth || undefined,
      ageYears: form.ageYears ? parseInt(form.ageYears, 10) : undefined,
      phone1: form.phone1,
      phone2: form.phone2 || undefined,
      address: form.address || undefined
    });
  };

  return (
    <div className="max-w-7xl mx-auto space-y-6">
      <h2 className="text-2xl font-bold text-stone-900 dark:text-white">
        Register Patient
      </h2>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Left: Form */}
        <div className="lg:col-span-2">
          <form
            onSubmit={handleSubmit}
            className="bg-white dark:bg-stone-800 rounded-xl border border-stone-200 dark:border-stone-700 shadow-sm p-6 space-y-6"
          >
            {/* Identity */}
            <div className="space-y-4">
              <h3 className="text-lg font-semibold text-stone-900 dark:text-white border-b pb-2">
                Identity
              </h3>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <Input
                  label="Arabic Full Name"
                  value={form.arabicFullName}
                  onChange={(v) => setForm((f) => ({ ...f, arabicFullName: v }))}
                  required
                  dir="rtl"
                />
                <Input
                  label="English Full Name"
                  value={form.englishFullName}
                  onChange={(v) => setForm((f) => ({ ...f, englishFullName: v }))}
                  dir="ltr"
                />
              </div>
            </div>

            {/* National ID & Demographics */}
            <div className="space-y-4">
              <h3 className="text-lg font-semibold text-stone-900 dark:text-white border-b pb-2">
                Demographics
              </h3>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <Input
                  label="National ID (11 digits)"
                  value={form.nationalId}
                  onChange={handleNationalIdChange}
                  maxLength={11}
                />
                <Input
                  label="Confirm National ID"
                  value={form.nationalIdConfirmation}
                  onChange={(v) => setForm((f) => ({ ...f, nationalIdConfirmation: v }))}
                  maxLength={11}
                />
                <Select
                  label="Sex"
                  value={form.sex}
                  onChange={(v) => setForm((f) => ({ ...f, sex: v }))}
                  options={[
                    { value: "", label: "Select..." },
                    { value: "M", label: "Male" },
                    { value: "F", label: "Female" }
                  ]}
                />
                <Input
                  label="Date of Birth"
                  value={form.estimatedDateOfBirth}
                  onChange={handleDobChange}
                  placeholder="YYYY-MM-DD"
                />
                <Input
                  label="Age"
                  value={form.ageYears}
                  onChange={(v) => setForm((f) => ({ ...f, ageYears: v }))}
                  type="number"
                />
              </div>
            </div>

            {/* Contact */}
            <div className="space-y-4">
              <h3 className="text-lg font-semibold text-stone-900 dark:text-white border-b pb-2">
                Contact
              </h3>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <Input
                  label="Phone 1 (Required)"
                  value={form.phone1}
                  onChange={(v) => setForm((f) => ({ ...f, phone1: v }))}
                  required
                />
                <Input
                  label="Phone 2"
                  value={form.phone2}
                  onChange={(v) => setForm((f) => ({ ...f, phone2: v }))}
                />
                <div className="md:col-span-2">
                  <Input
                    label="Address"
                    value={form.address}
                    onChange={(v) => setForm((f) => ({ ...f, address: v }))}
                  />
                </div>
              </div>
            </div>

            {createMutation.error && (
              <div className="p-3 rounded-lg bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 text-red-700 dark:text-red-400 text-sm">
                {createMutation.error.message}
              </div>
            )}

            <button
              type="submit"
              disabled={createMutation.isPending}
              className="w-full py-3 px-4 bg-teal-600 hover:bg-teal-700 disabled:bg-teal-400 text-white font-medium rounded-xl transition-colors"
            >
              {createMutation.isPending ? "Registering..." : "Register Patient"}
            </button>
          </form>
        </div>

        {/* Right: Sidebar */}
        <div className="space-y-6">
          {/* Duplicates */}
          {duplicates.length > 0 && (
            <div className="bg-amber-50 dark:bg-amber-900/20 rounded-xl border border-amber-200 dark:border-amber-800 p-4 space-y-3">
              <h3 className="text-sm font-semibold text-amber-800 dark:text-amber-300">
                Possible Duplicates
              </h3>
              <ul className="space-y-2">
                {duplicates.slice(0, 5).map((p) => (
                  <li key={p.id} className="text-sm text-stone-700 dark:text-stone-300 bg-white dark:bg-stone-800 p-2 rounded">
                    <p className="font-medium">{p.arabicFullName}</p>
                    <p className="text-xs text-stone-500">{p.nationalId || "No ID"} • {p.mrn}</p>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* Saved Patient */}
          {savedPatient && (
            <div className="bg-emerald-50 dark:bg-emerald-900/20 rounded-xl border border-emerald-200 dark:border-emerald-800 p-4">
              <h3 className="text-sm font-semibold text-emerald-800 dark:text-emerald-300 mb-2">
                Registered Successfully
              </h3>
              <div className="text-sm text-stone-700 dark:text-stone-300">
                <p className="font-medium">{savedPatient.arabicFullName}</p>
                <p className="text-xs text-stone-500 mt-1">MRN: {savedPatient.mrn}</p>
              </div>
              <button
                onClick={() => setSavedPatient(null)}
                className="mt-3 text-xs text-emerald-600 dark:text-emerald-400 hover:underline"
              >
                Dismiss
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function Input({
  label,
  value,
  onChange,
  required,
  type = "text",
  maxLength,
  placeholder,
  dir
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  required?: boolean;
  type?: string;
  maxLength?: number;
  placeholder?: string;
  dir?: "rtl" | "ltr";
}) {
  return (
    <div>
      <label className="block text-sm font-medium text-stone-700 dark:text-stone-300 mb-1">
        {label}
      </label>
      <input
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        required={required}
        maxLength={maxLength}
        placeholder={placeholder}
        dir={dir}
        className="w-full px-4 py-2 rounded-lg border bg-stone-50 dark:bg-stone-700 border-stone-300 dark:border-stone-600 text-stone-900 dark:text-white focus:ring-2 focus:ring-teal-500 outline-none"
      />
    </div>
  );
}

function Select({
  label,
  value,
  onChange,
  options
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: { value: string; label: string }[];
}) {
  return (
    <div>
      <label className="block text-sm font-medium text-stone-700 dark:text-stone-300 mb-1">
        {label}
      </label>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-full px-4 py-2 rounded-lg border bg-stone-50 dark:bg-stone-700 border-stone-300 dark:border-stone-600 text-stone-900 dark:text-white focus:ring-2 focus:ring-teal-500 outline-none"
      >
        {options.map((opt) => (
          <option key={opt.value} value={opt.value}>
            {opt.label}
          </option>
        ))}
      </select>
    </div>
  );
}
