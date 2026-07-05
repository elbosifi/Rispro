import { useState, useEffect, useRef, type ClipboardEvent, type FormEvent, type KeyboardEvent } from "react";
import { createPortal } from "react-dom";
import { useNavigate } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  createPatient,
  searchPatients,
  fetchPatientMrnPreview,
  fetchPatientIdentifierTypes,
  fetchSettings,
  fetchNameDictionary,
  fetchPatientNotAllowedNameWords,
  upsertNameDictionaryEntry,
  fetchPatientById,
  updatePatient,
  deletePatient
} from "@/lib/api-hooks";
import { generateEnglishFromDictionary, type DictionaryEntry } from "@/lib/name-generation";
import { normalizeArabic } from "@/lib/arabic-normalize";
import {
  deriveDemographicsFromNationalId,
  calculateAgeFromDob,
  isValidNationalId
} from "@/lib/national-id";
import { LIBYAN_CITIES_SORTED as LIBYAN_CITIES } from "@/lib/libyan-cities";
import { formatDateLy } from "@/lib/date-format";
import { DateInput } from "@/components/common/date-input";
import { PatientCategoryBadge } from "@/components/patients/patient-category-badge";
import type { Patient, PatientIdentifierTypeOption } from "@/types/api";
import { Button, Card } from "@/components/shared";
import { chooseLocalized, t } from "@/lib/i18n";
import { useLanguage } from "@/providers/language-provider";
import { useAuth } from "@/providers/auth-provider";

type IdentifierType = string;
type PatientFormMode = "create" | "edit";

interface PatientFormState {
  arabicFullName: string;
  englishFullName: string;
  identifierType: IdentifierType;
  identifierValue: string;
  category: "" | "oncology" | "non_oncology";
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
  category: "",
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

const BUILTIN_IDENTIFIER_TYPES: PatientIdentifierTypeOption[] = [
  { code: "national_id", labelAr: "الرقم الوطني", labelEn: "National ID" },
  { code: "passport", labelAr: "جواز سفر", labelEn: "Passport" },
  { code: "other", labelAr: "أخرى", labelEn: "Other" }
];

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
  const patientIdentifiers = p.identifiers ?? [];

