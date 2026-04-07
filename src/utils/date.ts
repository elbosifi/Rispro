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

/**
 * Validate that a value is a valid ISO-8601 date string (YYYY-MM-DD format).
 * @param value - The value to validate
 * @param fieldName - Field name for error messages (default: "date")
 * @returns The validated date string
 */
export function validateIsoDate(value: unknown, fieldName = "date"): string {
  const dateStr = String(value || "").trim();
  
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) {
    throw new Error(`${fieldName} must be in YYYY-MM-DD format.`);
  }
  
  // Also validate that it's a real date
  const [year, month, day] = dateStr.split("-").map(Number);
  const dateObj = new Date(year, month - 1, day);
  if (
    dateObj.getFullYear() !== year ||
    dateObj.getMonth() !== month - 1 ||
    dateObj.getDate() !== day
  ) {
    throw new Error(`${fieldName} must be in YYYY-MM-DD format.`);
  }
  
  return dateStr;
}

export { TRIPOLI_TIME_ZONE };
