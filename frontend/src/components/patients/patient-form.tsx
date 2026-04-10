import { useState, useEffect, useRef, type FormEvent } from "react";
import { createPortal } from "react-dom";
import { useNavigate } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  createPatient,
  searchPatients,
  fetchNameDictionary,
  upsertNameDictionaryEntry,
  fetchPatientById,
  updatePatient,
  deletePatient
} from "@/lib/api-hooks";
import { generateEnglishFromDictionary, type DictionaryEntry } from "@/lib/name-generation";
import {
  deriveDemographicsFromNationalId,
  calculateAgeFromDob,
  isValidNationalId
} from "@/lib/national-id";
import { LIBYAN_CITIES_SORTED as LIBYAN_CITIES } from "@/lib/libyan-cities";
import { formatDateLy } from "@/lib/date-format";
import { DateInput } from "@/components/common/date-input";
import type { Patient } from "@/types/api";

type IdentifierType = "national_id" | "passport" | "other";
type PatientFormMode = "create" | "edit";

interface PatientFormState {
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
  identifiers: Array<{ typeCode: IdentifierType; value: string; isPrimary: boolean }>;
}

const DEFAULT_FORM: PatientFormState = {
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
  address: "benghazi",
  identifiers: [{ typeCode: "national_id", value: "", isPrimary: true }]
};

function patientToForm(p: Patient): PatientFormState {
  const dob = p.estimatedDateOfBirth
    ? (p.estimatedDateOfBirth.includes("T") ? p.estimatedDateOfBirth.slice(0, 10) : p.estimatedDateOfBirth)
    : "";

  const rawSex = p.sex || "";
  const sex = rawSex === "male" ? "M" : rawSex === "female" ? "F" : rawSex;

  const identifiers: Array<{ typeCode: IdentifierType; value: string; isPrimary: boolean }> =
    Array.isArray((p as any).identifiers) && (p as any).identifiers.length > 0
      ? (p as any).identifiers.map((entry: Record<string, unknown>) => ({
          typeCode: ((entry.typeCode ?? entry.type_code ?? p.identifierType ?? "national_id") as IdentifierType),
          value: String(entry.value ?? ""),
          isPrimary: Boolean(entry.isPrimary ?? entry.is_primary)
        }))
      : [
          {
            typeCode: ((p.identifierType as IdentifierType) || "national_id"),
            value: p.identifierValue || p.nationalId || "",
            isPrimary: true
          }
        ];

  const primary = identifiers.find((entry) => entry.isPrimary) || identifiers[0];

  return {
    arabicFullName: p.arabicFullName || "",
    englishFullName: p.englishFullName || "",
    identifierType: primary?.typeCode || "national_id",
    identifierValue: primary?.value || "",
    nationalIdConfirmation: "",
    sex,
    estimatedDateOfBirth: dob,
    ageYears: p.ageYears ? String(p.ageYears) : "",
    phone1: p.phone1 || "",
    phone2: p.phone2 || "",
    address: p.address || "",
    identifiers
  };
}

interface PatientFormProps {
  mode: PatientFormMode;
  patientId?: number;
  onSuccess?: (patient: Patient) => void;
  onCancel?: () => void;
}

