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
import { searchPatients } from "@/lib/api-hooks";
import { t } from "@/lib/i18n";
import { useLanguage } from "@/providers/language-provider";
import { formatAppointmentPatientName } from "../utils/patient-display-name";

interface Patient {
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
}

interface PatientSearchProps {
  onSelect: (patient: Patient) => void;
  selectedPatient: Patient | null;
  onClear: () => void;
  caseCategory: "oncology" | "non_oncology";
  transliterateMissingEnglish?: boolean;
}

function getPrimaryIdentifier(patient: Patient, language: "ar" | "en"): { label: string; value: string | null } {
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

export function PatientSearch({
  onSelect,
  selectedPatient,
  onClear,
  caseCategory,
  transliterateMissingEnglish = false,
}: PatientSearchProps) {
  const { language } = useLanguage();
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<Patient[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const handleSearch = useCallback((value: string) => {
    setQuery(value);
    if (timerRef.current !== null) clearTimeout(timerRef.current);

    if (value.length > 1) {
      setIsSearching(true);
      timerRef.current = setTimeout(() => {
        searchPatients(value)
          .then((patients) => {
            setResults(patients as unknown as Patient[]);
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
    onSelect(patient);
    setQuery("");
    setResults([]);
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
              {selectedPatient.demographicsEstimated ? ` ${language === "ar" ? "(مقدّر)" : "(Estimated)"}` : ""}
            </span>
            <span>{t(language, "appointments.create.categoryLabel")}: {caseCategory === "oncology" ? t(language, "appointments.create.oncology") : t(language, "appointments.create.nonOncology")}</span>
          </div>
        </div>
        <button
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
        </button>
      </div>
    );
  }

  return (
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
                    {primaryIdentifier.value ? ` · ${t(language, "appointments.create.primaryId")}: ${primaryIdentifier.value}` : ""}
                    {showMrn ? ` · ${t(language, "appointments.create.mrn")}: ${mrn}` : ""}
                  </div>
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
  );
}
