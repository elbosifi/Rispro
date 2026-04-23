import { transliterateArabicName } from "@/lib/transliterate";

type PatientNameLike = {
  arabicFullName?: string | null;
  englishFullName?: string | null;
};

export function formatAppointmentPatientName(
  language: "ar" | "en",
  patient: PatientNameLike | null | undefined,
  fallbackLabel: string
): string {
  const arabicName = String(patient?.arabicFullName ?? "").trim();
  const englishName = String(patient?.englishFullName ?? "").trim();

  if (language === "ar") {
    return arabicName || englishName || fallbackLabel;
  }

  return englishName || (arabicName ? transliterateArabicName(arabicName) : "") || fallbackLabel;
}
