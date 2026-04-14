/**
 * Appointments V2 — Patient search component.
 *
 * Debounced patient search with dropdown results.
 * Follows the established pattern from legacy appointments-page.tsx.
 */

import { useState, useRef, useCallback, useEffect } from "react";
import { Search, X } from "lucide-react";
import { searchPatients } from "@/lib/api-hooks";

interface Patient {
  id: number;
  arabicFullName: string;
  englishFullName?: string | null;
  nationalId?: string | null;
  mrn?: string | null;
  medicalRecordNo?: string | null;
  phone?: string | null;
  phone1?: string | null;
  sex?: string | null;
  ageYears?: number | null;
}

interface PatientSearchProps {
  onSelect: (patient: Patient) => void;
  selectedPatient: Patient | null;
  onClear: () => void;
}

export function PatientSearch({ onSelect, selectedPatient, onClear }: PatientSearchProps) {
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
    return (
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "10px 14px",
          borderRadius: 8,
          backgroundColor: "var(--bg-success, #ecfdf5)",
          border: "1px solid var(--border-success, #a7f3d0)",
        }}
      >
        <div>
          <div style={{ fontWeight: 600, fontSize: 14 }}>
            {selectedPatient.arabicFullName}
          </div>
          <div style={{ fontSize: 12, color: "var(--text-muted, #64748b)" }}>
            {selectedPatient.englishFullName}
            {selectedPatient.nationalId ? ` · ${selectedPatient.nationalId}` : ""}
            {(selectedPatient.mrn || selectedPatient.medicalRecordNo)
              ? ` · MRN: ${selectedPatient.mrn || selectedPatient.medicalRecordNo}`
              : ""}
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
      <div style={{ position: "relative" }}>
        <Search
          size={16}
          style={{
            position: "absolute",
            left: 10,
            top: "50%",
            transform: "translateY(-50%)",
            color: "var(--text-muted, #64748b)",
            pointerEvents: "none",
          }}
        />
        <input
          type="text"
          value={query}
          onChange={(e) => handleSearch(e.target.value)}
          placeholder="Search patient by name, national ID, or MRN…"
          style={{
            width: "100%",
            padding: "8px 10px 8px 32px",
            borderRadius: 6,
            border: "1px solid var(--border-color, #e2e8f0)",
            fontSize: 14,
          }}
        />
        {isSearching && (
          <div
            style={{
              position: "absolute",
              right: 10,
              top: "50%",
              transform: "translateY(-50%)",
              fontSize: 11,
              color: "var(--text-muted, #64748b)",
            }}
          >
            Searching…
          </div>
        )}
      </div>

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
            borderRadius: 6,
            border: "1px solid var(--border-color, #e2e8f0)",
            backgroundColor: "var(--bg-surface, #fff)",
            boxShadow: "0 4px 12px rgba(0,0,0,0.1)",
          }}
        >
          {results.map((patient) => (
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
                  {patient.nationalId ? ` · ${patient.nationalId}` : ""}
                </div>
              </button>
            </li>
          ))}
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
