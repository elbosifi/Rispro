import { useState, useEffect, useRef, type FormEvent } from "react";
import { useNavigate } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createPatient, searchPatients, fetchNameDictionary, upsertNameDictionaryEntry } from "@/lib/api-hooks";
import { generateEnglishFromDictionary, type DictionaryEntry } from "@/lib/name-generation";
import {
  deriveDemographicsFromNationalId,
  calculateAgeFromDob,
  isValidNationalId
} from "@/lib/national-id";
import { LIBYAN_CITIES_SORTED as LIBYAN_CITIES } from "@/lib/libyan-cities";
import type { Patient } from "@/types/api";

type IdentifierType = "national_id" | "passport" | "other";

interface RegistrationForm {
  arabicFullName: string;
  englishFullName: string;
  identifierType: IdentifierType;
  identifierValue: string;
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
  identifierType: "national_id",
  identifierValue: "",
  nationalIdConfirmation: "",
  sex: "",
  estimatedDateOfBirth: "",
  ageYears: "",
  phone1: "",
  phone2: "",
  address: "benghazi"
};

export default function PatientsPage() {
  const [form, setForm] = useState<RegistrationForm>(DEFAULT_FORM);
  const [duplicates, setDuplicates] = useState<Patient[]>([]);
  const [savedPatient, setSavedPatient] = useState<Patient | null>(null);
  const [englishNameManuallyEdited, setEnglishNameManuallyEdited] = useState(false);
  const [missingTokenInputs, setMissingTokenInputs] = useState<Record<string, string>>({});
  const [addingToken, setAddingToken] = useState<string | null>(null);
  const [addTokenError, setAddTokenError] = useState<string | null>(null);
  // Locally-added dictionary entries (optimistic, merged with server dictionary)
  const [localDictionary, setLocalDictionary] = useState<DictionaryEntry[]>([]);
  const prevArabicNameRef = useRef(form.arabicFullName);
  const prevArabicTokenCountRef = useRef(0);
  const queryClient = useQueryClient();
  const nationalIdConfirmationRef = useRef<HTMLInputElement>(null);
  const navigate = useNavigate();

  // Load name dictionary
  const { data: dictData } = useQuery({
    queryKey: ["name-dictionary"],
    queryFn: fetchNameDictionary,
    staleTime: 1000 * 60 * 5
  });
  const serverDictionary: DictionaryEntry[] = dictData?.entries ?? [];
  // Merge server + local dictionary for all lookups
  const dictionary: DictionaryEntry[] = [...serverDictionary, ...localDictionary];

  // Determine the strongest search term for duplicate checking
  const duplicateSearchQuery = form.phone1 || form.arabicFullName || form.englishFullName || form.identifierValue || "";

  // Duplicate checking
  const { data: potentialDuplicates } = useQuery({
    queryKey: ["duplicates", duplicateSearchQuery],
    queryFn: () => searchPatients(duplicateSearchQuery),
    enabled: duplicateSearchQuery.length > 1,
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
      setEnglishNameManuallyEdited(false);
      setMissingTokenInputs({});
      setLocalDictionary([]);
      setAddTokenError(null);
      queryClient.invalidateQueries({ queryKey: ["duplicates"] });
    }
  });

  // -- Dictionary-based English name generation --
  const handleArabicNameChange = (value: string) => {
    const prevCount = prevArabicTokenCountRef.current;
    const tokens = value.trim().split(/\s+/).filter(Boolean);
    const currentCount = tokens.length;

    setForm((f) => {
      const updates: Partial<RegistrationForm> = { arabicFullName: value };
      // Update English name when a new token is completed
      if (!englishNameManuallyEdited && currentCount > prevCount) {
        const result = generateEnglishFromDictionary(value, dictionary);
        updates.englishFullName = result.englishName;
      }
      return { ...f, ...updates };
    });

    // Track token count for next keystroke
    prevArabicNameRef.current = value;
    prevArabicTokenCountRef.current = currentCount;
  };

  const handleEnglishNameChange = (value: string) => {
    setEnglishNameManuallyEdited(true);
    setForm((f) => ({ ...f, englishFullName: value }));
  };

  const handleRegenerateEnglishName = () => {
    setEnglishNameManuallyEdited(false);
    const result = generateEnglishFromDictionary(form.arabicFullName, dictionary);
    setForm((f) => ({ ...f, englishFullName: result.englishName }));
    // Also update missing tokens display
    if (result.missingTokens.length > 0) {
      setMissingTokenInputs((prev) => {
        const next = { ...prev };
        for (const token of result.missingTokens) {
          if (!next[token]) next[token] = "";
        }
        return next;
      });
    }
  };

  const handleMissingTokenEnglishChange = (token: string, value: string) => {
    setMissingTokenInputs((prev) => ({ ...prev, [token]: value }));
  };

  const handleAddTokenToDictionary = async (token: string) => {
    const englishValue = missingTokenInputs[token]?.trim();
    if (!englishValue) return;
    setAddingToken(token);
    setAddTokenError(null);
    try {
      const result = await upsertNameDictionaryEntry(token, englishValue);
      // Optimistically add to local dictionary so it disappears from missing tokens immediately
      const entry = result.entry;
      const newEntry: DictionaryEntry = {
        arabicText: entry.arabic_text ?? entry.arabicText ?? token,
        englishText: entry.english_text ?? entry.englishText ?? englishValue
      };
      setLocalDictionary((prev) => [...prev, newEntry]);
      // Remove from missing token inputs
      setMissingTokenInputs((prev) => {
        const next = { ...prev };
        delete next[token];
        return next;
      });
      // Regenerate English name — dictionary already includes the new entry
      const result2 = generateEnglishFromDictionary(form.arabicFullName, [...serverDictionary, ...localDictionary, newEntry]);
      setForm((f) => ({ ...f, englishFullName: result2.englishName }));
      queryClient.invalidateQueries({ queryKey: ["name-dictionary"] });
    } catch (err: any) {
      setAddTokenError(err?.message || "Failed to add token to dictionary");
    } finally {
      setAddingToken(null);
    }
  };

  // Compute current missing tokens
  const currentMissingTokens = form.arabicFullName
    ? generateEnglishFromDictionary(form.arabicFullName, dictionary).missingTokens
    : [];

  // -- National ID derivation --
  const handleIdentifierValueChange = (value: string) => {
    const cleanValue = value.replace(/\D/g, "");
    setForm((f) => {
      const updates: Partial<RegistrationForm> = { identifierValue: cleanValue };

      if (f.identifierType === "national_id" && isValidNationalId(cleanValue)) {
        const derived = deriveDemographicsFromNationalId(cleanValue);
        if (derived.sex) updates.sex = derived.sex;
        if (derived.estimatedDateOfBirth) updates.estimatedDateOfBirth = derived.estimatedDateOfBirth;
        if (derived.ageYears !== undefined) updates.ageYears = derived.ageYears.toString();
      }

      return { ...f, ...updates };
    });
  };

  useEffect(() => {
    if (form.identifierType === "national_id" && !isValidNationalId(form.identifierValue)) {
      // leave as-is; backend validates
    }
  }, [form.identifierValue, form.identifierType]);

  // -- DOB → Age recalculation --
  const handleDobChange = (dob: string) => {
    setForm((f) => {
      const updates: Partial<RegistrationForm> = { estimatedDateOfBirth: dob };
      if (/^\d{4}-\d{2}-\d{2}$/.test(dob)) {
        const age = calculateAgeFromDob(dob);
        if (age !== null) {
          updates.ageYears = age.toString();
        }
      }
      return { ...f, ...updates };
    });
  };

  // -- Prevent paste on National ID confirmation --
  const handleConfirmationPaste = (e: React.ClipboardEvent<HTMLInputElement>) => {
    e.preventDefault();
    e.stopPropagation();
  };

  const handleConfirmationDragOver = (e: React.DragEvent<HTMLInputElement>) => {
    e.preventDefault();
    e.stopPropagation();
  };

  const handleConfirmationDrop = (e: React.DragEvent<HTMLInputElement>) => {
    e.preventDefault();
    e.stopPropagation();
  };

  // -- Identifier type change --
  const handleIdentifierTypeChange = (type: string) => {
    setForm((f) => ({
      ...f,
      identifierType: type as IdentifierType,
      nationalIdConfirmation: "",
    }));
  };

  const isNationalId = form.identifierType === "national_id";

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();
    createMutation.mutate({
      arabicFullName: form.arabicFullName,
      englishFullName: form.englishFullName || undefined,
      identifierType: form.identifierType,
      identifierValue: form.identifierValue || undefined,
      nationalId: isNationalId ? form.identifierValue : undefined,
      nationalIdConfirmation: isNationalId ? form.nationalIdConfirmation : undefined,
      sex: form.sex || undefined,
      estimatedDateOfBirth: form.estimatedDateOfBirth || undefined,
      ageYears: form.ageYears ? parseInt(form.ageYears, 10) : undefined,
      phone1: form.phone1,
      phone2: form.phone2 || undefined,
      address: form.address || undefined,
      autoGenerateEnglish: !englishNameManuallyEdited && !form.englishFullName
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
                  onChange={handleArabicNameChange}
                  required
                  dir="rtl"
                />
                <div>
                  <Input
                    label="English Full Name"
                    value={form.englishFullName}
                    onChange={handleEnglishNameChange}
                    dir="ltr"
                  />
                  {form.arabicFullName && !englishNameManuallyEdited && (
                    <p className="mt-1 text-xs text-stone-500 dark:text-stone-400">
                      Generated from name dictionary.
                      <button
                        type="button"
                        onClick={handleRegenerateEnglishName}
                        className="ml-1 text-teal-600 dark:text-teal-400 hover:underline"
                      >
                        Regenerate
                      </button>
                    </p>
                  )}
                  {englishNameManuallyEdited && (
                    <p className="mt-1 text-xs text-amber-600 dark:text-amber-400">
                      Manually edited. Changes to Arabic name will not override this.
                    </p>
                  )}
                </div>
              </div>

              {/* Missing tokens panel */}
              {currentMissingTokens.length > 0 && (
                <div className="p-3 rounded-lg bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 space-y-2">
                  <p className="text-xs font-medium text-amber-800 dark:text-amber-300">
                    Unrecognized name tokens — add to dictionary:
                  </p>
                  {currentMissingTokens.map((token) => (
                    <div key={token} className="flex items-center gap-2">
                      <span className="text-sm text-stone-900 dark:text-white font-mono" dir="rtl">{token}</span>
                      <input
                        type="text"
                        value={missingTokenInputs[token] ?? ""}
                        onChange={(e) => handleMissingTokenEnglishChange(token, e.target.value)}
                        placeholder="English translation…"
                        className="flex-1 px-2 py-1 text-sm rounded border bg-white dark:bg-stone-700 border-stone-300 dark:border-stone-600 text-stone-900 dark:text-white focus:ring-1 focus:ring-teal-500 outline-none"
                      />
                      <button
                        type="button"
                        disabled={!missingTokenInputs[token]?.trim() || addingToken === token}
                        onClick={() => handleAddTokenToDictionary(token)}
                        className="px-2 py-1 text-xs bg-teal-600 hover:bg-teal-700 disabled:bg-teal-400 text-white rounded transition-colors"
                      >
                        {addingToken === token ? "Adding…" : "Add"}
                      </button>
                    </div>
                  ))}
                  {addTokenError && (
                    <p className="text-xs text-red-600 dark:text-red-400">{addTokenError}</p>
                  )}
                </div>
              )}

              {/* Identifier Type & Value */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <Select
                  label="Identifier Type"
                  value={form.identifierType}
                  onChange={handleIdentifierTypeChange}
                  options={[
                    { value: "national_id", label: "National ID (Libyan)" },
                    { value: "passport", label: "Passport" },
                    { value: "other", label: "Other" }
                  ]}
                />
                {isNationalId ? (
                  <Input
                    label="National ID (11 digits)"
                    value={form.identifierValue}
                    onChange={handleIdentifierValueChange}
                    maxLength={11}
                    placeholder="1xxxxxxxxxx"
                  />
                ) : (
                  <Input
                    label={form.identifierType === "passport" ? "Passport Number" : "Identifier Value"}
                    value={form.identifierValue}
                    onChange={(v) => setForm((f) => ({ ...f, identifierValue: v }))}
                    placeholder={form.identifierType === "passport" ? "AB1234567" : ""}
                  />
                )}
                {isNationalId && (
                  <Input
                    label="Confirm National ID"
                    value={form.nationalIdConfirmation}
                    onChange={(v) => setForm((f) => ({ ...f, nationalIdConfirmation: v.replace(/\D/g, "") }))}
                    maxLength={11}
                    ref={nationalIdConfirmationRef}
                    onPaste={handleConfirmationPaste}
                    onDragOver={handleConfirmationDragOver}
                    onDrop={handleConfirmationDrop}
                    placeholder="Re-type the National ID"
                  />
                )}
              </div>
            </div>

            {/* Demographics */}
            <div className="space-y-4">
              <h3 className="text-lg font-semibold text-stone-900 dark:text-white border-b pb-2">
                Demographics
              </h3>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
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
                  type="date"
                />
                <Input
                  label="Age (years)"
                  value={form.ageYears}
                  onChange={(v) => setForm((f) => ({ ...f, ageYears: v.replace(/\D/g, "") }))}
                  type="number"
                  min="0"
                  max="130"
                />
              </div>
              {isNationalId && isValidNationalId(form.identifierValue) && (
                <p className="text-xs text-teal-600 dark:text-teal-400">
                  Demographics auto-derived from National ID. You can override them manually.
                </p>
              )}
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
                  label="Phone 2 (Optional)"
                  value={form.phone2}
                  onChange={(v) => setForm((f) => ({ ...f, phone2: v }))}
                />
                <div className="md:col-span-2">
                  <Select
                    label="City"
                    value={form.address}
                    onChange={(v) => setForm((f) => ({ ...f, address: v }))}
                    options={[
                      { value: "", label: "Select a city..." },
                      ...LIBYAN_CITIES.map((c) => ({
                        value: c.code,
                        label: `${c.nameAr} / ${c.nameEn}`
                      }))
                    ]}
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
                Possible Duplicates ({duplicates.length})
              </h3>
              <ul className="space-y-2">
                {duplicates.slice(0, 5).map((p) => (
                  <li key={p.id} className="bg-white dark:bg-stone-800 rounded-lg border border-amber-200/50 dark:border-amber-800/50 overflow-hidden">
                    <div className="p-3 space-y-1">
                      <p className="font-medium text-sm text-stone-900 dark:text-white">{p.arabicFullName}</p>
                      {p.englishFullName && (
                        <p className="text-xs text-stone-500 dark:text-stone-400">{p.englishFullName}</p>
                      )}
                      <p className="text-xs text-stone-500 dark:text-stone-400">
                        {p.identifierValue || p.nationalId || "No ID"}
                        {p.identifierType && p.identifierType !== "national_id" && ` (${p.identifierType})`}
                        {" • "}MRN: {p.mrn || "—"}
                      </p>
                      {p.phone1 && (
                        <p className="text-xs text-stone-500 dark:text-stone-400">Phone: {p.phone1}</p>
                      )}
                      {p.address && (
                        <p className="text-xs text-stone-500 dark:text-stone-400">
                          City: {LIBYAN_CITIES.find((c) => c.code === p.address)?.nameEn || p.address}
                        </p>
                      )}
                    </div>
                    <button
                      type="button"
                      onClick={() => navigate(`/appointments?patientId=${p.id}`)}
                      className="w-full text-center py-2 px-3 bg-teal-50 dark:bg-teal-900/20 text-teal-700 dark:text-teal-300 text-xs font-medium hover:bg-teal-100 dark:hover:bg-teal-900/40 transition-colors border-t border-amber-200/50 dark:border-amber-800/50"
                    >
                      Create Appointment for this Patient
                    </button>
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
                {savedPatient.identifierValue && (
                  <p className="text-xs text-stone-500">
                    ID: {savedPatient.identifierType === "national_id" ? "National" : savedPatient.identifierType} — {savedPatient.identifierValue}
                  </p>
                )}
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

// -- Reusable Components --

function Input({
  label,
  value,
  onChange,
  required,
  type = "text",
  maxLength,
  placeholder,
  dir,
  min,
  max,
  onPaste,
  onDragOver,
  onDrop,
  ref
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  required?: boolean;
  type?: string;
  maxLength?: number;
  placeholder?: string;
  dir?: "rtl" | "ltr";
  min?: string;
  max?: string;
  onPaste?: React.ClipboardEventHandler<HTMLInputElement>;
  onDragOver?: React.DragEventHandler<HTMLInputElement>;
  onDrop?: React.DragEventHandler<HTMLInputElement>;
  ref?: React.RefObject<HTMLInputElement | null>;
}) {
  return (
    <div>
      <label className="block text-sm font-medium text-stone-700 dark:text-stone-300 mb-1">
        {label}
        {required && <span className="text-red-500 ml-1">*</span>}
      </label>
      <input
        ref={ref}
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        required={required}
        maxLength={maxLength}
        placeholder={placeholder}
        dir={dir}
        min={min}
        max={max}
        onPaste={onPaste}
        onDragOver={onDragOver}
        onDrop={onDrop}
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
  onChange: (v: IdentifierType | string) => void;
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
