/**
 * Appointments V2 — Patient search component.
 *
 * Debounced patient search with dropdown results.
 * Follows the established pattern from legacy appointments-page.tsx.
 */

import { useState, useRef, useCallback, useEffect } from "react";
import { X } from "lucide-react";
import { SearchInput } from "@/components/shared/SearchInput";
import { PatientCategoryBadge } from "@/components/patients/patient-category-badge";
import { searchV2AppointmentPatients, verifyV2AppointmentPatientIdentity } from "../api";
import type { AppointmentPatientSelection, PatientIdentityVerificationMethod } from "../types";
import { Button, Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, Input } from "@/components/shared";
import { t } from "@/lib/i18n";
import { useLanguage } from "@/providers/language-provider";
import { formatAppointmentPatientName } from "../utils/patient-display-name";

interface Patient extends Partial<AppointmentPatientSelection> {
  id: number;
  arabicFullName: string;
  englishFullName?: string | null;
  category?: "oncology" | "non_oncology" | null;
  identifierType?: string | null;
  identifierValue?: string | null;
  nationalId?: string | null;
  mrn?: string | null;
  medicalRecordNo?: string | null;
  phone?: string | null;
  phone1?: string | null;
  sex?: string | null;
  ageYears?: number | null;
  demographicsEstimated?: boolean;
  estimatedDateOfBirth?: string | null;
  identityRisk?: "none" | "ambiguous";
  similarPatientCount?: number;
  availableVerificationMethods?: PatientIdentityVerificationMethod[];
  maskedPrimaryIdentifier?: string | null;
  maskedPhone1?: string | null;
  patientIdentityVerificationProof?: string | null;
  patientIdentityVerificationMethod?: PatientIdentityVerificationMethod | null;
  patientIdentitySelectionSource?: "search" | "url_preselect";
}

interface PatientSearchProps {
  onSelect: (patient: Patient) => void;
  selectedPatient: Patient | null;
  onClear: () => void;
  caseCategory: "oncology" | "non_oncology";
  transliterateMissingEnglish?: boolean;
  locked?: boolean;
}

function getPrimaryIdentifier(patient: Patient, language: "ar" | "en"): { label: string; value: string | null } {
  if (patient.maskedPrimaryIdentifier) {
    return {
      label: t(language, "appointments.create.primaryId"),
      value: patient.maskedPrimaryIdentifier,
    };
  }

  if (patient.identifierValue) {
    return {
      label: t(language, "appointments.create.primaryId"),
      value: patient.identifierValue,
    };
  }

  if (patient.nationalId) {
    return {
      label: t(language, "appointments.create.primaryId"),
      value: patient.nationalId,
    };
  }

  const mrn = patient.mrn || patient.medicalRecordNo || null;
  if (mrn) {
    return {
      label: t(language, "appointments.create.mrn"),
      value: mrn,
    };
  }

  return { label: t(language, "appointments.create.primaryId"), value: null };
}

function renderSex(sex?: string | null, language: "ar" | "en" = "en"): string {
  if (!sex) return "—";
  if (sex.toUpperCase() === "M") return t(language, "appointments.create.male");
  if (sex.toUpperCase() === "F") return t(language, "appointments.create.female");
  return sex;
}

interface IdentityVerificationDialogProps {
  language: "ar" | "en";
  patient: Patient | null;
  method: PatientIdentityVerificationMethod | null;
  evidence: string;
  error: string | null;
  verifying: boolean;
  onClose: () => void;
  onMethodChange: (method: PatientIdentityVerificationMethod) => void;
  onEvidenceChange: (value: string) => void;
  onSubmit: () => void;
}

