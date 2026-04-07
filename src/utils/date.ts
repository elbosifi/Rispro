const TRIPOLI_TIME_ZONE = "Africa/Tripoli";

function getTripoliParts(date: Date = new Date()): { year: string; month: string; day: string } {
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: TRIPOLI_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  });

  const parts = formatter.formatToParts(date).reduce((accumulator, part) => {
    if (part.type !== "literal" && part.type !== "unknown") {
      accumulator[part.type as 'year' | 'month' | 'day'] = part.value;
    }

    return accumulator;
  }, {} as { year?: string; month?: string; day?: string });

  return {
    year: parts.year || "1970",
    month: parts.month || "01",
    day: parts.day || "01"
  };
}

export function getTripoliToday(date: Date = new Date()): string {
  const parts = getTripoliParts(date);
  return `${parts.year}-${parts.month}-${parts.day}`;
}

export function normalizeDateValue(value: Date | string | null | undefined): string {
  if (value instanceof Date) {
    return getTripoliToday(value);
  }

  return String(value || "").slice(0, 10);
}

export { TRIPOLI_TIME_ZONE };
