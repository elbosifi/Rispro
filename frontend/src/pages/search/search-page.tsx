import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { searchPatients, deletePatient } from "@/lib/api-hooks";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { updatePatient } from "@/lib/api-hooks";
import type { Patient } from "@/types/api";
import { useLanguage } from "@/providers/language-provider";
import { t } from "@/lib/i18n";
import { Search, User, Save, Trash2, X, Pencil } from "lucide-react";

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
      {/* Page Header */}
      <div className="flex items-center gap-3">
        <div className="w-10 h-10 rounded-lg flex items-center justify-center" style={{ background: "var(--accent)" }}>
          <Search className="w-5 h-5 text-white" />
        </div>
        <div>
          <h2 className="text-xl font-bold text-embossed" style={{ color: "var(--text)" }}>
            {t(language, "search.title")}
          </h2>
          <p className="mt-1 text-xs font-mono-data" style={{ color: "var(--text-muted)" }}>
            {t(language, "search.placeholder")}
          </p>
        </div>
      </div>

      {/* Search Input */}
      <div className="card-shell relative p-4">
        {/* Corner screws */}
        <div className="absolute top-3 left-3 w-1.5 h-1.5 rounded-full" style={{ background: "radial-gradient(circle at 35% 35%, rgba(0,0,0,0.18) 1.5px, transparent 2px)" }} />
        <div className="absolute top-3 right-3 w-1.5 h-1.5 rounded-full" style={{ background: "radial-gradient(circle at 35% 35%, rgba(0,0,0,0.18) 1.5px, transparent 2px)" }} />
        <div className="absolute bottom-3 left-3 w-1.5 h-1.5 rounded-full" style={{ background: "radial-gradient(circle at 35% 35%, rgba(0,0,0,0.18) 1.5px, transparent 2px)" }} />
        <div className="absolute bottom-3 right-3 w-1.5 h-1.5 rounded-full" style={{ background: "radial-gradient(circle at 35% 35%, rgba(0,0,0,0.18) 1.5px, transparent 2px)" }} />

        <form
          onSubmit={(e) => {
            e.preventDefault();
            setSearchQuery(inputValue);
          }}
          className="flex gap-4"
        >
          <input
            type="text"
            placeholder={t(language, "search.placeholder")}
            className="input-premium flex-1 px-4 py-3 rounded-lg outline-none font-mono-data"
            style={{ color: "var(--text)" }}
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
            className="btn-primary px-6 py-3 rounded-lg font-medium flex items-center gap-2 transition-all"
          >
            <Search className="w-4 h-4" />
            {t(language, "search.searchBtn")}
          </button>
        </form>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Left: Results List */}
        <div className="lg:col-span-1 card-shell overflow-hidden h-[600px] flex flex-col">
          <div className="p-4 flex items-center justify-between" style={{ borderBottom: "1px solid var(--border)", background: "var(--foreground)" }}>
            <h3 className="text-sm font-semibold text-embossed" style={{ color: "var(--text)" }}>
              {t(language, "search.results", { count: isLoading ? "..." : patients.length })}
            </h3>
            {searchQuery && (
              <span className="text-xs font-mono-data" style={{ color: "var(--text-muted)" }}>
                {t(language, "search.searchTerm", { q: searchQuery })}
              </span>
            )}
          </div>
          <div className="overflow-y-auto flex-1">
            {isLoading ? (
              <div className="p-4 text-center font-mono-data" style={{ color: "var(--text-muted)" }}>{t(language, "search.searching")}</div>
            ) : patients.length === 0 ? (
              <div className="p-4 text-center font-mono-data" style={{ color: "var(--text-muted)" }}>{t(language, "search.empty")}</div>
            ) : (
              <ul className="divide-y" >
                {patients.map((p) => (
                  <li key={p.id}>
                    <button
                      onClick={() => handleSelect(p)}
                      className={`w-full text-right p-4 transition-colors ${
                        selectedPatient?.id === p.id
                          ? ""
                          : ""
                      }`}
                      style={{
                        background: selectedPatient?.id === p.id ? "var(--foreground)" : "transparent",
                      }}
                      onMouseEnter={(e) => {
                        if (selectedPatient?.id !== p.id) {
                          (e.currentTarget as HTMLElement).style.background = "var(--foreground)";
                        }
                      }}
                      onMouseLeave={(e) => {
                        if (selectedPatient?.id !== p.id) {
                          (e.currentTarget as HTMLElement).style.background = "transparent";
                        }
                      }}
                    >
                      <p className="font-medium" style={{ color: "var(--text)" }}>
                        {p.arabicFullName}
                      </p>
                      <p className="text-sm font-mono-data mt-1" style={{ color: "var(--text-muted)" }}>
                        {p.englishFullName || "—"}
                      </p>
                      <div className="flex items-center gap-2 mt-2 text-xs font-mono-data" style={{ color: "var(--text-muted)", opacity: 0.7 }}>
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
            <div className="h-full card-shell flex items-center justify-center p-8">
              <div className="text-center">
                <div className="w-16 h-16 rounded-full mx-auto mb-4 flex items-center justify-center" style={{ background: "var(--shadow-recessed)" }}>
                  <User className="w-8 h-8" style={{ color: "var(--text-muted)" }} />
                </div>
                <h3 className="text-lg font-semibold text-embossed" style={{ color: "var(--text)" }}>
                  {t(language, "search.selectPatient")}
                </h3>
                <p className="text-sm font-mono-data mt-1" style={{ color: "var(--text-muted)" }}>
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
    <div className="card-shell">
      <div className="p-6 flex justify-between items-center" style={{ borderBottom: "1px solid var(--border)" }}>
        <h3 className="text-lg font-bold text-embossed" style={{ color: "var(--text)" }}>{t(language, "search.detailsHeading")}</h3>
        <button
          onClick={onEdit}
          className="btn-secondary px-4 py-2 rounded-lg text-sm font-medium flex items-center gap-2 transition-all"
        >
          <Pencil className="w-3.5 h-3.5" />
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
      className="card-shell"
    >
      <div className="p-6 flex justify-between items-center" style={{ borderBottom: "1px solid var(--border)" }}>
        <h3 className="text-lg font-bold text-embossed" style={{ color: "var(--text)" }}>{t(language, "patients.editTitle")}</h3>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => {
              if (window.confirm(t(language, "search.deleteConfirm"))) {
                onDelete();
              }
            }}
            disabled={isDeleting}
            className="px-4 py-2 rounded-lg text-sm font-medium flex items-center gap-1.5 transition-all disabled:opacity-50"
            style={{ background: "var(--accent)", color: "#fff" }}
          >
            <Trash2 className="w-3.5 h-3.5" />
            {isDeleting ? t(language, "search.deleting") : t(language, "search.deleteBtn")}
          </button>
          <button
            type="button"
            onClick={onCancel}
            className="btn-ghost px-4 py-2 rounded-lg text-sm font-medium flex items-center gap-1.5 transition-all"
          >
            <X className="w-3.5 h-3.5" />
            Cancel
          </button>
          <button
            type="submit"
            disabled={isSaving}
            className="btn-primary px-4 py-2 rounded-lg text-sm font-medium flex items-center gap-1.5 transition-all disabled:opacity-50"
          >
            <Save className="w-3.5 h-3.5" />
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
      <p className="text-xs font-mono-data uppercase tracking-[0.06em]" style={{ color: "var(--text-muted)" }}>{label}</p>
      <p className="mt-1 font-mono-data" style={{ color: "var(--text)" }}>
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
      <label className="block text-xs font-mono-data uppercase tracking-[0.06em] mb-1" style={{ color: "var(--text-muted)" }}>
        {label}
      </label>
      <input
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        required={required}
        dir={dir}
        className="input-premium w-full px-4 py-2 rounded-lg outline-none font-mono-data"
        style={{ color: "var(--text)" }}
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
      <label className="block text-xs font-mono-data uppercase tracking-[0.06em] mb-1" style={{ color: "var(--text-muted)" }}>
        {label}
      </label>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="input-premium w-full px-4 py-2 rounded-lg outline-none font-mono-data"
        style={{ color: "var(--text)" }}
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
