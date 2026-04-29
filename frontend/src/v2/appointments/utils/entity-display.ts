export type EntityDisplayMode = "ar" | "en" | "both";

interface FormatEntityLabelInput {
  mode: EntityDisplayMode;
  nameAr?: string | null;
  nameEn?: string | null;
  fallback?: string | null;
}

function normalized(value?: string | null): string {
  return String(value ?? "").trim();
}

export function formatEntityLabel({
  mode,
  nameAr,
  nameEn,
  fallback,
}: FormatEntityLabelInput): string {
  const ar = normalized(nameAr);
  const en = normalized(nameEn);
  const fallbackValue = normalized(fallback);

  if (mode === "ar") {
    return ar || en || fallbackValue;
  }

  if (mode === "en") {
    return en || ar || fallbackValue;
  }

  if (en && ar) {
    return `${en} — ${ar}`;
  }

  return en || ar || fallbackValue;
}