function IdentityVerificationDialog({
  language,
  patient,
  method,
  evidence,
  error,
  verifying,
  onClose,
  onMethodChange,
  onEvidenceChange,
  onSubmit,
}: IdentityVerificationDialogProps) {
  const methods = patient?.availableVerificationMethods ?? [];
  return (
    <Dialog open={patient != null} onClose={onClose}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t(language, "appointments.identity.verifyTitle")}</DialogTitle>
          <DialogDescription>{t(language, "appointments.identity.verifyDescription")}</DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          {methods.map((availableMethod) => (
            <label key={availableMethod} className="flex items-center gap-2 text-sm">
              <input type="radio" checked={method === availableMethod} onChange={() => onMethodChange(availableMethod)} />
              {availableMethod === "primary_identifier" ? t(language, "appointments.identity.methodPrimaryIdentifier") : availableMethod === "exact_dob" ? t(language, "appointments.identity.methodExactDob") : t(language, "appointments.identity.methodPhoneSuffix")}
            </label>
          ))}
          {methods.length === 0 ? (
            <p className="text-sm text-amber-700">{t(language, "appointments.identity.noUsableMethod")}</p>
          ) : (
            <Input
              value={evidence}
              onChange={(event) => onEvidenceChange(event.target.value)}
              placeholder={method === "exact_dob" ? "YYYY-MM-DD" : method === "phone_suffix" ? t(language, "appointments.identity.phoneSuffixPlaceholder") : t(language, "appointments.identity.primaryIdentifierPlaceholder")}
            />
          )}
          {error ? <p className="text-sm text-red-600">{error}</p> : null}
        </div>
        <DialogFooter>
          <Button variant="secondary" onClick={onClose}>{t(language, "appointments.create.cancel")}</Button>
          <Button onClick={onSubmit} disabled={verifying || !method || !evidence.trim()}>{verifying ? t(language, "appointments.identity.verifying") : t(language, "appointments.identity.verifyAndSelect")}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function PatientSearch({
  onSelect,
  selectedPatient,
  onClear,
  caseCategory,
  transliterateMissingEnglish = false,
  locked = false,
}: PatientSearchProps) {
  const { language } = useLanguage();
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<Patient[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [verificationPatient, setVerificationPatient] = useState<Patient | null>(null);
  const [verificationMethod, setVerificationMethod] = useState<PatientIdentityVerificationMethod | null>(null);
  const [verificationEvidence, setVerificationEvidence] = useState("");
  const [verificationError, setVerificationError] = useState<string | null>(null);
  const [verifying, setVerifying] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const handleSearch = useCallback((value: string) => {
    setQuery(value);
    if (timerRef.current !== null) clearTimeout(timerRef.current);

    if (value.length > 1) {
      setIsSearching(true);
      timerRef.current = setTimeout(() => {
        searchV2AppointmentPatients(value)
          .then((patients) => {
            setResults(patients as Patient[]);
            setIsSearching(false);
          })
          .catch(() => {
            setResults([]);
            setIsSearching(false);
          });
        timerRef.current = null;
      }, 300);
    } else {
      setResults([]);
      setIsSearching(false);
    }
  }, []);

  const selectPatient = (patient: Patient) => {
    if (patient.identityRisk === "ambiguous") {
      setVerificationPatient(patient);
      setVerificationMethod(patient.availableVerificationMethods?.[0] ?? null);
      setVerificationEvidence("");
      setVerificationError(null);
      return;
    }
    onSelect({ ...patient, patientIdentitySelectionSource: "search" });
    setQuery("");
    setResults([]);
  };

  const closeVerification = () => {
    setVerificationPatient(null); setVerificationMethod(null); setVerificationEvidence(""); setVerificationError(null);
  };

  const selectVerificationMethod = (method: PatientIdentityVerificationMethod) => {
    setVerificationMethod(method);
    setVerificationEvidence("");
  };

  const submitVerification = async () => {
    if (!verificationPatient || !verificationMethod || !verificationEvidence.trim()) return;
    setVerifying(true); setVerificationError(null);
    try {
      const result = await verifyV2AppointmentPatientIdentity(verificationPatient.id, verificationMethod, verificationEvidence);
      onSelect({ ...verificationPatient, patientIdentityVerificationProof: result.proof, patientIdentityVerificationMethod: result.verificationMethod });
      setQuery(""); setResults([]); closeVerification();
    } catch (error) {
      setVerificationError(error instanceof Error ? error.message : t(language, "appointments.identity.verificationFailed"));
    } finally { setVerifying(false); }
  };

  useEffect(() => {
    return () => {
      if (timerRef.current !== null) clearTimeout(timerRef.current);
    };
  }, []);

  if (selectedPatient) {
    const primaryIdentifier = getPrimaryIdentifier(selectedPatient, language);
    const mrn = selectedPatient.mrn || selectedPatient.medicalRecordNo || null;
    const showMrn = mrn != null && !(primaryIdentifier.label === t(language, "appointments.create.mrn") && primaryIdentifier.value === mrn);
    const displayName = transliterateMissingEnglish
      ? formatAppointmentPatientName(language, selectedPatient, `Patient #${selectedPatient.id}`)
      : (language === "ar"
        ? selectedPatient.arabicFullName
        : (selectedPatient.englishFullName || selectedPatient.arabicFullName));

    return (
      <>
      <div
        style={{
          display: "flex",
          alignItems: "flex-start",
          justifyContent: "space-between",
          gap: 12,
          padding: "12px 14px",
          borderRadius: "var(--radius-md)",
          backgroundColor: "rgba(34, 197, 94, 0.1)",
          border: "1px solid rgba(34, 197, 94, 0.3)",
        }}
      >
        <div style={{ minWidth: 0 }}>
          <div style={{ fontWeight: 600, fontSize: 14, lineHeight: 1.3 }}>
            <span>{displayName}</span>
            <span style={{ marginInlineStart: 8 }}>
              <PatientCategoryBadge category={selectedPatient.category} showWhenUnset />
            </span>
          </div>
          <div style={{ fontSize: 12, color: "var(--text-muted, #64748b)", marginTop: 2 }}>
            {language === "ar"
              ? (selectedPatient.englishFullName || selectedPatient.arabicFullName)
              : (selectedPatient.arabicFullName || selectedPatient.englishFullName)}
          </div>
          <div style={{ fontSize: 12, color: "var(--text-muted, #64748b)", marginTop: 4 }}>
            {primaryIdentifier.value ? `${t(language, "appointments.create.primaryId")}: ${primaryIdentifier.value}` : `${t(language, "appointments.create.primaryId")}: —`}
            {showMrn ? ` · ${t(language, "appointments.create.mrn")}: ${mrn}` : ""}
          </div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 10, fontSize: 12, color: "var(--text-muted, #64748b)", marginTop: 6 }}>
            <span>{t(language, "appointments.create.sex")}: {renderSex(selectedPatient.sex, language)}</span>
            <span>
              {t(language, "appointments.create.age")}: {selectedPatient.ageYears ?? "—"}
              {selectedPatient.demographicsEstimated ? ` (${t(language, "appointments.identity.estimated")})` : ""}
            </span>
            <span>{t(language, "appointments.create.categoryLabel")}: {caseCategory === "oncology" ? t(language, "appointments.create.oncology") : t(language, "appointments.create.nonOncology")}</span>
          </div>
          {selectedPatient.identityRisk === "ambiguous" && !selectedPatient.patientIdentityVerificationProof ? <Button variant="secondary" onClick={() => { setVerificationPatient(selectedPatient); setVerificationMethod(selectedPatient.availableVerificationMethods?.[0] ?? null); setVerificationEvidence(""); setVerificationError(null); }} className="mt-2">{t(language, "appointments.identity.verifyIdentity")}</Button> : null}
        </div>
        {!locked ? <button
          type="button"
          onClick={onClear}
          style={{
            background: "none",
            border: "none",
            cursor: "pointer",
            padding: 4,
            color: "var(--text-muted, #64748b)",
          }}
          title={t(language, "appointments.create.clearSelection")}
        >
          <X size={18} />
        </button> : null}
      </div>
      <IdentityVerificationDialog language={language} patient={verificationPatient} method={verificationMethod} evidence={verificationEvidence} error={verificationError} verifying={verifying} onClose={closeVerification} onMethodChange={selectVerificationMethod} onEvidenceChange={setVerificationEvidence} onSubmit={submitVerification} />
      </>
    );
  }

  return (
    <>
    <div style={{ position: "relative" }}>
      <SearchInput
        value={query}
        onChange={(e) => handleSearch(e.target.value)}
        placeholder={t(language, "appointments.create.searchPatientPlaceholder")}
        isLoading={isSearching}
      />

      {results.length > 0 && (
        <ul
          style={{
            position: "absolute",
            top: "100%",
            left: 0,
            right: 0,
            zIndex: 10,
            maxHeight: 200,
            overflowY: "auto",
            margin: 0,
            padding: 0,
            listStyle: "none",
            borderRadius: "var(--radius-md)",
            border: "1px solid var(--border)",
            backgroundColor: "var(--background)",
            boxShadow: "var(--shadow-floating)",
          }}
        >
          {results.map((patient) => {
            const primaryIdentifier = getPrimaryIdentifier(patient, language);
            const mrn = patient.mrn || patient.medicalRecordNo || null;
            const showMrn = mrn != null && !(primaryIdentifier.label === t(language, "appointments.create.mrn") && primaryIdentifier.value === mrn);
            const displayName = transliterateMissingEnglish
              ? formatAppointmentPatientName(language, patient, `Patient #${patient.id}`)
              : (language === "ar"
                ? patient.arabicFullName
                : (patient.englishFullName || patient.arabicFullName));

            return (
              <li key={patient.id}>
                <button
                  type="button"
                  onClick={() => selectPatient(patient)}
                  style={{
                    width: "100%",
                    textAlign: "left",
                    padding: "8px 12px",
                    border: "none",
                    borderBottom: "1px solid var(--border-color, #f1f5f9)",
                    background: "none",
                    cursor: "pointer",
                    fontSize: 13,
                  }}
                  onMouseEnter={(e) =>
                    (e.currentTarget.style.backgroundColor = "var(--bg-hover, #f8fafc)")
                  }
                  onMouseLeave={(e) =>
                    (e.currentTarget.style.backgroundColor = "transparent")
                  }
                >
                  <div style={{ fontWeight: 500 }}>{displayName}</div>
                  <div style={{ marginTop: 4 }}>
                    <PatientCategoryBadge category={patient.category} showWhenUnset={false} />
                  </div>
                  <div style={{ fontSize: 11, color: "var(--text-muted, #64748b)" }}>
                    {language === "ar" ? (patient.englishFullName || patient.arabicFullName) : patient.arabicFullName}
                    {(patient.maskedPrimaryIdentifier || primaryIdentifier.value) ? ` · ${t(language, "appointments.create.primaryId")}: ${patient.maskedPrimaryIdentifier || primaryIdentifier.value}` : ""}
                    {showMrn ? ` · ${t(language, "appointments.create.mrn")}: ${mrn}` : ""}
                    {patient.estimatedDateOfBirth && !patient.demographicsEstimated
                      ? ` · ${t(language, "appointments.identity.exactDob")}: ${patient.estimatedDateOfBirth}`
                      : patient.demographicsEstimated && patient.estimatedDateOfBirth
                        ? ` · ${t(language, "appointments.identity.estimatedDob")}: ${patient.estimatedDateOfBirth}`
                        : ` · ${t(language, "appointments.create.age")}: ${patient.ageYears ?? "—"}${patient.demographicsEstimated ? ` (${t(language, "appointments.identity.estimated")})` : ""}`}
                    {patient.maskedPhone1 ? ` · ${patient.maskedPhone1}` : ""}
                  </div>
                  {patient.identityRisk === "ambiguous" ? <div style={{ color: "#b45309", fontSize: 11, marginTop: 2 }}>{t(language, "appointments.identity.similarNameVerificationRequired")}</div> : null}
                </button>
              </li>
            );
          })}
        </ul>
      )}

      {query.length > 1 && results.length === 0 && !isSearching && (
        <div
          style={{
            position: "absolute",
            top: "100%",
            left: 0,
            right: 0,
            zIndex: 10,
            padding: "8px 12px",
            borderRadius: 6,
            border: "1px solid var(--border-color, #e2e8f0)",
            backgroundColor: "var(--bg-surface, #fff)",
            fontSize: 13,
            color: "var(--text-muted, #64748b)",
            textAlign: "center",
          }}
        >
          {t(language, "appointments.create.noPatientsFound")}
        </div>
      )}
    </div>
    <IdentityVerificationDialog language={language} patient={verificationPatient} method={verificationMethod} evidence={verificationEvidence} error={verificationError} verifying={verifying} onClose={closeVerification} onMethodChange={selectVerificationMethod} onEvidenceChange={setVerificationEvidence} onSubmit={submitVerification} />
    </>
  );
}
