const arabicVariants = [
  [/أ|إ|آ/g, "ا"],
  [/ة/g, "ه"],
  [/ى/g, "ي"],
  [/ؤ/g, "و"],
  [/ئ/g, "ي"]
];

export function normalizeArabicName(value) {
  let result = (value || "").trim().replace(/\s+/g, " ");

  for (const [pattern, replacement] of arabicVariants) {
    result = result.replace(pattern, replacement);
  }

  return result;
}

export function normalizeLibyanPhone(value) {
  return (value || "").replace(/\D/g, "");
}

export function buildEstimatedDobFromAge(ageYears) {
  if (!Number.isInteger(ageYears) || ageYears < 0 || ageYears > 130) {
    return null;
  }

  const today = new Date();
  return new Date(today.getFullYear() - ageYears, today.getMonth(), today.getDate());
}

export function formatDateForSql(date) {
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) {
    return null;
  }

  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}
