// @ts-check

const TRIPOLI_TIME_ZONE = "Africa/Tripoli";

/**
 * @param {Date} [date]
 * @returns {{ year?: string, month?: string, day?: string }}
 */
function getTripoliParts(date = new Date()) {
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: TRIPOLI_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  });

  return formatter.formatToParts(date).reduce((accumulator, part) => {
    if (part.type !== "literal") {
      accumulator[part.type] = part.value;
    }

    return accumulator;
  }, {});
}

/**
 * @param {Date} [date]
 */
export function getTripoliToday(date = new Date()) {
  const parts = getTripoliParts(date);
  return `${parts.year}-${parts.month}-${parts.day}`;
}

/**
 * @param {Date | string | null | undefined} value
 */
export function normalizeDateValue(value) {
  if (value instanceof Date) {
    return getTripoliToday(value);
  }

  return String(value || "").slice(0, 10);
}

export { TRIPOLI_TIME_ZONE };
