// @ts-check

const TRIPOLI_TIME_ZONE = "Africa/Tripoli";

/**
 * @param {Date} [date]
 * @returns {{ year: string, month: string, day: string }}
 */
function getTripoliParts(date = new Date()) {
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: TRIPOLI_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  });

  const parts = formatter.formatToParts(date).reduce((accumulator, part) => {
    if (part.type !== "literal") {
      accumulator[part.type] = part.value;
    }

    return accumulator;
  }, /** @type {{ year?: string, month?: string, day?: string }} */ ({}));

  return {
    year: parts.year || "1970",
    month: parts.month || "01",
    day: parts.day || "01"
  };
}

/**
 * @param {Date} [date]
 * @returns {string}
 */
export function getTripoliToday(date = new Date()) {
  const parts = getTripoliParts(date);
  return `${parts.year}-${parts.month}-${parts.day}`;
}

/**
 * @param {Date | string | null | undefined} value
 * @returns {string}
 */
export function normalizeDateValue(value) {
  if (value instanceof Date) {
    return getTripoliToday(value);
  }

  return String(value || "").slice(0, 10);
}

export { TRIPOLI_TIME_ZONE };