export default function PatientForm({ mode, patientId, onSuccess, onCancel }: PatientFormProps) {
  const isEdit = mode === "edit";
  const [form, setForm] = useState<PatientFormState>(DEFAULT_FORM);
  // Track original national ID to know if it was edited (edit mode only)
  const [originalNationalId, setOriginalNationalId] = useState("");
  const [duplicates, setDuplicates] = useState<Patient[]>([]);
  const [previewPatient, setPreviewPatient] = useState<Patient | null>(null);
  const [englishNameManuallyEdited, setEnglishNameManuallyEdited] = useState(false);
  const [toast, setToast] = useState<{ message: string; type: "success" | "error" } | null>(null);
  const [postCreatePatient, setPostCreatePatient] = useState<Patient | null>(null);
  const showToast = (message: string, type: "success" | "error" = "success") => {
    setToast({ message, type });
    setTimeout(() => setToast(null), 4500);
  };
  const [missingTokenInputs, setMissingTokenInputs] = useState<Record<string, string>>({});
  const [addingToken, setAddingToken] = useState<string | null>(null);
  const [addTokenError, setAddTokenError] = useState<string | null>(null);
  const [localDictionary, setLocalDictionary] = useState<DictionaryEntry[]>([]);
  const prevArabicTokenCountRef = useRef(0);
  const queryClient = useQueryClient();
  const nationalIdConfirmationRef = useRef<HTMLInputElement>(null);
  const navigate = useNavigate();

  // Dictionary
  const { data: dictData } = useQuery({
    queryKey: ["name-dictionary"],
    queryFn: fetchNameDictionary,
    staleTime: 1000 * 60 * 5
  });
  const serverDictionary: DictionaryEntry[] = dictData?.entries ?? [];
  const dictionary: DictionaryEntry[] = [...serverDictionary, ...localDictionary];

  // Load patient for edit
  const { data: existingPatient, isLoading: loadingPatient } = useQuery({
    queryKey: ["patient-by-id", patientId],
    queryFn: () => fetchPatientById(patientId!),
    enabled: isEdit && !!patientId,
    staleTime: 1000 * 30
  });

  useEffect(() => {
    if (existingPatient) {
      const formState = patientToForm(existingPatient);
      setForm(formState);
      setOriginalNationalId(formState.identifierType === "national_id" ? formState.identifierValue : "");
      if (existingPatient.englishFullName) setEnglishNameManuallyEdited(true);
      prevArabicTokenCountRef.current = existingPatient.arabicFullName
        ? existingPatient.arabicFullName.trim().split(/\s+/).filter(Boolean).length
        : 0;
    }
  }, [existingPatient]);

  // Duplicate checking (create only)
  const dupQuery = !isEdit ? form.phone1 || form.arabicFullName || form.englishFullName || form.identifierValue || "" : "";
  const { data: potentialDuplicates } = useQuery({
    queryKey: ["duplicates", dupQuery],
    queryFn: () => searchPatients(dupQuery),
    enabled: !isEdit && dupQuery.length > 1,
    staleTime: 1000 * 30
  });
  useEffect(() => {
    if (potentialDuplicates && potentialDuplicates.length > 0) {
      const filtered = isEdit ? potentialDuplicates.filter((p) => p.id !== patientId) : potentialDuplicates;
      setDuplicates(filtered);
    } else {
      setDuplicates([]);
    }
  }, [potentialDuplicates, isEdit, patientId]);

  // Mutations
  const createMutation = useMutation({
    mutationFn: createPatient,
    onSuccess: (patient) => {
      setForm(DEFAULT_FORM);
      setEnglishNameManuallyEdited(false);
      setMissingTokenInputs({});
      setLocalDictionary([]);
      setAddTokenError(null);
      prevArabicTokenCountRef.current = 0;
      queryClient.invalidateQueries({ queryKey: ["duplicates"] });
      showToast(`Patient registered: ${patient.arabicFullName} (MRN: ${patient.mrn})`);
      if (!isEdit) {
        setPostCreatePatient(patient);
      }
      onSuccess?.(patient);
    }
  });
  const updateMutation = useMutation({
    mutationFn: (data: Partial<Patient>) => updatePatient(patientId!, data),
    onSuccess: (patient) => {
      queryClient.invalidateQueries({ queryKey: ["patient-by-id", patientId] });
      showToast(`Patient updated: ${patient.arabicFullName}`);
      onSuccess?.(patient);
    }
  });
  const deleteMutation = useMutation({
    mutationFn: () => deletePatient(patientId!),
    onSuccess: () => {
      showToast("Patient deleted");
      queryClient.invalidateQueries();
      onCancel?.();
    },
    onError: (err: any) => {
      showToast(err?.message || "Could not delete patient", "error");
    }
  });
  const mutation = isEdit ? updateMutation : createMutation;

  // Handlers
  const handleArabicNameChange = (value: string) => {
    const prevEndsWithSpace = form.arabicFullName.endsWith(" ");
    const nowEndsWithSpace = value.endsWith(" ");
    const nowTokens = value.trim().split(/\s+/).filter(Boolean);
    const tokenJustCompleted = !prevEndsWithSpace && nowEndsWithSpace;
    const arabicNameChanged = value !== form.arabicFullName;

    setForm((f) => {
      const u: Partial<PatientFormState> = { arabicFullName: value };
      // In edit mode: if Arabic name changed, reset manual flag so transliteration works
      if (isEdit && arabicNameChanged && englishNameManuallyEdited) {
        setEnglishNameManuallyEdited(false);
      }
      // Generate English only when a token is completed (space typed after word)
      if (!englishNameManuallyEdited && tokenJustCompleted) {
        u.englishFullName = generateEnglishFromDictionary(value, dictionary).englishName;
      }
      return { ...f, ...u };
    });
    prevArabicTokenCountRef.current = nowTokens.length;
  };

  const handleEnglishNameChange = (v: string) => {
    setEnglishNameManuallyEdited(true);
    setForm((f) => ({ ...f, englishFullName: v }));
  };

  const handleRegenerateEnglishName = () => {
    setEnglishNameManuallyEdited(false);
    const r = generateEnglishFromDictionary(form.arabicFullName, dictionary);
    setForm((f) => ({ ...f, englishFullName: r.englishName }));
    if (r.missingTokens.length > 0) {
      setMissingTokenInputs((p) => {
        const n = { ...p };
        for (const t of r.missingTokens) if (!n[t]) n[t] = "";
        return n;
      });
    }
  };

  const handleAddTokenToDictionary = async (token: string) => {
    const ev = missingTokenInputs[token]?.trim();
    if (!ev) return;
    setAddingToken(token);
    setAddTokenError(null);
    try {
      const res = await upsertNameDictionaryEntry(token, ev);
      const e = res.entry as Record<string, unknown>;
      const ne: DictionaryEntry = {
        arabicText: String(e.arabic_text ?? e.arabicText ?? token),
        englishText: String(e.english_text ?? e.englishText ?? ev)
      };
      setLocalDictionary((p) => [...p, ne]);
      setMissingTokenInputs((p) => { const n = { ...p }; delete n[token]; return n; });
      const r = generateEnglishFromDictionary(form.arabicFullName, [...serverDictionary, ...localDictionary, ne]);
      setForm((f) => ({ ...f, englishFullName: r.englishName }));
      queryClient.invalidateQueries({ queryKey: ["name-dictionary"] });
    } catch (err: any) {
      setAddTokenError(err?.message || "Failed to add token to dictionary");
    } finally {
      setAddingToken(null);
    }
  };

  const handleIdentifierValueChange = (value: string) => {
    const cv = value.replace(/\D/g, "");
    setForm((f) => {
      const nextIdentifiers = [...f.identifiers];
      if (nextIdentifiers.length === 0) {
        nextIdentifiers.push({ typeCode: f.identifierType, value: cv, isPrimary: true });
      } else {
        nextIdentifiers[0] = { ...nextIdentifiers[0], typeCode: f.identifierType, value: cv, isPrimary: true };
      }

      const u: Partial<PatientFormState> = { identifierValue: cv, identifiers: nextIdentifiers };
      if (f.identifierType === "national_id" && isValidNationalId(cv)) {
        const d = deriveDemographicsFromNationalId(cv);
        if (d.sex) u.sex = d.sex;
        if (d.estimatedDateOfBirth) u.estimatedDateOfBirth = d.estimatedDateOfBirth;
        if (d.ageYears !== undefined) u.ageYears = d.ageYears.toString();
      }
      return { ...f, ...u };
    });
  };

  const handleDobChange = (dob: string) => {
    setForm((f) => {
      const u: Partial<PatientFormState> = { estimatedDateOfBirth: dob };
      if (/^\d{4}-\d{2}-\d{2}$/.test(dob)) {
        const a = calculateAgeFromDob(dob);
        if (a !== null) u.ageYears = a.toString();
      }
      return { ...f, ...u };
    });
  };

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();
    const primaryCount = form.identifiers.filter((entry) => entry.isPrimary).length;
    if (primaryCount !== 1) {
      showToast("Exactly one primary identifier is required.", "error");
      return;
    }
    const isNat = form.identifierType === "national_id";
    const isNationalIdComplete = isValidNationalId(form.identifierValue);
    const requiresNationalIdConfirmation = isNat && nationalIdWasEdited && isNationalIdComplete;
    // Confirmation is mandatory when it's shown (create mode or national ID was edited)
    if (requiresNationalIdConfirmation && form.nationalIdConfirmation.length === 0) {
      return;
    }
    if (requiresNationalIdConfirmation && form.identifierValue !== form.nationalIdConfirmation) {
      return;
    }
    const payload = {
      arabicFullName: form.arabicFullName,
      englishFullName: form.englishFullName || undefined,
      identifierType: form.identifierType,
      identifierValue: form.identifierValue || undefined,
      nationalId: isNat ? form.identifierValue : undefined,
      nationalIdConfirmation: isNat ? form.nationalIdConfirmation : undefined,
      sex: form.sex || undefined,
      estimatedDateOfBirth: form.estimatedDateOfBirth || undefined,
      ageYears: form.ageYears ? parseInt(form.ageYears, 10) : undefined,
      phone1: form.phone1,
      phone2: form.phone2 || undefined,
      address: form.address || undefined,
      autoGenerateEnglish: !englishNameManuallyEdited && !form.englishFullName,
      identifiers: form.identifiers
        .map((entry) => ({
          typeCode: entry.typeCode,
          value: entry.value.trim(),
          isPrimary: entry.isPrimary
        }))
        .filter((entry) => entry.value)
    };
    mutation.mutate(payload);
  };

  const currentMissingTokens = form.arabicFullName
    ? (() => {
        // Only consider completed tokens (those followed by a space)
        const parts = form.arabicFullName.split(" ");
        // Remove the last part if it doesn't end with space (user still typing it)
        if (!form.arabicFullName.endsWith(" ")) parts.pop();
        const completedTokens = parts.filter(Boolean);
        const result = generateEnglishFromDictionary(completedTokens.join(" "), dictionary);
        return result.missingTokens;
      })()
    : [];
  const isNationalId = form.identifierType === "national_id";
  // Show confirmation only in create mode, or in edit mode when national ID was changed
  const nationalIdWasEdited = isEdit ? form.identifierValue !== originalNationalId : true;
  const showConfirmation = isNationalId && nationalIdWasEdited && isValidNationalId(form.identifierValue);
  const submitLabel = mutation.isPending
    ? (isEdit ? "Updating…" : "Registering…")
    : (isEdit ? "Update Patient" : "Register Patient");

  if (isEdit && loadingPatient) {
    return <div className="p-8 text-center text-stone-500">Loading patient data…</div>;
  }

  // ============================================================
  // Shared form fields JSX (rendered in both create and edit)
  // ============================================================
  const formFields = (
    <form onSubmit={handleSubmit} className="bg-white dark:bg-stone-800 rounded-xl border border-stone-200 dark:border-stone-700 shadow-sm p-6 space-y-6">
      {/* Identity */}
      <div className="space-y-4">
        <h3 className="text-lg font-semibold text-stone-900 dark:text-white border-b pb-2">Identity</h3>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <Input label="Arabic Full Name" value={form.arabicFullName} onChange={handleArabicNameChange} onBlur={() => { if (form.arabicFullName && !form.arabicFullName.endsWith(" ")) handleArabicNameChange(form.arabicFullName + " "); }} required dir="rtl" />
          <div>
            <Input label="English Full Name" value={form.englishFullName} onChange={handleEnglishNameChange} dir="ltr" />
            {form.arabicFullName && !englishNameManuallyEdited && (
              <p className="mt-1 text-xs text-stone-500 dark:text-stone-400">
                Generated from name dictionary.
                <button type="button" onClick={handleRegenerateEnglishName} className="ml-1 text-teal-600 dark:text-teal-400 hover:underline">Regenerate</button>
              </p>
            )}
            {englishNameManuallyEdited && (
              <p className="mt-1 text-xs text-amber-600 dark:text-amber-400">Manually edited. Changes to Arabic name will not override this.</p>
            )}
          </div>
        </div>

        {currentMissingTokens.length > 0 && (
          <div className="p-3 rounded-lg bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 space-y-2">
            <p className="text-xs font-medium text-amber-800 dark:text-amber-300">Unrecognized name tokens — add to dictionary:</p>
            {currentMissingTokens.map((token) => (
              <div key={token} className="flex items-center gap-2">
                <span className="text-sm text-stone-900 dark:text-white font-mono" dir="rtl">{token}</span>
                <input type="text" value={missingTokenInputs[token] ?? ""} onChange={(e) => setMissingTokenInputs((p) => ({ ...p, [token]: e.target.value }))} placeholder="English translation…" className="flex-1 px-2 py-1 text-sm rounded border bg-white dark:bg-stone-700 border-stone-300 dark:border-stone-600 text-stone-900 dark:text-white focus:ring-1 focus:ring-teal-500 outline-none" />
                <button type="button" disabled={!missingTokenInputs[token]?.trim() || addingToken === token} onClick={() => handleAddTokenToDictionary(token)} className="px-2 py-1 text-xs bg-teal-600 hover:bg-teal-700 disabled:bg-teal-400 text-white rounded transition-colors">
                  {addingToken === token ? "Adding…" : "Add"}
                </button>
              </div>
            ))}
            {addTokenError && <p className="text-xs text-red-600 dark:text-red-400">{addTokenError}</p>}
          </div>
        )}

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <Select label="Identifier Type" value={form.identifierType} onChange={(v) => setForm((f) => {
            const nextIdentifiers = [...f.identifiers];
            if (nextIdentifiers.length === 0) {
              nextIdentifiers.push({ typeCode: v as IdentifierType, value: f.identifierValue, isPrimary: true });
            } else {
              nextIdentifiers[0] = { ...nextIdentifiers[0], typeCode: v as IdentifierType, isPrimary: true };
            }
            return { ...f, identifierType: v as IdentifierType, identifiers: nextIdentifiers, nationalIdConfirmation: "" };
          })} options={[{ value: "national_id", label: "National ID (Libyan)" }, { value: "passport", label: "Passport" }, { value: "other", label: "Other" }]} />
          {isNationalId ? (
            <Input label="National ID (12 digits)" value={form.identifierValue} onChange={handleIdentifierValueChange} maxLength={12} placeholder="1xxxxxxxxxxx" />
          ) : (
            <Input label={form.identifierType === "passport" ? "Passport Number" : "Identifier Value"} value={form.identifierValue} onChange={(v) => setForm((f) => {
              const nextIdentifiers = [...f.identifiers];
              if (nextIdentifiers.length === 0) {
                nextIdentifiers.push({ typeCode: f.identifierType, value: v, isPrimary: true });
              } else {
                nextIdentifiers[0] = { ...nextIdentifiers[0], typeCode: f.identifierType, value: v, isPrimary: true };
              }
              return { ...f, identifierValue: v, identifiers: nextIdentifiers };
            })} placeholder={form.identifierType === "passport" ? "AB1234567" : ""} />
          )}
          {showConfirmation && (
            <Input label="Confirm National ID" value={form.nationalIdConfirmation} onChange={(v) => setForm((f) => ({ ...f, nationalIdConfirmation: v.replace(/\D/g, "") }))} maxLength={12} ref={nationalIdConfirmationRef} onPaste={(e) => { e.preventDefault(); e.stopPropagation(); }} onDragOver={(e) => { e.preventDefault(); e.stopPropagation(); }} onDrop={(e) => { e.preventDefault(); e.stopPropagation(); }} placeholder="Re-type the National ID" required={nationalIdWasEdited} />
          )}
        </div>
        <div className="space-y-2 rounded-lg border border-stone-200 dark:border-stone-700 p-3">
          <div className="flex items-center justify-between">
            <p className="text-xs font-medium text-stone-700 dark:text-stone-300">Additional Identifiers</p>
            <button
              type="button"
              className="text-xs text-teal-600 dark:text-teal-300 underline"
              onClick={() =>
                setForm((f) => ({
                  ...f,
                  identifiers: [
                    ...f.identifiers,
                    { typeCode: "other", value: "", isPrimary: false }
                  ]
                }))
              }
            >
              Add identifier
            </button>
          </div>
          {form.identifiers.map((entry, idx) => (
            <div key={`identifier-${idx}`} className="grid grid-cols-1 md:grid-cols-4 gap-2 items-center">
              <select
                value={entry.typeCode}
                onChange={(e) =>
                  setForm((f) => {
                    const next = [...f.identifiers];
                    next[idx] = { ...next[idx], typeCode: e.target.value as IdentifierType };
                    if (idx === 0) {
                      return { ...f, identifiers: next, identifierType: e.target.value as IdentifierType };
                    }
                    return { ...f, identifiers: next };
                  })
                }
                className="px-2 py-1.5 rounded border bg-white dark:bg-stone-800 border-stone-300 dark:border-stone-600 text-stone-900 dark:text-white text-sm"
              >
                <option value="national_id">National ID</option>
                <option value="passport">Passport</option>
                <option value="other">Other</option>
              </select>
              <input
                value={entry.value}
                onChange={(e) =>
                  setForm((f) => {
                    const next = [...f.identifiers];
                    next[idx] = { ...next[idx], value: e.target.value };
                    if (idx === 0) {
                      return { ...f, identifiers: next, identifierValue: e.target.value };
                    }
                    return { ...f, identifiers: next };
                  })
                }
                placeholder="Identifier value"
                className="md:col-span-2 px-2 py-1.5 rounded border bg-white dark:bg-stone-800 border-stone-300 dark:border-stone-600 text-stone-900 dark:text-white text-sm"
              />
              <div className="flex items-center gap-2">
                <label className="inline-flex items-center gap-1 text-xs text-stone-600 dark:text-stone-300">
                  <input
                    type="radio"
                    checked={entry.isPrimary}
                    onChange={() =>
                      setForm((f) => {
                        const nextIdentifiers = f.identifiers.map((item, itemIdx) => ({
                          ...item,
                          isPrimary: itemIdx === idx
                        }));
                        const primary = nextIdentifiers[idx] || nextIdentifiers[0];
                        return {
                          ...f,
                          identifiers: nextIdentifiers,
                          identifierType: (primary?.typeCode || f.identifierType) as IdentifierType,
                          identifierValue: primary?.value || ""
                        };
                      })
                    }
                  />
                  Primary
                </label>
                {idx > 0 && (
                  <button
                    type="button"
                    className="text-xs text-red-600 dark:text-red-400 underline"
                    onClick={() =>
                      setForm((f) => {
                        const next = f.identifiers.filter((_, itemIdx) => itemIdx !== idx);
                        if (next.length > 0 && !next.some((x) => x.isPrimary)) {
                          next[0] = { ...next[0], isPrimary: true };
                        }
                        return { ...f, identifiers: next };
                      })
                    }
                  >
                    Remove
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Demographics */}
      <div className="space-y-4">
        <h3 className="text-lg font-semibold text-stone-900 dark:text-white border-b pb-2">Demographics</h3>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <Select label="Sex" value={form.sex} onChange={(v) => setForm((f) => ({ ...f, sex: v }))} options={[{ value: "", label: "Select..." }, { value: "M", label: "Male" }, { value: "F", label: "Female" }]} />
          <DateInput label="Date of Birth" value={form.estimatedDateOfBirth} onChange={handleDobChange} />
          <Input label="Age (years)" value={form.ageYears} onChange={(v) => setForm((f) => ({ ...f, ageYears: v.replace(/\D/g, "") }))} type="number" min="0" max="130" />
        </div>
        {isNationalId && isValidNationalId(form.identifierValue) && (
          <p className="text-xs text-teal-600 dark:text-teal-400">Demographics auto-derived from National ID. You can override them manually.</p>
        )}
      </div>

      {/* Contact */}
      <div className="space-y-4">
        <h3 className="text-lg font-semibold text-stone-900 dark:text-white border-b pb-2">Contact</h3>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <Input label="Phone 1 (Required)" value={form.phone1} onChange={(v) => setForm((f) => ({ ...f, phone1: v }))} required />
          <Input label="Phone 2 (Optional)" value={form.phone2} onChange={(v) => setForm((f) => ({ ...f, phone2: v }))} />
          <div className="md:col-span-2">
            <Select label="City" value={form.address} onChange={(v) => setForm((f) => ({ ...f, address: v }))} options={[{ value: "", label: "Select a city..." }, ...LIBYAN_CITIES.map((c) => ({ value: c.code, label: `${c.nameAr} / ${c.nameEn}` }))]} />
          </div>
        </div>
      </div>

      {/* Actions */}
      <div className="flex gap-3">
        {isEdit && (
          <button
            type="button"
            onClick={() => {
              if (window.confirm("Delete this patient? This cannot be undone.")) {
                deleteMutation.mutate();
              }
            }}
            disabled={deleteMutation.isPending || mutation.isPending}
            className="flex-1 py-3 px-4 bg-red-600 hover:bg-red-700 disabled:bg-red-400 text-white font-medium rounded-xl transition-colors"
          >
            {deleteMutation.isPending ? "Deleting..." : "Delete Patient"}
          </button>
        )}
        {isEdit && onCancel && (
          <button type="button" onClick={onCancel} className="flex-1 py-3 px-4 bg-stone-100 dark:bg-stone-700 hover:bg-stone-200 dark:hover:bg-stone-600 text-stone-700 dark:text-stone-300 font-medium rounded-xl transition-colors">Cancel</button>
        )}
        <button type="submit" disabled={mutation.isPending} className="flex-1 py-3 px-4 bg-teal-600 hover:bg-teal-700 disabled:bg-teal-400 text-white font-medium rounded-xl transition-colors">{submitLabel}</button>
      </div>
      {mutation.error && (
        <div className="p-3 rounded-lg bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 text-red-700 dark:text-red-400 text-sm">{mutation.error.message}</div>
      )}
    </form>
  );

  // ============================================================
  // Layout: Create mode (form + sidebar) vs Edit mode (form only)
  // ============================================================
  if (!isEdit) {
    return (
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2">{formFields}</div>
        <div className="space-y-6">
          {duplicates.length > 0 && (
            <div className="bg-amber-50 dark:bg-amber-900/20 rounded-xl border border-amber-200 dark:border-amber-800 p-4 space-y-3">
              <h3 className="text-sm font-semibold text-amber-800 dark:text-amber-300">Possible Duplicates ({duplicates.length})</h3>
              <ul className="space-y-2">
                {duplicates.slice(0, 5).map((p) => (
                  <li key={p.id} className="bg-white dark:bg-stone-800 rounded-lg border border-amber-200/50 dark:border-amber-800/50 overflow-hidden">
                    <button type="button" onClick={() => setPreviewPatient(p)} className="w-full p-3 space-y-1 text-right hover:bg-stone-50 dark:hover:bg-stone-700/50 transition-colors">
                      <p className="font-medium text-sm text-stone-900 dark:text-white">{p.arabicFullName}</p>
                      {p.englishFullName && <p className="text-xs text-stone-500 dark:text-stone-400">{p.englishFullName}</p>}
                      <p className="text-xs text-stone-500 dark:text-stone-400">{p.identifierValue || p.nationalId || "No ID"}{p.identifierType && p.identifierType !== "national_id" && ` (${p.identifierType})`}{" • "}MRN: {p.mrn || "—"}</p>
                      {p.phone1 && <p className="text-xs text-stone-500 dark:text-stone-400">Phone: {p.phone1}</p>}
                      {p.address && <p className="text-xs text-stone-500 dark:text-stone-400">City: {LIBYAN_CITIES.find((c) => c.code === p.address)?.nameEn || p.address}</p>}
                    </button>
                    <div className="flex gap-2 border-t border-amber-200/50 dark:border-amber-800/50">
                      <button type="button" onClick={() => navigate(`/patients/${p.id}/edit`)} className="flex-1 text-center py-2 px-2 bg-amber-50 dark:bg-amber-900/20 text-amber-700 dark:text-amber-300 text-xs font-medium hover:bg-amber-100 dark:hover:bg-amber-900/40 transition-colors">Edit Patient</button>
                      <button type="button" onClick={() => navigate(`/appointments?patientId=${p.id}`)} className="flex-1 text-center py-2 px-2 bg-teal-50 dark:bg-teal-900/20 text-teal-700 dark:text-teal-300 text-xs font-medium hover:bg-teal-100 dark:hover:bg-teal-900/40 transition-colors">Create Appointment</button>
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* Patient Preview Modal */}
          {previewPatient && (
            <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={(e) => { if (e.target === e.currentTarget) setPreviewPatient(null); }}>
              <div className="bg-white dark:bg-stone-800 rounded-xl border border-stone-200 dark:border-stone-700 shadow-xl w-full max-w-md mx-4 p-6 space-y-3">
                <div className="flex items-center justify-between">
                  <h3 className="text-lg font-semibold text-stone-900 dark:text-white">Patient Details</h3>
                  <button onClick={() => setPreviewPatient(null)} className="text-stone-400 hover:text-stone-600 dark:hover:text-stone-200">✕</button>
                </div>
                <div className="space-y-2 text-sm">
                  <Field label="Arabic Name" value={previewPatient.arabicFullName} />
                  {previewPatient.englishFullName && <Field label="English Name" value={previewPatient.englishFullName} />}
                  <Field label="Identifier" value={`${previewPatient.identifierValue || previewPatient.nationalId || "No ID"}${previewPatient.identifierType && previewPatient.identifierType !== "national_id" ? ` (${previewPatient.identifierType})` : ""}`} />
                  <Field label="MRN" value={previewPatient.mrn || "—"} />
                  <Field label="Sex" value={previewPatient.sex === "M" ? "Male" : previewPatient.sex === "F" ? "Female" : previewPatient.sex} />
                  <Field label="Age" value={previewPatient.ageYears ? `${previewPatient.ageYears} years` : "—"} />
                  <Field label="DOB" value={previewPatient.estimatedDateOfBirth ? formatDateLy(previewPatient.estimatedDateOfBirth) : "—"} />
                  <Field label="Phone" value={previewPatient.phone1 || "—"} />
                  {previewPatient.phone2 && <Field label="Phone 2" value={previewPatient.phone2} />}
                  {previewPatient.address && <Field label="City" value={LIBYAN_CITIES.find((c) => c.code === previewPatient.address)?.nameEn || previewPatient.address} />}
                </div>
                <div className="flex gap-2 pt-2">
                  <button onClick={() => navigate(`/patients/${previewPatient.id}/edit`)} className="flex-1 py-2 px-4 bg-amber-100 dark:bg-amber-900/30 text-amber-800 dark:text-amber-300 font-medium rounded-lg hover:bg-amber-200 dark:hover:bg-amber-900/50 transition-colors text-sm">Edit</button>
                  <button onClick={() => navigate(`/appointments?patientId=${previewPatient.id}`)} className="flex-1 py-2 px-4 bg-teal-100 dark:bg-teal-900/30 text-teal-800 dark:text-teal-300 font-medium rounded-lg hover:bg-teal-200 dark:hover:bg-teal-900/50 transition-colors text-sm">Create Appointment</button>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    );
  }

  // Edit mode: form only (toast handles success)
  if (isEdit) {
    return (
      <>
        {formFields}
        {toast && <Toast message={toast.message} type={toast.type} onClose={() => setToast(null)} />}
      </>
    );
  }

  return (
    <>
      {formFields}
      {toast && <Toast message={toast.message} type={toast.type} onClose={() => setToast(null)} />}
      {postCreatePatient &&
        createPortal(
          <div
            className="fixed inset-0 z-[200] flex items-center justify-center bg-black/55 px-4"
            onClick={(e) => {
              if (e.target === e.currentTarget) setPostCreatePatient(null);
            }}
          >
            <div className="w-full max-w-lg rounded-3xl border border-stone-200 dark:border-stone-700 bg-white dark:bg-stone-800 p-6 shadow-2xl">
              <div className="text-center space-y-3">
                <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-teal-100 dark:bg-teal-900/30 text-teal-700 dark:text-teal-300">
                  <svg className="h-7 w-7" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                  </svg>
                </div>
                <h3 className="text-xl font-bold text-stone-900 dark:text-white">Patient registered</h3>
                <p className="text-sm text-stone-600 dark:text-stone-300">
                  Book an appointment for {postCreatePatient.arabicFullName} now?
                </p>
              </div>
              <div className="mt-6 flex flex-col sm:flex-row gap-3">
                <button
                  type="button"
                  onClick={() => setPostCreatePatient(null)}
                  className="flex-1 rounded-xl border border-stone-200 dark:border-stone-700 px-4 py-3 text-sm font-semibold text-stone-700 dark:text-stone-300 hover:bg-stone-50 dark:hover:bg-stone-700/50 transition-colors"
                >
                  Not now
                </button>
                <button
                  type="button"
                  onClick={() => navigate(`/appointments?patientId=${postCreatePatient.id}`)}
                  className="flex-1 rounded-xl bg-teal-600 px-4 py-3 text-sm font-semibold text-white hover:bg-teal-700 transition-colors"
                >
                  Book appointment
                </button>
              </div>
            </div>
          </div>,
          document.body
        )}
    </>
  );
}

// -- Sub-components --

function Input({ label, value, onChange, required, type = "text", maxLength, placeholder, dir, min, max, onPaste, onDragOver, onDrop, onBlur, ref }: {
  label: string; value: string; onChange: (v: string) => void; required?: boolean; type?: string; maxLength?: number; placeholder?: string; dir?: "rtl" | "ltr"; min?: string; max?: string; onPaste?: React.ClipboardEventHandler<HTMLInputElement>; onDragOver?: React.DragEventHandler<HTMLInputElement>; onDrop?: React.DragEventHandler<HTMLInputElement>; onBlur?: () => void; ref?: React.RefObject<HTMLInputElement | null>;
}) {
  const directionClass = dir === "rtl" ? "input-rtl" : "input-ltr";
  return (
    <div>
      <label className="block text-sm font-medium text-stone-700 dark:text-stone-300 mb-1">{label}{required && <span className="text-red-500 ml-1">*</span>}</label>
      <input ref={ref} type={type} value={value} onChange={(e) => onChange(e.target.value)} required={required} maxLength={maxLength} placeholder={placeholder} dir={dir} min={min} max={max} onPaste={onPaste} onDragOver={onDragOver} onDrop={onDrop} onBlur={onBlur} className={`input-premium w-full ${directionClass}`} />
    </div>
  );
}

function Select({ label, value, onChange, options }: { label: string; value: string; onChange: (v: IdentifierType | string) => void; options: { value: string; label: string }[] }) {
  return (
    <div>
      <label className="block text-sm font-medium text-stone-700 dark:text-stone-300 mb-1">{label}</label>
      <select value={value} onChange={(e) => onChange(e.target.value)} className="input-premium input-ltr w-full">
        {options.map((opt) => (<option key={opt.value} value={opt.value}>{opt.label}</option>))}
      </select>
    </div>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between items-baseline py-1 border-b border-stone-100 dark:border-stone-700 last:border-b-0">
      <span className="text-stone-500 dark:text-stone-400 text-xs">{label}</span>
      <span className="text-stone-900 dark:text-white text-sm font-medium text-right">{value}</span>
    </div>
  );
}

function Toast({ message, type, onClose }: { message: string; type: "success" | "error"; onClose: () => void }) {
  const bg = type === "success"
    ? "bg-emerald-600"
    : "bg-red-600";
  return (
    <div className="fixed top-6 right-6 z-[100] animate-slide-in">
      <div className={`${bg} text-white px-5 py-3 rounded-lg shadow-lg flex items-center gap-3 max-w-sm`}>
        <span className="text-sm font-medium flex-1">{message}</span>
        <button onClick={onClose} className="text-white/80 hover:text-white shrink-0">✕</button>
      </div>
    </div>
  );
}