  const identifiers: Array<{ typeCode: IdentifierType; value: string; isPrimary: boolean }> =
    patientIdentifiers.length > 0
      ? patientIdentifiers.map((entry) => ({
          typeCode: ((entry.typeCode ?? p.identifierType ?? "national_id") as IdentifierType),
          value: entry.value,
          isPrimary: entry.isPrimary
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
    category: p.category === "oncology" || p.category === "non_oncology" ? p.category : "",
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

function getUnknownErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (error && typeof error === "object" && "message" in error) {
    const message = (error as { message?: unknown }).message;
    return typeof message === "string" ? message : "";
  }
  return "";
}

interface PatientFormProps {
  mode: PatientFormMode;
  patientId?: number;
  onSuccess?: (patient: Patient) => void;
  onCancel?: () => void;
}

export default function PatientForm({ mode, patientId, onSuccess, onCancel }: PatientFormProps) {
  const { language, t } = useLanguage();
  const { user } = useAuth();
  const isEdit = mode === "edit";
  const [form, setForm] = useState<PatientFormState>(DEFAULT_FORM);
  // Track original national ID to know if it was edited (edit mode only)
  const [originalNationalId, setOriginalNationalId] = useState("");
  const [nationalIdConfirmedByPaste, setNationalIdConfirmedByPaste] = useState<string | null>(null);
  const [duplicates, setDuplicates] = useState<Patient[]>([]);
  const [duplicateFocusField, setDuplicateFocusField] = useState<FormFieldKey | null>(null);
  const [previewPatient, setPreviewPatient] = useState<Patient | null>(null);
  const [englishNameManuallyEdited, setEnglishNameManuallyEdited] = useState(false);
  const [toast, setToast] = useState<{ message: string; type: "success" | "error" } | null>(null);
  const [postCreatePatient, setPostCreatePatient] = useState<Patient | null>(null);
  const showToast = (message: string, type: "success" | "error" = "success") => {
    setToast({ message, type });
    setTimeout(() => setToast(null), 4500);
  };
  const localizedPatientError = (error: unknown, fallbackKey: "patients.registerFailed" | "patients.updateFailed" | "patients.deleteFailed") => {
    const message = getUnknownErrorMessage(error);
    if (message.startsWith("Primary identifier is required.")) return t("patients.primaryIdentifierRequired");
    const blockedWordMatch = message.match(/^Arabic name contains a not-allowed word:\s*(.+)$/i);
    if (blockedWordMatch) return t("patients.arabicNameNotAllowedWord", { word: blockedWordMatch[1] || "" });
    return message || t(fallbackKey);
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
  const categoryRef = useRef<HTMLSelectElement>(null);
  const navigate = useNavigate();
  const sectionTitleClass = "text-xl sm:text-2xl font-bold text-foreground";
  const fieldLabelClass = "block text-sm font-semibold mb-2 text-foreground";
  const helperTextClass = "mt-2 text-sm text-muted-foreground";

  // Dictionary
  const { data: dictData } = useQuery({
    queryKey: ["name-dictionary"],
    queryFn: fetchNameDictionary,
    staleTime: 1000 * 60 * 5
  });
  const serverDictionary: DictionaryEntry[] = dictData?.entries ?? [];
  const dictionary: DictionaryEntry[] = [...serverDictionary, ...localDictionary];
  const { data: notAllowedNameWordsData } = useQuery({
    queryKey: ["patient-not-allowed-name-words"],
    queryFn: fetchPatientNotAllowedNameWords,
    staleTime: 1000 * 60 * 5
  });
  const notAllowedNameWords = notAllowedNameWordsData?.entries ?? [];

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
      setNationalIdConfirmedByPaste(null);
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
  const { data: mrnPreview, isLoading: mrnPreviewLoading } = useQuery({
    queryKey: ["patient-mrn-preview"],
    queryFn: fetchPatientMrnPreview,
    enabled: !isEdit,
    staleTime: 1000 * 15,
    retry: 2,
    refetchOnMount: "always",
    refetchOnReconnect: true
  });
  const { data: identifierTypesData } = useQuery({
    queryKey: ["patient-identifier-types"],
    queryFn: fetchPatientIdentifierTypes,
    staleTime: 1000 * 60 * 5
  });
  const { data: patientRegistrationSettings } = useQuery({
    queryKey: ["settings", "patient_registration"],
    queryFn: () => fetchSettings("patient_registration"),
    staleTime: 1000 * 60
  });
  const identifierTypeOptions = (() => {
    const incoming = Array.isArray(identifierTypesData) ? identifierTypesData.filter((row) => row.code) : [];
    if (incoming.length === 0) return BUILTIN_IDENTIFIER_TYPES;

    const byCode = new Map<string, PatientIdentifierTypeOption>();
    for (const row of incoming) {
      byCode.set(row.code, row);
    }
    for (const builtin of BUILTIN_IDENTIFIER_TYPES) {
      if (!byCode.has(builtin.code)) byCode.set(builtin.code, builtin);
    }
    for (const entry of form.identifiers) {
      const code = String(entry.typeCode || "").trim();
      if (!code) continue;
      if (!byCode.has(code)) {
        byCode.set(code, { code, labelAr: code, labelEn: code });
      }
    }
    return Array.from(byCode.values());
  })();
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
      setNationalIdConfirmedByPaste(null);
      setEnglishNameManuallyEdited(false);
      setDuplicateFocusField(null);
      setMissingTokenInputs({});
      setLocalDictionary([]);
      setAddTokenError(null);
      prevArabicTokenCountRef.current = 0;
      queryClient.invalidateQueries({ queryKey: ["duplicates"] });
      queryClient.invalidateQueries({ queryKey: ["patient-mrn-preview"] });
      showToast(language === "ar"
        ? `تم تسجيل المريض: ${patient.arabicFullName} (MRN: ${patient.mrn})`
        : `Patient registered: ${patient.arabicFullName} (MRN: ${patient.mrn})`);
      if (!isEdit) {
        setPostCreatePatient(patient);
      }
      onSuccess?.(patient);
    },
    onError: (err: any) => {
      showToast(localizedPatientError(err, "patients.registerFailed"), "error");
    }
  });
  const updateMutation = useMutation({
    mutationFn: (data: Partial<Patient>) => updatePatient(patientId!, data),
    onSuccess: (patient) => {
      queryClient.invalidateQueries({ queryKey: ["patient-by-id", patientId] });
      showToast(language === "ar" ? `تم تحديث المريض: ${patient.arabicFullName}` : `Patient updated: ${patient.arabicFullName}`);
      onSuccess?.(patient);
    },
    onError: (err: any) => {
      showToast(localizedPatientError(err, "patients.updateFailed"), "error");
    }
  });
  const deleteMutation = useMutation({
    mutationFn: () => deletePatient(patientId!),
    onSuccess: () => {
      showToast(language === "ar" ? "تم حذف المريض" : "Patient deleted");
      queryClient.invalidateQueries();
      onCancel?.();
    },
    onError: (err: any) => {
      showToast(err?.message || (language === "ar" ? "تعذر حذف المريض" : "Could not delete patient"), "error");
    }
  });
  const mutation = isEdit ? updateMutation : createMutation;
  const canDeletePatient = user?.role === "super_admin";

  const normalizePhoneInput = (value: string) => value.replace(/\D/g, "").slice(0, 10);
  const normalizeIdentifierForType = (type: IdentifierType, value: string) => {
    if (type === "national_id") return value.replace(/\D/g, "").slice(0, 12);
    if (type === "passport") return value.toUpperCase();
    return value;
  };

  const applyPrimaryIdentifierState = (
    current: PatientFormState,
    identifiers: Array<{ typeCode: IdentifierType; value: string; isPrimary: boolean }>,
    primaryType: IdentifierType,
    primaryValue: string
  ): PatientFormState => {
    const nextState: PatientFormState = {
      ...current,
      identifiers,
      identifierType: primaryType,
      identifierValue: primaryValue
    };

    if (primaryType === "national_id" && isValidNationalId(primaryValue)) {
      const derived = deriveDemographicsFromNationalId(primaryValue);
      if (derived.sex) nextState.sex = derived.sex;
      if (derived.estimatedDateOfBirth) nextState.estimatedDateOfBirth = derived.estimatedDateOfBirth;
      if (derived.ageYears !== undefined) nextState.ageYears = String(derived.ageYears);
    }

    return nextState;
  };
  const applyPrimaryIdentifierInputChange = (
    current: PatientFormState,
    index: number,
    rawValue: string,
    options: { confirmByPaste?: boolean } = {}
  ) => {
    const next = [...current.identifiers];
    const nextType = next[index]?.typeCode || "other";
    const nextValue = normalizeIdentifierForType(nextType, rawValue);
    next[index] = { ...next[index], value: nextValue };

    const nextState = next[index]?.isPrimary
      ? applyPrimaryIdentifierState(current, next, nextType, nextValue)
      : { ...current, identifiers: next };

    if (next[index]?.isPrimary && nextType === "national_id" && options.confirmByPaste && isValidNationalId(nextValue)) {
      setNationalIdConfirmedByPaste(nextValue);
      return { ...nextState, nationalIdConfirmation: nextValue };
    }

    if (next[index]?.isPrimary && nextType === "national_id" && nationalIdConfirmedByPaste && nationalIdConfirmedByPaste !== nextValue) {
      setNationalIdConfirmedByPaste(null);
      return { ...nextState, nationalIdConfirmation: "" };
    }

    return nextState;
  };
  const handlePrimaryIdentifierPaste = (event: ClipboardEvent<HTMLInputElement>, index: number) => {
    const entry = form.identifiers[index];
    if (!entry?.isPrimary || entry.typeCode !== "national_id") return;

    event.preventDefault();
    const pastedValue = event.clipboardData.getData("text");
    setDuplicateFocusField("identifierValue");
    setForm((current) => applyPrimaryIdentifierInputChange(
      current,
      index,
      pastedValue,
      { confirmByPaste: isValidNationalId(normalizeIdentifierForType("national_id", pastedValue)) }
    ));
  };
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

  const getFieldKeyFromElement = (element: EventTarget | null): FormFieldKey | null => {
    if (!(element instanceof HTMLElement)) return null;
    if (element === arabicFullNameRef.current) return "arabicFullName";
    if (element === englishFullNameRef.current) return "englishFullName";
    if (element === identifierTypeRef.current) return "identifierType";
    if (element === identifierValueRef.current) return "identifierValue";
    if (element === nationalIdConfirmationRef.current) return "nationalIdConfirmation";
    if (element === sexRef.current) return "sex";
    if (element === dobRef.current) return "estimatedDateOfBirth";
    if (element === ageRef.current) return "ageYears";
    if (element === phone1Ref.current) return "phone1";
    if (element === phone2Ref.current) return "phone2";
    if (element === addressRef.current) return "address";
    return null;
  };

  const handleFormKeyDown = (event: KeyboardEvent<HTMLFormElement>) => {
    if (event.key !== "Enter") return;

    const target = event.target as HTMLElement | null;
    if (!target) return;

    const tagName = target.tagName.toLowerCase();
    if (tagName === "button") return;
    if (target.getAttribute("role") === "button") return;

    const fieldKey = getFieldKeyFromElement(target);
    if (!fieldKey) return;

    event.preventDefault();
    focusNextField(fieldKey);
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
        const generated = generateEnglishFromDictionary(value, dictionary);
        u.englishFullName = generated.missingTokens.length === 0 ? generated.englishName : "";
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
    setForm((f) => ({ ...f, englishFullName: r.missingTokens.length === 0 ? r.englishName : "" }));
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
      setForm((f) => ({ ...f, englishFullName: r.missingTokens.length === 0 ? r.englishName : "" }));
      queryClient.invalidateQueries({ queryKey: ["name-dictionary"] });
    } catch (err: any) {
      setAddTokenError(err?.message || (language === "ar" ? "فشل إضافة الرمز إلى القاموس." : "Failed to add token to dictionary"));
    } finally {
      setAddingToken(null);
    }
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
    const blockedWords = new Set(notAllowedNameWords.map((entry) => normalizeArabic(entry.arabicText)).filter(Boolean));
    const blockedWord = arabicNameParts.map((part) => normalizeArabic(part)).find((part) => blockedWords.has(part));
    if (blockedWord) {
      showToast(t("patients.arabicNameNotAllowedWord", { word: blockedWord }), "error");
      arabicFullNameRef.current?.focus();
      return;
    }
    const fullNameGeneration = generateEnglishFromDictionary(form.arabicFullName.trim(), dictionary);
    if (!englishNameManuallyEdited && fullNameGeneration.missingTokens.length > 0) {
      const tokensLabel = fullNameGeneration.missingTokens.join(", ");
      showToast(
        language === "ar"
          ? `لا يمكن اعتماد توليد الاسم الإنجليزي تلقائياً. الرموز غير المعروفة: ${tokensLabel}. أضفها إلى القاموس أو حرر الاسم الإنجليزي يدوياً.`
          : `Cannot use auto-generated English name. Unresolved Arabic token(s): ${tokensLabel}. Add them to the dictionary or edit English name manually.`,
        "error"
      );
      englishFullNameRef.current?.focus();
      return;
    }
    if (!isEdit && arabicNameParts.length < 3) {
      showToast(language === "ar" ? "يجب أن يحتوي الاسم العربي على 3 أجزاء على الأقل قبل التسجيل." : "Arabic full name must include at least 3 names before registering.", "error");
      arabicFullNameRef.current?.focus();
      return;
    }
    const primaryCount = form.identifiers.filter((entry) => entry.isPrimary).length;
    if (primaryCount !== 1) {
      showToast(language === "ar" ? "يجب تحديد معرف أساسي واحد فقط." : "Exactly one primary identifier is required.", "error");
      return;
    }
    if (patientRegistrationSettings?.national_id_required === "required" && !form.identifierValue.trim()) {
      showToast(t("patients.primaryIdentifierRequired"), "error");
      identifierValueRef.current?.focus();
      return;
    }
    if (!form.sex) {
      showToast(language === "ar" ? "الجنس مطلوب." : "Sex is required.", "error");
      sexRef.current?.focus();
      return;
    }
    if (!form.category) {
      showToast(language === "ar" ? "يرجى اختيار تصنيف الحالة." : "Patient category is required.", "error");
      categoryRef.current?.focus();
      return;
    }
    if (!form.estimatedDateOfBirth && !form.ageYears.trim()) {
      showToast(language === "ar" ? "يرجى إدخال تاريخ الميلاد أو العمر." : "Please provide either Date of Birth or Age.", "error");
      dobRef.current?.focus();
      return;
    }
    const isNat = form.identifierType === "national_id";
    const isNationalIdComplete = isValidNationalId(form.identifierValue);
    const requiresNationalIdConfirmation = isNat && nationalIdWasEdited && isNationalIdComplete && !nationalIdIsPasteConfirmed;
    // Confirmation is mandatory when it's shown (create mode or national ID was edited)
    if (requiresNationalIdConfirmation && form.nationalIdConfirmation.length === 0) {
      showToast(language === "ar" ? "يرجى تأكيد الرقم الوطني." : "Please confirm the national ID.", "error");
      nationalIdConfirmationRef.current?.focus();
      return;
    }
    if (requiresNationalIdConfirmation && form.identifierValue !== form.nationalIdConfirmation) {
      showToast(language === "ar" ? "تأكيد الرقم الوطني لا يطابق." : "National ID confirmation does not match.", "error");
      nationalIdConfirmationRef.current?.focus();
      return;
    }
    const payload = {
      arabicFullName: form.arabicFullName,
      englishFullName: form.englishFullName || undefined,
      identifierType: form.identifierType,
      identifierValue: form.identifierValue || undefined,
      category: form.category,
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

  const fullNameGeneration = generateEnglishFromDictionary(form.arabicFullName.trim(), dictionary);
  const currentMissingTokens = fullNameGeneration.missingTokens;
  const hasShortArabicNameWarning = (() => {
    const parts = form.arabicFullName.trim().split(/\s+/).filter(Boolean);
    return parts.length > 0 && parts.length < 3;
  })();
  const isNationalId = form.identifierType === "national_id";
  // Show confirmation only in create mode, or in edit mode when national ID was changed
  const nationalIdWasEdited = isEdit ? form.identifierValue !== originalNationalId : true;
  const nationalIdIsPasteConfirmed = nationalIdConfirmedByPaste === form.identifierValue && isValidNationalId(form.identifierValue);
  const showConfirmation = isNationalId && nationalIdWasEdited && isValidNationalId(form.identifierValue) && !nationalIdIsPasteConfirmed;
  const showPasteConfirmedNote = isNationalId && nationalIdWasEdited && nationalIdIsPasteConfirmed;
  const submitLabel = mutation.isPending
    ? (isEdit ? (language === "ar" ? "جاري التحديث…" : "Updating…") : (language === "ar" ? "جاري التسجيل…" : "Registering…"))
    : (isEdit ? (language === "ar" ? "تحديث المريض" : "Update Patient") : (language === "ar" ? "تسجيل المريض" : "Register Patient"));
  const hasPotentialDuplicates = !isEdit && dupQuery.length > 1 && duplicates.length > 0;
  const duplicateWarningText = language === "ar"
    ? "يوجد تطابق محتمل أسفل الصفحة. راجع القائمة قبل المتابعة."
    : "Possible matches are listed below. Please review them before continuing.";
  const duplicateFocusClass = "border-amber-400 bg-amber-50/80 shadow-[0_0_0_1px_rgba(245,158,11,0.20)]";
  const duplicateLabelClass = "text-amber-700";
  const isDuplicateField = (field: FormFieldKey) => hasPotentialDuplicates && duplicateFocusField === field;

  if (isEdit && loadingPatient) {
    return (
      <Card className="p-12 text-center">
        <p className="text-muted-foreground">{language === "ar" ? "جاري تحميل بيانات المريض…" : "Loading patient data…"}</p>
      </Card>
    );
  }

  // ============================================================
  // Shared form fields JSX (rendered in both create and edit)
  // ============================================================
  const formFields = (
    <form id="patient-form" onSubmit={handleSubmit} onKeyDown={handleFormKeyDown} noValidate className="space-y-5">
      {/* Identity */}
      <div className="space-y-4">
        <div className="flex items-center gap-4">
          <h3 className={sectionTitleClass}>{language === "ar" ? "الهوية" : "Identity"}</h3>
          <PatientCategoryBadge category={form.category || null} showWhenUnset />
        </div>
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <div>
            <label className={`${fieldLabelClass} ${isDuplicateField("arabicFullName") ? duplicateLabelClass : ""}`}>{language === "ar" ? "الاسم العربي" : "Arabic Full Name"}</label>
            <input
              aria-label={language === "ar" ? "الاسم العربي" : "Arabic Full Name"}
              value={form.arabicFullName}
              onChange={(e) => {
                setDuplicateFocusField("arabicFullName");
                handleArabicNameChange(e.target.value);
              }}
              onBlur={() => { if (form.arabicFullName && !form.arabicFullName.endsWith(" ")) handleArabicNameChange(form.arabicFullName + " "); }}
              onKeyDown={handleEnterNavigation("arabicFullName")}
              required
              dir="rtl"
              ref={arabicFullNameRef}
              className={`input-premium input-rtl w-full ${isDuplicateField("arabicFullName") ? duplicateFocusClass : ""}`}
            />
          </div>
          <div>
            <label className={`${fieldLabelClass} ${isDuplicateField("englishFullName") ? duplicateLabelClass : ""}`}>{language === "ar" ? "الاسم الإنجليزي" : "English Full Name"}</label>
            <input
              aria-label={language === "ar" ? "الاسم الإنجليزي" : "English Full Name"}
              value={form.englishFullName}
              onChange={(e) => {
                setDuplicateFocusField("englishFullName");
                handleEnglishNameChange(e.target.value);
              }}
              onKeyDown={handleEnterNavigation("englishFullName")}
              dir="ltr"
              ref={englishFullNameRef}
              className={`input-premium input-ltr w-full ${isDuplicateField("englishFullName") ? duplicateFocusClass : ""}`}
            />
            {form.arabicFullName && !englishNameManuallyEdited && (
              <p className={helperTextClass}>
                {currentMissingTokens.length === 0
                  ? (language === "ar" ? "مُولّد من قاموس الأسماء." : "Generated from name dictionary.")
                  : (language === "ar" ? "توليد غير مكتمل: توجد رموز عربية غير موجودة في القاموس." : "Generation incomplete: unresolved Arabic token(s) found in dictionary lookup.")}
                <button type="button" onClick={handleRegenerateEnglishName} className="ml-2 text-accent hover:underline">{language === "ar" ? "إعادة توليد" : "Regenerate"}</button>
              </p>
            )}
            {englishNameManuallyEdited && (
              <p className="mt-2 text-sm font-medium text-amber-600">{language === "ar" ? "تم التحرير يدوياً. لن تؤثر التغييرات على الاسم العربي." : "Manually edited. Changes to Arabic name will not override this."}</p>
            )}
          </div>
        </div>
        {hasShortArabicNameWarning && (
          <p className="text-sm font-semibold text-amber-600">
            {language === "ar" ? "تنبيه: الاسم العربي عادة يتكون من 3 أجزاء على الأقل." : "Warning: patient name usually includes at least 3 parts."}
          </p>
        )}
        {hasPotentialDuplicates && (
          <div className="rounded-2xl border border-amber-300 bg-amber-50 px-4 py-3 text-amber-800 shadow-sm">
            <p className="text-sm font-semibold">{duplicateWarningText}</p>
          </div>
        )}

        {currentMissingTokens.length > 0 && (
          <Card className="p-3 sm:p-4 border-amber-200" style={{ background: "rgba(245, 158, 11, 0.05)" }}>
            <p className="text-sm font-semibold text-amber-700 mb-3">{language === "ar" ? "رموز اسم غير معروفة - أضفها إلى القاموس:" : "Unrecognized name tokens — add to dictionary:"}</p>
            {currentMissingTokens.map((token) => (
              <div key={token} className="flex items-center gap-3 mb-2">
                <span className="text-sm font-mono" dir="rtl">{token}</span>
                <input
                  type="text"
                  value={missingTokenInputs[token] ?? ""}
                  onChange={(e) => setMissingTokenInputs((p) => ({ ...p, [token]: e.target.value }))}
                  placeholder={language === "ar" ? "الترجمة الإنجليزية…" : "English translation…"}
                  className="flex-1 input-premium h-10 text-sm"
                />
                <Button
                  type="button"
                  size="sm"
                  disabled={!missingTokenInputs[token]?.trim() || addingToken === token}
                  onClick={() => handleAddTokenToDictionary(token)}
                >
                  {addingToken === token ? (language === "ar" ? "جاري الإضافة…" : "Adding…") : (language === "ar" ? "إضافة" : "Add")}
                </Button>
              </div>
            ))}
            {addTokenError && <p className="text-sm text-red-500 mt-2">{addTokenError}</p>}
          </Card>
        )}

        <Card className="p-3 sm:p-4">
          <div className="flex items-start justify-between gap-3 mb-3">
            <div className="min-w-0">
              <p className="text-sm font-semibold text-foreground">{language === "ar" ? "المعرف" : "Identifier"}</p>
              {!isEdit && (
                <p className="mt-1 text-xs text-muted-foreground">
                  <span className="font-semibold">{t("patients.autoMrn")}:</span>{" "}
                  <span className="font-mono text-foreground">
                    {mrnPreviewLoading || !mrnPreview?.mrn ? t("patients.autoMrnGenerating") : mrnPreview.mrn}
                  </span>
                </p>
              )}
            </div>
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
              {language === "ar" ? "إضافة معرف" : "Add identifier"}
            </button>
          </div>
          {form.identifiers.map((entry, idx) => (
            <div key={`identifier-${idx}`} className="grid grid-cols-1 md:grid-cols-4 gap-2 items-center mb-2">
              <select
                aria-label={language === "ar" ? "نوع المعرف" : "Identifier Type"}
                value={entry.typeCode}
                ref={idx === 0 ? identifierTypeRef : undefined}
                onChange={(e) =>
                  setForm((f) => {
                    if (idx === 0) setDuplicateFocusField("identifierValue");
                    const next = [...f.identifiers];
                    const nextType = e.target.value as IdentifierType;
                    const nextValue = normalizeIdentifierForType(nextType, next[idx]?.value || "");
                    next[idx] = { ...next[idx], typeCode: nextType, value: nextValue };
                    if (next[idx]?.isPrimary) {
                      setNationalIdConfirmedByPaste(null);
                      return applyPrimaryIdentifierState(f, next, nextType, nextValue);
                    }
                    return { ...f, identifiers: next };
                  })
                }
                className={`input-premium h-10 text-sm ${idx === 0 && isDuplicateField("identifierValue") ? duplicateFocusClass : ""}`}
              >
                {identifierTypeOptions.map((type) => (
                  <option key={type.code} value={type.code}>
                    {chooseLocalized(language, type.labelAr, type.labelEn)}
                  </option>
                ))}
              </select>
              <input
                aria-label={
                  entry.typeCode === "passport"
                    ? (language === "ar" ? "رقم الجواز" : "Passport Number")
                    : entry.typeCode === "national_id"
                      ? (language === "ar" ? "الرقم الوطني" : "National ID")
                      : (language === "ar" ? "قيمة المعرف" : "Identifier Value")
                }
                value={entry.value}
                ref={idx === 0 ? identifierValueRef : undefined}
                onChange={(e) =>
                  setForm((f) => {
                    if (idx === 0) setDuplicateFocusField("identifierValue");
                    return applyPrimaryIdentifierInputChange(f, idx, e.target.value);
                  })
                }
                onPaste={(event) => handlePrimaryIdentifierPaste(event, idx)}
                type={idx === 0 && entry.typeCode === "national_id" && showConfirmation ? "password" : "text"}
                placeholder={language === "ar" ? "قيمة المعرف" : "Identifier value"}
                className={`md:col-span-2 input-premium h-10 text-sm ${idx === 0 && isDuplicateField("identifierValue") ? duplicateFocusClass : ""}`}
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
                        setNationalIdConfirmedByPaste(null);
                        return applyPrimaryIdentifierState(
                          f,
                          nextIdentifiers,
                          (primary?.typeCode || f.identifierType) as IdentifierType,
                          primary?.value || ""
                        );
                      })
                    }
                  />
                  {language === "ar" ? "أساسي" : "Primary"}
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
                        setNationalIdConfirmedByPaste(null);
                        return applyPrimaryIdentifierState(
                          f,
                          next,
                          (primary?.typeCode || "national_id") as IdentifierType,
                          primary?.value || ""
                        );
                      })
                    }
                  >
                    {language === "ar" ? "إزالة" : "Remove"}
                  </button>
                )}
              </div>
            </div>
          ))}
          {showConfirmation && (
            <div className="mt-3">
              <label className={fieldLabelClass}>{language === "ar" ? "تأكيد الرقم الوطني" : "Confirm National ID"}</label>
              <input
                aria-label={language === "ar" ? "تأكيد الرقم الوطني" : "National ID Confirmation"}
                value={form.nationalIdConfirmation}
                onChange={(v) => setForm((f) => ({ ...f, nationalIdConfirmation: v.target.value.replace(/\D/g, "") }))}
                onKeyDown={handleEnterNavigation("nationalIdConfirmation")}
                maxLength={12}
                ref={nationalIdConfirmationRef}
                onPaste={(e) => { e.preventDefault(); e.stopPropagation(); }}
                onDragOver={(e) => { e.preventDefault(); e.stopPropagation(); }}
                onDrop={(e) => { e.preventDefault(); e.stopPropagation(); }}
                placeholder={language === "ar" ? "أعد كتابة الرقم الوطني" : "Re-type the National ID"}
                required={nationalIdWasEdited}
                className="input-premium input-ltr w-full"
              />
            </div>
          )}
          {showPasteConfirmedNote && (
            <p className={helperTextClass}>
              {language === "ar" ? "تم تأكيد الرقم الوطني من اللصق." : "Confirmed from paste."}
            </p>
          )}
        </Card>
      </div>

      {/* Demographics */}
      <div className="space-y-4">
        <div className="flex items-center gap-4">
          <h3 className={sectionTitleClass}>{language === "ar" ? "البيانات الديموغرافية" : "Demographics"}</h3>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          <div>
            <label className={fieldLabelClass}>{language === "ar" ? "الجنس" : "Sex"}</label>
            <select
              aria-label={language === "ar" ? "الجنس" : "Sex"}
              value={form.sex}
              onChange={(v) => setForm((f) => ({ ...f, sex: v.target.value }))}
              onKeyDown={handleEnterNavigation("sex")}
              ref={sexRef}
              required
              className="input-premium input-ltr w-full"
            >
              <option value="">{language === "ar" ? "اختر..." : "Select..."}</option>
              <option value="M">{language === "ar" ? "ذكر" : "Male"}</option>
              <option value="F">{language === "ar" ? "أنثى" : "Female"}</option>
            </select>
          </div>
          <div>
            <DateInput
              label={language === "ar" ? "تاريخ الميلاد" : "Date of Birth"}
              value={form.estimatedDateOfBirth}
              onChange={handleDobChange}
              onKeyDown={handleEnterNavigation("estimatedDateOfBirth")}
              inputRef={dobRef}
              name="estimatedDateOfBirth"
            />
          </div>
          <div>
            <label className={fieldLabelClass}>{language === "ar" ? "العمر (سنوات)" : "Age (years)"}</label>
            <input
              aria-label={language === "ar" ? "العمر (سنوات)" : "Age (years)"}
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
          <div>
            <label className={fieldLabelClass}>
              {language === "ar" ? "تصنيف الحالة *" : "Patient Category *"}
            </label>
            <select
              aria-label={language === "ar" ? "تصنيف الحالة" : "Patient Category"}
              value={form.category}
              onChange={(event) =>
                setForm((f) => ({
                  ...f,
                  category: (event.target.value as "" | "oncology" | "non_oncology") || "",
                }))
              }
              required
              ref={categoryRef}
              className="input-premium input-ltr w-full"
            >
              <option value="">{language === "ar" ? "اختر التصنيف..." : "Select category..."}</option>
              <option value="oncology">{language === "ar" ? "أورام" : "Oncology"}</option>
              <option value="non_oncology">{language === "ar" ? "غير أورام" : "Non-oncology"}</option>
            </select>
          </div>
        </div>
        <label className="flex items-center gap-3 cursor-pointer user-select-none p-2 rounded-lg hover:bg-muted/50">
          <input
            type="checkbox"
            checked={form.demographicsEstimated}
            onChange={(event) => setForm((f) => ({ ...f, demographicsEstimated: event.target.checked }))}
            className="w-5 h-5 cursor-pointer accent-[var(--accent)]"
          />
          <span className="text-base font-semibold">{language === "ar" ? "تقديري (تاريخ/عمر غير مؤكد)" : "Estimated (uncertain DOB/age)"}</span>
        </label>
        {isNationalId && isValidNationalId(form.identifierValue) && (
          <p className="text-sm font-semibold text-accent">{language === "ar" ? "تم استنتاج البيانات تلقائياً من الرقم الوطني. يمكنك تعديلها يدوياً." : "Demographics auto-derived from National ID. You can override them manually."}</p>
        )}
      </div>

      {/* Contact */}
      <div className="space-y-4">
        <div className="flex items-center gap-4">
          <h3 className={sectionTitleClass}>{language === "ar" ? "التواصل" : "Contact"}</h3>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label className={`${fieldLabelClass} ${isDuplicateField("phone1") ? duplicateLabelClass : ""}`}>{language === "ar" ? "الهاتف 1 (مطلوب)" : "Phone 1 (Required)"}</label>
          <input
            aria-label={language === "ar" ? "الهاتف 1" : "Phone 1"}
            value={form.phone1}
              onChange={(v) => {
                setDuplicateFocusField("phone1");
                setForm((f) => ({ ...f, phone1: normalizePhoneInput(v.target.value) }));
              }}
              onKeyDown={handleEnterNavigation("phone1")}
              ref={phone1Ref}
              maxLength={10}
              required
              className={`input-premium input-ltr w-full ${isDuplicateField("phone1") ? duplicateFocusClass : ""}`}
            />
          </div>
          <div>
            <label className={fieldLabelClass}>{language === "ar" ? "الهاتف 2 (اختياري)" : "Phone 2 (Optional)"}</label>
          <input
            aria-label={language === "ar" ? "الهاتف 2" : "Phone 2"}
            value={form.phone2}
              onChange={(v) => setForm((f) => ({ ...f, phone2: normalizePhoneInput(v.target.value) }))}
              onKeyDown={handleEnterNavigation("phone2")}
              ref={phone2Ref}
              maxLength={10}
              className="input-premium input-ltr w-full"
            />
          </div>
          <div className="md:col-span-2">
            <label className={fieldLabelClass}>{language === "ar" ? "المدينة" : "City"}</label>
          <select
            aria-label={language === "ar" ? "المدينة" : "City"}
            value={form.address}
              onChange={(v) => setForm((f) => ({ ...f, address: v.target.value }))}
              onKeyDown={handleEnterNavigation("address")}
              ref={addressRef}
              className="input-premium input-ltr w-full"
            >
              <option value="">{language === "ar" ? "اختر مدينة..." : "Select a city..."}</option>
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
      <div className="flex flex-col sm:flex-row gap-3 pt-4 border-t border-border">
        {isEdit && canDeletePatient && (
          <Button
            type="button"
            variant="secondary"
            onClick={() => {
              if (window.confirm(language === "ar" ? "هل تريد حذف هذا المريض؟ لا يمكن التراجع عن ذلك." : "Delete this patient? This cannot be undone.")) {
                deleteMutation.mutate();
              }
            }}
            disabled={deleteMutation.isPending || mutation.isPending}
            style={{ color: "#ef4444", borderColor: "rgba(239, 68, 68, 0.3)", backgroundColor: "rgba(239, 68, 68, 0.05)" }}
          >
            {deleteMutation.isPending ? (language === "ar" ? "جاري الحذف…" : "Deleting...") : (language === "ar" ? "حذف المريض" : "Delete Patient")}
          </Button>
        )}
        {isEdit && onCancel && (
          <Button
            type="button"
            variant="secondary"
            onClick={onCancel}
          >
            {language === "ar" ? "إلغاء" : "Cancel"}
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
      <div className="grid grid-cols-1 xl:grid-cols-[minmax(0,1.35fr)_minmax(320px,0.85fr)] gap-4 xl:gap-5">
        <Card className="p-4 sm:p-5">{formFields}</Card>
        <div className="space-y-4">
          <Card className="p-4" style={{ background: "rgba(245, 158, 11, 0.05)", borderColor: "rgba(245, 158, 11, 0.3)" }}>
            <h3 className="text-sm font-semibold text-amber-600 mb-4">
              {language === "ar" ? "التطابقات المحتملة" : "Possible Duplicates"} {dupQuery.length > 1 ? `(${duplicates.length})` : ""}
            </h3>
            {dupQuery.length <= 1 ? (
              <p className="text-sm font-medium text-amber-700">{language === "ar" ? "اكتب حرفين على الأقل في الهاتف أو الاسم أو المعرف للتحقق من التطابقات." : "Type at least 2 characters in phone, name, or identifier to check matches."}</p>
            ) : duplicatesLoading ? (
              <p className="text-sm text-amber-700">{language === "ar" ? "جاري التحقق من التطابقات المحتملة…" : "Checking possible matches…"}</p>
            ) : duplicates.length === 0 ? (
              <p className="text-sm text-amber-700">{language === "ar" ? "لم يتم العثور على تطابقات محتملة." : "No possible matches found."}</p>
            ) : (
              <ul className="space-y-3">
                {duplicates.slice(0, 5).map((p) => (
                  <li key={p.id} className="bg-card rounded-xl border border-border overflow-hidden">
                    <button
                      type="button"
                      onClick={() => setPreviewPatient(p)}
                      className="w-full p-4 space-y-1 text-right hover:bg-muted/50 transition-colors"
                    >
                      <p className="font-semibold text-foreground">{p.arabicFullName}</p>
                      {p.englishFullName && <p className="text-xs text-muted-foreground">{p.englishFullName}</p>}
                      <p className="text-xs font-medium text-muted-foreground">
                        {p.identifierValue || p.nationalId || (language === "ar" ? "لا يوجد معرف" : "No ID")}{p.identifierType && p.identifierType !== "national_id" && ` (${p.identifierType})`}{" • "}{language === "ar" ? "رقم الملف" : "MRN"}: {p.mrn || "—"}
                      </p>
                      {p.phone1 && <p className="text-xs text-muted-foreground">{language === "ar" ? "الهاتف:" : "Phone:"} {p.phone1}</p>}
                      {p.address && <p className="text-xs text-muted-foreground">{language === "ar" ? "المدينة:" : "City:"} {chooseLocalized(language, LIBYAN_CITIES.find((c) => c.code === p.address)?.nameAr, LIBYAN_CITIES.find((c) => c.code === p.address)?.nameEn) || p.address}</p>}
                    </button>
                    <div className="flex gap-2 border-t border-border">
                      <button
                        type="button"
                        onClick={() => navigate(`/patients/${p.id}/edit`)}
                        className="flex-1 text-center py-3 px-2 text-amber-700 text-xs font-medium hover:bg-amber-50 dark:hover:bg-amber-900/20 transition-colors"
                      >
                        {language === "ar" ? "تعديل المريض" : "Edit Patient"}
                      </button>
                      <button
                        type="button"
                        onClick={() => navigate(`/appointments?patientId=${p.id}`)}
                        className="flex-1 text-center py-3 px-2 text-accent text-xs font-medium hover:bg-accent/5 transition-colors"
                      >
                        {language === "ar" ? "إنشاء موعد" : "Create Appointment"}
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
                  <h3 className={sectionTitleClass}>{language === "ar" ? "تفاصيل المريض" : "Patient Details"}</h3>
                  <button onClick={() => setPreviewPatient(null)} className="text-muted-foreground hover:text-foreground">✕</button>
                </div>
                <div className="space-y-3">
                  <Field label={language === "ar" ? "الاسم العربي" : "Arabic Name"} value={previewPatient.arabicFullName} />
                  {previewPatient.englishFullName && <Field label={language === "ar" ? "الاسم الإنجليزي" : "English Name"} value={previewPatient.englishFullName} />}
                  <Field label={language === "ar" ? "المعرف" : "Identifier"} value={`${previewPatient.identifierValue || previewPatient.nationalId || (language === "ar" ? "لا يوجد معرف" : "No ID")}${previewPatient.identifierType && previewPatient.identifierType !== "national_id" ? ` (${previewPatient.identifierType})` : ""}`} />
                  <Field label={language === "ar" ? "رقم الملف" : "MRN"} value={previewPatient.mrn || "—"} />
                  <Field label={language === "ar" ? "الجنس" : "Sex"} value={previewPatient.sex === "M" ? (language === "ar" ? "ذكر" : "Male") : previewPatient.sex === "F" ? (language === "ar" ? "أنثى" : "Female") : previewPatient.sex} />
                  <Field label={language === "ar" ? "العمر" : "Age"} value={previewPatient.ageYears ? `${previewPatient.ageYears} ${language === "ar" ? "سنة" : "years"}${previewPatient.demographicsEstimated ? (language === "ar" ? " (تقديري)" : " (Estimated)") : ""}` : "—"} />
                  <Field label={language === "ar" ? "تاريخ الميلاد" : "DOB"} value={previewPatient.estimatedDateOfBirth ? formatDateLy(previewPatient.estimatedDateOfBirth) : "—"} />
                  <Field label={language === "ar" ? "الهاتف" : "Phone"} value={previewPatient.phone1 || "—"} />
                  {previewPatient.phone2 && <Field label={language === "ar" ? "الهاتف 2" : "Phone 2"} value={previewPatient.phone2} />}
                  {previewPatient.address && <Field label={language === "ar" ? "المدينة" : "City"} value={chooseLocalized(language, LIBYAN_CITIES.find((c) => c.code === previewPatient.address)?.nameAr, LIBYAN_CITIES.find((c) => c.code === previewPatient.address)?.nameEn) || previewPatient.address} />}
                </div>
                <div className="flex gap-3 pt-4 border-t border-border mt-4">
                  <Button
                    variant="secondary"
                    onClick={() => navigate(`/patients/${previewPatient.id}/edit`)}
                    className="flex-1"
                  >
                    {language === "ar" ? "تعديل" : "Edit"}
                  </Button>
                  <Button
                    onClick={() => navigate(`/appointments?patientId=${previewPatient.id}`)}
                    className="flex-1"
                  >
                    {language === "ar" ? "إنشاء موعد" : "Create Appointment"}
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
                  <h3 className="text-2xl font-display font-bold">{language === "ar" ? "تم تسجيل المريض" : "Patient registered"}</h3>
                  <p className="text-muted-foreground">
                    {language === "ar" ? "اختر ما تريد فعله بعد ذلك لـ" : "Choose what to do next for"} {postCreatePatient.arabicFullName}.
                  </p>
                </div>
                <div className="flex flex-col gap-3">
                  <Button
                    type="button"
                    onClick={() => navigate(`/appointments?patientId=${postCreatePatient.id}`)}
                    className="w-full"
                  >
                    {language === "ar" ? "إنشاء موعد لهذا المريض" : "Create appointment for this patient"}
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
                      {language === "ar" ? "تسجيل مريض آخر" : "Register another patient"}
                  </Button>
                  <Button
                    type="button"
                    variant="secondary"
                    onClick={() => setPostCreatePatient(null)}
                    className="w-full"
                  >
                    {language === "ar" ? "إغلاق" : "Close"}
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
      <Card className="p-4 sm:p-5">{formFields}</Card>
      {toast && <Toast message={toast.message} type={toast.type} onClose={() => setToast(null)} />}
    </div>
  );
}

// -- Sub-components --

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between items-baseline py-2 border-b border-border last:border-b-0">
      <span className="text-sm font-semibold text-foreground">{label}</span>
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
