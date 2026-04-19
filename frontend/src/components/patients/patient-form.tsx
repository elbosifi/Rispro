import { useState, useEffect, useRef, useId, type FormEvent, type KeyboardEvent } from "react";
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
import { Button, Card, Badge } from "@/components/shared";

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
  demographicsEstimated: boolean;
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
  demographicsEstimated: false,
  phone1: "",
  phone2: "",
  address: "benghazi",
  identifiers: [{ typeCode: "national_id", value: "", isPrimary: true }]
};

type FormFieldKey =
  | "arabicFullName"
  | "englishFullName"
  | "identifierType"
  | "identifierValue"
  | "nationalIdConfirmation"
  | "sex"
  | "estimatedDateOfBirth"
  | "ageYears"
  | "phone1"
  | "phone2"
  | "address";

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
    demographicsEstimated: Boolean(p.demographicsEstimated),
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
  const arabicFullNameRef = useRef<HTMLInputElement>(null);
  const englishFullNameRef = useRef<HTMLInputElement>(null);
  const identifierTypeRef = useRef<HTMLSelectElement>(null);
  const identifierValueRef = useRef<HTMLInputElement>(null);
  const nationalIdConfirmationRef = useRef<HTMLInputElement>(null);
  const sexRef = useRef<HTMLSelectElement>(null);
  const dobRef = useRef<HTMLInputElement>(null);
  const ageRef = useRef<HTMLInputElement>(null);
  const phone1Ref = useRef<HTMLInputElement>(null);
  const phone2Ref = useRef<HTMLInputElement>(null);
  const addressRef = useRef<HTMLSelectElement>(null);
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
  const { data: potentialDuplicates, isFetching: duplicatesLoading } = useQuery({
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

  const normalizePhoneInput = (value: string) => value.replace(/\D/g, "").slice(0, 10);
  const normalizeIdentifierForType = (type: IdentifierType, value: string) => (
    type === "passport" ? value.toUpperCase() : value
  );
  const findPrimaryIdentifierIndex = (identifiers: Array<{ typeCode: IdentifierType; value: string; isPrimary: boolean }>) => {
    const idx = identifiers.findIndex((entry) => entry.isPrimary);
    return idx >= 0 ? idx : 0;
  };

  const fieldOrder: FormFieldKey[] = [
    "arabicFullName",
    "englishFullName",
    "identifierType",
    "identifierValue",
    "nationalIdConfirmation",
    "sex",
    "estimatedDateOfBirth",
    "ageYears",
    "phone1",
    "phone2",
    "address"
  ];

  const getFieldElement = (key: FormFieldKey): HTMLElement | null => {
    const map: Record<FormFieldKey, HTMLElement | null> = {
      arabicFullName: arabicFullNameRef.current,
      englishFullName: englishFullNameRef.current,
      identifierType: identifierTypeRef.current,
      identifierValue: identifierValueRef.current,
      nationalIdConfirmation: nationalIdConfirmationRef.current,
      sex: sexRef.current,
      estimatedDateOfBirth: dobRef.current,
      ageYears: ageRef.current,
      phone1: phone1Ref.current,
      phone2: phone2Ref.current,
      address: addressRef.current
    };
    return map[key];
  };

  const isFieldEmpty = (key: FormFieldKey): boolean => {
    switch (key) {
      case "arabicFullName":
        return form.arabicFullName.trim() === "";
      case "englishFullName":
        return form.englishFullName.trim() === "";
      case "identifierType":
        return form.identifierType.trim() === "";
      case "identifierValue":
        return form.identifierValue.trim() === "";
      case "nationalIdConfirmation":
        return showConfirmation ? form.nationalIdConfirmation.trim() === "" : false;
      case "sex":
        return form.sex.trim() === "";
      case "estimatedDateOfBirth":
        return form.estimatedDateOfBirth.trim() === "";
      case "ageYears":
        return form.ageYears.trim() === "";
      case "phone1":
        return form.phone1.trim() === "";
      case "phone2":
        return form.phone2.trim() === "";
      case "address":
        return form.address.trim() === "";
      default:
        return false;
    }
  };

  const focusNextField = (currentField: FormFieldKey) => {
    const currentIndex = fieldOrder.indexOf(currentField);
    if (currentIndex < 0) return;

    for (let idx = currentIndex + 1; idx < fieldOrder.length; idx += 1) {
      const fieldKey = fieldOrder[idx];
      if (!fieldKey) continue;
      const element = getFieldElement(fieldKey);
      if (element && isFieldEmpty(fieldKey)) {
        element.focus();
        return;
      }
    }

    for (let idx = currentIndex + 1; idx < fieldOrder.length; idx += 1) {
      const fieldKey = fieldOrder[idx];
      if (!fieldKey) continue;
      const element = getFieldElement(fieldKey);
      if (element) {
        element.focus();
        return;
      }
    }
  };

  const handleEnterNavigation = (currentField: FormFieldKey) => (event: KeyboardEvent<HTMLInputElement | HTMLSelectElement>) => {
    if (event.key !== "Enter") return;
    event.preventDefault();
    focusNextField(currentField);
  };

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
      const primaryIdx = findPrimaryIdentifierIndex(nextIdentifiers);
      if (nextIdentifiers.length === 0 || primaryIdx < 0 || !nextIdentifiers[primaryIdx]) {
        nextIdentifiers.push({ typeCode: f.identifierType, value: cv, isPrimary: true });
      } else {
        nextIdentifiers[primaryIdx] = { ...nextIdentifiers[primaryIdx], typeCode: f.identifierType, value: cv, isPrimary: true };
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
    const arabicNameParts = form.arabicFullName.trim().split(/\s+/).filter(Boolean);
    if (!isEdit && arabicNameParts.length < 3) {
      showToast("Arabic full name must include at least 3 names before registering.", "error");
      arabicFullNameRef.current?.focus();
      return;
    }
    const primaryCount = form.identifiers.filter((entry) => entry.isPrimary).length;
    if (primaryCount !== 1) {
      showToast("Exactly one primary identifier is required.", "error");
      return;
    }
    if (!form.sex) {
      showToast("Sex is required.", "error");
      sexRef.current?.focus();
      return;
    }
    if (!form.estimatedDateOfBirth && !form.ageYears.trim()) {
      showToast("Please provide either Date of Birth or Age.", "error");
      dobRef.current?.focus();
      return;
    }
    const isNat = form.identifierType === "national_id";
    const isNationalIdComplete = isValidNationalId(form.identifierValue);
    const requiresNationalIdConfirmation = isNat && nationalIdWasEdited && isNationalIdComplete;
    // Confirmation is mandatory when it's shown (create mode or national ID was edited)
    if (requiresNationalIdConfirmation && form.nationalIdConfirmation.length === 0) {
      showToast("Please confirm the national ID.", "error");
      nationalIdConfirmationRef.current?.focus();
      return;
    }
    if (requiresNationalIdConfirmation && form.identifierValue !== form.nationalIdConfirmation) {
      showToast("National ID confirmation does not match.", "error");
      nationalIdConfirmationRef.current?.focus();
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
      demographicsEstimated: form.demographicsEstimated,
      estimatedDateOfBirth: form.estimatedDateOfBirth || undefined,
      ageYears: form.ageYears ? parseInt(form.ageYears, 10) : undefined,
      phone1: normalizePhoneInput(form.phone1),
      phone2: form.phone2 ? normalizePhoneInput(form.phone2) : undefined,
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
  const hasShortArabicNameWarning = (() => {
    const parts = form.arabicFullName.trim().split(/\s+/).filter(Boolean);
    return parts.length > 0 && parts.length < 3;
  })();
  const isNationalId = form.identifierType === "national_id";
  // Show confirmation only in create mode, or in edit mode when national ID was changed
  const nationalIdWasEdited = isEdit ? form.identifierValue !== originalNationalId : true;
  const showConfirmation = isNationalId && nationalIdWasEdited && isValidNationalId(form.identifierValue);
  const submitLabel = mutation.isPending
    ? (isEdit ? "Updating…" : "Registering…")
    : (isEdit ? "Update Patient" : "Register Patient");

  if (isEdit && loadingPatient) {
    return (
      <Card className="p-12 text-center">
        <p className="text-muted-foreground">Loading patient data…</p>
      </Card>
    );
  }

  // ============================================================
  // Shared form fields JSX (rendered in both create and edit)
  // ============================================================
  const formFields = (
    <form onSubmit={handleSubmit} className="space-y-8">
      {/* Identity */}
      <div className="space-y-6">
        <div className="flex items-center gap-4">
          <h3 className="text-xl font-semibold">Identity</h3>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <div>
            <label className="block text-xs uppercase tracking-[0.15em] font-mono mb-2 text-muted-foreground">Arabic Full Name</label>
            <input
              value={form.arabicFullName}
              onChange={(e) => handleArabicNameChange(e.target.value)}
              onBlur={() => { if (form.arabicFullName && !form.arabicFullName.endsWith(" ")) handleArabicNameChange(form.arabicFullName + " "); }}
              onKeyDown={handleEnterNavigation("arabicFullName")}
              required
              dir="rtl"
              ref={arabicFullNameRef}
              className="input-premium input-rtl w-full"
            />
          </div>
          <div>
            <label className="block text-xs uppercase tracking-[0.15em] font-mono mb-2 text-muted-foreground">English Full Name</label>
            <input
              value={form.englishFullName}
              onChange={(e) => handleEnglishNameChange(e.target.value)}
              onKeyDown={handleEnterNavigation("englishFullName")}
              dir="ltr"
              ref={englishFullNameRef}
              className="input-premium input-ltr w-full"
            />
            {form.arabicFullName && !englishNameManuallyEdited && (
              <p className="mt-2 text-sm text-muted-foreground">
                Generated from name dictionary.
                <button type="button" onClick={handleRegenerateEnglishName} className="ml-2 text-accent hover:underline">Regenerate</button>
              </p>
            )}
            {englishNameManuallyEdited && (
              <p className="mt-2 text-sm text-amber-600">Manually edited. Changes to Arabic name will not override this.</p>
            )}
          </div>
        </div>
        {hasShortArabicNameWarning && (
          <p className="text-sm text-amber-600">
            Warning: patient name usually includes at least 3 parts.
          </p>
        )}

        {currentMissingTokens.length > 0 && (
          <Card className="p-4 border-amber-200" style={{ background: "rgba(245, 158, 11, 0.05)" }}>
            <p className="text-sm font-medium text-amber-600 mb-4">Unrecognized name tokens — add to dictionary:</p>
            {currentMissingTokens.map((token) => (
              <div key={token} className="flex items-center gap-3 mb-2">
                <span className="text-sm font-mono" dir="rtl">{token}</span>
                <input
                  type="text"
                  value={missingTokenInputs[token] ?? ""}
                  onChange={(e) => setMissingTokenInputs((p) => ({ ...p, [token]: e.target.value }))}
                  placeholder="English translation…"
                  className="flex-1 input-premium h-10 text-sm"
                />
                <Button
                  type="button"
                  size="sm"
                  disabled={!missingTokenInputs[token]?.trim() || addingToken === token}
                  onClick={() => handleAddTokenToDictionary(token)}
                >
                  {addingToken === token ? "Adding…" : "Add"}
                </Button>
              </div>
            ))}
            {addTokenError && <p className="text-sm text-red-500 mt-2">{addTokenError}</p>}
          </Card>
        )}

        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <div>
            <label className="block text-xs uppercase tracking-[0.15em] font-mono mb-2 text-muted-foreground">Identifier Type</label>
            <select
              value={form.identifierType}
              onKeyDown={handleEnterNavigation("identifierType")}
              ref={identifierTypeRef}
              required
              onChange={(v) => setForm((f) => {
                const nextType = v.target.value as IdentifierType;
                const nextValue = normalizeIdentifierForType(nextType, f.identifierValue);
                const nextIdentifiers = [...f.identifiers];
                const primaryIdx = findPrimaryIdentifierIndex(nextIdentifiers);
                if (nextIdentifiers.length === 0 || primaryIdx < 0 || !nextIdentifiers[primaryIdx]) {
                  nextIdentifiers.push({ typeCode: nextType, value: nextValue, isPrimary: true });
                } else {
                  nextIdentifiers[primaryIdx] = { ...nextIdentifiers[primaryIdx], typeCode: nextType, value: nextValue, isPrimary: true };
                }
                return {
                  ...f,
                  identifierType: nextType,
                  identifierValue: nextValue,
                  identifiers: nextIdentifiers,
                  nationalIdConfirmation: ""
                };
              })}
              className="input-premium input-ltr w-full"
            >
              <option value="national_id">National ID (Libyan)</option>
              <option value="passport">Passport</option>
              <option value="other">Other</option>
            </select>
          </div>
          {isNationalId ? (
            <div>
              <label className="block text-xs uppercase tracking-[0.15em] font-mono mb-2 text-muted-foreground">National ID (12 digits)</label>
              <input
                value={form.identifierValue}
                onChange={handleIdentifierValueChange}
                onKeyDown={handleEnterNavigation("identifierValue")}
                ref={identifierValueRef}
                maxLength={12}
                placeholder="1xxxxxxxxxxx"
                className="input-premium input-ltr w-full"
              />
            </div>
          ) : (
            <div>
              <label className="block text-xs uppercase tracking-[0.15em] font-mono mb-2 text-muted-foreground">
                {form.identifierType === "passport" ? "Passport Number" : "Identifier Value"}
              </label>
              <input
                value={form.identifierValue}
                onChange={(v) => setForm((f) => {
                  const nextValue = normalizeIdentifierForType(f.identifierType, v.target.value);
                  const nextIdentifiers = [...f.identifiers];
                  const primaryIdx = findPrimaryIdentifierIndex(nextIdentifiers);
                  if (nextIdentifiers.length === 0 || primaryIdx < 0 || !nextIdentifiers[primaryIdx]) {
                    nextIdentifiers.push({ typeCode: f.identifierType, value: nextValue, isPrimary: true });
                  } else {
                    nextIdentifiers[primaryIdx] = { ...nextIdentifiers[primaryIdx], typeCode: f.identifierType, value: nextValue, isPrimary: true };
                  }
                  return { ...f, identifierValue: nextValue, identifiers: nextIdentifiers };
                })}
                onKeyDown={handleEnterNavigation("identifierValue")}
                ref={identifierValueRef}
                placeholder={form.identifierType === "passport" ? "AB1234567" : ""}
                className="input-premium input-ltr w-full"
              />
            </div>
          )}
          {showConfirmation && (
            <div>
              <label className="block text-xs uppercase tracking-[0.15em] font-mono mb-2 text-muted-foreground">Confirm National ID</label>
              <input
                value={form.nationalIdConfirmation}
                onChange={(v) => setForm((f) => ({ ...f, nationalIdConfirmation: v.target.value.replace(/\D/g, "") }))}
                onKeyDown={handleEnterNavigation("nationalIdConfirmation")}
                maxLength={12}
                ref={nationalIdConfirmationRef}
                onPaste={(e) => { e.preventDefault(); e.stopPropagation(); }}
                onDragOver={(e) => { e.preventDefault(); e.stopPropagation(); }}
                onDrop={(e) => { e.preventDefault(); e.stopPropagation(); }}
                placeholder="Re-type the National ID"
                required={nationalIdWasEdited}
                className="input-premium input-ltr w-full"
              />
            </div>
          )}
        </div>
        <Card className="p-4">
          <div className="flex items-center justify-between mb-3">
            <p className="text-sm font-medium">Additional Identifiers</p>
            <button
              type="button"
              className="text-sm text-accent underline"
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
            <div key={`identifier-${idx}`} className="grid grid-cols-1 md:grid-cols-4 gap-3 items-center mb-2">
              <select
                value={entry.typeCode}
                onChange={(e) =>
                  setForm((f) => {
                    const next = [...f.identifiers];
                    const nextType = e.target.value as IdentifierType;
                    const nextValue = normalizeIdentifierForType(nextType, next[idx]?.value || "");
                    next[idx] = { ...next[idx], typeCode: nextType, value: nextValue };
                    if (next[idx]?.isPrimary) {
                      return { ...f, identifiers: next, identifierType: nextType, identifierValue: nextValue };
                    }
                    return { ...f, identifiers: next };
                  })
                }
                className="input-premium h-10 text-sm"
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
                    const nextValue = normalizeIdentifierForType(next[idx]?.typeCode || "other", e.target.value);
                    next[idx] = { ...next[idx], value: nextValue };
                    if (next[idx]?.isPrimary) {
                      return { ...f, identifiers: next, identifierValue: nextValue };
                    }
                    return { ...f, identifiers: next };
                  })
                }
                placeholder="Identifier value"
                className="md:col-span-2 input-premium h-10 text-sm"
              />
              <div className="flex items-center gap-2">
                <label className="inline-flex items-center gap-2 text-sm text-muted-foreground">
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
                    className="text-sm text-red-500 underline"
                    onClick={() =>
                      setForm((f) => {
                        const next = f.identifiers.filter((_, itemIdx) => itemIdx !== idx);
                        if (next.length > 0 && !next.some((x) => x.isPrimary)) {
                          next[0] = { ...next[0], isPrimary: true };
                        }
                        const primary = next.find((x) => x.isPrimary) || next[0];
                        return {
                          ...f,
                          identifiers: next,
                          identifierType: (primary?.typeCode || "national_id") as IdentifierType,
                          identifierValue: primary?.value || ""
                        };
                      })
                    }
                  >
                    Remove
                  </button>
                )}
              </div>
            </div>
          ))}
        </Card>
      </div>

      {/* Demographics */}
      <div className="space-y-6">
        <div className="flex items-center gap-4">
          <h3 className="text-xl font-semibold">Demographics</h3>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          <div>
            <label className="block text-xs uppercase tracking-[0.15em] font-mono mb-2 text-muted-foreground">Sex</label>
            <select
              value={form.sex}
              onChange={(v) => setForm((f) => ({ ...f, sex: v.target.value }))}
              onKeyDown={handleEnterNavigation("sex")}
              ref={sexRef}
              required
              className="input-premium input-ltr w-full"
            >
              <option value="">Select...</option>
              <option value="M">Male</option>
              <option value="F">Female</option>
            </select>
          </div>
          <div>
            <DateInput
              label="Date of Birth"
              value={form.estimatedDateOfBirth}
              onChange={handleDobChange}
              onKeyDown={handleEnterNavigation("estimatedDateOfBirth")}
              inputRef={dobRef}
              name="estimatedDateOfBirth"
            />
          </div>
          <div>
            <label className="block text-xs uppercase tracking-[0.15em] font-mono mb-2 text-muted-foreground">Age (years)</label>
            <input
              value={form.ageYears}
              onChange={(v) => setForm((f) => ({ ...f, ageYears: v.target.value.replace(/\D/g, "").slice(0, 3) }))}
              onKeyDown={handleEnterNavigation("ageYears")}
              ref={ageRef}
              type="number"
              min="0"
              max="130"
              className="input-premium input-ltr w-full"
            />
          </div>
        </div>
        <label className="flex items-center gap-3 cursor-pointer user-select-none p-2 rounded-lg hover:bg-muted/50">
          <input
            type="checkbox"
            checked={form.demographicsEstimated}
            onChange={(event) => setForm((f) => ({ ...f, demographicsEstimated: event.target.checked }))}
            className="w-5 h-5 cursor-pointer accent-[var(--accent)]"
          />
          <span className="text-base font-medium">Estimated (uncertain DOB/age)</span>
        </label>
        {isNationalId && isValidNationalId(form.identifierValue) && (
          <p className="text-sm text-accent">Demographics auto-derived from National ID. You can override them manually.</p>
        )}
      </div>

      {/* Contact */}
      <div className="space-y-6">
        <div className="flex items-center gap-4">
          <h3 className="text-xl font-semibold">Contact</h3>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <div>
            <label className="block text-xs uppercase tracking-[0.15em] font-mono mb-2 text-muted-foreground">Phone 1 (Required)</label>
            <input
              value={form.phone1}
              onChange={(v) => setForm((f) => ({ ...f, phone1: normalizePhoneInput(v.target.value) }))}
              onKeyDown={handleEnterNavigation("phone1")}
              ref={phone1Ref}
              maxLength={10}
              required
              className="input-premium input-ltr w-full"
            />
          </div>
          <div>
            <label className="block text-xs uppercase tracking-[0.15em] font-mono mb-2 text-muted-foreground">Phone 2 (Optional)</label>
            <input
              value={form.phone2}
              onChange={(v) => setForm((f) => ({ ...f, phone2: normalizePhoneInput(v.target.value) }))}
              onKeyDown={handleEnterNavigation("phone2")}
              ref={phone2Ref}
              maxLength={10}
              className="input-premium input-ltr w-full"
            />
          </div>
          <div className="md:col-span-2">
            <label className="block text-xs uppercase tracking-[0.15em] font-mono mb-2 text-muted-foreground">City</label>
            <select
              value={form.address}
              onChange={(v) => setForm((f) => ({ ...f, address: v.target.value }))}
              onKeyDown={handleEnterNavigation("address")}
              ref={addressRef}
              className="input-premium input-ltr w-full"
            >
              <option value="">Select a city...</option>
              {LIBYAN_CITIES.map((c) => (
                <option key={c.code} value={c.code}>
                  {c.nameAr} / {c.nameEn}
                </option>
              ))}
            </select>
          </div>
        </div>
      </div>

      {/* Actions */}
      <div className="flex gap-4 pt-6 border-t border-border">
        {isEdit && (
          <Button
            type="button"
            variant="secondary"
            onClick={() => {
              if (window.confirm("Delete this patient? This cannot be undone.")) {
                deleteMutation.mutate();
              }
            }}
            disabled={deleteMutation.isPending || mutation.isPending}
            style={{ color: "#ef4444", borderColor: "rgba(239, 68, 68, 0.3)", backgroundColor: "rgba(239, 68, 68, 0.05)" }}
          >
            {deleteMutation.isPending ? "Deleting..." : "Delete Patient"}
          </Button>
        )}
        {isEdit && onCancel && (
          <Button
            type="button"
            variant="secondary"
            onClick={onCancel}
          >
            Cancel
          </Button>
        )}
        <Button
          type="submit"
          disabled={mutation.isPending}
          className="ml-auto"
        >
          {submitLabel}
        </Button>
      </div>
      {mutation.error && (
        <div className="p-4 rounded-xl border-red-200" style={{ background: "rgba(239, 68, 68, 0.05)", color: "#ef4444" }}>
          <p className="text-sm">{mutation.error.message}</p>
        </div>
      )}
    </form>
  );

  // ============================================================
  // Layout: Create mode (form + sidebar) vs Edit mode (form only)
  // ============================================================
  if (!isEdit) {
    return (
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <Card className="lg:col-span-2 p-6">{formFields}</Card>
        <div className="space-y-6">
          <Card className="p-6" style={{ background: "rgba(245, 158, 11, 0.05)", borderColor: "rgba(245, 158, 11, 0.3)" }}>
            <h3 className="text-sm font-semibold text-amber-600 mb-4">
              Possible Duplicates {dupQuery.length > 1 ? `(${duplicates.length})` : ""}
            </h3>
            {dupQuery.length <= 1 ? (
              <p className="text-sm text-amber-700">Type at least 2 characters in phone, name, or identifier to check matches.</p>
            ) : duplicatesLoading ? (
              <p className="text-sm text-amber-700">Checking possible matches…</p>
            ) : duplicates.length === 0 ? (
              <p className="text-sm text-amber-700">No possible matches found.</p>
            ) : (
              <ul className="space-y-3">
                {duplicates.slice(0, 5).map((p) => (
                  <li key={p.id} className="bg-card rounded-xl border border-border overflow-hidden">
                    <button
                      type="button"
                      onClick={() => setPreviewPatient(p)}
                      className="w-full p-4 space-y-1 text-right hover:bg-muted/50 transition-colors"
                    >
                      <p className="font-medium">{p.arabicFullName}</p>
                      {p.englishFullName && <p className="text-xs text-muted-foreground">{p.englishFullName}</p>}
                      <p className="text-xs text-muted-foreground">
                        {p.identifierValue || p.nationalId || "No ID"}{p.identifierType && p.identifierType !== "national_id" && ` (${p.identifierType})`}{" • "}MRN: {p.mrn || "—"}
                      </p>
                      {p.phone1 && <p className="text-xs text-muted-foreground">Phone: {p.phone1}</p>}
                      {p.address && <p className="text-xs text-muted-foreground">City: {LIBYAN_CITIES.find((c) => c.code === p.address)?.nameEn || p.address}</p>}
                    </button>
                    <div className="flex gap-2 border-t border-border">
                      <button
                        type="button"
                        onClick={() => navigate(`/patients/${p.id}/edit`)}
                        className="flex-1 text-center py-3 px-2 text-amber-700 text-xs font-medium hover:bg-amber-50 dark:hover:bg-amber-900/20 transition-colors"
                      >
                        Edit Patient
                      </button>
                      <button
                        type="button"
                        onClick={() => navigate(`/appointments?patientId=${p.id}`)}
                        className="flex-1 text-center py-3 px-2 text-accent text-xs font-medium hover:bg-accent/5 transition-colors"
                      >
                        Create Appointment
                      </button>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </Card>

          {/* Patient Preview Modal */}
          {previewPatient && (
            <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={(e) => { if (e.target === e.currentTarget) setPreviewPatient(null); }}>
              <Card className="w-full max-w-md mx-4 p-6">
                <div className="flex items-center justify-between mb-6">
                  <h3 className="text-xl font-semibold">Patient Details</h3>
                  <button onClick={() => setPreviewPatient(null)} className="text-muted-foreground hover:text-foreground">✕</button>
                </div>
                <div className="space-y-3">
                  <Field label="Arabic Name" value={previewPatient.arabicFullName} />
                  {previewPatient.englishFullName && <Field label="English Name" value={previewPatient.englishFullName} />}
                  <Field label="Identifier" value={`${previewPatient.identifierValue || previewPatient.nationalId || "No ID"}${previewPatient.identifierType && previewPatient.identifierType !== "national_id" ? ` (${previewPatient.identifierType})` : ""}`} />
                  <Field label="MRN" value={previewPatient.mrn || "—"} />
                  <Field label="Sex" value={previewPatient.sex === "M" ? "Male" : previewPatient.sex === "F" ? "Female" : previewPatient.sex} />
                  <Field label="Age" value={previewPatient.ageYears ? `${previewPatient.ageYears} years${previewPatient.demographicsEstimated ? " (Estimated)" : ""}` : "—"} />
                  <Field label="DOB" value={previewPatient.estimatedDateOfBirth ? formatDateLy(previewPatient.estimatedDateOfBirth) : "—"} />
                  <Field label="Phone" value={previewPatient.phone1 || "—"} />
                  {previewPatient.phone2 && <Field label="Phone 2" value={previewPatient.phone2} />}
                  {previewPatient.address && <Field label="City" value={LIBYAN_CITIES.find((c) => c.code === previewPatient.address)?.nameEn || previewPatient.address} />}
                </div>
                <div className="flex gap-3 pt-4 border-t border-border mt-4">
                  <Button
                    variant="secondary"
                    onClick={() => navigate(`/patients/${previewPatient.id}/edit`)}
                    className="flex-1"
                  >
                    Edit
                  </Button>
                  <Button
                    onClick={() => navigate(`/appointments?patientId=${previewPatient.id}`)}
                    className="flex-1"
                  >
                    Create Appointment
                  </Button>
                </div>
              </Card>
            </div>
          )}
        </div>

        {toast && <Toast message={toast.message} type={toast.type} onClose={() => setToast(null)} />}
        {postCreatePatient &&
          createPortal(
            <div
              className="fixed inset-0 z-[200] flex items-center justify-center bg-black/55 px-4"
              onClick={(e) => {
                if (e.target === e.currentTarget) setPostCreatePatient(null);
              }}
            >
              <Card className="w-full max-w-lg p-8 shadow-2xl">
                <div className="text-center space-y-4 mb-8">
                  <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-accent/10 text-accent">
                    <svg className="h-7 w-7" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                    </svg>
                  </div>
                  <h3 className="text-2xl font-display">Patient registered</h3>
                  <p className="text-muted-foreground">
                    Choose what to do next for {postCreatePatient.arabicFullName}.
                  </p>
                </div>
                <div className="flex flex-col gap-3">
                  <Button
                    type="button"
                    onClick={() => navigate(`/appointments?patientId=${postCreatePatient.id}`)}
                    className="w-full"
                  >
                    Create appointment for this patient
                  </Button>
                  <Button
                    type="button"
                    variant="secondary"
                    onClick={() => {
                      setPostCreatePatient(null);
                      arabicFullNameRef.current?.focus();
                    }}
                    className="w-full"
                  >
                    Register another patient
                  </Button>
                  <Button
                    type="button"
                    variant="secondary"
                    onClick={() => setPostCreatePatient(null)}
                    className="w-full"
                  >
                    Close
                  </Button>
                </div>
              </Card>
            </div>,
            document.body
          )}
      </div>
    );
  }

  // Edit mode: form only (toast handles success)
  return (
    <div className="max-w-4xl mx-auto">
      <Card className="p-6">{formFields}</Card>
      {toast && <Toast message={toast.message} type={toast.type} onClose={() => setToast(null)} />}
    </div>
  );
}

// -- Sub-components --

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between items-baseline py-2 border-b border-border last:border-b-0">
      <span className="text-muted-foreground text-xs font-mono uppercase tracking-[0.15em]">{label}</span>
      <span className="text-sm font-medium text-right">{value}</span>
    </div>
  );
}

function Toast({ message, type, onClose }: { message: string; type: "success" | "error"; onClose: () => void }) {
  const bg = type === "success"
    ? "var(--accent)"
    : "#ef4444";
  return (
    <div className="fixed top-6 right-6 z-[100] animate-slide-in">
      <div className="px-5 py-4 rounded-xl shadow-lg flex items-center gap-3 max-w-sm" style={{ background: bg, color: "white" }}>
        <span className="text-sm font-medium flex-1">{message}</span>
        <button onClick={onClose} className="text-white/80 hover:text-white shrink-0">✕</button>
      </div>
    </div>
  );
}
