import { useQuery } from "@tanstack/react-query";
import { fetchPatientDirectorySummary } from "@/lib/api-hooks";
import { t, type Language } from "@/lib/i18n";
import type { PatientDirectorySummary } from "@/types/api";

export const patientDirectorySummaryQueryKey = (patientId: number) => ["patient-directory-summary", patientId] as const;

export function usePatientDirectorySummary(patientId: number) {
  return useQuery({
    queryKey: patientDirectorySummaryQueryKey(patientId),
    queryFn: () => fetchPatientDirectorySummary(patientId),
    enabled: patientId > 0,
    staleTime: 30_000,
    retry: 1,
  });
}

export function formatPatientSex(language: Language, value: string | null | undefined): string {
  const normalized = String(value ?? "").trim().toLowerCase();
  if (["m", "male"].includes(normalized)) return t(language, "patientMerge.sex.male");
  if (["f", "female"].includes(normalized)) return t(language, "patientMerge.sex.female");
  if (["other", "o"].includes(normalized)) return t(language, "patients.sex.other");
  if (["unknown", "u", "undisclosed"].includes(normalized)) return t(language, "patients.sex.unknown");
  return "—";
}

export function formatIdentifierTypeLabel(type: string, language: Language): string {
  switch (type.trim().toLowerCase()) {
    case "national_id": return t(language, "patients.nationalId");
    case "passport": return t(language, "patients.identifier.passport");
    case "family_book": return t(language, "patients.identifier.familyBook");
    case "other": return t(language, "patients.identifier.other");
    default: return type ? type.replace(/_/g, " ").replace(/\b\w/g, (char) => char.toUpperCase()) : t(language, "patients.identifier.other");
  }
}

export function formatPatientIdentifierRows(summary: Pick<PatientDirectorySummary, "identifiers">, language: Language): Array<{ id: string; typeLabel: string; value: string; isPrimary: boolean }> {
  const items = summary.identifiers.items ?? [];
  const rows = items.length > 0
    ? items.map((item) => ({ id: String(item.id ?? `${item.typeCode}:${item.value}`), typeLabel: formatIdentifierTypeLabel(item.typeCode, language), value: item.value.trim(), isPrimary: item.isPrimary }))
    : summary.identifiers.identifierValue || summary.identifiers.nationalId
      ? [{ id: "fallback-primary", typeLabel: formatIdentifierTypeLabel(summary.identifiers.identifierType || "national_id", language), value: (summary.identifiers.identifierValue || summary.identifiers.nationalId || "").trim(), isPrimary: true }]
      : [];
  const seen = new Set<string>();
  return rows.filter((row) => {
    const key = row.value.toLowerCase();
    if (!row.value || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
