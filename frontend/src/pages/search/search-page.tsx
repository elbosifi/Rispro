import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { searchPatients, deletePatient } from "@/lib/api-hooks";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { updatePatient } from "@/lib/api-hooks";
import type { Patient } from "@/types/api";
import { useLanguage } from "@/providers/language-provider";
import { t } from "@/lib/i18n";

export default function SearchPage() {
  const { language } = useLanguage();
  const [inputValue, setInputValue] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedPatient, setSelectedPatient] = useState<Patient | null>(null);
  const [isEditing, setIsEditing] = useState(false);
  const queryClient = useQueryClient();

  const { data: patients = [], isLoading } = useQuery({
    queryKey: ["patients", searchQuery],
    queryFn: () => searchPatients(searchQuery),
    enabled: searchQuery.length > 0,
    staleTime: 1000 * 60
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, payload }: { id: number; payload: Partial<Patient> }) =>
      updatePatient(id, payload),
    onSuccess: (updatedPatient) => {
      setSelectedPatient(updatedPatient);
      setIsEditing(false);
      // Refresh search results in case name changed
      queryClient.invalidateQueries({ queryKey: ["patients", searchQuery] });
    }
  });

  const deleteMutation = useMutation({
    mutationFn: (id: number) => deletePatient(id),
    onSuccess: () => {
      setSelectedPatient(null);
      setIsEditing(false);
      queryClient.invalidateQueries({ queryKey: ["patients", searchQuery] });
    }
  });

  const handleSelect = (patient: Patient) => {
    setSelectedPatient(patient);
    setIsEditing(false);
  };

  const handleSave = (payload: Partial<Patient>) => {
    if (selectedPatient) {
      updateMutation.mutate({ id: selectedPatient.id, payload });
    }
  };

  return (
    <div className="max-w-7xl mx-auto space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-2xl font-bold text-stone-900 dark:text-white">{t(language, "search.title")}</h2>
      </div>

      {/* Search Input */}
      <div className="bg-white dark:bg-stone-800 p-4 rounded-xl border border-stone-200 dark:border-stone-700 shadow-sm">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            // Trigger refetch manually or just rely on state change if we used a button
            // For now, let's use a button to trigger the query
          }}
          className="flex gap-4"
        >
          <input
            type="text"
            placeholder={t(language, "search.placeholder")}
            className="flex-1 px-4 py-3 rounded-xl border bg-stone-50 dark:bg-stone-700 border-stone-300 dark:border-stone-600 text-stone-900 dark:text-white focus:ring-2 focus:ring-teal-500 outline-none"
            value={inputValue}
            onChange={(e) => setInputValue(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                setSearchQuery(inputValue);
              }
            }}
          />
          <button
            type="submit"
            className="px-6 py-3 bg-teal-600 hover:bg-teal-700 text-white font-medium rounded-xl transition-colors"
          >
            {t(language, "search.searchBtn")}
          </button>
        </form>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Left: Results List */}
        <div className="lg:col-span-1 bg-white dark:bg-stone-800 rounded-xl border border-stone-200 dark:border-stone-700 shadow-sm overflow-hidden h-[600px] flex flex-col">
          <div className="p-4 border-b border-stone-200 dark:border-stone-700 bg-stone-50 dark:bg-stone-800/50">
            <h3 className="font-semibold text-stone-900 dark:text-white">
              {t(language, "search.results", { count: isLoading ? "..." : patients.length })}
            </h3>
            {searchQuery && (
              <p className="text-xs text-stone-500 dark:text-stone-400 mt-1">
                {t(language, "search.searchTerm", { q: searchQuery })}
              </p>
            )}
          </div>
          <div className="overflow-y-auto flex-1">
            {isLoading ? (
              <div className="p-4 text-center text-stone-500">{t(language, "search.searching")}</div>
            ) : patients.length === 0 ? (
              <div className="p-4 text-center text-stone-500">{t(language, "search.empty")}</div>
            ) : (
              <ul className="divide-y divide-stone-200 dark:divide-stone-700">
                {patients.map((p) => (
                  <li key={p.id}>
                    <button
                      onClick={() => handleSelect(p)}
                      className={`w-full text-right p-4 transition-colors hover:bg-stone-50 dark:hover:bg-stone-700/50 ${
                        selectedPatient?.id === p.id
                          ? "bg-teal-50 dark:bg-teal-900/20"
                          : ""
                      }`}
                    >
                      <p className="font-medium text-stone-900 dark:text-white">
                        {p.arabicFullName}
                      </p>
                      <p className="text-sm text-stone-500 dark:text-stone-400 mt-1">
                        {p.englishFullName || "—"}
                      </p>
                      <div className="flex items-center gap-2 mt-2 text-xs text-stone-400 dark:text-stone-500">
                        <span>ID: {p.nationalId || "—"}</span>
                        <span>•</span>
                        <span>MRN: {p.mrn || "—"}</span>
                      </div>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>

        {/* Right: Details / Edit */}
        <div className="lg:col-span-2">
          {selectedPatient ? (
            isEditing ? (
              <EditPatientForm
                patient={selectedPatient}
                onSave={handleSave}
                onCancel={() => setIsEditing(false)}
                onDelete={() => deleteMutation.mutate(selectedPatient.id)}
                isSaving={updateMutation.isPending}
                isDeleting={deleteMutation.isPending}
              />
            ) : (
              <PatientView
                patient={selectedPatient}
                onEdit={() => setIsEditing(true)}
              />
            )
          ) : (
            <div className="h-full flex items-center justify-center bg-white dark:bg-stone-800 rounded-xl border border-stone-200 dark:border-stone-700 p-8">
              <div className="text-center">
                <div className="text-4xl mb-4">👤</div>
                <h3 className="text-lg font-medium text-stone-900 dark:text-white">
                  {t(language, "search.selectPatient")}
                </h3>
                <p className="text-stone-500 dark:text-stone-400 mt-1">
                  {t(language, "search.selectPrompt")}
                </p>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function PatientView({ patient, onEdit }: { patient: Patient; onEdit: () => void }) {
  const { language } = useLanguage();
  return (
    <div className="bg-white dark:bg-stone-800 rounded-xl border border-stone-200 dark:border-stone-700 shadow-sm">
      <div className="p-6 border-b border-stone-200 dark:border-stone-700 flex justify-between items-center">
        <h3 className="text-xl font-bold text-stone-900 dark:text-white">{t(language, "search.detailsHeading")}</h3>
        <button
          onClick={onEdit}
          className="px-4 py-2 bg-teal-600 hover:bg-teal-700 text-white text-sm font-medium rounded-lg transition-colors"
        >
          {t(language, "search.editBtn")}
        </button>
      </div>
      <div className="p-6 grid grid-cols-1 md:grid-cols-2 gap-6">
        <Field label={t(language, "search.fieldArabicName")} value={patient.arabicFullName} />
        <Field label={t(language, "search.fieldEnglishName")} value={patient.englishFullName} />
        <Field label={t(language, "search.fieldNationalId")} value={patient.nationalId} />
        <Field label={t(language, "search.fieldMRN")} value={patient.mrn} />
        <Field label={t(language, "search.fieldSex")} value={patient.sex} />
        <Field label={t(language, "search.fieldAge")} value={patient.ageYears} />
        <Field label={t(language, "search.fieldDOB")} value={patient.estimatedDateOfBirth} />
        <Field label={t(language, "search.fieldPhone")} value={patient.phone1} />
        <div className="md:col-span-2">
          <Field label={t(language, "search.fieldAddress")} value={patient.address} />
        </div>
      </div>
    </div>
  );
}

function EditPatientForm({
  patient,
  onSave,
  onCancel,
  onDelete,
  isSaving,
  isDeleting
}: {
  patient: Patient;
  onSave: (p: Partial<Patient>) => void;
  onCancel: () => void;
  onDelete: () => void;
  isSaving: boolean;
  isDeleting: boolean;
}) {
  const { language } = useLanguage();
  const [form, setForm] = useState({
    arabicFullName: patient.arabicFullName || "",
    englishFullName: patient.englishFullName || "",
    nationalId: patient.nationalId || "",
    sex: patient.sex || "",
    ageYears: patient.ageYears?.toString() || "",
    estimatedDateOfBirth: patient.estimatedDateOfBirth || "",
    phone1: patient.phone1 || "",
    address: patient.address || ""
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    // Transform empty strings to undefined/null for the API
    const payload = Object.fromEntries(
      Object.entries(form).map(([k, v]) => [k, v === "" ? null : v])
    );
    onSave(payload);
  };

  return (
    <form
      onSubmit={handleSubmit}
      className="bg-white dark:bg-stone-800 rounded-xl border border-stone-200 dark:border-stone-700 shadow-sm"
    >
      <div className="p-6 border-b border-stone-200 dark:border-stone-700 flex justify-between items-center">
        <h3 className="text-xl font-bold text-stone-900 dark:text-white">{t(language, "patients.editTitle")}</h3>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => {
              if (window.confirm(t(language, "search.deleteConfirm"))) {
                onDelete();
              }
            }}
            disabled={isDeleting}
            className="px-4 py-2 bg-red-600 hover:bg-red-700 disabled:bg-red-400 text-white text-sm font-medium rounded-lg transition-colors"
          >
            {isDeleting ? t(language, "search.deleting") : t(language, "search.deleteBtn")}
          </button>
          <button
            type="button"
            onClick={onCancel}
            className="px-4 py-2 text-stone-700 dark:text-stone-300 hover:bg-stone-100 dark:hover:bg-stone-700 rounded-lg transition-colors"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={isSaving}
            className="px-4 py-2 bg-teal-600 hover:bg-teal-700 disabled:bg-teal-400 text-white text-sm font-medium rounded-lg transition-colors"
          >
            {isSaving ? t(language, "search.saving") : t(language, "search.saveBtn")}
          </button>
        </div>
      </div>
      <div className="p-6 grid grid-cols-1 md:grid-cols-2 gap-6">
        <InputField
          label={t(language, "search.fieldArabicName")}
          value={form.arabicFullName}
          onChange={(v) => setForm((f) => ({ ...f, arabicFullName: v }))}
          required
          dir="rtl"
        />
        <InputField
          label={t(language, "search.fieldEnglishName")}
          value={form.englishFullName || ""}
          onChange={(v) => setForm((f) => ({ ...f, englishFullName: v }))}
          dir="ltr"
        />
        <InputField
          label={t(language, "search.fieldNationalId")}
          value={form.nationalId || ""}
          onChange={(v) => setForm((f) => ({ ...f, nationalId: v }))}
        />
        <SelectField
          label={t(language, "search.fieldSex")}
          value={form.sex}
          onChange={(v) => setForm((f) => ({ ...f, sex: v }))}
          options={[
            { value: "", label: t(language, "search.selectLabel") },
            { value: "M", label: t(language, "search.male") },
            { value: "F", label: t(language, "search.female") }
          ]}
        />
        <InputField
          label={t(language, "search.fieldAge")}
          value={form.ageYears}
          onChange={(v) => setForm((f) => ({ ...f, ageYears: v }))}
          type="number"
        />
        <InputField
          label={t(language, "search.fieldDOBFormat")}
          value={form.estimatedDateOfBirth || ""}
          onChange={(v) => setForm((f) => ({ ...f, estimatedDateOfBirth: v }))}
        />
        <InputField
          label={t(language, "search.fieldPhone")}
          value={form.phone1}
          onChange={(v) => setForm((f) => ({ ...f, phone1: v }))}
          required
        />
        <InputField
          label={t(language, "search.fieldAddress")}
          value={form.address || ""}
          onChange={(v) => setForm((f) => ({ ...f, address: v }))}
          className="md:col-span-2"
        />
      </div>
    </form>
  );
}

function Field({ label, value }: { label: string; value: any }) {
  return (
    <div>
      <p className="text-sm font-medium text-stone-500 dark:text-stone-400">{label}</p>
      <p className="mt-1 text-stone-900 dark:text-white font-medium">
        {value ?? "—"}
      </p>
    </div>
  );
}

function InputField({
  label,
  value,
  onChange,
  required,
  type = "text",
  dir,
  className
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  required?: boolean;
  type?: string;
  dir?: "rtl" | "ltr";
  className?: string;
}) {
  return (
    <div className={className}>
      <label className="block text-sm font-medium text-stone-700 dark:text-stone-300 mb-1">
        {label}
      </label>
      <input
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        required={required}
        dir={dir}
        className="w-full px-4 py-2 rounded-lg border bg-stone-50 dark:bg-stone-700 border-stone-300 dark:border-stone-600 text-stone-900 dark:text-white focus:ring-2 focus:ring-teal-500 outline-none"
      />
    </div>
  );
}

function SelectField({
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
