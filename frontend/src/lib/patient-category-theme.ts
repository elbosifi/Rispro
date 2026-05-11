export type PatientCategoryTone = "oncology" | "non_oncology" | null | undefined;

export function patientCategoryRowClass(
  category: PatientCategoryTone,
  index = 0,
  selected = false
) {
  const selectedClass = selected ? "ring-1 ring-accent/30" : "";

  if (category === "oncology") {
    return `border-l-4 border-l-rose-300 bg-rose-50/55 hover:bg-rose-50/80 ${selectedClass}`.trim();
  }

  if (category === "non_oncology") {
    return `border-l-4 border-l-sky-200 bg-sky-50/25 hover:bg-sky-50/45 ${selectedClass}`.trim();
  }

  return `border-l-4 border-l-transparent ${
    index % 2 === 0 ? "bg-background hover:bg-muted/40" : "bg-muted/20 hover:bg-muted/40"
  } ${selectedClass}`.trim();
}
