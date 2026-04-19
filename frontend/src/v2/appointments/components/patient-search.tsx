/**
 * Appointments V2 — Patient search component.
 *
 * Debounced patient search with dropdown results.
 * Follows the established pattern from legacy appointments-page.tsx.
 */

import { useState, useRef, useCallback, useEffect } from "react";
import { X } from "lucide-react";
import { SearchInput } from "@/components/shared/SearchInput";
import { searchPatients } from "@/lib/api-hooks";

interface Patient {
  id: number;
  arabicFullName: string;
  englishFullName?: string | null;
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
}

function getPrimaryIdentifier(patient: Patient): { label: string; value: string | null } {
  if (patient.identifierValue) {
    return {
      label: "Primary ID",
      value: patient.identifierValue,
    };
  }

  if (patient.nationalId) {
    return {
      label: "Primary ID",
      value: patient.nationalId,
    };
  }

  const mrn = patient.mrn || patient.medicalRecordNo || null;
  if (mrn) {
    return {
      label: "MRN",
      value: mrn,
    };
  }

  return { label: "Primary ID", value: null };
}

function renderSex(sex?: string | null): string {
  if (!sex) return "—";
  if (sex.toUpperCase() === "M") return "Male";
  if (sex.toUpperCase() === "F") return "Female";
  return sex;
}

export function PatientSearch({ onSelect, selectedPatient, onClear, caseCategory }: PatientSearchProps) {
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
    const primaryIdentifier = getPrimaryIdentifier(selectedPatient);
    const mrn = selectedPatient.mrn || selectedPatient.medicalRecordNo || null;
    const showMrn = mrn != null && !(primaryIdentifier.label === "MRN" && primaryIdentifier.value === mrn);

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
            {selectedPatient.arabicFullName}
          </div>
          <div style={{ fontSize: 12, color: "var(--text-muted, #64748b)", marginTop: 2 }}>
            {selectedPatient.englishFullName}
          </div>
          <div style={{ fontSize: 12, color: "var(--text-muted, #64748b)", marginTop: 4 }}>
            {primaryIdentifier.value ? `${primaryIdentifier.label}: ${primaryIdentifier.value}` : "Primary ID: —"}
            {showMrn ? ` · MRN: ${mrn}` : ""}
          </div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 10, fontSize: 12, color: "var(--text-muted, #64748b)", marginTop: 6 }}>
            <span>Sex: {renderSex(selectedPatient.sex)}</span>
            <span>
              Age: {selectedPatient.ageYears ?? "—"}
              {selectedPatient.demographicsEstimated ? " (Estimated)" : ""}
            </span>
            <span>Category: {caseCategory === "oncology" ? "Oncology" : "Non-Oncology"}</span>
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
          title="Clear selection"
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
        placeholder="Search patient by name, national ID, or MRN…"
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
            const primaryIdentifier = getPrimaryIdentifier(patient);
            const mrn = patient.mrn || patient.medicalRecordNo || null;
            const showMrn = mrn != null && !(primaryIdentifier.label === "MRN" && primaryIdentifier.value === mrn);

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
                  <div style={{ fontWeight: 500 }}>{patient.arabicFullName}</div>
                  <div style={{ fontSize: 11, color: "var(--text-muted, #64748b)" }}>
                    {patient.englishFullName}
                    {primaryIdentifier.value ? ` · ${primaryIdentifier.label}: ${primaryIdentifier.value}` : ""}
                    {showMrn ? ` · MRN: ${mrn}` : ""}
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
          No patients found
        </div>
      )}
    </div>
  );
}
